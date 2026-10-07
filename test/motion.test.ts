import { describe, expect, test } from "vitest";
import { PEER_LENGTH, PEER_RAIL_Z, RETURN_Z, SIDING_Z, type Point } from "../src/layout";
import {
  along,
  brake,
  exit,
  goods,
  GOODS_END,
  GOODS_HEADWAY,
  GOODS_MIN,
  GOODS_SECONDS,
  GOODS_STAND,
  goodsSeconds,
  headway,
  measure,
  pull,
  route,
  RUN_OUT,
  seconds,
  TWEEN_MAX,
  TWEEN_MIN,
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

// Where goods are, the seconds after their message, as scene.ts moves them:
// nowhere while they wait for their headway and after they have faded.
function seen(way: "out" | "in", speed: number, wait: number, after: number): Point | undefined {
  const took = goodsSeconds(speed);
  const elapsed = after - wait;
  if (elapsed < 0 || elapsed >= took + (way === "in" ? GOODS_STAND : 0) + TWEEN_MIN) return undefined;
  const { x, z } = along(goods(peer, EDGE, way), (way === "out" ? pull : brake)(Math.min(1, elapsed / took)));
  return { x, z };
}

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

  test("two messages do not share a position", () => {
    // Sent together one way: the second keeps its headway.
    expect(headway(3, undefined)).toBe(0);
    expect(headway(3, 3)).toBe(GOODS_HEADWAY);
    expect(headway(3 + GOODS_HEADWAY, 3)).toBe(0);
    // The one before has stood and faded when the next comes to a stand.
    expect(GOODS_STAND + TWEEN_MIN).toBeLessThan(GOODS_HEADWAY);
    for (const speed of [1, 600]) {
      for (const way of ["out", "in"] as const) {
        let both = 0;
        for (let after = 0; after < 8; after += 0.05) {
          const first = seen(way, speed, 0, after);
          const second = seen(way, speed, headway(0, 0), after);
          if (!first || !second) continue;
          both++;
          expect(Math.abs(first.x - second.x)).toBeGreaterThan(0);
        }
        expect(both).toBeGreaterThan(0);
      }
      // A reply that crosses a mail passes it: a rail each way.
      for (let after = 0; after < 8; after += 0.05) {
        const mail = seen("out", speed, 0, after);
        const reply = seen("in", speed, 0, after);
        if (mail && reply) expect(Math.abs(mail.z - reply.z)).toBe(2 * PEER_RAIL_Z);
      }
    }
  });
});
