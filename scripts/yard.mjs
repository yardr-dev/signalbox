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

// How long the view has for a stream's first bytes, and then between two
// writes. A view that accepts and never answers (wedged at startup), or
// answers headers and goes silent without closing, is an error the caller
// asks again, with backoff, not a wait without end. Quiet yards stay: the
// view writes ': still here' every 20s, so every write counts, heartbeat
// or event, and only a silence longer than idle is a wedged view.
export const STREAM_OPEN = 10_000;
export const STREAM_IDLE = 45_000;

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
// the last one it got. wait names how long the view has, first for its
// first bytes (open) and then between two writes (idle); past either the
// stream is an error, and the caller asks again.
async function* stream(run, after, signal, { open = STREAM_OPEN, idle = STREAM_IDLE } = {}) {
  // This try alone is timed out: the caller's signal ends the stream, and a
  // timeout ends the try, takes the question back, and fails it, so a wedged
  // view holds neither the caller nor a connection.
  const attempt = new AbortController();
  const giveUp = () => attempt.abort(signal?.reason);
  signal?.addEventListener("abort", giveUp, { once: true });
  if (signal?.aborted) giveUp();
  const openUntil = performance.now() + open;
  const openingWait = () => Math.max(0, openUntil - performance.now());
  const asked = (waited, what) => {
    let late;
    const ended = new Promise((_, fail) => {
      late = setTimeout(() => (attempt.abort(new Error(what)), fail(new Error(what))), waited);
    });
    return [ended, () => clearTimeout(late)];
  };
  try {
    const [opening, opened] = asked(openingWait(), "the stream did not open");
    const body = await Promise.race([run.open(`/events?format=json&after=${after}`, attempt.signal), opening]).finally(opened);
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    let data = [];
    let id;
    // Until the first write the stream is still opening.
    let first = true;
    try {
      for (;;) {
        const [silent, heard] = asked(first ? openingWait() : idle, first ? "the stream did not open" : "the stream went silent");
        let read;
        try {
          read = await Promise.race([reader.read(), silent]);
        } finally {
          heard();
        }
        first = false;
        const { value, done } = read;
        if (done) return;
        text += value;
        const lines = text.split(/\r\n|\n|\r/);
        // The last one may go on in the next piece.
        text = lines.pop();
        for (const line of lines) {
          if (line.startsWith("id:")) id = line.slice(3).replace(/^ /, "");
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
          // An empty line ends a message. One with no data is a comment, the
          // stream's word on when to come back, or an id alone: the yard's
          // word that the cursor passes an event the reader is not told.
          if (line !== "") continue;
          if (data.length > 0) {
            const said = data.join("\n");
            data = [];
            id = undefined;
            yield JSON.parse(said);
          } else if (id !== undefined) {
            const seq = Number(id);
            id = undefined;
            if (Number.isInteger(seq)) yield { seq, untold: true };
          }
        }
      }
    } finally {
      // A caller that has enough hangs up.
      await reader.cancel().catch(() => {});
    }
  } finally {
    signal?.removeEventListener("abort", giveUp);
  }
}

// The yard's events after a sequence number, each cut down as the replay
// reads it, for as long as the view streams them: what the serve script's
// feed passes on. wait bounds the stream as stream's does.
export async function* follow(run, after, signal, wait) {
  for await (const raw of stream(run, after, signal, wait)) {
    // An id alone makes no event.
    if (raw.untold) continue;
    yield eventOf(raw, alias);
  }
}

// The yard's newest sequence number: where "from now" is. From /depots:
// every list answer carries the yard's head, and /peers answers the
// operator alone while this page reads as a visitor.
export async function head(run) {
  return (await run("/depots")).head;
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
    // An id alone makes no event, but counts as reaching that sequence.
    if (raw.untold) {
      if (raw.seq >= top) return out;
      continue;
    }
    out.push(raw);
    if (raw.seq >= top) return out;
  }
  throw new Error(`the stream ended before the yard's head, ${top}`);
}

const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// The yard now and the window of its log: yard.json and events.json. No
// /peers: it answers the operator alone, so the view is handed an empty
// peers list and draws a yard with no peers.
export async function snapshot(run, window = WINDOW) {
  const [depots, flows, groups, routes, crew, beads, all, sessions, deps] = await Promise.all([
    run("/depots"),
    run("/flows"),
    run("/groups"),
    run("/routes"),
    run("/crew"),
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
    yard: yardOf({ depots: depots.depots, flows: flows.depots, groups: groups.groups, routes: routes.routes, crew: crew.crew, peers: [], beads: beads.beads, sessions: sessions.list, events, edges: deps.deps }, taken_at),
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
