// The demo: the made-up yard the page plays when nothing serves it one, and
// the fixture of the other tests. scripts/demo.mjs writes it from the
// description it holds.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { demo, files } from "../scripts/demo.mjs";
import { state, step, trains, world } from "../src/replay.ts";

const made = demo();
const { yard, log } = made;
const committed = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");

describe("the committed demo", () => {
  // A snapshot of somebody's yard in public/ fails here: `npm run snapshot`
  // writes to public/snapshot/, which is not tracked.
  test("is what scripts/demo.mjs writes, file for file: no yard's snapshot", () => {
    for (const [name, value] of Object.entries(files(made))) expect(committed(name), name).toBe(`${JSON.stringify(value, null, 2)}\n`);
    expect(files(demo())).toEqual(files(made));
  });

  test("its log runs forward: every number once, no two events in one millisecond, all before the snapshot", () => {
    for (let n = 1; n < log.events.length; n++) {
      expect(log.events[n].seq, `event ${n}`).toBe(log.events[n - 1].seq + 1);
      expect(Date.parse(log.events[n].at), `event ${n}`).toBeGreaterThan(Date.parse(log.events[n - 1].at));
    }
    expect(Date.parse(log.events.at(-1).at)).toBeLessThan(Date.parse(yard.taken_at));
  });

  test("no group has more sessions out than its limit, at any moment of the day", () => {
    const w = world(yard, log);
    const limit = new Map(yard.groups.map((g) => [g.name, g.limit]));
    let s = state(yard, log, 0);
    for (const e of log.events) {
      s = step(s, e, w);
      const out = new Map();
      for (const b of s.beads) if (b.working === true) out.set(b.group, (out.get(b.group) ?? 0) + 1);
      for (const [group, n] of out) expect(n, `${group} after ${e.seq}`).toBeLessThanOrEqual(limit.get(group));
    }
  });

  test("the day shows what the page draws", () => {
    const has = (kind, data = {}) => log.events.some((e) => e.kind === kind && Object.entries(data).every(([key, value]) => e.data?.[key] === value));
    // Builders at work, a review sent back, a failed gate, a landing.
    expect(has("claimed", { group: "wharf-builders" })).toBe(true);
    expect(has("advanced", { from: "review", to: "new", outcome: "changes" })).toBe(true);
    expect(has("advanced", { from: "approved", to: "new", outcome: "failed" })).toBe(true);
    expect(has("closed", { reason: "merged" })).toBe(true);
    // A question for a person, a held bead let go again, and one held all day.
    expect(has("advanced", { to: "decide", outcome: "question" })).toBe(true);
    for (const kind of ["held", "unheld", "session_stalled", "session_blocked", "session_unblocked", "move_refused", "dep_added", "hook"]) expect(has(kind), kind).toBe(true);
    expect(yard.beads.some((b) => b.hold === true)).toBe(true);
    // A train with its wagons, one that lands and one still on its way.
    const cast = [...world(yard, log).cast.values()];
    const train = cast.filter((b) => b.type === "train");
    expect(train.map((t) => cast.filter((b) => b.train === t.id).length)).toEqual([3, 2]);
    expect(yard.beads.filter((b) => b.type === "train").map((b) => b.stage)).toEqual(["in-pr"]);
    // A peer, both ways, and a mail with the files that crossed before it.
    const goods = trains(log.events, new Map());
    expect(new Set(goods.map((t) => `${t.peer} ${t.way}`))).toEqual(new Set(["quay in", "quay out"]));
    expect(goods.map((t) => t.files)).toContain(2);
    // Wagons that have waited long enough to weather, and a quota for the silos.
    const days = (b) => (Date.parse(yard.taken_at) - Date.parse(b.created_at)) / 86_400_000;
    expect(yard.beads.filter((b) => b.stage === "backlog" && days(b) >= 14).length).toBeGreaterThan(0);
    expect(made.quota.providers.map((p) => p.key)).toEqual(Object.keys(made.layout.towers));
  });
});
