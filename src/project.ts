// From what the yard's commands print (yardr ... --json) to what the page
// reads: the one place that decides which fields leave the machine.
//
// The commands also print bead bodies, paths on the machine, secret files and
// process handles. Each shape here is built from the fields it names, so a
// field yardr adds tomorrow is not passed on. scripts/yard.mjs runs the
// commands; the snapshot's files and the serve script's routes both carry
// what these functions return, and nothing else. A bead's body and notes
// leave in one answer alone, the card's (cardOf): never in a file.
//
// No import but types: node runs this file as it is (scripts/).

import type { Detail } from "./card";
import type { Log, YardEvent } from "./replay";
import type { Bead, Yard } from "./yard";

// What a command printed: an object of fields nobody has checked yet.
export type Raw = Record<string, unknown>;

// The lists of one yard, each as its command printed it.
export interface Lists {
  depots: Raw[];
  // One entry per depot, in the order of depots: what flow show printed.
  flows: { depot: string; flows: Raw[] }[];
  groups: Raw[];
  routes: Raw[];
  crew: Raw[];
  peers: Raw[];
  // The open beads.
  beads: Raw[];
  // The sessions, ended ones too (session list -a): none for a caller that
  // did not ask.
  sessions?: Raw[];
  // The window of the log (events), in any order: none for a caller that did
  // not ask.
  events?: Raw[];
}

// The named fields of a record that are set: yardr leaves out what is unset,
// and so does the page's shape of it.
function pick(from: Raw, keys: string[], more: Raw = {}): Raw {
  const out: Raw = {};
  for (const key of keys) out[key] = from[key];
  Object.assign(out, more);
  for (const key of Object.keys(out)) if (out[key] === null || out[key] === undefined) delete out[key];
  return out;
}

const list = (value: unknown): Raw[] => (Array.isArray(value) ? (value as Raw[]) : []);
const record = (value: unknown): Raw => (typeof value === "object" && value !== null ? (value as Raw) : {});

// The session states that are no fault: at work, or ended as it should, or
// by a release or a hold, which someone chose. Any other end (died, failed,
// aborted) is one.
const WELL = ["starting", "running", "done", "released", "held"];

// By bead, the fault its last session left: an end that was not well, and
// when, and the group whose session it was: the bead names none any more. A
// bead whose last session went well has none, whatever came before.
function faults(sessions: Raw[]): Map<unknown, Raw> {
  const last = new Map<unknown, Raw>();
  for (const s of sessions) {
    const before = last.get(s.bead);
    if (before === undefined || String(before.started_at) < String(s.started_at)) last.set(s.bead, s);
  }
  const out = new Map<unknown, Raw>();
  for (const [bead, s] of last) {
    if (typeof s.state !== "string" || WELL.includes(s.state)) continue;
    out.set(bead, pick(s, ["group"], { fault: pick({}, [], { kind: s.state, at: s.ended_at ?? s.started_at }) }));
  }
  return out;
}

// By bead, when it last moved to another stage, as far as the window says:
// the time of its last advance there.
function moves(events: Raw[]): Map<unknown, string> {
  const out = new Map<unknown, string>();
  for (const e of events) {
    if (e.kind !== "advanced" || typeof e.at !== "string") continue;
    const before = out.get(e.bead);
    if (before === undefined || before < e.at) out.set(e.bead, e.at);
  }
  return out;
}

// yard.json: the structure of the yard and its open beads.
export function yardOf(lists: Lists, taken_at: string): Yard {
  const fault = faults(lists.sessions ?? []);
  const moved = moves(lists.events ?? []);
  const yard = {
    taken_at,
    depots: lists.depots.map((d) => pick(d, ["name", "kind", "base"])),
    flows: lists.flows.map(({ depot, flows }) => ({
      depot,
      flows: flows.map((f) =>
        pick({}, [], {
          name: record(f.flow).name,
          type: f.type,
          stages: list(f.stages).map((s) => pick(s, ["stage", "group", "next", "human", "terminal"])),
        }),
      ),
    })),
    groups: lists.groups.map((g) => pick(g, ["name", "runner", "limit", "members"])),
    routes: lists.routes.map((r) => pick(r, ["stage", "type", "depot", "label", "group", "priority"])),
    crew: lists.crew.map((c) => pick(c, ["name"], { kind: record(c.config).kind, state: c.state, status: c.status })),
    peers: lists.peers.map((p) => pick(p, ["name", "send", "receive"])),
    beads: lists.beads.map((b) => ({ ...beadOf(b, fault.get(b.id)), ...pick({}, [], { moved_at: moved.get(b.id) }) })),
  };
  return yard as unknown as Yard;
}

// One bead of the snapshot. A session is said to be there, never named.
// left is what its last session left behind (faults), for a caller that
// asked for the sessions.
function beadOf(b: Raw, left: Raw = {}): Raw {
  return pick(b, ["id", "title", "type", "stage", "depot"], {
    // A session at work now is the news, not how the one before it ended.
    ...(b.session !== null && b.session !== undefined ? pick(b, ["group"], { working: true }) : { ...left, ...pick(b, ["group"]), working: false }),
    ...pick(b, ["hold"]),
    ...pick(b, ["train", "labels", "priority", "created_at"]),
  });
}

// One bead for its card (src/card.ts), from what prime --bead printed: the
// snapshot's bead, whether it is closed, when it last changed, its body and
// its notes. A note is its author, time and text; prime also prints the
// flow, the bead's edges and where its flow file lies.
export function cardOf(raw: Raw): Detail {
  const bead = record(raw.bead);
  const detail = {
    bead: { ...beadOf(bead), ...pick(bead, ["status", "updated_at", "body"]) },
    notes: list(raw.notes).map((n) => pick(n, ["author", "at", "text"])),
  };
  return detail as unknown as Detail;
}

// The names an event's data may carry, each only as a string. An advance
// alone keeps from and to: on other kinds they are people and builds.
const NAMES = ["group", "depot", "type", "peer", "kind", "crew"];
const OF_ADVANCE = ["from", "to", "outcome"];
// A close's reason is what somebody wrote, but for the yard's own word for a
// landing: that one is passed on, and no other.
const LANDED = "merged";

// One event, cut down to what the replay reads (src/replay.ts). A session is
// named by the alias the caller gives it, never by the yard's own name: the
// replay only pairs a session's start with its end.
export function eventOf(raw: Raw, alias: (session: string) => string): YardEvent {
  const from = record(raw.data);
  const data: Raw = {};
  for (const key of raw.kind === "advanced" ? [...NAMES, ...OF_ADVANCE] : NAMES) {
    if (typeof from[key] === "string") data[key] = from[key];
  }
  if (typeof from.session === "string") data.session = alias(from.session);
  if (raw.kind === "closed" && from.reason === LANDED) data.reason = LANDED;
  const event = pick(raw, ["seq", "at", "kind", "bead"], { data: Object.keys(data).length > 0 ? data : null });
  return event as unknown as YardEvent;
}

// events.json: a window of the log, oldest first, and the beads it names
// that are closed now, as they were last. all is every bead there ever was:
// the closed ones are in no other list.
export function logOf(taken_at: string, window: Raw[], all: Raw[], alias: (session: string) => string): Log {
  const named = new Set<unknown>(window.map((e) => e.bead).filter((b) => typeof b === "string"));
  const beads = all
    .filter((b) => b.status === "closed" && named.has(b.id))
    .map((b) => pick(b, ["id", "title", "type", "stage", "depot", "train", "labels", "priority", "created_at"]));
  return { taken_at, beads: beads as unknown as Bead[], events: window.map((e) => eventOf(e, alias)) };
}
