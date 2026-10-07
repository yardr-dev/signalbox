// The serve script's routes (scripts/serve.mjs), over a real socket on a free
// loopback port, with a yard that is a list in this file.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { BATCH, routes } from "../scripts/serve.mjs";

const dir = mkdtempSync(join(tmpdir(), "signalbox-"));
const root = join(dir, "dist");
mkdirSync(root);
writeFileSync(join(root, "index.html"), "<!doctype html><title>signalbox</title>");
writeFileSync(join(dir, "outside.txt"), "not the page's");
afterAll(() => rmSync(dir, { recursive: true }));

const event = (seq) => ({ seq, at: new Date(Date.UTC(2099, 0, 1, 0, 0, seq)).toISOString(), kind: "advanced", bead: "signalbox-a", data: { from: "new", to: "review" } });
const span = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => event(from + k));

// A yard: its log, and the two questions the routes ask of it.
function yard(events) {
  const structure = { depots: [{ name: "signalbox", kind: "git" }], flows: [{ depot: "signalbox", flows: [{ name: "default", stages: [{ stage: "new" }, { stage: "review" }] }] }], groups: [], routes: [], crew: [], peers: [] };
  return {
    events,
    structure,
    snapshot: async () => ({ yard: { taken_at: "2099-01-01T00:00:00Z", ...structure, beads: [] }, log: { taken_at: "2099-01-01T00:00:00Z", beads: [], events: [...events] } }),
    recent: async (n) => events.slice(-n),
  };
}

const running = [];
// The script, started: on 127.0.0.1 and a free port, never a fixed one.
async function start(of, options = {}) {
  // An hour: a test polls by hand, when it has changed the yard.
  const served = routes({ yard: of, root, interval: 3600_000, ...options });
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
    expect(got.map((m) => m.data)).toEqual(span(3, 5));
    // What the yard does next comes with the next poll, and nothing twice.
    y.events.push(...span(6, 7));
    await s.poll();
    expect((await page.take(2)).map((m) => m.id)).toEqual([6, 7]);
    await s.poll();
    y.events.push(event(8));
    await s.poll();
    expect((await page.next()).id).toBe(8);
    expect(page.messages.map((m) => m.id)).toEqual([3, 4, 5, 6, 7, 8]);
    page.close();
  });

  test("a page that names no place follows from now", async () => {
    const y = yard(span(1, 5));
    const s = await start(y);
    const page = await listen(`${s.url}/api/feed`);
    y.events.push(event(6));
    // The poll of its arrival may still be on its way: this one comes after.
    await s.poll();
    await s.poll();
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
    y.events.push(...span(6, 9));
    // A new script knows nothing of the page: the page says where it was,
    // as server-sent events do, and that counts over the address it asks.
    const second = await start(y);
    y.events.push(event(10));
    const after = await listen(`${second.url}/api/feed?after=3`, { "last-event-id": String(before.messages.at(-1).id) });
    expect((await after.take(5)).map((m) => m.id)).toEqual([6, 7, 8, 9, 10]);
    expect([...before.messages, ...after.messages].map((m) => m.id)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    after.close();
  });

  test("each listener gets what is new to it", async () => {
    const y = yard(span(1, 5));
    const s = await start(y);
    const far = await listen(`${s.url}/api/feed?after=0`);
    const near = await listen(`${s.url}/api/feed?after=4`);
    expect((await far.take(5)).map((m) => m.id)).toEqual([1, 2, 3, 4, 5]);
    expect((await near.next()).id).toBe(5);
    y.events.push(event(6));
    await s.poll();
    expect((await far.next()).id).toBe(6);
    expect((await near.next()).id).toBe(6);
    far.close();
    near.close();
  });

  test("more than one poll can say: start again from a snapshot, and go on from here", async () => {
    const y = yard(span(1, BATCH + 50));
    const s = await start(y);
    const page = await listen(`${s.url}/api/feed?after=10`);
    expect(await page.next()).toEqual({ id: BATCH + 50, event: "reset", data: {} });
    y.events.push(event(BATCH + 51));
    await s.poll();
    expect(await page.next()).toMatchObject({ id: BATCH + 51, event: "message" });
    // A full batch that joins on to the last one seen is no gap.
    const joined = await listen(`${s.url}/api/feed?after=51`);
    expect((await joined.take(BATCH)).map((m) => m.id)).toEqual(span(52, BATCH + 51).map((e) => e.seq));
    page.close();
    joined.close();
  });

  test("a yard that does not answer leaves the line open", async () => {
    const y = yard(span(1, 2));
    let down = true;
    const s = await start({ ...y, recent: async (n) => (down ? Promise.reject(new Error("/a/path: no yard")) : y.events.slice(-n)) });
    const page = await listen(`${s.url}/api/feed?after=1`);
    await s.poll();
    down = false;
    await s.poll();
    expect((await page.next()).id).toBe(2);
    page.close();
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
    expect(Object.keys(body).sort()).toEqual(["layout", "log", "yard"]);
    expect(body.yard.depots).toEqual(y.structure.depots);
    expect(body.log.events).toEqual(span(1, 3));
    // What was placed stays; what is new takes the next free slot, and keeps
    // it in the next answer.
    expect(body.layout.depots).toEqual({ gone: 0, signalbox: 4 });
    expect(body.layout.stages["signalbox/default"]).toEqual({ new: 0, review: 1 });
    y.structure.depots.unshift({ name: "newer", kind: "git" });
    expect((await (await fetch(`${s.url}/api/snapshot`)).json()).layout.depots).toEqual({ gone: 0, signalbox: 4, newer: 5 });
    y.structure.depots.shift();
    expect((await (await fetch(`${s.url}/api/snapshot`)).json()).layout.depots).toEqual({ gone: 0, signalbox: 4, newer: 5 });
  });

  test("a yard that does not answer is an error, without what it said", async () => {
    const s = await start({ ...yard([]), snapshot: async () => Promise.reject(new Error("/Users/someone/.yardr: no yard")) });
    const response = await fetch(`${s.url}/api/snapshot`);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "the yard did not answer" });
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
