#!/usr/bin/env node
// Serve the page and let it follow a yard as it runs.
//
//   node scripts/serve.mjs [--host 127.0.0.1] [--port 0] [--dir dist] [--layout file]
//   YARDR_WEB=http://127.0.0.1:8791 names the yard's web view (yardr web
//   serve), as for the snapshot (scripts/snapshot.sh);
//   AIQUOKKA=/path/to/aiquokka the binary that says what is left of the
//   providers' quota.
//
// Beside the built page (dist/) it answers three routes, all from the yard's
// web view (scripts/yard.mjs) and cut down by src/project.ts. It starts no
// process of yardr's: it is one more reader of the view's JSON and stream.
//
//   GET /api/snapshot           the yard now, its slots, the window of its
//                               log and the providers' quota: {yard, layout,
//                               log, quota}, the four files of public/ in one
//                               answer; quota is null when nobody knows it
//   GET /api/feed?after=<seq>   server-sent events: every event of the yard
//                               after seq, each one message with its seq as
//                               the id, for as long as the page listens; and
//                               the quota when it was asked again, a message
//                               of the event "quota" with no id
//   GET /api/bead/<id>          one bead for its card (src/card.ts): {bead,
//                               notes}, with the bead's body and its notes;
//                               404 when the yard has no bead of that id
//
// The feed is a relay of the view's stream (/events?format=json): one line
// to the view for all who listen, and each gets what is after its own last.
// A page that reconnects says where it was (Last-Event-ID, as server-sent
// events do by themselves), so nothing is missed, across a restart of this
// script too: the script remembers nothing the page needs. A view that goes
// away is asked again, after the last event it sent, until it is back.
//
// The slots it gives are the yard's, not the built page's: it keeps them in
// a file in the yard's home (layoutFile, below; --layout names another), which
// is not there for a yard it has not served, so that yard is laid out from
// slot 0. The layout.json beside the page is the committed snapshot's, another
// yard's as a rule, and is not read here.
//
// The quota is asked of aiquokka, a call over the network for every provider:
// once a minute at most (QUOTA_EVERY), however many pages ask and listen, and
// not at all while none does. A snapshot in between has the last answer.
//
// There is no login. Whoever reaches the port reads what the routes answer,
// so it listens on this machine alone unless --host says otherwise.
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { place } from "../src/layout.ts";
import { bead, follow, head, quota, snapshot, yardr } from "./yard.mjs";

// The milliseconds before a line that ended is tried again: the page's to
// this script, and this script's to the view.
export const RETRY = 1000;

// The milliseconds between two questions to aiquokka, at least; and how long
// a snapshot waits for the answer before it goes without: the feed has it
// for the page when it comes.
export const QUOTA_EVERY = 60_000;
export const QUOTA_WAIT = 3000;

// A bead's id, as the route takes it: it becomes a part of the path the
// view is asked for, so it has no slash and does not start with a dot.
const ID = /^[a-z0-9][a-z0-9.-]*$/;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain; charset=utf-8",
};

// Where the slots given to a yard are kept: in its home, which YARDR_HOME
// names as it does for yardr, else ~/.yardr. The view does not say where its
// yard's home is, so this is the one thing still read from YARDR_HOME:
// nothing of the yard is asked through it.
export function layoutFile(env = process.env) {
  return join(env.YARDR_HOME || join(homedir(), ".yardr"), "signalbox", "layout.json");
}

// The slots that file holds: none when it is not there yet.
export function recall(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

// Write them, as scripts/slots.mjs writes public/layout.json. Whole or not at
// all: a script that is stopped half-way leaves the file it found.
export function remember(file, slots) {
  mkdirSync(dirname(file), { recursive: true });
  const half = `${file}.${process.pid}.tmp`;
  writeFileSync(half, `${JSON.stringify(slots, null, 2)}\n`);
  renameSync(half, file);
}

// The routes as one request handler, and close to end what it holds open.
//   yard      {snapshot(), bead(id), head(), follow(after, signal)}: the
//             yard's answers (scripts/yard.mjs)
//   root      the directory of the built page
//   retry     milliseconds before a line that ended is tried again
//   memory    the slots given so far (recall); what a snapshot adds is
//             remembered while the script runs, so nothing placed moves
//   remember  keeps the slots when a snapshot added to them, for the next
//             time the script runs; without it they are forgotten then
//   quota     asks what is left of the providers' quota (scripts/yard.mjs);
//             without it nobody asks, and nobody knows
//   clock     the time in milliseconds, to count QUOTA_EVERY by
//   wait      milliseconds a snapshot waits for the quota
export function routes({ yard, root, retry = RETRY, memory = {}, remember, quota, clock = Date.now, wait = QUOTA_WAIT }) {
  const listeners = new Set();
  let slots = memory;
  // What was kept last, as it is written.
  let kept = JSON.stringify(memory);
  let timer;
  // The line to the view, while someone listens: what ends it, the last
  // sequence number it passed, and what went wrong last, said once.
  let line;
  let cursor;
  let cut;
  // The last answer about the quota, null when there was none; when it was
  // asked for; the question on its way; and what went wrong last, said once.
  let fuel = null;
  let fuelled;
  let fuelling;
  let unfuelled;

  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  // What the view said goes to the terminal: it may name paths.
  const failed = (what, err) => console.error(`signalbox: ${what}: ${err instanceof Error ? err.message : err}`);

  // The quota, asked again when the last answer is old enough, and then sent
  // to all who listen. Whoever asks while a question is on its way waits for
  // that one. No answer is null: the levels are not known, and an older
  // answer is not passed off as now's.
  function refuel() {
    if (quota === undefined) return Promise.resolve(fuel);
    if (fuelling !== undefined) return fuelling;
    if (fuelled !== undefined && clock() - fuelled < QUOTA_EVERY) return Promise.resolve(fuel);
    fuelled = clock();
    fuelling = (async () => {
      try {
        fuel = (await quota()) ?? null;
        unfuelled = undefined;
      } catch (err) {
        fuel = null;
        const said = err instanceof Error ? err.message : String(err);
        if (said !== unfuelled) failed("quota", err);
        unfuelled = said;
      }
      fuelling = undefined;
      for (const listener of listeners) listener.res.write(`event: quota\ndata: ${JSON.stringify(fuel)}\n\n`);
      return fuel;
    })();
    return fuelling;
  }

  // Keep the slots when they are not the ones kept last. A file that cannot
  // be written does not hold the page: the slots stand while the script runs,
  // and the next snapshot tries again.
  function keep() {
    const now = JSON.stringify(slots);
    if (remember === undefined || now === kept) return;
    try {
      remember(slots);
      kept = now;
    } catch (err) {
      failed("layout", err);
    }
  }

  async function answerSnapshot(res) {
    try {
      let late;
      // A provider that hangs does not hold the page: it has the last answer.
      const soon = Promise.race([refuel(), new Promise((go) => (late = setTimeout(() => go(fuel), wait)))]);
      const [{ yard: now, log }, left] = await Promise.all([yard.snapshot(), soon]).finally(() => clearTimeout(late));
      slots = place(now, slots);
      keep();
      json(res, 200, { yard: now, layout: slots, log, quota: left });
    } catch (err) {
      failed("snapshot", err);
      json(res, 502, { error: "the yard did not answer" });
    }
  }

  async function answerBead(res, id) {
    // Before anything is run.
    if (!ID.test(id)) return json(res, 400, { error: "not a bead id" });
    try {
      const found = await yard.bead(id);
      if (found === undefined) return json(res, 404, { error: "not found" });
      json(res, 200, found);
    } catch (err) {
      failed(`bead ${id}`, err);
      json(res, 502, { error: "the yard did not answer" });
    }
  }

  // The line to the view: every event after the cursor, to each listener it
  // is new to, for as long as someone listens. The view ends its stream when
  // it is stopped, and refuses one while it is down: either way the line is
  // opened again after the last event it passed, so what happened in between
  // comes first and nothing is passed twice.
  async function relay(signal) {
    while (!signal.aborted) {
      try {
        // A listener that named no place follows from now: the yard's head.
        if (cursor === undefined || [...listeners].some((l) => l.last === undefined)) {
          const now = await yard.head();
          if (signal.aborted) return;
          for (const listener of listeners) listener.last ??= now;
          cursor ??= now;
        }
        for await (const event of yard.follow(cursor, signal)) {
          // Another line has taken over, from another place.
          if (signal.aborted) return;
          cut = undefined;
          cursor = event.seq;
          for (const listener of listeners) {
            if (listener.last === undefined || event.seq <= listener.last) continue;
            listener.res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
            listener.last = event.seq;
          }
        }
      } catch (err) {
        if (signal.aborted) return;
        const said = err instanceof Error ? err.message : String(err);
        if (said !== cut) failed("feed", err);
        cut = said;
        // A comment: the line is alive, the yard did not answer this time.
        for (const listener of listeners) listener.res.write(": the yard did not answer\n\n");
      }
      if (signal.aborted) return;
      await new Promise((go) => {
        const again = setTimeout(go, retry);
        signal.addEventListener("abort", () => (clearTimeout(again), go()), { once: true });
      });
    }
  }

  // Bring the line to where a new listener needs it. One that is at or past
  // the cursor waits for what the line brings anyway. One that is behind it,
  // or names no place, has the line opened again: from its place, which the
  // others have passed and do not get twice.
  function tune(listener) {
    if (line !== undefined && listener.last !== undefined && cursor !== undefined && listener.last >= cursor) return;
    if (listener.last !== undefined && (cursor === undefined || listener.last < cursor)) cursor = listener.last;
    line?.abort();
    line = new AbortController();
    void relay(line.signal);
  }

  // Nobody listens: no line to the view, and no place to keep.
  function hangUp() {
    clearInterval(timer);
    timer = undefined;
    line?.abort();
    line = undefined;
    cursor = undefined;
  }

  function answerFeed(req, res, url) {
    // Where the page was: what it saw last on this feed, else what its
    // snapshot held.
    const said = req.headers["last-event-id"] ?? url.searchParams.get("after");
    const last = said === null || said === "" ? undefined : Number(said);
    if (last !== undefined && !(Number.isSafeInteger(last) && last >= 0)) return json(res, 400, { error: "after: not a sequence number" });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`retry: ${retry}\n\n`);
    const listener = { res, last };
    listeners.add(listener);
    // An answer that came after the page's snapshot went without it. One on
    // its way goes to all who listen when it is there.
    if (fuelled !== undefined && fuelling === undefined) res.write(`event: quota\ndata: ${JSON.stringify(fuel)}\n\n`);
    req.on("close", () => {
      listeners.delete(listener);
      if (listeners.size === 0) hangUp();
    });
    // On its own: the yard's events do not wait for the providers.
    timer ??= setInterval(() => void refuel(), QUOTA_EVERY);
    void refuel();
    tune(listener);
  }

  function answerFile(req, res, url) {
    let path;
    try {
      path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    } catch {
      return json(res, 400, { error: "bad path" });
    }
    // Nothing above the page's own directory.
    if (path !== root && !path.startsWith(root + sep)) return json(res, 404, { error: "not found" });
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
    if (!existsSync(path)) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "content-length": statSync(path).size });
    if (req.method === "HEAD") return res.end();
    createReadStream(path).pipe(res);
  }

  function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://signalbox");
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "GET only" });
    if (url.pathname === "/api/snapshot") return void answerSnapshot(res);
    if (url.pathname === "/api/feed") return answerFeed(req, res, url);
    if (url.pathname.startsWith("/api/bead/")) return void answerBead(res, url.pathname.slice("/api/bead/".length));
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "not found" });
    return answerFile(req, res, url);
  }

  function close() {
    hangUp();
    for (const listener of listeners) listener.res.end();
    listeners.clear();
  }

  return { handle, close, refuel };
}

async function main() {
  const { values } = parseArgs({
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "0" },
      dir: { type: "string", default: fileURLToPath(new URL("../dist", import.meta.url)) },
      layout: { type: "string", default: layoutFile() },
    },
  });
  const port = Number(values.port);
  const root = resolve(values.dir);
  if (!Number.isInteger(port) || port < 0) {
    console.error("usage: serve.mjs [--host 127.0.0.1] [--port 0] [--dir dist] [--layout file]");
    process.exit(2);
  }
  if (!existsSync(join(root, "index.html"))) {
    console.error(`signalbox: no page in ${root}: npm run build writes it`);
    process.exit(1);
  }
  // The slots this yard was given before. A file that is no JSON is left as
  // it is: laying out afresh over it would lose what it held.
  const layout = resolve(values.layout);
  let memory;
  try {
    memory = recall(layout);
  } catch (err) {
    console.error(`signalbox: ${layout}: ${err instanceof Error ? err.message : err}: mend it, or delete it to have the yard laid out afresh`);
    process.exit(1);
  }
  const run = yardr();
  const yard = { snapshot: () => snapshot(run), bead: (id) => bead(run, id), head: () => head(run), follow: (after, signal) => follow(run, after, signal) };
  const { handle, close } = routes({ yard, root, memory, remember: (slots) => remember(layout, slots), quota: () => quota() });

  const server = createServer(handle);
  server.listen(port, values.host, () => {
    const at = server.address();
    const name = at.family === "IPv6" ? `[${at.address}]` : at.address;
    console.log(`signalbox: the yard, live, at http://${name}:${at.port}/`);
    const local = ["127.0.0.1", "::1", "localhost"].includes(values.host);
    if (!local) console.log("signalbox: no login: whoever reaches that address reads the yard's beads, their bodies and notes, its groups and events");
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      close();
      server.close();
      // A page that keeps its line open does not hold the script.
      server.closeAllConnections();
    });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
