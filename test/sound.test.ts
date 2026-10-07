import { describe, expect, test } from "vitest";
import window from "../public/events.json";
import { cueOf, cues, Sound, type Store } from "../src/sound";
import type { Log, YardEvent } from "../src/replay";

const log = window as Log;

let seq = 0;
function event(kind: string, data?: YardEvent["data"]): YardEvent {
  seq++;
  return { seq, at: new Date(Date.UTC(2099, 0, 1, 0, 0, seq)).toISOString(), kind, bead: "signalbox-a", ...(data ? { data } : {}) };
}

describe("the cue of an event", () => {
  test("a landing whistles: a close with the reason merged, and no other close", () => {
    expect(cueOf(event("closed", { reason: "merged" }))).toBe("whistle");
    expect(cueOf(event("closed"))).toBeUndefined();
    expect(cueOf(event("closed", { group: "backlog" }))).toBeUndefined();
    // The arrival at the last stage is the shunter's; the close after it whistles.
    expect(cueOf(event("advanced", { from: "approved", to: "merged", outcome: "done" }))).toBeUndefined();
  });

  test("a session that stalled or was given up rings the bell", () => {
    expect(cueOf(event("session_stalled", { group: "builders", session: "s1" }))).toBe("bell");
    expect(cueOf(event("session_prompt_gave_up"))).toBe("bell");
    expect(cueOf(event("advanced", { from: "new", to: "decide", outcome: "gave_up" }))).toBe("bell");
    expect(cueOf(event("advanced", { from: "new", to: "review", outcome: "done" }))).toBeUndefined();
    expect(cueOf(event("session_idle"))).toBeUndefined();
  });

  test("the kinds the yard is full of are silent", () => {
    for (const kind of ["created", "claimed", "started", "released", "held", "hook", "noted", "peer_message_sent"]) expect(cueOf(event(kind)), kind).toBeUndefined();
  });

  test("the events passed together sound each cue once, in the order they came", () => {
    const landing = event("closed", { reason: "merged" });
    expect(cues([event("hook"), event("session_stalled"), landing, landing, event("session_prompt_gave_up")])).toEqual(["bell", "whistle"]);
    expect(cues([event("hook"), event("claimed")])).toEqual([]);
    expect(cues([])).toEqual([]);
  });

  test("the committed window has landings to whistle at, and a stall to ring for", () => {
    const heard = log.events.map(cueOf);
    expect(heard.filter((c) => c === "whistle").length).toBeGreaterThan(10);
    expect(heard).toContain("bell");
    // Not every close is a landing: a duplicate is closed where it stood.
    expect(heard.filter((c) => c === "whistle").length).toBeLessThan(log.events.filter((e) => e.kind === "closed").length);
  });
});

describe("the switch", () => {
  // A browser's storage, and an AudioContext that only says it was made.
  const kept = (): Store & { said: Map<string, string> } => {
    const said = new Map<string, string>();
    return { said, getItem: (key) => said.get(key) ?? null, setItem: (key, value) => void said.set(key, value) };
  };
  const context = (state: AudioContextState) => {
    const made: string[] = [];
    const fake = { state, currentTime: 0, resume: async () => void made.push("resume"), suspend: async () => void made.push("suspend") };
    return { made, make: () => (made.push("made"), fake as unknown as AudioContext) };
  };

  test("off by default: nothing is made, by a touch or by a cue", () => {
    const { made, make } = context("suspended");
    const sound = new Sound(kept, make);
    expect(sound.on).toBe(false);
    sound.wake();
    sound.play("whistle");
    expect(made).toEqual([]);
  });

  test("turned on, the context is made by that click, and the choice is kept for the next visit", () => {
    const store = kept();
    const { made, make } = context("suspended");
    const sound = new Sound(() => store, make);
    sound.set(true);
    expect(made).toEqual(["made", "resume"]);
    expect(new Sound(() => store, make).on).toBe(true);
    // Off is silent at once, and kept too.
    sound.set(false);
    expect(made).toEqual(["made", "resume", "suspend"]);
    expect(new Sound(() => store, make).on).toBe(false);
  });

  test("left on by an earlier visit, nothing is made before the page is touched", () => {
    const store = kept();
    new Sound(() => store, context("running").make).set(true);
    const { made, make } = context("suspended");
    const sound = new Sound(() => store, make);
    expect(sound.on).toBe(true);
    sound.play("bell");
    expect(made).toEqual([]);
    sound.wake();
    expect(made).toEqual(["made", "resume"]);
    // Still suspended: no cue is started on a context that does not run.
    sound.play("bell");
  });

  test("a browser that refuses its storage has the switch all the same", () => {
    const refused = () => {
      throw new Error("SecurityError");
    };
    const { made, make } = context("running");
    const sound = new Sound(refused, make);
    expect(sound.on).toBe(false);
    sound.set(true);
    expect(sound.on).toBe(true);
    expect(made).toEqual(["made"]);
  });
});
