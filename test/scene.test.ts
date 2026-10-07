// @vitest-environment node
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import snapshot from "../public/yard.json";
import { loadKit, type Kit } from "../src/kit";
import { HEADSHUNT, layout, people, PLACE_X, SHED_WIDTH } from "../src/layout";
import { GOODS_END, goodsSeconds, RUN_OUT, TWEEN_MIN, WALK_MAX } from "../src/motion";
import { BACKLOG, COUPLING } from "../src/shunt";
import { describe as tip, draw, house, sign, Stock } from "../src/scene";
import type { Bead, Yard } from "../src/yard";

// No file of the kit is there: every model is its box. And no page: a label
// is an element, of which the scene needs little.
let kit: Kit;
const warned: string[] = [];
beforeAll(async () => {
  vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
  class Element {
    style = {};
    ownerDocument = { defaultView: { Element } };
    parentNode = null;
    setAttribute() {}
    remove() {}
  }
  vi.stubGlobal("document", { createElement: () => new Element() });
  vi.spyOn(console, "warn").mockImplementation((text: string) => void warned.push(text));
  kit = await loadKit("/");
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const yard = snapshot as Yard;
const meshes = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((part) => {
    if (part instanceof THREE.Mesh) n++;
  });
  return n;
};

describe("a kit whose files are missing", () => {
  test("a figure is two boxes and stands as it is: no clips", () => {
    for (const outfit of ["builder", "reviewer", "crew"] as const) {
      const figure = kit.figure(outfit, 7);
      expect(meshes(figure.object), outfit).toBe(2);
      expect(figure.clips).toEqual({});
      // About a wagon's height, on the ground.
      const box = new THREE.Box3().setFromObject(figure.object);
      expect(box.min.y).toBeCloseTo(0);
      expect(box.max.y).toBeGreaterThan(1.2);
      expect(box.max.y).toBeLessThan(1.7);
    }
    // Each its own: moving one moves no other.
    expect(kit.figure("builder").object).not.toBe(kit.figure("builder").object);
  });

  test("a building, a wagon and a rail are a box each", () => {
    for (const part of ["station", "hut", "office", "works", "wagon", "locomotive", "shunter", "rail"] as const) {
      expect(meshes(kit.make(part)), part).toBe(1);
    }
    expect(warned).toContain("kit: people/character-male-e did not load, drawing a box");
    expect(warned).toContain("kit: city/building-i did not load, drawing a box");
  });
});

describe("the figures of the stock", () => {
  const idle = yard.beads.filter((b) => b.group !== "yardr-builders");
  const work: Bead = { id: "signalbox-w", title: "w", type: "task", stage: "new", depot: "signalbox", group: "yardr-builders", working: true, priority: 2, created_at: "2000-01-01T00:00:00Z" };
  const quiet = layout({ ...yard, beads: [...idle, { ...work, working: false }] });
  const busy = layout({ ...yard, beads: [...idle, work] });
  const place = people(quiet).find((p) => p.group === "yardr-builders")!;
  const post = busy.work.find((w) => w.key === work.id)!;
  // The figure of the first place of the builders' hut.
  const first = (stock: Stock) => {
    const crew = stock.root.children.filter((o) => o.userData.crew === true);
    expect(crew.length).toBe(people(quiet).length);
    return crew.find((o) => o.position.x === place.at.x && o.position.z === place.at.z) ?? crew.find((o) => o.userData.bead?.id === work.id)!;
  };

  const home = (figure: THREE.Object3D) => {
    expect(figure.position.x).toBeCloseTo(place.at.x);
    expect(figure.position.y).toBe(0);
    expect(figure.position.z).toBeCloseTo(place.at.z);
  };

  test("a session start walks one out of its place to the wagon, the end back", () => {
    const stock = new Stock(quiet, kit);
    const figure = first(stock);
    home(figure);
    expect(stock.beads).not.toContain(figure);

    stock.show(busy, { tween: true });
    // Not there at once: it has a way to go, and is on it.
    expect(figure.position).toMatchObject({ x: place.at.x, z: place.at.z });
    expect(stock.tick(WALK_MAX / 4)).toBe(true);
    const under = { x: figure.position.x, z: figure.position.z };
    expect(under).not.toEqual(place.at);
    expect(under).not.toEqual(post.at);
    // On the ground until the platform.
    expect(figure.position.y).toBe(0);
    stock.tick(WALK_MAX);
    expect(figure.position.x).toBeCloseTo(post.at.x);
    expect(figure.position.z).toBeCloseTo(post.at.z);
    // Up on the platform, turned to its wagon, and the bead's under the pointer.
    expect(figure.position.y).toBeGreaterThan(0.4);
    stock.tick(1);
    expect(figure.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(stock.beads).toContain(figure);
    expect(tip(figure.userData.bead as Bead, figure.userData.crew === true)).toContain("signalbox-w — session of yardr-builders");
    // A box figure at work moves nothing more.
    expect(stock.tick(0.1)).toBe(false);

    stock.show(quiet, { tween: true });
    stock.tick(WALK_MAX / 4);
    expect(figure.position.x).not.toBeCloseTo(post.at.x);
    stock.tick(WALK_MAX);
    home(figure);
    expect(stock.beads).not.toContain(figure);
  });

  test("an end during the walk turns the figure home from where it is", () => {
    const stock = new Stock(quiet, kit);
    const figure = first(stock);
    stock.show(busy, { tween: true });
    stock.tick(WALK_MAX / 4);
    const interrupted = { x: figure.position.x, z: figure.position.z };
    expect(interrupted).not.toEqual(place.at);
    stock.show(quiet, { tween: true });
    // It heads home from its current point instead of visiting the wagon.
    stock.tick(WALK_MAX / 4);
    expect(figure.position.x).toBeLessThan(interrupted.x);
    expect(figure.position.x).not.toBeCloseTo(post.at.x);
    stock.tick(WALK_MAX);
    home(figure);
  });

  test("the replay's speed is the walk's: at 10x it is there in a move's least, at 1x not yet", () => {
    for (const [speed, there] of [[1, false], [10, true]] as const) {
      const stock = new Stock(quiet, kit);
      const figure = first(stock);
      stock.show(busy, { tween: true, speed });
      stock.tick(TWEEN_MIN);
      expect(figure.position.x === post.at.x && figure.position.z === post.at.z, `${speed}x`).toBe(there);
    }
  });

  test("a building's door is to its platform, and no one of its crew stands behind it", () => {
    const sheds = draw(quiet, kit).sheds;
    for (const object of sheds) {
      const s = object.userData.shed as (typeof quiet.sheds)[number];
      // The kit's door looks to -z: up the page, where a main line's platform is.
      expect(object.rotation.y, s.key).toBe(s.away > 0 ? 0 : Math.PI);
      const wall = new THREE.Box3().setFromObject(object).max.x;
      for (const p of s.places) expect(p.at.x, p.key).toBeGreaterThan(wall);
    }
    expect(sheds.some((o) => (o.userData.shed as (typeof quiet.sheds)[number]).places.length > 0)).toBe(true);
  });

  test("a scrub snaps: at the wagon at once, and at home at once", () => {
    const stock = new Stock(quiet, kit);
    const figure = first(stock);
    stock.show(busy, { tween: false });
    expect(figure.position.x).toBeCloseTo(post.at.x);
    expect(figure.position.z).toBeCloseTo(post.at.z);
    expect(figure.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(stock.tick(0.1)).toBe(false);
    // In the middle of a walk too.
    stock.show(quiet, { tween: true });
    stock.tick(WALK_MAX / 4);
    stock.show(busy, { tween: false });
    expect(figure.position.x).toBeCloseTo(post.at.x);
    stock.show(quiet, { tween: false });
    home(figure);
    expect(figure.rotation.y).toBeCloseTo(-Math.PI / 2);
  });

  test("the first place is out from the door; a sign counts who is out; a building says whose it is", () => {
    const hut = quiet.sheds.find((s) => s.group === "yardr-builders")!;
    expect(place.at.x).toBeCloseTo(hut.at.x + SHED_WIDTH / 2 + PLACE_X);
    expect(sign(hut)).toBe("yardr-builders · 0 of 3 out");
    expect(sign(hut, 2)).toBe("yardr-builders · 2 of 3 out");
    expect(house(hut)).toBe("yardr-builders\nherdr · limit 3");
    const station = quiet.sheds.find((s) => s.kind === "station")!;
    expect(sign(station)).toBe(station.group);
    expect(house(station)).toBe(`${station.group}\nmanual · limit 50`);
    const works = quiet.sheds.find((s) => s.key === "signalbox/default/approved/signalbox-assembly")!;
    expect(sign(works)).toBe("signalbox-assembly · 1");
  });
});

describe("the shunters of the stock", () => {
  // signalbox's track, with nothing on it but what a test puts there.
  const TRACK = "signalbox/default";
  const bead = (id: string, stage: string): Bead => ({ id, title: id, type: "task", stage, depot: "signalbox", priority: 2, created_at: "2000-01-01T00:00:00Z" });
  const at = (...beads: Bead[]) => layout({ ...yard, beads });
  const empty = at();
  const track = empty.tracks.find((t) => t.key === TRACK)!;
  const shunter = (stock: Stock, key = TRACK) => stock.root.children.find((o) => o.userData.shunter === key)!;
  const wagon = (stock: Stock, id: string) => stock.root.children.find((o) => (o.userData.bead as Bead | undefined)?.id === id && o.userData.crew !== true);
  const stands = (l: ReturnType<typeof layout>, id: string) => l.vehicles.find((v) => v.key === id)!.at;
  // On until nothing moves: what was seen each time comes back.
  const run = <T>(stock: Stock, see: () => T): T[] => {
    const seen: T[] = [];
    for (let n = 0; stock.tick(0.02); n++) {
      seen.push(see());
      if (n > 5000) throw new Error("the stock never came to a stand");
    }
    return seen;
  };

  test("one for every track, parked on its headshunt; a peer's line has its own, and the peer's is out of sight", () => {
    const stock = new Stock(empty, kit);
    for (const t of empty.tracks) {
      expect(t.park, t.key).toEqual({ x: t.at.x - HEADSHUNT + 2, z: t.at.z });
      expect(shunter(stock, t.key).position, t.key).toMatchObject({ x: t.park!.x, y: 0, z: t.park!.z });
    }
    expect(stock.root.children.filter((o) => o.userData.shunter !== undefined).length).toBe(empty.tracks.length + 2 * empty.peers.length);
    const [line] = empty.peers;
    expect(shunter(stock, `${line!.key}/out`)).toMatchObject({ visible: true, position: { x: GOODS_END + COUPLING } });
    expect(shunter(stock, `${line!.key}/in`).visible).toBe(false);
    // No bead's: the pointer asks a wagon, not its engine.
    expect(stock.beads.some((o) => o.userData.shunter !== undefined)).toBe(false);
    expect(stock.tick(0.1)).toBe(false);
  });

  test("an advance is the shunter coming for the wagon and taking it to the next platform", () => {
    const [from, to] = [at(bead("w", "new")), at(bead("w", "review"))];
    const stock = new Stock(from, kit);
    const [engine, w] = [shunter(stock), wagon(stock, "w")!];
    stock.show(to, { tween: true });
    // Not by itself: it stands until it is fetched.
    expect(w.position).toMatchObject(stands(from, "w"));
    stock.tick(0.2);
    expect(w.position).toMatchObject(stands(from, "w"));
    expect(engine.position.x).toBeGreaterThan(track.park!.x);
    const seen = run(stock, () => ({ wagon: w.position.x, engine: engine.position.x }));
    const moving = seen.filter((s) => s.wagon > stands(from, "w").x && s.wagon < stands(to, "w").x);
    expect(moving.length).toBeGreaterThan(10);
    for (const s of moving) expect(s.engine - s.wagon).toBeCloseTo(COUPLING);
    expect(w.position).toMatchObject(stands(to, "w"));
    expect(w.rotation.y).toBe(0);
    expect(engine.position).toMatchObject(track.park!);
  });

  test("a scrub puts the wagon at its place and the shunter at its own, at once", () => {
    const [from, to] = [at(bead("w", "new")), at(bead("w", "review"))];
    const stock = new Stock(from, kit);
    stock.show(to, { tween: true });
    stock.tick(0.6);
    expect(shunter(stock).position.x).not.toBe(track.park!.x);
    stock.show(from, { tween: false });
    expect(wagon(stock, "w")!.position).toMatchObject(stands(from, "w"));
    expect(shunter(stock).position).toMatchObject(track.park!);
    expect(stock.tick(0.1)).toBe(false);
  });

  test("more moves than a shunter keeps up with are not transported: the picture is the state", () => {
    const stages = ["backlog", "new", "review", "approved", "decide"];
    const ids = ["a", "b", "c", "d"];
    const from = at(...ids.map((id, i) => bead(id, stages[i]!)));
    const to = at(...ids.map((id, i) => bead(id, stages[i + 1]!)));
    expect(ids.length).toBeGreaterThan(BACKLOG);
    const stock = new Stock(from, kit);
    stock.show(to, { tween: true });
    for (const id of ids) expect(wagon(stock, id)!.position, id).toMatchObject(stands(to, id));
    expect(shunter(stock).position).toMatchObject(track.park!);
    expect(stock.tick(0.1)).toBe(false);
    // As many as it keeps up with are taken, one after another.
    const few = new Stock(from, kit);
    few.show(at(...ids.map((id, i) => bead(id, stages[i < BACKLOG ? i + 1 : i]!))), { tween: true });
    for (const id of ids.slice(0, BACKLOG)) expect(wagon(few, id)!.position, id).toMatchObject(stands(from, id));
    run(few, () => 0);
    for (const id of ids.slice(0, BACKLOG)) expect(wagon(few, id)!.position, id).toMatchObject(stands(to, id));
  });

  test("the wagons behind close up when the one before them has been pulled away, not before", () => {
    const from = at(bead("a", "new"), { ...bead("b", "new"), created_at: "2000-01-02T00:00:00Z" });
    const to = at(bead("a", "review"), { ...bead("b", "new"), created_at: "2000-01-02T00:00:00Z" });
    const stock = new Stock(from, kit);
    const [a, b] = [wagon(stock, "a")!, wagon(stock, "b")!];
    stock.show(to, { tween: true });
    const seen = run(stock, () => ({ a: a.position.x, b: b.position.x }));
    // While the first stood, the second did too.
    for (const s of seen.filter((s) => s.a === stands(from, "a").x)) expect(s.b).toBe(stands(from, "b").x);
    expect(b.position).toMatchObject(stands(to, "b"));
    expect(stands(to, "b")).toEqual(stands(from, "a"));
  });

  test("a wagon in the way of one coming in makes room at once", () => {
    // The older bead stands first at a platform: the one there moves back.
    const young = { ...bead("b", "review"), created_at: "2000-01-02T00:00:00Z" };
    const [from, to] = [at(bead("a", "new"), young), at(bead("a", "review"), young)];
    expect(stands(to, "a")).toEqual(stands(from, "b"));
    const stock = new Stock(from, kit);
    const [a, b] = [wagon(stock, "a")!, wagon(stock, "b")!];
    stock.show(to, { tween: true });
    stock.tick(TWEEN_MIN);
    stock.tick(0.01);
    expect(b.position).toMatchObject(stands(to, "b"));
    expect(a.position).toMatchObject(stands(from, "a"));
    run(stock, () => 0);
    expect(a.position).toMatchObject(stands(to, "a"));
  });

  test("a bead that left goes out past the buffer behind the shunter, and is gone", () => {
    const stock = new Stock(at(bead("w", "approved")), kit);
    const [engine, w] = [shunter(stock), wagon(stock, "w")!];
    stock.show(empty, { tween: true, left: new Set(["w"]) });
    expect(stock.beads).not.toContain(w);
    expect(stock.root.children).toContain(w);
    const seen = run(stock, () => ({ wagon: w.position.x, engine: engine.position.x }));
    expect(Math.max(...seen.map((s) => s.wagon))).toBeCloseTo(track.at.x + track.length + RUN_OUT, 0);
    expect(Math.max(...seen.map((s) => s.engine))).toBeGreaterThan(track.at.x + track.length + RUN_OUT);
    expect(stock.root.children).not.toContain(w);
    expect(engine.position).toMatchObject(track.park!);
  });

  test("a peer's goods wait out of sight for their engine, run behind it, and are gone", () => {
    const [line] = empty.peers;
    for (const way of ["out", "in"] as const) {
      const stock = new Stock(empty, kit);
      const engine = shunter(stock, `${line!.key}/${way}`);
      const before = new Set(stock.root.children);
      stock.goods(line!.name, way, "mail", 1);
      const goods = stock.root.children.find((o) => !before.has(o))!;
      expect(goods.visible).toBe(false);
      stock.tick(goodsSeconds(1) / 2);
      expect(goods.visible && engine.visible).toBe(true);
      // The engine first, the way they go.
      expect((engine.position.x - goods.position.x) * (way === "out" ? 1 : -1)).toBeCloseTo(COUPLING);
      run(stock, () => 0);
      expect(stock.root.children).not.toContain(goods);
      expect(engine.visible).toBe(way === "out");
    }
  });
});
