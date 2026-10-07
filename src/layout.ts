// From a yard's structure to positions on the ground: one pure function.
//
// Every element is placed by its index in its parent and by constants, never
// by how much else there is: depot i, flow j of its depot, stage k of its
// flow, shed n of its stage, bay b of its shed, crew member c, peer p. So the
// same structure gives the same picture, and a structure that only grew (a
// stage, flow, depot, peer or crew member appended) leaves everything that was
// there where it was. Only extents grow: a track's length, a board's size.
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
  // The bead whose session stands in the bay.
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
  vehicles: Vehicle[];
  counts: Count[];
  boxes: SignalBox[];
  peers: PeerLine[];
  // The telegraph wire: its left end and its length.
  wire: { at: Point; length: number };
}

// A human stage is a siding, except the one a flow starts at: the backlog is
// where the track begins, not a place off it.
export function isSiding(flow: Flow, k: number): boolean {
  return k > 0 && flow.stages[k]?.human === true;
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

export function layout(yard: Yard): Layout {
  const out: Layout = {
    boards: [],
    tracks: [],
    sidings: [],
    platforms: [],
    sheds: [],
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

  yard.depots.forEach((depot, i) => {
    const flows = yard.flows.find((f) => f.depot === depot.name)?.flows ?? [];
    const top = i * DEPOT_PITCH;
    const beads = yard.beads.filter((b) => b.depot === depot.name);
    let stages = 1;

    flows.forEach((flow, j) => {
      const z = top + FIRST_TRACK_Z + j * FLOW_PITCH;
      const id = `${depot.name}/${flow.name}`;
      const here = beads.filter((b) => flowIndex(flows, b.type) === j);
      stages = Math.max(stages, flow.stages.length);

      // The main line runs from the first platform to the last one on it.
      let last = 0;
      flow.stages.forEach((_, k) => {
        if (!isSiding(flow, k)) last = k;
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
        const x = k * STAGE_PITCH;
        const siding = isSiding(flow, k);
        const key = `${id}/${stage.stage}`;
        const rail = z + (siding ? SIDING_Z : 0);
        const front = { x: x + SLOT_PITCH, z: rail };
        out.platforms.push({
          key,
          depot: depot.name,
          flow: flow.name,
          stage: stage.stage,
          at: { x, z: z + (siding ? SIDING_PLATFORM_Z : PLATFORM_Z) },
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

        const standing = here.filter((b) => b.stage === stage.stage).sort(byAge);

        // Sheds stand beyond the platform, away from the track; their bays
        // fill rows of three, each row further out.
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
            bays.push({
              key: `${key}/${name}#${b}`,
              at: {
                x: at.x + (b % BAY_COLUMNS) * BAY_WIDTH,
                z: at.z + away * Math.floor(b / BAY_COLUMNS) * BAY_DEPTH,
              },
              ...(crew !== undefined ? { crew } : {}),
            });
          }
          out.sheds.push({ key: `${key}/${name}`, group: name, platform: key, at, away, people, limit, bays });
        });

        // What stands at the platform: the first train with its wagons, or
        // the first three beads; a count says what is not drawn.
        const loose = standing.filter((b) => !coupled(b));
        const trains = loose.filter((b) => b.type === "train");
        const slot = (s: number): Point => ({ x: front.x - s * SLOT_PITCH, z: rail });
        const count = { x: x - PLATFORM_LENGTH / 2, z: rail };
        const train = trains[0];
        if (train !== undefined) {
          out.vehicles.push({ key: train.id, bead: train, kind: "locomotive", platform: key, at: slot(0) });
          const wagons = yard.beads.filter((b) => b.train === train.id).sort(byAge);
          wagons.slice(0, SLOTS).forEach((b, s) => {
            out.vehicles.push({ key: b.id, bead: b, kind: "wagon", platform: key, at: slot(s + 1) });
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
            out.vehicles.push({ key: b.id, bead: b, kind: "wagon", platform: key, at: slot(s) });
          });
          if (loose.length > SLOTS) {
            out.counts.push({ key: `${key}#beads`, platform: key, at: count, more: loose.length - SLOTS, of: "beads" });
          }
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
      depth: BOARD_HEAD + Math.max(flows.length, 1) * FLOW_PITCH,
    });
  });

  yard.crew.forEach((member, c) => {
    out.boxes.push({ key: `crew/${member.name}`, name: member.name, at: { x: c * CREW_PITCH, z: CREW_Z } });
  });
  yard.peers.forEach((peer, p) => {
    out.peers.push({
      key: `peer/${peer.name}`,
      name: peer.name,
      at: { x: 0, z: PEER_Z - p * PEER_PITCH },
      length: PEER_LENGTH,
    });
  });
  out.wire.length = Math.max(right, yard.crew.length * CREW_PITCH) - BOARD_X;
  return out;
}

// Where every element of a layout is, by its key: what must not move when
// the structure grows.
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
  l.vehicles.forEach((e) => put("vehicle", e.key, e.at));
  l.counts.forEach((e) => put("count", e.key, e.at));
  l.boxes.forEach((e) => put("box", e.key, e.at));
  l.peers.forEach((e) => put("peer", e.key, e.at));
  put("wire", "wire", l.wire.at);
  return at;
}
