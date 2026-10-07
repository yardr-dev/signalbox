// From a yard's structure to positions on the ground: one pure function.
//
// Every element is placed by its slot in its parent and by constants, never
// by how much else there is: the board of a depot, the track of a flow in its
// depot, the platform of a stage in its flow, the line of a peer; and by its
// index shed n of its stage, bay b of its shed, crew member c. So the same
// structure gives the same picture. Only extents grow: a track's length, a
// board's size.
//
// A slot is given once (place, below) and remembered: public/layout.json
// holds the slots given so far, and an element in that file keeps its slot
// whatever happens around it. So a depot named before an old one, or a
// transition that changes how a flow's stages follow each other, moves
// nothing that was placed; what is new takes the next free slot.
//
// The ground is the x/z plane, in the train kit's units (a wagon is 2.7 long
// and 1.2 wide): x runs along the tracks, to the right; z runs down the page,
// from the top of the yard to its last depot. Negative z is the strip above
// the depots: signal boxes, the telegraph wire, the lines to peers.

import type { Bead, Flow, Group, Yard } from "./yard";

export interface Point {
  x: number;
  z: number;
}

// Along a track.
export const STAGE_PITCH = 12;
export const PLATFORM_LENGTH = 9.4;
// A platform's standing room: three wagons, the first at the front (right).
export const SLOTS = 3;
export const SLOT_PITCH = 2.95;

// Across a track, from its centre line. The far side (negative) is the
// siding's; the near side the platform's and the sheds'.
export const PLATFORM_Z = 1.4;
export const SHED_Z = 3.4;
export const SIDING_Z = -2.6;
export const SIDING_PLATFORM_Z = -4.1;
export const SIDING_SHED_Z = -6;
// The return line: where a wagon sent back runs, between the main line and
// the sidings' stubs. It is a way and no rail: nothing is laid there.
export const RETURN_Z = -1.3;

// A shed: bays in rows of three, at most six drawn (the limit is in its
// label), so two sheds fit beside one platform.
export const BAY_COLUMNS = 3;
export const BAYS_DRAWN = 6;
export const BAY_WIDTH = 1.2;
export const BAY_DEPTH = 1.8;
export const SHED_PITCH = 5;

// Down the page. A board has room for three flows whatever it holds (the
// default, the trains', the wagons'), so a flow added to a depot moves no
// board below it; a fourth flow would run under the next board.
export const FLOW_PITCH = 12.5;
export const FLOWS_PER_BOARD = 3;
export const BOARD_HEAD = 4;
export const FIRST_TRACK_Z = BOARD_HEAD + 7.5;
export const DEPOT_PITCH = BOARD_HEAD + FLOWS_PER_BOARD * FLOW_PITCH + 2.5;
// Left of stage 0: the board's edge, with room for the flow's name.
export const BOARD_X = -16;

// The strip above the depots.
export const CREW_Z = -7;
export const CREW_PITCH = 10;
export const WIRE_Z = -12;
export const PEER_Z = -17;
export const PEER_PITCH = 4;
// A peer's line has a rail each way, this far either side of its middle:
// goods out and goods in pass each other.
export const PEER_RAIL_Z = 0.75;
// A peer's line runs on past any yard's right edge.
export const PEER_LENGTH = 600;

export interface Board {
  key: string;
  depot: string;
  // Its top left corner.
  at: Point;
  width: number;
  depth: number;
}

export interface Track {
  key: string;
  depot: string;
  flow: string;
  type?: string;
  // Its left end, on the centre line; it runs to the right.
  at: Point;
  length: number;
}

export interface Platform {
  key: string;
  depot: string;
  flow: string;
  stage: string;
  // Its centre.
  at: Point;
  // Where a wagon in slot 0 stands; slot s is s * SLOT_PITCH to the left.
  front: Point;
  // Off the main line: only a person moves a bead on from here.
  siding: boolean;
  terminal: boolean;
  // A review stage carries a signal.
  signal: boolean;
}

export interface Bay {
  key: string;
  at: Point;
  // The bead its crew is out working.
  crew?: Bead;
}

export interface Shed {
  key: string;
  group: string;
  platform: string;
  // The centre of bay 0.
  at: Point;
  // Which way on z leads away from the track: where further rows of bays go.
  away: 1 | -1;
  // A group of people has a station building and no bays.
  people: boolean;
  limit: number;
  bays: Bay[];
}

// A session at work: the crew of a bay, out beside the wagon it works.
export interface Crew {
  key: string;
  bead: Bead;
  // Its bay, where it comes from and goes back to.
  home: Point;
  // Which way on z its bay faces away from the track.
  away: 1 | -1;
  // Where it stands: on the platform beside its wagon, or in its bay when
  // the wagon is not drawn.
  at: Point;
  out: boolean;
}

// A bead on a track: a wagon, or the locomotive of a train.
export interface Vehicle {
  key: string;
  bead: Bead;
  kind: "wagon" | "locomotive";
  platform: string;
  at: Point;
}

// What a platform holds beyond what is drawn.
export interface Count {
  key: string;
  platform: string;
  at: Point;
  more: number;
  of: "beads" | "wagons" | "trains";
}

export interface SignalBox {
  key: string;
  name: string;
  at: Point;
}

export interface PeerLine {
  key: string;
  name: string;
  at: Point;
  length: number;
}

export interface Layout {
  boards: Board[];
  tracks: Track[];
  // The stub a siding's wagons stand on, left end first.
  sidings: Track[];
  platforms: Platform[];
  sheds: Shed[];
  crews: Crew[];
  vehicles: Vehicle[];
  counts: Count[];
  boxes: SignalBox[];
  peers: PeerLine[];
  // The telegraph wire: its left end and its length.
  wire: { at: Point; length: number };
}

// The slots given so far, by name: what public/layout.json holds. A slot is
// a place in a row (board 2, platform 4), not a position.
export interface Slots {
  depots: Record<string, number>;
  // By depot, then by flow.
  flows: Record<string, Record<string, number>>;
  // By `${depot}/${flow}`, then by stage.
  stages: Record<string, Record<string, number>>;
  peers: Record<string, number>;
}

// The stages of a flow in the order a bead travels them: breadth first along
// the transitions from the first stage, then what no transition reaches, then
// the terminal stages, so the track ends where a bead does. A siding has its
// place in this order too: it stands off the line, beside that place.
export function travelOrder(flow: Flow): string[] {
  const known = new Map(flow.stages.map((s) => [s.stage, s]));
  const seen = new Set<string>();
  const queue = flow.stages.slice(0, 1).map((s) => s.stage);
  for (let q = 0; q < queue.length; q++) {
    const name = queue[q]!;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const next of known.get(name)?.next ?? []) {
      if (known.has(next) && !seen.has(next)) queue.push(next);
    }
  }
  const order = [...seen, ...flow.stages.map((s) => s.stage).filter((n) => !seen.has(n))];
  const terminal = (n: string) => known.get(n)?.terminal === true;
  return [...order.filter((n) => !terminal(n)), ...order.filter(terminal)];
}

// The names that have a slot keep it; the others take the slots after the
// last one given, in the order they come. A slot once given is not given
// again, so what left the yard leaves a gap and finds its place if it returns.
function seat(taken: Record<string, number> | undefined, names: string[]): Record<string, number> {
  const out: Record<string, number> = { ...taken };
  let free = Math.max(-1, ...Object.values(out)) + 1;
  for (const name of names) {
    if (!Object.hasOwn(out, name)) out[name] = free++;
  }
  return out;
}

// A slot for every depot, flow, stage and peer of the yard: the remembered
// one, else the next free one in order of first sight (depots, flows and
// peers as the yard lists them, stages as a bead travels them). What memory
// holds and the yard does not is kept.
export function place(yard: Yard, memory: Partial<Slots> = {}): Slots {
  const out: Slots = {
    depots: seat(memory.depots, yard.depots.map((d) => d.name)),
    flows: { ...memory.flows },
    stages: { ...memory.stages },
    peers: seat(memory.peers, yard.peers.map((p) => p.name)),
  };
  for (const { depot, flows } of yard.flows) {
    out.flows[depot] = seat(out.flows[depot], flows.map((f) => f.name));
    for (const flow of flows) {
      const id = `${depot}/${flow.name}`;
      out.stages[id] = seat(out.stages[id], travelOrder(flow));
    }
  }
  return out;
}

// A human stage is a siding, except the one a flow starts at: the backlog is
// where the track begins, not a place off it.
export function isSiding(flow: Flow, k: number): boolean {
  return k > 0 && flow.stages[k]?.human === true;
}

// Where a flow's held beads stand: its first siding, if it has one.
export function holdStage(flow: Flow): string | undefined {
  return flow.stages.find((_, k) => isSiding(flow, k))?.stage;
}

// The flow a bead of this type travels: the depot's flow for the type, else
// its default flow (the one for no type), else its first.
export function flowIndex(flows: Flow[], type: string): number {
  const typed = flows.findIndex((f) => f.type === type);
  if (typed >= 0) return typed;
  const plain = flows.findIndex((f) => f.type === undefined);
  return plain >= 0 ? plain : 0;
}

// The groups with a shed at a stage: those a route sends the stage's beads
// to, the plain route's first, then the special ones (a label, a higher
// priority) in match order. Each group once.
export function shedGroups(yard: Yard, depot: string, flow: Flow, stage: string): string[] {
  const matching = yard.routes
    .filter((r) => r.stage === stage)
    .filter((r) => r.depot === undefined || r.depot === depot)
    .filter((r) => r.type === undefined || r.type === flow.type);
  // sort is stable: routes of one priority keep their match order.
  const ordered = [...matching].sort((a, b) => a.priority - b.priority);
  return [...new Set(ordered.map((r) => r.group))];
}

// Oldest first, so a bead that arrives later stands behind the ones there.
function byAge(a: Bead, b: Bead): number {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function layout(yard: Yard, memory: Partial<Slots> = {}): Layout {
  const slots = place(yard, memory);
  const out: Layout = {
    boards: [],
    tracks: [],
    sidings: [],
    platforms: [],
    sheds: [],
    crews: [],
    vehicles: [],
    counts: [],
    boxes: [],
    peers: [],
    wire: { at: { x: BOARD_X, z: WIRE_Z }, length: 0 },
  };
  const groups = new Map<string, Group>(yard.groups.map((g) => [g.name, g]));
  const open = new Set(yard.beads.map((b) => b.id));
  // A wagon whose train is open is coupled behind it, not at its own platform.
  const coupled = (b: Bead) => b.train !== undefined && open.has(b.train);
  let right = 0;

  yard.depots.forEach((depot) => {
    const flows = yard.flows.find((f) => f.depot === depot.name)?.flows ?? [];
    const top = slots.depots[depot.name]! * DEPOT_PITCH;
    const beads = yard.beads.filter((b) => b.depot === depot.name);
    // How far the board reaches: its last platform, its last track.
    let stages = 1;
    let tracks = 1;

    flows.forEach((flow, j) => {
      const track = slots.flows[depot.name]![flow.name]!;
      const z = top + FIRST_TRACK_Z + track * FLOW_PITCH;
      const id = `${depot.name}/${flow.name}`;
      const here = beads.filter((b) => flowIndex(flows, b.type) === j);
      const platform = (stage: string) => slots.stages[id]![stage]!;
      // A held bead is shunted into the siding, whatever its stage.
      const held = holdStage(flow);
      const stands = (b: Bead) => (b.hold === true && held !== undefined ? held : b.stage);
      tracks = Math.max(tracks, track + 1);

      // The main line runs from the first platform to the last one on it.
      let last = 0;
      flow.stages.forEach((stage, k) => {
        stages = Math.max(stages, platform(stage.stage) + 1);
        if (!isSiding(flow, k)) last = Math.max(last, platform(stage.stage));
      });
      out.tracks.push({
        key: id,
        depot: depot.name,
        flow: flow.name,
        ...(flow.type !== undefined ? { type: flow.type } : {}),
        at: { x: -STAGE_PITCH / 2, z },
        length: (last + 1) * STAGE_PITCH,
      });

      flow.stages.forEach((stage, k) => {
        const x = platform(stage.stage) * STAGE_PITCH;
        const siding = isSiding(flow, k);
        const key = `${id}/${stage.stage}`;
        const rail = z + (siding ? SIDING_Z : 0);
        const front = { x: x + SLOT_PITCH, z: rail };
        const platformZ = z + (siding ? SIDING_PLATFORM_Z : PLATFORM_Z);
        out.platforms.push({
          key,
          depot: depot.name,
          flow: flow.name,
          stage: stage.stage,
          at: { x, z: platformZ },
          front,
          siding,
          terminal: stage.terminal === true,
          signal: stage.stage === "review",
        });
        if (siding) {
          out.sidings.push({
            key,
            depot: depot.name,
            flow: flow.name,
            at: { x: x - PLATFORM_LENGTH / 2, z: rail },
            length: PLATFORM_LENGTH,
          });
        }

        const standing = here.filter((b) => stands(b) === stage.stage).sort(byAge);

        // What stands at the platform: the first train with its wagons, or
        // the first three beads; a count says what is not drawn.
        const loose = standing.filter((b) => !coupled(b));
        const trains = loose.filter((b) => b.type === "train");
        const slot = (s: number): Point => ({ x: front.x - s * SLOT_PITCH, z: rail });
        const count = { x: x - PLATFORM_LENGTH / 2, z: rail };
        const train = trains[0];
        // Where each bead drawn here stands.
        const drawn = new Map<string, Point>();
        const stand = (v: Vehicle) => {
          out.vehicles.push(v);
          drawn.set(v.key, v.at);
        };
        if (train !== undefined) {
          stand({ key: train.id, bead: train, kind: "locomotive", platform: key, at: slot(0) });
          const wagons = yard.beads.filter((b) => b.train === train.id).sort(byAge);
          wagons.slice(0, SLOTS).forEach((b, s) => {
            stand({ key: b.id, bead: b, kind: "wagon", platform: key, at: slot(s + 1) });
          });
          if (wagons.length > SLOTS) {
            out.counts.push({ key: `${key}#wagons`, platform: key, at: slot(SLOTS + 1), more: wagons.length - SLOTS, of: "wagons" });
          }
          // Whatever else is here stands unseen behind the train.
          if (trains.length > 1) {
            out.counts.push({ key: `${key}#trains`, platform: key, at: count, more: trains.length - 1, of: "trains" });
          }
          const rest = loose.length - trains.length;
          if (rest > 0) {
            out.counts.push({ key: `${key}#beads`, platform: key, at: count, more: rest, of: "beads" });
          }
        } else {
          loose.slice(0, SLOTS).forEach((b, s) => {
            stand({ key: b.id, bead: b, kind: "wagon", platform: key, at: slot(s) });
          });
          if (loose.length > SLOTS) {
            out.counts.push({ key: `${key}#beads`, platform: key, at: count, more: loose.length - SLOTS, of: "beads" });
          }
        }

        // Sheds stand beyond the platform, away from the track; their bays
        // fill rows of three, each row further out. A bay's crew is out
        // while its session runs.
        const away: 1 | -1 = siding ? -1 : 1;
        shedGroups(yard, depot.name, flow, stage.stage).forEach((name, n) => {
          const group = groups.get(name);
          const people = group?.runner === "manual";
          const limit = group?.limit ?? 0;
          const at = {
            x: x - PLATFORM_LENGTH / 2 + BAY_WIDTH / 2 + n * SHED_PITCH,
            z: z + (siding ? SIDING_SHED_Z : SHED_Z),
          };
          const crews = people ? [] : standing.filter((b) => b.group === name && b.working === true);
          const bays: Bay[] = [];
          for (let b = 0; b < (people ? 0 : Math.min(limit, BAYS_DRAWN)); b++) {
            const crew = crews[b];
            const home = {
              x: at.x + (b % BAY_COLUMNS) * BAY_WIDTH,
              z: at.z + away * Math.floor(b / BAY_COLUMNS) * BAY_DEPTH,
            };
            bays.push({ key: `${key}/${name}#${b}`, at: home, ...(crew !== undefined ? { crew } : {}) });
            if (crew === undefined) continue;
            // Out on the platform, level with its wagon.
            const wagon = drawn.get(crew.id);
            out.crews.push({
              key: `${key}/${name}/${crew.id}`,
              bead: crew,
              home,
              away,
              at: wagon !== undefined ? { x: wagon.x, z: platformZ } : home,
              out: wagon !== undefined,
            });
          }
          out.sheds.push({ key: `${key}/${name}`, group: name, platform: key, at, away, people, limit, bays });
        });
      });
    });

    const width = stages * STAGE_PITCH - BOARD_X;
    right = Math.max(right, BOARD_X + width);
    out.boards.push({
      key: depot.name,
      depot: depot.name,
      at: { x: BOARD_X, z: top },
      width,
      depth: BOARD_HEAD + tracks * FLOW_PITCH,
    });
  });

  yard.crew.forEach((member, c) => {
    out.boxes.push({ key: `crew/${member.name}`, name: member.name, at: { x: c * CREW_PITCH, z: CREW_Z } });
  });
  yard.peers.forEach((peer) => {
    out.peers.push({
      key: `peer/${peer.name}`,
      name: peer.name,
      at: { x: 0, z: PEER_Z - slots.peers[peer.name]! * PEER_PITCH },
      length: PEER_LENGTH,
    });
  });
  out.wire.length = Math.max(right, yard.crew.length * CREW_PITCH) - BOARD_X;
  return out;
}

// Where every element of a layout is, by its key: what must not move when
// the structure grows or its order changes.
export function positions(l: Layout): Map<string, Point> {
  const at = new Map<string, Point>();
  const put = (kind: string, key: string, p: Point) => at.set(`${kind}:${key}`, p);
  l.boards.forEach((e) => put("board", e.key, e.at));
  l.tracks.forEach((e) => put("track", e.key, e.at));
  l.sidings.forEach((e) => put("siding", e.key, e.at));
  l.platforms.forEach((e) => put("platform", e.key, e.at));
  l.sheds.forEach((e) => {
    put("shed", e.key, e.at);
    e.bays.forEach((b) => put("bay", b.key, b.at));
  });
  l.crews.forEach((e) => put("crew", e.key, e.at));
  l.vehicles.forEach((e) => put("vehicle", e.key, e.at));
  l.counts.forEach((e) => put("count", e.key, e.at));
  l.boxes.forEach((e) => put("box", e.key, e.at));
  l.peers.forEach((e) => put("peer", e.key, e.at));
  put("wire", "wire", l.wire.at);
  return at;
}
