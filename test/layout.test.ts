import { describe, expect, test } from "vitest";
import remembered from "../public/layout.json";
import snapshot from "../public/yard.json";
import {
  age,
  atWork,
  BOARD_GAP,
  BOARD_HEAD,
  BOX_FRONT_Z,
  coal,
  CREW_PITCH,
  CREW_Z,
  DEPOT_PITCH,
  FIRST_TRACK_Z,
  FLOW_PITCH,
  GROUND_Z,
  HEADSHUNT,
  LAMP_X,
  PARK_X,
  layout,
  left,
  PEER_PITCH,
  PEER_Z,
  people,
  place,
  PLACE_PITCH,
  PLACE_X,
  PLACE_Z,
  PLATFORM_LENGTH,
  PLATFORM_Z,
  satKey,
  positions,
  providers,
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
  TOWER_X,
  travelOrder,
  weather,
  WORK_Z,
  type Slots,
} from "../src/layout";
import type { Bead, Flow, Yard } from "../src/yard";

// The committed snapshot is the fixture: the demo yard, as scripts/demo.mjs
// wrote it.
const yard = snapshot as Yard;
const copy = (): Yard => structuredClone(yard);

function bead(id: string, over: Partial<Bead>): Bead {
  return { id, title: id, type: "task", stage: "new", depot: "wharf", priority: 2, created_at: "2099-01-01T00:00:00Z", ...over };
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
  test("a new terminal stands at the end of the track", () => {
    const grown = copy();
    const flow = grown.flows[0]!.flows[0]!;
    // A terminal stands last, so the platforms already there keep their
    // slots. A stage the order puts earlier is seated again, below.
    flow.stages.push({ stage: "shipped", terminal: true });
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
    expect(is.get("peer:peer/beyond")!.z).toBeLessThan(is.get("peer:peer/quay")!.z);
  });

  test("a new flow in the first depot moves no board below it", () => {
    const grown = copy();
    grown.flows[0]!.flows.push({ name: "extra", type: "extra", stages: [{ stage: "backlog", human: true }, { stage: "done", terminal: true }] });
    expectKept(yard, grown);
  });

  test("a new crew member, a wider group, a new route and a new bead", () => {
    const grown = copy();
    grown.crew.push({ name: "pointsman" });
    grown.groups.find((g) => g.name === "wharf-builders")!.limit += 2;
    grown.groups.push({ name: "auditors", runner: "herdr", limit: 2 });
    grown.routes.push({ stage: "review", depot: "wharf", label: "audit", group: "auditors", priority: 20 });
    grown.beads.push(bead("wharf-zzzz", { stage: "review" }));
    const { is } = expectKept(yard, grown);
    expect(is.has("box:crew/pointsman")).toBe(true);
    expect(is.has("shed:wharf/default/review/auditors")).toBe(true);
    expect(is.has("vehicle:wharf-zzzz")).toBe(true);
  });
});

describe("a depot with more flows than a board holds", () => {
  test("a fourth flow stays on its own board, under its own heading", () => {
    const grown = copy();
    grown.flows
      .find((f) => f.depot === "wharf")!
      .flows.push({
        name: "design",
        type: "design",
        stages: [{ stage: "backlog", human: true }, { stage: "draft" }, { stage: "decide", human: true }, { stage: "critique" }, { stage: "approved" }, { stage: "merged", terminal: true }],
      });
    const l = layout(grown);
    const boards = [...l.boards].sort((a, b) => a.at.z - b.at.z);
    // No board runs under the next: each ends where the next begins.
    boards.forEach((b, i) => {
      const next = boards[i + 1];
      if (next !== undefined) expect(b.at.z + b.depth).toBeLessThanOrEqual(next.at.z);
    });
    // Each track sits under its own depot's heading: on its own board, above
    // the next board's top, and carries its flow's name.
    for (const t of l.tracks) {
      const board = l.boards.find((b) => b.depot === t.depot)!;
      expect(t.flow).toBeTruthy();
      expect(t.at.z).toBeGreaterThan(board.at.z);
      expect(t.at.z).toBeLessThan(board.at.z + board.depth);
      const below = boards.find((b) => b.at.z > board.at.z);
      if (below !== undefined) expect(t.at.z).toBeLessThan(below.at.z);
    }
    // The store flow is drawn, on wharf's board, before wharf.dev's heading.
    const design = l.tracks.find((t) => t.key === "wharf/design")!;
    expect(design.flow).toBe("design");
    const wharf = l.boards.find((b) => b.depot === "wharf")!;
    const dev = l.boards.find((b) => b.depot === "wharf.dev")!;
    expect(design.at.z).toBeGreaterThan(wharf.at.z);
    expect(design.at.z).toBeLessThan(dev.at.z);
  });
});

describe("a slot once given is kept when the structure's order changes", () => {
  test("the committed layout.json holds this snapshot, as first seen", () => {
    expect(place(yard, remembered)).toEqual(remembered);
    expect(place(yard)).toEqual(remembered);
    expect(layout(yard, remembered)).toEqual(layout(yard));
  });

  test("a slot in layout.json wins over the order of first sight", () => {
    const flow = yard.flows.find((f) => f.depot === "wharf")!.flows[0]!;
    const memory = { depots: { wharf: 7 }, flows: { wharf: { [flow.name]: 2 } }, stages: { [`wharf/${flow.name}`]: { review: 9 } }, peers: { quay: 4 } };
    const at = positions(layout(yard, memory));
    expect(at.get("board:wharf")!.z).toBe(7 * DEPOT_PITCH);
    expect(at.get(`track:wharf/${flow.name}`)!.z).toBe(7 * DEPOT_PITCH + FIRST_TRACK_Z + 2 * FLOW_PITCH);
    expect(at.get("peer:peer/quay")!.z).toBe(PEER_Z - 4 * PEER_PITCH);
    // What had no slot stands after what had one, not on it: past wharf's
    // board, which holds five slots (the remembered 2, then 3 and 4).
    expect(at.get("board:gauge")!.z).toBe(7 * DEPOT_PITCH + BOARD_HEAD + 5 * FLOW_PITCH + BOARD_GAP);
    // This flow's remembered stages are not its stages, so they are seated
    // in travel order, and review does not keep slot 9.
    const order = travelOrder(flow);
    expect(at.get(`platform:wharf/${flow.name}/backlog`)!.x).toBe(order.indexOf("backlog") * STAGE_PITCH);
    expect(at.get(`platform:wharf/${flow.name}/review`)!.x).toBe(order.indexOf("review") * STAGE_PITCH);
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
    expect(positions(layout(turned)).get("board:wharf")).not.toEqual(positions(layout(yard)).get("board:wharf"));
  });
});

describe("a flow's stages are seated again when it changes", () => {
  const journey = (names: string[]): Flow["stages"] =>
    names.map((stage, i) => ({
      stage,
      ...(i < names.length - 1 ? { next: [names[i + 1]!] } : { terminal: true }),
    }));
  // Two depots, and a second flow, so a stage added to one track can be told
  // from a depot or a flow that moved.
  const yardOf = (stages: Flow["stages"]): Yard => ({
    taken_at: yard.taken_at,
    depots: [
      { name: "wharf", kind: "git", base: "main" },
      { name: "signalbox", kind: "git", base: "main" },
    ],
    flows: [
      {
        depot: "wharf",
        flows: [
          { name: "default", stages },
          { name: "other", stages: journey(["backlog", "end"]) },
        ],
      },
      { depot: "signalbox", flows: [{ name: "default", stages: journey(["backlog", "merged"]) }] },
    ],
    groups: [],
    routes: [],
    crew: [],
    peers: [{ name: "quay" }],
    beads: [],
  });
  const five = () => yardOf(journey(["backlog", "new", "review", "approved", "merged"]));
  const along = (y: Yard, memory: Partial<Slots> = {}) =>
    layout(y, memory)
      .platforms.filter((p) => p.key.startsWith("wharf/default/"))
      .sort((a, b) => a.at.x - b.at.x)
      .map((p) => p.stage);

  test("a stage added between review and approved stands there, and merged stays last", () => {
    const before = five();
    const memory = place(before);
    expect(memory.stages["wharf/default"]).toEqual({ backlog: 0, new: 1, review: 2, approved: 3, merged: 4 });
    const grown = structuredClone(before);
    grown.flows[0]!.flows[0]!.stages = journey(["backlog", "new", "review", "review-security", "approved", "merged"]);
    const after = place(grown, memory);
    expect(after.stages["wharf/default"]).toEqual({ backlog: 0, new: 1, review: 2, "review-security": 3, approved: 4, merged: 5 });
    expect(along(grown, memory)).toEqual(["backlog", "new", "review", "review-security", "approved", "merged"]);
    const merged = layout(grown, memory).platforms.find((p) => p.key === "wharf/default/merged")!;
    expect(merged.terminal).toBe(true);
    expect(merged.at.x).toBe(5 * STAGE_PITCH);
  });

  test("a flow whose stages did not change keeps its slots, gap and all", () => {
    const y = five();
    const memory: Partial<Slots> = {
      stages: { "wharf/default": { backlog: 0, new: 1, review: 4, approved: 5, merged: 8 } },
    };
    const given = structuredClone(memory);
    expect(place(y, memory).stages["wharf/default"]).toEqual(given.stages!["wharf/default"]);
    expect(memory).toEqual(given);
    // The gap stays, and the platforms still run in travel order.
    expect(along(y, memory)).toEqual(["backlog", "new", "review", "approved", "merged"]);
    const review = layout(y, memory).platforms.find((p) => p.key === "wharf/default/review")!;
    expect(review.at.x).toBe(4 * STAGE_PITCH);
  });

  test("a transition that changes the order seats the stages again", () => {
    const y = yardOf([
      { stage: "backlog", next: ["new", "review"] },
      { stage: "new", next: ["approved"] },
      { stage: "review", next: ["approved"] },
      { stage: "approved", next: ["merged"] },
      { stage: "merged", terminal: true },
    ]);
    const memory = place(y);
    expect(memory.stages["wharf/default"]).toEqual({ backlog: 0, new: 1, review: 2, approved: 3, merged: 4 });
    const turned = structuredClone(y);
    turned.flows[0]!.flows[0]!.stages[0]!.next = ["review", "new"];
    expect(place(turned, memory).stages["wharf/default"]).toEqual({ backlog: 0, review: 1, new: 2, approved: 3, merged: 4 });
    expect(along(turned, memory)).toEqual(["backlog", "review", "new", "approved", "merged"]);
    // A gap kept while the order holds is closed when the order changes.
    const gapped: Partial<Slots> = { stages: { "wharf/default": { backlog: 2, new: 3, review: 4, approved: 7, merged: 8 } } };
    expect(place(y, gapped).stages["wharf/default"]).toEqual(gapped.stages!["wharf/default"]);
    expect(place(turned, gapped).stages["wharf/default"]).toEqual({ backlog: 0, review: 1, new: 2, approved: 3, merged: 4 });
  });

  test("depots and flows keep their slots when a stage is added", () => {
    const before = five();
    const memory = place(before);
    memory.depots = { signalbox: 0, wharf: 2 };
    memory.flows = { wharf: { other: 0, default: 1 }, signalbox: { default: 4 } };
    const grown = structuredClone(before);
    grown.flows[0]!.flows[0]!.stages = journey(["backlog", "new", "review", "review-security", "approved", "merged"]);
    const after = place(grown, memory);
    expect(after.depots).toEqual({ signalbox: 0, wharf: 2 });
    expect(after.flows).toEqual(memory.flows);
    expect(after.peers).toEqual(memory.peers);
    expect(after.stages["signalbox/default"]).toEqual(memory.stages["signalbox/default"]);
    expect(after.stages["wharf/other"]).toEqual(memory.stages["wharf/other"]);
    expect(after.stages["wharf/default"]!["review-security"]).toBe(3);
  });

  test("a stage that left closes the track, and one that returns stands in the order", () => {
    const before = five();
    const memory = place(before);
    expect(memory.stages["wharf/default"]!.review).toBe(2);
    const gone = structuredClone(before);
    gone.flows[0]!.flows[0]!.stages = journey(["backlog", "new", "approved", "merged"]);
    const closed = place(gone, memory);
    // review's slot is not kept. approved stands where review stood.
    expect(closed.stages["wharf/default"]).toEqual({ backlog: 0, new: 1, approved: 2, merged: 3 });
    expect(closed.stages["wharf/default"]).not.toHaveProperty("review");
    expect(along(gone, memory)).toEqual(["backlog", "new", "approved", "merged"]);
    const back = structuredClone(before);
    back.flows[0]!.flows[0]!.stages = journey(["backlog", "new", "review", "review-security", "approved", "merged"]);
    const after = place(back, closed);
    expect(after.stages["wharf/default"]).toEqual({ backlog: 0, new: 1, review: 2, "review-security": 3, approved: 4, merged: 5 });
    expect(along(back, closed)).toEqual(["backlog", "new", "review", "review-security", "approved", "merged"]);
  });
});

describe("a flow's stages in the order a bead travels them", () => {
  const train = yard.flows.find((f) => f.depot === "wharf")!.flows.find((f) => f.name === "wharf.train")!;

  test("flow show lists wharf.train's merged before land; the track does not", () => {
    expect(train.stages.map((s) => s.stage)).toEqual(["backlog", "open", "review", "merge", "approved", "decide", "in-pr", "merged", "land"]);
    expect(travelOrder(train)).toEqual(["backlog", "open", "review", "merge", "approved", "decide", "in-pr", "land", "merged"]);
  });

  test("wharf.train's main line ends at merged, the buffer behind it, decide off the line", () => {
    const l = layout(yard);
    const platforms = l.platforms.filter((p) => p.key.startsWith("wharf/wharf.train/")).sort((a, b) => a.at.x - b.at.x);
    expect(platforms.filter((p) => !p.siding).map((p) => p.stage)).toEqual(["backlog", "open", "review", "merge", "approved", "in-pr", "land", "merged"]);
    expect(platforms.filter((p) => p.siding).map((p) => p.stage)).toEqual(["decide"]);
    // The buffer stop is drawn at the track's right end.
    const track = l.tracks.find((t) => t.key === "wharf/wharf.train")!;
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

  test("this yard: four depots, two crew boxes, the line to quay", () => {
    expect(l.boards.map((b) => b.depot)).toEqual(["gauge", "sextant", "wharf", "wharf.dev"]);
    expect(l.boxes.map((b) => b.name)).toEqual(["flagman", "yardmaster"]);
    expect(l.peers.map((p) => p.name)).toEqual(["quay"]);
    expect(l.tracks.length).toBe(yard.flows.reduce((n, d) => n + d.flows.length, 0));
    // A shunter's place: on the headshunt, clear of the first platform's wagons.
    for (const t of l.tracks) {
      expect(t.park).toEqual({ x: t.at.x + PARK_X, z: t.at.z });
      expect(t.park!.x).toBeGreaterThan(t.at.x - HEADSHUNT + 1.2);
      expect(t.park!.x + SLOT_PITCH).toBeLessThanOrEqual(-SLOT_PITCH - SLOT_PITCH);
    }
    for (const s of l.sidings) expect(s.park).toBeUndefined();
  });

  test("every open bead stands at a platform or is counted there", () => {
    const counted = l.counts.reduce((n, c) => n + c.more, 0);
    expect(l.vehicles.length + counted).toBe(yard.beads.length);
  });

  test("over three at one platform show three and a count", () => {
    const backlog = "wharf/default/backlog";
    const there = yard.beads.filter((b) => b.depot === "wharf" && b.stage === "backlog").length;
    expect(there).toBeGreaterThan(SLOTS);
    expect(l.vehicles.filter((v) => v.platform === backlog).length).toBe(SLOTS);
    expect(l.counts.find((c) => c.platform === backlog)).toMatchObject({ more: there - SLOTS, of: "beads" });
  });

  test("decide is a siding, the backlog is not; merged ends the track; review carries the signal", () => {
    const at = (stage: string) => l.platforms.find((p) => p.key === `wharf/default/${stage}`)!;
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
    expect(shedKind(group("wharf-builders", "herdr"))).toBe("hut");
    expect(shedKind(group("wharf-reviewers", "herdr"))).toBe("office");
    expect(shedKind(group("night-shift", "herdr"))).toBe("hut");
    expect(shedKind(group("sextant-assembly", "exec"))).toBe("works");
    // A group a route names and the yard does not list: gauge-landing.
    expect(shedKind(undefined)).toBe("works");
    expect(l.sheds.find((s) => s.key === "wharf/default/backlog/backlog")).toMatchObject({ kind: "station", runner: "manual", places: [] });
    expect(l.sheds.find((s) => s.key === "sextant/default/approved/sextant-assembly")).toMatchObject({ kind: "works", runner: "exec", limit: 1, places: [] });
    // The label route's group stands after the plain one: its plot is the second.
    expect(shedGroups(yard, "wharf", yard.flows.find((f) => f.depot === "wharf")!.flows[0]!, "review")).toEqual(["wharf-reviewers", "flagman-reviews"]);
    const plot = (key: string) => l.sheds.find((s) => s.key === key)!.at.x - l.platforms.find((p) => p.key === key.slice(0, key.lastIndexOf("/")))!.at.x;
    expect(plot("wharf/default/review/flagman-reviews") - plot("wharf/default/backlog/backlog")).toBeCloseTo(SHED_PITCH);
  });

  test("a crew has one building on each board, at the first platform of its group there, with a place for each session it may run", () => {
    // wharf-builders (herdr, limit 3) is routed to new in every depot: a hut on every board.
    const builders = l.sheds.filter((s) => s.group === "wharf-builders");
    expect(builders.map((s) => s.key)).toEqual(["gauge/gauge/new/wharf-builders", "sextant/default/new/wharf-builders", "wharf/default/new/wharf-builders", "wharf.dev/default/new/wharf-builders"]);
    for (const hut of builders) expect(hut).toMatchObject({ kind: "hut", limit: 3 });
    // wharf-reviewers is routed to review on both of gauge's tracks and on wharf's three: one office a board.
    expect(l.sheds.filter((s) => s.group === "wharf-reviewers").map((s) => [s.key, s.kind])).toEqual(
      ["gauge/gauge", "sextant/default", "wharf/default", "wharf.dev/default"].map((track) => [`${track}/review/wharf-reviewers`, "office"]),
    );
    // A station and a works stand at every platform routed to them.
    expect(l.sheds.filter((s) => s.group === "backlog").length).toBeGreaterThan(1);

    // The places: in a row from the door's corner down the line, on the door's side: the platform's.
    const hut = builders[0]!;
    expect(hut.places.map((p) => p.key)).toEqual([0, 1, 2].map((p) => `${hut.key}#${p}`));
    hut.places.forEach((p, k) => {
      expect(p.at.x).toBeCloseTo(hut.at.x + SHED_WIDTH / 2 + PLACE_X + k * PLACE_PITCH);
      expect(p.at.z).toBeCloseTo(hut.at.z - PLACE_Z);
    });
    // Beyond three, a second row behind the first, and so on away from the platform.
    const grown = copy();
    grown.groups.find((g) => g.name === "wharf-builders")!.limit = 8;
    const wide = layout(grown).sheds.find((s) => s.key === hut.key)!;
    expect(wide.limit).toBe(8);
    expect(wide.places.length).toBe(wide.limit);
    expect(wide.places.slice(0, 3)).toEqual(hut.places);
    expect(wide.places[3]!.at.x).toBe(hut.places[0]!.at.x);
    expect(wide.places[3]!.at.z).toBeCloseTo(hut.at.z - PLACE_Z + PLACE_PITCH);
    expect(wide.places[6]!.at.z).toBeCloseTo(hut.at.z - PLACE_Z + 2 * PLACE_PITCH);
    expect(new Set(wide.places.map((p) => `${p.at.x}/${p.at.z}`)).size).toBe(wide.limit);
    // The first platform of a board is the one of the lowest slots, not the first listed.
    const turned = copy();
    turned.depots.reverse();
    turned.flows.reverse();
    for (const { flows } of turned.flows) flows.reverse();
    expect(layout(turned, remembered).sheds.filter((s) => s.group === "wharf-reviewers").map((s) => s.key).sort()).toEqual(l.sheds.filter((s) => s.group === "wharf-reviewers").map((s) => s.key).sort());
  });

  test("two boards routed to one group: a building on each, and a session's figure comes from its own board's", () => {
    const two: Yard = {
      ...copy(),
      depots: [{ name: "a" }, { name: "b" }].map((d) => ({ ...yard.depots[0]!, ...d })),
      flows: ["a", "b"].map((depot) => ({ depot, flows: [{ name: "default", stages: [{ stage: "backlog", human: true, next: ["new"] }, { stage: "new", next: ["review"] }, { stage: "review", next: ["merged"] }, { stage: "merged", terminal: true }] }] })),
      groups: [{ ...yard.groups.find((g) => g.name === "wharf-builders")!, name: "fitters", limit: 3 }],
      routes: [
        { ...yard.routes[0]!, stage: "new", group: "fitters", depot: undefined, type: undefined },
        { ...yard.routes[0]!, stage: "review", group: "fitters", depot: undefined, type: undefined },
      ],
      beads: [bead("b-1", { depot: "b", group: "fitters", working: true })],
    };
    const g = layout(two);
    // One on each board, at new: review is routed to the group too, and has none.
    expect(g.sheds.map((s) => s.key)).toEqual(["a/default/new/fitters", "b/default/new/fitters"]);
    const [a, b] = g.sheds as [(typeof g.sheds)[number], (typeof g.sheds)[number]];
    for (const shed of [a, b]) expect(shed.places.length).toBe(shed.limit);
    expect(a.limit).toBe(3);
    // Board b's wagon is worked from b's hut, by the first at home there.
    const crew = people(g).filter((p) => p.group === "fitters");
    const worker = crew.filter((p) => p.bead !== undefined);
    expect(worker.map((p) => [p.key, p.bead!.id, p.platform])).toEqual([[b.places[0]!.key, "b-1", "b/default/new"]]);
    // The pool is the yard's: 1 of 3 out on either sign, two idle before either door.
    expect(atWork(g, "fitters")).toBe(1);
    const idle = (shed: typeof a) => crew.filter((p) => p.bead === undefined && shed.places.some((place) => place.key === p.key)).map((p) => p.key);
    expect(idle(a)).toEqual([a.places[0]!.key, a.places[1]!.key]);
    expect(idle(b)).toEqual([b.places[1]!.key, b.places[2]!.key]);
    for (const p of crew.filter((p) => p.bead === undefined)) expect(p.at).toEqual([...a.places, ...b.places].find((place) => place.key === p.key)!.at);

    // A snapshot moves no one: a second session, on board a, takes a's first
    // figure, and at b's door the last one idle is gone.
    two.beads.push(bead("a-1", { depot: "a", group: "fitters", working: true }));
    const next = layout(two);
    const then = people(next, people(g)).filter((p) => p.group === "fitters");
    expect(then.filter((p) => p.bead !== undefined).map((p) => [p.key, p.bead!.id]).sort()).toEqual([[a.places[0]!.key, "a-1"], [b.places[0]!.key, "b-1"]]);
    expect(then.filter((p) => p.bead === undefined).map((p) => p.key).sort()).toEqual([a.places[1]!.key, b.places[1]!.key]);
    // b's session ends: its figure is at b's door again, not at a's.
    two.beads = two.beads.filter((x) => x.id !== "b-1");
    const last = people(layout(two), then).filter((p) => p.group === "fitters");
    expect(last.filter((p) => p.bead === undefined).map((p) => p.key).sort()).toEqual([a.places[1]!.key, a.places[2]!.key, b.places[0]!.key, b.places[1]!.key]);
    expect(last.find((p) => p.key === b.places[0]!.key)!.at).toEqual(b.places[0]!.at);
  });

  test("a figure for every place: at work beside its wagon's slot while a session runs, else idle at its place", () => {
    const grown = copy();
    grown.beads = grown.beads.filter((b) => b.group !== "wharf-builders" && !(b.depot === "sextant" && b.stage === "new"));
    grown.beads.push(bead("sextant-idle", { depot: "sextant", group: "wharf-builders", created_at: "2099-01-01T00:00:00Z" }));
    grown.beads.push(bead("sextant-work", { depot: "sextant", group: "wharf-builders", working: true, created_at: "2099-01-02T00:00:00Z" }));
    const g = layout(grown);
    const platform = g.platforms.find((p) => p.key === "sextant/default/new")!;
    const wagon = g.vehicles.find((v) => v.key === "sextant-work")!;
    expect(g.work).toEqual([
      {
        key: "sextant-work",
        bead: wagon.bead,
        group: "wharf-builders",
        platform: platform.key,
        slot: 0,
        // On the platform's edge to its track, level with its wagon; the gate behind the platform.
        at: { x: wagon.at.x, z: platform.at.z - WORK_Z },
        gate: { x: wagon.at.x, z: platform.at.z - PLATFORM_Z + SHED_Z - GROUND_Z },
        reach: -1,
      },
    ]);
    // The wagon's board's hut: the session's figure is one of its own.
    const hut = g.sheds.find((s) => s.key === "sextant/default/new/wharf-builders")!;
    const crew = people(g).filter((p) => p.key.startsWith(`${hut.key}#`));
    expect(crew.map((p) => p.key)).toEqual(hut.places.map((p) => p.key));
    // The first at home goes: it looks at its wagon. The others look down the page.
    expect(crew[0]).toEqual({ key: hut.places[0]!.key, outfit: "builder", group: "wharf-builders", at: g.work[0]!.at, gate: g.work[0]!.gate, faces: -1, platform: platform.key, bead: wagon.bead });
    for (const k of [1, 2]) {
      expect(crew[k]).toEqual({ key: hut.places[k]!.key, outfit: "builder", group: "wharf-builders", at: hut.places[k]!.at, gate: { x: hut.places[k]!.at.x, z: hut.at.z - GROUND_Z }, faces: 1 });
    }
    const reviewers = people(g).filter((p) => p.group === "wharf-reviewers");
    expect(reviewers.length).toBe(3 * g.sheds.filter((s) => s.group === "wharf-reviewers").length);
    expect(new Set(reviewers.map((p) => p.outfit))).toEqual(new Set(["reviewer"]));

    // Every session of this yard's crews: both of wharf-builders, each at its wagon.
    expect(l.work.map((w) => w.key).sort()).toEqual(["sextant-n3wd", "wharf-z3fy"]);
    for (const w of l.work) expect(w.at.x).toBe(l.vehicles.find((v) => v.key === w.key)!.at.x);
    expect(Object.keys(g).sort()).toEqual(["boards", "boxes", "counts", "lamps", "peers", "platforms", "sheds", "sidings", "towers", "tracks", "vehicles", "wire", "work"]);
  });

  test("the places taken are the limit less the sessions at work, and the sign's count is the sessions", () => {
    const at = (sessions: number) => {
      const grown = copy();
      grown.beads = grown.beads.filter((b) => b.group !== "wharf-builders");
      const depots = ["sextant", "wharf", "wharf.dev"];
      for (let n = 0; n < sessions; n++) grown.beads.push(bead(`w${n}`, { depot: depots[n % 3]!, group: "wharf-builders", working: true, created_at: `2000-01-0${n + 1}T00:00:00Z` }));
      return layout(grown);
    };
    for (const sessions of [0, 1, 2, 3]) {
      const g = at(sessions);
      const crew = people(g).filter((p) => p.group === "wharf-builders");
      // At every hut of the group, whatever board its sessions are on.
      for (const hut of g.sheds.filter((s) => s.group === "wharf-builders")) {
        const home = hut.places.filter((place) => crew.some((p) => p.at.x === place.at.x && p.at.z === place.at.z));
        expect(home.length, `${sessions} sessions, ${hut.key}`).toBe(hut.limit - sessions);
      }
      expect(atWork(g, "wharf-builders")).toBe(sessions);
      expect(atWork(g, "wharf-reviewers")).toBe(0);
      // Two sessions are two figures: no two of a crew stand in one spot.
      expect(new Set(crew.map((p) => `${p.at.x}/${p.at.z}`)).size).toBe(crew.length);
      expect(new Set(crew.filter((p) => p.bead).map((p) => p.key)).size).toBe(sessions);
    }
    // A fourth session on a board has no figure there, a hut having three, and is counted.
    const over = copy();
    over.beads = over.beads.filter((b) => b.group !== "wharf-builders");
    for (let n = 0; n < 4; n++) over.beads.push(bead(`w${n}`, { group: "wharf-builders", working: true, created_at: `2000-01-0${n + 1}T00:00:00Z` }));
    expect(people(layout(over)).filter((p) => p.bead !== undefined).map((p) => p.key)).toEqual([0, 1, 2].map((p) => `wharf/default/new/wharf-builders#${p}`));
    expect(atWork(layout(over), "wharf-builders")).toBe(4);
    // No one stands idle anywhere for a group over its limit.
    expect(people(layout(over)).filter((p) => p.group === "wharf-builders" && p.bead === undefined)).toEqual([]);
  });

  test("a session keeps its figure: the end of another sends that one home and no one else anywhere", () => {
    const grown = copy();
    grown.beads = grown.beads.filter((b) => b.group !== "wharf-builders");
    // Both on one board: they share its hut.
    const a = bead("wharf-a", { depot: "wharf", group: "wharf-builders", working: true, created_at: "2000-01-01T00:00:00Z" });
    const b = bead("wharf-b", { depot: "wharf", group: "wharf-builders", working: true, created_at: "2000-01-02T00:00:00Z" });
    const both = layout({ ...grown, beads: [...grown.beads, a, b] });
    const before = people(both);
    const worker = (crew: ReturnType<typeof people>, id: string) => crew.find((p) => p.bead?.id === id)?.key;
    expect(worker(before, "wharf-a")).not.toBe(worker(before, "wharf-b"));

    // a's session ends: b's figure stays b's, and a's is at its place again.
    const one = layout({ ...grown, beads: [...grown.beads, { ...a, working: false }, b] });
    const after = people(one, before);
    expect(worker(after, "wharf-b")).toBe(worker(before, "wharf-b"));
    const home = after.find((p) => p.key === worker(before, "wharf-a"))!;
    expect(home.bead).toBeUndefined();
    expect(home.at).toEqual(one.sheds.find((s) => s.key === "wharf/default/new/wharf-builders")!.places.find((p) => p.key === home.key)!.at);
    // A scrub knows no before: the first at home is b's.
    expect(worker(people(one), "wharf-b")).toBe(one.sheds.find((s) => s.key === "wharf/default/new/wharf-builders")!.places[0]!.key);
    // A new session takes the first figure at home, not b's.
    const again = people(both, after);
    expect(worker(again, "wharf-b")).toBe(worker(before, "wharf-b"));
    expect(worker(again, "wharf-a")).toBe(worker(before, "wharf-a"));
  });

  test("a siding's platform lies beyond its stub: a figure there reaches the other way", () => {
    const grown = copy();
    grown.groups.find((g) => g.name === "decisions")!.runner = "herdr";
    grown.beads = grown.beads.filter((b) => !(b.depot === "wharf" && b.stage === "decide"));
    grown.beads.push(bead("wharf-ask", { stage: "decide", group: "decisions", working: true }));
    const g = layout(grown);
    const platform = g.platforms.find((p) => p.key === "wharf/default/decide")!;
    expect(g.work.find((w) => w.key === "wharf-ask")).toMatchObject({ reach: 1, at: { z: platform.at.z + WORK_Z }, gate: { z: platform.at.z - (SIDING_PLATFORM_Z - SIDING_SHED_Z) + GROUND_Z } });
  });

  test("a bead people work, and one a script works, is no figure's", () => {
    const grown = copy();
    grown.beads = grown.beads.filter((b) => !(b.depot === "wharf" && b.stage === "review"));
    // flagman-reviews is manual, with a station at wharf's review; sextant-assembly is exec.
    grown.beads.push(bead("wharf-read", { stage: "review", group: "flagman-reviews", working: true }));
    grown.beads.push(bead("sextant-land", { depot: "sextant", stage: "approved", group: "sextant-assembly", working: true }));
    const g = layout(grown);
    expect(g.work.filter((w) => w.key === "wharf-read" || w.key === "sextant-land")).toEqual([]);
    // backlog and decisions are manual, limit 50, with beads marked working.
    expect(yard.beads.some((b) => b.stage === "backlog" && b.working === true)).toBe(true);
    expect(l.work.filter((w) => w.platform.endsWith("/backlog") || w.platform.endsWith("/decide"))).toEqual([]);
  });

  test("a session takes a slot ahead of an older bead that has none", () => {
    const grown = copy();
    grown.beads = grown.beads.filter((b) => !(b.depot === "sextant" && b.stage === "new"));
    // Four loose beads, the oldest with no session: the three at work are drawn.
    grown.beads.push(bead("sextant-idle", { depot: "sextant", group: "wharf-builders", created_at: "2000-01-01T00:00:00Z" }));
    for (let n = 0; n < SLOTS; n++) grown.beads.push(bead(`sextant-w${n}`, { depot: "sextant", group: "wharf-builders", working: true, created_at: `2000-01-0${n + 2}T00:00:00Z` }));
    const g = layout(grown);
    const platform = "sextant/default/new";
    expect(g.vehicles.filter((v) => v.platform === platform).map((v) => v.key)).toEqual(["sextant-w0", "sextant-w1", "sextant-w2"]);
    expect(g.vehicles.find((v) => v.key === "sextant-idle")).toBeUndefined();
    expect(g.counts.find((c) => c.platform === platform)).toMatchObject({ more: 1, of: "beads" });
    const figures = g.work.filter((w) => w.platform === platform);
    expect(figures.map((w) => [w.key, w.slot])).toEqual([["sextant-w0", 0], ["sextant-w1", 1], ["sextant-w2", 2]]);
  });

  test("a session on a bead that is only counted has its figure at the platform's left end", () => {
    const grown = copy();
    // More sessions than slots: the later ones are only counted, and stand at the left end.
    for (let n = 0; n < SLOTS; n++) grown.beads.push(bead(`sextant-old${n}`, { depot: "sextant", group: "wharf-builders", working: true, created_at: `2000-01-0${n + 1}T00:00:00Z` }));
    grown.beads.push(bead("sextant-late", { depot: "sextant", group: "wharf-builders", working: true, created_at: "2099-01-09T00:00:00Z" }));
    const g = layout(grown);
    expect(g.vehicles.find((v) => v.key === "sextant-n3wd")).toBeUndefined();
    const platform = g.platforms.find((p) => p.key === "sextant/default/new")!;
    const tail = g.work.filter((w) => w.platform === platform.key && w.slot === undefined);
    expect(tail.map((w) => [w.key, w.slot])).toEqual([["sextant-n3wd", undefined], ["sextant-late", undefined]]);
    tail.forEach((w, n) => expect(w.at.x - (platform.at.x - PLATFORM_LENGTH / 2)).toBeCloseTo(TAIL_X + n * TAIL_PITCH));
    // The hut draws the three at the wagons. The two counted are past its places.
    expect(people(g).filter((p) => p.platform === platform.key).map((p) => p.bead?.id)).toEqual(["sextant-old0", "sextant-old1", "sextant-old2"]);
  });

  test("the yard's crew members stand before their signal boxes", () => {
    const crew = people(l).filter((p) => p.outfit === "crew");
    expect(crew.map((p) => p.key)).toEqual(yard.crew.map((c) => `crew/${c.name}`));
    crew.forEach((p, c) => expect(p).toEqual({ key: p.key, outfit: "crew", at: { x: l.boxes[c]!.at.x, z: CREW_Z + BOX_FRONT_Z }, gate: { x: l.boxes[c]!.at.x, z: CREW_Z + BOX_FRONT_Z }, faces: 1 }));
  });

  test("a held bead stands in its flow's siding, whatever its stage", () => {
    const grown = copy();
    grown.beads.push(bead("sextant-held", { depot: "sextant", stage: "review", hold: true }));
    grown.beads.push(bead("gauge-held", { depot: "gauge", type: "pr-review", stage: "review", hold: true }));
    const g = layout(grown);
    expect(g.vehicles.find((v) => v.key === "sextant-held")).toMatchObject({ platform: "sextant/default/decide", bead: { stage: "review" } });
    expect(g.vehicles.find((v) => v.key === "gauge-held")!.platform).toBe("gauge/pr-review/decide");
  });

  test("a held wagon is chocked; a fault is a lamp on the wagon, or the platform's for a bead with no route", () => {
    const grown = copy();
    const at = "2099-01-01T00:00:00Z";
    grown.beads = grown.beads.filter((b) => b.depot !== "sextant");
    grown.beads.push(bead("sextant-well", { depot: "sextant", stage: "backlog" }));
    grown.beads.push(bead("sextant-held", { depot: "sextant", stage: "review", hold: true }));
    grown.beads.push(bead("sextant-refused", { depot: "sextant", stage: "approved", fault: { kind: "move_refused", at } }));
    grown.beads.push(bead("sextant-stranded", { depot: "sextant", stage: "approved", fault: { kind: "stranded", at }, hold: false }));
    grown.beads.push(bead("sextant-lost", { depot: "sextant", stage: "review", fault: { kind: "unrouted", at } }));
    // A script's session has no figure to sit for it.
    grown.beads.push(bead("sextant-failed", { depot: "sextant", stage: "new", group: "sextant-assembly", fault: { kind: "ended_failed", at } }));
    const g = layout(grown);
    const marks = Object.fromEntries(g.vehicles.filter((v) => v.bead.depot === "sextant").map((v) => [v.key, [v.chocked === true, v.lamp === true]]));
    expect(marks).toEqual({
      "sextant-well": [false, false],
      "sextant-held": [true, false],
      "sextant-refused": [false, true],
      "sextant-stranded": [false, true],
      "sextant-lost": [false, false],
      "sextant-failed": [false, true],
    });
    const review = g.platforms.find((p) => p.key === "sextant/default/review")!;
    expect(g.lamps).toEqual([{ key: "sextant/default/review#unrouted", platform: review.key, at: { x: review.at.x - PLATFORM_LENGTH / 2 + LAMP_X, z: review.at.z } }]);
    expect(positions(g).get("lamp:sextant/default/review#unrouted")).toEqual(g.lamps[0]!.at);
    expect(layout(copy()).lamps).toEqual([]);
  });

  test("a session that ended badly sits at its wagon, back to it: one more than the places, and not out", () => {
    const grown = copy();
    grown.beads = grown.beads.filter((b) => b.group !== "wharf-builders" && b.depot !== "sextant");
    const fault = { kind: "stalled", at: "2099-01-01T00:00:00Z" };
    grown.beads.push(bead("sextant-sat", { depot: "sextant", group: "wharf-builders", working: false, fault, created_at: "2099-01-01T00:00:00Z" }));
    grown.beads.push(bead("sextant-work", { depot: "sextant", group: "wharf-builders", working: true, created_at: "2099-01-02T00:00:00Z" }));
    const g = layout(grown);
    const hut = g.sheds.find((s) => s.key === "sextant/default/new/wharf-builders")!;
    const sat = g.work.find((w) => w.key === "sextant-sat")!;
    // A session at work takes the first slot. One that sits does not go ahead of it.
    expect(g.work.find((w) => w.key === "sextant-work")).toMatchObject({ slot: 0 });
    expect(g.work.find((w) => w.key === "sextant-work")!.sat).toBeUndefined();
    expect(sat).toMatchObject({ sat: true, slot: 1, platform: "sextant/default/new" });
    // The figure says it: the wagon has no lamp.
    expect(g.vehicles.find((v) => v.key === "sextant-sat")!.lamp).toBeUndefined();
    expect(atWork(g, "wharf-builders")).toBe(1);

    const crew = people(g).filter((p) => p.group === "wharf-builders" && p.key.startsWith("s"));
    const figure = crew.find((p) => p.sat)!;
    expect(figure).toEqual({ key: satKey("sextant-sat"), outfit: "builder", group: "wharf-builders", at: sat.at, gate: sat.gate, faces: 1, platform: sat.platform, bead: sat.bead, sat: true });
    expect(figure.faces).toBe(-sat.reach);
    // The hut's places are for the one at work and the two it may still start.
    const placed = crew.filter((p) => !p.sat);
    expect(placed.map((p) => p.key)).toEqual(hut.places.map((p) => p.key));
    expect(placed.filter((p) => p.bead !== undefined).map((p) => p.bead!.id)).toEqual(["sextant-work"]);
    // It keeps no place: with every session of the limit out it still sits.
    for (let n = 0; n < 2; n++) grown.beads.push(bead(`sextant-more${n}`, { depot: "sextant", group: "wharf-builders", working: true, created_at: `2099-01-0${n + 3}T00:00:00Z` }));
    const full = people(layout(grown), people(g)).filter((p) => p.group === "wharf-builders" && p.key.startsWith("s"));
    expect(full.filter((p) => p.bead !== undefined && !p.sat).length).toBe(3);
    expect(full.filter((p) => p.sat).map((p) => p.bead!.id)).toEqual(["sextant-sat"]);
    // A bead people work has no figure to sit: its wagon is lit.
    const manual = copy();
    manual.beads.push(bead("sextant-m", { depot: "sextant", stage: "decide", group: "decisions", fault }));
    expect(layout(manual).work.find((w) => w.key === "sextant-m")).toBeUndefined();
    expect(layout(manual).vehicles.find((v) => v.key === "sextant-m")!.lamp).toBe(true);
  });

  test("a train is a locomotive on the train flow's track with its wagons coupled behind", () => {
    const grown = copy();
    grown.beads.push(bead("wharf-loco", { type: "train", stage: "open" }));
    for (let n = 0; n < 5; n++) {
      grown.beads.push(bead(`wharf-wag${n}`, { type: "wagon", stage: "new", train: "wharf-loco", created_at: `2099-01-0${n + 2}T00:00:00Z` }));
    }
    const g = layout(grown);
    const open = "wharf/wharf.train/open";
    const loco = g.vehicles.find((v) => v.key === "wharf-loco")!;
    expect(loco).toMatchObject({ kind: "locomotive", platform: open });
    const wagons = g.vehicles.filter((v) => v.bead.train === "wharf-loco");
    expect(wagons.map((v) => v.key)).toEqual(["wharf-wag0", "wharf-wag1", "wharf-wag2"]);
    wagons.forEach((w, s) => {
      expect(w.platform).toBe(open);
      expect(w.at).toEqual({ x: loco.at.x - (s + 1) * SLOT_PITCH, z: loco.at.z });
    });
    expect(g.counts.find((c) => c.platform === open)).toMatchObject({ more: 2, of: "wagons" });
    // None of them stands at the wagon flow's own platform.
    expect(g.vehicles.filter((v) => v.platform.startsWith("wharf/type/wagon/"))).toEqual([]);
  });

  test("a train's wagons with a session stand ahead of an older one with none", () => {
    const grown = copy();
    grown.beads.push(bead("wharf-loco", { type: "train", stage: "open" }));
    grown.beads.push(bead("wharf-old", { type: "wagon", stage: "new", train: "wharf-loco", created_at: "2099-01-01T00:00:00Z" }));
    for (let n = 0; n < SLOTS; n++) {
      grown.beads.push(bead(`wharf-crew${n}`, { type: "wagon", stage: "new", train: "wharf-loco", group: "wharf-builders", working: true, created_at: `2099-01-0${n + 2}T00:00:00Z` }));
    }
    const g = layout(grown);
    const open = "wharf/wharf.train/open";
    expect(g.vehicles.filter((v) => v.bead.train === "wharf-loco").map((v) => v.key)).toEqual(["wharf-crew0", "wharf-crew1", "wharf-crew2"]);
    expect(g.counts.find((c) => c.platform === open && c.of === "wagons")).toMatchObject({ more: 1, of: "wagons" });
  });
});

describe("a wagon that waits on a person weathers", () => {
  const now = Date.parse("2099-01-20T00:00:00Z");
  const ago = (days: number, hours = 0) => new Date(now - (days * 24 + hours) * 60 * 60 * 1000).toISOString();
  const waiting = (id: string, over: Partial<Bead>) => bead(id, { depot: "sextant", ...over });
  const stood = (beads: Bead[], at = now) => {
    const picture = layout({ ...copy(), beads }, {}, at);
    return (id: string) => picture.vehicles.find((v) => v.key === id)!;
  };

  test("the steps: fresh, dull at three days, rusted at a week, moss at two", () => {
    expect([0, 0.9, 2.99].map(weather)).toEqual([undefined, undefined, undefined]);
    expect([3, 6.99].map(weather)).toEqual(["dull", "dull"]);
    expect([7, 13.99].map(weather)).toEqual(["rusted", "rusted"]);
    expect([14, 400].map(weather)).toEqual(["mossy", "mossy"]);
  });

  test("its age is the days since it last moved, or since it was made", () => {
    expect(age(waiting("sextant-a", { created_at: ago(10) }), now)).toBe(10);
    expect(age(waiting("sextant-a", { created_at: ago(10), moved_at: ago(0, 12) }), now)).toBe(0.5);
    // A clock behind the bead's: it is no younger than new.
    expect(age(waiting("sextant-a", { created_at: ago(-2) }), now)).toBe(0);
    expect(age(waiting("sextant-a", { created_at: "" }), now)).toBeUndefined();
  });

  test("ten days in backlog is rust, an hour in decide is fresh, and review stays clean however long", () => {
    const at = stood([
      waiting("sextant-old", { stage: "backlog", created_at: ago(10) }),
      waiting("sextant-asked", { stage: "decide", created_at: ago(10), moved_at: ago(0, 1) }),
      waiting("sextant-read", { stage: "review", created_at: ago(10) }),
      waiting("sextant-built", { stage: "new", created_at: ago(30) }),
      waiting("sextant-moss", { stage: "decide", created_at: ago(40), moved_at: ago(15) }),
    ]);
    expect(at("sextant-old")).toMatchObject({ age: 10, weather: "rusted" });
    expect(at("sextant-asked").age).toBeCloseTo(1 / 24);
    expect(at("sextant-asked").weather).toBeUndefined();
    // Waiting on the yard, not on a person: no age at all.
    for (const id of ["sextant-read", "sextant-built"]) {
      expect(at(id).age, id).toBeUndefined();
      expect(at(id).weather, id).toBeUndefined();
    }
    expect(at("sextant-moss")).toMatchObject({ age: 15, weather: "mossy" });
  });

  test("the age is as of the time the picture is of: the snapshot's, or the one given", () => {
    const beads = [waiting("sextant-old", { stage: "backlog", created_at: ago(10) })];
    expect(stood(beads, now - 8 * 24 * 60 * 60 * 1000)("sextant-old")).toMatchObject({ age: 2 });
    expect(stood(beads, now - 6 * 24 * 60 * 60 * 1000)("sextant-old").weather).toBe("dull");
    const taken = layout({ ...copy(), beads, taken_at: ago(0) }).vehicles.find((v) => v.key === "sextant-old")!;
    expect(taken.weather).toBe("rusted");
  });

  test("a held wagon weathers by its own stage, not by the siding it stands in", () => {
    const at = stood([
      waiting("sextant-held", { stage: "new", hold: true, created_at: ago(10) }),
      waiting("sextant-kept", { stage: "backlog", hold: true, created_at: ago(10) }),
    ]);
    expect(at("sextant-held")).toMatchObject({ platform: "sextant/default/decide", chocked: true });
    expect(at("sextant-held").weather).toBeUndefined();
    expect(at("sextant-kept")).toMatchObject({ platform: "sextant/default/decide", weather: "rusted" });
  });
});

describe("a wagon that waits for another bead has a lamp naming it", () => {
  const on = (id: string, over: Partial<Bead> = {}) => bead(id, { depot: "sextant", stage: "backlog", ...over });
  // Every wagon that waits, with what it waits for.
  const waits = (beads: Bead[], edges?: Yard["edges"]) =>
    layout({ ...yard, beads, ...(edges ? { edges } : {}) })
      .vehicles.filter((v) => v.waits !== undefined)
      .map((v) => [v.key, v.waits]);
  const edge = [{ from: "sextant-a", to: "sextant-b" }];

  test("both at one platform: the lamp is on the one that waits, and names its blocker, the board and the stage", () => {
    const beads = [on("sextant-a"), on("sextant-b")];
    const l = layout({ ...yard, beads, edges: edge });
    const [a, b] = ["sextant-a", "sextant-b"].map((key) => l.vehicles.find((v) => v.key === key)!);
    expect(a!.platform).toBe(b!.platform);
    expect(b!.waits).toEqual([{ on: "sextant-a", depot: "sextant", stage: "backlog" }]);
    expect(a!.waits).toBeUndefined();
    // A snapshot without edges, and one with none, has no wagon that waits.
    expect(waits(beads)).toEqual([]);
    expect(waits(beads, [])).toEqual([]);
  });

  test("the blocker at another platform of the board: the same lamp, with the stage it stands at", () => {
    const beads = [on("sextant-a", { stage: "review" }), on("sextant-b", { stage: "new" })];
    expect(waits(beads, edge)).toEqual([["sextant-b", [{ on: "sextant-a", depot: "sextant", stage: "review" }]]]);
  });

  test("the blocker on another board: the same lamp, and it names that board", () => {
    const beads = [bead("wharf-x", { depot: "wharf" }), on("sextant-b")];
    expect(waits(beads, [{ from: "wharf-x", to: "sextant-b" }])).toEqual([["sextant-b", [{ on: "wharf-x", depot: "wharf", stage: "new" }]]]);
  });

  test("a blocker that has closed is waited for no more, though the wagon still stands in backlog: the lamp is out", () => {
    expect(waits([on("sextant-b")], edge)).toEqual([]);
  });

  test("a blocker that is only counted at its platform is waited for like any other", () => {
    // The oldest three are drawn; the blocker is the youngest of four.
    const drawn = [1, 2, 3].map((n) => on(`sextant-o${n}`, { created_at: `2098-01-0${n}T00:00:00Z` }));
    const beads = [...drawn, on("sextant-a"), on("sextant-b", { stage: "new" })];
    const l = layout({ ...yard, beads, edges: edge });
    expect(l.vehicles.map((v) => v.key)).not.toContain("sextant-a");
    expect(waits(beads, edge)).toEqual([["sextant-b", [{ on: "sextant-a", depot: "sextant", stage: "backlog" }]]]);
    // And a wagon that is not drawn itself has nothing to carry a lamp.
    expect(waits(beads, [{ from: "sextant-b", to: "sextant-a" }])).toEqual([]);
  });

  test("a wagon that waits for two names each, in the order of the edges", () => {
    const beads = [on("sextant-a"), bead("wharf-x", { depot: "wharf" }), on("sextant-b", { stage: "new" })];
    const edges = [
      { from: "sextant-a", to: "sextant-b" },
      { from: "wharf-x", to: "sextant-b" },
    ];
    expect(waits(beads, edges)).toEqual([
      [
        "sextant-b",
        [
          { on: "sextant-a", depot: "sextant", stage: "backlog" },
          { on: "wharf-x", depot: "wharf", stage: "new" },
        ],
      ],
    ]);
  });

  test("a wait is no part of the layout but the wagon's: nothing lies between the two", () => {
    expect(Object.keys(layout({ ...yard, beads: [on("sextant-a"), on("sextant-b")], edges: edge }))).not.toContain("couplings");
  });
});

describe("a coaling tower for every provider the yard burns the quota of", () => {
  const groups = (rows: [runner: string, kind?: string, provider?: string][]) => rows.map(([runner, kind, provider], n) => ({ name: `g${n}`, runner, limit: 1, ...(kind !== undefined ? { kind } : {}), ...(provider !== undefined ? { provider } : {}) }));

  test("the kind of each group that starts agents, then of each crew member, once; none for people and scripts", () => {
    const y: Yard = { ...yard, groups: groups([["herdr", "codex"], ["manual"], ["exec"], ["herdr", "claude"], ["herdr", "codex"], ["herdr"], ["exec", "grok"]]), crew: [{ name: "a", kind: "kimi" }, { name: "b", kind: "claude" }, { name: "c" }] };
    expect(providers(y)).toEqual(["codex", "claude", "kimi"]);
    expect(providers({ ...y, groups: groups([["manual"], ["exec"]]), crew: [] })).toEqual([]);
    expect(layout({ ...y, groups: [], crew: [] }).towers).toEqual([]);
  });

  test("a row's provider where it carries one, its kind where it carries none: one tower for every distinct provider", () => {
    const y: Yard = {
      ...yard,
      groups: groups([["herdr", "pi", "zai"], ["herdr", "pi", "openai"], ["herdr", "claude", "claude"], ["herdr", "codex"]]),
      crew: [{ name: "a", kind: "pi", provider: "zai" }, { name: "b", kind: "kimi" }],
    };
    expect(providers(y)).toEqual(["zai", "openai", "claude", "codex", "kimi"]);
    expect(layout(y).towers.map((t) => t.provider)).toEqual(["zai", "openai", "claude", "codex", "kimi"]);
  });

  test("this yard: its crew are kimi and claude, in the signal boxes' row, at their pitch, left of the first box", () => {
    const l = layout(yard);
    expect(l.towers).toEqual([
      { key: "tower/kimi", provider: "kimi", at: { x: TOWER_X, z: CREW_Z } },
      { key: "tower/claude", provider: "claude", at: { x: TOWER_X - CREW_PITCH, z: CREW_Z } },
    ]);
    for (const t of l.towers) expect(t.at.x).toBeLessThan(Math.min(...l.boxes.map((b) => b.at.x)));
  });

  // The post's sign, "hooks", reads to the right from the wire's left end,
  // and a silo's name stands over its middle: at less than a pitch between
  // them the sign lay over the name of the silo beside the post.
  test("the wire's first post, where its sign hangs, is a pitch or more from every silo, three of them or six", () => {
    for (const kinds of [["kimi", "claude", "codex"], ["kimi", "claude", "codex", "grok", "gemini", "glm"]]) {
      const l = layout({ ...yard, groups: [], crew: kinds.map((kind) => ({ name: kind, kind })) });
      expect(l.towers).toHaveLength(kinds.length);
      const nearest = Math.min(...l.towers.map((t) => Math.abs(l.wire.at.x - t.at.x)));
      expect(nearest).toBeGreaterThanOrEqual(CREW_PITCH);
      // All to one side of it: the sign reads away from them.
      for (const t of l.towers) expect(t.at.x).toBeLessThan(l.wire.at.x);
    }
  });

  test("a new provider is one more tower beyond the last, and a new crew member moves none", () => {
    const grown = copy();
    grown.groups.find((g) => g.name === "wharf-reviewers")!.kind = "codex";
    grown.crew.push({ name: "pointsman", kind: "codex" });
    const { is } = expectKept(yard, grown);
    expect(is.get("tower:tower/codex")).toEqual({ x: TOWER_X - 2 * CREW_PITCH, z: CREW_Z });
    // A provider that left and came back has its tower where it stood.
    const fewer = { ...copy(), crew: yard.crew.filter((c) => c.kind !== "kimi") };
    expect(positions(layout(fewer, place(yard))).get("tower:tower/claude")).toEqual({ x: TOWER_X - CREW_PITCH, z: CREW_Z });
  });

  test("the level is what is left of a window: 100 less what is used, between none and all", () => {
    expect(left({ used_percent: 55 })).toBe(45);
    expect(left({ used_percent: 0 })).toBe(100);
    expect(left({ used_percent: 100 })).toBe(0);
    expect(left({ used_percent: 130 })).toBe(0);
    expect(left({ used_percent: -4 })).toBe(100);
    expect(left(undefined)).toBeUndefined();
    expect(left({ used_percent: Number.NaN })).toBeUndefined();
  });

  test("under 20 percent left the coal is low, under 5 the last, at none the tower is out", () => {
    expect([100, 45, 20].map(coal)).toEqual(["plenty", "plenty", "plenty"]);
    expect([19.9, 5].map(coal)).toEqual(["low", "low"]);
    expect([4.9, 0.1].map(coal)).toEqual(["last", "last"]);
    expect(coal(0)).toBe("out");
  });
});
