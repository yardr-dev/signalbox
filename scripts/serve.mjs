#!/usr/bin/env node
// Serve the page and let it follow a yard as it runs.
//
//   node scripts/serve.mjs [--host 127.0.0.1] [--port 0] [--interval 3] [--dir dist]
//   YARDR=/path/to/yardr names the binary, YARDR_HOME the yard, as for the
//   snapshot (scripts/snapshot.sh).
//
// Beside the built page (dist/) it answers three routes, all from the yard's
// own commands (scripts/yard.mjs) and cut down by src/project.ts:
//
//   GET /api/snapshot           the yard now, its slots and the window of its
//                               log: {yard, layout, log}, the three files of
//                               public/ in one answer
//   GET /api/feed?after=<seq>   server-sent events: every event of the yard
//                               after seq, each one message with its seq as
//                               the id, for as long as the page listens
//   GET /api/bead/<id>          one bead for its card (src/card.ts): {bead,
//                               notes}, with the bead's body and its notes;
//                               404 when the yard has no bead of that id
//
// The feed is polled: yardr has no push feed yet. Every interval the newest
// events are asked for once, for all who listen, and each gets what is after
// its own last. A page that reconnects says where it was (Last-Event-ID, as
// server-sent events do by themselves), so nothing is missed, across a
// restart of this script too: the script remembers nothing the page needs.
//
// There is no login. Whoever reaches the port reads what the routes answer,
// so it listens on this machine alone unless --host says otherwise.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { place } from "../src/layout.ts";
import { bead, recent, snapshot, yardr } from "./yard.mjs";

// How many events one poll asks for. More than that in one interval and a
// listener is told to start again from a snapshot.
export const BATCH = 200;

// A bead's id, as the route takes it: it becomes an argument of a command.
// It starts with a letter or a figure, so it is never read as a flag.
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

// The routes as one request handler, and close to end what it holds open.
//   yard      {snapshot(), recent(n), bead(id)}: the yard's answers
//             (scripts/yard.mjs)
//   root      the directory of the built page
//   interval  milliseconds between two polls of the feed
//   memory    the slots given so far (layout.json); what a snapshot adds is
//             remembered while the script runs, so nothing placed moves
export function routes({ yard, root, interval = 3000, memory = {} }) {
  const listeners = new Set();
  let slots = memory;
  let timer;
  let asking = false;

  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  // What the yard's command said goes to the terminal: it may name paths.
  const failed = (what, err) => console.error(`signalbox: ${what}: ${err instanceof Error ? err.message : err}`);

  async function answerSnapshot(res) {
    try {
      const { yard: now, log } = await yard.snapshot();
      slots = place(now, slots);
      json(res, 200, { yard: now, layout: slots, log });
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

  // Give one listener what is new to it, oldest first.
  function deliver(listener, events) {
    const newest = events.at(-1)?.seq ?? 0;
    // No place to go on from: it follows from here.
    if (listener.last === undefined) listener.last = newest;
    const fresh = events.filter((e) => e.seq > listener.last);
    // Everything asked for is new and does not join on to its last: events
    // between the two were not seen. It takes a snapshot and goes on here.
    if (events.length >= BATCH && fresh.length === events.length && events[0].seq > listener.last + 1) {
      listener.last = newest;
      listener.res.write(`event: reset\nid: ${newest}\ndata: {}\n\n`);
      return;
    }
    for (const event of fresh) {
      listener.res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
      listener.last = event.seq;
    }
  }

  async function poll() {
    if (asking) return;
    asking = true;
    try {
      const events = await yard.recent(BATCH);
      for (const listener of listeners) deliver(listener, events);
    } catch (err) {
      failed("feed", err);
      // A comment: the line is alive, the yard did not answer this time.
      for (const listener of listeners) listener.res.write(": the yard did not answer\n\n");
    } finally {
      asking = false;
    }
  }

  function answerFeed(req, res, url) {
    // Where the page was: what it saw last on this feed, else what its
    // snapshot held.
    const said = req.headers["last-event-id"] ?? url.searchParams.get("after");
    const last = said === null || said === "" ? undefined : Number(said);
    if (last !== undefined && !(Number.isSafeInteger(last) && last >= 0)) return json(res, 400, { error: "after: not a sequence number" });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`retry: ${interval}\n\n`);
    const listener = { res, last };
    listeners.add(listener);
    req.on("close", () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        clearInterval(timer);
        timer = undefined;
      }
    });
    timer ??= setInterval(poll, interval);
    // At once: a page that comes back has what it missed before the next poll.
    void poll();
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
    clearInterval(timer);
    timer = undefined;
    for (const listener of listeners) listener.res.end();
    listeners.clear();
  }

  return { handle, close, poll };
}

async function main() {
  const { values } = parseArgs({
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "0" },
      interval: { type: "string", default: "3" },
      dir: { type: "string", default: fileURLToPath(new URL("../dist", import.meta.url)) },
    },
  });
  const interval = Number(values.interval) * 1000;
  const port = Number(values.port);
  const root = resolve(values.dir);
  if (!(interval >= 100) || !Number.isInteger(port) || port < 0) {
    console.error("usage: serve.mjs [--host 127.0.0.1] [--port 0] [--interval seconds, 0.1 or more] [--dir dist]");
    process.exit(2);
  }
  if (!existsSync(join(root, "index.html"))) {
    console.error(`signalbox: no page in ${root}: npm run build writes it`);
    process.exit(1);
  }
  // The slots the snapshot script remembered for the page it built.
  const remembered = join(root, "layout.json");
  const memory = existsSync(remembered) ? JSON.parse(readFileSync(remembered, "utf8")) : {};
  const run = yardr();
  const { handle, close } = routes({ yard: { snapshot: () => snapshot(run), recent: (n) => recent(run, n), bead: (id) => bead(run, id) }, root, interval, memory });

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
