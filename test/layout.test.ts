import { describe, expect, test } from "vitest";
import remembered from "../public/layout.json";
import snapshot from "../public/yard.json";
import { ARM_Z, DEPOT_PITCH, FIRST_TRACK_Z, FLOW_PITCH, layout, PEER_PITCH, PEER_Z, place, positions, shedGroups, SLOT_PITCH, SLOTS, STAGE_PITCH, travelOrder } from "../src/layout";
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

  test("a platform has an arm for each session its groups may run, one beside each wagon slot; a platform of people has none", () => {
    // yardr-builders: herdr, limit 3.
    const platform = l.platforms.find((p) => p.key === "signalbox/default/new")!;
    const arms = l.arms.filter((a) => a.platform === platform.key);
    expect(arms.map((a) => a.slot)).toEqual([0, 1, 2]);
    arms.forEach((a, k) => {
      expect(a.key).toBe(`${platform.key}#${k}`);
      // On the platform's edge to its track, level with slot k.
      expect(a.at).toEqual({ x: platform.front.x - k * SLOT_PITCH, z: platform.at.z - ARM_Z });
      expect(a.reach).toBe(-1);
    });
    // An exec group of limit 1: one arm.
    expect(l.arms.filter((a) => a.platform === "signalbox/default/approved").map((a) => a.slot)).toEqual([0]);
    // backlog and decisions are manual, limit 50, with beads marked working.
    for (const stage of ["backlog", "decide"]) {
      expect(l.arms.filter((a) => a.platform === `yardr/default/${stage}`), stage).toEqual([]);
    }
    expect(yard.beads.some((b) => b.stage === "backlog" && b.working === true)).toBe(true);
    // A siding's platform lies beyond its stub: its arms reach the other way.
    const grown = copy();
    grown.groups.find((g) => g.name === "decisions")!.runner = "herdr";
    const siding = layout(grown).arms.filter((a) => a.platform === "yardr/default/decide");
    expect(siding.length).toBe(SLOTS);
    expect(siding[0]).toMatchObject({ reach: 1, at: { z: l.platforms.find((p) => p.key === "yardr/default/decide")!.at.z + ARM_Z } });
  });

  test("a group's limit beyond the platform's wagon slots adds no arm; two groups at a platform share its arms", () => {
    const grown = copy();
    grown.groups.find((g) => g.name === "yardr-builders")!.limit = 6;
    grown.groups.find((g) => g.name === "signalbox-assembly")!.limit = 2;
    grown.groups.push({ name: "auditors", runner: "herdr", limit: 1 });
    grown.routes.push({ stage: "approved", depot: "signalbox", label: "audit", group: "auditors", priority: 20 });
    const g = layout(grown);
    expect(g.arms.filter((a) => a.platform === "signalbox/default/new").length).toBe(SLOTS);
    expect(g.sheds.find((s) => s.key === "signalbox/default/new/yardr-builders")!.bays.length).toBe(6);
    expect(g.arms.filter((a) => a.platform === "signalbox/default/approved").length).toBe(3);
  });

  test("the arm at a wagon's slot works it while its session runs; the others stand idle", () => {
    const grown = copy();
    grown.beads = grown.beads.filter((b) => !(b.depot === "signalbox" && b.stage === "new"));
    grown.beads.push(bead("signalbox-idle", { depot: "signalbox", group: "yardr-builders", created_at: "2099-01-01T00:00:00Z" }));
    grown.beads.push(bead("signalbox-work", { depot: "signalbox", group: "yardr-builders", working: true, created_at: "2099-01-02T00:00:00Z" }));
    const g = layout(grown);
    const wagon = g.vehicles.find((v) => v.key === "signalbox-work")!;
    const arms = g.arms.filter((a) => a.platform === "signalbox/default/new");
    expect(arms.map((a) => a.bead?.id)).toEqual([undefined, "signalbox-work", undefined]);
    expect(arms[1]!.at.x).toBe(wagon.at.x);
    // Every session of this yard whose wagon is drawn at a platform with arms.
    const worked = l.arms.filter((a) => a.bead !== undefined);
    expect(worked.map((a) => a.bead!.id).sort()).toEqual(["signalbox-sys1", "yardr-5t76"]);
    for (const a of worked) expect(a.at.x).toBe(l.vehicles.find((v) => v.key === a.bead!.id)!.at.x);
    // Nothing but wagons and locomotives stands on the rails, and a shed's bay holds nothing.
    expect(Object.keys(g).sort()).toEqual(["arms", "boards", "boxes", "counts", "peers", "platforms", "sheds", "sidings", "tracks", "vehicles", "wire"]);
    expect(Object.keys(g.sheds.flatMap((s) => s.bays)[0]!).sort()).toEqual(["at", "key"]);
  });

  test("a bead people work at a platform with arms is no arm's", () => {
    const grown = copy();
    grown.beads = grown.beads.filter((b) => !(b.depot === "yardr" && b.stage === "review"));
    // brakeman-reviews is manual, and has a shed at yardr's review beside yardr-reviewers'.
    grown.beads.push(bead("yardr-read", { stage: "review", group: "brakeman-reviews", working: true }));
    const arms = layout(grown).arms.filter((a) => a.platform === "yardr/default/review");
    expect(arms.length).toBe(3);
    expect(arms.map((a) => a.bead)).toEqual([undefined, undefined, undefined]);
  });

  test("a session on a bead that is only counted moves no arm", () => {
    const grown = copy();
    for (let n = 0; n < SLOTS; n++) grown.beads.push(bead(`signalbox-old${n}`, { depot: "signalbox", created_at: `2000-01-0${n + 1}T00:00:00Z` }));
    const g = layout(grown);
    expect(g.vehicles.find((v) => v.key === "signalbox-sys1")).toBeUndefined();
    expect(g.arms.filter((a) => a.platform === "signalbox/default/new").map((a) => a.bead)).toEqual([undefined, undefined, undefined]);
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
