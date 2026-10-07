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

import { flowIndex, seats, shedGroups, shedKey, shedKind, type Gate } from "./layout";
import type { Bead, Edge, Yard } from "./yard";

export interface YardEvent {
  seq: number;
  at: string;
  kind: string;
  bead?: string;
  data?: {
    // Of an advance: its stages. Of an edge (dep_added, dep_removed), from
    // is the bead at its other end: the event's own bead waits for it.
    from?: string;
    to?: string;
    outcome?: string;
    group?: string;
    // An alias the snapshot gave it, not the yard's own name.
    session?: string;
    depot?: string;
    type?: string;
    peer?: string;
    // Of a peer message: mail, ping. Of an edge: blocks, parent,
    // discovered-from.
    kind?: string;
    crew?: string;
    // Of a close: merged, a landing. No other reason leaves the yard.
    reason?: string;
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
  // The blocks edges between beads that have not closed: who waits for whom.
  // One whose blocker closed before the window may still be here; it names
  // no open bead, and nothing is drawn for it.
  edges: Edge[];
  // By works (its building's key, as layout.ts gives it), its gate: the runs
  // open on it, and how its last one ended. A works no run was seen at has
  // no entry.
  works: Record<string, Gate>;
}

// What the events do not say and the reducer needs: what a bead is, and how
// its flow runs.
export interface World {
  // Every bead of the window, open or closed, as the snapshot has it.
  cast: Map<string, Bead>;
  // The stage a new bead of this kind stands at.
  first(bead: Bead): string | undefined;
  terminal(bead: Bead, stage: string): boolean;
  // The works a session on the bead at this stage is of, by its building's
  // key: the bead's group when it has one, else the first the stage is routed
  // to, where that is a group of scripts. None at any other stage.
  works(bead: Bead, stage: string): string | undefined;
}

export function world(yard: Yard, log: Log): World {
  const flow = (bead: Bead) => {
    const flows = yard.flows.find((f) => f.depot === bead.depot)?.flows ?? [];
    return flows[flowIndex(flows, bead.type)];
  };
  const scripts = (group: string) => shedKind(yard.groups.find((g) => g.name === group)) === "works";
  return {
    cast: new Map([...log.beads, ...yard.beads].map((b) => [b.id, b])),
    first: (bead) => flow(bead)?.stages[0]?.stage,
    terminal: (bead, stage) => flow(bead)?.stages.find((s) => s.stage === stage)?.terminal === true,
    works: (bead, stage) => {
      const at = flow(bead);
      if (!at) return undefined;
      const routed = shedGroups(yard, bead.depot, at, stage);
      const group = bead.group ?? routed.find(scripts);
      return group !== undefined && routed.includes(group) && scripts(group) ? shedKey(bead.depot, at.name, stage, group) : undefined;
    },
  };
}

// The kinds that end a session without moving the bead. An advance, a hold
// and a close end it too.
const ENDS = new Set(["released", "workspace_removed"]);

// The kinds that are a fault on their bead, each with the fault's kind
// (src/yard.ts). The first six say a session came to no good end, though the
// yard may still list it: its figure sits, and it is not at work. The last
// three are the yard's word on the bead itself, whoever is at it.
export const FAULTS = new Map([
  ["session_stalled", "stalled"],
  ["session_blocked", "blocked"],
  ["session_harness_error", "harness_error"],
  ["session_prompt_gave_up", "prompt_gave_up"],
  ["session_died", "died"],
  ["gave_up", "gave_up"],
  ["move_refused", "move_refused"],
  ["stranded", "stranded"],
  ["unrouted", "unrouted"],
]);

// The kinds the replay shows: step's, and the two that are no state (a peer's
// goods, a hook's flash). Any other kind is passed over.
export const SHOWN = new Set([
  "created",
  "advanced",
  "claimed",
  "started",
  ...ENDS,
  ...FAULTS.keys(),
  "session_unblocked",
  "held",
  "unheld",
  "closed",
  "dep_added",
  "dep_removed",
  "peer_message_sent",
  "peer_message_received",
  "hook",
]);

// The kinds that change what the yard is built of: a depot, a flow, a group,
// a route, a peer, a crew, or a pack that brings any of them. No event
// carries the structure itself, so a page that follows the yard takes a new
// snapshot on these.
export const STRUCTURE = new Set([
  "depot_updated",
  "depot_removed",
  "flow_set",
  "flow_removed",
  "flow_pointer_set",
  "flow_pointer_cleared",
  "group_set",
  "group_removed",
  "route_added",
  "route_removed",
  "peer_added",
  "peer_removed",
  "peer_renamed",
  "crew_defined",
  "crew_deleted",
  "pack_applied",
]);

// Whether an event from the yard's feed names what the snapshot does not
// hold, so that a new one is due: a change of structure, or a bead the cast
// does not know and the event would bring into the picture.
export function outgrown(event: YardEvent, w: World): boolean {
  if (STRUCTURE.has(event.kind)) return true;
  const enters = event.kind === "created" || event.kind === "advanced";
  return enters && event.bead !== undefined && !w.cast.has(event.bead);
}

// A bead as it stands at a stage with nobody on it, and nothing wrong.
function idle(bead: Bead, stage: string): Bead {
  const { group: _group, working: _working, hold: _hold, fault: _fault, ...rest } = bead;
  return { ...rest, stage };
}

// A bead a session starts on: how the one before it ended is over. What the
// yard said of the bead itself stands until the bead moves.
function fresh(bead: Bead): Bead {
  if (!seats(bead.fault)) return bead;
  const { fault: _fault, ...rest } = bead;
  return rest;
}

// A bead before its first move of the window: when it came to stand there is
// not known, so it counts from when it was made.
function unmoved(bead: Bead): Bead {
  const { moved_at: _moved, ...rest } = bead;
  return rest;
}

function without<V>(record: Record<string, V>, key: string): Record<string, V> {
  const { [key]: _gone, ...rest } = record;
  return rest;
}

// The state after one more event. The same state comes back, itself, when
// the event changes nothing: an unknown kind, a bead the snapshot does not
// know, an end of a session that is not the one at work.
export function step(state: State, event: YardEvent, w: World): State {
  return gated(moved(state, event, w), event, w);
}

// The works after an event, given the beads after it. A session that starts
// on a bead at a works' stage opens a run there. The run is over with the
// first event that leaves the bead with nobody at work on it: an advance
// past the buffer or a close as merged is a landing, an advance with the
// outcome failed a gate that failed, and any other end (a hold, a session
// that died, a bead taken back) leaves what the last run said.
function gated(state: State, event: YardEvent, w: World): State {
  const id = event.bead;
  if (id === undefined) return state;
  const bead = state.beads.find((b) => b.id === id);
  const open = Object.keys(state.works).find((key) => state.works[key]!.runs.some((r) => r.bead === id));
  if (event.kind === "started") {
    const key = bead?.working === true ? w.works(bead, bead.stage) : undefined;
    if (key === undefined || open !== undefined) return state;
    const runs = state.works[key]?.runs ?? [];
    return { ...state, works: { ...state.works, [key]: { runs: [...runs, { bead: id, since: event.at }] } } };
  }
  if (open === undefined || bead?.working === true) return state;
  const gate = state.works[open]!;
  const data = event.data ?? {};
  const known = w.cast.get(id);
  const past = event.kind === "advanced" && known !== undefined && data.to !== undefined && w.terminal(known, data.to);
  const landed = past || (event.kind === "closed" && data.reason === "merged");
  const last = landed ? "landed" : event.kind === "advanced" && data.outcome === "failed" ? "failed" : gate.last;
  const runs = gate.runs.filter((r) => r.bead !== id);
  return { ...state, works: { ...state.works, [open]: { runs, ...(last !== undefined ? { last } : {}) } } };
}

// The beads, the sessions and the edges after one more event.
function moved(state: State, event: YardEvent, w: World): State {
  const id = event.bead;
  if (id === undefined) return state;
  const here = state.beads.find((b) => b.id === id);
  const others = () => state.beads.filter((b) => b.id !== id);
  const put = (bead: Bead, session?: string): State => ({
    ...state,
    beads: here ? state.beads.map((b) => (b.id === id ? bead : b)) : [...state.beads, bead],
    sessions: session !== undefined ? { ...state.sessions, [id]: session } : without(state.sessions, id),
  });
  const gone = (): State => (here ? { ...state, beads: others(), sessions: without(state.sessions, id) } : state);
  const data = event.data ?? {};

  switch (event.kind) {
    case "created": {
      const known = w.cast.get(id);
      const first = known && w.first(known);
      if (here || !known || first === undefined) return state;
      // The cast has it as it is at the window's end: it has not moved yet.
      return put(idle(unmoved(known), first));
    }
    case "advanced": {
      // A bead the state lost sight of comes back where it arrives.
      const bead = here ?? w.cast.get(id);
      if (!bead || data.to === undefined) return state;
      // Past the buffer: it is out of the picture before it is closed.
      if (w.terminal(bead, data.to)) return gone();
      const at = { ...idle(bead, data.to), moved_at: event.at };
      // Sent on with another outcome than done: the session did not end
      // well, and the bead says so where it arrives, with the group it left.
      if (data.outcome === undefined || data.outcome === "done") return put(at);
      const group = data.group ?? bead.group;
      return put({ ...at, ...(group !== undefined ? { group } : {}), fault: { kind: `ended_${data.outcome}`, at: event.at } });
    }
    case "claimed":
      if (!here) return state;
      return put({ ...fresh(here), working: true, ...(data.group !== undefined ? { group: data.group } : {}) }, data.session);
    case "started":
      // The claim came first and said the same, unless the window began
      // between the two.
      if (!here || here.working === true) return state;
      return put({ ...fresh(here), working: true }, data.session);
    case "session_unblocked":
      // Someone answered what it asked: it is at work again.
      if (!here || here.fault?.kind !== "blocked") return state;
      return put({ ...fresh(here), working: true }, data.session);
    case "held":
      if (!here) return state;
      return put({ ...here, working: false, hold: true });
    case "unheld":
      if (!here || here.hold !== true) return state;
      return put({ ...here, hold: false }, state.sessions[id]);
    case "closed": {
      // Nothing waits for a closed bead any more, and it waits for nothing.
      // Its wagon may have left before: past the buffer it is not closed yet.
      const left = gone();
      const edges = left.edges.filter((e) => e.from !== id && e.to !== id);
      return edges.length === left.edges.length ? left : { ...left, edges };
    }
    case "dep_added":
    case "dep_removed": {
      // Only a blocks edge is a wait. The event's bead is the one that waits.
      const from = data.from;
      if (data.kind !== "blocks" || from === undefined || !w.cast.has(id)) return state;
      const has = state.edges.some((e) => e.from === from && e.to === id);
      if (has === (event.kind === "dep_added")) return state;
      return { ...state, edges: has ? state.edges.filter((e) => e.from !== from || e.to !== id) : [...state.edges, { from, to: id }] };
    }
    default: {
      if (!here) return state;
      const at = state.sessions[id];
      const old = data.session !== undefined && at !== undefined && data.session !== at;
      const kind = FAULTS.get(event.kind);
      if (kind !== undefined) {
        const fault = { kind, at: event.at };
        // The bead's own: whoever is at it stays at it.
        if (!seats(fault)) return put({ ...here, fault }, at);
        if (old) return state;
        const group = here.group ?? data.group;
        return put({ ...here, working: false, ...(group !== undefined ? { group } : {}), fault });
      }
      if (!ENDS.has(event.kind) || here.working !== true || old) return state;
      return put({ ...here, working: false });
    }
  }
}

// The edges at the window's start, read off the window as the beads are: one
// the window first adds was not there yet, one it first removes was, and any
// other is as the snapshot has it.
function waits(yard: Yard, log: Log): Edge[] {
  const edges = new Map<string, Edge>((yard.edges ?? []).map((e) => [`${e.from}>${e.to}`, e]));
  const there = new Map<string, boolean>();
  for (const { kind, bead, data } of log.events) {
    if ((kind !== "dep_added" && kind !== "dep_removed") || data?.kind !== "blocks" || data.from === undefined || bead === undefined) continue;
    const key = `${data.from}>${bead}`;
    if (there.has(key)) continue;
    there.set(key, kind === "dep_removed");
    edges.set(key, { from: data.from, to: bead });
  }
  return [...edges].filter(([key]) => there.get(key) ?? true).map(([, e]) => e);
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
  for (const known of w.cast.values()) {
    const events = of.get(known.id) ?? [];
    const bead = events.some((e) => e.kind === "advanced") ? unmoved(known) : known;
    if (events.some((e) => e.kind === "created")) continue;
    // A bead closed since was there only if the window saw it close.
    if (!open.has(bead.id) && !events.some((e) => e.kind === "closed")) continue;
    const moved = events.find((e) => e.kind === "advanced" && e.data?.from !== undefined);
    const stage = moved?.data?.from ?? bead.stage;
    if (w.terminal(bead, stage)) continue;

    // Who had it: what it is now when nothing happened to it since, else
    // the group its first move names as the one it left, when that move
    // comes before any claim.
    const first = events.find(
      (e) => ["claimed", "started", "advanced", "held", "closed", "session_unblocked"].includes(e.kind) || ENDS.has(e.kind) || FAULTS.has(e.kind),
    );
    const held = events.find((e) => e.kind === "held" || e.kind === "unheld");
    const hold = held ? held.kind === "unheld" : bead.hold === true;
    // A fault is the snapshot's only when the window did nothing to the bead:
    // what it had before the first event that set or cleared one is not known.
    const at = idle(bead, stage);
    if (first === undefined) {
      beads.push({ ...bead, stage });
    } else if (first.kind === "advanced" && first.data?.group !== undefined && !hold) {
      beads.push({ ...at, group: first.data.group, working: true });
    } else {
      beads.push(hold ? { ...at, hold } : at);
    }
  }
  // A works whose session was at it when the window began: since when is not
  // known, and neither is how the run before it ended.
  const works: Record<string, Gate> = {};
  for (const bead of beads) {
    const key = bead.working === true ? w.works(bead, bead.stage) : undefined;
    if (key !== undefined) works[key] = { runs: [...(works[key]?.runs ?? []), { bead: bead.id }] };
  }
  return { beads, sessions: {}, edges: waits(yard, log), works };
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
  else if (event.kind.startsWith("dep_") && from !== undefined) parts.push(kind === "blocks" ? `waits for ${from}` : `${kind ?? "edge"} ${from}`);
  else if (event.kind === "claimed" && group !== undefined) parts.push(group);
  else if (event.kind === "hook" && type !== undefined) parts.push(type);
  return parts.join(" · ");
}
