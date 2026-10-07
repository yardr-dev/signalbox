// How a thing gets from one place of the yard to another: the way along the
// rails as a line of points, and where on it a thing is. Pure, like
// layout.ts; scene.ts moves the models along it.

import { PLATFORM_LENGTH, RETURN_Z, SIDING_Z, type Point } from "./layout";

// Units of ground a second: a stage's pitch takes most of one.
export const TRAIN_SPEED = 14;
// A move is seen and is over: never shorter, never longer than this, at any
// speed of the replay.
export const TWEEN_MIN = 0.3;
export const TWEEN_MAX = 1;
// How far past the end of its track a wagon rolls on its way out.
export const RUN_OUT = 9;

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
