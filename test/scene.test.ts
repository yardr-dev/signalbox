// @vitest-environment node
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import snapshot from "../public/yard.json";
import { loadKit, type Kit } from "../src/kit";
import { layout, people, PLACE_X, SHED_WIDTH } from "../src/layout";
import { TWEEN_MIN, WALK_MAX } from "../src/motion";
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
    for (const part of ["station", "hut", "office", "works", "wagon", "locomotive", "rail"] as const) {
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
