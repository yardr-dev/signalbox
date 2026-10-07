// From a yard's structure to positions on the ground: one pure function.
//
// Every element is placed by its slot in its parent and by constants, never
// by how much else there is: the board of a depot, the track of a flow in its
// depot, the platform of a stage in its flow, the line of a peer; and by its
// index building n of its stage, place p before its door, crew member c. So
// the same structure gives the same picture. Only extents grow: a track's
// length, a board's size.
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

// A group's building stands on a plot this wide from its platform's left
// end, the next one a pitch on, so two fit beside one platform. A crew's has
// its door on the right, down the line: the yard is seen from below, and a
// door to the platform would be behind the building, its crew with it. The
// crew stand idle before the door in rows of three out from it, a place for
// each session the group may run.
export const SHED_PITCH = 5;
export const SHED_WIDTH = 2.5;
export const PLACE_FILES = 3;
export const PLACE_PITCH = 0.85;
// From the door to the first place of a row, and from the building's middle
// to a row: the first on the platform's side, the second on the other.
export const PLACE_X = 0.55;
export const PLACE_Z = 0.45;
// From a building's middle towards its platform: the ground the crew walk
// on, between the buildings and the platforms.
export const GROUND_Z = 1.1;

// Where a figure works: this far from the platform's middle towards its
// track, on the platform's edge. One whose wagon is not drawn works at the
// platform's left end, where the count is, a step apart from the next.
export const WORK_Z = 0.3;
export const TAIL_X = 0.4;
export const TAIL_PITCH = 0.6;

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
// Where a crew member stands, from the middle of its signal box.
export const BOX_FRONT_Z = 1.7;
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

export interface Place {
  key: string;
  at: Point;
}

// What a group is housed in. People have a station. A group that runs
// sessions in panes has a crew: builders a site hut, reviewers an office.
// A group whose sessions are scripts is a works, and has no figures.
export type ShedKind = "station" | "hut" | "office" | "works";

// A group's building, beside a platform it is routed to. A station and a
// works stand at each of them; a crew has one building, at the first, and
// walks from there to every platform of its group.
export interface Shed {
  key: string;
  group: string;
  platform: string;
  kind: ShedKind;
  // The middle of its plot.
  at: Point;
  // Which way on z leads away from the track: where the building stands.
  away: 1 | -1;
  runner: string;
  limit: number;
  // Where its crew stand idle: none for a station or a works.
  places: Place[];
}

// A session at work on a bead: where its figure stands.
export interface Work {
  // The bead's id.
  key: string;
  bead: Bead;
  group: string;
  platform: string;
  // The wagon slot it stands beside; none when its wagon is not drawn.
  slot?: number;
  at: Point;
  // Behind the platform, level with at: where the way there leaves the ground.
  gate: Point;
  // Which way on z its wagon stands from it.
  reach: 1 | -1;
}

// A figure: one of a crew, idle at its place or at work on a bead; or a crew
// member of the yard at its signal box.
export interface Person {
  // Its place's key: a figure keeps its place whatever it does.
  key: string;
  outfit: "builder" | "reviewer" | "crew";
  group?: string;
  at: Point;
  // Where its way meets the ground between the buildings and the platforms:
  // level with its place, or behind the platform it works at.
  gate: Point;
  // Which way on z it looks: at its wagon, or down the page at the reader.
  faces: 1 | -1;
  // At work: the platform, and the bead.
  platform?: string;
  bead?: Bead;
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
  work: Work[];
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

// What houses a group: by its runner, and for a crew by its name.
export function shedKind(group: Group | undefined): ShedKind {
  if (group?.runner === "manual") return "station";
  // A group the yard does not list is a works too: something takes its beads.
  if (group === undefined || group.runner === "exec") return "works";
  return group.name.includes("review") ? "office" : "hut";
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
    work: [],
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
  const crewed = (b: Bead) => b.working === true && ["hut", "office"].includes(shedKind(groups.get(b.group ?? "")));
  // Every building a route asks for, with the slots of its platform: a crew
  // keeps only the first of its own, below.
  const sheds: { shed: Shed; rank: number[] }[] = [];
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
        // The bead drawn in each slot here.
        const drawn: Bead[] = [];
        const stand = (v: Vehicle) => {
          out.vehicles.push(v);
          drawn.push(v.bead);
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

        // Buildings stand beyond the platform, away from the track; a crew's
        // places are in rows before its door, the first place nearest it.
        const away: 1 | -1 = siding ? -1 : 1;
        const middle = z + (siding ? SIDING_SHED_Z : SHED_Z);
        const ground = middle - away * GROUND_Z;
        shedGroups(yard, depot.name, flow, stage.stage).forEach((name, n) => {
          const group = groups.get(name);
          const kind = shedKind(group);
          const limit = group?.limit ?? 0;
          const at = { x: x - PLATFORM_LENGTH / 2 + SHED_WIDTH / 2 + n * SHED_PITCH, z: middle };
          const places: Place[] = [];
          const row = kind === "hut" || kind === "office" ? limit : 0;
          for (let p = 0; p < row; p++) {
            places.push({
              key: `${key}/${name}#${p}`,
              at: {
                x: at.x + SHED_WIDTH / 2 + PLACE_X + (p % PLACE_FILES) * PLACE_PITCH,
                z: at.z + away * (Math.floor(p / PLACE_FILES) === 0 ? -PLACE_Z : PLACE_Z + (Math.floor(p / PLACE_FILES) - 1) * PLACE_PITCH),
              },
            });
          }
          sheds.push({
            shed: { key: `${key}/${name}`, group: name, platform: key, kind, at, away, runner: group?.runner ?? "", limit, places },
            rank: [slots.depots[depot.name]!, track, platform(stage.stage), n],
          });
        });

        // A session of a crew is a figure at work here: beside its wagon's
        // slot on the platform's edge, or at the platform's left end when
        // its wagon is only counted, or stands past the slab behind a train.
        // A bead people work, and one a script works, is no figure's; nor is
        // a wagon behind a train that stands elsewhere, or is not drawn.
        let tail = 0;
        const worked = [...drawn, ...standing.filter((b) => !coupled(b) && !drawn.includes(b))];
        for (const b of worked.filter(crewed)) {
          const s = drawn.indexOf(b);
          const beside = s >= 0 && s < SLOTS;
          const wx = beside ? slot(s).x : x - PLATFORM_LENGTH / 2 + TAIL_X + tail++ * TAIL_PITCH;
          out.work.push({
            key: b.id,
            bead: b,
            group: b.group!,
            platform: key,
            ...(beside ? { slot: s } : {}),
            at: { x: wx, z: platformZ - away * WORK_Z },
            gate: { x: wx, z: ground },
            reach: away === 1 ? -1 : 1,
          });
        }
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

  // A crew has one building: at the platform of the lowest slots, so what is
  // added to the yard later takes it nowhere else.
  const before = (a: number[], b: number[]) => {
    const i = a.findIndex((v, k) => v !== b[k]);
    return i >= 0 && a[i]! < b[i]!;
  };
  for (const { shed, rank } of sheds) {
    const crew = shed.kind === "hut" || shed.kind === "office";
    const first = crew && !sheds.some((o) => o.shed.group === shed.group && o.shed !== shed && before(o.rank, rank));
    if (!crew || first) out.sheds.push(shed);
  }

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
    e.places.forEach((b) => put("place", b.key, b.at));
  });
  l.work.forEach((e) => put("work", e.key, e.at));
  l.vehicles.forEach((e) => put("vehicle", e.key, e.at));
  l.counts.forEach((e) => put("count", e.key, e.at));
  l.boxes.forEach((e) => put("box", e.key, e.at));
  l.peers.forEach((e) => put("peer", e.key, e.at));
  put("wire", "wire", l.wire.at);
  return at;
}

// The figures of a layout: every crew's, each at its place before the door or
// at work on a bead of its group, and the yard's crew members at their signal
// boxes. before is the figures as they were: a session keeps the figure it
// has, so the end of another sends that one home and no one else anywhere. A
// new session takes the first figure at home; one more than the places drawn
// has none.
export function people(l: Layout, before: readonly Person[] = []): Person[] {
  const out: Person[] = [];
  for (const shed of l.sheds) {
    const sessions = new Map(l.work.filter((w) => w.group === shed.group).map((w) => [w.key, w]));
    const kept = new Map<string, Work>();
    for (const p of before) {
      const work = p.bead && sessions.get(p.bead.id);
      if (!work || !shed.places.some((place) => place.key === p.key)) continue;
      kept.set(p.key, work);
      sessions.delete(work.key);
    }
    const fresh = [...sessions.values()];
    for (const place of shed.places) {
      const work = kept.get(place.key) ?? fresh.shift();
      out.push({
        key: place.key,
        outfit: shed.kind === "office" ? "reviewer" : "builder",
        group: shed.group,
        at: work?.at ?? place.at,
        gate: work?.gate ?? { x: place.at.x, z: shed.at.z - shed.away * GROUND_Z },
        faces: work?.reach ?? 1,
        ...(work ? { platform: work.platform, bead: work.bead } : {}),
      });
    }
  }
  // Before its box, on the side of the yard.
  for (const box of l.boxes) {
    const at = { x: box.at.x, z: box.at.z + BOX_FRONT_Z };
    out.push({ key: box.key, outfit: "crew", at, gate: at, faces: 1 });
  }
  return out;
}

// How many of a group's sessions are at work: what its building's sign says.
export function atWork(l: Layout, group: string): number {
  return l.work.filter((w) => w.group === group).length;
}
