// The serve script's routes (scripts/serve.mjs), over a real socket on a free
// loopback port, with a yard whose web view is a fetch in this file.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { FAULT_BYTES, FAULT_EVERY, QUOTA_EVERY, fault, layoutFile, recall, remember, routes } from "../scripts/serve.mjs";
import { bead, follow, head, quota, snapshot, yardr } from "../scripts/yard.mjs";

const dir = mkdtempSync(join(tmpdir(), "signalbox-"));
const root = join(dir, "dist");
mkdirSync(root);
writeFileSync(join(root, "index.html"), "<!doctype html><title>signalbox</title>");
writeFileSync(join(dir, "outside.txt"), "not the page's");
afterAll(() => rmSync(dir, { recursive: true }));

const event = (seq) => ({ seq, at: new Date(Date.UTC(2099, 0, 1, 0, 0, seq)).toISOString(), kind: "advanced", bead: "signalbox-a", data: { from: "new", to: "review" } });
const span = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => event(from + k));

// What the view sends with an event, and the page is not to get.
const SECRET = "/Users/someone/.yardr/secret";

// A yard, as its web view answers (yardr web serve): its lists as JSON, each
// with the yard's head, and its log as a stream. fetch stands in for the
// view; asked is every route it was asked for. push is the yard doing
// something, stop the view going away under its open streams, and down a
// view that is not there.
function yard(events) {
  const structure = { depots: [{ name: "signalbox", kind: "git" }], flows: [{ name: "signalbox", kind: "git", flows: [{ name: "default", stages: [{ stage: "new" }, { stage: "review" }] }] }] };
  const y = { events, structure, asked: [], streams: new Set(), down: false, open: [], closed: [], deps: [], pages: {} };
  const lists = {
    "/depots": () => ({ depots: structure.depots }),
    "/flows": () => ({ depots: structure.flows }),
    "/groups": () => ({ groups: [] }),
    "/routes": () => ({ routes: [] }),
    "/crew": () => ({ crew: [] }),
    "/peers": () => ({ peers: [] }),
    "/beads": () => ({ beads: y.open }),
    "/beads?all=1": () => ({ all: true, beads: [...y.open, ...y.closed] }),
    "/sessions?all=1": () => ({ sessions: [], manual: [], list: [] }),
    "/deps": () => ({ deps: y.deps }),
  };
  const top = () => events.at(-1)?.seq ?? 0;
  const text = new TextEncoder();
  const sent = (e) => text.encode(`id: ${e.seq}\ndata: ${JSON.stringify({ ...e, id: String(e.seq), actor: SECRET })}\n\n`);
  y.fetch = async (url, { headers = {}, signal } = {}) => {
    const { pathname, search, searchParams } = new URL(url);
    y.asked.push(pathname + search);
    if (y.down) throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:8791") });
    if (pathname === "/events") {
      const after = Number(searchParams.get("after"));
      let stream;
      const body = new ReadableStream({
        start(controller) {
          stream = controller;
          y.streams.add(stream);
          // As the view opens a stream: when to come back, and a comment.
          controller.enqueue(text.encode("retry: 500\n\n: the yard\n\n"));
          for (const e of events) if (e.seq > after) controller.enqueue(sent(e));
          signal?.addEventListener("abort", () => {
            if (y.streams.delete(stream)) controller.error(signal.reason);
          });
        },
        cancel: () => void y.streams.delete(stream),
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
    if (!String(headers.accept).includes("application/json")) return new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
    if (pathname.startsWith("/beads/")) {
      const page = y.pages[pathname.slice("/beads/".length)];
      if (page === undefined) return Response.json({ error: `bead ${pathname.slice("/beads/".length)}: not found` }, { status: 404 });
      return Response.json({ ...page, head: top() });
    }
    const list = lists[pathname + search];
    if (list === undefined) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ ...list(), head: top() });
  };
  y.push = (...more) => {
    events.push(...more);
    for (const stream of y.streams) for (const e of more) stream.enqueue(sent(e));
  };
  y.stop = () => {
    for (const stream of y.streams) stream.close();
    y.streams.clear();
  };
  // The questions the routes ask of it (scripts/yard.mjs), over that fetch.
  const run = yardr("http://yard", y.fetch);
  return Object.assign(y, { run, snapshot: () => snapshot(run), bead: (id) => bead(run, id), head: () => head(run), follow: (after, signal) => follow(run, after, signal) });
}

// Wait until something is so: the script's line to the view is its own.
async function until(so) {
  for (let n = 0; n < 500; n++) {
    if (so()) return;
    await new Promise((go) => setTimeout(go, 5));
  }
  throw new Error("it never was");
}

// What goes to the terminal while a test runs.
async function terminal(during) {
  const said = [];
  const error = console.error;
  console.error = (line) => said.push(line);
  try {
    await during(said);
  } finally {
    console.error = error;
  }
  return said;
}

const running = [];
// The script, started: on 127.0.0.1 and a free port, never a fixed one.
async function start(of, options = {}) {
  // A line that ended is tried again at once, as tests go.
  const served = routes({ yard: of, root, retry: 10, ...options });
  const server = createServer(served.handle);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const stop = async () => {
    served.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  };
  running.push(stop);
  return { ...served, url: `http://127.0.0.1:${server.address().port}`, stop };
}
afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

// A page on the feed: the messages it got so far, and next() for one more.
async function listen(url, headers = {}) {
  const abort = new AbortController();
  const response = await fetch(url, { headers, signal: abort.signal });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  const messages = [];
  const next = async () => {
    for (;;) {
      const end = text.indexOf("\n\n");
      if (end >= 0) {
        const block = text.slice(0, end);
        text = text.slice(end + 2);
        const field = (name) => block.split("\n").find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2);
        // The retry line and comments are no messages.
        if (field("data") === undefined) continue;
        const message = { id: Number(field("id")), event: field("event") ?? "message", data: JSON.parse(field("data")) };
        messages.push(message);
        return message;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("the feed ended");
      text += value;
    }
  };
  const take = async (n) => {
    const out = [];
    while (out.length < n) out.push(await next());
    return out;
  };
  return { response, messages, next, take, close: () => abort.abort() };
}

describe("the feed", () => {
  test("every event after the one asked for, each one message with its seq as the id", async () => {
    const y = yard(span(1, 5));
    const s = await start(y);
    const page = await listen(`${s.url}/api/feed?after=2`);
    expect(page.response.headers.get("content-type")).toBe("text/event-stream");
    const got = await page.take(3);
    expect(got.map((m) => m.id)).toEqual([3, 4, 5]);
    // Cut down: what the view sent beside is not passed on.
    expect(got.map((m) => m.data)).toEqual(span(3, 5));
    // What the yard does next comes as it happens, and nothing twice.
    y.push(...span(6, 7));
    expect((await page.take(2)).map((m) => m.id)).toEqual([6, 7]);
    y.push(event(8));
    expect((await page.next()).id).toBe(8);
    expect(page.messages.map((m) => m.id)).toEqual([3, 4, 5, 6, 7, 8]);
    // Asked of the view's stream, after the page's place, and of nothing else.
    expect(y.asked).toEqual(["/events?format=json&after=2"]);
    page.close();
  });

  test("a page that names no place follows from now", async () => {
    const y = yard(span(1, 5));
    const s = await start(y);
    const page = await listen(`${s.url}/api/feed`);
    await until(() => y.streams.size === 1);
    // Now is the yard's head, and the stream is asked for what comes after.
    expect(y.asked.at(-1)).toBe("/events?format=json&after=5");
    y.push(event(6));
    expect((await page.next()).id).toBe(6);
    expect(page.messages).toHaveLength(1);
    page.close();
  });

  test("a reconnect after the script is restarted misses nothing", async () => {
    const y = yard(span(1, 5));
    const first = await start(y);
    const before = await listen(`${first.url}/api/feed?after=3`);
    expect((await before.take(2)).map((m) => m.id)).toEqual([4, 5]);
    // The script goes down. The yard does not.
    await first.stop();
    await expect(before.next()).rejects.toThrow();
    y.push(...span(6, 9));
    // A new script knows nothing of the page: the page says where it was,
    // as server-sent events do, and that counts over the address it asks.
    const second = await start(y);
    y.push(event(10));
    const after = await listen(`${second.url}/api/feed?after=3`, { "last-event-id": String(before.messages.at(-1).id) });
    expect((await after.take(5)).map((m) => m.id)).toEqual([6, 7, 8, 9, 10]);
    expect([...before.messages, ...after.messages].map((m) => m.id)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    after.close();
  });

  test("each listener gets what is new to it, over one line to the view", async () => {
    const y = yard(span(1, 5));
    const s = await start(y);
    const near = await listen(`${s.url}/api/feed?after=4`);
    expect((await near.next()).id).toBe(5);
    // One that is behind the line: the line starts again from its place,
    // and the one that was there gets nothing twice.
    const far = await listen(`${s.url}/api/feed?after=0`);
    expect((await far.take(5)).map((m) => m.id)).toEqual([1, 2, 3, 4, 5]);
    // One that is ahead of it waits for its own.
    const ahead = await listen(`${s.url}/api/feed?after=6`);
    y.push(...span(6, 7));
    expect((await far.take(2)).map((m) => m.id)).toEqual([6, 7]);
    expect((await near.take(2)).map((m) => m.id)).toEqual([6, 7]);
    expect((await ahead.next()).id).toBe(7);
    expect(near.messages.map((m) => m.id)).toEqual([5, 6, 7]);
    expect(ahead.messages).toHaveLength(1);
    expect(y.streams.size).toBe(1);
    expect(y.asked).toEqual(["/events?format=json&after=4", "/events?format=json&after=0"]);
    // The last one leaves: no line is held open for nobody.
    far.close();
    near.close();
    ahead.close();
    await until(() => y.streams.size === 0);
  });

  test("a page far behind gets every event the view still has", async () => {
    const y = yard(span(1, 450));
    const s = await start(y);
    const page = await listen(`${s.url}/api/feed?after=10`);
    expect((await page.take(440)).map((m) => m.id)).toEqual(span(11, 450).map((e) => e.seq));
    expect(page.messages.every((m) => m.event === "message")).toBe(true);
    page.close();
  });

  test("the view is stopped and started under an open page: no event is lost, and none comes twice", async () => {
    const y = yard(span(1, 2));
    const s = await start(y);
    const page = await listen(`${s.url}/api/feed?after=1`);
    const said = await terminal(async () => {
      expect((await page.next()).id).toBe(2);
      // The view ends its streams and is gone; the yard goes on.
      y.down = true;
      y.stop();
      y.events.push(...span(3, 4));
      await until(() => y.asked.filter((a) => a === "/events?format=json&after=2").length >= 3);
      // It is back: what happened while it was away comes first.
      y.down = false;
      expect((await page.take(2)).map((m) => m.id)).toEqual([3, 4]);
      y.push(event(5));
      expect((await page.next()).id).toBe(5);
    });
    // The page's own line never ended, and it was told nothing but events.
    expect(page.messages.map((m) => m.id)).toEqual([2, 3, 4, 5]);
    // Asked again after the last event passed on, each time.
    expect(new Set(y.asked)).toEqual(new Set(["/events?format=json&after=1", "/events?format=json&after=2"]));
    // Said once on the terminal, not at every try.
    expect(said).toEqual(["signalbox: feed: http://yard/events?format=json&after=2: connect ECONNREFUSED 127.0.0.1:8791"]);
    page.close();
  });

  test("a view that is not there when the page comes leaves the line open", async () => {
    const y = yard(span(1, 2));
    y.down = true;
    const s = await start(y);
    await terminal(async () => {
      const page = await listen(`${s.url}/api/feed?after=1`);
      const nowhere = await listen(`${s.url}/api/feed`);
      await until(() => y.asked.length >= 4);
      y.down = false;
      expect((await page.next()).id).toBe(2);
      // The one that named no place follows from the head it then has.
      await until(() => y.asked.includes("/peers") && y.streams.size === 1);
      y.push(event(3));
      expect((await nowhere.next()).id).toBe(3);
      expect((await page.next()).id).toBe(3);
      expect(nowhere.messages).toHaveLength(1);
      page.close();
      nowhere.close();
    });
  });

  test("what answers on the view's port and is no stream is no feed", async () => {
    const y = yard(span(1, 2));
    const run = yardr("http://yard", async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }));
    await expect(follow(run, 0).next()).rejects.toThrow("http://yard/events?format=json&after=0: not a stream");
    const limit = yardr("http://yard", async () => new Response("too many streams", { status: 503 }));
    await expect(follow(limit, 0).next()).rejects.toThrow("http://yard/events?format=json&after=0: 503");
    // And a stream in pieces, with the line ends a server may send.
    const pieces = ["id: 1\r\nda", `ta: ${JSON.stringify(y.events[0])}\r\n`, "\r\n: quiet\n\nid: 2\ndata:", `${JSON.stringify(y.events[1])}\n\nid: 3\n\n`];
    const text = new TextEncoder();
    const broken = yardr("http://yard", async () => new Response(new ReadableStream({ start: (c) => (pieces.forEach((p) => c.enqueue(text.encode(p))), c.close()) }), { headers: { "content-type": "text/event-stream" } }));
    const got = [];
    for await (const e of follow(broken, 0)) got.push(e);
    expect(got).toEqual(span(1, 2));
  });

  test("after is a sequence number", async () => {
    const s = await start(yard([]));
    for (const after of ["x", "-1", "1.5"]) expect((await fetch(`${s.url}/api/feed?after=${after}`)).status, after).toBe(400);
  });
});

describe("the snapshot", () => {
  test("the yard, its slots and its log in one answer", async () => {
    const y = yard(span(1, 3));
    const s = await start(y, { memory: { depots: { gone: 0, signalbox: 4 } } });
    const response = await fetch(`${s.url}/api/snapshot`);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["layout", "log", "quota", "yard"]);
    // Nobody was given to ask.
    expect(body.quota).toBeNull();
    expect(body.yard.depots).toEqual(y.structure.depots);
    expect(body.log.events).toEqual(span(1, 3));
    // Every list of the view once, and its stream for the window alone.
    expect([...y.asked].sort()).toEqual(["/beads", "/beads?all=1", "/crew", "/depots", "/deps", "/events?format=json&after=0", "/flows", "/groups", "/peers", "/routes", "/sessions?all=1"]);
    expect(y.streams.size).toBe(0);
    // What was placed stays; what is new takes the next free slot, and keeps
    // it in the next answer.
    expect(body.layout.depots).toEqual({ gone: 0, signalbox: 4 });
    expect(body.layout.stages["signalbox/default"]).toEqual({ new: 0, review: 1 });
    y.structure.depots.unshift({ name: "newer", kind: "git" });
    expect((await (await fetch(`${s.url}/api/snapshot`)).json()).layout.depots).toEqual({ gone: 0, signalbox: 4, newer: 5 });
    y.structure.depots.shift();
    expect((await (await fetch(`${s.url}/api/snapshot`)).json()).layout.depots).toEqual({ gone: 0, signalbox: 4, newer: 5 });
  });

  test("the slots are kept in the yard's home", () => {
    expect(layoutFile({ YARDR_HOME: "/a/yard" })).toBe("/a/yard/signalbox/layout.json");
    for (const env of [{}, { YARDR_HOME: "" }]) expect(layoutFile(env)).toBe(join(homedir(), ".yardr", "signalbox", "layout.json"));
  });

  test("a yard not served before is laid out from slot 0, and what it was given is there the next time", async () => {
    const file = join(dir, "fresh-yard", "signalbox", "layout.json");
    const kept = (slots) => remember(file, slots);
    // Neither the file nor its directory is there yet.
    expect(recall(file)).toEqual({});
    const y = yard([]);
    const s = await start(y, { memory: recall(file), remember: kept });
    expect(existsSync(file)).toBe(false);
    const first = (await (await fetch(`${s.url}/api/snapshot`)).json()).layout;
    expect(first.depots).toEqual({ signalbox: 0 });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(first);
    // As the snapshot script writes its own (scripts/slots.mjs).
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(first, null, 2)}\n`);
    await s.stop();

    // Started again, the yard listed in another order: nothing has moved.
    y.structure.depots.unshift({ name: "newer", kind: "git" });
    const again = await start(y, { memory: recall(file), remember: kept });
    expect((await (await fetch(`${again.url}/api/snapshot`)).json()).layout.depots).toEqual({ signalbox: 0, newer: 1 });
    expect(recall(file).depots).toEqual({ signalbox: 0, newer: 1 });
  });

  test("the slots are written when a snapshot added to them, and not otherwise", async () => {
    const y = yard([]);
    const written = [];
    const s = await start(y, { remember: (slots) => written.push(slots) });
    const taken = async () => (await (await fetch(`${s.url}/api/snapshot`)).json()).layout;
    const first = await taken();
    expect(written).toEqual([first]);
    await taken();
    expect(written).toHaveLength(1);
    y.structure.depots.push({ name: "newer", kind: "git" });
    expect(written.at(-1)).not.toEqual(await taken());
    expect(written).toHaveLength(2);
    expect(written[1].depots).toEqual({ signalbox: 0, newer: 1 });
  });

  test("slots that cannot be written do not hold the snapshot, and are written when they can be", async () => {
    const errors = [];
    const said = console.error;
    console.error = (line) => errors.push(line);
    try {
      let full = true;
      const written = [];
      const s = await start(yard([]), {
        remember: (slots) => {
          if (full) throw new Error("no space left on device");
          written.push(slots);
        },
      });
      const response = await fetch(`${s.url}/api/snapshot`);
      expect(response.status).toBe(200);
      const { layout } = await response.json();
      expect(layout.depots).toEqual({ signalbox: 0 });
      expect(errors).toEqual(["signalbox: layout: no space left on device"]);
      full = false;
      await fetch(`${s.url}/api/snapshot`);
      expect(written).toEqual([layout]);
    } finally {
      console.error = said;
    }
  });

  // The script itself, as npm run live starts it, against a yard whose view
  // is a server in this file, on a free loopback port: one depot, and
  // nothing else.
  async function served(home, args = []) {
    const lists = { "/depots": "depots", "/flows": "depots", "/groups": "groups", "/routes": "routes", "/crew": "crew", "/peers": "peers", "/beads": "beads", "/sessions": "list", "/deps": "deps" };
    const view = createServer((req, res) => {
      const { pathname } = new URL(req.url, "http://view");
      const rows = pathname === "/depots" ? [{ name: "papers", kind: "dir" }] : pathname === "/flows" ? [{ name: "papers", kind: "dir", flows: [] }] : [];
      res.writeHead(lists[pathname] === undefined ? 404 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(lists[pathname] === undefined ? { error: "not found" } : { [lists[pathname]]: rows, head: 0 }));
    });
    await new Promise((done) => view.listen(0, "127.0.0.1", done));
    running.push(() => new Promise((done) => view.close(done)));
    // The page it was built with holds another yard's slots.
    const built = join(dir, "built");
    mkdirSync(built, { recursive: true });
    writeFileSync(join(built, "index.html"), "<!doctype html><title>signalbox</title>");
    writeFileSync(join(built, "layout.json"), JSON.stringify({ depots: { aiquokka: 0, signalbox: 1, yardr: 2, "yardr.dev": 3 }, peers: { airy: 0 } }));
    // Nothing of this session's: its yard's view and aiquokka are not asked,
    // and there is no yardr to run: none is on the PATH, and YARDR names one
    // that would say so.
    const env = { PATH: "/usr/bin:/bin", HOME: home, YARDR_HOME: home, YARDR_WEB: `http://127.0.0.1:${view.address().port}`, YARDR: join(dir, "no-such-yardr"), AIQUOKKA: join(dir, "no-such-aiquokka") };
    const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/serve.mjs", import.meta.url)), "--port", "0", "--dir", built, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    const ended = new Promise((done) => child.on("close", (code) => done(code)));
    running.push(async () => {
      child.kill();
      await ended;
    });
    let out = "";
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    const url = await new Promise((done) => {
      child.stdout.on("data", (d) => {
        out += d;
        const at = /http:\/\/127\.0\.0\.1:\d+/.exec(out);
        if (at) done(at[0]);
      });
      void ended.then(() => done(undefined));
    });
    return { url, code: ended, said: () => err };
  }

  test("the script keeps a yard's slots in its home, and reads none from beside the page", async () => {
    const home = join(dir, "home");
    mkdirSync(home);
    const file = join(home, "signalbox", "layout.json");
    const s = await served(home);
    const { layout } = await (await fetch(`${s.url}/api/snapshot`)).json();
    expect(layout.depots).toEqual({ papers: 0 });
    expect(layout.peers).toEqual({});
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(layout);
  });

  test("--layout names another file, and one that is no JSON stops the script as it is", async () => {
    const home = join(dir, "home-other");
    mkdirSync(home);
    const file = join(dir, "other-layout.json");
    writeFileSync(file, JSON.stringify({ depots: { gone: 0 } }));
    const s = await served(home, ["--layout", file]);
    expect((await (await fetch(`${s.url}/api/snapshot`)).json()).layout.depots).toEqual({ gone: 0, papers: 1 });
    expect(recall(file).depots).toEqual({ gone: 0, papers: 1 });
    expect(existsSync(join(home, "signalbox"))).toBe(false);

    writeFileSync(file, "{ half");
    const before = statSync(file).mtimeMs;
    const broken = await served(home, ["--layout", file]);
    expect(broken.url).toBeUndefined();
    expect(await broken.code).toBe(1);
    expect(broken.said()).toContain(file);
    expect(readFileSync(file, "utf8")).toBe("{ half");
    expect(statSync(file).mtimeMs).toBe(before);
  });

  test("a yard that does not answer is an error, without what it said", async () => {
    const y = yard(span(1, 3));
    y.down = true;
    const s = await start(y);
    let response;
    const said = await terminal(async () => (response = await fetch(`${s.url}/api/snapshot`)));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "the yard did not answer" });
    // The terminal has which route it was, and why.
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^signalbox: snapshot: http:\/\/yard\/\S+: connect ECONNREFUSED 127\.0\.0\.1:8791$/);
  });

  test("a view that ends its stream before the yard's head is no snapshot", async () => {
    const y = yard(span(1, 3));
    const whole = y.fetch;
    // The log ends at 2, and the lists say 3.
    y.fetch = async (url, init) => {
      const response = await whole(url, init);
      if (new URL(url).pathname === "/events") y.stop();
      return response;
    };
    y.events.pop();
    const run = yardr("http://yard", async (url, init) => (new URL(url).pathname === "/events" ? y.fetch(url, init) : Response.json({ ...(await (await whole(url, init)).json()), head: 3 })));
    await expect(snapshot(run)).rejects.toThrow("the stream ended before the yard's head, 3");
  });

  test("the window is the events of the yard's newest sequence numbers, read off the stream until its head", async () => {
    const y = yard(span(1, 30));
    const { log } = await snapshot(y.run, 10);
    expect(log.events).toEqual(span(21, 30));
    expect(y.asked).toContain("/events?format=json&after=20");
    // The stream goes on; the snapshot has hung up.
    expect(y.streams.size).toBe(0);
    // A yard nothing has happened in has no stream to read.
    const empty = yard([]);
    expect((await snapshot(empty.run)).log.events).toEqual([]);
    expect(empty.asked.some((a) => a.startsWith("/events"))).toBe(false);
  });
});

describe("the quota", () => {
  const fuel = (used) => ({ taken_at: "2099-01-01T00:00:00Z", providers: [{ key: "claude", name: "Claude", weekly: { used_percent: used } }] });
  // aiquokka: how often it was asked, and a clock the test moves.
  function provider() {
    const p = { asked: 0, used: 10, now: 1_000_000, down: false };
    p.quota = async () => {
      p.asked++;
      if (p.down) throw new Error("/Users/someone/bin/aiquokka --json: not found");
      return fuel(p.used);
    };
    p.clock = () => p.now;
    return p;
  }
  const taken = async (s) => (await (await fetch(`${s.url}/api/snapshot`)).json()).quota;

  test("in the snapshot, and asked once a minute at most, however many ask", async () => {
    const p = provider();
    const s = await start(yard([]), { quota: p.quota, clock: p.clock });
    expect(await Promise.all([taken(s), taken(s), taken(s)])).toEqual([fuel(10), fuel(10), fuel(10)]);
    expect(p.asked).toBe(1);
    p.used = 20;
    p.now += QUOTA_EVERY - 1;
    await s.refuel();
    expect(await taken(s)).toEqual(fuel(10));
    expect(p.asked).toBe(1);
    p.now += 1;
    expect(await taken(s)).toEqual(fuel(20));
    expect(p.asked).toBe(2);
    expect(QUOTA_EVERY).toBeGreaterThanOrEqual(60_000);
  });

  test("on the feed as its own kind of message, with no id: when it was asked again, and for a page that comes later", async () => {
    const y = yard(span(1, 2));
    const p = provider();
    const s = await start(y, { quota: p.quota, clock: p.clock });
    const page = await listen(`${s.url}/api/feed?after=2`);
    // Asked when a listener comes.
    expect(await page.next()).toEqual({ id: Number.NaN, event: "quota", data: fuel(10) });
    p.used = 30;
    await s.refuel();
    p.now += QUOTA_EVERY;
    y.push(event(3));
    await s.refuel();
    const got = await page.take(2);
    expect(got.find((m) => m.event === "quota")).toEqual({ id: Number.NaN, event: "quota", data: fuel(30) });
    // The yard's events keep their numbers: a page comes back after the last.
    expect(got.find((m) => m.event === "message").id).toBe(3);
    expect(p.asked).toBe(2);
    // Another page, within the minute: the last answer, and nobody is asked.
    const later = await listen(`${s.url}/api/feed?after=3`);
    expect(await later.next()).toEqual({ id: Number.NaN, event: "quota", data: fuel(30) });
    expect(p.asked).toBe(2);
    page.close();
    later.close();
  });

  test("no aiquokka: the snapshot and the feed say null, the page is served, and it is asked no more often", async () => {
    const p = provider();
    p.down = true;
    const said = [];
    const error = console.error;
    console.error = (text) => said.push(text);
    try {
      const s = await start(yard([]), { quota: p.quota, clock: p.clock });
      const response = await fetch(`${s.url}/api/snapshot`);
      expect(response.status).toBe(200);
      expect((await response.json()).quota).toBeNull();
      const page = await listen(`${s.url}/api/feed`);
      expect(await page.next()).toEqual({ id: Number.NaN, event: "quota", data: null });
      expect(p.asked).toBe(1);
      p.now += QUOTA_EVERY;
      expect(await taken(s)).toBeNull();
      expect(p.asked).toBe(2);
      // It comes back: the next answer is passed on.
      p.down = false;
      p.now += QUOTA_EVERY;
      expect(await taken(s)).toEqual(fuel(10));
      page.close();
    } finally {
      console.error = error;
    }
    // Said once on the terminal, not once a minute.
    expect(said).toEqual(["signalbox: quota: /Users/someone/bin/aiquokka --json: not found"]);
  });

  test("a provider that hangs does not hold the snapshot: it goes with the last answer", async () => {
    const p = provider();
    let answer;
    const s = await start(yard([]), { quota: () => new Promise((done) => (answer = done)), clock: p.clock, wait: 20 });
    expect(await taken(s)).toBeNull();
    const page = await listen(`${s.url}/api/feed`);
    answer(fuel(40));
    expect(await page.next()).toEqual({ id: Number.NaN, event: "quota", data: fuel(40) });
    expect(await taken(s)).toEqual(fuel(40));
    page.close();
  });

  // aiquokka, as a script that prints what it would.
  function standIn(script) {
    const bin = join(dir, "aiquokka");
    writeFileSync(bin, `#!/bin/sh\n${script}\n`);
    chmodSync(bin, 0o755);
    return bin;
  }

  test("asked of aiquokka --json, cut down; a machine without it is an error", async () => {
    const bin = standIn(`echo "$*" > "${dir}/quota-args"; echo '{"claude":{"provider":"Claude","plan":"max","account":{"email":"someone@secret.example"},"windows":[{"id":"weekly_all","used_percent":55,"resets_at":"2099-01-05T13:00:00Z","duration_seconds":604800}]},"grok":{"error":"no session"}}'`);
    const got = await quota(bin);
    expect(got.providers).toEqual([{ key: "claude", name: "Claude", plan: "max", weekly: { used_percent: 55, resets_at: "2099-01-05T13:00:00Z" } }]);
    expect(Number.isNaN(Date.parse(got.taken_at))).toBe(false);
    expect(readFileSync(join(dir, "quota-args"), "utf8").trim()).toBe("--json");
    await expect(quota(join(dir, "no-such-aiquokka"))).rejects.toThrow("not found");
    await expect(quota(standIn("echo sorry"))).rejects.toThrow("not JSON");
    await expect(quota(standIn("echo no network >&2; exit 1"))).rejects.toThrow("no network");
  });
});

describe("the yard's edges", () => {
  test("asked of the view once, whatever the number of beads: the blocks edges of the open ones", async () => {
    const y = yard([]);
    y.open = Array.from({ length: 20 }, (_, n) => ({ id: `signalbox-${n}`, title: "t", type: "task", stage: "backlog", status: "open", depot: "signalbox", priority: 2 }));
    y.closed = [{ id: "signalbox-done", title: "t", type: "task", stage: "merged", status: "closed", depot: "signalbox", priority: 2 }];
    const edge = (from, to, kind = "blocks") => ({ from, to, kind, created_at: "2099-01-01T00:00:00Z" });
    y.deps = [edge("signalbox-0", "signalbox-1"), edge("signalbox-9", "signalbox-1", "discovered-from"), edge("signalbox-gone", "signalbox-done")];
    const { yard: now } = await snapshot(y.run);
    expect(now.edges).toEqual([{ from: "signalbox-0", to: "signalbox-1" }]);
    expect(y.asked.filter((a) => a.startsWith("/deps"))).toEqual(["/deps"]);
    expect(y.asked).toHaveLength(10);
  });
});

describe("a bead", () => {
  const detail = { bead: { id: "signalbox-a", title: "a", body: "the body" }, notes: [{ author: "signalbox-a-new", at: "2099-01-01T00:00:00Z", text: "built" }] };
  // A yard of one bead, and what it was asked for.
  const one = () => {
    const asked = [];
    const of = { ...yard([]), bead: async (id) => (asked.push(id), id === "signalbox-a" ? detail : undefined) };
    return { asked, of };
  };

  test("the bead with its body and notes", async () => {
    const { of } = one();
    const s = await start(of);
    const response = await fetch(`${s.url}/api/bead/signalbox-a`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual(detail);
  });

  test("an id the yard does not know is not found, and no error", async () => {
    const { of, asked } = one();
    const s = await start(of);
    const response = await fetch(`${s.url}/api/bead/signalbox-zzzz`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
    expect(asked).toEqual(["signalbox-zzzz"]);
  });

  test("what is no id is refused before the yard is asked", async () => {
    const { of, asked } = one();
    const s = await start(of);
    // A flag, a path, another command's words, upper case, nothing at all.
    for (const id of ["--help", "-a", ".x", "a/b", "a%2Fb", "a%20--all", "a;ls", "Signalbox-a", "a$(id)", ""]) {
      const response = await fetch(`${s.url}/api/bead/${id}`);
      expect(response.status, id).toBe(400);
      expect(await response.json(), id).toEqual({ error: "not a bead id" });
    }
    expect(asked).toEqual([]);
    expect((await fetch(`${s.url}/api/bead/signalbox-a`, { method: "POST" })).status).toBe(405);
  });

  test("a yard that does not answer is an error, without what it said", async () => {
    const s = await start({ ...yard([]), bead: async () => Promise.reject(new Error("/Users/someone/.yardr: no yard")) });
    const response = await fetch(`${s.url}/api/bead/signalbox-a`);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "the yard did not answer" });
  });

  test("asked of the view: the page of the bead, its bead and notes cut down", async () => {
    const y = yard([]);
    y.pages["signalbox-a"] = {
      bead: { id: "signalbox-a", title: "a", body: "the body", session: "4wbdbdwypgzzjr5vgfwr", uuid: "u" },
      notes: [{ author: "signalbox-a-new", at: "2099-01-01T00:00:00Z", text: "built", seq: 3 }],
      stage_file: { path: SECRET, text: "a stage" },
      sessions: [{ id: "4wbdbdwypgzzjr5vgfwr", handle: { brief: SECRET } }],
    };
    expect(await bead(y.run, "signalbox-a")).toEqual({
      bead: { id: "signalbox-a", title: "a", working: true, body: "the body" },
      notes: [{ author: "signalbox-a-new", at: "2099-01-01T00:00:00Z", text: "built" }],
    });
    expect(y.asked).toEqual(["/beads/signalbox-a"]);
  });

  test("asked of the view: a bead it does not have is nothing, any other failure an error", async () => {
    const y = yard([]);
    expect(await bead(y.run, "signalbox-zzzz")).toBeUndefined();
    const broken = yardr("http://yard/", async () => Response.json({ error: "mkdir /nowhere: read-only file system" }, { status: 500 }));
    await expect(bead(broken, "signalbox-a")).rejects.toThrow("http://yard/beads/signalbox-a: mkdir /nowhere: read-only file system");
    // Another program on the view's port.
    const other = yardr("http://yard", async () => new Response("<!doctype html>"));
    await expect(bead(other, "signalbox-a")).rejects.toThrow("http://yard/beads/signalbox-a: not JSON");
    const gone = yardr("http://yard", async () => new Response("no such page", { status: 404 }));
    expect(await bead(gone, "signalbox-a")).toBeUndefined();
  });

  test("the view is the one YARDR_WEB names, else yardr web serve's own address, and is asked for JSON", async () => {
    const asked = [];
    const ask = async (url, { headers }) => (asked.push([url, headers.accept]), Response.json({ peers: [], head: 7 }));
    const before = process.env.YARDR_WEB;
    try {
      delete process.env.YARDR_WEB;
      expect(await head(yardr(undefined, ask))).toBe(7);
      process.env.YARDR_WEB = "http://127.0.0.1:9000/";
      await head(yardr(undefined, ask));
    } finally {
      if (before === undefined) delete process.env.YARDR_WEB;
      else process.env.YARDR_WEB = before;
    }
    expect(asked).toEqual([
      ["http://127.0.0.1:8791/peers", "application/json"],
      ["http://127.0.0.1:9000/peers", "application/json"],
    ]);
  });
});

describe("a fault of the page's", () => {
  const said = { at: "2099-01-01T00:00:07.000Z", what: "lost", detail: "GPU process gone", agent: "Mozilla/5.0 (Linux; Android 16; Pixel 10)", screen: "412x915@2.625" };
  const tell = (url, body, more = {}) => fetch(`${url}/api/fault`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), ...more });

  test("is answered with nothing, and written as one line", async () => {
    const s = await start(yard([]));
    let response;
    const lines = await terminal(async () => {
      response = await tell(s.url, said);
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(lines).toEqual(["signalbox: fault lost from Mozilla/5.0 (Linux; Android 16; Pixel 10) 412x915@2.625: GPU process gone at 2099-01-01T00:00:07.000Z"]);
  });

  test("stays one line, whatever the browser sent, and each part has its length", () => {
    const line = fault({ ...said, detail: `first\nsignalbox: fault forged\r\n\u001b[2Jsecond\u2028third ${"x".repeat(5000)}`, agent: "a".repeat(5000) });
    expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(line).toContain(": first signalbox: fault forged [2Jsecond third x");
    expect(line.length).toBeLessThan(1500);
  });

  test("what is no report is refused, and nothing is written", async () => {
    const s = await start(yard([]), { clock: () => 0 });
    const lines = await terminal(async () => {
      // Each on a line of its own: a connection has one report a second.
      const alone = { headers: { connection: "close" } };
      for (const body of ["{", "null", "[]", { ...said, what: "Lost it" }, { ...said, what: undefined }, { ...said, at: "then" }, { ...said, detail: 7 }, { ...said, agent: undefined }, { ...said, screen: {} }]) {
        expect((await tell(s.url, body, alone)).status, JSON.stringify(body)).toBe(400);
      }
      expect((await fetch(`${s.url}/api/fault`)).status).toBe(405);
    });
    expect(lines).toEqual([]);
  });

  test("is 4 KB at most, said or not", async () => {
    const s = await start(yard([]));
    const lines = await terminal(async () => {
      const body = JSON.stringify({ ...said, detail: "x".repeat(FAULT_BYTES) });
      expect((await tell(s.url, body, { headers: { connection: "close" } })).status).toBe(413);
      // A body whose length is not said before it comes.
      const raw = await new Promise((done) => {
        const socket = new Socket();
        let text = "";
        socket.connect(Number(new URL(s.url).port), "127.0.0.1", () => {
          socket.write("POST /api/fault HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n");
          for (let n = 0; n < 5; n++) socket.write(`400\r\n${"x".repeat(1024)}\r\n`);
        });
        socket.on("data", (d) => (text += d));
        socket.on("error", () => done(text));
        socket.on("close", () => done(text));
      });
      expect(raw).toMatch(/^HTTP\/1\.1 413/);
      // The most that is taken.
      const most = { ...said, detail: "" };
      most.detail = "x".repeat(FAULT_BYTES - JSON.stringify(most).length);
      expect((await tell(s.url, most, { headers: { connection: "close" } })).status).toBe(204);
    });
    expect(lines).toHaveLength(1);
  });

  test("one a second from a connection: the rest is dropped", async () => {
    let now = 0;
    const s = await start(yard([]), { clock: () => now });
    // One connection, a request after the other.
    const socket = new Socket();
    let text = "";
    socket.on("data", (d) => (text += d));
    await new Promise((done) => socket.connect(Number(new URL(s.url).port), "127.0.0.1", done));
    const answers = () => [...text.matchAll(/HTTP\/1\.1 (\d+)/g)].map((m) => Number(m[1]));
    const send = async (detail) => {
      const body = JSON.stringify({ ...said, detail });
      const before = answers().length;
      socket.write(`POST /api/fault HTTP/1.1\r\nHost: x\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      await until(() => answers().length > before);
    };
    const lines = await terminal(async () => {
      await send("first");
      now = FAULT_EVERY - 1;
      await send("too soon");
      await send("still too soon");
      now = FAULT_EVERY;
      await send("a second on");
      // Another connection is not held by this one.
      expect((await tell(s.url, { ...said, detail: "another" }, { headers: { connection: "close" } })).status).toBe(204);
    });
    socket.destroy();
    expect(answers()).toEqual([204, 429, 429, 204]);
    expect(lines.map((l) => l.replace(/^.*: (.*) at .*$/, "$1"))).toEqual(["first", "a second on", "another"]);
  });
});

describe("the page", () => {
  test("the built files, and nothing beside them", async () => {
    const s = await start(yard([]));
    const page = await fetch(`${s.url}/`);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await page.text()).toContain("signalbox");
    expect((await fetch(`${s.url}/index.html`)).status).toBe(200);
    expect((await fetch(`${s.url}/missing.json`)).status).toBe(404);
    expect((await fetch(`${s.url}/api/other`)).status).toBe(404);
    // fetch would tidy the dots away: the path as a client can send it.
    for (const path of ["/../outside.txt", "/%2e%2e/outside.txt", "/..%2foutside.txt", "/%"]) {
      const raw = await new Promise((done) => {
        const socket = new Socket();
        let text = "";
        socket.connect(Number(new URL(s.url).port), "127.0.0.1", () => socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
        socket.on("data", (d) => (text += d));
        socket.on("close", () => done(text));
      });
      expect(raw, path).toMatch(/^HTTP\/1\.1 40[04]/);
      expect(raw, path).not.toContain("not the page's");
    }
    expect((await fetch(`${s.url}/api/snapshot`, { method: "POST" })).status).toBe(405);
  });
});
