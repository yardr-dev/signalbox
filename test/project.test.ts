import { describe, expect, test } from "vitest";
import { cardOf, eventOf, logOf, yardOf, type Raw } from "../src/project";

// What the yard's commands print, with what must not leave the machine.
const SECRET = "/Users/someone/.yardr/secret";
const lists = {
  depots: [{ name: "signalbox", kind: "git", base: "main", path: SECRET, env_file: SECRET }],
  flows: [
    {
      depot: "signalbox",
      flows: [{ flow: { name: "default", outcomes: {} }, type: null, stages: [{ stage: "new", group: "builders", next: ["review"], open: 1, stage_file: SECRET }] }],
    },
  ],
  groups: [{ name: "builders", runner: "herdr", limit: 2, args: [SECRET] }],
  routes: [{ id: "r1", stage: "new", type: null, group: "builders", priority: 0 }],
  crew: [{ name: "yardmaster", config: { kind: "claude", env_file: SECRET }, state: "running", dir: SECRET, handle: { pid: 1 } }],
  peers: [{ name: "airy", send: ["mail"], url: SECRET, key: SECRET }],
  beads: [
    { id: "signalbox-a", title: "a", body: SECRET, type: "task", stage: "new", status: "open", depot: "signalbox", session: "4wbdbdwypgzzjr5vgfwr", priority: 2, created_at: "2099-01-01T00:00:00Z" },
    { id: "signalbox-b", title: "b", type: "task", stage: "backlog", status: "open", depot: "signalbox", priority: 2, created_at: "2099-01-01T00:00:00Z" },
  ],
};
const alias = (session: string) => `s${session.length}`;

describe("the projection", () => {
  test("the yard keeps the fields the picture names and nothing of the rest", () => {
    const yard = yardOf(lists, "2099-01-01T00:00:00Z");
    expect(yard).toEqual({
      taken_at: "2099-01-01T00:00:00Z",
      depots: [{ name: "signalbox", kind: "git", base: "main" }],
      flows: [{ depot: "signalbox", flows: [{ name: "default", stages: [{ stage: "new", group: "builders", next: ["review"] }] }] }],
      groups: [{ name: "builders", runner: "herdr", limit: 2 }],
      routes: [{ stage: "new", group: "builders", priority: 0 }],
      crew: [{ name: "yardmaster", kind: "claude", state: "running" }],
      peers: [{ name: "airy", send: ["mail"] }],
      beads: [
        { id: "signalbox-a", title: "a", type: "task", stage: "new", depot: "signalbox", working: true, priority: 2, created_at: "2099-01-01T00:00:00Z" },
        { id: "signalbox-b", title: "b", type: "task", stage: "backlog", depot: "signalbox", working: false, priority: 2, created_at: "2099-01-01T00:00:00Z" },
      ],
    });
    expect(JSON.stringify(yard)).not.toMatch(/secret|4wbdbdwypgzzjr5vgfwr/);
  });

  test("an event keeps its number, time, kind and bead, and a few names of its data", () => {
    const started: Raw = {
      seq: 7,
      id: "7",
      bead: "signalbox-a",
      kind: "started",
      actor: "yard",
      at: "2099-01-01T00:00:07Z",
      data: { session: "4wbdbdwypgzzjr5vgfwr", handle: { log: SECRET, pid: 1 }, key: SECRET, body: SECRET, from: "someone", group: "builders" },
    };
    // from and to are stages on an advance alone.
    expect(eventOf(started, alias)).toEqual({ seq: 7, at: "2099-01-01T00:00:07Z", kind: "started", bead: "signalbox-a", data: { group: "builders", session: "s20" } });
    expect(eventOf({ seq: 8, at: "t", kind: "advanced", bead: "signalbox-a", data: { from: "new", to: "review", outcome: "done", note: SECRET } }, alias).data).toEqual({
      from: "new",
      to: "review",
      outcome: "done",
    });
    // A name that is no string is no name; no data, no key.
    expect(eventOf({ seq: 9, at: "t", kind: "hook", data: { type: { path: SECRET }, peer: 3 } }, alias)).toEqual({ seq: 9, at: "t", kind: "hook" });
    // A change of structure keeps its kind, by which the page takes a new snapshot, and its names.
    const route = { route: 12, stage: "review", group: "reviewers", priority: 10, type: "", depot: "signalbox", label: SECRET };
    expect(eventOf({ seq: 10, at: "t", kind: "route_added", actor: "yard", data: route }, alias)).toEqual({ seq: 10, at: "t", kind: "route_added", data: { group: "reviewers", depot: "signalbox", type: "" } });
    for (const kind of ["group_set", "group_removed", "route_removed"]) {
      expect(eventOf({ seq: 11, at: "t", kind, data: { group: "reviewers", runner: SECRET, limit: 2, members: [SECRET], routes: [route] } }, alias)).toEqual({ seq: 11, at: "t", kind, data: { group: "reviewers" } });
    }
  });

  test("the log's beads are the closed ones its window names", () => {
    const all = [
      ...lists.beads,
      { id: "signalbox-c", title: "c", body: SECRET, type: "task", stage: "merged", status: "closed", depot: "signalbox", priority: 2, created_at: "2099-01-01T00:00:00Z" },
      { id: "signalbox-d", title: "d", type: "task", stage: "merged", status: "closed", depot: "signalbox", priority: 2, created_at: "2099-01-01T00:00:00Z" },
    ];
    const window = [
      { seq: 1, at: "t", kind: "closed", bead: "signalbox-c" },
      { seq: 2, at: "t", kind: "noted", bead: "signalbox-a", data: { text: SECRET } },
    ];
    const log = logOf("2099-01-01T00:00:00Z", window, all, alias);
    expect(log.beads).toEqual([{ id: "signalbox-c", title: "c", type: "task", stage: "merged", depot: "signalbox", priority: 2, created_at: "2099-01-01T00:00:00Z" }]);
    expect(log.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(JSON.stringify(log)).not.toMatch(/secret/);
  });

  test("a bead's card has its body and notes, and nothing else prime printed", () => {
    const primed = {
      bead: { ...lists.beads[0], uuid: "u", hold: true, labels: ["web"], updated_at: "2099-01-02T00:00:00Z", created_by: "yardmaster", revision: "r" },
      notes: [{ bead: "signalbox-a", kind: "note", author: "signalbox-a-new", text: "what changed", at: "2099-01-01T01:00:00Z", seq: 7 }],
      flow: { name: "default" },
      next: { source: { kind: "repo", path: "/Users/someone/flows/default.flow" } },
      deps: [{ id: "signalbox-b" }],
    };
    expect(cardOf(primed)).toEqual({
      bead: {
        id: "signalbox-a",
        title: "a",
        type: "task",
        stage: "new",
        depot: "signalbox",
        // The session is there; its name stays in the yard.
        working: true,
        hold: true,
        labels: ["web"],
        priority: 2,
        created_at: "2099-01-01T00:00:00Z",
        status: "open",
        updated_at: "2099-01-02T00:00:00Z",
        body: SECRET,
      },
      notes: [{ author: "signalbox-a-new", at: "2099-01-01T01:00:00Z", text: "what changed" }],
    });
    // What is not a bead with notes is an empty card, not an error.
    expect(cardOf({})).toEqual({ bead: { working: false }, notes: [] });
  });
});
