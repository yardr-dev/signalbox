# Replaying a day

    npm run snapshot   # YARDR_WEB=http://127.0.0.1:8791 names the yard's web view
    npm run dev

The snapshot writes `public/yard.json` (the yard now) and, beside it,
`public/events.json`: the events of the yard's newest 2000 sequence numbers
(the view's stream starts after a number, not at a time), which is the
window the page plays. The page
opens at the window's start, paused. The bar at the bottom plays and pauses,
sets the speed (60x makes an hour a minute), and scrubs over the window; it
shows the yard's clock in your own time and the last event in one line.
Without `events.json` the page is the still picture of `yard.json`.

Sound on the bar turns the yard's sounds on, and the browser remembers it:
a whistle when a bead lands (closed as merged), a bell when a session
stalls or is given up, a clank when a shunter takes wagons on and when it
lets go of them. They are off until then, and a scrub is silent: only what
happens while the replay plays, or the yard runs, is heard.

A wagon appears at the backlog when its bead is made. It does not move by
itself. Every track has a shunter, the kit's diesel, parked on a headshunt
before the first platform. When a bead advances the shunter runs to its
wagon, couples, and pulls it to the next platform, into a siding over the
points, back along the return line, or out past the buffer when the bead
reached the flow's last stage. Then it runs home, or straight to the next
wagon if one waits. The shunter is always before the wagon the way they go.
It is on the rail where that is free and beside it on the return line where
a wagon stands or the rail ends, and where the way turns back (out of a
siding and on up the line) it runs round the wagon. It is never turned
round, and it is never drawn on a wagon. A job is about three seconds at
1x, a second at 10x and more. A shunter takes three jobs in order. With
more than three before it, and on a scrub, the wagons stand at once where
the state has them and the shunter is parked. A train moves as one job, its
wagons coupled. Wagons behind the one that left close up when it has been
pulled away. A figure works on a wagon only once it stands. A
group has a building beside a platform it is routed to: people a station, a
group whose sessions are scripts a works, at each of their platforms. A
group that runs sessions in panes is a crew, and has one building on each
board it is routed to, at the first of its platforms there: builders a site
hut and yellow hard hats, reviewers an office and white ones. A figure
walks from its own board's building and back, never from one board to
another. Every building has its door to
its platform; a crew stand idle in a row from the door's corner down the
line, where the building does not hide them from the reader, a place for
each session the group may run, and the sign
counts who is out (`yardr-builders · 1 of 3 out`), so an empty place is a
session at work. The count is the group's in the whole yard, and each of
its buildings shows it: with one of three out, two stand idle before every
door of the group, and the third is at its wagon on its own board. When a session starts, the first figure at home walks over
the ground to the platform its bead stands at (a second or two at 1x,
however far; a faster replay walks as much faster, down to a wagon's least
0.3 s), turns to the wagon and works on it at its own pace, whatever the
replay's, and says under the pointer which bead and group; when the session
ends it walks back, unless it ended badly (below). A scrub puts everyone
where they were then, at once. With `prefers-reduced-motion` the figures
stand still where they are, a hand at the wagon. A building says under the
pointer its group, runner and limit. A click on a wagon, or on the figure at
work on it, opens the bead's card at the right of the page: its id and
title, depot, type, stage, group and whether a session is on it, hold,
priority, labels, when it was created and last changed, then its body and
its notes, newest first, each as plain text. Another wagon replaces the
card, a click anywhere else in the yard or Escape closes it, and the camera
stays where it is. The body and the notes are asked of the yard at the
click, so only the live page has them: the replay's card is what the
snapshot holds, and says "notes need the live page". The yard's crew members stand before
their signal boxes. A held bead stands in the siding. A peer's
message is a goods wagon on the peer's line, named by its kind and its peer:
out from the yard's end past the edge of the yard, or in from there, a few
seconds either way, each on its own rail. Mail is a train: the box van for
its text, and behind it an open wagon for each image that crossed with it
(the messages of kind `file` before it on the link). Goods are pulled too, by the kit's
steam locomotive: the line has one of its own for goods out, parked at the
yard's end, and goods in come behind one of the peer's, which goes home when they have gone.
One train runs each way at a time, and the next waits out of sight. A hook
is a flash of the wire.

What went wrong is drawn too, and says under the pointer what and when
("held", "session stalled 14:02", "move refused 06:27"):

- A held wagon has chocks at its wheels and a small red flag, until it is
  let go.
- A session that came to no good end leaves its figure at the wagon: sat on
  the platform with its back to it, hat off. That is `session_stalled`,
  `session_blocked`, `session_harness_error`, `session_prompt_gave_up`,
  `session_died`, `gave_up`, and an advance with another outcome than done,
  where the figure goes with the wagon and sits where it arrives. It is not
  out: the sign counts sessions at work, and the hut has its places for
  them, so a sat figure is one more than those. The next session on the
  bead stands it up (as does `session_unblocked` a blocked one); when the
  bead moves on without it, it goes.
- `move_refused` and `stranded` are a lamp on the wagon, flashing red until
  the bead moves or closes; so is a session's bad end where no crew has a
  figure to sit for it, a script's failed landing for one. `unrouted` is the
  same lamp on the platform the bead sits at. With `prefers-reduced-motion`
  the lamps are lit and still.

The snapshot has one `fault` on a bead for all of these but the hold: a kind
and a time. The replay sets and clears it from the window's events; the
snapshot itself knows only how a bead's last session ended (died, failed,
aborted), since a stalled or blocked session is still running to the yard.
So a fault older than the window is seen only if it is of that kind.

A works smokes while it runs. A session that starts on a bead at a stage
routed to a group of scripts (the assembly, the refinery: `started`) is a
run of the depot's gate and the merge: a few grey puffs rise from the works'
chimney and thin out, at their own pace whatever the replay's speed. The
lamp on the post beside the works says how the last run ended: green for a
landing (the advance past the buffer, or a close as merged), red for a gate
that failed (an advance with the outcome failed), and it stays so until the
next run starts, which puts it out. Any other end (a hold, a session that
died, a bead taken back) stops the smoke and leaves the lamp as it was.
A scrub snaps: the whole plume if a run is open at that time, and the lamp
of the last run before it. Under the pointer the works says which bead it
runs the gate on and since when, or how its last run ended. The snapshot
knows of no run, so a still picture has every lamp out; a window that begins
in a run has it open. With `prefers-reduced-motion` the plume stands.

What the yard burns is drawn as coal. Every provider whose agents the yard
uses (the `kind` of a group that starts sessions, and of a crew member:
claude, codex, kimi) has a silo in the signal boxes' row, at their pitch, to
the left of the first box, with the provider over it and its plan. The first
stands a pitch left of the telegraph's first post, so that the post's sign,
"hooks", lies over no silo's name. The silo
is the kit's large tank, and the band round it is the provider's colour:

| provider | band |
| --- | --- |
| `claude` | peach, for Claude's orange |
| `codex` | green, for OpenAI's |
| `kimi` | blue |
| any other | overlay, Catppuccin's grey |

The table is `livery` in `src/palette.ts`, by the provider's key; the colours
are Catppuccin's accents of those names, as the day or the night has them, on
a pink silo. What is left
stands outside the silo, in two indicators to its right: the coal in the
first is what is left of the provider's weekly quota, 100 less the percent
used; the second, lower one is the five-hour window the same way. Under 20
percent left the fill is amber, under 5 red. The sign under the silo is the
next delivery, when the week starts again in your own time ("resets Mon
15:00"); a silo whose week is used up says "out" before it. A silo whose
level nobody knows (no `aiquokka` on the machine, or a provider it does not
list) has empty indicators and says "unknown". Under the pointer a silo says
both windows in figures. From far out the plan and the sign are hidden, but
for "out" and "unknown": the band says which provider, the indicators how
much is left. The levels come from `aiquokka --json`, and there is no
history of them: a replay shows the silos as they were when the snapshot
was taken, marked "now", whatever time the bar stands at, and a snapshot
without `quota.json` has no silos. Groups of people and of scripts burn
nothing and have none.

A wagon that waits on a person weathers. At a stage only a person moves a
bead on from (backlog, decide: the flow's `human` stages) its paint is dull
after three days, rusted after a week, and moss grows on its top after two;
under the pointer it says how long ("in backlog 9 days"). A wagon at any
other stage waits on the yard and stays clean, however old. The age counts
from the bead's last advance, and is as of the replay's clock, so a wagon
weathers as the bar is scrubbed forward and is fresh again when it moves.
The snapshot knows a bead's last advance (`moved_at`) only from the window
of the log: a bead that moved before it counts from when it was created.

A wagon that waits for another has a lamp naming it; couplings are trains.
Only a `blocks` edge is a wait (a `parent` is the train's coupling, a
`discovered-from` is history), and only while its blocker is open: a wagon
whose blocker has closed waits for nothing, though it may still stand in
backlog.

The lamp is small and amber, over the wagon's roof, lit and still until the
blocker closes. It is the same lamp wherever the blocker stands: at the
same platform, at another one of the board, on another board, or only
counted at its platform. Nothing is drawn between the two: coupled wagons
move together, and a wagon does not follow its blocker.

Under the pointer the wagon says what it waits for ("waits for yardr-xyz
(aiquokka · review)": the bead, the board it is on and its stage there), a
line for each blocker. The snapshot has the edges as `edges` in
`yard.json`: of every edge of the yard (the view's `/deps`) the ones with
an open bead at an end. The replay keeps them from
`dep_added` and `dep_removed`, and drops a bead's edges when it closes.

## Following a yard as it runs

    npm run live                          # the yard whose web view is at http://127.0.0.1:8791
    YARDR_WEB=http://127.0.0.1:9000 npm run live   # a view at another address, as for the snapshot
    npm run live -- --port 8800           # a port of your choice (a free one)
    npm run live -- --host 100.64.0.7     # an address other than this machine's own

`npm run live` builds the page and starts `scripts/serve.mjs`, which prints
the page's address: on 127.0.0.1 and a free port unless told otherwise. The
page opens at now, playing: the yard as it stands, and what happens in it as
it happens, moved as the replay moves it. The bar shows `Live` and the
yard's clock. Scrub back and it is the replay of the window so far (the
events of the yard's newest 2000 sequence numbers), at the speed you set; `Live` returns to now.
When the yard gets a new depot, flow, peer or crew, or a bead the page has
not seen, the page takes a new snapshot and lays out again: what was placed
stays where it was, also when the script is started again: it keeps the
yard's slots in the yard's home (`$YARDR_HOME/signalbox/layout.json`).

The script follows the yard through its web view and nothing else: it is
one more reader of `yardr web serve`, as a browser on the view is, and
starts no process of yardr's. So the view has to run (`yardr web serve`, or
`yardr web start` or `yardr web install` to keep it running; this yard's
runs already, on 8791). A view on loopback is enough, also for a page
served to another device with `--host`: the script is on the view's machine
and is the one that asks. `YARDR_WEB` names a view at another address. What the yard
is now the script reads as JSON, a route of the view for each list
(`/depots`, `/flows`, `/groups`, `/routes`, `/crew`, `/peers`, `/beads`,
`/sessions`, `/deps`); what happens in it comes on the view's stream
(`/events?format=json`), which the script holds open once, for all pages,
while one listens. A view that is stopped and started again loses a page
nothing: the script asks again every second, after the last event it
passed on, and what happened in between comes first. The same holds for a
restart of the yardr server, which the view rides out inside the stream.
The page's own line stays open all the while, and says `Live · no feed`
only when the script itself is gone.

The live page reports its faults to the script's log (`src/fault.ts`), with
the time, kind, detail, browser's user agent, page size and pixel ratio, and
no identity beyond the browser's user agent; the snapshot's page reports
nothing.

The silos' levels the script asks of `aiquokka --json` (`AIQUOKKA=/path/to/aiquokka` names the
binary), which is a call over the network for every provider: once a minute
at most, however many pages are open, and not at all while none is. Without
`aiquokka` the silos say "unknown" and the rest of the page is as ever. It
is four routes beside the files of `dist/`:

- `GET /api/snapshot`: `yard.json`, `layout.json`, `events.json` and
  `quota.json` in one answer, taken now; `quota` is the last answer of the
  minute, and `null` when there is none. A provider that is slow does not
  hold the page: after three seconds the snapshot goes without, and the feed
  brings the answer.
- `GET /api/feed?after=<seq>`: server-sent events, one message for each event
  of the yard after `seq`, with its number as the id. A page that lost the
  line says where it was (`Last-Event-ID`) and misses nothing, also when the
  script was restarted in between. Restart it on the same `--port`: a free
  port is another one each time, and the open page looks for the old one.
  The quota comes on the same line when it was asked again, and once to a
  page that starts to listen: a message of the event `quota`, with no id.
- `GET /api/bead/<id>`: one bead for its card, `{bead, notes}`, asked of the
  yard at the click (the view's `/beads/<id>`). An id is lower-case letters,
  figures, dots and dashes, and starts with a letter or a figure; anything
  else is refused before the view is asked. A bead the yard does not have is a 404,
  and the card says "not found".
- `POST /api/fault`: a report of the page's, `{at, what, detail, agent,
  screen}`, answered 204 and written as one line where the script says what
  it does (`signalbox: fault <what> from <agent> <screen>: <detail> at <at>`).
  A body is 4 KB at most (413), a connection has one a second (429 for the
  rest), and what is no report is a 400. Nothing is kept: the log is the
  record.

What it exposes: what the committed snapshot holds, for the yard as it is
now. Depots, flows, stages, groups, routes, crew and peers by name; of each
open bead its id, title, type, stage, labels, whether a session works it and
what went wrong with it last (a kind and a time);
of each event its number, time, kind, bead and a few names (group, depot,
peer, stages of an advance); of each provider `aiquokka` lists with a weekly
or a five-hour window its name, plan, the percent used of each and when it
starts again, and nothing of the account. And of the one bead a card asks for, live
only and in no file: its body and its notes, each with its author and time,
as they were written. Whoever writes a path or a key into a note has put it
on the card. Never a path or a key the yard itself prints, nor a session's
own name: `src/project.ts` builds each answer from the fields it names. There is no login, as with `yardr web serve --unsafe`: whoever reaches
the port reads all of that. So it listens on this machine alone, and
`--host` is for an address only your own devices reach, such as this
machine's on a Tailscale net, for a phone on the same net.

Without the script (`npm run dev`, or `dist/` on any static server) nothing
of this is there, and the page is the committed snapshot and its replay.

A machine with no checkout takes a release's archive instead: the built
page and the script, run by Node alone, with no `npm ci` and no build.
[INSTALL.md](../INSTALL.md) says how, and is in the archive too.

