import { describe, expect, test } from "vitest";
import { PEER_LENGTH, RETURN_Z, SIDING_Z, SLOT_PITCH, type Person } from "../src/layout";
import {
  along,
  brake,
  doing,
  exit,
  goods,
  GOODS_END,
  GOODS_MIN,
  GOODS_SECONDS,
  goodsSeconds,
  heading,
  measure,
  pull,
  route,
  RUN_OUT,
  seconds,
  stride,
  STRIDE_MAX,
  turn,
  TWEEN_MAX,
  TWEEN_MIN,
  walk,
  WALK_MAX,
  WALK_MIN,
  WALK_SPEED,
  walkSeconds,
  type Stop,
} from "../src/motion";

// A track along z = 10 that ends at x = 66, and a siding's stub above it.
const main = (x: number): Stop => ({ at: { x, z: 10 }, line: 10, end: 66 });
const stub: Stop = { at: { x: 27, z: 10 + SIDING_Z }, line: 10, end: 66, mouth: { x: 19.3, z: 10 + SIDING_Z } };

describe("the way a wagon takes", () => {
  test("forward, straight along the main line", () => {
    expect(route(main(3), main(15))).toEqual([{ x: 3, z: 10 }, { x: 15, z: 10 }]);
  });

  test("into a siding over its points, and out the same way", () => {
    const points = { x: 19.3 + SIDING_Z, z: 10 };
    expect(route(main(15), stub)).toEqual([{ x: 15, z: 10 }, points, stub.mouth, stub.at]);
    expect(route(stub, main(39))).toEqual([stub.at, stub.mouth, points, { x: 39, z: 10 }]);
  });

  test("back along the return line, off the main line and on again", () => {
    const way = route(main(39), main(15));
    expect(way[0]).toEqual({ x: 39, z: 10 });
    expect(way.at(-1)).toEqual({ x: 15, z: 10 });
    expect(way.slice(1, -1).map((p) => p.z)).toEqual([10 + RETURN_Z, 10 + RETURN_Z]);
    // A place further back at one platform is no journey.
    expect(route(main(15), main(12.05))).toEqual([{ x: 15, z: 10 }, { x: 12.05, z: 10 }]);
  });

  test("round a wagon that stands in the way: over the return line, forward too", () => {
    const standing = [{ x: 15, z: 10 }];
    expect(route(main(12), main(27), standing)).toEqual([
      { x: 12, z: 10 },
      { x: 12 - RETURN_Z, z: 10 + RETURN_Z },
      { x: 27 + RETURN_Z, z: 10 + RETURN_Z },
      { x: 27, z: 10 },
    ]);
    // What stands at its ends, beyond them or on another rail is not in the way.
    for (const p of [{ x: 12, z: 10 }, { x: 27, z: 10 }, { x: 30, z: 10 }, { x: 15, z: 10 + SIDING_Z }]) {
      expect(route(main(12), main(27), [p])).toEqual([{ x: 12, z: 10 }, { x: 27, z: 10 }]);
    }
  });

  test("to a place beside the line: on the line while it is free, off it a wagon's place before; and from one", () => {
    const beside = (x: number): Stop => ({ at: { x, z: 10 + RETURN_Z }, line: 10, end: 66 });
    const off = 15 - SLOT_PITCH;
    expect(route(main(3), beside(15))).toEqual([{ x: 3, z: 10 }, { x: off + RETURN_Z, z: 10 }, { x: off, z: 10 + RETURN_Z }, beside(15).at]);
    // Off it at once when a wagon stands on the line before that.
    for (const x of [6, off]) {
      expect(route(main(3), beside(15), [{ x, z: 10 }])).toEqual([{ x: 3, z: 10 }, { x: 3 - RETURN_Z, z: 10 + RETURN_Z }, beside(15).at]);
    }
    expect(route(beside(15), main(3))).toEqual([beside(15).at, { x: 3 - RETURN_Z, z: 10 + RETURN_Z }, { x: 3, z: 10 }]);
    expect(route(beside(3), beside(15))).toEqual([beside(3).at, beside(15).at]);
  });

  test("an engine alone meets a siding's points where they cross the return line", () => {
    const crossing = { x: stub.mouth!.x + RETURN_Z, z: 10 + RETURN_Z };
    expect(route(stub, main(3), [], true)).toEqual([stub.at, stub.mouth, crossing, { x: 3 - RETURN_Z, z: 10 + RETURN_Z }, { x: 3, z: 10 }]);
    expect(route(main(3), stub, [{ x: 15, z: 10 }], true)).toEqual([{ x: 3, z: 10 }, { x: 3 - RETURN_Z, z: 10 + RETURN_Z }, crossing, stub.mouth, stub.at]);
    // From further up the line it turns there, clear of the line.
    expect(route(main(39), stub, [{ x: 30, z: 10 }], true).slice(1)).toEqual([{ x: 39 + RETURN_Z, z: 10 + RETURN_Z }, crossing, stub.mouth, stub.at]);
  });

  test("a wagon leaving a siding for an earlier platform uses the return line", () => {
    const way = route(stub, main(3));
    expect(way.slice(0, 3)).toEqual([
      stub.at,
      stub.mouth,
      { x: stub.mouth!.x + SIDING_Z, z: 10 },
    ]);
    expect(way.slice(3, 5).map((p) => p.z)).toEqual([10 + RETURN_Z, 10 + RETURN_Z]);
    expect(way.at(-1)).toEqual({ x: 3, z: 10 });
  });

  test("out of the picture: past the buffer at the end of its track", () => {
    expect(exit(main(51)).at(-1)).toEqual({ x: 66 + RUN_OUT, z: 10 });
    expect(exit(stub).at(-1)).toEqual({ x: 66 + RUN_OUT, z: 10 });
  });

  test("a move reads as a train: never under the least, never over about a second", () => {
    expect(seconds(0)).toBe(TWEEN_MIN);
    expect(seconds(12)).toBeGreaterThan(0.5);
    expect(seconds(500)).toBe(TWEEN_MAX);
    expect(TWEEN_MAX).toBeLessThanOrEqual(1);
  });

  test("along the way by length, turned with the rail and never round", () => {
    const way = route(main(15), stub);
    expect(along(way, 0)).toMatchObject({ x: 15, z: 10 });
    expect(along(way, 1)).toMatchObject(stub.at);
    const total = measure(way);
    const onPoints = along(way, (1.7 + 1) / total);
    expect(onPoints.angle).toBeCloseTo(Math.PI / 4);
    expect(onPoints.z).toBeLessThan(10);
    // Running back it keeps its nose forward.
    const back = along(route(main(39), main(15)), 0.5);
    expect(Math.abs(back.angle)).toBe(0);
  });
});

// A peer's line from x = 0 along z = -17, and a yard whose right edge is at 66.
const peer = { at: { x: 0, z: -17 }, length: PEER_LENGTH };
const EDGE = 66;

describe("a peer's goods", () => {
  test("the way spans the line the yard shows: from its yard's end out past the edge", () => {
    const out = goods(peer, EDGE, "out");
    expect(out[0]!.x).toBe(GOODS_END);
    expect(out.at(-1)!.x).toBe(EDGE + RUN_OUT);
    expect(measure(out)).toBe(EDGE + RUN_OUT - GOODS_END);
    // In is the same length the other way, and ends at the yard's end.
    const into = goods(peer, EDGE, "in");
    expect(into.map((p) => p.x)).toEqual([EDGE + RUN_OUT, GOODS_END]);
    // Never past the rail's own end.
    expect(goods({ ...peer, length: 30 }, EDGE, "out").at(-1)!.x).toBe(30);
  });

  test("a train's pace: four seconds at 1x, never under two at any speed", () => {
    expect(goodsSeconds(1)).toBe(GOODS_SECONDS);
    expect(GOODS_SECONDS).toBe(4);
    expect(goodsSeconds(600)).toBe(GOODS_MIN);
    for (const speed of [1, 10, 60, 600]) expect(goodsSeconds(speed)).toBeGreaterThanOrEqual(2);
    // The hop's cap is not this way's: the same length as a move is a second.
    expect(seconds(measure(goods(peer, EDGE, "out")))).toBe(TWEEN_MAX);
  });

  test("out pulls away from a stand, in brakes to one", () => {
    expect([pull(0), pull(1), brake(0), brake(1)]).toEqual([0, 1, 0, 1]);
    expect(pull(0.1)).toBeLessThan(0.05);
    expect(brake(0.9)).toBeGreaterThan(0.95);
    expect(pull(0.5)).toBeLessThan(0.5);
  });
});

describe("a figure's way", () => {
  const place = { x: 4, z: 13 };
  const idle: Person = { key: "hut#0", outfit: "builder", group: "builders", at: place, gate: { x: 4, z: 12.3 }, faces: 1 };
  const bead = { id: "a", title: "a", type: "task", stage: "new", depot: "d", priority: 2, created_at: "" };
  const at = (x: number, platform = "d/default/new"): Person => ({ ...idle, at: { x, z: 11.1 }, gate: { x, z: 12.3 }, faces: -1, platform, bead });

  test("a start walks it out: from its place to the ground, along it, and onto the platform at its wagon", () => {
    expect(walk(idle, at(15))).toEqual([place, { x: 4, z: 12.3 }, { x: 15, z: 12.3 }, { x: 15, z: 11.1 }]);
  });

  test("an end walks it back the same way", () => {
    expect(walk(at(15), idle)).toEqual([...walk(idle, at(15))].reverse());
  });

  test("to another wagon of its platform along the edge; to another platform over the ground", () => {
    expect(walk(at(15), at(12.05))).toEqual([{ x: 15, z: 11.1 }, { x: 12.05, z: 11.1 }]);
    const far = { ...at(27, "d/default/review"), at: { x: 27, z: 55.1 }, gate: { x: 27, z: 56.3 } };
    expect(walk(at(15), far)).toEqual([{ x: 15, z: 11.1 }, { x: 15, z: 12.3 }, far.gate, far.at]);
    // Level with its gate already: no step on the spot.
    expect(walk(idle, at(4))).toEqual([place, { x: 4, z: 12.3 }, { x: 4, z: 11.1 }]);
  });

  test("a walk takes a second or two, however far the hut is", () => {
    expect(WALK_MIN).toBe(TWEEN_MAX);
    expect(walkSeconds(0.5)).toBe(1);
    expect(walkSeconds(measure(walk(idle, at(8))))).toBeCloseTo(5.9 / WALK_SPEED);
    expect(walkSeconds(1.5 * WALK_SPEED)).toBe(1.5);
    expect(walkSeconds(400)).toBe(WALK_MAX);
    expect(WALK_MAX).toBe(2);
  });

  test("the replay's speed is the walk's, down to a move's least", () => {
    expect(walkSeconds(1.5 * WALK_SPEED, 1)).toBe(1.5);
    expect(walkSeconds(1.5 * WALK_SPEED, 2)).toBe(0.75);
    expect(walkSeconds(400, 2)).toBe(1);
    for (const speed of [10, 60, 600]) expect(walkSeconds(400, speed)).toBe(TWEEN_MIN);
  });

  test("the legs keep the pace of the way, up to a run", () => {
    expect(stride(WALK_SPEED, 1)).toBe(1);
    expect(stride(1.5 * WALK_SPEED, 1)).toBe(1.5);
    // A short way in its least second is still a walk, not a slow one.
    expect(stride(0.5, 1)).toBe(1);
    expect(stride(400, WALK_MAX)).toBe(STRIDE_MAX);
    // A walk the replay made shorter: the legs are as much faster.
    expect(stride(WALK_SPEED, walkSeconds(WALK_SPEED, 2))).toBe(2);
    expect(stride(400, walkSeconds(400, 10))).toBeCloseTo((STRIDE_MAX * WALK_MAX) / TWEEN_MIN);
  });

  test("it looks the way it goes, and turns the short way round", () => {
    expect(heading({ x: 0, z: 0 }, { x: 3, z: 0 })).toBeCloseTo(0);
    expect(heading({ x: 0, z: 0 }, { x: 0, z: -3 })).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(heading({ x: 3, z: 0 }, { x: 0, z: 0 }))).toBeCloseTo(Math.PI);
    expect(turn(0, 1, 0.25)).toBe(0.25);
    expect(turn(0, 1, 2)).toBe(1);
    // From just short of a half turn to just past it: on, not back round.
    expect(turn(3, -3, 0.1)).toBeCloseTo(3.1);
    expect(turn(-3, 3, 0.1)).toBeCloseTo(-3.1);
    // No time is the end of the turn, at once.
    expect(turn(0, 2.5, Infinity)).toBe(2.5);
  });

  test("it walks on its way, works at a bead, and is idle at home", () => {
    expect(doing(idle, false)).toBe("idle");
    expect(doing(at(15), true)).toBe("walk");
    expect(doing(idle, true)).toBe("walk");
    expect(doing(at(15), false)).toBe("work");
    // No one works on a wagon that is not there yet.
    expect(doing(at(15), false, false)).toBe("idle");
  });
});
