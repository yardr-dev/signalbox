import { describe, expect, test } from "vitest";
import window from "../public/events.json";
import snapshot from "../public/yard.json";
import { atWork, layout, people } from "../src/layout";
import { Player } from "../src/player";
import { FAULTS, line, opening, outgrown, SHOWN, state, step, STRUCTURE, world, type Log, type State, type YardEvent } from "../src/replay";
import type { Bead, Yard } from "../src/yard";

// The committed snapshot and its events are the fixture: this yard's last
// 2000 events, as scripts/snapshot.sh wrote them.
const yard = snapshot as Yard;
const log = window as Log;

function bead(id: string, over: Partial<Bead> = {}): Bead {
  return { id, title: id, type: "task", stage: "new", depot: "signalbox", priority: 2, created_at: "2099-01-01T00:00:00Z", ...over };
}

let seq = 0;
function event(kind: string, id?: string, data?: YardEvent["data"]): YardEvent {
  seq++;
  return { seq, at: new Date(Date.UTC(2099, 0, 1, 0, 0, seq)).toISOString(), kind, ...(id !== undefined ? { bead: id } : {}), ...(data ? { data } : {}) };
}

// A yard of this one's structure with one wagon in it, signalbox-a at new,
// and a cast that knows signalbox-b too.
const one: Yard = { ...yard, beads: [bead("signalbox-a")] };
const cast: Log = { taken_at: yard.taken_at, beads: [bead("signalbox-b", { stage: "merged" })], events: [] };
const w = world(one, cast);
const start: State = { beads: one.beads, sessions: {} };
const run = (events: YardEvent[], from: State = start) => events.reduce((s, e) => step(s, e, w), from);
const at = (s: State, id: string) => s.beads.find((b) => b.id === id);
// Where the picture has a bead: the platform of its wagon.
const platform = (s: State, id: string) => layout({ ...one, beads: s.beads }).vehicles.find((v) => v.key === id)?.platform;

describe("the reducer", () => {
  test("a created bead is a wagon at its flow's first platform, behind what stands there", () => {
    const older = bead("signalbox-o", { stage: "backlog", created_at: "2098-01-01T00:00:00Z" });
    const s = run([event("created", "signalbox-b")], { beads: [...start.beads, older], sessions: {} });
    expect(at(s, "signalbox-b")).toMatchObject({ stage: "backlog" });
    const l = layout({ ...one, beads: s.beads });
    const [first, last] = ["signalbox-o", "signalbox-b"].map((id) => l.vehicles.find((v) => v.key === id)!);
    expect(last!.platform).toBe("signalbox/default/backlog");
    expect(last!.at.x).toBeLessThan(first!.at.x);
  });

  test("after an advance the wagon is at the new platform", () => {
    const s = run([event("advanced", "signalbox-a", { from: "new", to: "review", outcome: "done" })]);
    expect(at(s, "signalbox-a")!.stage).toBe("review");
    expect(platform(s, "signalbox-a")).toBe("signalbox/default/review");
    // To the siding, and back along the line.
    const aside = run([event("advanced", "signalbox-a", { from: "review", to: "decide", outcome: "question" })], s);
    expect(platform(aside, "signalbox-a")).toBe("signalbox/default/decide");
    const back = run([event("advanced", "signalbox-a", { from: "decide", to: "new" })], aside);
    expect(platform(back, "signalbox-a")).toBe("signalbox/default/new");
  });

  test("an advance is when the bead last moved; a bead made in the window has not moved yet", () => {
    const e = event("advanced", "signalbox-a", { from: "new", to: "decide", outcome: "question" });
    expect(at(run([e]), "signalbox-a")!.moved_at).toBe(e.at);
    // The cast has it as it is at the window's end, after its moves.
    const later = world(one, { ...cast, beads: [bead("signalbox-b", { stage: "merged", moved_at: "2099-01-02T00:00:00Z" })] });
    const made = step(start, event("created", "signalbox-b"), later);
    expect(at(made, "signalbox-b")).toMatchObject({ stage: "backlog" });
    expect(at(made, "signalbox-b")!.moved_at).toBeUndefined();
  });

  test("after a terminal stage it is gone, and its close changes nothing more", () => {
    const s = run([event("advanced", "signalbox-a", { from: "approved", to: "merged" })]);
    expect(s.beads).toEqual([]);
    expect(run([event("closed", "signalbox-a")], s)).toBe(s);
  });

  test("a close takes out a wagon that has not left", () => {
    expect(run([event("closed", "signalbox-a")]).beads).toEqual([]);
  });

  test("after a session start a figure is at work at its wagon, and none when the session ends", () => {
    const claimed = run([event("claimed", "signalbox-a", { group: "yardr-builders", session: "s1" })]);
    expect(at(claimed, "signalbox-a")).toMatchObject({ working: true, group: "yardr-builders" });
    const crews = (s: State) => people(layout({ ...one, beads: s.beads })).filter((p) => p.bead !== undefined);
    expect(crews(start)).toEqual([]);
    expect(crews(claimed)).toMatchObject([{ bead: { id: "signalbox-a" }, platform: "signalbox/default/new", group: "yardr-builders" }]);
    // The start that follows a claim says nothing new.
    const started = run([event("started", "signalbox-a", { session: "s1" })], claimed);
    expect(started).toBe(claimed);

    for (const end of ["workspace_removed", "released"]) {
      expect(crews(run([event(end, "signalbox-a", { session: "s1" })], claimed)), end).toEqual([]);
    }
    expect(crews(run([event("held", "signalbox-a", { session: "s1" })], claimed))).toEqual([]);
    expect(crews(run([event("advanced", "signalbox-a", { from: "new", to: "review" })], claimed))).toEqual([]);
  });

  test("a start with no claim before it sets a figure to work too", () => {
    const owned = { beads: [bead("signalbox-a", { group: "yardr-builders" })], sessions: {} };
    expect(at(run([event("started", "signalbox-a", { session: "s1" })], owned), "signalbox-a")!.working).toBe(true);
  });

  test("the end of an older session leaves the one at work alone", () => {
    const claimed = run([event("claimed", "signalbox-a", { group: "yardr-builders", session: "s2" })]);
    expect(run([event("workspace_removed", "signalbox-a", { session: "s1" })], claimed)).toBe(claimed);
  });

  test("held shunts the wagon into the siding, unheld back", () => {
    const held = run([event("held", "signalbox-a")]);
    expect(at(held, "signalbox-a")).toMatchObject({ stage: "new", hold: true });
    expect(platform(held, "signalbox-a")).toBe("signalbox/default/decide");
    expect(platform(run([event("unheld", "signalbox-a")], held), "signalbox-a")).toBe("signalbox/default/new");
  });

  test("unknown kinds leave the state unchanged", () => {
    expect(FAULTS.has("constructor")).toBe(false);
    const kinds = ["noted", "crew_status", "hook", "peer_message_sent", "peer_message_received", "a_kind_of_tomorrow", ""];
    for (const kind of kinds) {
      expect(step(start, event(kind, "signalbox-a", { from: "new", to: "review", session: "s1" }), w), kind).toBe(start);
      expect(step(start, event(kind), w), kind).toBe(start);
    }
    // Nor does a known kind about a bead the snapshot does not know.
    for (const kind of SHOWN) {
      expect(step(start, event(kind, "signalbox-zzzz", { from: "new", to: "review" }), w), kind).toBe(start);
    }
  });

  test("no step changes the state it was given", () => {
    const before = JSON.stringify(start);
    run([
      event("claimed", "signalbox-a", { group: "yardr-builders", session: "s1" }),
      event("created", "signalbox-b"),
      event("advanced", "signalbox-a", { from: "new", to: "merged" }),
    ]);
    expect(JSON.stringify(start)).toBe(before);
  });
});

// What the picture makes of a state: the wagon's marks, the figure at it, the
// platforms' lamps, and how many of the builders the hut's sign counts out.
const seen = (s: State, id = "signalbox-a") => {
  const l = layout({ ...one, beads: s.beads });
  const wagon = l.vehicles.find((v) => v.key === id);
  const figure = people(l).find((p) => p.bead?.id === id);
  return { chocked: wagon?.chocked === true, lamp: wagon?.lamp === true, figure: figure && (figure.sat ? "sat" : "at work"), lamps: l.lamps.map((p) => p.platform), out: atWork(l, "yardr-builders") };
};
const well = { chocked: false, lamp: false, figure: undefined, lamps: [], out: 0 };

describe("the faults of the reducer", () => {
  const claim = event("claimed", "signalbox-a", { group: "yardr-builders", session: "s1" });
  const claimed = run([claim]);

  test("held: chocks and a flag at the wagon until unheld", () => {
    const held = run([event("held", "signalbox-a")]);
    expect(seen(held)).toEqual({ ...well, chocked: true });
    expect(seen(run([event("unheld", "signalbox-a")], held))).toEqual(well);
  });

  test("a session that stalled, was blocked, gave up or died leaves its figure sat at the wagon, and is not out", () => {
    expect(seen(claimed)).toEqual({ ...well, figure: "at work", out: 1 });
    for (const [kind, fault] of [
      ["session_stalled", "stalled"],
      ["session_blocked", "blocked"],
      ["session_harness_error", "harness_error"],
      ["session_prompt_gave_up", "prompt_gave_up"],
      ["session_died", "died"],
      ["gave_up", "gave_up"],
    ] as const) {
      const e = event(kind, "signalbox-a", { session: "s1" });
      const sat = run([e], claimed);
      expect(at(sat, "signalbox-a"), kind).toMatchObject({ working: false, group: "yardr-builders", fault: { kind: fault, at: e.at } });
      expect(seen(sat), kind).toEqual({ ...well, figure: "sat" });
      // Its end, when the yard comes to it, sends no one home.
      const ended = run([event("released", "signalbox-a", { session: "s1" }), event("workspace_removed", "signalbox-a", { session: "s1" })], sat);
      expect(seen(ended), kind).toEqual({ ...well, figure: "sat" });
      // The next session on the bead stands it up; so does the bead moving on, and then nobody is at it.
      for (const start of ["claimed", "started"]) {
        const next = run([event(start, "signalbox-a", { group: "yardr-builders", session: "s2" })], ended);
        expect(at(next, "signalbox-a")!.fault, `${kind}, ${start}`).toBeUndefined();
        expect(next.sessions, `${kind}, ${start}`).toEqual({ "signalbox-a": "s2" });
        expect(seen(next), `${kind}, ${start}`).toEqual({ ...well, figure: "at work", out: 1 });
      }
      expect(seen(run([event("advanced", "signalbox-a", { from: "new", to: "review", outcome: "done" })], sat)), kind).toEqual(well);
      expect(run([event("closed", "signalbox-a")], sat).beads, kind).toEqual([]);
    }
  });

  test("a session nobody claimed in the window sits too, with the group its fault names", () => {
    const sat = run([event("session_stalled", "signalbox-a", { group: "yardr-builders", session: "s1" })]);
    expect(seen(sat)).toEqual({ ...well, figure: "sat" });
  });

  test("the fault of an older session leaves the one at work alone", () => {
    expect(run([event("session_stalled", "signalbox-a", { session: "s0" })], claimed)).toBe(claimed);
  });

  test("a blocked session that was answered is at work again", () => {
    const blocked = run([event("session_blocked", "signalbox-a", { session: "s1" })], claimed);
    const back = run([event("session_unblocked", "signalbox-a", { session: "s1" })], blocked);
    expect(back).toEqual(claimed);
    // Only what was blocked: it puts no other fault right, and starts nothing.
    const stalled = run([event("session_stalled", "signalbox-a", { session: "s1" })], claimed);
    expect(run([event("session_unblocked", "signalbox-a", { session: "s1" })], stalled)).toBe(stalled);
    expect(run([event("session_unblocked", "signalbox-a", { session: "s1" })])).toBe(start);
  });

  test("an advance with another outcome than done seats the group it left where the wagon arrives", () => {
    const e = event("advanced", "signalbox-a", { from: "new", to: "decide", outcome: "question", group: "yardr-builders" });
    const asked = run([e], claimed);
    expect(at(asked, "signalbox-a")).toMatchObject({ stage: "decide", group: "yardr-builders", fault: { kind: "ended_question", at: e.at } });
    expect(platform(asked, "signalbox-a")).toBe("signalbox/default/decide");
    expect(seen(asked)).toEqual({ ...well, figure: "sat" });
    expect(people(layout({ ...one, beads: asked.beads })).find((p) => p.sat)!.platform).toBe("signalbox/default/decide");
    // Done, and an advance that names no outcome, are no fault; the next move clears one.
    expect(seen(run([event("advanced", "signalbox-a", { from: "decide", to: "new" })], asked))).toEqual(well);
    expect(seen(run([event("advanced", "signalbox-a", { from: "new", to: "review", outcome: "done", group: "yardr-builders" })], claimed))).toEqual(well);
    // A script's bad end has no figure to sit: the wagon's lamp says it.
    const failed = run([event("advanced", "signalbox-a", { from: "approved", to: "new", outcome: "failed", group: "signalbox-assembly" })]);
    expect(seen(failed)).toEqual({ ...well, lamp: true });
    expect(seen(run([claim], failed))).toEqual({ ...well, figure: "at work", out: 1 });
  });

  test("move_refused: a lamp on the wagon until the bead moves or closes, whoever is at it", () => {
    const e = event("move_refused", "signalbox-a", { session: "s1", group: "yardr-builders" });
    const refused = run([e], claimed);
    expect(at(refused, "signalbox-a")).toMatchObject({ working: true, fault: { kind: "move_refused", at: e.at } });
    expect(refused.sessions).toEqual(claimed.sessions);
    expect(seen(refused)).toEqual({ ...well, lamp: true, figure: "at work", out: 1 });
    // The session's end and the next one's start put nothing right.
    const later = run([event("workspace_removed", "signalbox-a", { session: "s1" }), event("claimed", "signalbox-a", { group: "yardr-builders", session: "s2" })], refused);
    expect(seen(later)).toEqual({ ...well, lamp: true, figure: "at work", out: 1 });
    expect(seen(run([event("advanced", "signalbox-a", { from: "new", to: "review", outcome: "done" })], later))).toEqual(well);
    expect(run([event("closed", "signalbox-a")], later).beads).toEqual([]);
    // Nobody at it: the lamp all the same.
    expect(seen(run([e]))).toEqual({ ...well, lamp: true });
  });

  test("stranded: a lamp on the wagon until the bead moves", () => {
    const stranded = run([event("stranded", "signalbox-a")]);
    expect(at(stranded, "signalbox-a")!.fault!.kind).toBe("stranded");
    expect(seen(stranded)).toEqual({ ...well, lamp: true });
    expect(seen(run([event("advanced", "signalbox-a", { from: "new", to: "review" })], stranded))).toEqual(well);
  });

  test("unrouted: the lamp is the platform's the bead sits at, until the bead moves", () => {
    const unrouted = run([event("unrouted", "signalbox-a")]);
    expect(at(unrouted, "signalbox-a")!.fault!.kind).toBe("unrouted");
    expect(seen(unrouted)).toEqual({ ...well, lamps: ["signalbox/default/new"] });
    expect(seen(run([event("advanced", "signalbox-a", { from: "new", to: "review" })], unrouted))).toEqual(well);
  });

  test("the last fault is the one shown; a held bead keeps its own", () => {
    const both = run([event("session_stalled", "signalbox-a", { session: "s1" }), event("move_refused", "signalbox-a")], claimed);
    expect(at(both, "signalbox-a")).toMatchObject({ working: false, fault: { kind: "move_refused" } });
    const held = run([event("held", "signalbox-a")], both);
    expect(seen(held)).toEqual({ ...well, chocked: true, lamp: true });
    expect(seen(run([event("unheld", "signalbox-a")], held))).toEqual({ ...well, lamp: true });
  });

  test("a fault from before the window is the snapshot's, unless the window says more of the bead", () => {
    const fault = { kind: "died", at: "2098-12-31T23:00:00Z" };
    const end: Yard = { ...one, beads: [bead("signalbox-a", { group: "yardr-builders", working: false, fault })] };
    const quiet: Log = { ...cast, events: [event("noted", "signalbox-a")] };
    expect(seen(state(end, quiet))).toEqual({ ...well, figure: "sat" });
    // The fault the snapshot has is the one this window saw happen: not before it did.
    const loud: Log = { ...cast, events: [event("claimed", "signalbox-a", { group: "yardr-builders", session: "s1" }), event("session_died", "signalbox-a", { session: "s1" })] };
    expect(seen(state(end, loud, 0))).toEqual(well);
    expect(seen(state(end, loud, 1))).toEqual({ ...well, figure: "at work", out: 1 });
    expect(seen(state(end, loud))).toEqual({ ...well, figure: "sat" });
    const only: Log = { ...cast, events: [event("move_refused", "signalbox-a")] };
    const refused: Yard = { ...one, beads: [bead("signalbox-a", { fault: { kind: "move_refused", at: only.events[0]!.at } })] };
    expect(seen(state(refused, only, 0))).toEqual(well);
    expect(seen(state(refused, only))).toEqual({ ...well, lamp: true });
  });

  test("the bar names a fault as it passes", () => {
    for (const kind of FAULTS.keys()) expect(SHOWN.has(kind), kind).toBe(true);
    expect(line({ seq: 1, at: "", kind: "session_stalled", bead: "signalbox-a", data: { group: "yardr-builders" } })).toBe("session stalled · signalbox-a");
    expect(line({ seq: 2, at: "", kind: "move_refused", bead: "signalbox-a" })).toBe("move refused · signalbox-a");
  });
});

describe("the window's start, read off the window", () => {
  const events = [
    event("advanced", "signalbox-a", { from: "new", to: "review", group: "yardr-builders" }),
    event("created", "signalbox-b"),
    event("advanced", "signalbox-b", { from: "backlog", to: "new" }),
    event("advanced", "signalbox-b", { from: "new", to: "merged" }),
    event("closed", "signalbox-b"),
  ];
  const day: Log = { ...cast, events };
  const end: Yard = { ...yard, beads: [bead("signalbox-a", { stage: "review" }), bead("signalbox-idle", { stage: "backlog", group: "backlog", working: true })] };

  test("a bead stands where its first advance left, with the crew that advance names", () => {
    expect(at(opening(end, day), "signalbox-a")).toMatchObject({ stage: "new", group: "yardr-builders", working: true });
  });

  test("a bead made in the window is not there yet; one nothing happened to is as it is now", () => {
    const s = opening(end, day);
    expect(at(s, "signalbox-b")).toBeUndefined();
    expect(at(s, "signalbox-idle")).toEqual(end.beads[1]);
  });

  test("a bead the window moves counts from when it was made until it does; a scrub forward weathers what waits", () => {
    const made = "2099-01-01T00:00:00Z";
    const asked: YardEvent = { seq: 9001, at: "2099-01-09T00:00:00Z", kind: "advanced", bead: "signalbox-a", data: { from: "backlog", to: "decide" } };
    const last: YardEvent = { seq: 9002, at: "2099-01-13T00:00:00Z", kind: "hook" };
    const window: Log = { ...cast, events: [{ seq: 9000, at: "2099-01-04T00:00:00Z", kind: "hook" }, asked, last] };
    const now: Yard = { ...yard, beads: [bead("signalbox-a", { stage: "decide", created_at: made, moved_at: asked.at })] };
    expect(at(opening(now, window), "signalbox-a")).toEqual(bead("signalbox-a", { stage: "backlog", created_at: made }));
    expect(state(now, window)).toEqual({ beads: now.beads, sessions: {} });

    const player = new Player(now, window);
    const wagon = () => layout({ ...now, beads: player.state.beads }, {}, player.clock).vehicles.find((v) => v.key === "signalbox-a")!;
    const day = 24 * 60 * 60 * 1000;
    expect(wagon()).toMatchObject({ platform: "signalbox/default/backlog", age: 3, weather: "dull" });
    player.seek(player.from + 4.5 * day);
    expect(wagon()).toMatchObject({ platform: "signalbox/default/backlog", weather: "rusted" });
    // Moved to decide: fresh again, and older from there.
    player.seek(Date.parse(asked.at));
    expect(wagon()).toMatchObject({ platform: "signalbox/default/decide", age: 0 });
    expect(wagon().weather).toBeUndefined();
    player.seek(player.to);
    expect(wagon()).toMatchObject({ platform: "signalbox/default/decide", age: 4, weather: "dull" });
  });

  test("state(snapshot, events[0..n]) walks the window to the snapshot", () => {
    expect(state(end, day, 0)).toEqual(opening(end, day));
    expect(at(state(end, day, 3), "signalbox-b")!.stage).toBe("new");
    expect(at(state(end, day, 4), "signalbox-b")).toBeUndefined();
    expect(state(end, day).beads.map((b) => [b.id, b.stage]).sort()).toEqual(end.beads.map((b) => [b.id, b.stage]).sort());
  });
});

describe("the committed day", () => {
  const brief = (b: Bead) => [b.id, b.stage, b.working === true ? b.group : undefined, b.hold === true];

  test("played to its end it is the snapshot: every open bead, its stage, its crew", () => {
    expect(log.events.length).toBe(2000);
    expect(state(yard, log).beads.map(brief).sort()).toEqual(yard.beads.map(brief).sort());
  });

  test("its faults come and go: a stalled session sits until the next one starts, a refused move is lit until the bead moves", () => {
    const first = (kind: string) => log.events.findIndex((e) => e.kind === kind);
    for (const [kind, fault] of [["session_stalled", "stalled"], ["move_refused", "move_refused"]] as const) {
      const n = first(kind);
      const id = log.events[n]!.bead!;
      expect(state(yard, log, n).beads.find((b) => b.id === id)?.fault, kind).toBeUndefined();
      expect(state(yard, log, n + 1).beads.find((b) => b.id === id)!.fault, kind).toEqual({ kind: fault, at: log.events[n]!.at });
      // Put right before the window's end.
      expect(state(yard, log).beads.find((b) => b.id === id)?.fault, kind).toBeUndefined();
    }
  });

  test("it starts from another yard, and every moment of it can be laid out", () => {
    expect(state(yard, log, 0).beads.map(brief).sort()).not.toEqual(yard.beads.map(brief).sort());
    for (let n = 0; n <= log.events.length; n += 50) {
      const beads = state(yard, log, n).beads;
      const l = layout({ ...yard, beads });
      expect(l.vehicles.length + l.counts.reduce((sum, c) => sum + c.more, 0), `after ${n}`).toBe(beads.length);
    }
  });

  test("the file holds what the replay reads and nothing of the rest", () => {
    const keys = new Set(log.events.flatMap((e) => Object.keys(e)));
    expect([...keys].sort()).toEqual(["at", "bead", "data", "kind", "seq"]);
    const data = new Set(log.events.flatMap((e) => Object.keys(e.data ?? {})));
    for (const key of data) expect(["from", "to", "outcome", "group", "session", "depot", "type", "peer", "kind", "crew", "reason"]).toContain(key);
    // A reason is the yard's word for a landing, never what somebody wrote.
    for (const e of log.events) if (e.data?.reason !== undefined) expect(e).toMatchObject({ kind: "closed", data: { reason: "merged" } });
    // Sessions by alias, never by the yard's own name for them.
    for (const e of log.events) if (e.data?.session !== undefined) expect(e.data.session).toMatch(/^s[0-9a-f]+$/);
    expect(JSON.stringify(log)).not.toMatch(/\/Users\/|worktree/);
  });
});

describe("the player", () => {
  test("it stands at the window's start, and runs an hour in a minute at 60x", () => {
    const p = new Player(yard, log);
    expect(p.clock).toBe(Date.parse(log.events[0]!.at));
    expect(p.speed).toBe(60);
    p.advance(60);
    expect(p.clock - p.from).toBe(3600_000);
  });

  test("played or scrubbed to a time, the state is the same", () => {
    const played = new Player(yard, log);
    const scrubbed = new Player(yard, log);
    played.speed = 600;
    let passed = 0;
    for (let frame = 0; frame < 300; frame++) passed += played.advance(0.1).length;
    expect(passed).toBeGreaterThan(100);
    scrubbed.seek(played.clock);
    expect(scrubbed.state).toEqual(played.state);
    expect(scrubbed.shown).toEqual(played.shown);
  });

  test("the window's end stops the play, at the snapshot", () => {
    const p = new Player(yard, log);
    p.playing = true;
    p.speed = 600;
    p.seek(p.to - 1000);
    p.advance(10);
    expect(p.playing).toBe(false);
    expect(p.clock).toBe(p.to);
    expect(p.state).toEqual(state(yard, log));
  });

  test("an event in one line: kind, bead, from -> to", () => {
    expect(line({ seq: 1, at: "", kind: "advanced", bead: "signalbox-a", data: { from: "new", to: "review", outcome: "done" } })).toBe("advanced · signalbox-a · new -> review (done)");
    expect(line({ seq: 2, at: "", kind: "peer_message_sent", data: { peer: "airy", kind: "mail" } })).toBe("peer message sent · airy · mail");
    expect(line({ seq: 3, at: "", kind: "closed", bead: "signalbox-a" })).toBe("closed · signalbox-a");
  });
});

// The page as it follows a yard: a snapshot taken in the middle of the
// window, and what came after it as the feed says it, one event at a time.
describe("live", () => {
  // The yard as a snapshot taken after the window's first k events has it:
  // the beads open then, the closed ones among the rest, the log so far.
  function taken(k: number): { yard: Yard; log: Log } {
    const open = state(yard, log, k).beads;
    const ids = new Set(open.map((b) => b.id));
    const rest = [...world(yard, log).cast.values()].filter((b) => !ids.has(b.id));
    return { yard: { ...yard, beads: open }, log: { taken_at: yard.taken_at, beads: rest, events: log.events.slice(0, k) } };
  }
  // An event as it comes over the feed: text, and back.
  const wire = (e: YardEvent) => JSON.parse(JSON.stringify(e)) as YardEvent;

  test("the feed's events are applied as the replay applies them", () => {
    for (const k of [0, 500, 1000, 1500, log.events.length - 1]) {
      const snap = taken(k);
      const p = new Player(snap.yard, snap.log, Date.parse(log.events[k]!.at));
      p.follow();
      expect(p.state.beads.map((b) => b.id).sort(), `at ${k}`).toEqual(snap.yard.beads.map((b) => b.id).sort());
      // The replay of the same window, from the same snapshot.
      const w = world(snap.yard, snap.log);
      let replayed = state(snap.yard, snap.log);
      const passed: YardEvent[] = [];
      for (const e of log.events.slice(k)) {
        expect(p.append(wire(e))).toBe(true);
        // A frame between any two: the picture follows event by event.
        passed.push(...p.advance(0.016));
        replayed = step(replayed, e, w);
        expect(p.state, `after ${e.seq}`).toEqual(replayed);
      }
      expect(passed).toEqual(log.events.slice(k));
      // And as the replay of the whole window ends: the same wagons at the
      // same stages, with the same sessions at work.
      const brief = (b: Bead) => `${b.id} ${b.stage} ${b.working === true} ${b.hold === true}`;
      expect(p.state.beads.map(brief).sort(), `from ${k}`).toEqual(state(yard, log).beads.map(brief).sort());
      expect(p.clock).toBe(p.to);
      expect(p.playing).toBe(true);
    }
  });

  test("an event the window holds already is not taken twice", () => {
    const p = new Player(yard, log);
    const last = log.events.at(-1)!;
    expect(p.append(last)).toBe(false);
    expect(p.append({ ...last, seq: last.seq + 1 })).toBe(true);
    expect(p.append({ ...last, seq: last.seq + 1 })).toBe(false);
    expect(p.seq).toBe(last.seq + 1);
    expect(p.after(last.seq).map((e) => e.seq)).toEqual([last.seq + 1]);
  });

  test("scrubbed back it is the replay of the window, and follow returns to now", () => {
    const now = Date.parse(log.events.at(-1)!.at) + 60_000;
    const p = new Player(yard, log, now);
    expect(p.to).toBe(now);
    p.follow();
    p.live = false;
    p.seek(p.from + 3600_000);
    const then = p.state;
    // The yard goes on: the window grows, the picture stays at its moment.
    const next: YardEvent = { seq: p.seq + 1, at: new Date(now + 1000).toISOString(), kind: "created", bead: yard.beads[0]!.id };
    p.append(next);
    p.extend(now + 5000);
    expect(p.to).toBe(now + 5000);
    expect(p.state).toBe(then);
    p.follow();
    expect(p.clock).toBe(now + 5000);
    expect(p.live).toBe(true);
    expect(p.state).toEqual(state(yard, { ...log, events: [...log.events, next] }));
  });

  test("a window without events yet starts now", () => {
    const p = new Player({ ...yard, beads: [] }, { taken_at: "", beads: [], events: [] }, 5000);
    p.follow();
    expect([p.from, p.to, p.clock]).toEqual([5000, 5000, 5000]);
    expect(p.append({ seq: 1, at: new Date(6000).toISOString(), kind: "hook" })).toBe(true);
    expect(p.advance(0.016).map((e) => e.seq)).toEqual([1]);
  });

  test("what a snapshot does not hold asks for a new one", () => {
    const at = (kind: string, id?: string, data?: YardEvent["data"]) => outgrown(event(kind, id, data), w);
    // The kinds yardr logs for a change of structure (internal/store).
    for (const kind of ["depot_updated", "depot_removed", "flow_set", "flow_removed", "group_set", "group_removed", "route_added", "route_removed", "peer_added", "peer_removed", "peer_renamed", "crew_defined", "pack_applied"]) {
      expect(STRUCTURE.has(kind), kind).toBe(true);
      expect(at(kind), kind).toBe(true);
    }
    // A new shed for a group the yard has: the projected event, as the feed gives it.
    const routeAdded = wire(event("route_added", undefined, { group: "yardr-builders", depot: "signalbox", type: "task" }));
    expect(outgrown(routeAdded, w)).toBe(true);
    // A bead the cast does not know, when the event brings it in.
    expect(at("created", "signalbox-new")).toBe(true);
    expect(at("advanced", "signalbox-new", { from: "backlog", to: "new" })).toBe(true);
    expect(at("noted", "signalbox-new")).toBe(false);
    expect(at("crew_status", "brakeman-journal")).toBe(false);
    // What it knows moves by the reducer alone.
    expect(at("created", "signalbox-b")).toBe(false);
    expect(at("advanced", "signalbox-a", { from: "new", to: "review" })).toBe(false);
    expect(at("claimed", "signalbox-a", { group: "yardr-builders", session: "s1" })).toBe(false);
    // A group comes by its group_set, never by the claim that names it.
    expect(at("claimed", "signalbox-a", { group: "a-new-group", session: "s1" })).toBe(false);
    expect(at("hook")).toBe(false);
  });
});
