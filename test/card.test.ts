import { describe, expect, test } from "vitest";
import { ASKING, brief, card, missing, NEEDS_LIVE, type Detail } from "../src/card";
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

  test("from the snapshot alone: what it has, and why there are no notes", () => {
    const c = brief(bead, when, NEEDS_LIVE);
    expect(c).toMatchObject({ id: "signalbox-a", title: "Click a wagon", body: "", notes: [], remark: "notes need the live page" });
    expect(c.facts.map(([what]) => what)).toEqual(["depot", "type", "stage", "group", "hold", "priority", "labels", "created"]);
    expect(brief(bead, when, ASKING).remark).toBe(ASKING);
  });

  test("a bead the yard does not know", () => {
    expect(missing("signalbox-zzzz")).toMatchObject({ id: "signalbox-zzzz", title: "not found", facts: [], notes: [] });
  });
});
