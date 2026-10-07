# signalbox

Watch a yardr yard as a railway. A depot is a station yard, a flow its track,
each stage a platform; a bead is a wagon that rolls on when it advances, a
train pulls its wagons, a session is a crew in a shed's bay, a review is a
signal, decide and held are sidings, a peer is a line to another yard with
mail riding as goods. The picture is drawn from the yard's structure
(`yardr --json`) and moves on its events (`yardr events --json`).

Built as a web page: TypeScript, Three.js, Vite, with Kenney's CC0 train kit.

Developed in a yardr yard; `.yardr/` holds its flow, roles and merge gate.

## Running it

    npm ci
    npm run dev        # the page, on a local port
    npm run build      # the page as static files in dist/, for any static server
    npm run check      # types
    npm test           # the layout's tests

So far the page is a still picture of one yard: no motion, no events.

![This yard as a railway: four depots, their flows as tracks](docs/yard.png)

## Where things are

- `scripts/snapshot.sh` writes `public/yard.json` from the yard's own commands
  (`npm run snapshot`, with `YARDR=` to name the binary). The committed file is
  the demo data and the tests' fixture: the tests name its depots, groups and
  beads, so a new snapshot may need them brought along.
- `src/yard.ts`: the shape of that file.
- `src/layout.ts`: from the structure to positions, one pure function. Every
  element is placed by its index in its parent, so a yard that grows keeps
  what it had where it was. The mapping from yard to railway is decided here.
- `src/kit.ts`: the models, behind `loadKit`. Kenney's Train Kit
  (`public/kit/`, CC0, with its licence) has the rails, wagons and locomotives;
  platforms, sheds, signals and signal boxes are boxes in six colours.
- `src/scene.ts` draws a layout; `src/main.ts` is the page: camera, pan and
  zoom, labels, the bead under the pointer.
