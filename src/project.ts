// From what the yard's commands print (yardr ... --json) to what the page
// reads: the one place that decides which fields leave the machine.
//
// The commands also print bead bodies, paths on the machine, secret files and
// process handles. Each shape here is built from the fields it names, so a
// field yardr adds tomorrow is not passed on. scripts/yard.mjs runs the
// commands; the snapshot's files and the serve script's routes both carry
// what these functions return, and nothing else.
//
// No import but types: node runs this file as it is (scripts/).

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

// yard.json: the structure of the yard and its open beads.
export function yardOf(lists: Lists, taken_at: string): Yard {
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
    beads: lists.beads.map((b) =>
      pick(b, ["id", "title", "type", "stage", "depot", "group"], {
        working: b.session !== null && b.session !== undefined,
        ...pick(b, ["hold", "train", "labels", "priority", "created_at"]),
      }),
    ),
  };
  return yard as unknown as Yard;
}

// The names an event's data may carry, each only as a string. An advance
// alone keeps from and to: on other kinds they are people and builds.
const NAMES = ["group", "depot", "type", "peer", "kind", "crew"];
const OF_ADVANCE = ["from", "to", "outcome"];

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
