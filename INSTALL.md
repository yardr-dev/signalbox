# signalbox: install and run beside a yardr yard

signalbox draws a yardr yard as a railway and follows it as it runs. It is
a web page plus one small Node script that reads the yard's web view and
relays it to the page. It starts nothing of yardr's and writes nothing to
the yard but one layout file in the yard's home.

## You need

- A yardr yard on this machine, v0.5.0 or later, with its server running
  (`yardr status`).
- Node.js 24 or later (`node --version`). Node 22.6 to 22.x works with
  `node --experimental-strip-types`; the script imports TypeScript files.
- Nothing else: no npm install, no build step. The archive holds the built page.
- Optional: `aiquokka` on the PATH, for the silos that show the providers'
  quota. Without it they say "unknown".

## Install

    tar -xzf signalbox_<version>.tar.gz    # makes ./signalbox
    cd signalbox

What is in it: `dist/` (the built page), `scripts/serve.mjs` and
`scripts/yard.mjs` (the script), `src/layout.ts`, `src/project.ts` and
`src/yard.ts` (what the script imports), this file, the README, `LICENSE`
and `NOTICE`.

## Run

1. Start the yard's web view on loopback, if it is not running:

       yardr web start                      # or: yardr web serve, in a terminal
       yardr status                         # prints the view's address, http://127.0.0.1:8791 by default

2. Start the page beside it:

       YARDR_WEB=http://127.0.0.1:8791 node scripts/serve.mjs --dir dist --port 8792

   It prints `signalbox: the yard, live, at http://127.0.0.1:8792/`. Open
   that in a browser. The bar says `Live` and the yard's clock; scrub back
   for the replay of the newest 2000 events. A bar that says `Demo` is not
   your yard: the page was opened without the script (from `dist/` by
   another server), and plays the made-up yard it comes with.

3. To keep it running, put that line in whatever keeps things running on
   your machine (launchd, systemd, tmux). Restart it on the same `--port`:
   an open page finds the old one again.

Flags: `--port <n>` (a free one when left out), `--host <addr>` to serve
another device, `--dir dist`, `--layout <file>` for where the yard's slots
are kept (default `$YARDR_HOME/signalbox/layout.json`, else
`~/.yardr/signalbox/layout.json`), `--hide <part>` to keep back a bead's
body, its notes' text, events' words, or its title (`body`, `notes`,
`events`, `title`; repeatable, or apart with commas; nothing hidden
unless named). `title` shows wagons alone and implies `body` and `notes`:
a nameless wagon has no card. `--depot <name>` serves those depots alone:
a depot not named is not in the snapshot, not in the feed and answers no
card (repeatable, or apart with commas; a name that is no depot of the
yard is no error, the yard may add it later; with none named, every depot
shows).
`AIQUOKKA=/path/to/aiquokka` names the quota binary.

## A phone or another device

The page needs WebGL. A phone or a small screen starts in the light picture
(no shadows, no anti-aliasing); `?full` on the address asks for the full one
and `?light` for the light one, remembered by the browser.

To reach it from another device, serve on an address only your own devices
reach, such as the machine's address on a Tailscale net:

    YARDR_WEB=http://127.0.0.1:8791 node scripts/serve.mjs --dir dist --port 8792 --host 100.64.0.7

There is no login. Whoever reaches the port reads what the page shows: the
yard's depots, flows, groups, crew and peers by name, each open bead's id,
title, type, stage and labels, the events, and the body and notes of a
depot bead whose card is opened (the yard's own beads answer 404). Never
a key or a path the yard prints.

## The public

A stranger reads what the page shows. There is no login. That is the yard's
depots, flows, groups, crew and peers by name, each open bead's id, title,
type, stage and labels, the events, the quota silos with the providers'
plan names and percentages, and the body and notes of any depot bead whose
card they open (the yard's own beads answer 404), less `--hide`. Never a
key or a path the yard prints. A path or a key written into a note is on
the card.

The fault report is the one route that writes. It is limited to one line a
second and kept nowhere.

The feed is one line to the view, however many listen.

A proxy with TLS in front is the way, and serve.mjs stays on loopback.
Start it as Run does, so it listens at 127.0.0.1. A Cloudflare tunnel is
the example. Map the hostname to http://127.0.0.1:8792 in the tunnel's
config. box.example.com shows the shape of that hostname:

    ingress:
      - hostname: box.example.com
        service: http://127.0.0.1:8792
      - service: http_status:404

    cloudflared tunnel run

Any such proxy will do (Tailscale Funnel, Caddy).

## Deployed by the yard

After a landing, the yard's stage `merged` runs yardr's
`contrib/deploy/deploy-dokku`, which pushes the base to a Dokku app. Dokku
builds this repository's Dockerfile: it runs `npm ci` and `npm run build`
on Node 24 and copies `dist/` into an nginx image, which serves the built
page as plain files on port 80 (the demo yard, as from any static server).

Then the deploy runs `scripts/serve-public.sh` in the operator's checkout
on the yard's Mac: it pulls the base, `npm ci`, `npm run build`, restarts
the server below and checks the served page is the built one and its feed
is the yard's. `live` means that page serves the landed build: the bead's
note carries the commit and the address, and the stage fails with the
script's words when the page does not come back. The host and the key are
the yard's, not this repository's: neither is here.

## The yard's public page

The public page is the server in the operator's checkout, reached through
the Cloudflare tunnel of "The public" above:

    YARDR_WEB=http://127.0.0.1:8791 YARDR_HOME=~/.yardr \
      node scripts/serve.mjs --host 0.0.0.0 --port 8792 \
      >> ~/.yardr/logs/signalbox-serve.log 2>&1

Its pid is in `~/.yardr/signalbox/serve.pid`, beside the yard's slots.
Nobody starts it by hand: a login service runs the server itself and starts
it again whenever it exits, and `scripts/serve-public.sh` restarts it after
every landing (above), through that service:
`contrib/dev.yardr.signalbox-serve.plist`, copied to
`~/Library/LaunchAgents` and loaded once:

    cp contrib/dev.yardr.signalbox-serve.plist ~/Library/LaunchAgents/
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.yardr.signalbox-serve.plist

No pull and no build: the last deployed build is served again. When the
checkout moves, the plist's paths move with it. The flags the public page
is served with are the plist's `ProgramArguments`, set by the operator:
`--depot <name>` there chooses which depots the page shows. After changing
them, reload the job:

    launchctl kickstart -k gui/$(id -u)/dev.yardr.signalbox-serve

## What the page shows

A depot is a station yard, its flow a track, each stage a platform. A bead
is a wagon; a train a row of coupled wagons; a session a figure who walks
out of its group's hut to the wagon it works; review a signal; decide and
held are sidings; a peer a line to another yard with mail as goods. The
colours and the light picture are in `docs/look.md` of the source
(https://github.com/yardr-dev/signalbox). This archive does not hold that
page.

## Trouble

- "Live · no feed" on the bar: the script is gone. Start it again on the
  same port.
- The page is empty or the bar says the view is unreachable: the yard's web
  view is not running, or `YARDR_WEB` names the wrong address. `curl
  $YARDR_WEB/depots` should print JSON.
- "Error creating WebGL context" or a page that draws once and goes blank:
  the device cannot hold the full picture. Add `?light` to the address.
- Faults the page meets are one line each in the script's output
  (`signalbox: fault ...`). Send those with a report.
