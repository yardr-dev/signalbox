// The shunters: the engines that move the wagons. An engine is transport and
// no part of the yard: nothing of the state is an engine, and the state is
// where a wagon stands at once. A track has one shunter, parked on its
// headshunt, and a wagon whose bead moved waits where it stood until the
// shunter has come for it; a peer's line has an engine for goods out, and each of
// its goods in come behind an engine of the peer's. Pure, like motion.ts: an
// order is what the state changed, a job the shunter's ways for it, and
// Shunter the queue of one engine. scene.ts draws what they say.

import { RETURN_Z, SLOT_PITCH, type Point } from "./layout";
import {
  along,
  brake,
  ease,
  goodsSeconds,
  GOODS_STAND,
  measure,
  pull,
  route,
  RUN_OUT,
  seconds,
  TWEEN_MIN,
  type Pose,
  type Stop,
} from "./motion";

// From a wagon's middle to the middle of the shunter coupled to it: a
// wagon's place in a row.
export const COUPLING = SLOT_PITCH;
// The jobs a shunter may have before it: the one in hand and those waiting.
// With more it would never catch up: they are all done at once, unseen.
export const BACKLOG = 3;
// The seconds a shunter stands to uncouple.
export const RELEASE = 0.15;
// A vehicle's room on its rail, and the outlines on the ground of a wagon
// and of the shunter, which is the shorter.
const LENGTH = 2.8;
const WAGON = 2.7;
const ENGINE = 2.4;
const WIDTH = 1.2;

// One wagon of an order: where it stood, and where it stands now. With no
// place to go it leaves the picture: out past the buffer, or a peer's goods
// at the end of their way.
export interface Haul {
  key: string;
  from: Stop;
  to?: Stop;
}

// What a shunter is asked to move: the wagons that go together, as one
// consist, at a speed of the replay. close are the wagons that close up at
// their platform once these have gone, into the room they leave: each
// stands where it is until then.
export interface Order {
  key: string;
  wagons: Haul[];
  speed: number;
  close: { key: string; from: Point }[];
}

// The stops of a job, in order: the shunter runs to the wagon, pulls it,
// lets go of it, and runs home. Where the way turns back on itself (out of a
// siding and on along the line) it runs round to the other end between two
// pulls.
export type Leg = "fetch" | "pull" | "round" | "release" | "return";

export interface Step {
  leg: Leg;
  seconds: number;
  ease: (t: number) => number;
  // The shunter's way, and on a pull each wagon's beside it.
  engine: Point[];
  wagons: { key: string; path: Point[] }[];
  // On a track's pull: which wagon it is coupled to, and which way they go.
  // It is on its way where that is a coupling ahead of the wagon along the
  // track, whatever the two ways' lengths.
  coupled?: { to: number; way: 1 | -1 };
  // Where the shunter stands after it.
  to: Stop;
}

// The order that keeps a place, the last of some: a wagon stands there until
// that order has pulled it away, or has made room for it to close up. None
// when the place is free, or will be without a shunter.
export function keeps(orders: readonly Order[], at: Point): Order | undefined {
  const there = (p: Point) => p.x === at.x && p.z === at.z;
  return [...orders].reverse().find((o) => o.wagons.some((h) => there(h.from.at)) || o.close.some((c) => there(c.from)));
}

// How a shunter does its work: the steps of an order from where the engine
// stands, among the wagons that stand on its track, and its way home.
export interface Plan {
  job(order: Order, at: Stop, standing: ReadonlyMap<string, Point>): Step[];
  home(at: Stop, park: Stop, standing: ReadonlyMap<string, Point>): Point[];
}

// The seconds one way of a job takes at a speed of the replay: a move's at
// 1x, as much shorter as the replay is faster, and never under a move's
// least. So a job is a few seconds at 1x and a second at any speed.
export function legSeconds(length: number, speed: number): number {
  return Math.max(TWEEN_MIN, seconds(length) / speed);
}

// Whether the shunter at a pose is on top of a wagon that stands at a place:
// their outlines on the ground, the shunter's turned as its rail is.
function onTop(engine: Pose, wagon: Point): boolean {
  const along = { x: Math.cos(engine.angle), z: -Math.sin(engine.angle) };
  const axes = [{ x: 1, z: 0 }, { x: 0, z: 1 }, along, { x: -along.z, z: along.x }];
  return axes.every((axis) => {
    const reach =
      (ENGINE / 2) * Math.abs(along.x * axis.x + along.z * axis.z) +
      (WIDTH / 2) * Math.abs(-along.z * axis.x + along.x * axis.z) +
      (WAGON / 2) * Math.abs(axis.x) +
      (WIDTH / 2) * Math.abs(axis.z);
    return Math.abs((wagon.x - engine.x) * axis.x + (wagon.z - engine.z) * axis.z) < reach - 1e-9;
  });
}

// Whether the shunter on a way is ever on top of a wagon that stands. The
// lines of a track are near each other: where a way crosses from one to the
// next, an engine swings out over the rail beside it.
function fouls(path: Point[], standing: readonly Point[]): boolean {
  const steps = Math.max(1, Math.ceil(measure(path) / 0.2));
  for (let i = 0; i <= steps; i++) {
    const pose = along(path, i / steps);
    if (standing.some((wagon) => onTop(pose, wagon))) return true;
  }
  return false;
}

// The place beside a stop's line, a coupling ahead of it: on the return
// line, where nothing stands.
function beside(stop: Stop, way: 1 | -1): Stop {
  const { mouth: _, ...line } = stop;
  return { ...line, at: { x: stop.at.x + way * COUPLING, z: stop.line + RETURN_Z } };
}

// The place a coupling ahead of a stop, the way it is to go: on its own rail
// where there is rail, nothing stands, and an engine gets on and off it
// clear of what stands around; else beside it on the return line, level
// with that place. Towards a siding's buffer it is always beside: an engine
// before its wagons there would never get out.
export function ahead(stop: Stop, way: 1 | -1, standing: readonly Point[]): Stop {
  const at = { x: stop.at.x + way * COUPLING, z: stop.at.z };
  if (!stop.mouth && stop.at.z !== stop.line) return { ...stop, at };
  const z = stop.line + RETURN_Z;
  const free = stop.mouth
    ? way < 0 &&
      at.x - LENGTH / 2 >= stop.mouth.x &&
      !standing.some((p) => Math.abs(p.z - at.z) < WIDTH && p.x < at.x + LENGTH)
    : at.x - LENGTH / 2 >= (stop.head ?? -Infinity) &&
      (at.x + LENGTH / 2 <= stop.end || stop.at.x > stop.end) &&
      !standing.some((p) => Math.abs(p.z - at.z) < WIDTH && Math.abs(p.x - at.x) < LENGTH) &&
      !fouls([{ x: at.x + RETURN_Z, z }, at, { x: at.x - RETURN_Z, z }], standing);
  return free ? { ...stop, at } : beside(stop, way);
}

// Where a thing is on a way when it is level with a place along its track:
// for a way that never turns back.
function level(path: Point[], x: number): Pose {
  const lengths = path.map((_, i) => measure(path.slice(0, i + 1)));
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    if (a.x === b.x) continue;
    const t = (x - a.x) / (b.x - a.x);
    if (t > 1 && i < path.length - 1) continue;
    const gone = lengths[i - 1]! + (lengths[i]! - lengths[i - 1]!) * Math.min(1, Math.max(0, t));
    return along(path, gone / lengths.at(-1)!);
  }
  return along(path, 0);
}

// Where a way along a track turns back: the index of that point, or none.
function turning(path: Point[]): number {
  let way = 0;
  for (let i = 1; i < path.length; i++) {
    const now = Math.sign(path[i]!.x - path[i - 1]!.x);
    if (now !== 0 && way !== 0 && now !== way) return i - 1;
    if (now !== 0) way = now;
  }
  return -1;
}

// A job on a track: to the end of the consist that leads, the pull with the
// shunter a coupling ahead of it all the way, and the stand to let go. A
// wagon with no place to go is taken out past the buffer. Each wagon goes
// its own way from its place to its place, the ways of a consist as long as
// each other, so it stays coupled; the shunter is the vehicle before the
// first, on the rail where that is free and beside it where it is not.
function job(order: Order, at: Stop, standing: ReadonlyMap<string, Point>): Step[] {
  const own = new Set(order.wagons.map((h) => h.key));
  const all = [...standing.values()];
  const others = [...standing].filter(([key]) => !own.has(key)).map(([, p]) => p);
  // From the left: the last is the one in front on the way up the line.
  const hauls = [...order.wagons].sort((a, b) => a.from.at.x - b.from.at.x);
  const front = hauls.at(-1);
  if (!front) return [];
  const behind = (h: Haul) => front.from.at.x - h.from.at.x;
  const { mouth: _, ...line } = front.from;
  const out = Math.max(front.from.end, front.from.at.x) + RUN_OUT;
  // On its way out a consist has no end of the line before it: the shunter
  // stands before it over the buffer, and goes first.
  const from = hauls.map((h) => (h.to ? h.from : { ...h.from, end: Infinity }));
  const to = hauls.map((h) => h.to ?? { ...line, end: Infinity, at: { x: out - behind(h), z: line.line } });

  // The ways of the pull: one, or two where the first wagon's way turns
  // back. There the consist stands on the line, its front where the turn is.
  const whole = route(from.at(-1)!, to.at(-1)!, others);
  const turn = whole[turning(whole)];
  const middle = turn && hauls.map((h) => ({ ...line, at: { x: turn.x - behind(h), z: turn.z } }));
  const pulls = middle ? [[from, middle], [middle, to]] : [[from, to]];

  const steps: Step[] = [];
  let engine = at;
  // Alone to a place, the consist standing where it is: straight on its
  // rail, also where its last way came over the points. Where the line
  // would take it over a wagon, it goes over the return line all the way, as
  // if one stood on the line between.
  const light = (leg: Leg, place: Stop, among: Point[], stand: Stop[]) => {
    const between = { x: (engine.at.x + place.at.x) / 2, z: engine.line };
    const direct = route(engine, place, among, true);
    const path = fouls(direct, among) ? route(engine, place, [...among, between], true) : direct;
    const wagons = hauls.map((h, i) => ({ key: h.key, path: [stand[i]!.at] }));
    if (measure(path) > 0) steps.push({ leg, seconds: legSeconds(measure(path), order.speed), ease, engine: path, wagons, to: place });
    engine = place;
  };
  pulls.forEach(([a, b], n) => {
    const way = b!.at(-1)!.at.x < a!.at(-1)!.at.x ? -1 : 1;
    const lead = way > 0 ? hauls.length - 1 : 0;
    // Before the consist on its rail at either end, where it gets from
    // the one place to the other clear of the wagons; else beside it.
    let start = ahead(a![lead]!, way, others);
    let end = ahead(b![lead]!, way, others);
    if (fouls(route(start, end, others, true), others)) [start, end] = [beside(a![lead]!, way), beside(b![lead]!, way)];
    light(n === 0 ? "fetch" : "round", start, n === 0 ? all : [...others, ...a!.map((s) => s.at)], a!);
    const wagons = hauls.map((h, i) => ({ key: h.key, path: route(a![i]!, b![i]!, others) }));
    steps.push({
      leg: "pull",
      seconds: legSeconds(measure(wagons[lead]!.path), order.speed),
      ease,
      engine: route(start, end, others, true),
      wagons,
      coupled: { to: lead, way },
      to: end,
    });
    engine = end;
  });
  steps.push({ leg: "release", seconds: RELEASE, ease, engine: [engine.at], wagons: [], to: engine });
  return steps;
}

// A track's shunter.
export const shunting: Plan = {
  job,
  home: (at, park, standing) => route(at, park, [...standing.values()], true),
};

// The shunter's way before goods on theirs: a coupling ahead, all along.
export function hauling(way: Point[]): Point[] {
  const dir = way.at(-1)!.x < way[0]!.x ? -1 : 1;
  return way.map((p) => ({ x: p.x + dir * COUPLING, z: p.z }));
}

// A peer's line, one way: the goods run their way behind the engine, at
// their own pace. Out, the line's engine takes them from the yard's end
// past the edge and comes back for the next; in, an engine of the peer's
// brings them from there, stands while they are there, and goes home.
export function freight(way: Point[], dir: "out" | "in"): Plan {
  const before = hauling(way);
  const stop = (at: Point): Stop => ({ at, line: at.z, end: Infinity });
  return {
    job(order, at) {
      const steps: Step[] = [];
      const start = stop(before[0]!);
      const end = stop(before.at(-1)!);
      const back = [at.at, start.at];
      if (measure(back) > 0) steps.push({ leg: "fetch", seconds: legSeconds(measure(back), order.speed), ease, engine: back, wagons: [], to: start });
      steps.push({
        leg: "pull",
        seconds: goodsSeconds(order.speed),
        ease: dir === "out" ? pull : brake,
        engine: before,
        wagons: order.wagons.map((h) => ({ key: h.key, path: way })),
        to: end,
      });
      steps.push({ leg: "release", seconds: (dir === "in" ? GOODS_STAND : 0) + TWEEN_MIN, ease, engine: [end.at], wagons: [], to: end });
      return steps;
    },
    home: (at, park) => [at.at, park.at],
  };
}

// Where a shunter is, and the wagons of the order it has in hand. Its angle
// is the turn of its rail, as a wagon's: it is never turned round, and runs
// back as it came.
export interface Shunt {
  engine: Pose;
  wagons: { key: string; pose: Pose }[];
  leg?: Leg;
}

// One engine and its orders: taken in the order they came, a job at a time.
export class Shunter {
  // Where it stands, or stood before the step it is on.
  at: Stop;
  private readonly waiting: Order[] = [];
  // The order whose wagons it has not let go of yet.
  private hand: Order | undefined;
  private steps: Step[] = [];
  private elapsed = 0;
  private speed = 1;
  // Every wagon of its track, where the state has it.
  private stands: ReadonlyMap<string, Point> = new Map();

  constructor(
    readonly park: Stop,
    private readonly plan: Plan,
  ) {
    this.at = park;
  }

  get busy(): boolean {
    return this.steps.length > 0 || this.waiting.length > 0;
  }

  // Whether a wagon waits for it, or is behind it now.
  holds(key: string): boolean {
    return [...this.waiting, ...(this.hand ? [this.hand] : [])].some((o) => o.wagons.some((h) => h.key === key));
  }

  // The wagons of its track, as the state has them now.
  stand(stands: ReadonlyMap<string, Point>) {
    this.stands = stands;
  }

  // One more order. With too many before it none is seen: they come back,
  // for the wagons to be put where the state has them. On its way home with
  // nothing to do, it goes to the job straight from where it is.
  take(order: Order): Order[] {
    this.waiting.push(order);
    if (this.waiting.length + (this.hand ? 1 : 0) > BACKLOG) return this.snap();
    if (this.steps[0]?.leg === "return") {
      const { x, z } = this.pose().engine;
      this.at = { ...this.park, at: { x, z } };
      this.steps = [];
      this.elapsed = 0;
    }
    return [];
  }

  // The order of its own that keeps a place.
  keeps(at: Point): Order | undefined {
    return keeps([...(this.hand ? [this.hand] : []), ...this.waiting], at);
  }

  // Everything it has, given up: the orders come back, and it is parked.
  snap(): Order[] {
    const orders = [...(this.hand ? [this.hand] : []), ...this.waiting];
    this.waiting.length = 0;
    this.hand = undefined;
    this.steps = [];
    this.elapsed = 0;
    this.at = this.park;
    return orders;
  }

  // Where every wagon of the track is, not where the state has it: one an
  // order waits for stands where the first such order finds it.
  private standing(): Map<string, Point> {
    const at = new Map(this.stands);
    for (const order of [...(this.hand ? [this.hand] : []), ...this.waiting].reverse()) {
      for (const c of order.close) at.set(c.key, c.from);
      for (const h of order.wagons) at.set(h.key, h.from.at);
    }
    return at;
  }

  // What it does next: the order that waited longest, else the way home.
  // False when it is parked with nothing to do.
  private next(): boolean {
    this.elapsed = 0;
    const order = this.waiting.shift();
    if (order) {
      this.hand = order;
      this.speed = order.speed;
      this.steps = this.plan.job(order, this.at, this.standing());
      return true;
    }
    const path = this.plan.home(this.at, this.park, this.standing());
    if (measure(path) === 0) return false;
    this.steps = [{ leg: "return", seconds: legSeconds(measure(path), this.speed), ease, engine: path, wagons: [], to: this.park }];
    return true;
  }

  // On by a time in seconds. The orders whose wagons it let go of in that
  // time come back, in order: they stand where it took them.
  tick(dt: number): Order[] {
    const released: Order[] = [];
    let left = dt;
    while (this.steps.length > 0 || this.next()) {
      const step = this.steps[0];
      // An order of no wagons is no job.
      if (!step) {
        this.hand = undefined;
        continue;
      }
      const rest = step.seconds - this.elapsed;
      if (left < rest) {
        this.elapsed += left;
        break;
      }
      left -= rest;
      this.elapsed = 0;
      this.at = step.to;
      this.steps.shift();
      if (step.leg === "pull" && this.steps[0]?.leg !== "round" && this.hand) {
        released.push(this.hand);
        this.hand = undefined;
      }
    }
    return released;
  }

  pose(): Shunt {
    const step = this.steps[0];
    if (!step) return { engine: { ...this.at.at, angle: 0 }, wagons: [] };
    const part = step.ease(Math.min(1, this.elapsed / step.seconds));
    const wagons = step.wagons.map((w) => ({ key: w.key, pose: along(w.path, part) }));
    const lead = step.coupled && wagons[step.coupled.to];
    const engine = step.coupled && lead ? level(step.engine, lead.pose.x + step.coupled.way * COUPLING) : along(step.engine, part);
    return { engine, wagons, leg: step.leg };
  }
}
