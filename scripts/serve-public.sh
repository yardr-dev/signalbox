#!/bin/sh
# Serve this yard's public page from the checkout: pull the base, build it,
# restart the server and check the page it serves.
#
#   scripts/serve-public.sh [--start-only | --check-only] [dir]
#
# dir is the checkout to serve (the one holding this script, by default).
# --start-only restarts the server and checks it, without the pull, the
# install and the build: what the login service runs after a reboot
# (contrib/dev.yardr.signalbox-serve.plist). --check-only checks the page
# a running server serves, and starts nothing.
#
# A full run, in dir: git pull --ff-only, npm ci, npm run build, then the
# server is stopped by its pid file and started again:
#
#   YARDR_WEB=http://127.0.0.1:8791 YARDR_HOME=~/.yardr \
#     node scripts/serve.mjs --host 0.0.0.0 --port 8792 \
#     >> ~/.yardr/logs/signalbox-serve.log 2>&1
#
# and the served page is checked: it is the built index.html byte for byte,
# every asset that names is fetched from the server, and the feed's newest
# sequence number is the yard's (the snapshot against `yardr events -n 1`).
# A step that fails ends the run, with its words on stderr; the deploy step
# that runs this script fails the stage with them.
#
# The server's pid is kept beside the yard's slots,
# $YARDR_HOME/signalbox/serve.pid. A server from before the pid file (this
# script's first run over it) is found by the port instead, when lsof answers.
# Where the login service is loaded (the yard's Mac), the restart goes through
# it instead: launchctl kickstart -k, and the pid file is written from the
# job's pid.
#
# SIGNALBOX_HOST, SIGNALBOX_PORT, YARDR_WEB and YARDR_HOME name another
# address, port, view and home; the defaults are the public page's.
set -eu

usage() {
  echo "usage: scripts/serve-public.sh [--start-only | --check-only] [dir]" >&2
  exit 2
}

fail() {
  echo "scripts/serve-public.sh: $*" >&2
  exit 1
}

mode=full
if [ "${1:-}" = "--start-only" ] || [ "${1:-}" = "--check-only" ]; then
  mode=${1#--}
  mode=${mode%-only}
  shift
fi
[ $# -le 1 ] || usage
case ${1:-} in -*) usage ;; esac
dir=${1:-$(cd "$(dirname "$0")/.." && pwd -P)}
# Physical, not as named: node runs the entry by its real path, so a
# symlinked dir would start a server that exits without a word.
if [ -d "$dir" ]; then
  dir=$(cd "$dir" && pwd -P)
fi
[ -f "$dir/scripts/serve.mjs" ] && [ -f "$dir/package.json" ] || fail "$dir is no signalbox checkout"

host=${SIGNALBOX_HOST:-0.0.0.0}
port=${SIGNALBOX_PORT:-8792}
web=${YARDR_WEB:-http://127.0.0.1:8791}
if [ -n "${YARDR_HOME:-}" ]; then
  yard_home=$YARDR_HOME
elif [ -n "${HOME:-}" ]; then
  yard_home=$HOME/.yardr
else
  fail "neither YARDR_HOME nor HOME names the yard's home"
fi
pidfile=$yard_home/signalbox/serve.pid
log=$yard_home/logs/signalbox-serve.log
at=http://127.0.0.1:$port
# The login service that keeps the server alive, where it is loaded (the
# yard's Mac): restarts go through it, and the pid file follows its pid.
job=gui/$(id -u)/dev.yardr.signalbox-serve

# What the run needs on its PATH: the check asks the page and the yard, a
# start runs node, a full run pulls and builds first.
need() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is not on the PATH"
}
need curl
need node
if [ "$mode" = full ]; then
  need git
  need npm
fi

# The node that starts the server runs it: the lowest is package.json's
# (engines), the first to take a TypeScript file as it is, as in
# scripts/release.sh.
if [ "$mode" != check ]; then
  want=$(sed -n 's/.*"node": *">=\([0-9][0-9.]*\)".*/\1/p' "$dir/package.json")
  have=$(node --version)
  have=${have#v}
  minor() {
    rest=${1#*.}
    echo "${rest%%.*}"
  }
  if [ -z "$want" ] || [ "${have%%.*}" -lt "${want%%.*}" ] ||
    { [ "${have%%.*}" -eq "${want%%.*}" ] && [ "$(minor "$have")" -lt "$(minor "$want")" ]; }; then
    fail "node is $have; package.json asks for $want or later"
  fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The commit the checkout has: unknown where git is not there to say, as in
# a test's copy of the tree.
built=$(git -C "$dir" rev-parse --short HEAD 2>/dev/null || true)
built=${built:-unknown}

if [ "$mode" = full ]; then
  # The page serves the landed build, not what someone left in the checkout.
  # Untracked files are none of the build's and are left alone.
  git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "$dir is no git checkout"
  dirty=$(git -C "$dir" status --porcelain --untracked-files=no)
  [ -z "$dirty" ] || fail "the checkout is not clean (commit it, or mend it, and run again): $(printf '%s' "$dirty" | tr '\n' '; ')"
  git -C "$dir" pull --ff-only || fail "git pull --ff-only failed"
  built=$(git -C "$dir" rev-parse --short HEAD)
  (cd "$dir" && npm ci) || fail "npm ci failed"
  (cd "$dir" && npm run build) || fail "npm run build failed"
  # The build can exit 0 and write no page.
  test -s "$dir/dist/index.html" || fail "the build wrote no page"
  echo "signalbox: public: built $built"
fi

# Whether a process is the serve script's: it is killed only then.
serving() {
  ps -o command= -p "$1" 2>/dev/null | grep -q "serve\.mjs"
}

# A TERM that went unanswered for a count of seconds is a KILL; a server
# that answers neither fails the run, and nothing starts beside it.
stop() {
  kill "$1" 2>/dev/null || return 0
  waited=0
  while kill -0 "$1" 2>/dev/null && [ "$waited" -lt 10 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  kill -0 "$1" 2>/dev/null || return 0
  kill -9 "$1" 2>/dev/null || return 0
  waited=0
  while kill -0 "$1" 2>/dev/null && [ "$waited" -lt 5 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  kill -0 "$1" 2>/dev/null && fail "pid $1 did not stop" || return 0
}

if [ "$mode" != check ]; then
  # The job loaded means launchd owns the server, so the restart goes
  # through it; the pid file follows the job's pid, and the checks below
  # read the supervised server. Where the job is not loaded (another
  # machine, a test), the server is stopped by its pid file and started
  # beside this script, as before.
  if launchctl print "$job" >/dev/null 2>&1; then
    mkdir -p "$(dirname "$pidfile")" "$(dirname "$log")"
    launchctl kickstart -k "$job" || fail "launchctl kickstart -k $job failed"
    # The new server's pid, from the job: between the old one's death and
    # the new one's start, the job names no pid.
    pid=""
    waited=0
    while [ -z "$pid" ]; do
      pid=$(launchctl print "$job" 2>/dev/null | sed -n 's/^[[:space:]]*pid = \([0-9][0-9]*\).*/\1/p')
      waited=$((waited + 1))
      [ "$waited" -lt 30 ] || fail "the server is not up after 30 s: $(tail -n 5 "$log" | tr '\n' '; ')"
      [ -n "$pid" ] || sleep 1
    done
    echo "$pid" >"$pidfile"
    echo "signalbox: public: restarted $pid by $job, logging to $log"
  else
    if [ -f "$pidfile" ]; then
      pid=$(cat "$pidfile")
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && serving "$pid"; then
        stop "$pid"
        echo "signalbox: public: stopped $pid"
      else
        echo "signalbox: public: no server on pid ${pid:-none}: starting"
      fi
      rm -f "$pidfile"
    elif command -v lsof >/dev/null 2>&1; then
      # Before the pid file: whoever listens on the port for serve.mjs.
      found=""
      for pid in $(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true); do
        if serving "$pid"; then
          stop "$pid"
          found="${found:+$found, }$pid"
        fi
      done
      if [ -n "$found" ]; then
        echo "signalbox: public: stopped $found (no pid file; found on port $port)"
      else
        echo "signalbox: public: no server on port $port: starting"
      fi
    else
      echo "signalbox: public: no pid file and no lsof: starting"
    fi

    mkdir -p "$(dirname "$pidfile")" "$(dirname "$log")"
    # The server outlives this script: the deploy step ends with the check
    # below. Started in this shell, not a subshell: a subshell waits for
    # what it backgrounds, and names its own pid for $!, so whoever runs
    # this script would hang with the server and stop a dead pid on the
    # next run. serve.mjs finds the page beside itself, so no cd is needed
    # for the absolute path.
    YARDR_WEB=$web YARDR_HOME=$yard_home nohup node "$dir/scripts/serve.mjs" --host "$host" --port "$port" >>"$log" 2>&1 </dev/null &
    pid=$!
    echo "$pid" >"$pidfile"
    echo "signalbox: public: started $pid, logging to $log"
  fi

  # Up is the page, not the snapshot: the yard's view may be down, and that
  # is the feed check's to say.
  waited=0
  while ! curl -sf --max-time 2 "$at/" -o /dev/null 2>/dev/null; do
    kill -0 "$pid" 2>/dev/null || fail "the server died: $(tail -n 5 "$log" | tr '\n' '; ')"
    waited=$((waited + 1))
    [ "$waited" -lt 30 ] || fail "the server is not up after 30 s: $(tail -n 5 "$log" | tr '\n' '; ')"
    sleep 1
  done
  kill -0 "$pid" 2>/dev/null || fail "the server died: $(tail -n 5 "$log" | tr '\n' '; ')"
fi

# The served page is the built one, byte for byte, and every asset it names
# is fetched from the server.
curl -sf --max-time 5 "$at/" -o "$tmp/index.html" || fail "the page did not answer at $at/"
cmp -s "$tmp/index.html" "$dir/dist/index.html" || fail "the served page is not the built one ($built)"
assets=$(grep -o '/assets/[^"'\'']*' "$dir/dist/index.html" | sort -u || true)
count=0
for asset in $assets; do
  curl -sf --max-time 5 "$at$asset" -o /dev/null || fail "the served page names $asset, which the server does not answer"
  count=$((count + 1))
done

# The feed's newest against the yard's. The yard is asked first: events only
# arrive, so a snapshot taken after it holds its newest too, or is behind.
need yardr
yardr events -n 1 --json >"$tmp/yard.json" 2>"$tmp/yard.err" || fail "yardr events -n 1: $(head -c 300 "$tmp/yard.err" | tr '\n' ' ')"
curl -sf --max-time 25 "$at/api/snapshot" -o "$tmp/snapshot.json" || fail "the snapshot did not answer at $at/api/snapshot"
seq_of() {
  node -e '
const fs = require("fs");
try {
  const said = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const events = Array.isArray(said) ? said : said.log && said.log.events;
  const seqs = (Array.isArray(events) ? events : []).map((e) => e && e.seq).filter(Number.isInteger);
  if (seqs.length > 0) console.log(Math.max(...seqs));
} catch {
  process.exit(1);
}' "$1"
}
yard=$(seq_of "$tmp/yard.json") || fail "yardr events -n 1 answered no JSON"
feed=$(seq_of "$tmp/snapshot.json") || fail "the snapshot answered no JSON"
if [ -n "$yard" ] && { [ -z "$feed" ] || [ "$feed" -lt "$yard" ]; }; then
  fail "the feed is behind: the page's newest event is ${feed:-none}, the yard's is $yard"
fi

echo "signalbox: public: $built serves at $at/ ($count assets, feed at ${feed:-none}, yard at ${yard:-none})"
