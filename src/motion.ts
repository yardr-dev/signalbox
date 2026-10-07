// How a thing gets from one place of the yard to another: the way along the
// rails as a line of points, and where on it a thing is. Pure, like
// layout.ts; scene.ts moves the models along it.

import { PEER_RAIL_Z, PLATFORM_LENGTH, RETURN_Z, SIDING_Z, type Point } from "./layout";

// Units of ground a second: a stage's pitch takes most of one.
export const TRAIN_SPEED = 14;
// A move is seen and is over: never shorter, never longer than this, at any
// speed of the replay.
export const TWEEN_MIN = 0.3;
export const TWEEN_MAX = 1;
// How far past the end of its track a wagon rolls on its way out.
export const RUN_OUT = 9;
// A peer's goods are a journey, not a hop: the seconds their way takes at
// 1x, and the least at any speed of the replay.
export const GOODS_SECONDS = 4;
export const GOODS_MIN = 2;
// Where on a peer's line goods stand at the yard's end: on the rail, short
// of the sign.
export const GOODS_END = 1.5;
// The seconds goods in stand at the yard's end before they fade.
export const GOODS_STAND = 0.5;
// The seconds between two goods wagons one way on one line: the one before
// has stood and faded when the next comes in.
export const GOODS_HEADWAY = 1;

// A place a wagon stands at.
export interface Stop {
  at: Point;
  // The z of its track's main line, and where that line ends.
  line: number;
  end: number;
  // On a siding: the left end of the stub, where the points lead in.
  mouth?: Point;
}

// From a stub out to the main line, over the points: the diagonal scene.ts
// lays, from the stub's left end down to the left.
function points(s: Stop): Point[] {
  return s.mouth ? [s.mouth, { x: s.mouth.x + SIDING_Z, z: s.line }] : [];
}

// The way from one stop to another: forward along the main line; into and
// out of a siding over its points; back along the return line. Two stops on
// different tracks have no rail between them and are joined straight.
export function route(from: Stop, to: Stop): Point[] {
  if (from.line !== to.line) return [from.at, to.at];
  if (from.mouth && to.mouth && from.mouth.x === to.mouth.x) return [from.at, to.at];
  const out = points(from);
  const into = points(to).reverse();
  const leave = out.at(-1) ?? from.at;
  const join = into[0] ?? to.at;
  // Back to another platform, not to a place further back at its own: over
  // to the return line. A wagon coming out of a siding joins the main line
  // at the points before it runs back too.
  const back =
    !to.mouth && join.x < leave.x - PLATFORM_LENGTH
      ? [
          { x: leave.x + RETURN_Z, z: from.line + RETURN_Z },
          { x: join.x - RETURN_Z, z: from.line + RETURN_Z },
        ]
      : [];
  return [from.at, ...out, ...back, ...into, to.at];
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

// The seconds goods sent now wait before they start: a headway after the
// start of the last before them, one way on one line.
export function headway(now: number, last: number | undefined): number {
  return last === undefined ? 0 : Math.max(0, last + GOODS_HEADWAY - now);
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
