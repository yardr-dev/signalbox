import { describe, expect, test } from "vitest";
import { RETURN_Z, SIDING_Z } from "../src/layout";
import { along, exit, measure, route, RUN_OUT, seconds, TWEEN_MAX, TWEEN_MIN, type Stop } from "../src/motion";

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
