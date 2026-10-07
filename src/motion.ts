// How a thing gets from one place of the yard to another: the way along the
// rails, or a figure's over the ground, as a line of points, and where on it
// a thing is. Pure, like layout.ts; scene.ts moves the models along it.

import { PEER_RAIL_Z, PLATFORM_LENGTH, RETURN_Z, SIDING_Z, SLOT_PITCH, type Person, type Point } from "./layout";

// Units of ground a second: a stage's pitch takes most of one.
export const TRAIN_SPEED = 14;
// A move is seen and is over: never shorter, never longer than this, at any
// speed of the replay.
export const TWEEN_MIN = 0.3;
export const TWEEN_MAX = 1;
// A figure's pace over the ground, and the least and the most seconds of a
// walk at 1x: a move's longest and twice that, since a person is no train.
// A faster replay walks faster, down to a move's least.
export const WALK_SPEED = 5;
export const WALK_MIN = TWEEN_MAX;
export const WALK_MAX = 2 * TWEEN_MAX;
// The fastest the walking clip plays at 1x, in times its own pace.
export const STRIDE_MAX = 2.5;
// How far past the end of its track a wagon rolls on its way out.
export const RUN_OUT = 9;
// Two places on a rail nearer than this are one place.
const NEAR = 0.1;
// A peer's goods are a journey, not a hop: the seconds their way takes at
// 1x, and the least at any speed of the replay.
export const GOODS_SECONDS = 4;
export const GOODS_MIN = 2;
// Where on a peer's line goods stand at the yard's end: on the rail, with
// room before them for the engine that brought them in.
export const GOODS_END = 4.5;
// The seconds goods in stand at the yard's end before they fade.
export const GOODS_STAND = 0.5;

// A place a wagon stands at.
export interface Stop {
  at: Point;
  // The z of its track's main line, and where that line ends.
  line: number;
  end: number;
  // Where the line's rail begins, when that is before its first platform.
  head?: number;
  // On a siding: the left end of the stub, where the points lead in.
  mouth?: Point;
}

// From a stub out to the main line, over the points: the diagonal scene.ts
// lays, from the stub's left end down to the left.
function points(s: Stop): Point[] {
  return s.mouth ? [s.mouth, { x: s.mouth.x + SIDING_Z, z: s.line }] : [];
}

// Beside its line, on the return line: where a shunter stands clear of what
// is on the rails. Nothing ever stands there for long.
function beside(s: Stop): boolean {
  return !s.mouth && s.at.z !== s.line;
}

// Whether a wagon stands on the main line between two places of it.
function blocked(line: number, a: number, b: number, standing: readonly Point[]): boolean {
  return standing.some((p) => p.z === line && p.x > Math.min(a, b) + NEAR && p.x < Math.max(a, b) - NEAR);
}

// The way from one stop to another: forward along the main line; into and
// out of a siding over its points; back along the return line. Round what
// stands on the main line in between it is the return line too. A place
// beside the line is there because of what stands on it: the way to it is
// the line as far as that is free, off it a wagon's place before; the way
// from it comes on at the far end. An engine alone leaves a siding's points
// where they cross the return line, and comes onto them there: the foot of
// the points is under the wagon that stands before them. Two stops on
// different tracks have no rail between them and are joined straight.
export function route(from: Stop, to: Stop, standing: readonly Point[] = [], alone = false): Point[] {
  if (from.line !== to.line) return [from.at, to.at];
  if (from.mouth && to.mouth && from.mouth.x === to.mouth.x) return [from.at, to.at];
  if (alone && (from.mouth || to.mouth)) {
    const crossing = ({ mouth, ...line }: Stop): Stop => (mouth ? { ...line, at: { x: mouth.x + RETURN_Z, z: line.line + RETURN_Z } } : line);
    const between = route(crossing(from), crossing(to), standing);
    return [...(from.mouth ? [from.at, from.mouth] : []), ...between, ...(to.mouth ? [to.mouth, to.at] : [])];
  }
  const out = points(from);
  const into = points(to).reverse();
  const leave = out.at(-1) ?? from.at;
  const join = into[0] ?? to.at;
  const way = join.x < leave.x ? -1 : 1;
  const far = Math.abs(join.x - leave.x);
  const off = beside(from);
  const on = beside(to);
  // Back to another platform, not to a place further back at its own: over
  // to the return line. A wagon coming out of a siding joins the main line
  // at the points before it runs back too.
  const back = !to.mouth && join.x < leave.x - PLATFORM_LENGTH;
  const round = !off && !on && far > -2 * RETURN_Z && (back || blocked(from.line, leave.x, join.x, standing));
  const z = from.line + RETURN_Z;
  const over: Point[] = [];
  if (round) {
    over.push({ x: leave.x - way * RETURN_Z, z }, { x: join.x + way * RETURN_Z, z });
  } else if (on && !off && far > -RETURN_Z) {
    const last = join.x - way * (SLOT_PITCH - RETURN_Z);
    const free = way * (last - leave.x) > 0 && !blocked(from.line, leave.x, last + way * SLOT_PITCH, standing);
    over.push(...(free ? [{ x: last, z: from.line }, { x: join.x - way * SLOT_PITCH, z }] : [{ x: leave.x - way * RETURN_Z, z }]));
  } else if (off && !on && far > -RETURN_Z) {
    over.push({ x: join.x + way * RETURN_Z, z });
  }
  return [from.at, ...out, ...over, ...into, to.at];
}

// Out of the picture: along the main line, past the buffer at its end.
export function exit(from: Stop): Point[] {
  return [from.at, ...points(from), { x: Math.max(from.end, from.at.x) + RUN_OUT, z: from.line }];
}

// The way of a peer's goods: the line as the yard shows it, from its yard's
// end out past the yard's right edge (the rail runs on, off the page), on
// the rail of its direction. Goods in come the same way back.
export function goods(line: { at: Point; length: number }, edge: number, way: "out" | "in"): Point[] {
  const z = line.at.z + (way === "out" ? PEER_RAIL_Z : -PEER_RAIL_Z);
  const near = { x: line.at.x + GOODS_END, z };
  const far = { x: Math.min(line.at.x + line.length, Math.max(edge, near.x) + RUN_OUT), z };
  return way === "out" ? [near, far] : [far, near];
}

// The seconds goods take over their way, at a speed of the replay. Not by
// length, and with a cap of its own: the longest way of the yard reads as
// one at any speed.
export function goodsSeconds(speed: number): number {
  return Math.max(GOODS_MIN, GOODS_SECONDS / speed);
}

export function measure(path: Point[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
  return length;
}

// The seconds a way of this length takes.
export function seconds(length: number): number {
  return Math.min(TWEEN_MAX, Math.max(TWEEN_MIN, length / TRAIN_SPEED));
}

// Slow away, slow in.
export function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

// Slow away and gone at speed; in at speed and slow to a stand: the halves
// of ease, for a way that starts or ends out of the picture.
export function pull(t: number): number {
  return 2 * ease(t / 2);
}

export function brake(t: number): number {
  return 1 - pull(1 - t);
}

export interface Pose extends Point {
  // The turn about the vertical that lays a model along the way, as
  // scene.ts turns its rails: 0 is along x. A wagon running back is not
  // turned round, so the angle stays within a quarter turn.
  angle: number;
}

// Where a thing is after part of the way, 0 to 1 by length.
export function along(path: Point[], part: number): Pose {
  const first = path[0] ?? { x: 0, z: 0 };
  let left = Math.min(1, Math.max(0, part)) * measure(path);
  let pose: Pose = { ...first, angle: 0 };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length === 0) continue;
    const forward = b.x >= a.x ? 1 : -1;
    const angle = Math.atan2(-(b.z - a.z) * forward, (b.x - a.x) * forward);
    const t = Math.min(1, left / length);
    pose = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, angle };
    if (left <= length) break;
    left -= length;
  }
  return pose;
}

// A figure's way from where it stands to where it goes: over the ground
// between the buildings and the platforms, off it and onto it at a gate
// level with each end. Beside another wagon of one platform it goes along
// the platform's edge.
export function walk(from: Person, to: Person): Point[] {
  if (from.platform !== undefined && from.platform === to.platform) return [from.at, to.at];
  const way = [from.at, from.gate, to.gate, to.at];
  return way.filter((p, i) => i === 0 || p.x !== way[i - 1]!.x || p.z !== way[i - 1]!.z);
}

// A destination can change while a figure is on its way. Start at its actual
// position and keep to the ground, stepping off its old platform only if it
// has reached it; do not finish the abandoned route first.
export function continueWalk(from: Person, to: Person, at: Point, onPlatform: boolean): Point[] {
  if (from.platform !== undefined && from.platform === to.platform) return [at, to.at];
  const way = [at];
  if (onPlatform && from.platform !== undefined) way.push(from.gate);
  way.push(to.gate, to.at);
  return way.filter((p, i) => i === 0 || p.x !== way[i - 1]!.x || p.z !== way[i - 1]!.z);
}

// The seconds a walk of this length takes, at a speed of the replay: at 1x a
// second at a walking pace, and never more than two, however far the hut is
// from the wagon. The replay's clock is the walk's: at 10x it is a tenth of
// that, but never under a move's least, as for a wagon.
export function walkSeconds(length: number, speed = 1): number {
  const plain = Math.min(WALK_MAX, Math.max(WALK_MIN, length / WALK_SPEED));
  return Math.max(TWEEN_MIN, plain / speed);
}

// How fast the walking clip plays over a way that takes these seconds: at 1x
// with the feet at the pace over the ground, as far as legs go (a long way
// in two seconds is a run, not a blur), and as much faster as the replay
// made the walk shorter.
export function stride(length: number, seconds: number): number {
  const plain = walkSeconds(length);
  return Math.min(STRIDE_MAX, Math.max(1, length / plain / WALK_SPEED)) * (plain / seconds);
}

// The way a thing looks that goes from a to b, as scene.ts turns a model: 0
// is along x, a quarter turn is up the page.
export function heading(a: Point, b: Point): number {
  return Math.atan2(-(b.z - a.z), b.x - a.x);
}

// A turn from one angle towards another, by at most step: the short way round.
export function turn(from: number, to: number, step: number): number {
  const full = 2 * Math.PI;
  const left = ((((to - from) % full) + full + Math.PI) % full) - Math.PI;
  return Math.abs(left) <= step ? to : from + Math.sign(left) * step;
}

// What a figure does: it walks while it is on its way, works while it stands
// at a bead, and is idle at home; and at a bead whose wagon has not come to
// a stand there yet, since no one works on a wagon that moves. One whose
// session ended badly sits at its bead, wherever the wagon is.
export type Doing = "idle" | "walk" | "work" | "sit";
export function doing(person: Person, moving: boolean, stands = true): Doing {
  if (moving) return "walk";
  if (person.sat) return "sit";
  return person.bead !== undefined && stands ? "work" : "idle";
}

// A works' smoke: this many puffs leave its chimney one after another, and
// each takes this many seconds to rise this far, drift this far with the
// wind, and thin out to nothing. Its time is the page's own: at any speed of
// the replay smoke rises as smoke does.
export const PUFFS = 8;
export const PUFF_SECONDS = 2.6;
export const PUFF_RISE = 2.8;
export const PUFF_DRIFT = 0.9;
// How wide a puff is as it leaves the chimney and as it fades, and the most
// that is seen of it.
export const PUFF_SIZE: [from: number, to: number] = [0.28, 0.8];
export const PUFF_SHADE = 0.8;

// A puff of smoke, from its chimney's mouth.
export interface Puff {
  x: number;
  y: number;
  z: number;
  size: number;
  // How much of it is seen, 0 to 1.
  shade: number;
}

// Whether any smoke is left over a fire lit so many seconds ago that burnt
// for so many of them: all of them (Infinity) while it burns.
export function smokes(seconds: number, burnt = Infinity): boolean {
  return seconds >= 0 && seconds < burnt + PUFF_SECONDS;
}

// Where puff i of a fire is, by the seconds since it was lit: none before
// its turn has come, and none that would have left the chimney after the
// fire went out. So smoke starts at the chimney, and what is in the air when
// the fire goes out rises on and fades.
export function puff(i: number, seconds: number, burnt = Infinity): Puff | undefined {
  if (!smokes(seconds, burnt)) return undefined;
  const turn = (i / PUFFS) * PUFF_SECONDS;
  if (seconds < turn) return undefined;
  const left = turn + Math.floor((seconds - turn) / PUFF_SECONDS) * PUFF_SECONDS;
  if (left >= burnt) return undefined;
  const part = (seconds - left) / PUFF_SECONDS;
  // Each a little to its own side, so the plume is no straight line.
  const sway = Math.sin(i * 2.4) * 0.22 * part;
  return {
    x: PUFF_DRIFT * part * part + sway,
    y: PUFF_RISE * part,
    z: Math.cos(i * 1.7) * 0.18 * part,
    size: PUFF_SIZE[0] + (PUFF_SIZE[1] - PUFF_SIZE[0]) * part,
    // Soon there, and thinner all the way up.
    shade: PUFF_SHADE * Math.min(1, part / 0.12) * (1 - part),
  };
}
