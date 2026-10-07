// @vitest-environment node
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import snapshot from "../public/yard.json";
import { fault as tint, lamp, loadKit, weathering, type Kit } from "../src/kit";
import { HEADSHUNT, layout, people, PLACE_X, SHED_WIDTH } from "../src/layout";
import { GOODS_END, goodsSeconds, RUN_OUT, TWEEN_MIN, WALK_MAX } from "../src/motion";
import { BACKLOG, COUPLING } from "../src/shunt";
import { describe as tip, draw, house, sign, Stock, waited, wrong } from "../src/scene";
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
  // The wagon's board has a hut of its own: the figure comes from there.
  const place = people(quiet).find((p) => p.key.startsWith("signalbox/default/new/yardr-builders#"))!;
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

  test("a session that ends badly seats its figure where it worked, back to the wagon; the next one stands it up", () => {
    const at = "2000-01-01T14:02:00Z";
    const stalled = layout({ ...yard, beads: [...idle, { ...work, working: false, fault: { kind: "stalled", at } }] });
    const crew = (stock: Stock) => stock.root.children.filter((o) => o.userData.crew === true);
    const stock = new Stock(quiet, kit);
    const figure = first(stock);
    stock.show(busy, { tween: true });
    stock.tick(WALK_MAX);
    stock.tick(1);
    expect(figure.rotation.y).toBeCloseTo(Math.PI / 2);

    stock.show(stalled, { tween: true });
    // No walk: it is where it was, and turns its back.
    expect(figure.position).toMatchObject({ x: post.at.x, z: post.at.z });
    stock.tick(1);
    expect(figure.position).toMatchObject({ x: post.at.x, z: post.at.z });
    expect(figure.position.y).toBeGreaterThan(0.4);
    expect(figure.rotation.y).toBeCloseTo(-Math.PI / 2);
    expect(stock.tick(0.1)).toBe(false);
    // The bead's under the pointer still, and the tip says what is wrong.
    expect(stock.beads).toContain(figure);
    expect(tip(figure.userData.bead as Bead, true)).toContain(`session stalled ${clock(at)}`);
    // Not out: its place at the hut has a figure again.
    expect(crew(stock).length).toBe(people(quiet).length + 1);
    const fresh = crew(stock).find((o) => o.position.x === place.at.x && o.position.z === place.at.z)!;
    expect(fresh).not.toBe(figure);

    // The next session on the bead: the one that sat, not the one at home.
    stock.show(busy, { tween: true });
    expect(crew(stock).length).toBe(people(busy).length);
    expect(crew(stock)).toContain(figure);
    expect(crew(stock)).not.toContain(fresh);
    stock.tick(1);
    expect(figure.position).toMatchObject({ x: post.at.x, z: post.at.z });
    expect(figure.rotation.y).toBeCloseTo(Math.PI / 2);

    // The bead moves on without it: the figure that sat is gone, where it sat.
    stock.show(stalled, { tween: true });
    stock.show(quiet, { tween: true });
    expect(figure.position).toMatchObject({ x: post.at.x, z: post.at.z });
    expect(stock.tick(TWEEN_MIN / 2)).toBe(true);
    expect(figure.scale.x).toBeLessThan(1);
    stock.tick(TWEEN_MIN);
    expect(crew(stock)).not.toContain(figure);
    expect(crew(stock).length).toBe(people(quiet).length);
    expect(stock.tick(0.1)).toBe(false);

    // A scrub to the fault: sat at the wagon at once.
    stock.show(stalled, { tween: false });
    const sat = crew(stock).find((o) => o.userData.bead?.id === work.id)!;
    expect(sat.position).toMatchObject({ x: post.at.x, z: post.at.z });
    expect(sat.rotation.y).toBeCloseTo(-Math.PI / 2);
    expect(crew(stock).length).toBe(people(quiet).length + 1);
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

// A fault's time of day as the tip has it: the reader's own.
const clock = (at: string) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.parse(at));

describe("the faults of the stock", () => {
  const bead = (id: string, over: Partial<Bead> = {}): Bead => ({ id, title: id, type: "task", stage: "new", depot: "signalbox", priority: 2, created_at: "2000-01-01T00:00:00Z", ...over });
  const at = (...beads: Bead[]) => layout({ ...yard, beads });
  const wagon = (stock: Stock, id: string) => stock.root.children.find((o) => (o.userData.bead as Bead | undefined)?.id === id && o.userData.crew !== true)!;
  const when = "2000-01-01T06:27:00Z";
  // The colours of a thing's parts, and of the lamps' own.
  const colours = (o: THREE.Object3D) => {
    const seen: number[] = [];
    o.traverse((part) => {
      if (part instanceof THREE.Mesh) seen.push((part.material as THREE.MeshBasicMaterial).color.getHex());
    });
    return seen;
  };
  const run = (stock: Stock) => {
    for (let n = 0; stock.tick(0.02); n++) if (n > 5000) throw new Error("the stock never came to a stand");
  };

  test("a held wagon has chocks at its wheels and a red flag, until it is let go", () => {
    const well = at(bead("signalbox-a"));
    const stock = new Stock(well, kit);
    const a = wagon(stock, "signalbox-a");
    expect(meshes(a)).toBe(1);
    stock.show(at(bead("signalbox-a", { hold: true })), { tween: true });
    expect(colours(a).filter((c) => c === tint.chock).length).toBe(2);
    expect(colours(a)).toContain(lamp.stop);
    // No chocks under it while the shunter takes it into the siding: they lie where it stands.
    const chocks = () => {
      const shown: boolean[] = [];
      a.traverse((part) => {
        if (part instanceof THREE.Mesh && (part.material as THREE.MeshBasicMaterial).color.getHex() === tint.chock) shown.push(part.parent!.visible);
      });
      return shown;
    };
    stock.tick(0.02);
    expect(chocks()).toEqual([false, false]);
    run(stock);
    expect(chocks()).toEqual([true, true]);
    // Nothing flashes for a hold: the picture comes to a stand.
    expect(stock.tick(0.1)).toBe(false);
    expect(tip(a.userData.bead as Bead, false)).toContain("· held");

    stock.show(well, { tween: true });
    expect(meshes(a)).toBe(1);
  });

  test("a refused move is a lamp on the wagon, flashing red until the bead moves", () => {
    const refused = at(bead("signalbox-a", { fault: { kind: "move_refused", at: when } }));
    const stock = new Stock(at(bead("signalbox-a")), kit);
    const a = wagon(stock, "signalbox-a");
    expect(stock.tick(0.1)).toBe(false);
    stock.show(refused, { tween: true });
    expect(meshes(a)).toBe(3);
    // Lit, dark, lit: and the picture never comes to a stand.
    const lit: boolean[] = [];
    for (let n = 0; n < 40; n++) {
      expect(stock.tick(0.05)).toBe(true);
      const seen = colours(a);
      expect(seen.includes(lamp.stop) || seen.includes(tint.dark)).toBe(true);
      lit.push(seen.includes(lamp.stop));
    }
    expect(lit).toContain(true);
    expect(lit).toContain(false);
    expect(tip(a.userData.bead as Bead, false)).toContain(`· move refused ${clock(when)}`);
    // A reader who asked for less motion sees it lit, and still.
    stock.still = true;
    expect(stock.tick(0.1)).toBe(false);
    expect(colours(a)).toContain(lamp.stop);
    stock.still = false;

    stock.show(at(bead("signalbox-a", { stage: "review" })), { tween: true });
    expect(meshes(a)).toBe(1);
    run(stock);
    expect(stock.tick(0.1)).toBe(false);
  });

  test("a bead with no route lights its platform's lamp, not its wagon's", () => {
    const lost = at(bead("signalbox-a", { fault: { kind: "unrouted", at: when } }));
    const stock = new Stock(lost, kit);
    expect(meshes(wagon(stock, "signalbox-a"))).toBe(1);
    const post = lost.lamps[0]!;
    const bulbs = () => {
      const found: THREE.Mesh[] = [];
      stock.root.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry) found.push(o);
      });
      return found;
    };
    expect(bulbs().map((b) => [b.position.x, b.position.z])).toEqual([[post.at.x, post.at.z]]);
    expect(stock.tick(0.1)).toBe(true);
    stock.show(at(bead("signalbox-a")), { tween: true });
    expect(bulbs()).toEqual([]);
    expect(stock.tick(1)).toBe(false);
  });

  test("the tip names what is wrong in words", () => {
    expect(wrong(bead("signalbox-a"))).toBeUndefined();
    expect(wrong(bead("signalbox-a", { hold: true }))).toBe("held");
    expect(wrong(bead("signalbox-a", { fault: { kind: "gave_up", at: when } }))).toBe(`session gave up ${clock(when)}`);
    expect(wrong(bead("signalbox-a", { fault: { kind: "harness_error", at: when } }))).toBe(`session harness error ${clock(when)}`);
    expect(wrong(bead("signalbox-a", { fault: { kind: "ended_question", at: when } }))).toBe(`session ended with question ${clock(when)}`);
    expect(wrong(bead("signalbox-a", { fault: { kind: "stranded", at: when } }))).toBe(`stranded ${clock(when)}`);
    expect(wrong(bead("signalbox-a", { fault: { kind: "unrouted", at: when } }))).toBe(`unrouted ${clock(when)}`);
    expect(wrong(bead("signalbox-a", { hold: true, fault: { kind: "move_refused", at: "" } }))).toBe("held · move refused");
    expect(tip(bead("signalbox-a", { fault: { kind: "move_refused", at: when } }), false)).toBe(`signalbox-a\nsignalbox-a\nsignalbox · task · new · move refused ${clock(when)}`);
  });
});

describe("the weather of the stock", () => {
  const now = Date.parse("2099-01-20T00:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const bead = (id: string, days: number, over: Partial<Bead> = {}): Bead => ({
    id,
    title: id,
    type: "task",
    stage: "backlog",
    depot: "signalbox",
    priority: 2,
    created_at: new Date(now - days * day).toISOString(),
    ...over,
  });
  // The yard a time later: every wagon that much older.
  const at = (beads: Bead[], later = 0) => layout({ ...yard, beads }, {}, now + later * day);
  const wagon = (stock: Stock, id: string) => stock.root.children.find((o) => (o.userData.bead as Bead | undefined)?.id === id)!;
  const paint = (o: THREE.Object3D) => {
    const seen: THREE.MeshStandardMaterial[] = [];
    o.traverse((part) => {
      if (part instanceof THREE.Mesh) seen.push(part.material as THREE.MeshStandardMaterial);
    });
    return seen;
  };

  test("the paint dulls, rusts, and moss grows on top; a wagon that moves on is fresh again", () => {
    const beads = [bead("signalbox-a", 0), bead("signalbox-b", 0)];
    const stock = new Stock(at(beads), kit);
    const a = wagon(stock, "signalbox-a");
    const [fresh] = paint(a);
    const tinted = (colour: number) => fresh!.color.clone().multiply(new THREE.Color(colour)).getHex();

    stock.show(at(beads, 3), { tween: true });
    expect(paint(a).map((m) => m.color.getHex())).toEqual([tinted(weathering.dull)]);
    stock.show(at(beads, 7), { tween: true });
    expect(paint(a).map((m) => m.color.getHex())).toEqual([tinted(weathering.rusted)]);
    expect(fresh!.color.getHex()).not.toBe(tinted(weathering.rusted));

    // Moss lies on the rust, on the wagon's top.
    stock.show(at(beads, 14), { tween: true });
    const mossy = paint(a);
    expect(mossy[0]!.color.getHex()).toBe(tinted(weathering.rusted));
    const moss = mossy.filter((m) => m.color.getHex() === weathering.moss);
    expect(moss.length).toBe(mossy.length - 1);
    expect(moss.length).toBeGreaterThan(0);
    const top = new THREE.Box3().setFromObject(a).max.y;
    expect(top).toBeGreaterThan(1.3);
    expect(top).toBeLessThan(1.4);
    expect((a.userData.age as number)).toBe(14);

    // Built now: it waits on the yard, and its own paint is back.
    stock.show(at(beads.map((b) => ({ ...b, stage: "new" })), 14), { tween: true });
    expect(paint(a)).toEqual([fresh]);
    expect(a.userData.age).toBeUndefined();
  });

  test("a step's paint is one material, whatever wears it", () => {
    // Two copies of one model have one material, as the kit's files do.
    const shared = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const twins: Kit = {
      ...kit,
      make: (part, pick) => (part === "wagon" ? new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.3, 1.2), shared)) : kit.make(part, pick)),
    };
    const stock = new Stock(at([bead("signalbox-a", 8), bead("signalbox-b", 9), bead("signalbox-c", 4)]), twins);
    const [a, b, c] = ["signalbox-a", "signalbox-b", "signalbox-c"].map((id) => paint(wagon(stock, id))[0]!);
    expect(a).toBe(b);
    expect(a).not.toBe(shared);
    expect(c).not.toBe(a);
    // The kit's own is as it was.
    expect(shared.color.getHex()).toBe(0x808080);
  });

  test("the tip says how long it has waited, in days", () => {
    expect(waited("backlog", 9.7)).toBe("in backlog 9 days");
    expect(waited("decide", 1.2)).toBe("in decide 1 day");
    expect(waited("decide", 0.04)).toBe("in decide under a day");
    const old = bead("signalbox-a", 9);
    expect(tip(old, false, 9.2)).toBe("signalbox-a\nsignalbox-a\nsignalbox · task · backlog\nin backlog 9 days");
    expect(tip(old, false)).toBe("signalbox-a\nsignalbox-a\nsignalbox · task · backlog");
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

  test("a shunter's job is two couplings for the page to sound: the order taken, and its wagons let go; a scrub is none", () => {
    const [from, to] = [at(bead("w", "new")), at(bead("w", "review"))];
    const stock = new Stock(from, kit);
    expect(stock.coupled).toBe(0);
    stock.show(to, { tween: true });
    expect(stock.coupled).toBe(1);
    run(stock, () => undefined);
    expect(stock.coupled).toBe(2);
    stock.coupled = 0;
    // Back by a scrub, and on again by one: nothing was seen to move.
    stock.show(from, { tween: false });
    stock.show(to, { tween: false });
    // Given up half way: the wagons were never let go of.
    stock.show(from, { tween: true });
    stock.tick(0.6);
    stock.show(to, { tween: false });
    run(stock, () => undefined);
    expect(stock.coupled).toBe(1);
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
