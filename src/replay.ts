// The yard at a moment of its day: one pure reducer over its event log.
//
// public/events.json (scripts/snapshot.sh) holds a window of the log, oldest
// first, cut down to what is read here (src/project.ts); the serve script's
// feed carries single events of the same shape. state(yard, log, n) is the open
// beads after the window's first n events, in the shape yard.json lists
// them, so layout.ts draws any moment as it draws the snapshot.
//
// yard.json is the yard at the window's end. The window's start is read off
// the window itself (opening): a bead made in it is not there yet, any other
// stands at the stage its first advance left. So nothing runs backwards, and
// the one thing the snapshot adds is the beads that closed in the window.

import { flowIndex } from "./layout";
import type { Bead, Yard } from "./yard";

export interface YardEvent {
  seq: number;
  at: string;
  kind: string;
  bead?: string;
  data?: {
    // Of an advance.
    from?: string;
    to?: string;
    outcome?: string;
    group?: string;
    // An alias the snapshot gave it, not the yard's own name.
    session?: string;
    depot?: string;
    type?: string;
    peer?: string;
    // Of a peer message: mail, ping.
    kind?: string;
    crew?: string;
  };
}

export interface Log {
  taken_at: string;
  // The beads the window names that are closed now, at their last stage.
  beads: Bead[];
  events: YardEvent[];
}

export interface State {
  // The open beads, as yard.json would list them at that moment.
  beads: Bead[];
  // By bead, the session at work on it, where an event named one: an end
  // that names another session is an old one's and ends nothing.
  sessions: Record<string, string>;
}

// What the events do not say and the reducer needs: what a bead is, and how
// its flow runs.
export interface World {
  // Every bead of the window, open or closed, as the snapshot has it.
  cast: Map<string, Bead>;
  // The stage a new bead of this kind stands at.
  first(bead: Bead): string | undefined;
  terminal(bead: Bead, stage: string): boolean;
}

export function world(yard: Yard, log: Log): World {
  const flow = (bead: Bead) => {
    const flows = yard.flows.find((f) => f.depot === bead.depot)?.flows ?? [];
    return flows[flowIndex(flows, bead.type)];
  };
  return {
    cast: new Map([...log.beads, ...yard.beads].map((b) => [b.id, b])),
    first: (bead) => flow(bead)?.stages[0]?.stage,
    terminal: (bead, stage) => flow(bead)?.stages.find((s) => s.stage === stage)?.terminal === true,
  };
}

// The kinds that end a session without moving the bead. An advance, a hold
// and a close end it too.
const ENDS = new Set(["released", "session_died", "workspace_removed"]);

// The kinds the replay shows: step's, and the two that are no state (a peer's
// goods, a hook's flash). Any other kind is passed over.
export const SHOWN = new Set([
  "created",
  "advanced",
  "claimed",
  "started",
  ...ENDS,
  "held",
  "unheld",
  "closed",
  "peer_message_sent",
  "peer_message_received",
  "hook",
]);

// The kinds that change what the yard is built of: a depot, a flow, a peer,
// a crew, or a pack that brings any of them. No event carries the structure
// itself, so a page that follows the yard takes a new snapshot on these.
// (yardr logs nothing when a group or a route is added by hand.)
export const STRUCTURE = new Set([
  "depot_updated",
  "depot_removed",
  "flow_set",
  "flow_removed",
  "flow_pointer_set",
  "flow_pointer_cleared",
  "peer_added",
  "peer_removed",
  "peer_renamed",
  "crew_defined",
  "crew_deleted",
  "pack_applied",
]);

// Whether an event from the yard's feed names what the snapshot does not
// hold, so that a new one is due: a change of structure, a bead the cast
// does not know and the event would bring into the picture, or a group that
// has no shed yet.
export function outgrown(event: YardEvent, yard: Yard, w: World): boolean {
  if (STRUCTURE.has(event.kind)) return true;
  const enters = event.kind === "created" || event.kind === "advanced";
  if (enters && event.bead !== undefined && !w.cast.has(event.bead)) return true;
  const group = event.kind === "claimed" ? event.data?.group : undefined;
  return group !== undefined && !yard.groups.some((g) => g.name === group);
}

// A bead as it stands at a stage with nobody on it.
function idle(bead: Bead, stage: string): Bead {
  const { group: _group, working: _working, hold: _hold, ...rest } = bead;
  return { ...rest, stage };
}

function without<V>(record: Record<string, V>, key: string): Record<string, V> {
  const { [key]: _gone, ...rest } = record;
  return rest;
}

// The state after one more event. The same state comes back, itself, when
// the event changes nothing: an unknown kind, a bead the snapshot does not
// know, an end of a session that is not the one at work.
export function step(state: State, event: YardEvent, w: World): State {
  const id = event.bead;
  if (id === undefined) return state;
  const here = state.beads.find((b) => b.id === id);
  const others = () => state.beads.filter((b) => b.id !== id);
  const put = (bead: Bead, session?: string): State => ({
    beads: here ? state.beads.map((b) => (b.id === id ? bead : b)) : [...state.beads, bead],
    sessions: session !== undefined ? { ...state.sessions, [id]: session } : without(state.sessions, id),
  });
  const gone = (): State => (here ? { beads: others(), sessions: without(state.sessions, id) } : state);
  const data = event.data ?? {};

  switch (event.kind) {
    case "created": {
      const known = w.cast.get(id);
      const first = known && w.first(known);
      if (here || !known || first === undefined) return state;
      return put(idle(known, first));
    }
    case "advanced": {
      // A bead the state lost sight of comes back where it arrives.
      const bead = here ?? w.cast.get(id);
      if (!bead || data.to === undefined) return state;
      // Past the buffer: it is out of the picture before it is closed.
      if (w.terminal(bead, data.to)) return gone();
      return put(idle(bead, data.to));
    }
    case "claimed":
      if (!here) return state;
      return put({ ...here, working: true, ...(data.group !== undefined ? { group: data.group } : {}) }, data.session);
    case "started":
      // The claim came first and said the same, unless the window began
      // between the two.
      if (!here || here.working === true) return state;
      return put({ ...here, working: true }, data.session);
    case "held":
      if (!here) return state;
      return put({ ...here, working: false, hold: true });
    case "unheld":
      if (!here || here.hold !== true) return state;
      return put({ ...here, hold: false }, state.sessions[id]);
    case "closed":
      return gone();
    default: {
      if (!ENDS.has(event.kind) || !here || here.working !== true) return state;
      const at = state.sessions[id];
      if (data.session !== undefined && at !== undefined && data.session !== at) return state;
      return put({ ...here, working: false });
    }
  }
}

// The yard at the window's start, read off the window: see the top.
export function opening(yard: Yard, log: Log, w: World = world(yard, log)): State {
  const open = new Set(yard.beads.map((b) => b.id));
  const of = new Map<string, YardEvent[]>();
  for (const e of log.events) {
    if (e.bead === undefined) continue;
    of.set(e.bead, [...(of.get(e.bead) ?? []), e]);
  }
  const beads: Bead[] = [];
  for (const bead of w.cast.values()) {
    const events = of.get(bead.id) ?? [];
    if (events.some((e) => e.kind === "created")) continue;
    // A bead closed since was there only if the window saw it close.
    if (!open.has(bead.id) && !events.some((e) => e.kind === "closed")) continue;
    const moved = events.find((e) => e.kind === "advanced" && e.data?.from !== undefined);
    const stage = moved?.data?.from ?? bead.stage;
    if (w.terminal(bead, stage)) continue;

    // Who had it: what it is now when nothing happened to it since, else
    // the group its first move names as the one it left, when that move
    // comes before any claim.
    const first = events.find((e) => ["claimed", "started", "advanced", "held", "closed"].includes(e.kind) || ENDS.has(e.kind));
    const held = events.find((e) => e.kind === "held" || e.kind === "unheld");
    const hold = held ? held.kind === "unheld" : bead.hold === true;
    const at = idle(bead, stage);
    if (first === undefined) {
      beads.push({ ...bead, stage });
    } else if (first.kind === "advanced" && first.data?.group !== undefined && !hold) {
      beads.push({ ...at, group: first.data.group, working: true });
    } else {
      beads.push(hold ? { ...at, hold } : at);
    }
  }
  return { beads, sessions: {} };
}

// The yard after the window's first n events.
export function state(yard: Yard, log: Log, n: number = log.events.length): State {
  const w = world(yard, log);
  return log.events.slice(0, n).reduce((s, e) => step(s, e, w), opening(yard, log, w));
}

// An event in one line, for the bar: kind, bead, from -> to.
export function line(event: YardEvent): string {
  const { from, to, outcome, peer, kind, group, type } = event.data ?? {};
  const parts = [event.kind.replaceAll("_", " ")];
  if (event.bead !== undefined) parts.push(event.bead);
  if (from !== undefined && to !== undefined) parts.push(`${from} -> ${to}${outcome !== undefined ? ` (${outcome})` : ""}`);
  else if (peer !== undefined) parts.push(`${peer}${kind !== undefined ? ` · ${kind}` : ""}`);
  else if (event.kind === "claimed" && group !== undefined) parts.push(group);
  else if (event.kind === "hook" && type !== undefined) parts.push(type);
  return parts.join(" · ");
}
