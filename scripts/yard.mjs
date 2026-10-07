// Ask a yardr yard what the page draws, through its web view (yardr web
// serve): the view's JSON for what the yard is now, its stream for what
// happens. No command of yardr's is run, and its store and socket are never
// touched. What comes back is cut down by src/project.ts, the one place that
// decides which fields are passed on; scripts/snapshot.mjs writes it to files
// and scripts/serve.mjs serves it.
// What is left of the providers' quota is no part of the yard: aiquokka says
// it (quota, below), and it is cut down the same way.
//
// node runs the page's TypeScript as it is: it has only types to strip.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cardOf, eventOf, logOf, quotaOf, yardOf } from "../src/project.ts";

// The window the page replays: the events of the yard's newest 2000 sequence
// numbers, oldest first. A count and not a day: the stream starts after a
// number.
export const WINDOW = 2000;

// Where yardr web serve listens when it is told nothing.
export const WEB = "http://127.0.0.1:8791";

// How long the view has for a list, and for the window of its log.
const PATIENCE = 30_000;

// A session's name on the page: the same for the same session in every
// answer, so a start in the snapshot pairs with its end in the feed, and
// across a restart of the serve script. Not the yard's own name for it.
export function alias(session) {
  return `s${createHash("sha256").update(session).digest("hex").slice(0, 8)}`;
}

// Ask the view for one route and read the JSON it answers. YARDR_WEB names
// the view; ask is fetch, or what stands in for it. run.open asks for a
// stream instead, and gives its body: signal ends it.
export function yardr(web = process.env.YARDR_WEB || WEB, ask = fetch) {
  const at = (route) => `${web.replace(/\/+$/, "")}${route}`;
  const asked = async (route, accept, signal) => {
    let response;
    try {
      response = await ask(at(route), { headers: { accept }, signal });
    } catch (cause) {
      throw new Error(`${at(route)}: ${cause instanceof Error ? (cause.cause?.message ?? cause.message) : cause}`, { cause });
    }
    if (response.ok) return response;
    // The view says what went wrong as JSON, to who asks for JSON.
    const { error } = await response.json().catch(() => ({}));
    throw Object.assign(new Error(`${at(route)}: ${typeof error === "string" ? error : response.status}`), { status: response.status });
  };
  const run = async (route) => {
    const response = await asked(route, "application/json", AbortSignal.timeout(PATIENCE));
    try {
      return await response.json();
    } catch (cause) {
      throw new Error(`${at(route)}: not JSON`, { cause });
    }
  };
  run.open = async (route, signal) => {
    const response = await asked(route, "text/event-stream", signal);
    // Another program on the port, or a page: no stream to read.
    if (!String(response.headers.get("content-type")).startsWith("text/event-stream") || response.body === null) {
      await response.body?.cancel();
      throw new Error(`${at(route)}: not a stream`);
    }
    return response.body;
  };
  return run;
}

// The yard's log after a sequence number, as the view streams it: every
// retained event once and in order, then each one as it happens, for as long
// as the caller reads. Each as the yard has it, not cut down yet. It ends
// when the view does (it was stopped), and whoever reads on asks again after
// the last one it got.
async function* stream(run, after, signal) {
  const body = await run.open(`/events?format=json&after=${after}`, signal);
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  let data = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      text += value;
      const lines = text.split(/\r\n|\n|\r/);
      // The last one may go on in the next piece.
      text = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        // An empty line ends a message. One with no data is a comment, or
        // the stream's word on when to come back.
        if (line !== "" || data.length === 0) continue;
        const said = data.join("\n");
        data = [];
        yield JSON.parse(said);
      }
    }
  } finally {
    // A caller that has enough hangs up.
    await reader.cancel().catch(() => {});
  }
}

// The yard's events after a sequence number, each cut down as the replay
// reads it, for as long as the view streams them: what the serve script's
// feed passes on.
export async function* follow(run, after, signal) {
  for await (const raw of stream(run, after, signal)) yield eventOf(raw, alias);
}

// The yard's newest sequence number: where "from now" is.
export async function head(run) {
  return (await run("/peers")).head;
}

// The window of the log: what the stream carries after head minus n, read
// until it reaches head. The view has no route for a bounded part of the
// log, and the stream alone does not say where the yard's log ends: a list's
// head does.
async function recent(run, top, n) {
  // A yard nothing has happened in.
  if (!(top > 0)) return [];
  const out = [];
  for await (const raw of stream(run, Math.max(0, top - n), AbortSignal.timeout(PATIENCE))) {
    out.push(raw);
    if (raw.seq >= top) return out;
  }
  throw new Error(`the stream ended before the yard's head, ${top}`);
}

const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// The yard now and the window of its log: yard.json and events.json.
export async function snapshot(run, window = WINDOW) {
  const [depots, flows, groups, routes, crew, peers, beads, all, sessions, deps] = await Promise.all([
    run("/depots"),
    run("/flows"),
    run("/groups"),
    run("/routes"),
    run("/crew"),
    run("/peers"),
    // Without all: every open bead.
    run("/beads"),
    // Every bead there ever was: the ones the window names and that have
    // closed since are in no other list.
    run("/beads?all=1"),
    // The ended ones too, every one: how a bead's last session ended is a
    // fault the picture shows, however long ago that was.
    run("/sessions?all=1"),
    // Every edge of the yard, each once.
    run("/deps"),
  ]);
  const events = await recent(run, beads.head, window);
  const taken_at = now();
  return {
    yard: yardOf({ depots: depots.depots, flows: flows.depots, groups: groups.groups, routes: routes.routes, crew: crew.crew, peers: peers.peers, beads: beads.beads, sessions: sessions.list, events, edges: deps.deps }, taken_at),
    log: logOf(taken_at, events, all.beads, alias),
  };
}

// One bead for its card, or nothing when the yard has no bead of that id.
export async function bead(run, id) {
  try {
    return cardOf(await run(`/beads/${encodeURIComponent(id)}`));
  } catch (err) {
    if (err instanceof Error && err.status === 404) return undefined;
    throw err;
  }
}

// What is left of every provider's quota, as aiquokka --json says: quota.json.
// AIQUOKKA names the binary. It asks each provider over the network, so a
// caller asks seldom (scripts/serve.mjs: once a minute). A machine without
// the binary, or one that does not answer in time, is an error; a provider
// that fails alone is left out of the answer.
export function quota(bin = process.env.AIQUOKKA || "aiquokka") {
  return new Promise((resolve, reject) => {
    execFile(bin, ["--json"], { timeout: 45_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${bin} --json: ${err.code === "ENOENT" ? "not found" : stderr.trim() || err.message}`));
      try {
        resolve(quotaOf(JSON.parse(stdout), now()));
      } catch (cause) {
        reject(new Error(`${bin} --json: not JSON`, { cause }));
      }
    });
  });
}
