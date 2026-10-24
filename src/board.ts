// The arrivals board: the beads in progress and when they are expected as
// rows of a station board, pure. main.ts opens it over the 3D view from the
// bar's button and draws
// what these functions return; the demo's replay reads the same rows from
// its states as the live page does from the yard.

import { flowIndex, faulted, seats, shedGroups, travelOrder } from "./layout";
import type { Bead, Yard } from "./yard";

// How many rows the board holds: the top of what is in progress.
export const LIMIT = 15;

// The stage a bead waits in before anything works it: not in progress, and
// not on the board.
const BACKLOG = "backlog";

// No expected arrival: the yard serves none yet, or the bead is below its
// sample floor.
export const NO_TIME = "—";

// One row: everything the board shows of one bead, as text. The remark is
// blank when there is none; its tone is the board's red block or its
// yellow, and its title what a hover says more.
export interface Row {
  bead: Bead;
  time: string;
  badge: string;
  title: string;
  via: string[];
  platform: string;
  line: string;
  remark: string;
  tone: "red" | "amber" | "none";
  more: string;
}

// A span the yard prints ("2h", "30m", "2h 5m") in minutes: what the rows
// are ordered by. Nothing for what does not read as a span.
export function minutes(span: string): number | undefined {
  const each = span.match(/(\d+)\s*([dhms])/gi) ?? [];
  if (each.length === 0) return undefined;
  const long: Record<string, number> = { d: 24 * 60, h: 60, m: 1, s: 1 / 60 };
  return each.reduce((sum, part) => {
    const [, n, unit] = part.match(/(\d+)\s*([dhms])/i)!;
    return sum + Number(n) * long[unit!.toLowerCase()]!;
  }, 0);
}

// The row's time: the yard's range, one span when both ends are the same,
// and no time where the yard serves none.
export function etaText(bead: Bead): string {
  const eta = bead.eta;
  if (eta === undefined) return NO_TIME;
  return eta.low === eta.high ? eta.low : `${eta.low}–${eta.high}`;
}

// The row's badge: the group building it, or its type where none has it.
export function badge(bead: Bead): string {
  return bead.group ?? bead.type;
}

// The stages still ahead of a bead in its flow, in the order it travels
// them, past the buffer left out: the row's via. None where its stage is
// not on its flow, or is the last one before the buffer.
export function via(yard: Yard, bead: Bead): string[] {
  const flows = yard.flows.find((f) => f.depot === bead.depot)?.flows ?? [];
  const flow = flows[flowIndex(flows, bead.type)];
  if (flow === undefined) return [];
  const order = travelOrder(flow);
  const at = order.indexOf(bead.stage);
  if (at < 0) return [];
  const terminal = new Set(flow.stages.filter((s) => s.terminal === true).map((s) => s.stage));
  return order.slice(at + 1).filter((s) => !terminal.has(s));
}

// Whether a bead stands where only a person moves it on.
function waitsOnPerson(yard: Yard, bead: Bead): boolean {
  const flows = yard.flows.find((f) => f.depot === bead.depot)?.flows ?? [];
  const flow = flows[flowIndex(flows, bead.type)];
  return flow?.stages.find((s) => s.stage === bead.stage)?.human === true;
}

// Who the bead waits for at its people's stage: the members of the group
// its route names, else the group itself. Nobody where no route names one.
function waitedFor(yard: Yard, bead: Bead): string {
  const flows = yard.flows.find((f) => f.depot === bead.depot)?.flows ?? [];
  const flow = flows[flowIndex(flows, bead.type)];
  const group = flow?.stages.find((s) => s.stage === bead.stage)?.group
    ?? (flow === undefined ? undefined : shedGroups(yard, bead.depot, flow, bead.stage)[0]);
  const members = yard.groups.find((g) => g.name === group)?.members ?? [];
  if (members.length > 0) return members.join(", ");
  return group ?? "a person";
}

// The row's remark: held, stalled, waiting for a person, late, in that
// order, else blank. A hold and a session that came to no good end are the
// board's red block; waiting and late are its yellow. A blocked session is
// stalled too: its agent is stopped until someone answers.
export function remark(yard: Yard, bead: Bead): Pick<Row, "remark" | "tone" | "more"> {
  if (bead.hold === true) return { remark: "held", tone: "red", more: "set aside until someone lets it go on" };
  if (bead.fault !== undefined && seats(bead.fault)) return { remark: "stalled", tone: "red", more: faulted(bead.fault) };
  if (waitsOnPerson(yard, bead)) return { remark: `waits for ${waitedFor(yard, bead)}`, tone: "amber", more: "" };
  const late = bead.late;
  if (late !== undefined) return { remark: "late", tone: "amber", more: `in ${late.stage} ${late.in_stage}, past the usual ${late.p90}` };
  return { remark: "", tone: "none", more: "" };
}

// The board's rows: what is in progress, a running session first, then what
// is queued, ordered by expected arrival where the yard serves one, else by
// how long it has stood at its stage, oldest first. Not the backlog.
export function rows(yard: Yard, beads: Bead[]): Row[] {
  const running = (b: Bead) => b.working === true;
  const arrival = (b: Bead) => (b.eta === undefined ? undefined : minutes(b.eta.low));
  const aged = [...beads]
    .filter((b) => b.stage !== BACKLOG)
    .sort((a, b) => {
      if (running(a) !== running(b)) return running(a) ? -1 : 1;
      const [x, y] = [arrival(a), arrival(b)];
      if (x !== y) return x === undefined ? 1 : y === undefined ? -1 : x - y;
      const [aSince, bSince] = [a.moved_at ?? a.created_at, b.moved_at ?? b.created_at];
      return aSince < bSince ? -1 : aSince > bSince ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, LIMIT);
  return aged.map((bead) => ({ bead, time: etaText(bead), badge: badge(bead), title: bead.title ?? bead.id, via: via(yard, bead), platform: bead.stage, line: bead.depot, ...remark(yard, bead) }));
}
