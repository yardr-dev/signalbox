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
`src/yard.ts` (what the script imports), this file and the README.

## Run

1. Start the yard's web view on loopback, if it is not running:

       yardr web start                      # or: yardr web serve, in a terminal
       yardr status                         # prints the view's address, http://127.0.0.1:8791 by default

2. Start the page beside it:

       YARDR_WEB=http://127.0.0.1:8791 node scripts/serve.mjs --dir dist --port 8792

   It prints `signalbox: the yard, live, at http://127.0.0.1:8792/`. Open
   that in a browser. The bar says `Live` and the yard's clock; scrub back
   for the replay of the newest 2000 events.

3. To keep it running, put that line in whatever keeps things running on
   your machine (launchd, systemd, tmux). Restart it on the same `--port`:
   an open page finds the old one again.

Flags: `--port <n>` (a free one when left out), `--host <addr>` to serve
another device, `--dir dist`, `--layout <file>` for where the yard's slots
are kept (default `$YARDR_HOME/signalbox/layout.json`, else
`~/.yardr/signalbox/layout.json`). `AIQUOKKA=/path/to/aiquokka` names the
quota binary.

## A phone or another device

The page needs WebGL. A phone or a small screen starts in the light picture
(no shadows, no anti-aliasing); `?full` on the address asks for the full one
and `?light` for the light one, remembered by the browser.

To reach it from another device, serve on an address only your own devices
reach, such as the machine's address on a Tailscale net:

    YARDR_WEB=http://127.0.0.1:8791 node scripts/serve.mjs --dir dist --port 8792 --host 100.64.0.7

There is no login. Whoever reaches the port reads what the page shows: the
yard's depots, flows, groups, crew and peers by name, each open bead's id,
title, type, stage and labels, the events, and the body and notes of a bead
whose card is opened. Never a key or a path the yard prints. Do not put it
on an address strangers reach.

## What the page shows

A depot is a station yard, its flow a track, each stage a platform. A bead
is a wagon; a train a row of coupled wagons; a session a figure who walks
out of its group's hut to the wagon it works; review a signal; decide and
held are sidings; a peer a line to another yard with mail as goods. The
README has the full key and the look.

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
