// Ask a yardr yard what the page draws, through its own commands
// (yardr ... --json), never its store or socket. What comes back is cut down
// by src/project.ts, the one place that decides which fields are passed on;
// scripts/snapshot.mjs writes it to files and scripts/serve.mjs serves it.
//
// node runs the page's TypeScript as it is: it has only types to strip.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cardOf, eventOf, logOf, yardOf } from "../src/project.ts";

// The window the page replays. yardr events has no --since, so it is a count
// and not a day: the newest 2000, oldest first.
export const WINDOW = 2000;

// A session's name on the page: the same for the same session in every
// answer, so a start in the snapshot pairs with its end in the feed, and
// across a restart of the serve script. Not the yard's own name for it.
export function alias(session) {
  return `s${createHash("sha256").update(session).digest("hex").slice(0, 8)}`;
}

// Run one command of the yard and read what it prints. YARDR names the
// binary; the yard is the one its environment names (YARDR_HOME).
export function yardr(bin = process.env.YARDR || "yardr") {
  return (...args) =>
    new Promise((resolve, reject) => {
      execFile(bin, [...args, "--json"], { maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`${bin} ${args.join(" ")}: ${stderr.trim() || said(stdout) || err.message}`));
        try {
          resolve(JSON.parse(stdout));
        } catch (cause) {
          reject(new Error(`${bin} ${args.join(" ")}: not JSON`, { cause }));
        }
      });
    });
}

// What a command that failed printed: with --json its error is an object on
// stdout, and stderr is empty.
function said(stdout) {
  try {
    const { error } = JSON.parse(stdout);
    return typeof error === "string" ? error : "";
  } catch {
    return "";
  }
}

// How many dep list commands run at a time.
const AT_ONCE = 8;

// The edges that touch the open beads. yardr has no listing of a yard's
// edges: dep list takes one bead. So this is a command for every open bead,
// a few at a time, on every snapshot: a yard of n open beads starts n
// processes for it. An edge between two open beads comes back twice
// (src/project.ts keeps it once).
async function edges(run, beads) {
  const out = [];
  for (let i = 0; i < beads.length; i += AT_ONCE) {
    const some = await Promise.all(beads.slice(i, i + AT_ONCE).map((b) => run("dep", "list", b.id)));
    // A bead with no edge may print null for its list.
    out.push(...some.flatMap((printed) => printed ?? []));
  }
  return out;
}

const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// The yard now and the window of its log: yard.json and events.json.
export async function snapshot(run, window = WINDOW) {
  const [depots, groups, routes, crew, peers, beads, events, all, sessions] = await Promise.all([
    run("depot", "list"),
    run("group", "list"),
    run("route", "list"),
    run("crew", "list"),
    run("peer", "list"),
    // Without -a or --all: every open bead.
    run("bead", "list"),
    run("events", "-n", String(window)),
    // Every bead there ever was: the ones the window names and that have
    // closed since are in no other list.
    run("bead", "list", "--all"),
    // The ended ones too, every one: how a bead's last session ended is a
    // fault the picture shows, however long ago that was.
    run("session", "list", "-a", "--all"),
  ]);
  const flows = await Promise.all(depots.map(async ({ name }) => ({ depot: name, flows: await run("flow", "show", name) })));
  const waits = await edges(run, beads);
  const taken_at = now();
  return {
    yard: yardOf({ depots, flows, groups, routes, crew, peers, beads, sessions, events, edges: waits }, taken_at),
    log: logOf(taken_at, bySeq(events), all, alias),
  };
}

// The yard's newest n events, oldest first, as the replay reads them.
export async function recent(run, n) {
  return bySeq(await run("events", "-n", String(n))).map((e) => eventOf(e, alias));
}

function bySeq(events) {
  return [...events].sort((a, b) => a.seq - b.seq);
}

// One bead for its card, or nothing when the yard has no bead of that id.
// From prime, not bead show: bead show prints the bead without its notes.
// prime only reads.
export async function bead(run, id) {
  try {
    return cardOf(await run("prime", "--bead", id));
  } catch (err) {
    if (err instanceof Error && err.message.endsWith(": not found")) return undefined;
    throw err;
  }
}
