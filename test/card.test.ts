import { describe, expect, test } from "vitest";
import { agreed, ASKING, brief, card, missing, NEEDS_LIVE, type Detail } from "../src/card";
import type { Bead } from "../src/yard";

// The yard's times as they are, so the card's text is the same everywhere.
const when = (iso: string) => `<${iso}>`;

const bead: Bead = { id: "signalbox-a", title: "Click a wagon", type: "task", stage: "new", depot: "signalbox", group: "builders", working: true, priority: 2, created_at: "2099-01-01T00:00:00Z" };

describe("the card", () => {
  test("the bead's facts in order, its body, and its notes newest first", () => {
    const detail: Detail = {
      bead: { ...bead, hold: true, labels: ["web", "ui"], status: "open", updated_at: "2099-01-03T00:00:00Z", body: "Show a card.\n\nOn a click." },
      notes: [
        { author: "signalbox-a-new", at: "2099-01-01T01:00:00Z", text: "built" },
        { author: "signalbox-a-review", at: "2099-01-02T01:00:00Z", text: "approved\nwith a line" },
        { author: "brakeman", at: "2099-01-02T01:00:00Z", text: "landed" },
      ],
    };
    expect(card(detail, when)).toEqual({
      id: "signalbox-a",
      title: "Click a wagon",
      facts: [
        ["depot", "signalbox"],
        ["type", "task"],
        ["stage", "new"],
        ["group", "builders · session at work"],
        ["fault", "none"],
        ["hold", "held"],
        ["priority", "P2"],
        ["labels", "web, ui"],
        ["created", "<2099-01-01T00:00:00Z>"],
        ["last changed", "<2099-01-03T00:00:00Z>"],
      ],
      body: "Show a card.\n\nOn a click.",
      // Two of one moment: the one written later comes first.
      notes: [
        { head: "brakeman · <2099-01-02T01:00:00Z>", text: "landed" },
        { head: "signalbox-a-review · <2099-01-02T01:00:00Z>", text: "approved\nwith a line" },
        { head: "signalbox-a-new · <2099-01-01T01:00:00Z>", text: "built" },
      ],
      remark: "",
    });
  });

  test("what a bead does not have is said, not left out", () => {
    const bare: Detail = { bead: { ...bead, group: undefined, working: false, labels: [] }, notes: [{}] };
    const c = card(bare, when);
    expect(Object.fromEntries(c.facts)).toMatchObject({ group: "none · no session", hold: "no", labels: "none" });
    expect(c.body).toBe("");
    expect(c.notes).toEqual([{ head: "?", text: "" }]);
    expect(card({ bead, notes: [] }, when).remark).toBe("no notes");
    // A closed bead has no session to wait for.
    const closed = card({ bead: { ...bead, working: false, status: "closed" }, notes: [] }, when);
    expect(Object.fromEntries(closed.facts).group).toBe("builders · closed");
  });

  test("a fault is named as the tip names it, and when; no session is said only of a bead with none and no fault", () => {
    const at = "2099-01-02T00:48:00Z";
    const of = (more: Partial<Detail["bead"]>) => Object.fromEntries(card({ bead: { ...bead, working: false, ...more }, notes: [] }, when).facts);
    // Its last session failed: the figure that sits by the wagon.
    expect(of({ fault: { kind: "failed", at } })).toMatchObject({ group: "builders", fault: `session failed <${at}>` });
    expect(of({ fault: { kind: "stalled", at } }).fault).toBe(`session stalled <${at}>`);
    expect(of({ fault: { kind: "gave_up", at } }).fault).toBe(`session gave up <${at}>`);
    expect(of({ fault: { kind: "ended_question", at } }).fault).toBe(`session ended with question <${at}>`);
    // The yard's word on the bead itself is no session's, and a time nobody knows is not said.
    expect(of({ group: undefined, fault: { kind: "move_refused", at: "" } })).toMatchObject({ group: "none", fault: "move refused" });
    // A session at work on it, and none: no fault.
    expect(of({ working: true })).toMatchObject({ group: "builders · session at work", fault: "none" });
    expect(of({})).toMatchObject({ group: "builders · no session", fault: "none" });
    // A refused move with a session at work on the bead: both are said.
    expect(of({ working: true, fault: { kind: "move_refused", at } })).toMatchObject({ group: "builders · session at work", fault: `move refused <${at}>` });
    // The card shown first, from the page's bead, says the same.
    expect(brief({ ...bead, working: false, fault: { kind: "failed", at } }, when, ASKING).facts).toEqual(card({ bead: { ...bead, working: false, fault: { kind: "failed", at } }, notes: [] }, when).facts);
  });

  test("the yard's answer agrees with the fault the page shows, including on a replay", () => {
    const at = "2099-01-02T00:48:00Z";
    const answer: Detail = { bead: { ...bead, working: false, status: "open", fault: { kind: "died", at } }, notes: [] };
    // On a replay, the answer may know of a later session fault the page does not show.
    expect(agreed(answer, bead).bead.fault).toBeUndefined();
    const shown = { ...bead, fault: { kind: "move_refused", at } };
    expect(agreed({ ...answer, bead: { ...bead, status: "open" } }, shown).bead).toEqual({ ...bead, status: "open", fault: shown.fault });
    expect(agreed(answer, shown).bead.fault).toEqual(shown.fault);
  });

  test("from the snapshot alone: what it has, and why there are no notes", () => {
    const c = brief(bead, when, NEEDS_LIVE);
    expect(c).toMatchObject({ id: "signalbox-a", title: "Click a wagon", body: "", notes: [], remark: "notes need the live page" });
    expect(c.facts.map(([what]) => what)).toEqual(["depot", "type", "stage", "group", "fault", "hold", "priority", "labels", "created"]);
    expect(brief(bead, when, ASKING).remark).toBe(ASKING);
  });

  test("a bead the yard does not know", () => {
    expect(missing("signalbox-zzzz")).toMatchObject({ id: "signalbox-zzzz", title: "not found", facts: [], notes: [] });
  });
});
