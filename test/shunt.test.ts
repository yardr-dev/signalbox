import { describe, expect, test } from "vitest";
import { PEER_LENGTH, RETURN_Z, SIDING_Z, SLOT_PITCH, type Point } from "../src/layout";
import { goods, goodsSeconds, GOODS_END, GOODS_STAND, RUN_OUT, TWEEN_MAX, TWEEN_MIN, type Pose, type Stop } from "../src/motion";
import { ahead, BACKLOG, COUPLING, freight, hauling, legSeconds, RELEASE, Shunter, shunting, type Leg, type Order } from "../src/shunt";

// A track along z = 10 from its headshunt at x = -12 to its buffer at 54:
// platforms a stage's pitch apart from x = 0, the third (24) a siding.
const LINE = 10;
const track = { line: LINE, end: 54, head: -12 };
const main = (x: number): Stop => ({ at: { x, z: LINE }, ...track });
// A wagon's place at a platform: the first at the front.
const slot = (platform: number, s: number): Stop => main(platform * 12 + SLOT_PITCH - s * SLOT_PITCH);
const mouth = { x: 24 - 4.7, z: LINE + SIDING_Z };
const stub = (s: number): Stop => ({ at: { x: 24 + SLOT_PITCH - s * SLOT_PITCH, z: LINE + SIDING_Z }, ...track, mouth });
const park = main(-10);

// Whether two vehicles are on top of each other: their outlines on the
// ground, each turned as it is drawn. A wagon is 2.7 long, the diesel 2.4,
// both 1.2 wide.
function onTop(a: Pose, long: number, b: Pose, other: number): boolean {
  const box = (p: Pose, length: number) => {
    const along = { x: Math.cos(p.angle), z: -Math.sin(p.angle) };
    return { p, axes: [along, { x: -along.z, z: along.x }], half: [length / 2, 0.6] };
  };
  const [m, n] = [box(a, long), box(b, other)];
  const reach = (of: typeof m, axis: Point) => of.axes.reduce((r, ax, i) => r + Math.abs(ax.x * axis.x + ax.z * axis.z) * of.half[i]!, 0);
  return [...m.axes, ...n.axes].every((axis) => Math.abs((a.x - b.x) * axis.x + (a.z - b.z) * axis.z) < reach(m, axis) + reach(n, axis) - 1e-9);
}

// A track as scene.ts keeps it: the state, in which a wagon stands at once
// where its bead went, and the picture, in which it stands until the shunter
// has taken it there.
class Yard {
  readonly shunter = new Shunter(park, shunting);
  readonly state = new Map<string, Stop>();
  readonly seen = new Map<string, Pose>();
  // What the shunter did, in order, and the orders it let go of.
  readonly legs: Leg[] = [];
  readonly released: string[] = [];
  seconds = 0;

  constructor(stands: Record<string, Stop>) {
    for (const [key, stop] of Object.entries(stands)) {
      this.state.set(key, stop);
      this.seen.set(key, { ...stop.at, angle: 0 });
    }
    this.told();
  }

  private told() {
    this.shunter.stand(new Map([...this.state].map(([key, stop]) => [key, stop.at])));
  }

  // The state changed: these wagons went together, to their places or out.
  move(wagons: Record<string, Stop | undefined>, speed = 1): Order[] {
    const order: Order = { key: Object.keys(wagons).join("+"), wagons: [], speed, close: [] };
    for (const [key, to] of Object.entries(wagons)) {
      order.wagons.push({ key, from: this.state.get(key)!, ...(to ? { to } : {}) });
      if (to) this.state.set(key, to);
      else this.state.delete(key);
    }
    this.told();
    return this.shunter.take(order);
  }

  // On by a time. each is called with where the shunter is.
  tick(dt: number, each?: (engine: Pose, leg: Leg | undefined) => void) {
    for (const order of this.shunter.tick(dt)) {
      this.released.push(order.key);
      for (const h of order.wagons) {
        if (h.to) this.seen.set(h.key, { ...h.to.at, angle: 0 });
        else this.seen.delete(h.key);
      }
    }
    const { engine, wagons, leg } = this.shunter.pose();
    for (const w of wagons) this.seen.set(w.key, w.pose);
    if (leg !== undefined && leg !== this.legs.at(-1)) this.legs.push(leg);
    this.seconds += dt;
    each?.(engine, leg);
  }

  // Until the shunter is parked again.
  run(each?: (engine: Pose, leg: Leg | undefined) => void) {
    this.tick(0, each);
    for (let n = 0; this.shunter.busy; n++) {
      this.tick(0.01, each);
      if (n > 1e5) throw new Error("the shunter never came home");
    }
  }

  // Run with the shunter clear of every wagon all the way.
  clear() {
    this.run((engine, leg) => {
      for (const [key, wagon] of this.seen) {
        expect(onTop(engine, 2.4, wagon, 2.7), `on ${key} at ${JSON.stringify(engine)} (${leg}, ${this.seconds.toFixed(2)}s)`).toBe(false);
      }
    });
  }
}

describe("the place before a wagon", () => {
  test("on its rail, a coupling ahead the way it goes", () => {
    expect(ahead(slot(1, 0), 1, [])).toEqual(main(slot(1, 0).at.x + COUPLING));
    expect(ahead(slot(1, 0), -1, [])).toEqual(slot(1, 1));
    expect(COUPLING).toBe(SLOT_PITCH);
  });

  test("beside it on the return line where a wagon stands there, or the rail ends", () => {
    const beside = (x: number) => ({ at: { x, z: LINE + RETURN_Z }, ...track });
    expect(ahead(slot(1, 1), 1, [slot(1, 0).at])).toEqual(beside(slot(1, 0).at.x));
    // A wagon on another rail is not in its place.
    expect(ahead(slot(1, 1), 1, [stub(0).at])).toEqual(slot(1, 0));
    expect(ahead(main(-9), -1, [])).toEqual(beside(-9 - COUPLING));
    expect(ahead(main(52), 1, [])).toEqual(beside(52 + COUPLING));
    // Past the buffer already, on its way out, the rail is the way itself.
    expect(ahead(main(63), 1, [])).toEqual(main(63 + COUPLING));
  });

  test("in a siding: on the stub towards its points, never towards its buffer", () => {
    expect(ahead(stub(0), -1, [])).toEqual(stub(1));
    expect(ahead(stub(0), 1, []).at).toEqual({ x: stub(0).at.x + COUPLING, z: LINE + RETURN_Z });
    expect(ahead(stub(1), 1, []).at.z).toBe(LINE + RETURN_Z);
    // Not behind a wagon that stands between it and the points, and not off the stub.
    expect(ahead(stub(0), -1, [stub(2).at]).at.z).toBe(LINE + RETURN_Z);
    expect(ahead(stub(2), -1, []).at.z).toBe(LINE + RETURN_Z);
  });
});

describe("a shunter's job", () => {
  test("one for an advance, its stops in order: fetch, pull, release, return", () => {
    const yard = new Yard({ a: slot(0, 0) });
    expect(yard.move({ a: slot(1, 0) })).toEqual([]);
    // The state has it there at once; the picture not before it was taken.
    expect(yard.state.get("a")).toEqual(slot(1, 0));
    const at: Partial<Record<Leg, Pose[]>> = {};
    const wagon: Pose[] = [];
    yard.run((engine, leg) => {
      if (leg) (at[leg] ??= []).push(engine);
      if (leg === "fetch") expect(yard.seen.get("a")).toMatchObject(slot(0, 0).at);
      if (leg === "pull") wagon.push(yard.seen.get("a")!);
    });
    expect(yard.legs).toEqual(["fetch", "pull", "release", "return"]);
    expect(yard.released).toEqual(["a"]);
    // From its place on the headshunt, round the wagon over the return line.
    expect(at.fetch![0]).toMatchObject(park.at);
    expect(at.fetch!.some((p) => p.z === LINE + RETURN_Z)).toBe(true);
    // On the rail before the wagon all the way.
    at.pull!.forEach((engine, i) => {
      expect(engine.z).toBe(LINE);
      expect(engine.x - wagon[i]!.x).toBeCloseTo(COUPLING);
      expect(engine.angle).toBeCloseTo(0);
    });
    expect(at.release![0]).toMatchObject({ x: slot(1, 0).at.x + COUPLING, z: LINE });
    expect(yard.seen.get("a")).toMatchObject(slot(1, 0).at);
    // Home again.
    expect(yard.shunter.pose()).toEqual({ engine: { ...park.at, angle: 0 }, wagons: [] });
    expect(yard.shunter.at).toEqual(park);
  });

  test("a few seconds at 1x; at a replay's speed a way is a move's least, never less", () => {
    const yard = new Yard({ a: slot(0, 0) });
    yard.move({ a: slot(1, 0) });
    yard.run();
    expect(yard.seconds).toBeGreaterThan(2);
    expect(yard.seconds).toBeLessThanOrEqual(3 * TWEEN_MAX + RELEASE + 0.02);
    for (const speed of [10, 60, 600]) {
      const fast = new Yard({ a: slot(0, 0) });
      fast.move({ a: slot(1, 0) }, speed);
      fast.run();
      expect(fast.seconds).toBeCloseTo(3 * TWEEN_MIN + RELEASE, 1);
    }
    expect(legSeconds(500, 1)).toBe(TWEEN_MAX);
    expect(legSeconds(12, 2)).toBeCloseTo(12 / 14 / 2);
    expect(legSeconds(12, 600)).toBe(TWEEN_MIN);
  });

  test("out past the buffer with a bead that left, and back alone", () => {
    const yard = new Yard({ a: slot(4, 0) });
    yard.move({ a: undefined });
    let far = 0;
    yard.run((engine, leg) => {
      if (leg === "pull") far = Math.max(far, yard.seen.get("a")!.x);
      expect(engine.z === LINE || leg !== "pull").toBe(true);
    });
    expect(far).toBeCloseTo(track.end + RUN_OUT, 0);
    expect(yard.legs).toEqual(["fetch", "pull", "release", "return"]);
    expect(yard.seen.has("a")).toBe(false);
  });

  test("into a siding it leads beside the stub, and the wagon goes over the points", () => {
    const yard = new Yard({ a: slot(1, 0) });
    yard.move({ a: stub(0) });
    const zs = new Set<number>();
    yard.run((engine, leg) => {
      if (leg !== "pull") return;
      zs.add(engine.z);
      expect(engine.x).toBeGreaterThan(yard.seen.get("a")!.x);
    });
    expect(zs.has(LINE + RETURN_Z)).toBe(true);
    expect(zs.has(LINE + SIDING_Z)).toBe(false);
    expect(yard.seen.get("a")).toMatchObject(stub(0).at);
  });

  test("where the way turns back it runs round: out of a siding, and on up the line", () => {
    const yard = new Yard({ a: stub(0) });
    yard.move({ a: slot(3, 0) });
    const sides: Partial<Record<number, number[]>> = {};
    let pulls = 0;
    yard.run((engine, leg) => {
      if (leg === "pull" && yard.legs.at(-2) !== "pull") pulls = yard.legs.filter((l) => l === "pull").length;
      if (leg === "pull") (sides[pulls] ??= []).push(Math.sign(engine.x - yard.seen.get("a")!.x));
    });
    expect(yard.legs).toEqual(["fetch", "pull", "round", "pull", "release", "return"]);
    // Before the wagon either way: left of it down the points, right of it after.
    expect(new Set(sides[1])).toEqual(new Set([-1]));
    expect(new Set(sides[2])).toEqual(new Set([1]));
    expect(yard.seen.get("a")).toMatchObject(slot(3, 0).at);
  });
});

describe("a shunter's queue", () => {
  test("three moves on one shunter are taken in order, one after another without a way home between", () => {
    const yard = new Yard({ a: slot(1, 0), b: slot(0, 0), c: slot(0, 1) });
    expect(BACKLOG).toBe(3);
    expect(yard.move({ a: slot(3, 0) })).toEqual([]);
    expect(yard.move({ b: slot(1, 0) })).toEqual([]);
    expect(yard.move({ c: slot(1, 1) })).toEqual([]);
    expect(["a", "b", "c"].map((key) => yard.shunter.holds(key))).toEqual([true, true, true]);
    yard.run(() => {
      // A wagon stands where it was until its turn.
      if (!yard.released.includes("b") && yard.legs.filter((l) => l === "pull").length < 2) expect(yard.seen.get("b")).toMatchObject(slot(0, 0).at);
    });
    expect(yard.released).toEqual(["a", "b", "c"]);
    expect(yard.legs).toEqual(["fetch", "pull", "release", "fetch", "pull", "release", "fetch", "pull", "release", "return"]);
    for (const [key, stop] of yard.state) expect(yard.seen.get(key), key).toMatchObject(stop.at);
    expect(yard.shunter.holds("a")).toBe(false);
  });

  test("a backlog over that is given up: the orders come back, and the shunter is parked", () => {
    const yard = new Yard({ a: slot(1, 0), b: slot(0, 0), c: slot(0, 1), d: slot(0, 2) });
    yard.move({ a: slot(3, 0) });
    yard.tick(0.4);
    yard.move({ b: slot(1, 0) });
    yard.move({ c: slot(1, 1) });
    const back = yard.move({ d: slot(1, 2) });
    expect(back.map((o) => o.key)).toEqual(["a", "b", "c", "d"]);
    expect(yard.shunter.busy).toBe(false);
    expect(yard.shunter.pose()).toEqual({ engine: { ...park.at, angle: 0 }, wagons: [] });
    expect(yard.shunter.tick(1)).toEqual([]);
    // It takes the next as if nothing had been.
    expect(yard.move({ a: slot(4, 0) })).toEqual([]);
  });

  test("an order that comes while it runs home turns it round there", () => {
    const yard = new Yard({ a: slot(3, 0), b: slot(1, 0) });
    yard.move({ a: slot(4, 0) });
    while (yard.legs.at(-1) !== "return") yard.tick(0.01);
    yard.tick(0.1);
    const here = yard.shunter.pose().engine;
    expect(here.x).toBeGreaterThan(park.at.x + 1);
    yard.move({ b: slot(3, 0) });
    yard.tick(0);
    expect(yard.legs.at(-1)).toBe("fetch");
    expect(yard.shunter.pose().engine).toMatchObject({ x: here.x, z: here.z });
    yard.run();
    expect(yard.legs).toEqual(["fetch", "pull", "release", "return", "fetch", "pull", "release", "return"]);
  });

  test("a place is kept by the order that will pull its wagon away, and a wagon that closes up into it stands until then", () => {
    const yard = new Yard({ a: slot(0, 0), b: slot(0, 1), c: slot(0, 2), d: slot(1, 0) });
    expect(yard.shunter.keeps(slot(0, 0).at)).toBeUndefined();
    yard.move({ d: slot(3, 0) });
    yard.move({ a: slot(1, 0) });
    const order = yard.shunter.keeps(slot(0, 0).at)!;
    expect(order.key).toBe("a");
    expect(yard.shunter.keeps(slot(0, 1).at)).toBeUndefined();
    // b closes up into a's place, and c into b's: both wait for a's order.
    order.close.push({ key: "b", from: slot(0, 1).at });
    expect(yard.shunter.keeps(slot(0, 1).at)).toBe(order);
    order.close.push({ key: "c", from: slot(0, 2).at });
    // The state has b where a stood; the shunter plans among the wagons as they stand.
    yard.state.set("b", slot(0, 0));
    yard.state.set("c", slot(0, 1));
    yard.shunter.stand(new Map([...yard.state].map(([key, stop]) => [key, stop.at])));
    yard.seen.delete("b");
    yard.seen.delete("c");
    yard.seen.set("b", { ...slot(0, 1).at, angle: 0 });
    yard.seen.set("c", { ...slot(0, 2).at, angle: 0 });
    while (yard.released.length < 2) yard.tick(0.01, (engine) => {
      for (const key of ["b", "c"]) expect(onTop(engine, 2.4, yard.seen.get(key)!, 2.7), key).toBe(false);
    });
    expect(yard.released).toEqual(["d", "a"]);
    expect(yard.shunter.keeps(slot(0, 0).at)).toBeUndefined();
  });
});

describe("a train", () => {
  test("is one job: its wagons coupled behind one another all the way, the shunter before the first", () => {
    const keys = ["train", "w1", "w2", "w3"];
    const at = (platform: number) => Object.fromEntries(keys.map((key, s) => [key, slot(platform, s)]));
    for (const [from, to] of [[0, 1], [3, 1]] as const) {
      const yard = new Yard(at(from));
      yard.move(at(to));
      let pulled = 0;
      yard.run((engine, leg) => {
        if (leg !== "pull") return;
        pulled++;
        const xs = keys.map((key) => yard.seen.get(key)!.x);
        // Up the line the train's front is its first; back, its last.
        const front = to > from ? xs[0]! : xs[3]!;
        expect(Math.abs(engine.x - front)).toBeCloseTo(COUPLING);
        expect(Math.sign(engine.x - front)).toBe(to > from ? 1 : -1);
        for (let i = 1; i < xs.length; i++) expect(xs[i - 1]! - xs[i]!).toBeCloseTo(SLOT_PITCH);
      });
      expect(pulled).toBeGreaterThan(10);
      expect(yard.legs).toEqual(["fetch", "pull", "release", "return"]);
      expect(yard.released).toEqual([keys.join("+")]);
    }
  });
});

describe("the shunter is never on top of a wagon", () => {
  // A full yard: three at the first platform, two at the next, one in the
  // siding, two further up.
  const full = () => new Yard({ a: slot(0, 0), b: slot(0, 1), c: slot(0, 2), d: slot(1, 0), e: slot(1, 1), s: stub(0), f: slot(3, 0), g: slot(3, 1) });

  test("behind the others at its platform, and to a place behind others", () => {
    const yard = full();
    yard.move({ b: slot(1, 2) });
    yard.clear();
    yard.move({ c: slot(3, 2) });
    yard.clear();
    expect(yard.released).toEqual(["b", "c"]);
  });

  test("into the siding, out of it up the line and down it", () => {
    const yard = full();
    yard.move({ e: stub(1) });
    yard.clear();
    yard.move({ s: slot(3, 2) });
    yard.clear();
    yard.move({ e: slot(1, 1) });
    yard.clear();
    expect(yard.legs.filter((l) => l === "round").length).toBe(1);
  });

  test("back along the return line, back into the siding, and out past the buffer through the yard", () => {
    const yard = full();
    yard.move({ g: slot(1, 2) });
    yard.clear();
    yard.move({ f: stub(1) });
    yard.clear();
    yard.move({ a: undefined });
    yard.clear();
    yard.move({ s: undefined });
    yard.clear();
  });

  test("with three moves waiting, each among the wagons as they stand by then", () => {
    const yard = full();
    yard.move({ d: slot(3, 2) });
    yard.move({ a: slot(1, 0) });
    yard.move({ b: slot(1, 2) });
    yard.clear();
    expect(yard.released).toEqual(["d", "a", "b"]);
    for (const [key, stop] of yard.state) expect(yard.seen.get(key), key).toMatchObject(stop.at);
  });
});

// A peer's line from x = 0 along z = -17, and a yard whose right edge is at 66.
const peer = { at: { x: 0, z: -17 }, length: PEER_LENGTH };
const EDGE = 66;

describe("a peer's goods are pulled too", () => {
  const line = (dir: "out" | "in") => {
    const way = goods(peer, EDGE, dir);
    const at = hauling(way)[0]!;
    const shunter = new Shunter({ at, line: at.z, end: Infinity }, freight(way, dir));
    const order = (key: string, speed = 1): Order => ({ key, wagons: [{ key, from: { at: way[0]!, line: at.z, end: Infinity } }], speed, close: [] });
    return { way, shunter, order };
  };

  test("out behind the line's shunter, from the yard's end past the edge; it comes back alone", () => {
    const { way, shunter, order } = line("out");
    // Parked before the place goods stand at, on their rail.
    expect(shunter.pose().engine).toEqual({ x: GOODS_END + COUPLING, z: way[0]!.z, angle: 0 });
    shunter.take(order("mail"));
    const legs: Leg[] = [];
    let seconds = 0;
    let released = 0;
    for (; shunter.busy || seconds === 0; seconds += 0.01) {
      const out = shunter.tick(0.01);
      if (out.length > 0) released = seconds;
      const { engine, wagons, leg } = shunter.pose();
      if (leg && leg !== legs.at(-1)) legs.push(leg);
      for (const w of wagons) expect(engine.x - w.pose.x).toBeCloseTo(COUPLING);
    }
    // No way to them: it stands coupled where they appear.
    expect(legs).toEqual(["pull", "release", "return"]);
    expect(released).toBeCloseTo(goodsSeconds(1), 1);
    expect(shunter.pose().engine.x).toBe(GOODS_END + COUPLING);
  });

  test("in behind an engine of the peer's, which stands while they do and goes home", () => {
    const { way, shunter, order } = line("in");
    expect(shunter.pose().engine).toEqual({ x: EDGE + RUN_OUT - COUPLING, z: way[0]!.z, angle: 0 });
    shunter.take(order("mail", 600));
    expect(shunter.tick(goodsSeconds(600) - 0.01)).toEqual([]);
    const { engine, wagons } = shunter.pose();
    expect(wagons[0]!.pose.x - engine.x).toBeCloseTo(COUPLING);
    expect(shunter.tick(0.02).map((o) => o.key)).toEqual(["mail"]);
    expect(shunter.pose()).toMatchObject({ engine: { x: GOODS_END - COUPLING }, leg: "release" });
    // On the rail still: the line begins at 0.
    expect(GOODS_END - COUPLING - 1.2).toBeGreaterThan(0);
    shunter.tick(GOODS_STAND + TWEEN_MIN);
    expect(shunter.pose().leg).toBe("return");
    shunter.tick(TWEEN_MAX);
    expect(shunter.busy).toBe(false);
  });

  test("two messages one way do not share a position: the second waits for the shunter", () => {
    const { shunter, order } = line("out");
    shunter.take(order("mail"));
    shunter.take(order("ping"));
    const seen: string[] = [];
    for (let n = 0; shunter.busy && n < 1e4; n++) {
      shunter.tick(0.01);
      const { wagons } = shunter.pose();
      expect(wagons.length).toBeLessThanOrEqual(1);
      if (wagons[0] && wagons[0].key !== seen.at(-1)) seen.push(wagons[0].key);
    }
    expect(seen).toEqual(["mail", "ping"]);
  });
});

describe("any yard, any move", () => {
  // The same moves every run.
  const dice = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const places = [0, 1, 3, 4].flatMap((p) => [0, 1, 2].map((s) => slot(p, s))).concat([0, 1, 2].map(stub));

  // A test to a seed: each has the timeout to itself, and a failure names its seed.
  const seeds = Array.from({ length: 25 }, (_, i) => i + 1);

  test.each(seeds)("the shunter keeps clear of every wagon, and every wagon ends where the state has it (seed %i)", (seed) => {
    const random = dice(seed);
    const pick = <T>(of: T[]): T => of[Math.floor(random() * of.length)]!;
    const free = [...places];
    const take = () => free.splice(Math.floor(random() * free.length), 1)[0]!;
    const yard = new Yard(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`w${i}`, take()])));
    for (let move = 0; move < 12 && yard.state.size > 0; move++) {
      // One, two or three orders at a time: the later ones wait.
      for (let n = 1 + Math.floor(random() * 3); n > 0 && yard.state.size > 0; n--) {
        const key = pick([...yard.state.keys()]);
        const from = yard.state.get(key)!;
        const to = random() < 0.15 ? undefined : take();
        free.push(from);
        expect(yard.move({ [key]: to })).toEqual([]);
      }
      yard.clear();
      for (const [key, stop] of yard.state) expect(yard.seen.get(key), key).toMatchObject(stop.at);
      expect(yard.seen.size).toBe(yard.state.size);
    }
  });
});
