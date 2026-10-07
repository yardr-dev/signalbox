// The card of one bead: what a click on its wagon puts at the page's right.
// Everything here is text and is shown as text. main.ts asks the serve
// script for the bead and draws what these functions return; on a page with
// no serve script the card is built from the snapshot's bead alone.

import type { Bead } from "./yard";

export interface Note {
  author?: string;
  at?: string;
  text?: string;
}

// One bead as the serve script answers it on api/bead/<id> (cardOf in
// src/project.ts): the snapshot's bead and what only the yard itself knows.
export interface Detail {
  bead: Bead & { status?: string; updated_at?: string; body?: string };
  // As the yard printed them: oldest first.
  notes: Note[];
}

export interface Card {
  id: string;
  title: string;
  // What and its value, in the order shown.
  facts: [string, string][];
  body: string;
  // Newest first: who and when, then what was said.
  notes: { head: string; text: string }[];
  // What the card does not show, and why.
  remark: string;
}

// The remarks of a card that has no notes to show.
export const ASKING = "asking the yard for the notes";
export const NEEDS_LIVE = "notes need the live page";
export const NO_ANSWER = "the yard did not answer: no notes";

// A time as the yard printed it, for the reader.
export type When = (iso: string) => string;

function facts(bead: Detail["bead"], when: When): [string, string][] {
  const closed = bead.status === "closed";
  const session = bead.working === true ? "session at work" : closed ? "closed" : "no session";
  const rows: [string, string][] = [
    ["depot", bead.depot],
    ["type", bead.type],
    ["stage", bead.stage],
    ["group", `${bead.group ?? "none"} · ${session}`],
    ["hold", bead.hold === true ? "held" : "no"],
    ["priority", `P${bead.priority}`],
    ["labels", bead.labels && bead.labels.length > 0 ? bead.labels.join(", ") : "none"],
    ["created", when(bead.created_at)],
  ];
  // What the yard prints is the last change of any kind, a note too, not the
  // last move alone. The snapshot does not have it.
  if (bead.updated_at !== undefined) rows.push(["last changed", when(bead.updated_at)]);
  return rows;
}

// The card of a bead the yard answered for.
export function card(detail: Detail, when: When): Card {
  const { bead } = detail;
  // By time, and two of one moment in the order they were written.
  const notes = detail.notes
    .map((note, k) => ({ note, k }))
    .sort((a, b) => (b.note.at ?? "").localeCompare(a.note.at ?? "") || b.k - a.k)
    .map(({ note }) => ({
      head: `${note.author ?? "?"}${note.at === undefined ? "" : ` · ${when(note.at)}`}`,
      text: note.text ?? "",
    }));
  return {
    id: bead.id,
    title: bead.title,
    facts: facts(bead, when),
    body: bead.body ?? "",
    notes,
    remark: notes.length === 0 ? "no notes" : "",
  };
}

// The card of a bead as the snapshot has it, and why it has no more.
export function brief(bead: Bead, when: When, remark: string): Card {
  return { ...card({ bead, notes: [] }, when), remark };
}

// The card of a bead the yard does not know: a wagon of a replay may be
// one, or the bead went while the page stood open.
export function missing(id: string): Card {
  return { id, title: "not found", facts: [], body: "", notes: [], remark: "the yard has no bead of this id" };
}
