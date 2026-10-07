import { describe, expect, test } from "vitest";
import snapshot from "../public/yard.json";
import { DEPOT_PITCH, layout, positions, shedGroups, SLOT_PITCH, SLOTS, STAGE_PITCH } from "../src/layout";
import type { Bead, Yard } from "../src/yard";

// The committed snapshot is the fixture: this yard, as scripts/snapshot.sh
// wrote it.
const yard = snapshot as Yard;
const copy = (): Yard => structuredClone(yard);

function bead(id: string, over: Partial<Bead>): Bead {
  return { id, title: id, type: "task", stage: "new", depot: "yardr", priority: 2, created_at: "2099-01-01T00:00:00Z", ...over };
}

// Every element of before is in after, where it was.
function expectKept(before: Yard, after: Yard) {
  const was = positions(layout(before));
  const is = positions(layout(after));
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

  test("a shed for every group flow show names at a stage, with the group's bays", () => {
    for (const { depot, flows } of yard.flows) {
      for (const flow of flows) {
        for (const stage of flow.stages) {
          const groups = shedGroups(yard, depot, flow, stage.stage);
          if (stage.group !== undefined) expect(groups, `${depot}/${flow.name}/${stage.stage}`).toContain(stage.group);
        }
      }
    }
    const builders = l.sheds.find((s) => s.key === "signalbox/default/new/yardr-builders")!;
    expect(builders.people).toBe(false);
    expect(builders.bays.length).toBe(3);
    expect(l.sheds.find((s) => s.key === "yardr/default/backlog/backlog")).toMatchObject({ people: true, bays: [] });
    // The label route's group stands after the plain one.
    expect(l.sheds.filter((s) => s.platform === "yardr/default/review").map((s) => s.group)).toEqual(["yardr-reviewers", "brakeman-reviews"]);
  });

  test("a running session is a crew in a bay of its group's shed", () => {
    const working = yard.beads.filter((b) => b.working === true && yard.groups.find((g) => g.name === b.group)?.runner !== "manual");
    const crews = l.sheds.flatMap((s) => s.bays).filter((b) => b.crew !== undefined);
    expect(crews.map((b) => b.crew!.id).sort()).toEqual(working.map((b) => b.id).sort());
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
