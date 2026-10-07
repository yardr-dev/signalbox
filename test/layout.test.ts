import { describe, expect, test } from "vitest";
import remembered from "../public/layout.json";
import snapshot from "../public/yard.json";
import {
  atWork,
  BOX_FRONT_Z,
  CREW_Z,
  DEPOT_PITCH,
  FIRST_TRACK_Z,
  FLOW_PITCH,
  GROUND_Z,
  layout,
  PEER_PITCH,
  PEER_Z,
  people,
  place,
  PLACE_PITCH,
  PLACE_X,
  PLACE_Z,
  PLATFORM_LENGTH,
  PLATFORM_Z,
  positions,
  SHED_PITCH,
  SHED_WIDTH,
  SHED_Z,
  shedGroups,
  shedKind,
  SIDING_PLATFORM_Z,
  SIDING_SHED_Z,
  SLOT_PITCH,
  SLOTS,
  STAGE_PITCH,
  TAIL_PITCH,
  TAIL_X,
  travelOrder,
  WORK_Z,
} from "../src/layout";
import type { Bead, Flow, Yard } from "../src/yard";

// The committed snapshot is the fixture: this yard, as scripts/snapshot.sh
// wrote it.
const yard = snapshot as Yard;
const copy = (): Yard => structuredClone(yard);

function bead(id: string, over: Partial<Bead>): Bead {
  return { id, title: id, type: "task", stage: "new", depot: "yardr", priority: 2, created_at: "2099-01-01T00:00:00Z", ...over };
}

// Every element of before is in after, where it was: after is laid out with
// the slots before was given, as the page is with public/layout.json.
function expectKept(before: Yard, after: Yard) {
  const was = positions(layout(before));
  const is = positions(layout(after, place(before)));
  expect(was.size).toBeGreaterThan(0);
  for (const [key, at] of was) {
    expect(is.get(key), key).toEqual(at);
  }
  return { was, is };
}

describe("the same structure gives the same picture", () => {
  test("twice from one structure", () => {
    expect(layout(yard)).toEqual(layout(yard));
  });

  test("from a copy of it, and without changing it", () => {
    const before = JSON.stringify(yard);
    expect(layout(JSON.parse(before) as Yard)).toEqual(layout(yard));
    expect(JSON.stringify(yard)).toBe(before);
  });
});

describe("a structure that only grew keeps every old position", () => {
  test("a new stage appends a platform", () => {
    const grown = copy();
    const flow = grown.flows[0]!.flows[0]!;
    flow.stages.push({ stage: "shipped" });
    const { was, is } = expectKept(yard, grown);
    const key = `platform:${grown.flows[0]!.depot}/${flow.name}/shipped`;
    expect(was.has(key)).toBe(false);
    expect(is.get(key)!.x).toBe((flow.stages.length - 1) * STAGE_PITCH);
  });

  test("a new depot is a board below", () => {
    const grown = copy();
    grown.depots.push({ name: "zebra", kind: "git", base: "main" });
    grown.flows.push({ depot: "zebra", flows: [{ name: "default", stages: [{ stage: "backlog", human: true }, { stage: "merged", terminal: true }] }] });
    const { is } = expectKept(yard, grown);
    expect(is.get("board:zebra")!.z).toBe(yard.depots.length * DEPOT_PITCH);
  });

  test("a new peer is one more line, beyond the last", () => {
    const grown = copy();
    grown.peers.push({ name: "beyond" });
    const { is } = expectKept(yard, grown);
    expect(is.get("peer:peer/beyond")!.z).toBeLessThan(is.get("peer:peer/airy")!.z);
  });

  test("a new flow in the first depot moves no board below it", () => {
    const grown = copy();
    grown.flows[0]!.flows.push({ name: "extra", type: "extra", stages: [{ stage: "backlog", human: true }, { stage: "done", terminal: true }] });
    expectKept(yard, grown);
  });

  test("a new crew member, a wider group, a new route and a new bead", () => {
    const grown = copy();
    grown.crew.push({ name: "pointsman" });
    grown.groups.find((g) => g.name === "yardr-builders")!.limit += 2;
    grown.groups.push({ name: "auditors", runner: "herdr", limit: 2 });
    grown.routes.push({ stage: "review", depot: "yardr", label: "audit", group: "auditors", priority: 20 });
    grown.beads.push(bead("yardr-zzzz", { stage: "review" }));
    const { is } = expectKept(yard, grown);
    expect(is.has("box:crew/pointsman")).toBe(true);
    expect(is.has("shed:yardr/default/review/auditors")).toBe(true);
    expect(is.has("vehicle:yardr-zzzz")).toBe(true);
  });
});

describe("a slot once given is kept when the structure's order changes", () => {
  test("the committed layout.json holds this snapshot, as first seen", () => {
    expect(place(yard, remembered)).toEqual(remembered);
    expect(place(yard)).toEqual(remembered);
    expect(layout(yard, remembered)).toEqual(layout(yard));
  });

  test("a slot in layout.json wins over the order of first sight", () => {
    const flow = yard.flows.find((f) => f.depot === "yardr")!.flows[0]!;
    const memory = { depots: { yardr: 7 }, flows: { yardr: { [flow.name]: 2 } }, stages: { [`yardr/${flow.name}`]: { review: 9 } }, peers: { airy: 4 } };
    const at = positions(layout(yard, memory));
    expect(at.get("board:yardr")!.z).toBe(7 * DEPOT_PITCH);
    expect(at.get(`platform:yardr/${flow.name}/review`)!.x).toBe(9 * STAGE_PITCH);
    expect(at.get(`track:yardr/${flow.name}`)!.z).toBe(7 * DEPOT_PITCH + FIRST_TRACK_Z + 2 * FLOW_PITCH);
    expect(at.get("peer:peer/airy")!.z).toBe(PEER_Z - 4 * PEER_PITCH);
    // What had no slot stands after what had one, not on it.
    expect(at.get("board:aiquokka")!.z).toBe(8 * DEPOT_PITCH);
    expect(at.get(`platform:yardr/${flow.name}/backlog`)!.x).toBe(10 * STAGE_PITCH);
  });

  test("a depot named before the others is a board below, not one that pushes them down", () => {
    const grown = copy();
    grown.depots.unshift({ name: "aardvark", kind: "git", base: "main" });
    grown.flows.unshift({ depot: "aardvark", flows: [{ name: "default", stages: [{ stage: "backlog", human: true }, { stage: "merged", terminal: true }] }] });
    const { is } = expectKept(yard, grown);
    expect(is.get("board:aardvark")!.z).toBe(yard.depots.length * DEPOT_PITCH);
    // On first sight, with nothing remembered, it is the first board.
    expect(positions(layout(grown)).get("board:aardvark")!.z).toBe(0);
  });

  test("depots, flows, stages and peers listed the other way round, and a new transition", () => {
    const turned = copy();
    turned.depots.reverse();
    turned.flows.reverse();
    turned.peers.push({ name: "beyond" });
    turned.peers.reverse();
    for (const depot of turned.flows) {
      depot.flows.reverse();
      for (const flow of depot.flows) {
        // The first stage stays: a flow starts where it starts.
        flow.stages = [flow.stages[0]!, ...flow.stages.slice(1).reverse()];
        // A way from the start straight to the end changes how stages follow.
        flow.stages[0]!.next = [flow.stages.find((s) => s.terminal === true)!.stage, ...(flow.stages[0]!.next ?? [])];
      }
    }
    expectKept(yard, turned);
    // Without the slots, the same structure is another picture.
    expect(positions(layout(turned)).get("board:yardr")).not.toEqual(positions(layout(yard)).get("board:yardr"));
  });

  test("a stage that left and came back stands where it stood", () => {
    const without = copy();
    const flow = without.flows.find((f) => f.depot === "yardr")!.flows[0]!;
    flow.stages = flow.stages.filter((s) => s.stage !== "review");
    const memory = place(without, place(yard));
    expect(memory).toEqual(place(yard));
    without.flows.find((f) => f.depot === "yardr")!.flows[0]!.stages.push({ stage: "audit" });
    const key = `yardr/${flow.name}`;
    expect(place(without, memory).stages[key]!.audit).toBe(Math.max(...Object.values(memory.stages[key]!)) + 1);
  });
});

describe("a flow's stages in the order a bead travels them", () => {
  const train = yard.flows.find((f) => f.depot === "yardr")!.flows.find((f) => f.name === "yardr.train")!;

  test("flow show lists yardr.train's merged before land; the track does not", () => {
    expect(train.stages.map((s) => s.stage)).toEqual(["backlog", "open", "review", "merge", "approved", "decide", "in-pr", "merged", "land"]);
    expect(travelOrder(train)).toEqual(["backlog", "open", "review", "merge", "approved", "decide", "in-pr", "land", "merged"]);
  });

  test("yardr.train's main line ends at merged, the buffer behind it, decide off the line", () => {
    const l = layout(yard);
    const platforms = l.platforms.filter((p) => p.key.startsWith("yardr/yardr.train/")).sort((a, b) => a.at.x - b.at.x);
    expect(platforms.filter((p) => !p.siding).map((p) => p.stage)).toEqual(["backlog", "open", "review", "merge", "approved", "in-pr", "land", "merged"]);
    expect(platforms.filter((p) => p.siding).map((p) => p.stage)).toEqual(["decide"]);
    // The buffer stop is drawn at the track's right end.
    const track = l.tracks.find((t) => t.key === "yardr/yardr.train")!;
    const merged = platforms.at(-1)!;
    expect(merged.terminal).toBe(true);
    expect(track.at.x + track.length).toBe(merged.at.x + STAGE_PITCH / 2);
  });

  test("terminal stages last, what no transition reaches before them, unknown names skipped", () => {
    const flow: Flow = {
      name: "f",
      stages: [
        { stage: "a", next: ["end", "c", "nowhere", "a"] },
        { stage: "end", terminal: true },
        { stage: "lost" },
        { stage: "b", next: ["end"] },
        { stage: "c", next: ["b", "a"] },
      ],
    };
    expect(travelOrder(flow)).toEqual(["a", "c", "b", "lost", "end"]);
    expect(travelOrder({ name: "empty", stages: [] })).toEqual([]);
    // A snapshot from before stages had next: the listed order, the end last.
    expect(travelOrder({ name: "old", stages: [{ stage: "a" }, { stage: "end", terminal: true }, { stage: "b" }] })).toEqual(["a", "b", "end"]);
  });
});

describe("the mapping", () => {
  const l = layout(yard);

  test("this yard: four depots, two crew boxes, the line to airy", () => {
    expect(l.boards.map((b) => b.depot)).toEqual(["aiquokka", "signalbox", "yardr", "yardr.dev"]);
    expect(l.boxes.map((b) => b.name)).toEqual(["brakeman", "yardmaster"]);
    expect(l.peers.map((p) => p.name)).toEqual(["airy"]);
    expect(l.tracks.length).toBe(yard.flows.reduce((n, d) => n + d.flows.length, 0));
  });

  test("every open bead stands at a platform or is counted there", () => {
    const counted = l.counts.reduce((n, c) => n + c.more, 0);
    expect(l.vehicles.length + counted).toBe(yard.beads.length);
  });

  test("over three at one platform show three and a count", () => {
    const backlog = "yardr/default/backlog";
    const there = yard.beads.filter((b) => b.depot === "yardr" && b.stage === "backlog").length;
    expect(there).toBeGreaterThan(SLOTS);
    expect(l.vehicles.filter((v) => v.platform === backlog).length).toBe(SLOTS);
    expect(l.counts.find((c) => c.platform === backlog)).toMatchObject({ more: there - SLOTS, of: "beads" });
  });

  test("decide is a siding, the backlog is not; merged ends the track; review carries the signal", () => {
    const at = (stage: string) => l.platforms.find((p) => p.key === `yardr/default/${stage}`)!;
    expect(at("decide").siding).toBe(true);
    expect(at("backlog").siding).toBe(false);
    expect(at("merged").terminal).toBe(true);
    expect(at("review").signal).toBe(true);
    expect(at("new").signal).toBe(false);
  });

  test("a building for every group flow show names at a stage, of the group's kind", () => {
    for (const { depot, flows } of yard.flows) {
      for (const flow of flows) {
        for (const stage of flow.stages) {
          const groups = shedGroups(yard, depot, flow, stage.stage);
          if (stage.group !== undefined) expect(groups, `${depot}/${flow.name}/${stage.stage}`).toContain(stage.group);
        }
      }
    }
    const group = (name: string, runner: string) => ({ name, runner, limit: 1 });
    expect(shedKind(group("backlog", "manual"))).toBe("station");
    expect(shedKind(group("yardr-builders", "herdr"))).toBe("hut");
    expect(shedKind(group("yardr-reviewers", "herdr"))).toBe("office");
    expect(shedKind(group("night-shift", "herdr"))).toBe("hut");
    expect(shedKind(group("signalbox-assembly", "exec"))).toBe("works");
    // A group a route names and the yard does not list: aiquokka-landing.
    expect(shedKind(undefined)).toBe("works");
    expect(l.sheds.find((s) => s.key === "yardr/default/backlog/backlog")).toMatchObject({ kind: "station", runner: "manual", places: [] });
    expect(l.sheds.find((s) => s.key === "signalbox/default/approved/signalbox-assembly")).toMatchObject({ kind: "works", runner: "exec", limit: 1, places: [] });
    // The label route's group stands after the plain one: its plot is the second.
    expect(shedGroups(yard, "yardr", yard.flows.find((f) => f.depot === "yardr")!.flows[0]!, "review")).toEqual(["yardr-reviewers", "brakeman-reviews"]);
    const plot = (key: string) => l.sheds.find((s) => s.key === key)!.at.x - l.platforms.find((p) => p.key === key.slice(0, key.lastIndexOf("/")))!.at.x;
    expect(plot("yardr/default/review/brakeman-reviews") - plot("yardr/default/backlog/backlog")).toBeCloseTo(SHED_PITCH);
  });

  test("a crew has one building, at the first platform of its group, with a place for each session it may run", () => {
    // yardr-builders (herdr, limit 3) is routed to new in every depot; aiquokka has the first board.
    const builders = l.sheds.filter((s) => s.group === "yardr-builders");
    expect(builders.map((s) => s.key)).toEqual(["aiquokka/aiquokka/new/yardr-builders"]);
    expect(builders[0]).toMatchObject({ kind: "hut", limit: 3 });
    expect(l.sheds.filter((s) => s.group === "yardr-reviewers").map((s) => [s.key, s.kind])).toEqual([["aiquokka/aiquokka/review/yardr-reviewers", "office"]]);
    // A station and a works stand at every platform routed to them.
    expect(l.sheds.filter((s) => s.group === "backlog").length).toBeGreaterThan(1);

    // The places: in a row out from the door, on the platform's side of the building's middle.
    const hut = builders[0]!;
    expect(hut.places.map((p) => p.key)).toEqual([0, 1, 2].map((p) => `${hut.key}#${p}`));
    hut.places.forEach((p, k) => {
      expect(p.at.x).toBeCloseTo(hut.at.x + SHED_WIDTH / 2 + PLACE_X + k * PLACE_PITCH);
      expect(p.at.z).toBeCloseTo(hut.at.z - PLACE_Z);
    });
    // Beyond three, a second row on the other side; further rows extend away.
    const grown = copy();
    grown.groups.find((g) => g.name === "yardr-builders")!.limit = 8;
    const wide = layout(grown).sheds.find((s) => s.key === hut.key)!;
    expect(wide.limit).toBe(8);
    expect(wide.places.length).toBe(wide.limit);
    expect(wide.places.slice(0, 3)).toEqual(hut.places);
    expect(wide.places[3]!.at).toEqual({ x: hut.places[0]!.at.x, z: hut.at.z + PLACE_Z });
    expect(wide.places[6]!.at).toEqual({ x: hut.places[0]!.at.x, z: hut.at.z + PLACE_Z + PLACE_PITCH });
    expect(new Set(wide.places.map((p) => `${p.at.x}/${p.at.z}`)).size).toBe(wide.limit);
    // The first platform is the one of the lowest slots, not the first listed.
    const turned = copy();
    turned.depots.reverse();
    turned.flows.reverse();
    expect(layout(turned, remembered).sheds.filter((s) => s.group === "yardr-builders").map((s) => s.key)).toEqual([hut.key]);
  });

  test("a figure for every place: at work beside its wagon's slot while a session runs, else idle at its place", () => {
    const grown = copy();
    grown.beads = grown.beads.filter((b) => b.group !== "yardr-builders" && !(b.depot === "signalbox" && b.stage === "new"));
    grown.beads.push(bead("signalbox-idle", { depot: "signalbox", group: "yardr-builders", created_at: "2099-01-01T00:00:00Z" }));
    grown.beads.push(bead("signalbox-work", { depot: "signalbox", group: "yardr-builders", working: true, created_at: "2099-01-02T00:00:00Z" }));
    const g = layout(grown);
    const platform = g.platforms.find((p) => p.key === "signalbox/default/new")!;
    const wagon = g.vehicles.find((v) => v.key === "signalbox-work")!;
    expect(g.work).toEqual([
      {
        key: "signalbox-work",
        bead: wagon.bead,
        group: "yardr-builders",
        platform: platform.key,
        slot: 1,
        // On the platform's edge to its track, level with its wagon; the gate behind the platform.
        at: { x: wagon.at.x, z: platform.at.z - WORK_Z },
        gate: { x: wagon.at.x, z: platform.at.z - PLATFORM_Z + SHED_Z - GROUND_Z },
        reach: -1,
      },
    ]);
    const hut = g.sheds.find((s) => s.group === "yardr-builders")!;
    const crew = people(g).filter((p) => p.group === "yardr-builders");
    expect(crew.map((p) => p.key)).toEqual(hut.places.map((p) => p.key));
    // The first at home goes: it looks at its wagon. The others look down the page.
    expect(crew[0]).toEqual({ key: hut.places[0]!.key, outfit: "builder", group: "yardr-builders", at: g.work[0]!.at, gate: g.work[0]!.gate, faces: -1, platform: platform.key, bead: wagon.bead });
    for (const k of [1, 2]) {
      expect(crew[k]).toEqual({ key: hut.places[k]!.key, outfit: "builder", group: "yardr-builders", at: hut.places[k]!.at, gate: { x: hut.places[k]!.at.x, z: hut.at.z - GROUND_Z }, faces: 1 });
    }
    expect(people(g).filter((p) => p.group === "yardr-reviewers").map((p) => p.outfit)).toEqual(["reviewer", "reviewer", "reviewer"]);

    // Every session of this yard's crews: both of yardr-builders, each at its wagon.
    expect(l.work.map((w) => w.key).sort()).toEqual(["signalbox-sys1", "yardr-5t76"]);
    for (const w of l.work) expect(w.at.x).toBe(l.vehicles.find((v) => v.key === w.key)!.at.x);
    expect(Object.keys(g).sort()).toEqual(["boards", "boxes", "counts", "peers", "platforms", "sheds", "sidings", "tracks", "vehicles", "wire", "work"]);
  });

  test("the places taken are the limit less the sessions at work, and the sign's count is the sessions", () => {
    const at = (sessions: number) => {
      const grown = copy();
      grown.beads = grown.beads.filter((b) => b.group !== "yardr-builders");
      const depots = ["signalbox", "yardr", "yardr.dev"];
      for (let n = 0; n < sessions; n++) grown.beads.push(bead(`w${n}`, { depot: depots[n % 3]!, group: "yardr-builders", working: true, created_at: `2000-01-0${n + 1}T00:00:00Z` }));
      return layout(grown);
    };
    for (const sessions of [0, 1, 2, 3]) {
      const g = at(sessions);
      const hut = g.sheds.find((s) => s.group === "yardr-builders")!;
      const crew = people(g).filter((p) => p.group === "yardr-builders");
      const home = hut.places.filter((place) => crew.some((p) => p.at.x === place.at.x && p.at.z === place.at.z));
      expect(home.length, `${sessions} sessions`).toBe(hut.limit - sessions);
      expect(atWork(g, "yardr-builders")).toBe(sessions);
      expect(atWork(g, "yardr-reviewers")).toBe(0);
      // Two sessions are two figures: no two of a crew stand in one spot.
      expect(new Set(crew.map((p) => `${p.at.x}/${p.at.z}`)).size).toBe(crew.length);
      expect(new Set(crew.filter((p) => p.bead).map((p) => p.key)).size).toBe(sessions);
    }
    // A fourth session of a crew of three has no figure, and is counted.
    const over = at(4);
    expect(people(over).filter((p) => p.bead !== undefined).length).toBe(3);
    expect(atWork(over, "yardr-builders")).toBe(4);
  });

  test("a session keeps its figure: the end of another sends that one home and no one else anywhere", () => {
    const grown = copy();
    grown.beads = grown.beads.filter((b) => b.group !== "yardr-builders");
    const a = bead("signalbox-a", { depot: "signalbox", group: "yardr-builders", working: true, created_at: "2000-01-01T00:00:00Z" });
    const b = bead("yardr-b", { depot: "yardr", group: "yardr-builders", working: true, created_at: "2000-01-02T00:00:00Z" });
    const both = layout({ ...grown, beads: [...grown.beads, a, b] });
    const before = people(both);
    const worker = (crew: ReturnType<typeof people>, id: string) => crew.find((p) => p.bead?.id === id)?.key;
    expect(worker(before, "signalbox-a")).not.toBe(worker(before, "yardr-b"));

    // a's session ends: b's figure stays b's, and a's is at its place again.
    const one = layout({ ...grown, beads: [...grown.beads, { ...a, working: false }, b] });
    const after = people(one, before);
    expect(worker(after, "yardr-b")).toBe(worker(before, "yardr-b"));
    const home = after.find((p) => p.key === worker(before, "signalbox-a"))!;
    expect(home.bead).toBeUndefined();
    expect(home.at).toEqual(one.sheds.find((s) => s.group === "yardr-builders")!.places.find((p) => p.key === home.key)!.at);
    // A scrub knows no before: the first at home is b's.
    expect(worker(people(one), "yardr-b")).toBe(one.sheds.find((s) => s.group === "yardr-builders")!.places[0]!.key);
    // A new session takes the first figure at home, not b's.
    const again = people(both, after);
    expect(worker(again, "yardr-b")).toBe(worker(before, "yardr-b"));
    expect(worker(again, "signalbox-a")).toBe(worker(before, "signalbox-a"));
  });

  test("a siding's platform lies beyond its stub: a figure there reaches the other way", () => {
    const grown = copy();
    grown.groups.find((g) => g.name === "decisions")!.runner = "herdr";
    grown.beads = grown.beads.filter((b) => !(b.depot === "yardr" && b.stage === "decide"));
    grown.beads.push(bead("yardr-ask", { stage: "decide", group: "decisions", working: true }));
    const g = layout(grown);
    const platform = g.platforms.find((p) => p.key === "yardr/default/decide")!;
    expect(g.work.find((w) => w.key === "yardr-ask")).toMatchObject({ reach: 1, at: { z: platform.at.z + WORK_Z }, gate: { z: platform.at.z - (SIDING_PLATFORM_Z - SIDING_SHED_Z) + GROUND_Z } });
  });

  test("a bead people work, and one a script works, is no figure's", () => {
    const grown = copy();
    grown.beads = grown.beads.filter((b) => !(b.depot === "yardr" && b.stage === "review"));
    // brakeman-reviews is manual, with a station at yardr's review; signalbox-assembly is exec.
    grown.beads.push(bead("yardr-read", { stage: "review", group: "brakeman-reviews", working: true }));
    grown.beads.push(bead("signalbox-land", { depot: "signalbox", stage: "approved", group: "signalbox-assembly", working: true }));
    const g = layout(grown);
    expect(g.work.filter((w) => w.key === "yardr-read" || w.key === "signalbox-land")).toEqual([]);
    // backlog and decisions are manual, limit 50, with beads marked working.
    expect(yard.beads.some((b) => b.stage === "backlog" && b.working === true)).toBe(true);
    expect(l.work.filter((w) => w.platform.endsWith("/backlog") || w.platform.endsWith("/decide"))).toEqual([]);
  });

  test("a session on a bead that is only counted has its figure at the platform's left end", () => {
    const grown = copy();
    for (let n = 0; n < SLOTS; n++) grown.beads.push(bead(`signalbox-old${n}`, { depot: "signalbox", created_at: `2000-01-0${n + 1}T00:00:00Z` }));
    grown.beads.push(bead("signalbox-late", { depot: "signalbox", group: "yardr-builders", working: true, created_at: "2099-01-09T00:00:00Z" }));
    const g = layout(grown);
    expect(g.vehicles.find((v) => v.key === "signalbox-sys1")).toBeUndefined();
    const platform = g.platforms.find((p) => p.key === "signalbox/default/new")!;
    const tail = g.work.filter((w) => w.platform === platform.key);
    expect(tail.map((w) => [w.key, w.slot])).toEqual([["signalbox-sys1", undefined], ["signalbox-late", undefined]]);
    tail.forEach((w, n) => expect(w.at.x - (platform.at.x - PLATFORM_LENGTH / 2)).toBeCloseTo(TAIL_X + n * TAIL_PITCH));
    expect(people(g).filter((p) => p.platform === platform.key).length).toBe(2);
  });

  test("the yard's crew members stand before their signal boxes", () => {
    const crew = people(l).filter((p) => p.outfit === "crew");
    expect(crew.map((p) => p.key)).toEqual(yard.crew.map((c) => `crew/${c.name}`));
    crew.forEach((p, c) => expect(p).toEqual({ key: p.key, outfit: "crew", at: { x: l.boxes[c]!.at.x, z: CREW_Z + BOX_FRONT_Z }, gate: { x: l.boxes[c]!.at.x, z: CREW_Z + BOX_FRONT_Z }, faces: 1 }));
  });

  test("a held bead stands in its flow's siding, whatever its stage", () => {
    const grown = copy();
    grown.beads.push(bead("signalbox-held", { depot: "signalbox", stage: "review", hold: true }));
    grown.beads.push(bead("aiquokka-held", { depot: "aiquokka", type: "pr-review", stage: "review", hold: true }));
    const g = layout(grown);
    expect(g.vehicles.find((v) => v.key === "signalbox-held")).toMatchObject({ platform: "signalbox/default/decide", bead: { stage: "review" } });
    expect(g.vehicles.find((v) => v.key === "aiquokka-held")!.platform).toBe("aiquokka/pr-review/decide");
  });

  test("a train is a locomotive on the train flow's track with its wagons coupled behind", () => {
    const grown = copy();
    grown.beads.push(bead("yardr-loco", { type: "train", stage: "open" }));
    for (let n = 0; n < 5; n++) {
      grown.beads.push(bead(`yardr-wag${n}`, { type: "wagon", stage: "new", train: "yardr-loco", created_at: `2099-01-0${n + 2}T00:00:00Z` }));
    }
    const g = layout(grown);
    const open = "yardr/yardr.train/open";
    const loco = g.vehicles.find((v) => v.key === "yardr-loco")!;
    expect(loco).toMatchObject({ kind: "locomotive", platform: open });
    const wagons = g.vehicles.filter((v) => v.bead.train === "yardr-loco");
    expect(wagons.map((v) => v.key)).toEqual(["yardr-wag0", "yardr-wag1", "yardr-wag2"]);
    wagons.forEach((w, s) => {
      expect(w.platform).toBe(open);
      expect(w.at).toEqual({ x: loco.at.x - (s + 1) * SLOT_PITCH, z: loco.at.z });
    });
    expect(g.counts.find((c) => c.platform === open)).toMatchObject({ more: 2, of: "wagons" });
    // None of them stands at the wagon flow's own platform.
    expect(g.vehicles.filter((v) => v.platform.startsWith("yardr/type/wagon/"))).toEqual([]);
  });
});
