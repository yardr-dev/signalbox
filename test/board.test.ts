import { describe, expect, test } from "vitest";
import events from "../public/events.json";
import snapshot from "../public/yard.json";
import { badge, etaText, LIMIT, minutes, NO_TIME, remark, rows, via } from "../src/board";
import { state, type Log } from "../src/replay";
import type { Bead, Yard } from "../src/yard";

// A yard of one depot and its line: built, reviewed, landed, with a siding
// for a person's decision.
function yard(): Yard {
  return {
    taken_at: "2099-01-01T12:00:00Z",
    depots: [{ name: "wharf", kind: "git", base: "main" }],
    flows: [
      {
        depot: "wharf",
        flows: [
          {
            name: "default",
            stages: [
              { stage: "backlog", group: "backlog", next: ["new"], human: true },
              { stage: "new", group: "muse", next: ["review", "decide"] },
              { stage: "decide", group: "decisions", next: ["new"], human: true },
              { stage: "review", group: "opus", next: ["approved", "new"] },
              { stage: "approved", group: "landing", next: ["merged"] },
              { stage: "merged", next: [], terminal: true },
            ],
          },
        ],
      },
    ],
    groups: [
      { name: "muse", runner: "herdr", limit: 3 },
      { name: "decisions", runner: "manual", limit: 50, members: ["nell", "yardmaster"] },
      { name: "landing", runner: "exec", limit: 1 },
    ],
    routes: [
      { stage: "new", depot: "wharf", group: "muse", priority: 0 },
      { stage: "decide", depot: "wharf", group: "decisions", priority: 0 },
    ],
    crew: [],
    peers: [],
    beads: [],
    edges: [],
  };
}

function bead(id: string, over: Partial<Bead> = {}): Bead {
  return { id, title: id, type: "task", stage: "new", depot: "wharf", priority: 2, created_at: "2099-01-01T00:00:00Z", ...over };
}

describe("the board's rows", () => {
  test("a running session first, then what is queued; the backlog is not on the board", () => {
    const y = yard();
    const queued = bead("wharf-a", { created_at: "2099-01-01T00:00:00Z" });
    const running = bead("wharf-b", { created_at: "2099-01-01T01:00:00Z", group: "muse", working: true });
    const waiting = bead("wharf-c", { stage: "backlog", group: "muse", working: true });
    expect(rows(y, [queued, running, waiting]).map((r) => r.bead.id)).toEqual(["wharf-b", "wharf-a"]);
  });

  test("ordered by expected arrival where served, else by time at the current stage", () => {
    const y = yard();
    const old = bead("wharf-a", { created_at: "2099-01-01T00:00:00Z" });
    const young = bead("wharf-b", { created_at: "2099-01-01T05:00:00Z" });
    expect(rows(y, [young, old]).map((r) => r.bead.id)).toEqual(["wharf-a", "wharf-b"]);
    const recentlyMoved = bead("wharf-c", { created_at: "2099-01-01T00:00:00Z", moved_at: "2099-01-10T00:00:00Z" });
    const standing = bead("wharf-d", { created_at: "2099-01-09T00:00:00Z", moved_at: "2099-01-09T00:00:00Z" });
    expect(rows(y, [recentlyMoved, standing]).map((r) => r.bead.id)).toEqual(["wharf-d", "wharf-c"]);
    const soon = bead("wharf-e", { created_at: "2099-01-01T06:00:00Z", eta: { low: "30m", high: "1h" } });
    const later = bead("wharf-f", { created_at: "2099-01-01T00:30:00Z", eta: { low: "2h", high: "5h" } });
    expect(rows(y, [old, later, young, soon]).map((r) => r.bead.id)).toEqual(["wharf-e", "wharf-f", "wharf-a", "wharf-b"]);
    // A time that does not read as a span shows, but orders nothing.
    const vague = bead("wharf-g", { created_at: "2099-01-01T00:15:00Z", eta: { low: "soon", high: "soon" } });
    expect(rows(y, [soon, vague, old]).map((r) => [r.bead.id, r.time])).toEqual([
      ["wharf-e", "30m–1h"],
      ["wharf-a", NO_TIME],
      ["wharf-g", "soon"],
    ]);
  });

  test("a running session outranks an earlier arrival, and the board holds its limit", () => {
    const y = yard();
    const queued = bead("wharf-a", { eta: { low: "5m", high: "10m" } });
    const running = bead("wharf-b", { group: "muse", working: true });
    expect(rows(y, [queued, running]).map((r) => r.bead.id)).toEqual(["wharf-b", "wharf-a"]);
    const many = Array.from({ length: LIMIT + 5 }, (_, n) => bead(`wharf-${n}`, { created_at: `2099-01-0${(n % 9) + 1}T00:00:00Z` }));
    expect(rows(y, many)).toHaveLength(LIMIT);
  });

  test("each row names its time, badge, destination, platform and line", () => {
    const y = yard();
    const r = rows(y, [bead("wharf-a", { title: "Pick the port", group: "muse", working: true, eta: { low: "2h", high: "5h" } })])[0]!;
    expect(r).toMatchObject({ time: "2h–5h", badge: "muse", title: "Pick the port", via: ["review", "decide", "approved"], platform: "new", line: "wharf" });
    // No group has it yet: its type stands on the badge.
    const q = rows(y, [bead("wharf-b", { type: "train" })])[0]!;
    expect(q.badge).toBe("train");
  });

  test("the demo's day boards its states too, held beads in red", () => {
    const yard = snapshot as Yard;
    const board = rows(yard, state(yard, events as unknown as Log).beads);
    expect(board.length).toBeGreaterThan(0);
    expect(board.length).toBeLessThanOrEqual(LIMIT);
    expect(board.every((r) => r.platform !== "backlog")).toBe(true);
    // Held all day, at its stage: the red block.
    const held = board.find((r) => r.bead.id === "wharf-g8ly");
    expect(held).toMatchObject({ remark: "held", tone: "red" });
    // And the snapshot's own beads board the same.
    expect(rows(yard, yard.beads).map((r) => r.bead.id)).toEqual(board.map((r) => r.bead.id));
  });
});

describe("the board's remarks", () => {
  const y = yard();
  const said = (b: Bead) => remark(y, b);

  test("a hold and a session that came to no good end are the red block", () => {
    expect(said(bead("wharf-a", { hold: true }))).toMatchObject({ remark: "held", tone: "red" });
    expect(said(bead("wharf-b", { group: "muse", fault: { kind: "stalled", at: "2099-01-01T01:00:00Z" } }))).toMatchObject({ remark: "stalled", tone: "red", more: "session stalled" });
    expect(said(bead("wharf-c", { group: "muse", fault: { kind: "died", at: "2099-01-01T01:00:00Z" } })).remark).toBe("stalled");
    expect(said(bead("wharf-d", { group: "muse", fault: { kind: "ended_question", at: "2099-01-01T01:00:00Z" } })).remark).toBe("stalled");
    // A blocked session waits, but its agent is stopped until someone answers.
    expect(said(bead("wharf-e", { group: "muse", fault: { kind: "blocked", at: "2099-01-01T01:00:00Z" } }))).toMatchObject({ remark: "stalled", tone: "red" });
    // The yard's word on the bead itself is no session's end: no red block.
    expect(said(bead("wharf-f", { group: "muse", fault: { kind: "move_refused", at: "2099-01-01T01:00:00Z" } }))).toMatchObject({ remark: "", tone: "none" });
  });

  test("at a people's stage it waits for who is routed there, in yellow", () => {
    expect(said(bead("wharf-a", { stage: "decide" }))).toMatchObject({ remark: "waits for nell, yardmaster", tone: "amber" });
    // The flow's resolved group still names the people when routes are absent.
    const groups = yard();
    groups.routes = [];
    expect(remark(groups, bead("wharf-b", { stage: "decide" }))).toMatchObject({ remark: "waits for nell, yardmaster", tone: "amber" });
    // No members listed: the group itself.
    groups.routes = yard().routes;
    groups.groups = groups.groups.filter((g) => g.name !== "decisions");
    expect(remark(groups, bead("wharf-c", { stage: "decide" }))).toMatchObject({ remark: "waits for decisions", tone: "amber" });
    // With no resolved group or route, there is no named person to show.
    const unrouted = yard();
    unrouted.routes = [];
    delete unrouted.flows[0]!.flows[0]!.stages.find((s) => s.stage === "decide")!.group;
    expect(remark(unrouted, bead("wharf-d", { stage: "decide" }))).toMatchObject({ remark: "waits for a person", tone: "amber" });
    // A machine stage waits for nobody.
    expect(said(bead("wharf-e", { stage: "new" }))).toMatchObject({ remark: "", tone: "none" });
  });

  test("past its usual time it is late, in yellow, saying by how much", () => {
    expect(said(bead("wharf-a", { late: { stage: "new", in_stage: "6h", p90: "2h" } }))).toMatchObject({ remark: "late", tone: "amber", more: "in new 6h, past the usual 2h" });
  });

  test("held before stalled before waiting before late", () => {
    const fault = { kind: "stalled", at: "2099-01-01T01:00:00Z" };
    const late = { stage: "decide", in_stage: "6h", p90: "2h" };
    expect(said(bead("wharf-a", { hold: true, group: "muse", fault, stage: "decide", late })).remark).toBe("held");
    expect(said(bead("wharf-b", { group: "muse", fault, stage: "decide", late })).remark).toBe("stalled");
    expect(said(bead("wharf-c", { stage: "decide", late })).remark).toBe("waits for nell, yardmaster");
    expect(said(bead("wharf-d", { stage: "new", late })).remark).toBe("late");
  });
});

describe("the board's small print", () => {
  test("the time is the yard's range, one span when both ends agree, none without", () => {
    expect(etaText(bead("wharf-a", { eta: { low: "2h", high: "5h" } }))).toBe("2h–5h");
    expect(etaText(bead("wharf-b", { eta: { low: "30m", high: "30m" } }))).toBe("30m");
    expect(etaText(bead("wharf-c"))).toBe(NO_TIME);
  });

  test("the badge is the group building it, or its type", () => {
    expect(badge(bead("wharf-a", { group: "muse" }))).toBe("muse");
    expect(badge(bead("wharf-b", { type: "train" }))).toBe("train");
  });

  test("a span reads in minutes, or not at all", () => {
    expect(minutes("2h")).toBe(120);
    expect(minutes("2h 5m")).toBe(125);
    expect(minutes("90m")).toBe(90);
    expect(minutes("1d")).toBe(24 * 60);
    expect(minutes("soon")).toBeUndefined();
    expect(minutes("")).toBeUndefined();
  });

  test("the via is the stages still ahead, past the buffer left out", () => {
    const y = yard();
    expect(via(y, bead("wharf-a", { stage: "new" }))).toEqual(["review", "decide", "approved"]);
    expect(via(y, bead("wharf-b", { stage: "approved" }))).toEqual([]);
    expect(via(y, bead("wharf-c", { stage: "merged" }))).toEqual([]);
    // A stage removed from the flow has no later stages to advertise.
    expect(via(y, bead("wharf-d", { stage: "retired" }))).toEqual([]);
    // No flow of its own, or none of its depot: no via.
    expect(via(y, bead("wharf-d", { stage: "new", depot: "gauge" }))).toEqual([]);
    const strange = yard();
    strange.flows = [];
    expect(via(strange, bead("wharf-e"))).toEqual([]);
  });
});
