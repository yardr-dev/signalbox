// The public page's script (scripts/serve-public.sh): what its checks say of
// the served page and the feed, that a restart stops the server by its pid
// file or through launchd when the job is loaded, and that a build starts
// from a clean checkout alone. It runs over a checkout of the tree's shape
// with a page of two files, against servers in this file, a yardr that is a
// stand-in and a launchctl that is one: nothing of this session's (no yard,
// no view, no real yardr, no real launchctl) is asked.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, test } from "vitest";

const here = fileURLToPath(new URL("..", import.meta.url));
const script = join(here, "scripts/serve-public.sh");

const dir = mkdtempSync(join(tmpdir(), "signalbox-serve-public-"));
afterAll(() => rmSync(dir, { recursive: true }));

// What the run leaves behind: servers to close, and pid files whose server
// outlives the script by design, stopped by pid after every test.
const stoppers = [];
afterEach(async () => {
  while (stoppers.length > 0) await stoppers.pop()();
});
const close = (server) => stoppers.push(() => new Promise((done) => server.close(done)));
const watch = (pidfile) => stoppers.push(() => stop(pidfile));
function stop(pidfile) {
  if (!existsSync(pidfile)) return;
  const pid = Number(readFileSync(pidfile, "utf8"));
  rmSync(pidfile);
  if (!Number.isInteger(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Gone by now.
  }
}

// A checkout of the shape the script is run over: the page it was built
// with, and the two files that say it is signalbox's. Roots that start the
// server carry the files it loads instead of the stand-in.
function checkout(name, real = false) {
  const root = join(dir, name);
  mkdirSync(join(root, "dist/assets"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "home"), { recursive: true });
  // No job is loaded: launchctl answers nothing, so the run starts the
  // server beside itself. This stand-in also keeps a run on the yard's Mac
  // from reaching the real launchctl and its loaded job.
  writeFileSync(join(root, "bin", "launchctl"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(root, "dist/index.html"), '<!doctype html><title>signalbox</title><script src="/assets/app.js"></script>');
  writeFileSync(join(root, "dist/assets/app.js"), "the page's own");
  if (real) {
    for (const file of ["scripts/serve.mjs", "scripts/yard.mjs", "src/layout.ts", "src/project.ts", "package.json"]) {
      mkdirSync(join(root, dirname(file)), { recursive: true });
      cpSync(join(here, file), join(root, file));
    }
  } else {
    writeFileSync(join(join(root, "scripts"), "serve.mjs"), "");
    writeFileSync(join(root, "package.json"), JSON.stringify({ engines: { node: ">=22.6" } }));
  }
  return root;
}

// The stand-in's answers to `yardr events -n 1 --json`.
function yardr(root, yard) {
  writeFileSync(join(root, "bin", "yardr"), `#!/bin/sh\necho '${JSON.stringify(yard)}'\n`, { mode: 0o755 });
}

// launchd as the script runs it: print names the job's pid while its server
// lives, kickstart -k stops that server and starts another on the script's
// port. Overwrites checkout's failing stand-in, which keeps every other run
// on the pid-file start. Three knobs bend what print names after a restart:
// LAUNCHCTL_FIXED_PID names that pid instead of the server's (one with no
// process proves the run never asked kill -0); LAUNCHCTL_REPLACE_PID and
// LAUNCHCTL_LOSE_PID, once the run has latched the started pid in its pid
// file, name another pid or none: launchd restarted the server, or lost it.
function launchd(root) {
  writeFileSync(
    join(root, "bin", "launchctl"),
    `#!/bin/sh
state=$YARDR_HOME/launchd.pid
if [ "$1" = "print" ]; then
  [ -f "$state" ] || exit 1
  pid=$(cat "$state")
  kill -0 "$pid" 2>/dev/null || exit 1
  if [ -f "$YARDR_HOME/fixed.pid" ]; then
    pid=$(cat "$YARDR_HOME/fixed.pid")
  elif [ -f "$YARDR_HOME/signalbox/serve.pid" ] && [ "$(cat "$YARDR_HOME/signalbox/serve.pid")" = "$pid" ]; then
    if [ -n "$LAUNCHCTL_REPLACE_PID" ]; then
      pid=$LAUNCHCTL_REPLACE_PID
    elif [ -n "$LAUNCHCTL_LOSE_PID" ]; then
      exit 1
    fi
  fi
  printf '%s = {\\n\\tactive count = 5\\n\\tpid = %s\\n};\\n' "$2" "$pid"
elif [ "$1" = "kickstart" ] && [ "$2" = "-k" ]; then
  echo "kickstart $2 $3" >>$YARDR_HOME/kickstarted
  if [ -f "$state" ]; then
    old=$(cat "$state")
    # kickstart returns before launchd has finished replacing the old pid.
    # Leave print reporting it briefly to cover that restart window.
    (
      sleep 0.2
      kill "$old" 2>/dev/null
      while curl -sf --max-time 1 "http://127.0.0.1:$SIGNALBOX_PORT/" >/dev/null; do sleep 0.05; done
      root=$(dirname "$YARDR_HOME")
      mkdir -p "$YARDR_HOME/logs"
      node "$root/bin/page.mjs" "$SIGNALBOX_PORT" "$root" >>"$YARDR_HOME/logs/signalbox-serve.log" 2>&1 </dev/null &
      # Before the state: a print between the two never names the server's
      # pid where LAUNCHCTL_FIXED_PID asked for another.
      [ -n "$LAUNCHCTL_FIXED_PID" ] && echo "$LAUNCHCTL_FIXED_PID" >"$YARDR_HOME/fixed.pid"
      echo $! >"$state"
    ) >/dev/null 2>&1 </dev/null &
  else
    root=$(dirname "$YARDR_HOME")
    mkdir -p "$YARDR_HOME/logs"
    node "$root/bin/page.mjs" "$SIGNALBOX_PORT" "$root" >>"$YARDR_HOME/logs/signalbox-serve.log" 2>&1 </dev/null &
    echo $! >"$state"
  fi
else
  exit 1
fi
`,
    { mode: 0o755 }
  );
  // The job's server, as the stand-in starts it: the built page as bytes,
  // each asset from dist, and a snapshot whose feed is at 41.
  writeFileSync(
    join(root, "bin", "page.mjs"),
    `import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
const port = Number(process.argv[2]);
const root = process.argv[3];
createServer((req, res) => {
  const pathname = new URL(req.url, "http://page").pathname;
  if (pathname === "/api/snapshot") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ log: { events: [{ seq: 41 }] } }));
  } else if (pathname === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(readFileSync(join(root, "dist", "index.html")));
  } else if (pathname.startsWith("/assets/") && existsSync(join(root, "dist", pathname))) {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(readFileSync(join(root, "dist", pathname)));
  } else {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  }
}).listen(port, "127.0.0.1");
`
  );
}

// A server in the shape of serve.mjs: the page as bytes (serve, or the
// built one), each asset from dist or a 404, and the snapshot with a feed
// of the given sequence numbers.
function page(root, seqs, serve = undefined) {
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://page");
    if (pathname === "/api/snapshot") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ log: { events: seqs.map((seq) => ({ seq })) } }));
    } else if (pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(serve ?? readFileSync(join(root, "dist/index.html")));
    } else if (pathname.startsWith("/assets/") && existsSync(join(root, `dist${pathname}`))) {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(readFileSync(join(root, `dist${pathname}`)));
    } else {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
  return server;
}

async function listen(server) {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  close(server);
  return server.address().port;
}

// A free loopback port, named before the server that takes it.
async function free() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

// Nothing of this session's: the script's home is the test's, the yardr on
// its PATH is the stand-in the test wrote, and node is the runner's own.
// /usr/bin and /bin hold sh, curl, git and the rest; /usr/sbin lsof. Async:
// the servers the script asks run in this process, and a synchronous run
// would hold them mute while it waits.
function run(args, { root, port, web = "http://127.0.0.1:1", env = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", [script, ...args], {
      env: {
        PATH: `${join(root, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin`,
        HOME: join(root, "home"),
        YARDR_HOME: join(root, "home"),
        YARDR_WEB: web,
        SIGNALBOX_HOST: "127.0.0.1",
        SIGNALBOX_PORT: String(port),
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("the public page's checks", () => {
  test("pass over the built page and a feed that is the yard's", async () => {
    const root = checkout("pass");
    yardr(root, [{ seq: 40 }, { seq: 41 }]);
    const ran = await run(["--check-only", root], { root, port: await listen(page(root, [40, 41])) });
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toContain("1 assets, feed at 41, yard at 41");
    expect(ran.stderr).toBe("");
  });

  test("fail when the served page is not the built one", async () => {
    const root = checkout("other");
    yardr(root, [{ seq: 41 }]);
    const ran = await run(["--check-only", root], { root, port: await listen(page(root, [41], "<!doctype html><title>another page</title>")) });
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("the served page is not the built one");
  });

  test("fail when an asset the page names is not answered", async () => {
    const root = checkout("gone");
    yardr(root, [{ seq: 41 }]);
    // The page names the asset; the server answers it 404.
    rmSync(join(root, "dist/assets/app.js"));
    const ran = await run(["--check-only", root], { root, port: await listen(page(root, [41])) });
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("/assets/app.js");
  });

  test("fail when the feed is behind the yard", async () => {
    const root = checkout("behind");
    yardr(root, [{ seq: 41 }]);
    const ran = await run(["--check-only", root], { root, port: await listen(page(root, [40])) });
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("the feed is behind");
    expect(ran.stderr).toContain("40");
    expect(ran.stderr).toContain("41");
  });

  test("pass when the feed is past the yard: an event landed between the two reads", async () => {
    const root = checkout("past");
    yardr(root, [{ seq: 41 }]);
    const ran = await run(["--check-only", root], { root, port: await listen(page(root, [42])) });
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toContain("feed at 42, yard at 41");
  });

  test("fail with the yard's words when yardr does not answer", async () => {
    const root = checkout("down");
    writeFileSync(join(root, "bin", "yardr"), "#!/bin/sh\necho 'no yard in this home' >&2\nexit 1\n", { mode: 0o755 });
    const ran = await run(["--check-only", root], { root, port: await listen(page(root, [41])) });
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("no yard in this home");
  });

  test("refuse what is no mode and more than a checkout", async () => {
    const root = checkout("usage");
    for (const args of [["--bogus", root], [root, root]]) {
      const ran = await run(args, { root, port: 1 });
      expect(ran.status, args.join(" ")).toBe(2);
      expect(ran.stderr).toContain("usage: scripts/serve-public.sh");
    }
  });
});

describe("the public page's restart", () => {
  // The yard's view, as serve.test.mjs stands it in: one depot, a head of
  // none, and no events to stream.
  function view() {
    const lists = { "/depots": "depots", "/flows": "depots", "/groups": "groups", "/routes": "routes", "/crew": "crew", "/peers": "peers", "/beads": "beads", "/sessions": "list", "/deps": "deps" };
    const server = createServer((req, res) => {
      const { pathname } = new URL(req.url, "http://view");
      const rows = pathname === "/depots" ? [{ name: "papers", kind: "dir" }] : pathname === "/flows" ? [{ name: "papers", kind: "dir", flows: [] }] : [];
      res.writeHead(lists[pathname] === undefined ? 404 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(lists[pathname] === undefined ? { error: "not found" } : { [lists[pathname]]: rows, head: 0 }));
    });
    return server;
  }

  test("starts the server, stops it by its pid file, and finds one before the pid file by its port", async () => {
    const root = checkout("restart", true);
    yardr(root, []);
    const web = `http://127.0.0.1:${await listen(view())}`;
    const port = await free();
    const pidfile = join(root, "home", "signalbox", "serve.pid");
    watch(pidfile);
    const start = async () => {
      const ran = await run(["--start-only", root], { root, port, web });
      expect(ran.status, ran.stderr).toBe(0);
      return ran;
    };

    const first = await start();
    expect(first.stdout).toContain("no server on port");
    const one = Number(readFileSync(pidfile, "utf8"));
    expect(one).toBeGreaterThan(0);
    const served = execFileSync("curl", ["-sf", `http://127.0.0.1:${port}/`], { encoding: "utf8" });
    expect(served).toBe(readFileSync(join(root, "dist/index.html"), "utf8"));

    const second = await start();
    expect(second.stdout).toContain(`stopped ${one}`);
    const two = Number(readFileSync(pidfile, "utf8"));
    expect(two).not.toBe(one);
    expect(() => process.kill(one, 0)).toThrow();

    // A server from before the pid file: no pid file, the port instead.
    rmSync(pidfile);
    const third = await start();
    expect(third.stdout).toContain("found on port");
    expect(third.stdout).toContain(`stopped ${two}`);
    expect(() => process.kill(two, 0)).toThrow();

    expect(readFileSync(join(root, "home", "logs", "signalbox-serve.log"), "utf8")).toContain("live, at");
  }, 60000);

  // The loaded job's server, started as the stand-in starts it: a kickstart
  // with no state starts it synchronously. Waits for the page it serves.
  async function preload(root, port) {
    const env = {
      PATH: `${join(root, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin`,
      HOME: join(root, "home"),
      YARDR_HOME: join(root, "home"),
      SIGNALBOX_PORT: String(port),
    };
    execFileSync(join(root, "bin", "launchctl"), ["kickstart", "-k", "gui/0/dev.yardr.signalbox-serve"], { env });
    const old = Number(readFileSync(join(root, "home", "launchd.pid"), "utf8"));
    expect(old).toBeGreaterThan(0);
    const until = Date.now() + 10000;
    for (;;) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/`)).status === 200) break;
      } catch {
        // Not yet.
      }
      if (Date.now() > until) throw new Error("the stand-in's server did not answer");
      await new Promise((go) => setTimeout(go, 100));
    }
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe(readFileSync(join(root, "dist/index.html"), "utf8"));
    return old;
  }

  test.each([
    { name: "restarts the server and the pid file follows the job's pid", behavior: "same" },
    {
      name: "trusts the job's pid without checking the process",
      behavior: "fixed",
      env: { LAUNCHCTL_FIXED_PID: "987654321" },
    },
    {
      name: "fails naming both pids when launchd names another pid",
      behavior: "replaced",
      env: { LAUNCHCTL_REPLACE_PID: "987654321" },
    },
    {
      name: "fails saying so when launchd names no pid",
      behavior: "lost",
      env: { LAUNCHCTL_LOSE_PID: "1" },
    },
  ])("launchd restart: $name", async ({ behavior, env = {} }) => {
    const root = checkout(`launchd-${behavior}`);
    yardr(root, [{ seq: 41 }]);
    launchd(root);
    const port = await free();
    const pidfile = join(root, "home", "signalbox", "serve.pid");
    const state = join(root, "home", "launchd.pid");
    watch(pidfile);
    stoppers.push(() => stop(state));

    const old = await preload(root, port);

    const ran = await run(["--start-only", root], { root, port, env });
    const pid = Number(readFileSync(pidfile, "utf8"));
    if (behavior === "same") {
      expect(ran.status, ran.stderr).toBe(0);
      expect(ran.stdout).toContain("restarted");
      expect(ran.stdout).toContain("dev.yardr.signalbox-serve");
      expect(readFileSync(join(root, "home", "kickstarted"), "utf8")).toContain("kickstart -k gui/");
      expect(pid).not.toBe(old);
      expect(pid).toBe(Number(readFileSync(state, "utf8")));
      expect(() => process.kill(old, 0)).toThrow();
      expect(ran.stdout).toContain("1 assets, feed at 41, yard at 41");
    } else if (behavior === "fixed") {
      // Past every pid the machine hands out: kill -0 on it fails, so a pass
      // proves the run never asked.
      expect(ran.status, ran.stderr).toBe(0);
      expect(pid).toBe(987654321);
      expect(ran.stdout).toContain("1 assets, feed at 41, yard at 41");
    } else if (behavior === "replaced") {
      expect(ran.status).toBe(1);
      expect(ran.stderr).toContain(`names 987654321, not the started ${pid}`);
      expect(ran.stderr).toContain("launchd restarted it");
    } else {
      expect(ran.status).toBe(1);
      expect(ran.stderr).toContain("names no pid");
      expect(ran.stderr).toContain(String(pid));
    }
  }, 60000);

  test("refuses a node older than package.json asks for, and starts nothing", async () => {
    const root = checkout("node", true);
    writeFileSync(join(root, "bin", "node"), "#!/bin/sh\necho v22.5.9\n", { mode: 0o755 });
    const ran = await run(["--start-only", root], { root, port: await free() });
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("package.json asks for 22.6 or later");
    expect(existsSync(join(root, "home", "signalbox", "serve.pid"))).toBe(false);
  });
});

describe("the public page's build", () => {
  // git is the system's, and the yard is none of its business: it never
  // leaves the fixture, whose config is its own, and the pull it would run
  // has no upstream to reach.
  function git(root, ...args) {
    return execFileSync("git", ["-c", "user.name=signalbox", "-c", "user.email=signalbox@example.com", "-c", "init.defaultBranch=main", ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: join(root, "home") },
    });
  }

  function repo(name) {
    const root = checkout(name);
    writeFileSync(join(root, "bin", "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    git(root, "init");
    git(root, "add", ".");
    git(root, "commit", "-m", "the page");
    return root;
  }

  test("refuses a checkout that is not clean", async () => {
    const root = repo("dirty");
    writeFileSync(join(root, "dist/index.html"), "<!doctype html><title>uncommitted</title>");
    const ran = await run([root], { root, port: 1 });
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("the checkout is not clean");
  });

  test("fails with git's words when the base cannot be pulled", async () => {
    const root = repo("nopull");
    const ran = await run([root], { root, port: 1 });
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("git pull --ff-only failed");
  });
});
