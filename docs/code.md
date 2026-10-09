# Where things are

- `scripts/snapshot.sh` writes `public/yard.json` and `public/events.json`
  from the yard's web view (`npm run snapshot`, with `YARDR_WEB=` to name a
  view that is not at `http://127.0.0.1:8791`: it runs no command of yardr's
  either, so `yardr web serve` has to run), and `public/quota.json` beside them from `aiquokka --json`
  (`AIQUOKKA=`): the silos' levels. Without `aiquokka` there is no
  `quota.json`, and one from an earlier snapshot is removed. The committed files are the demo data and the tests' fixture: the
  tests name the yard's depots, groups and beads, so a new snapshot may need
  them brought along. Of an event the file keeps its number, time, kind and
  bead, and a few names from its data; a session is an alias, and a close
  says only whether it was a landing.
- `scripts/yard.mjs` asks the view, and runs `aiquokka`, for the snapshot and
  the serve script alike, and `src/project.ts` cuts what they answer down to what the
  page reads: the one place that decides which fields are passed on.
- `scripts/serve.mjs` serves `dist/` and the routes a page follows a
  yard by (`npm run live`). It keeps nothing but the slots it has given and
  the quota's last answer. The slots are the yard's own, in a file in its
  home: `$YARDR_HOME/signalbox/layout.json` (`~/.yardr/signalbox/layout.json`
  without `YARDR_HOME`; `--layout <file>` names another, as a yard needs
  whose view `YARDR_WEB` names and whose home `YARDR_HOME` does not: the view
  does not say where its yard's home is). It is written at the
  first snapshot of a yard, laid out from slot 0, and added to when the yard
  grows. The `layout.json` beside the built page is not read by the script.
  Delete the yard's file, with the script stopped, to have it laid out afresh.
- `scripts/release.sh` builds a release (`npm run release -- v1.2.3`, the
  tag): it writes the version into `package.json` and the lockfile, runs
  what the gate runs, and packs `dist/`, the serve script, what that imports
  (`scripts/yard.mjs`, `src/layout.ts`, `src/project.ts`, `src/yard.ts`), the
  README, `INSTALL.md`, `LICENSE` and `NOTICE` under `signalbox/` into
  `release/signalbox_<version>.tar.gz`, with a `checksums.txt` beside it. The
  list is one line of the script, and a test fails when the serve script
  imports a file that is not on it. It needs the Node the archive needs,
  22.6 or later (`engines`).
- `public/layout.json` is the layout's memory for the committed snapshot: the
  slot of every depot, flow, stage, peer and provider's silo drawn so far. The
  snapshot script writes it when it is missing and adds what is new to it
  otherwise (`scripts/slots.mjs`); the static page and the tests only read it.
  Delete it to have that yard laid out afresh.
- `src/yard.ts`: the shape of the snapshot, and of `quota.json`.
- `src/layout.ts`: from the structure to positions, one pure function. A
  flow's stages stand in the order a bead travels them, its terminal stage
  last; an element with a slot in `layout.json` keeps it, so a yard that grows
  or is listed in another order keeps what it had where it was. The mapping
  from yard to railway is decided here.
- `src/kit.ts`: the models, behind `loadKit`, all Kenney's and CC0, each
  pack's subset with its licence in `public/kit/`: the Train Kit (rails,
  wagons, locomotives), City Kit Industrial in `city/` (the hut is
  `building-i`, the office `building-p`, the works `building-m`, the station
  `building-s`, a provider's silo `detail-tank-large`) and Mini Characters in `people/` (builders `character-male-e`
  and `character-female-f`, reviewers `character-male-a`, crew members
  `character-male-c`; the clips `idle`, `walk` and, for work,
  `interact-right`). A hard hat is two boxes on the head bone. A model that
  does not load is a box, a figure two. A works says where its chimney's
  mouth is: the middle one of `building-m`'s three, a stub on its box. A silo's band
  is a material of its own (`TINT`), cut from the faces that lie on the
  palette texture's orange, since the pack's models share the texture: the
  scene puts the provider's colour there, and on the band of a silo's box.
  A model keeps the pack's texture, and of a building the faces the pack had
  coloured are sorted out of it the same way (`accented`): the texture is
  read where the face lies on it, and a face more saturated than `COLOUR` is
  painted again, in its kind's accents, the lightest hue its walls' and
  another its roof's. A wagon, a locomotive and a shunter are the pack's own,
  colours and all. The wagons a bead rides in (`wagon`) are the kinds the
  pack painted a colour, a peer's goods (`van`) the two it left iron; an
  image with a peer's mail rides the load of logs. A
  wagon's box, when its model does not load, is the blue of the kit's blue
  container (`0x658dd6`), a locomotive's the green of the kit's locomotive
  (`0x56c186`): `stand` in `src/palette.ts`. Rail alone is painted
  flat (`flat`), in the track's tone, its rails dark by how light the pack
  had them (`toned`). A figure keeps the pack's texture.
  Platforms, signals and the silos' indicators are boxes in the palette's
  tones, a signal box, the telegraph's poles and a peer's board in their
  accents. The kit's diesel is a track's shunter, and its steam locomotive
  the engine of a peer's line, each way.
- `src/palette.ts`: every colour of the picture (see [Look](look.md)): the tones by day
  and by night, Catppuccin's accents by day and by night, which building
  wears which (`building`), the colours
  that mean something of their own, and `paint`, the one flat material of
  each. `dress` changes day to night on the paint that is worn.
- `src/replay.ts`: the yard at a moment of the window, one pure reducer over
  the events: `state(yard, log, n)` is the open beads after the first `n`.
  The window's start is read off the window itself: a bead made in it is not
  there yet, any other stands where its first advance left.
  It keeps by works the runs open on it and how its last one ended.
  A feed's event goes through the same reducer; `outgrown` says when one
  names what the snapshot does not hold, and the page takes a new one.
  `trains` is which of some events are a train on a peer's line, and how
  many files each mail has behind it.
- `src/player.ts`: the replay's clock and speed, and, live, a window that
  grows at its end. `src/motion.ts`: the way a wagon takes between two
  places, and how long it takes (a second at most, at any speed; a peer's goods four at
1x and never under two), a figure's way between its place and its wagon, how
  long it takes at a speed of the replay, and what it does there.
- `src/sound.ts`: which sound an event is (`cueOf`), and the three sounds,
  made with the Web Audio API when they are asked for: no file is played.
- `src/shunt.ts`: the shunters, pure as `motion.ts` is. An engine is
  transport and no part of the yard's state. An order is the wagons that go
  together, a job the shunter's ways for it (fetch, pull, release, return),
  `Shunter` the queue of one engine. The planner checks each way of the
  shunter against the wagons that stand, and takes the return line where the
  rail would put it on one.
- `src/scene.ts` draws a layout: `draw` what stands still, `refuel` the coal
  in the silos' indicators from a quota, `Stock` the wagons
  and figures, which it moves from one state to the next, each figure with a
  mixer of its own: one clip at a time, faded into the next. `src/main.ts` is the
  page: camera, pan and zoom, labels, the bead under the pointer, the card
  of the bead that was clicked, the bar. `src/card.ts` builds the card's
  text, pure: from the yard's answer, or from the snapshot's bead alone.
