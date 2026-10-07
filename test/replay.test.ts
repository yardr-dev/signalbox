import { describe, expect, test } from "vitest";
import window from "../public/events.json";
import snapshot from "../public/yard.json";
import { layout } from "../src/layout";
import { Player } from "../src/player";
import { line, opening, outgrown, SHOWN, state, step, STRUCTURE, world, type Log, type State, type YardEvent } from "../src/replay";
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

  test("after a terminal stage it is gone, and its close changes nothing more", () => {
    const s = run([event("advanced", "signalbox-a", { from: "approved", to: "merged" })]);
    expect(s.beads).toEqual([]);
    expect(run([event("closed", "signalbox-a")], s)).toBe(s);
  });

  test("a close takes out a wagon that has not left", () => {
    expect(run([event("closed", "signalbox-a")]).beads).toEqual([]);
  });

  test("after a session start the bay's crew is out, and back when the session ends", () => {
    const claimed = run([event("claimed", "signalbox-a", { group: "yardr-builders", session: "s1" })]);
    expect(at(claimed, "signalbox-a")).toMatchObject({ working: true, group: "yardr-builders" });
    const crews = (s: State) => layout({ ...one, beads: s.beads }).crews;
    expect(crews(start)).toEqual([]);
    expect(crews(claimed)).toMatchObject([{ bead: { id: "signalbox-a" }, out: true }]);
    // The start that follows a claim says nothing new.
    const started = run([event("started", "signalbox-a", { session: "s1" })], claimed);
    expect(started).toBe(claimed);

    for (const end of ["workspace_removed", "session_died", "released"]) {
      expect(crews(run([event(end, "signalbox-a", { session: "s1" })], claimed)), end).toEqual([]);
    }
    expect(crews(run([event("held", "signalbox-a", { session: "s1" })], claimed))).toEqual([]);
    expect(crews(run([event("advanced", "signalbox-a", { from: "new", to: "review" })], claimed))).toEqual([]);
  });

  test("a start with no claim before it brings the crew out too", () => {
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
    for (const key of data) expect(["from", "to", "outcome", "group", "session", "depot", "type", "peer", "kind", "crew"]).toContain(key);
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
      // same stages, with the same crews out.
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
    const at = (kind: string, id?: string, data?: YardEvent["data"]) => outgrown(event(kind, id, data), one, w);
    // The kinds yardr logs for a change of structure (internal/store).
    for (const kind of ["depot_updated", "depot_removed", "flow_set", "flow_removed", "peer_added", "peer_removed", "peer_renamed", "crew_defined", "pack_applied"]) {
      expect(STRUCTURE.has(kind), kind).toBe(true);
      expect(at(kind), kind).toBe(true);
    }
    // A bead the cast does not know, when the event brings it in.
    expect(at("created", "signalbox-new")).toBe(true);
    expect(at("advanced", "signalbox-new", { from: "backlog", to: "new" })).toBe(true);
    expect(at("noted", "signalbox-new")).toBe(false);
    expect(at("crew_status", "brakeman-journal")).toBe(false);
    // What it knows moves by the reducer alone.
    expect(at("created", "signalbox-b")).toBe(false);
    expect(at("advanced", "signalbox-a", { from: "new", to: "review" })).toBe(false);
    expect(at("claimed", "signalbox-a", { group: "yardr-builders", session: "s1" })).toBe(false);
    expect(at("claimed", "signalbox-a", { group: "a-new-group", session: "s1" })).toBe(true);
    expect(at("hook")).toBe(false);
  });
});
