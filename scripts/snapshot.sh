#!/bin/sh
# Write public/yard.json: the structure of a yardr yard, as the page draws it,
# bring layout.json beside it up to date: the slots its elements stand in, and
# write events.json there too: the yard's last events, for the page to replay.
# Everything comes from the yard's own commands (yardr ... --json), never from
# its store or socket. src/yard.ts and src/replay.ts hold the shapes of the
# files as types.
#
#   scripts/snapshot.sh [out]     YARDR=/path/to/yardr to name the binary
#
# Each list is cut down to the fields the picture needs: the commands also
# print bead bodies, paths on the machine, secret files and process handles,
# and the file is committed and served.
set -eu

yardr=${YARDR:-yardr}
out=${1:-"$(dirname "$0")/../public/yard.json"}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

"$yardr" depot list --json >"$tmp/depots"
"$yardr" group list --json >"$tmp/groups"
"$yardr" route list --json >"$tmp/routes"
"$yardr" crew list --json >"$tmp/crew"
"$yardr" peer list --json >"$tmp/peers"
# Without -a or --all: every open bead.
"$yardr" bead list --json >"$tmp/beads"
# The window the page replays. yardr events has no --since, so it is a count
# and not a day: the newest 2000, oldest first.
"$yardr" events --json -n 2000 >"$tmp/events"
# Every bead there ever was: the ones the window names and that have closed
# since are in no other list.
"$yardr" bead list --all --json >"$tmp/all"

# One file of flows per depot, in the order of depot list: {depot, flows}.
: >"$tmp/flows"
jq -r '.[].name' "$tmp/depots" | while IFS= read -r depot; do
  "$yardr" flow show "$depot" --json | jq --arg depot "$depot" '{depot: $depot, flows: .}' >>"$tmp/flows"
done

jq -n \
  --arg taken_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --slurpfile depots "$tmp/depots" \
  --slurpfile flows "$tmp/flows" \
  --slurpfile groups "$tmp/groups" \
  --slurpfile routes "$tmp/routes" \
  --slurpfile crew "$tmp/crew" \
  --slurpfile peers "$tmp/peers" \
  --slurpfile beads "$tmp/beads" '
  # Drop the keys whose value is null, as yardr leaves out what is unset.
  def tidy: with_entries(select(.value != null));
  {
    taken_at: $taken_at,
    depots: [$depots[0][] | {name, kind, base} | tidy],
    flows: [$flows[] | {
      depot,
      flows: [.flows[] | {
        name: .flow.name,
        type,
        stages: [.stages[] | {stage, group, next, human, terminal} | tidy]
      } | tidy]
    }],
    groups: [$groups[0][] | {name, runner, limit, members} | tidy],
    routes: [$routes[0][] | {stage, type, depot, label, group, priority} | tidy],
    crew: [$crew[0][] | {name, kind: .config.kind, state, status} | tidy],
    peers: [$peers[0][] | {name, send, receive} | tidy],
    beads: [$beads[0][] | {id, title, type, stage, depot, group, working: (.session != null), hold, train, labels, priority, created_at} | tidy]
  }' >"$tmp/yard.json"

# The events, cut down to what the replay reads (src/replay.ts). An advance
# alone keeps from and to: on other kinds they are people and builds. A
# session is named s1, s2, ... in the order the window first names it: the
# replay only pairs a session's start with its end.
jq -n \
  --slurpfile yard "$tmp/yard.json" \
  --slurpfile events "$tmp/events" \
  --slurpfile all "$tmp/all" '
  def tidy: with_entries(select(.value != null));
  $events[0] as $window
  | (reduce ($window[] | .data.session? | strings) as $s ({};
      if has($s) then . else .[$s] = "s\(length + 1)" end)) as $alias
  | ([$window[] | .bead | strings] | unique) as $named
  | {
    taken_at: $yard[0].taken_at,
    # The beads the window names that are closed now, as they were last.
    beads: [$all[0][] | select(.status == "closed") | select(.id as $id | $named | index($id) != null)
      | {id, title, type, stage, depot, train, labels, priority, created_at} | tidy],
    events: [$window[] | (.data // {}) as $d | {
      seq, at, kind, bead,
      data: ({
        group: $d.group, session: ($d.session | if type == "string" then $alias[.] else null end),
        depot: $d.depot, type: $d.type, peer: $d.peer, kind: $d.kind, crew: $d.crew
      } + (if .kind == "advanced" then {from: $d.from, to: $d.to, outcome: $d.outcome} else {} end)
        | with_entries(select(.value | type == "string")) | if length > 0 then . else null end)
    } | tidy]
  }' >"$tmp/events.json"

mv "$tmp/yard.json" "$out"
mv "$tmp/events.json" "$(dirname "$out")/events.json"

# The layout's memory: written when it is missing, and given what is new in
# this snapshot otherwise. What it holds already is never changed.
node "$(dirname "$0")/slots.mjs" "$out" "$(dirname "$out")/layout.json"
