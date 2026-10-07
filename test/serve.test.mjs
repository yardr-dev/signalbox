// The serve script's routes (scripts/serve.mjs), over a real socket on a free
// loopback port, with a yard that is a list in this file.
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, test } from "vitest";
import { BATCH, QUOTA_EVERY, routes } from "../scripts/serve.mjs";
import { bead, quota, snapshot, yardr } from "../scripts/yard.mjs";

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
    expect(Object.keys(body).sort()).toEqual(["layout", "log", "quota", "yard"]);
    // Nobody was given to ask.
    expect(body.quota).toBeNull();
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
    await s.poll();
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
    // Asked at the first poll, the one a listener starts.
    expect(await page.next()).toEqual({ id: Number.NaN, event: "quota", data: fuel(10) });
    p.used = 30;
    await s.poll();
    p.now += QUOTA_EVERY;
    y.events.push(event(3));
    await s.poll();
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
  test("asked of the yard: dep list for every open bead, and each blocks edge once", async () => {
    const asked = [];
    const open = Array.from({ length: 20 }, (_, n) => ({ id: `signalbox-${n}`, title: "t", type: "task", stage: "backlog", depot: "signalbox", priority: 2 }));
    const edge = { from: "signalbox-0", to: "signalbox-1", kind: "blocks", created_at: "2099-01-01T00:00:00Z" };
    const run = async (...args) => {
      asked.push(args.join(" "));
      if (args[0] === "bead") return open;
      if (args[0] !== "dep") return [];
      if (args[2] === "signalbox-0") return [edge];
      if (args[2] === "signalbox-1") return [edge, { from: "signalbox-9", to: "signalbox-1", kind: "discovered-from" }];
      // A bead with no edge.
      return args[2] === "signalbox-2" ? null : [];
    };
    const { yard } = await snapshot(run);
    expect(yard.edges).toEqual([{ from: "signalbox-0", to: "signalbox-1" }]);
    expect(asked.filter((a) => a.startsWith("dep "))).toEqual(open.map((b) => `dep list ${b.id}`));
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

  // The yard's command, as a stand-in: it prints what yardr prints.
  function standIn(script) {
    const bin = join(dir, `yardr-${Math.random().toString(36).slice(2)}`);
    writeFileSync(bin, `#!/bin/sh\n${script}\n`);
    chmodSync(bin, 0o755);
    return yardr(bin);
  }

  test("asked of the yard: prime's bead and notes, cut down", async () => {
    const run = standIn(`echo "$*" > "${dir}/args"; echo '{"bead":{"id":"signalbox-a","title":"a","body":"the body","session":"4wbdbdwypgzzjr5vgfwr","uuid":"u"},"notes":[{"author":"signalbox-a-new","at":"2099-01-01T00:00:00Z","text":"built","seq":3}],"next":{"source":{"path":"/a/path"}}}'`);
    expect(await bead(run, "signalbox-a")).toEqual({
      bead: { id: "signalbox-a", title: "a", working: true, body: "the body" },
      notes: [{ author: "signalbox-a-new", at: "2099-01-01T00:00:00Z", text: "built" }],
    });
    expect(readFileSync(join(dir, "args"), "utf8").trim()).toBe("prime --bead signalbox-a --json");
  });

  test("asked of the yard: a bead it does not have is nothing, any other failure an error", async () => {
    // yardr says so on stdout, with nothing on stderr.
    const gone = standIn(`echo '{"error":"bead signalbox-zzzz: not found"}'; exit 3`);
    expect(await bead(gone, "signalbox-zzzz")).toBeUndefined();
    const down = standIn(`echo '{"error":"mkdir /nowhere: read-only file system"}'; exit 1`);
    await expect(bead(down, "signalbox-a")).rejects.toThrow("read-only file system");
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
