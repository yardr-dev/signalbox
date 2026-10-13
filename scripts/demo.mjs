#!/usr/bin/env node
// Write the demo: a made-up yard and one day of it, as the four files a
// snapshot is (yard.json, events.json, layout.json, quota.json). They are
// committed in public/, where the page plays them when nothing serves it a
// yard, and the tests read them as their fixture.
//
//   node scripts/demo.mjs [dir]     (npm run demo; dir is public when left out)
//
// Nothing here is read from a yard. The yard is described below (DEPOTS to
// EXTRAS): what it is built of, the beads it has, and for each bead the
// stages it passes on the day with the minutes it stands at each. From that
// a small yard is played: sessions take the places their group has, wait
// when there is none, and every step is logged as yardr logs it. What comes
// out is the lists and the log of a web view, and they go through
// src/project.ts as a real snapshot's do (scripts/yard.mjs), so the files
// have the shape `npm run snapshot` writes.
//
// The same description gives the same files, to the byte: test/demo.test.mjs
// holds the committed ones to it. To change the demo, change the description
// and run this again; the tests that name a bead of it say which they need.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { place } from "../src/layout.ts";
import { logOf, quotaOf, yardOf } from "../src/project.ts";
import { alias } from "./yard.mjs";

// The day, and the window of its log: from the first event to the snapshot.
const DAY = "2026-05-12";
const TAKEN = "19:30";
// The sequence number of the day's first event: a yard that is not new.
const FIRST_SEQ = 5201;

const DEPOTS = ["gauge", "sextant", "wharf", "wharf.dev"];

// A stage: its name, the group flow show resolved for it ("" for none), the
// stages it leads to, and what it is (human, terminal).
const stage = ([name, group, next, mark]) => ({
  stage: name,
  ...(group ? { group } : {}),
  next: next ? next.split(" ") : [],
  ...(mark ? { [mark]: true } : {}),
});
const flow = (name, type, stages) => ({ name, type, stages: stages.map(stage) });
// The line every depot has: built, reviewed, landed by the depot's own script.
const line = (name, landing) =>
  flow(name, null, [
    ["backlog", "backlog", "new decide", "human"],
    ["new", "wharf-builders", "review decide backlog"],
    ["decide", "decisions", "backlog new", "human"],
    ["review", "wharf-reviewers", "approved new decide"],
    ["approved", landing, "merged new decide"],
    ["merged", "", "", "terminal"],
  ]);

const FLOWS = {
  gauge: [
    line("gauge", "gauge-landing"),
    flow("pr-review", "pr-review", [
      ["review", "wharf-reviewers", "done decide"],
      ["done", "", "", "terminal"],
      ["decide", "decisions", "review", "human"],
    ]),
  ],
  sextant: [line("default", "sextant-assembly")],
  wharf: [
    line("default", "wharf-refinery"),
    flow("wharf.train", "train", [
      ["backlog", "backlog", "open", "human"],
      ["open", "wharf-integrators", "review open merge backlog"],
      ["review", "wharf-reviewers", "approved open decide"],
      ["merge", "", "open decide"],
      ["approved", "wharf-refinery", "in-pr open merge merged"],
      ["decide", "decisions", "open backlog", "human"],
      ["in-pr", "", "land open decide"],
      ["merged", "", "", "terminal"],
      ["land", "", "merged open"],
    ]),
    flow("type/wagon", "wagon", [
      ["backlog", "backlog", "new", "human"],
      ["new", "wharf-builders", "approved decide backlog"],
      ["approved", "wharf-refinery", "merged new decide"],
      ["decide", "decisions", "backlog new", "human"],
      ["merged", "", "", "terminal"],
    ]),
  ],
  "wharf.dev": [line("default", "wharf.dev-assembly")],
};

// name, runner, limit, then the agent its sessions are or the people in it.
const GROUPS = [
  ["backlog", "manual", 50, ["nell", "yardmaster"]],
  ["decisions", "manual", 50, ["nell", "yardmaster"]],
  ["flagman-reviews", "manual", 3, ["flagman", "yardmaster"]],
  ["gauge-landing", "exec", 1],
  ["sextant-assembly", "exec", 1],
  ["wharf-builders", "herdr", 3, "kimi"],
  ["wharf-integrators", "exec", 1],
  ["wharf-refinery", "exec", 1],
  ["wharf-reviewers", "herdr", 3, "claude"],
  ["wharf.dev-assembly", "exec", 1],
].map(([name, runner, limit, who]) => ({
  name,
  runner,
  limit,
  ...(Array.isArray(who) ? { members: who } : {}),
  ...(typeof who === "string" ? { config: { kind: who } } : {}),
}));

// In match order: "stage group", then what narrows it (type=, depot=,
// label=) and its priority.
const ROUTES = [
  "open wharf-integrators type=train depot=wharf 10",
  "review flagman-reviews depot=wharf label=flagman-review 10",
  "review wharf-reviewers type=pr-review depot=gauge",
  "decide decisions type=pr-review depot=gauge",
  "new wharf-builders depot=gauge",
  "review wharf-reviewers depot=gauge",
  "backlog backlog depot=wharf",
  "new wharf-builders depot=wharf",
  "review wharf-reviewers depot=wharf",
  "approved wharf-refinery depot=wharf",
  "decide decisions depot=wharf",
  "backlog backlog depot=sextant",
  "new wharf-builders depot=sextant",
  "review wharf-reviewers depot=sextant",
  "approved sextant-assembly depot=sextant",
  "decide decisions depot=sextant",
  "backlog backlog depot=wharf.dev",
  "new wharf-builders depot=wharf.dev",
  "review wharf-reviewers depot=wharf.dev",
  "approved wharf.dev-assembly depot=wharf.dev",
  "decide decisions depot=wharf.dev",
  "backlog backlog depot=gauge",
  "decide decisions depot=gauge",
  "approved gauge-landing depot=gauge",
].map((text) => {
  const [at, group, ...more] = text.split(" ");
  const route = { stage: at, group, priority: 0 };
  for (const word of more) {
    const [key, value] = word.split("=");
    if (value === undefined) route.priority = Number(key);
    else route[key] = value;
  }
  return route;
});

const CREW = [
  { name: "flagman", config: { kind: "kimi" }, state: "running", status: "idle" },
  { name: "yardmaster", config: { kind: "claude" }, state: "running", status: "idle" },
];

const PEERS = [{ name: "quay", send: ["mail", "ping"], receive: ["mail", "ping"] }];

// What is left of the providers' quota, as aiquokka --json would print it.
const QUOTA = {
  kimi: { provider: "Kimi", windows: [{ duration_seconds: 604800, used_percent: 41 }, { duration_seconds: 18000, used_percent: 22 }] },
  claude: { provider: "Claude", plan: "Max", windows: [{ duration_seconds: 604800, used_percent: 63 }, { duration_seconds: 18000, used_percent: 84 }] },
};

// The beads. Each is its id (the depot before the last dash), its title, and
// what more it has:
//   age    it was made that many days before the day, and stands at `stage`
//          (backlog when left out) as the day begins; without an age it is
//          made on the day, at `at`
//   plan   the stages it stands at from then on, in order, one step each:
//            "new 25"               25 minutes there, then on to the stage's
//                                   first transition; a session of the
//                                   stage's group works it for that long,
//                                   once the group has a place free
//            "backlog @09:10"       until 09:10; for a group of agents or
//                                   scripts, no session before 09:10
//            "review 6 changes>new" on with that outcome to that stage;
//                                   ">new" names the stage alone
//            "new 13 hold"          held after 13 minutes, where it stands
//            "unhold @13:40"        let go again, for the step after it
//            "new"                  no minutes: it stays to the day's end,
//                                   its session at work
//          and what happens to the session meanwhile: stall@3 (stalled
//          after 3 minutes), refused@2 (a move refused), block@6+7
//          (blocked after 6 minutes, answered 7 later)
//   type, train, labels, priority, hold   as yardr has them
const BEADS = [
  // What stood in the yard before the day.
  { id: "wharf-b2qe", title: "Design: roll back to any earlier release, not only the last one", age: 19, plan: ["backlog"] },
  { id: "wharf-h7xa", title: "Docs: the quickstart still names the old config file", age: 9, plan: ["backlog"] },
  { id: "wharf-p9cd", title: "Design: notifier plugins (mail, chat, webhook)", age: 6, plan: ["backlog"] },
  { id: "wharf-u6vw", title: "Windows: a path with a space in it breaks the unpack step", age: 2, plan: ["backlog"] },
  { id: "wharf-z3fy", title: "Unpack: stream the archive instead of reading it whole", age: 3, plan: ["backlog @18:55", "new"] },
  { id: "wharf-m4tn", title: "A deploy that times out leaves its lock behind", age: 4, plan: ["backlog @08:05", "new 26", "review 5", "approved 3"] },
  { id: "wharf-r1ks", title: "status --json lists a release twice after a retry", age: 1, plan: ["backlog @08:12", "new 24", "review 6 changes>new", "new 11", "review 4", "approved 3"] },
  { id: "wharf-d5jh", title: "Drop support for the v1 manifest?", age: 8, stage: "decide", plan: ["decide"] },
  { id: "wharf-g8ly", title: "Sign the release archives", age: 5, stage: "new", hold: true, plan: [] },
  { id: "sextant-e9rb", title: "Dark mode: the legend cannot be read", age: 11, plan: ["backlog"] },
  { id: "sextant-c4mu", title: "Chart: the y axis starts at the lowest value, not at zero", age: 5, plan: ["backlog @10:20", "new 13 hold", "unhold @13:40", "new 19", "review 5", "approved 3"] },
  { id: "gauge-d1yo", title: "A man page", age: 16, plan: ["backlog"] },
  { id: "gauge-a6ht", title: "--quiet prints the banner all the same", age: 3, plan: ["backlog @09:40", "new 18", "review 4", "approved 2"] },
  { id: "wharf.dev-k8se", title: "Blog: what is new in 2.0", age: 15, plan: ["backlog"] },
  { id: "wharf.dev-j5pa", title: "The pricing page is not found on a phone", age: 1, plan: ["backlog @11:05", "new 21", "review 4", "approved 2"] },

  // The morning's train: three wagons built side by side, then the train's
  // own way to its pull request and in.
  { id: "wharf-t4ra", title: "Train: manifest schema 2", type: "train", at: "07:52", plan: ["backlog @08:01", "open 5 @08:58", "review 8", "approved 3", "in-pr 22", "land 2"] },
  { id: "wharf-c1na", title: "Schema 2: read both versions of the manifest", type: "wagon", train: "wharf-t4ra", at: "07:54", plan: ["backlog @08:02", "new 34", "approved 3"] },
  { id: "wharf-c2pb", title: "Schema 2: a migrate command", type: "wagon", train: "wharf-t4ra", at: "07:55", plan: ["backlog @08:03", "new 41", "approved 3"] },
  { id: "wharf-c3rd", title: "Schema 2: say which field is wrong, and where", type: "wagon", train: "wharf-t4ra", at: "07:56", plan: ["backlog @08:04", "new 29 block@8+6", "approved 2"] },

  // The day's work in wharf.
  { id: "wharf-w5ep", title: "Retry a failed upload three times before giving up", at: "08:20", plan: ["backlog @08:40", "new 30", "review 5", "approved 2 failed>new", "new 9 stall@3", "review 3", "approved 3"] },
  { id: "wharf-s3bn", title: "Tokens: refuse one that has expired, and say so", labels: ["flagman-review"], at: "08:31", plan: ["backlog @09:10", "new 27", "review 16", "approved 3"] },
  { id: "wharf-y1cg", title: "list: the newest release first", at: "09:02", plan: ["backlog @09:30", "new 22", "review 4", "approved 5 refused@2"] },
  { id: "wharf-q7dm", title: "Config: an environment variable overrides the file", at: "09:15", plan: ["backlog @09:50", "new 16 question>decide", "decide @11:20 >new", "new 20", "review 5", "approved 3"] },
  { id: "wharf-k3ha", title: "Crash when the releases directory is empty", priority: 1, at: "09:48", plan: ["backlog @09:55", "new 14", "review 3", "approved 2"] },
  { id: "wharf-n8vu", title: "Progress bar: no escape codes when the output is a file", at: "10:30", plan: ["backlog @10:45", "new 19", "review 4", "approved 3"] },
  { id: "wharf-e2jc", title: "deploy --dry-run: say what would be done, and do none of it", at: "11:10", plan: ["backlog @11:30", "new 33", "review 7", "approved 3"] },
  { id: "wharf-a9st", title: "Lock file: name the host that holds it", at: "11:40", plan: ["backlog @12:24", "new 17", "review 3", "approved 2"] },
  { id: "wharf-i6mz", title: "Health check: wait for the port before the release counts as up", at: "13:05", plan: ["backlog @13:15", "new 28", "review 5", "approved 3"] },
  { id: "wharf-o4xb", title: "A changelog from the commit subjects since the last tag", at: "13:30", plan: ["backlog @13:45", "new 23", "review 6 changes>new", "new 8", "review 3", "approved 3"] },
  { id: "wharf-v7gq", title: "Hooks: run a script before and after a deploy", at: "14:10", plan: ["backlog @14:50", "new 36", "review 6", "approved 3"] },
  { id: "wharf-f5ty", title: "Design: deploy to more than one host at a time", at: "14:45", plan: ["backlog"] },
  { id: "wharf-l2df", title: "Keep the last five releases, remove the older ones", at: "15:20", plan: ["backlog @16:02", "new 21", "review 4", "approved 3"] },
  { id: "wharf-j9wn", title: "Colour: honour NO_COLOR", labels: ["flagman-review"], at: "16:05", plan: ["backlog @17:30", "new 24", "review"] },
  { id: "wharf-h3ca", title: "Flaky: the lock test fails one run in twenty", at: "17:20", plan: ["backlog"] },

  // The afternoon's train: it is in its pull request when the day ends.
  { id: "wharf-t9xe", title: "Train: a hosts file", type: "train", at: "14:30", plan: ["backlog @14:40", "open 4 @16:24", "review 7", "approved 3", "in-pr"] },
  { id: "wharf-g1ka", title: "Hosts file: read it, and say what is wrong with a line", type: "wagon", train: "wharf-t9xe", at: "14:32", plan: ["backlog @14:42", "new 38", "approved 3"] },
  { id: "wharf-g2mb", title: "Hosts file: one deploy for each host it names", type: "wagon", train: "wharf-t9xe", at: "14:33", plan: ["backlog @14:44", "new 46", "approved 3"] },

  // The other depots.
  { id: "sextant-m7pa", title: "Table: sort by a column on a click", at: "08:50", plan: ["backlog @09:20", "new 25", "review 5", "approved 4"] },
  { id: "sextant-u2fe", title: "A tooltip at the right edge stays on the screen", at: "12:50", plan: ["backlog @13:20", "new 17", "review 4", "approved 3"] },
  { id: "sextant-r5kb", title: "Design: share a dashboard by a link", at: "15:50", plan: ["backlog"] },
  { id: "sextant-n3wd", title: "Export a chart as an image", at: "17:40", plan: ["backlog @18:42", "new"] },
  { id: "gauge-v2sk", title: "PR 41: read the settings from the environment", type: "pr-review", stage: "review", at: "10:12", plan: ["review 6"] },
  { id: "gauge-h4zr", title: "Exit with 2 for a wrong flag, not with 1", at: "13:55", plan: ["backlog @14:15", "new 15", "review 3", "approved 2"] },
  { id: "gauge-x6nw", title: "PR 43: a build for Windows", type: "pr-review", stage: "review", at: "15:35", plan: ["review 5 question>decide", "decide"] },
  { id: "wharf.dev-b6lu", title: "Docs: a page for each command", at: "16:30", plan: ["backlog @16:45", "new 28", "review 5", "approved 2"] },
];

// Who waits for whom: the waiter, its blocker, and when on the day the edge
// was added. One without a time was there before. Both end with the day:
// the tests lay out beads of their own in this yard, with no edge of its.
const WAITS = [
  ["wharf-a9st", "wharf-e2jc", "11:42"],
  ["wharf-l2df", "wharf-v7gq", "15:22"],
];

// What happens beside the beads: a peer's messages and the hooks of the
// depots' hosting. A landing and a train in its pull request bring their own
// hooks (landed, below).
const EXTRAS = [
  ["08:15", "peer_message_received", { peer: "quay", kind: "ping" }],
  ["08:15", "peer_message_sent", { peer: "quay", kind: "ping" }],
  ["09:26", "peer_message_received", { peer: "quay", kind: "mail" }],
  ["09:44", "peer_message_sent", { peer: "quay", kind: "mail" }],
  ["10:11", "hook", { type: "comment" }],
  ["10:40", "hook", { type: "issue" }],
  ["12:02", "peer_message_received", { peer: "quay", kind: "ping" }],
  ["12:02", "peer_message_sent", { peer: "quay", kind: "ping" }],
  ["13:50", "hook", { type: "issue" }],
  // Two files cross before the mail that names them: its wagons.
  ["14:18", "peer_message_sent", { peer: "quay", kind: "file" }],
  ["14:18", "peer_message_sent", { peer: "quay", kind: "file" }],
  ["14:19", "peer_message_sent", { peer: "quay", kind: "mail" }],
  ["15:34", "hook", { type: "comment" }],
  ["15:42", "hook", { type: "comment" }],
  ["16:07", "peer_message_received", { peer: "quay", kind: "file" }],
  ["16:08", "peer_message_received", { peer: "quay", kind: "mail" }],
  ["17:05", "hook", { type: "issue" }],
  ["18:20", "peer_message_sent", { peer: "quay", kind: "mail" }],
];

const MINUTE = 60_000;
const clock = (hhmm) => Date.parse(`${DAY}T${hhmm}:00Z`);
const iso = (ms) => new Date(ms).toISOString();

// A number from 0 up to 1 for a name: the same for the same name, so a new
// bead in the description moves no other bead's times.
function chance(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

// One step of a plan, read.
function step(text) {
  const [at, ...words] = text.split(" ");
  const out = { stage: at, incidents: [] };
  for (const word of words) {
    if (/^\d+$/.test(word)) out.minutes = Number(word);
    else if (word.startsWith("@")) out.from = clock(word.slice(1));
    else if (word === "hold") out.hold = true;
    else if (word.includes(">")) [out.outcome, out.to] = word.split(">");
    else if (/^(stall|refused|block)@/.test(word)) {
      const [kind, when] = word.split("@");
      const [after, long] = when.split("+").map(Number);
      out.incidents.push({ kind, after, long });
    } else throw new Error(`demo: a step says "${word}": ${text}`);
  }
  return out;
}

// The made-up yard and its day: {yard, log, layout, quota}, the four files.
export function demo() {
  const end = clock(TAKEN);
  const groups = new Map(GROUPS.map((g) => [g.name, g]));
  const flowOf = (bead) => FLOWS[bead.depot].find((f) => f.type === bead.type) ?? FLOWS[bead.depot][0];
  const stageOf = (bead, name) => {
    const found = flowOf(bead).stages.find((s) => s.stage === name);
    if (!found) throw new Error(`demo: ${bead.id} has no stage ${name}`);
    return found;
  };
  // The group a bead is routed to at a stage: the route of the highest
  // priority that fits, the first of them.
  const routed = (bead, at) => {
    const fits = ROUTES.filter((r) => r.stage === at && (r.type ?? bead.type) === bead.type && (r.depot ?? bead.depot) === bead.depot && (r.label === undefined || bead.labels.includes(r.label)));
    return fits.sort((a, b) => b.priority - a.priority)[0]?.group;
  };

  // What is due, in the order of its time: the yard's clock.
  const due = [];
  let asked = 0;
  const later = (at, what) => due.push({ at, n: asked++, what });
  // The log, as the view streams it: each event with all the yard says.
  const events = [];
  const emit = (at, kind, bead, data) => events.push({ at, n: events.length, kind, ...(bead ? { bead: bead.id } : {}), ...(data ? { data } : {}) });

  const beads = BEADS.map((b) => {
    const made = b.age !== undefined ? clock("06:00") - b.age * 24 * 60 * MINUTE - Math.floor(chance(b.id) * 9 * 60) * MINUTE : clock(b.at) + Math.floor(chance(b.id) * 50_000);
    const depot = b.id.slice(0, b.id.lastIndexOf("-"));
    const bead = { id: b.id, title: b.title, type: b.type ?? "task", depot, status: "open", labels: b.labels ?? [], priority: b.priority ?? 2, created_at: iso(made), hold: b.hold === true, ...(b.train ? { train: b.train } : {}) };
    bead.stage = b.stage ?? flowOf(bead).stages[0].stage;
    return { bead, made, old: b.age !== undefined, plan: b.plan.map(step), sessions: 0 };
  });

  const sessions = [];
  // By group, the sessions at work, and who waits for a place.
  const out = new Map(GROUPS.map((g) => [g.name, 0]));
  const queue = new Map(GROUPS.map((g) => [g.name, []]));

  // A session of a group starts on a bead. One from before the day is in the
  // yard's lists and not in the window of its log.
  function begin(story, group, at, next, silent = false) {
    const { bead } = story;
    const id = `${bead.id}/${++story.sessions}`;
    const session = { id, bead: bead.id, group, state: "running", started_at: iso(at) };
    sessions.push(session);
    bead.group = group;
    bead.session = id;
    const agents = groups.get(group).runner === "herdr";
    story.first ??= agents ? id : undefined;
    // A pane takes a few seconds to start; a person and a script take none.
    const started = at + (agents ? 4000 + Math.floor(chance(`${id}/start`) * 6000) : 0);
    if (!silent) {
      emit(at, "claimed", bead, { group, session: id });
      emit(started, "started", bead, { session: id });
      if (agents) emit(started + 200, "session_prompted", bead, { session: id });
    }
    for (const { kind, after, long } of next.incidents) {
      const then = started + after * MINUTE;
      if (kind === "stall") emit(then, "session_stalled", bead, { group, session: id });
      if (kind === "refused") emit(then, "move_refused", bead, { group, session: id });
      if (kind === "block") {
        emit(then, "session_blocked", bead, { group, session: id });
        emit(then + long * MINUTE, "session_unblocked", bead, { session: id });
      }
    }
    // To the minute would be a timetable: every step ends some seconds late.
    const leaves = next.minutes !== undefined ? Math.max(started, next.from ?? 0) + next.minutes * MINUTE : groups.get(group).runner === "manual" ? next.from : undefined;
    if (leaves !== undefined) later(leaves + Math.floor(chance(`${id}/end`) * 50_000), (now) => finish(story, next, session, now));
  }

  // The places of a group that came free go to who waited longest.
  function dispatch(group, now) {
    const waiting = queue.get(group);
    while (waiting.length > 0 && out.get(group) < groups.get(group).limit) {
      const { story, next } = waiting.shift();
      out.set(group, out.get(group) + 1);
      begin(story, group, now + 1000 + Math.floor(chance(`${story.bead.id}/${story.sessions}/claim`) * 3000), next);
    }
  }

  // A bead stands at a stage, with the step of its plan for it.
  function arrive(story, now, silent = false) {
    const { bead } = story;
    const next = story.plan.shift();
    // Nothing more is planned: it stands there, with nobody at it.
    if (next === undefined) return;
    if (next.stage !== bead.stage) throw new Error(`demo: ${bead.id} stands at ${bead.stage}, its plan says ${next.stage}`);
    const group = routed(bead, bead.stage);
    if (group === undefined) {
      const leaves = next.from ?? (next.minutes !== undefined ? now + next.minutes * MINUTE : undefined);
      if (leaves !== undefined) later(leaves + Math.floor(chance(`${bead.id}/${bead.stage}/end`) * 50_000), (then) => depart(story, next, undefined, then));
      return;
    }
    // People take a bead as it comes; a crew and a script when a place is free.
    if (groups.get(group).runner === "manual") return begin(story, group, now + 300, next, silent);
    later(Math.max(now, next.from ?? 0), (then) => {
      queue.get(group).push({ story, next });
      dispatch(group, then);
    });
  }

  // A session's work on a step is over: the bead is held, or moves on.
  function finish(story, next, session, now) {
    const { bead } = story;
    const group = session.group;
    session.state = next.hold ? "held" : "done";
    session.ended_at = iso(now);
    bead.session = null;
    if (groups.get(group).runner !== "manual") {
      out.set(group, out.get(group) - 1);
      later(now, (then) => dispatch(group, then));
    }
    if (!next.hold) return depart(story, next, group, now);
    emit(now, "held", bead);
    bead.hold = true;
    release(story);
  }

  // A held bead is let go when its plan says so, and stands at its stage anew.
  function release(story) {
    const next = story.plan[0];
    if (next?.stage !== "unhold") return;
    story.plan.shift();
    later(next.from, (now) => {
      emit(now, "unheld", story.bead);
      story.bead.hold = false;
      arrive(story, now);
    });
  }

  // The bead moves to its next stage; past the buffer it is closed.
  function depart(story, next, group, now) {
    const { bead } = story;
    const from = stageOf(bead, bead.stage);
    const to = next.to ?? from.next[0];
    const runner = group === undefined ? undefined : groups.get(group).runner;
    // A session says how it ended; a person at a human stage, a script and
    // the yard itself only move the bead.
    const outcome = next.outcome || (runner === "herdr" || (runner === "manual" && from.human !== true) ? "done" : undefined);
    if (runner !== undefined && from.human !== true) emit(now - 400, "noted", bead);
    emit(now, "advanced", bead, { ...(group ? { group } : {}), from: bead.stage, to, ...(outcome ? { outcome } : {}) });
    bead.stage = to;
    delete bead.group;
    if (to === "in-pr") landed(now);
    if (stageOf(bead, to).terminal !== true) return arrive(story, now);
    bead.status = "closed";
    emit(now + 150, "closed", bead, to === "merged" ? { reason: "merged" } : undefined);
    if (story.first !== undefined) emit(now + 400, "workspace_removed", bead, { session: story.first });
    if (to === "merged") landed(now);
  }

  // What the hosting says after a push: its runs, then the checks' verdict.
  function landed(now) {
    const key = `hooks/${now}`;
    emit(now + 30_000 + Math.floor(chance(key) * 20_000), "hook", undefined, { type: "workflow_run" });
    emit(now + 2 * MINUTE + Math.floor(chance(`${key}/2`) * 40_000), "hook", undefined, { type: "workflow_run" });
    emit(now + 3 * MINUTE + Math.floor(chance(`${key}/3`) * 50_000), "hook", undefined, { type: "check_suite" });
  }

  const start = clock("06:00");
  for (const story of beads) {
    if (!story.old) {
      later(story.made, (now) => {
        emit(now, "created", story.bead, { stage: story.bead.stage, depot: story.bead.depot, type: story.bead.type });
        arrive(story, now + 100);
      });
    } else if (story.bead.hold) release(story);
    else arrive(story, start, true);
  }
  // A blocks edge is the waiter's event, and names the bead it waits for.
  for (const [waits, on, at] of WAITS) {
    if (at !== undefined) emit(clock(at), "dep_added", { id: waits }, { from: on, kind: "blocks", to: waits });
  }
  for (const [at, kind, data] of EXTRAS) emit(clock(at) + Math.floor(chance(`${at}/${kind}/${events.length}`) * 40_000), kind, undefined, data);

  for (;;) {
    due.sort((a, b) => a.at - b.at || a.n - b.n);
    const next = due.shift();
    if (next === undefined || next.at >= end) break;
    next.what(next.at);
  }

  // The log in the order of its times, numbered as the yard numbers it. No
  // two events share a millisecond: the replay plays them by the clock.
  events.sort((a, b) => a.at - b.at || a.n - b.n);
  const late = events.find((e) => e.at >= end - MINUTE);
  if (late) throw new Error(`demo: ${late.kind}${late.bead ? ` of ${late.bead}` : ""} is at ${iso(late.at)}, within a minute of the snapshot (${TAKEN}): move the plan`);
  let last = 0;
  const window = events.map(({ at, n: _n, ...event }, i) => {
    last = Math.max(at, last + 1);
    return { seq: FIRST_SEQ + i, at: iso(last), ...event };
  });

  const taken_at = iso(end).replace(/\.\d+Z$/, "Z");
  const all = beads.filter((s) => s.old || s.made < end).map((s) => s.bead);
  const lists = {
    depots: DEPOTS.map((name) => ({ name, kind: "git", base: "main" })),
    flows: DEPOTS.map((name) => ({ name, flows: FLOWS[name] })),
    groups: GROUPS,
    routes: ROUTES,
    crew: CREW,
    peers: PEERS,
    beads: all.filter((b) => b.status === "open"),
    sessions,
    events: window,
    edges: WAITS.map(([to, from]) => ({ from, to, kind: "blocks" })),
  };
  const yard = yardOf(lists, taken_at);
  return { yard, log: logOf(taken_at, window, all, alias), layout: place(yard), quota: quotaOf(QUOTA, taken_at) };
}

// The four files, each as scripts/snapshot.mjs writes it.
export function files({ yard, log, layout, quota }) {
  return { "yard.json": yard, "events.json": log, "layout.json": layout, "quota.json": quota };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "public");
  mkdirSync(dir, { recursive: true });
  const made = demo();
  for (const [name, value] of Object.entries(files(made))) writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`demo: ${made.yard.beads.length} open beads and ${made.log.events.length} events of ${DAY}, in ${dir}`);
}
