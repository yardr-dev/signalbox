// Draws a layout: the kits' rails, wagons, locomotives, buildings and
// figures, and boxes in the palette for the rest. Nothing here decides where
// a thing is; layout.ts did. draw is what stands still: the structure, the
// same through a replay. Stock is what moves: wagons, the shunters that move
// them, figures, counts and the crews' signs, shown again for every state.

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { CHIMNEY, HAT, SILO_HEIGHT, TINT, type Clip, type Kit } from "./kit";
import {
  atWork,
  BOARD_X,
  coal,
  faulted,
  HEADSHUNT,
  left,
  PEER_RAIL_Z,
  people,
  PLATFORM_LENGTH,
  SHED_WIDTH,
  SIDING_Z,
  type Layout,
  type Person,
  type Point,
  type Coal,
  type Gate,
  type Shed,
  type Tower,
  type Vehicle,
  type Wait,
  type Weather,
} from "./layout";
import {
  along,
  continueWalk,
  doing,
  ease,
  exit,
  goods,
  GOODS_STAND,
  heading,
  measure,
  puff,
  PUFF_SECONDS,
  PUFFS,
  route,
  seconds,
  smokes,
  stride,
  turn,
  TWEEN_MIN,
  walk,
  walkSeconds,
  type Stop,
} from "./motion";
import { building, fault, iron, lamp, liveried, paint, smoke, stocked, tinted, weathering, type Accent, type Tone } from "./palette";
import { freight, hauling, keeps, Shunter, shunting, type Haul, type Order, type Plan } from "./shunt";
import type { Allowance, Bead, Provider, Quota } from "./yard";

// Heights, and the few sizes layout.ts has no say in.
export const GROUND_Y = -0.3;
const PLATFORM_HEIGHT = 0.45;
const PLATFORM_WIDTH = 1.4;
// A sign is this far from its building's middle, away from the track.
const SIGN_Z = 1.3;
const POLE_PITCH = 12;
const POLE_HEIGHT = 3.2;
// A signal box's sign, over its roof.
const BOX_HEIGHT = 3.4;
// A provider's silo: its sign for the provider is this high, over it and its
// indicators. They stand to its right on feet this high, the week's this far
// out and this high, the five hours' beyond it and lower. A silo's middle is
// this far from its wall.
const TOWER_HEIGHT = SILO_HEIGHT + 0.6;
const SILO_WALL = 2;
const GAUGE_Y = 0.4;
const WEEK_X = 2.9;
const WEEK = 2.2;
const SHORT_X = 4.2;
const SHORT = 1.6;
// The height of the note that the silos are of now, beside the first.
const NOW_Y = 1.4;
// The coal by how much is left: its own dark, amber when it runs low, red for
// the last of it.
const COAL: Record<Coal, number> = { plenty: iron, low: lamp.wait, last: lamp.stop, out: lamp.stop };
// A figure steps up onto a platform over this much ground before its edge,
// turns at this many radians a second, and takes this many seconds to change
// from one thing it does to the next.
const STEP = 0.2;
const TURN = 9;
const FADE = 0.2;
// A peer's goods by the kind of the message: the kit's van and its size. Mail
// is the box van and a bead the coal wagon. A ping is the lighter one: the
// kit has no empty flat, so it is the box van small.
const GOODS: Record<string, [pick: number, size: number]> = { mail: [0, 1], bead: [1, 1], ping: [0, 0.65] };
const GOODS_LABEL_Y = 2.1;
// The seconds the wire stays lit after a hook.
const FLASH = 0.6;
// A fault's lamp: the seconds of one flash, lit for the first half of it; how
// high it stands on a wagon and over a platform.
const BLINK = 0.8;
const LAMP_Y = 2.6;
const PLATFORM_LAMP_Y = 1.7;
// From a wagon's middle to its ends, where its chocks lie on the rail, and
// to its flag's pole and its lamp's.
const CHOCK_X = 1.46;
const MARK_X = 1.15;
// The lamp of a wagon that waits: left of its middle, this far over its roof.
const WAIT_X = 0.55;
const WAIT_Y = 0.3;
// A works' lamp: on a post this far right of its building's middle, clear of
// the wall, and this high. Where its smoke leaves a building that has no
// chimney to say so: over its middle, this high.
const GATE_LAMP_X = SHED_WIDTH / 2 + 0.4;
const GATE_LAMP_Y = 1.9;
const ROOF_Y = 2.2;

export interface Picture {
  root: THREE.Group;
  // The box everything stands in, for the first view: on the ground, and as
  // high as what stands in the strip above the depots, which nothing behind
  // it covers. A peer's line counts only where it starts: it runs off the
  // page on purpose.
  bounds: THREE.Box3;
  // The buildings, each with userData.shed: what the pointer can ask about.
  sheds: THREE.Object3D[];
  // The providers' silos, each with userData.tower: refuel fills their
  // indicators, and the pointer can ask about them too.
  towers: THREE.Object3D[];
}

// A box standing on y, centred on x and z, in the palette's paint: of a tone,
// of an accent, or of a colour that means something.
function block(of: Tone | Accent | number, width: number, height: number, depth: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), paint(of));
  mesh.position.set(x, y + height / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function label(text: string, kind: string, x: number, y: number, z: number, anchor: [number, number] = [0.5, 0.5]): CSS2DObject {
  const el = document.createElement("div");
  el.className = `label ${kind}`;
  el.textContent = text;
  const object = new CSS2DObject(el);
  object.position.set(x, y, z);
  object.center.set(...anchor);
  return object;
}

// A stable number from an id, to give each bead its kind of wagon.
function hash(text: string): number {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

// Lays one model many times as instances: a yard is mostly rail.
class Rails {
  private readonly at: THREE.Matrix4[] = [];

  // A straight run from a point, at an angle on the ground (0 is along x).
  run(from: Point, length: number, angle = 0) {
    const turn = new THREE.Matrix4().makeRotationY(angle);
    const tiles = Math.max(1, Math.round(length));
    const step = length / tiles;
    for (let t = 0; t < tiles; t++) {
      const d = (t + 0.5) * step;
      const m = new THREE.Matrix4()
        .makeTranslation(from.x + Math.cos(angle) * d, 0, from.z - Math.sin(angle) * d)
        .multiply(turn)
        .multiply(new THREE.Matrix4().makeScale(step, 1, 1));
      this.at.push(m);
    }
  }

  build(tile: THREE.Object3D): THREE.Group {
    const group = new THREE.Group();
    tile.updateMatrixWorld(true);
    tile.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      const instances = new THREE.InstancedMesh(part.geometry, part.material, this.at.length);
      // Rail lies on the ground: a shadow falls on it, and it throws none.
      instances.receiveShadow = true;
      this.at.forEach((m, i) => instances.setMatrixAt(i, m.clone().multiply(part.matrixWorld)));
      group.add(instances);
    });
    return group;
  }
}

function bufferStop(x: number, z: number): THREE.Object3D {
  const stop = new THREE.Group();
  stop.add(block("slate", 0.3, 0.9, 1.1, x, 0, z));
  stop.add(block("wall", 0.34, 0.3, 1.14, x, 0.55, z));
  return stop;
}

function signal(x: number, z: number): THREE.Object3D {
  const post = new THREE.Group();
  post.add(block("slate", 0.16, 2.6, 0.16, x, PLATFORM_HEIGHT, z));
  post.add(block("slate", 0.5, 0.9, 0.4, x, PLATFORM_HEIGHT + 2.3, z));
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: lamp.clear }));
  light.position.set(x, PLATFORM_HEIGHT + 2.9, z + 0.22);
  post.add(light);
  return post;
}

// A group's building, of its kind, in the middle of its plot, its door to the
// platform.
function shed(s: Shed, kit: Kit): THREE.Object3D {
  const object = kit.make(s.kind);
  // The kit hands it out with its door to -z: where a track's own side is.
  object.rotation.y = s.away < 0 ? Math.PI : 0;
  // Centred by its walls, whatever stands out from them.
  const middle = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
  object.position.set(s.at.x - middle.x, 0, s.at.z - middle.z);
  object.userData.shed = s;
  return object;
}

// What a building's sign says. A crew's counts who is out; out is then how
// many of its sessions are at work.
export function sign(s: Shed, out = 0): string {
  if (s.kind === "station") return s.group;
  return s.kind === "works" ? `${s.group} · ${s.limit}` : `${s.group} · ${out} of ${s.limit} out`;
}

// Where a building's sign is: on its side away from the track, at the left
// end of its plot, or under its crew where it has one; a platform's second
// building has it a line further out, clear of the first's.
function signAt(s: Shed, n: number): [number, number, number] {
  const x = s.places.length > 0 ? s.at.x + SHED_WIDTH / 2 : s.at.x - SHED_WIDTH / 2;
  return [x, 0, s.at.z + s.away * (SIGN_Z + (n % 2) * 1.3)];
}

// A wagon's paint under the weather: its own with a tint (palette.ts). Moss
// lies on rust: a mossy wagon has the rusted paint.
function weathered(own: THREE.Material, step: Weather): THREE.Material {
  return tinted(own, step === "dull" ? weathering.dull : weathering.rusted);
}

// The paint each part of a wagon came with, to tint and to give back.
const paints = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
function repaint(wagon: THREE.Object3D, step: Weather | undefined) {
  wagon.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    const paint = paints.get(part) ?? (part.material as THREE.Material | THREE.Material[]);
    paints.set(part, paint);
    if (step === undefined) part.material = paint;
    else {
      const weather = (p: THREE.Material) => ((p as THREE.MeshStandardMaterial).map ? p : weathered(p, step));
      part.material = Array.isArray(paint) ? paint.map(weather) : weather(paint);
    }
  });
}

// Patches of moss on a wagon's top, which is this high.
function moss(top: number): THREE.Object3D {
  const g = new THREE.Group();
  const patches: [length: number, width: number, x: number, z: number][] = [
    [0.7, 0.45, -0.6, 0.12],
    [0.5, 0.35, 0.55, -0.15],
    [0.3, 0.3, 0.05, 0.2],
  ];
  for (const [length, width, x, z] of patches) g.add(block(weathering.moss, length, 0.08, width, x, top - 0.03, z));
  return g;
}

// Wheel chocks on the rail at both ends of a wagon, as its own part: they
// lie there only while it stands.
function chocks(): THREE.Object3D {
  const g = new THREE.Group();
  for (const end of [-1, 1]) g.add(block(fault.chock, 0.2, 0.32, 0.9, end * CHOCK_X, 0, 0));
  return g;
}

// A small red flag on a pole at a wagon's right end, over its roof.
function flag(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(block("slate", 0.07, LAMP_Y, 0.07, MARK_X, 0, 0));
  g.add(block(lamp.stop, 0.65, 0.42, 0.05, MARK_X - 0.36, LAMP_Y - 0.42, 0));
  return g;
}

// A lamp on a post, standing on y. All of a stock's lamps are of one
// material: they flash together.
function beacon(light: THREE.Material, x: number, y: number, z: number, height: number): THREE.Object3D {
  const g = new THREE.Group();
  g.add(block("slate", 0.1, height, 0.1, x, y, z));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), light);
  bulb.position.set(x, y + height + 0.2, z);
  g.add(bulb);
  return g;
}

// A small lamp on a short post over a wagon's roof, which is this high.
function lantern(light: THREE.Material, top: number): THREE.Object3D {
  const g = new THREE.Group();
  g.add(block("slate", 0.08, top + WAIT_Y, 0.08, -WAIT_X, 0, 0));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), light);
  bulb.position.set(-WAIT_X, top + WAIT_Y + 0.12, 0);
  g.add(bulb);
  return g;
}

// A works' chimney and its lamp. The fire was lit so many seconds ago and
// burnt for so many of them: all of them, Infinity, while a run is open.
interface Stack {
  root: THREE.Group;
  // At the chimney's mouth.
  plume: THREE.Group;
  puffs: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[];
  post: THREE.Object3D;
  lamp: THREE.MeshBasicMaterial;
  seconds: number;
  burnt: number;
}

// A puff is a small grey ball, its own material for how much of it is seen.
const ball = new THREE.SphereGeometry(0.5, 8, 6);
function stack(): Stack {
  const light = new THREE.MeshBasicMaterial({ color: lamp.out });
  const plume = new THREE.Group();
  const puffs = Array.from({ length: PUFFS }, () => {
    const mesh = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ color: smoke, transparent: true, opacity: 0, depthWrite: false }));
    mesh.visible = false;
    plume.add(mesh);
    return mesh;
  });
  const post = beacon(light, 0, 0, 0, GATE_LAMP_Y);
  return { root: new THREE.Group().add(plume, post), plume, puffs, post, lamp: light, seconds: Infinity, burnt: 0 };
}

// What a works' lamp shows: green after a landing, red after a gate that
// failed, and nothing while a run is open or before the first has ended.
export function gateLamp(gate: Gate | undefined): number {
  if (gate === undefined || gate.runs.length > 0 || gate.last === undefined) return lamp.out;
  return gate.last === "landed" ? lamp.clear : lamp.stop;
}

// A signal box: its lower floor in its walls' accent, the upper one, which
// is all windows, a tone, under its roof's accent.
function signalBox(x: number, z: number): THREE.Object3D {
  const [wall, roof] = building.box;
  const g = new THREE.Group();
  g.add(block(wall, 3, 1.6, 2.2, x, 0, z));
  g.add(block("wall", 3.3, 1.2, 2.5, x, 1.6, z));
  g.add(block(roof, 3.8, 0.3, 3, x, 2.8, z));
  return g;
}

// Paint what the kit left for the scene (TINT): a silo's band, and of a
// wagon or a locomotive the faces the pack had in a colour of its own.
function coat(model: THREE.Object3D, wears: THREE.Material) {
  model.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    const own = part.material as THREE.Material | THREE.Material[];
    part.material = Array.isArray(own) ? own.map((m) => (m.name === TINT ? wears : m)) : own.name === TINT ? wears : own;
  });
}

// What fills: a box that stands on its own floor, as high as it is scaled. Its
// colour is its own, for it changes with what is left.
function fill(width: number, depth: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 1, depth).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ flatShading: true }));
  mesh.position.set(x, y, z);
  mesh.visible = false;
  return mesh;
}

// What refuel changes of a silo.
interface Silo {
  week: THREE.Mesh;
  short: THREE.Mesh;
  name: CSS2DObject;
  plan: CSS2DObject;
  sign: CSS2DObject;
}

// An indicator: a foot, and on it pale boards at the back and the left, open
// at the top and to the reader at the front and the right, so what is in it
// is seen from above, and how much is not there.
function gauge(g: THREE.Group, x: number, height: number): THREE.Mesh {
  g.add(block("slate", 1.1, GAUGE_Y, 0.9, x, 0, 0));
  g.add(block("wall", 0.95, height, 0.12, x, GAUGE_Y, -0.32));
  g.add(block("wall", 0.12, height, 0.64, x - 0.415, GAUGE_Y, 0.06));
  return fill(0.7, 0.55, x, GAUGE_Y, 0.06);
}

// A provider's silo: the kit's tank, its band in the provider's colour, so
// from far out the colour says whose it is. What is left is not in it but
// beside it, as the pack sets gauges by its tanks: an indicator for the week
// and a lower one for the five hours. They stand empty until refuel fills
// them.
function tower(t: Tower, kit: Kit): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(t.at.x, 0, t.at.z);
  const tank = kit.make("silo");
  coat(tank, paint(liveried(t.provider)));
  const silo: Silo = {
    week: gauge(g, WEEK_X, WEEK),
    short: gauge(g, SHORT_X, SHORT),
    // The provider a line over its plan, both over the roof: from far out
    // the page shows the provider alone.
    name: label(t.provider, "tower", 0, TOWER_HEIGHT, 0, [0.5, 2]),
    plan: label("", "plan", 0, TOWER_HEIGHT, 0, [0.5, 1]),
    sign: label(UNKNOWN, "fuel", 0, 0, SILO_WALL + 0.3, [0.5, 0]),
  };
  g.add(tank, silo.week, silo.short, silo.name, silo.plan, silo.sign);
  g.userData.tower = t;
  g.userData.silo = silo;
  return g;
}

// Fill to what is left of a window, in the colour of that much; nothing where
// nobody knows, or nothing is left.
function pour(into: THREE.Mesh, height: number, percent: number | undefined) {
  into.visible = percent !== undefined && percent > 0;
  if (percent === undefined) return;
  into.scale.y = Math.max((height * percent) / 100, 1e-3);
  (into.material as THREE.MeshLambertMaterial).color.setHex(COAL[coal(percent)]);
}

// Fill the silos' indicators with what a quota says is left: the week in the
// first, the five hours in the second, the provider and its plan over the
// roof, the next delivery on the sign. A silo whose provider the quota does
// not have, and every silo when there is no quota, has them empty and says
// so.
export function refuel(towers: THREE.Object3D[], quota: Quota | undefined) {
  for (const object of towers) {
    const t = object.userData.tower as Tower;
    const silo = object.userData.silo as Silo;
    const provider = quota?.providers.find((p) => p.key === t.provider);
    pour(silo.week, WEEK, left(provider?.weekly));
    pour(silo.short, SHORT, left(provider?.short));
    silo.name.element.textContent = provider?.name ?? t.provider;
    silo.plan.element.textContent = provider?.plan ?? "";
    silo.sign.element.textContent = delivery(provider);
    // A sign that only says when is small print, and the page hides it from
    // far out; one that says out or unknown is read from anywhere.
    const level = left(provider?.weekly);
    silo.sign.element.className = level !== undefined && level > 0 ? "label fuel plain" : "label fuel";
    object.userData.provider = provider;
  }
}

export function draw(l: Layout, kit: Kit): Picture {
  const root = new THREE.Group();
  const bounds = new THREE.Box3();
  const sheds: THREE.Object3D[] = [];
  const towers: THREE.Object3D[] = [];
  const rails = new Rails();
  const grow = (x: number, z: number, y = 0) => bounds.expandByPoint(new THREE.Vector3(x, y, z));

  for (const b of l.boards) {
    root.add(block("bed", b.width, -GROUND_Y, b.depth, b.at.x + b.width / 2, GROUND_Y, b.at.z + b.depth / 2));
    root.add(label(b.depot, "depot", b.at.x + 1, 0, b.at.z + 2, [0, 0.5]));
    grow(b.at.x, b.at.z);
    grow(b.at.x + b.width, b.at.z + b.depth);
  }

  for (const t of l.tracks) {
    // From the headshunt, where its shunter is parked, to the buffer.
    rails.run({ x: t.at.x - HEADSHUNT, z: t.at.z }, t.length + HEADSHUNT);
    root.add(bufferStop(t.at.x - HEADSHUNT - 0.15, t.at.z));
    root.add(bufferStop(t.at.x + t.length + 0.15, t.at.z));
    // Above the track's left end, clear of what stands at its first platform.
    root.add(label(t.flow, "flow", BOARD_X + 1, 0, t.at.z - 3, [0, 0.5]));
  }
  for (const s of l.sidings) {
    rails.run(s.at, s.length);
    // The points: a diagonal from the main line to the stub's left end.
    rails.run({ x: s.at.x + SIDING_Z, z: s.at.z - SIDING_Z }, -SIDING_Z * Math.SQRT2, Math.PI / 4);
    root.add(bufferStop(s.at.x + s.length + 0.15, s.at.z));
  }

  for (const p of l.platforms) {
    root.add(block(p.terminal ? "terminal" : "platform", PLATFORM_LENGTH, PLATFORM_HEIGHT, PLATFORM_WIDTH, p.at.x, 0, p.at.z));
    // On the platform's edge away from its track, at its right end: in the
    // middle it would cover the wagons behind it, further left the sheds' names.
    const edge = p.at.z + (p.siding ? -1 : 1) * (PLATFORM_WIDTH / 2);
    root.add(label(p.stage, p.siding ? "stage siding" : "stage", p.at.x + 3.2, 0, edge));
    if (p.signal) root.add(signal(p.at.x + PLATFORM_LENGTH / 2 - 0.4, p.at.z));
  }

  // A crew's sign changes with who is out: Stock writes it, here.
  const beside = new Map<string, number>();
  for (const s of l.sheds) {
    const n = beside.get(s.platform) ?? 0;
    beside.set(s.platform, n + 1);
    const object = shed(s, kit);
    root.add(object);
    sheds.push(object);
    const at = signAt(s, n);
    if (s.places.length > 0) object.userData.sign = at;
    else root.add(label(sign(s), "group", ...at, [0, s.away > 0 ? 0 : 1]));
  }

  for (const b of l.boxes) {
    root.add(signalBox(b.at.x, b.at.z));
    root.add(label(b.name, "crew", b.at.x, BOX_HEIGHT, b.at.z, [0.5, 1]));
    grow(b.at.x - 2, b.at.z - 2, BOX_HEIGHT);
    grow(b.at.x + 2, b.at.z + 2);
  }

  for (const t of l.towers) {
    const object = tower(t, kit);
    root.add(object);
    towers.push(object);
    grow(t.at.x - SILO_WALL, t.at.z - SILO_WALL - 0.4, TOWER_HEIGHT);
    grow(t.at.x + SHORT_X + 0.7, t.at.z + SILO_WALL + 0.5);
  }
  // The silos show the quota as it is, wherever a replay stands: the page
  // lets this be seen while the picture is of another time.
  const first = l.towers.find((t) => !l.towers.some((o) => o.at.x < t.at.x));
  if (first) root.add(label("now", "now", first.at.x - SILO_WALL - 0.2, NOW_Y, first.at.z, [1, 0.5]));

  // The telegraph wire, on poles.
  const wire = l.wire;
  root.add(block("slate", wire.length, 0.06, 0.06, wire.at.x + wire.length / 2, POLE_HEIGHT - 0.2, wire.at.z));
  for (let x = 0; x <= wire.length; x += POLE_PITCH) {
    root.add(block(building.post[0], 0.16, POLE_HEIGHT, 0.16, wire.at.x + x, GROUND_Y, wire.at.z));
    root.add(block(building.post[1], 0.12, 0.12, 1.2, wire.at.x + x, POLE_HEIGHT - 0.3, wire.at.z));
  }
  root.add(label("hooks", "wire", wire.at.x + 1, POLE_HEIGHT, wire.at.z, [0, 1]));
  grow(wire.at.x, wire.at.z, POLE_HEIGHT);

  for (const p of l.peers) {
    // A rail each way: out on the near one, in on the far one.
    rails.run({ x: p.at.x, z: p.at.z + PEER_RAIL_Z }, p.length);
    rails.run({ x: p.at.x, z: p.at.z - PEER_RAIL_Z }, p.length);
    root.add(block("bed", p.length, -GROUND_Y - 0.02, 1.6 + 2 * PEER_RAIL_Z, p.at.x + p.length / 2, GROUND_Y, p.at.z));
    // The sign, behind the far rail.
    root.add(block(building.board[0], 2.4, 0.9, 0.2, p.at.x + 2, 1.2, p.at.z - 2));
    root.add(block("slate", 0.16, 1.2, 0.16, p.at.x + 2, 0, p.at.z - 2));
    root.add(label(`to ${p.name} →`, "peer", p.at.x + 2, 2.3, p.at.z - 2, [0.5, 1]));
    grow(p.at.x - 2, p.at.z - 3);
  }

  root.add(rails.build(kit.make("rail")));
  return { root, bounds, sheds, towers };
}

// One thing on its way: along a line of points, from one height, turn and
// size to another. turn "way" lays it along the way as it goes.
interface Move {
  path: Point[];
  y: [number, number];
  turn: [number, number] | "way";
  size: [number, number];
  seconds: number;
  // Below 0 it has not started: it waits out of sight.
  elapsed: number;
  ease: (t: number) => number;
  // After the way: the seconds it stands at its end, and then the seconds
  // it takes to grow small there.
  stand: number;
  fade: number;
  // Taken out of the picture at the end.
  last: boolean;
}

interface Mover {
  object: THREE.Object3D;
  size: number;
  move?: Move;
}

interface Wagon extends Mover {
  stop: Stop;
  // The platform it stands at, and the track of that: whose shunter moves it.
  platform: string;
  track: string;
  // How high its top is: where moss grows.
  top: number;
  // What it wears for its bead's faults and its wait, and which of them
  // that is.
  marks?: THREE.Object3D;
  marked?: string;
  chocks?: THREE.Object3D;
}

// A shunter and the kit's model of it. made says what it was made for: a
// track or a line laid another way has another.
interface Engine {
  queue: Shunter;
  object: THREE.Object3D;
  made: string;
  // An engine of a peer's, come in with goods: seen only while it is here.
  guest: boolean;
}

// A wagon the state has no more, which stands until a shunter has taken it
// out: a bead's past the buffer, a peer's goods along their line. stand is
// the seconds it stands at the end of that before it goes.
interface Parting {
  mover: Mover;
  engine: string;
  stand: number;
}

function same(a: Point, b: Point): boolean {
  return a.x === b.x && a.z === b.z;
}

// A figure: it walks from where it stood to where its person stands now,
// and plays what it does there.
interface Walker extends Mover {
  person: Person;
  // The way it looks, as a turn about the vertical.
  heading: number;
  // The platforms' edges it steps onto or off on its way: where it stands on
  // one, and the gate behind it.
  steps: { at: Point; gate: Point }[];
  // Its hard hat: off while it sits.
  hat?: THREE.Object3D;
  mixer?: THREE.AnimationMixer;
  actions: Partial<Record<Clip, THREE.AnimationAction>>;
  playing?: Clip;
  // How fast its walking clip plays on this way.
  stride: number;
}

// The turn that makes a figure look up or down the page.
function facing(faces: 1 | -1): number {
  return (-faces * Math.PI) / 2;
}

export interface Show {
  // Move to the new places, or stand there at once (a scrub, the first view).
  tween: boolean;
  // The beads that left for good: they roll out past the buffer.
  left?: ReadonlySet<string>;
  // The replay's speed: a walk or a shunter's job that starts now is that
  // much faster.
  speed?: number;
}

// The moving stock. show takes a layout and brings every wagon, figure and
// count to where it has them; tick moves what is on its way or at work. A
// wagon whose bead went to another platform does not go by itself: its
// track's shunter is given the order, and takes it there in its turn.
export class Stock {
  readonly root = new THREE.Group();
  // What the pointer can ask about, each with userData.bead.
  beads: THREE.Object3D[] = [];
  // How often a shunter coupled or uncoupled since the page last asked: an
  // order it took, and one whose wagons it let go of. The page sounds them
  // and sets it back.
  coupled = 0;

  private readonly wagons = new Map<string, Wagon>();
  private readonly walkers = new Map<string, Walker>();
  // The figures as the last layout had them: who is at which bead.
  private crew: Person[] = [];
  // No motion asked for, or a picture that does not move: a figure stands
  // in the middle of what it does, at work with its hand at the wagon.
  private calm = false;
  private readonly leaving = new Set<Mover>();
  // The shunters: a track's by its key, a peer's line's by its key and way.
  private readonly engines = new Map<string, Engine>();
  private readonly parting = new Map<string, Parting>();
  // The goods sent so far: each has a key of its own.
  private sent = 0;
  private readonly counts = new THREE.Group();
  // The faults' lamps: the platforms' here, the wagons' on the wagons. lamps
  // is how many are lit, blink where in a flash they all are.
  private readonly posts = new THREE.Group();
  private readonly light = new THREE.MeshBasicMaterial({ color: lamp.stop });
  private lamps = 0;
  private blink = 0;
  // The lamps of the wagons that wait: amber, and lit steadily.
  private readonly amber = new THREE.MeshBasicMaterial({ color: lamp.wait });
  // The works' chimneys and lamps, by their buildings' keys.
  private readonly fumes = new THREE.Group();
  private readonly stacks = new Map<string, Stack>();
  private readonly lit: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private layout: Layout;

  // sheds are the buildings draw made: a crew's carries where its sign is.
  constructor(
    l: Layout,
    private readonly kit: Kit,
    private sheds: THREE.Object3D[] = [],
  ) {
    this.layout = l;
    // The wire, lit: over the slate one, and seen only after a hook.
    const wire = l.wire;
    this.lit = new THREE.Mesh(
      new THREE.BoxGeometry(wire.length, 0.14, 0.14),
      new THREE.MeshBasicMaterial({ color: lamp.clear, transparent: true, opacity: 0 }),
    );
    this.lit.position.set(wire.at.x + wire.length / 2, POLE_HEIGHT - 0.17, wire.at.z);
    this.lit.visible = false;
    this.root.add(this.counts, this.posts, this.fumes, this.lit);
    this.show(l, { tween: false });
  }

  show(l: Layout, how: Show) {
    this.layout = l;
    // Nothing is on its way any more: every move is at its end.
    if (!how.tween) this.tick(Infinity);
    this.roster(l);

    const tracks = new Map(l.tracks.map((t) => [t.key, t]));
    const sidings = new Map(l.sidings.map((t) => [t.key, t]));
    const platforms = new Map(l.platforms.map((p) => [p.key, p]));
    const standing = new Set<string>();
    // What the shunters are asked, by track: the wagons that go together,
    // and the ones that only close up at their platform. A track whose
    // shunter gave up its orders in this takes none of them.
    const asked = new Map<string, Map<string, Haul[]>>();
    const closing = new Map<string, { key: string; wagon: Wagon; from: Stop }[]>();
    const gave = new Set<string>();
    const ask = (track: string, consist: string, haul: Haul) => {
      const consists = asked.get(track) ?? new Map<string, Haul[]>();
      asked.set(track, consists);
      consists.set(consist, [...(consists.get(consist) ?? []), haul]);
    };
    const giveUp = (track: string) => {
      this.land(this.engines.get(track)?.queue.snap() ?? []);
      gave.add(track);
    };
    for (const v of l.vehicles) {
      standing.add(v.key);
      const platform = platforms.get(v.platform);
      const track = platform && tracks.get(`${platform.depot}/${platform.flow}`);
      const mouth = sidings.get(v.platform)?.at;
      const stop: Stop = {
        at: v.at,
        line: track?.at.z ?? v.at.z,
        end: track ? track.at.x + track.length : v.at.x,
        ...(track ? { head: track.at.x - HEADSHUNT } : {}),
        ...(mouth !== undefined ? { mouth } : {}),
      };
      const on = track?.key ?? "";
      let wagon = this.wagons.get(v.key);
      if (!wagon) {
        // Its bead is back before a shunter took its last wagon out.
        const old = this.parting.get(v.key);
        if (old) giveUp(old.engine);
        const object = v.kind === "locomotive" ? this.kit.make("locomotive") : this.kit.make("wagon", hash(v.bead.id));
        // Its body by its bead's type, before the weather is at it.
        coat(object, paint(stocked(v.bead.type)));
        // Measured before it is anywhere, at its full size.
        const top = new THREE.Box3().setFromObject(object).max.y;
        wagon = { object, size: 1, stop, platform: v.platform, track: on, top };
        this.wagons.set(v.key, wagon);
        this.root.add(object);
        // New to the picture: it grows where it stands.
        this.send(wagon, [v.at], { size: [0, 1], seconds: TWEEN_MIN }, how.tween);
      } else if (!same(wagon.stop.at, v.at)) {
        const from = wagon.stop;
        // Onto another track there is no rail: its old shunter lets it go.
        if (wagon.track !== on && this.engines.get(wagon.track)?.queue.holds(v.key)) giveUp(wagon.track);
        const engine = how.tween && wagon.track === on ? this.engines.get(on) : undefined;
        if (engine && wagon.platform !== v.platform) {
          // To another platform: an order, with its train or with the
          // wagons of it that go the same way.
          const consist = v.kind === "locomotive" ? v.key : (v.bead.train ?? v.key);
          ask(on, `${wagon.platform}>${v.platform}>${v.at.x - from.at.x}>${consist}`, { key: v.key, from, to: stop });
        } else if (engine) {
          closing.set(on, [...(closing.get(on) ?? []), { key: v.key, wagon, from }]);
        } else {
          this.send(wagon, route(from, stop), {}, how.tween);
        }
      }
      wagon.stop = stop;
      wagon.platform = v.platform;
      wagon.track = on;
      wagon.object.userData.bead = v.bead;
      wagon.object.userData.age = v.age;
      wagon.object.userData.waits = (v.waits ?? []).map(awaits);
      this.mark(wagon, v);
    }
    for (const [key, wagon] of this.wagons) {
      if (standing.has(key)) continue;
      this.wagons.delete(key);
      // Whatever was wrong with it, it is on its way out.
      this.mark(wagon, {});
      const bead = wagon.object.userData.bead as Bead;
      // A wagon of a train that left goes out with it.
      const out = how.left?.has(key) === true || (bead.train !== undefined && how.left?.has(bead.train) === true);
      const engine = how.tween ? this.engines.get(wagon.track) : undefined;
      if (engine && out) {
        this.parting.set(key, { mover: wagon, engine: wagon.track, stand: 0 });
        ask(wagon.track, `${wagon.platform}>>${bead.type === "train" ? key : (bead.train ?? key)}`, { key, from: wagon.stop });
        continue;
      }
      // Gone while its shunter had an order for it: there is nothing to move.
      if (engine?.queue.holds(key)) giveUp(wagon.track);
      const at = { x: wagon.object.position.x, z: wagon.object.position.z };
      this.send(wagon, out ? exit(wagon.stop) : [at], { size: [1, 0], last: true, ...(out ? {} : { seconds: TWEEN_MIN }) }, how.tween);
    }

    for (const [key, engine] of this.engines) {
      const here = [...this.wagons].filter(([, w]) => w.track === key);
      engine.queue.stand(new Map(here.map(([k, w]) => [k, w.stop.at])));
    }
    for (const [track, queue] of [...this.engines].map(([key, e]) => [key, e.queue] as const)) {
      // Those furthest up the line first: they make room for the ones behind.
      const orders = [...(asked.get(track) ?? [])]
        .map(([key, wagons]): Order => ({ key, wagons, speed: how.speed ?? 1, close: [] }))
        .sort((a, b) => b.wagons[0]!.from.at.x - a.wagons[0]!.from.at.x);
      // A wagon that closes up into the place of one that waits for the
      // shunter waits with it, and so does the one behind it; any other
      // rolls at once, as one that makes room for a wagon on its way in.
      const rolls = new Set(closing.get(track) ?? []);
      for (let found = true; found; ) {
        found = false;
        for (const roll of rolls) {
          const order = keeps(orders, roll.wagon.stop.at) ?? queue.keeps(roll.wagon.stop.at);
          if (!order) continue;
          order.close.push({ key: roll.key, from: roll.from.at });
          rolls.delete(roll);
          found = true;
        }
      }
      for (const { wagon, from } of rolls) this.send(wagon, route(from, wagon.stop), {}, true);
      for (const order of orders) this.land(gave.has(track) ? [order] : this.give(queue, order, how.tween));
    }

    // A scrub knows nothing of who stood where: the first at home goes out.
    this.crew = people(l, how.tween ? this.crew : []);
    // A figure stays with its bead when its session ends badly, and when the
    // next one starts there: it sits down where it worked and stands up
    // where it sat, under the key the bead's figure has now. The one that
    // key had, idle at its place, gives way.
    const at = new Map(this.crew.flatMap((p) => (p.bead ? [[p.bead.id, p] as const] : [])));
    for (const [key, walker] of how.tween ? [...this.walkers] : []) {
      const p = walker.person.bead && at.get(walker.person.bead.id);
      if (!p || p.key === key || p.sat === walker.person.sat) continue;
      const other = this.walkers.get(p.key);
      if (other) this.root.remove(other.object);
      this.walkers.delete(key);
      this.walkers.set(p.key, walker);
    }
    const placed = new Set<string>();
    for (const p of this.crew) {
      placed.add(p.key);
      let walker = this.walkers.get(p.key);
      if (!walker) {
        walker = this.figure(p);
        this.walkers.set(p.key, walker);
        this.root.add(walker.object);
      } else if (walker.person.at.x !== p.at.x || walker.person.at.z !== p.at.z) {
        const at = { x: walker.object.position.x, z: walker.object.position.z };
        const onPlatform = walker.object.position.y > PLATFORM_HEIGHT / 2;
        const way = walker.move
          ? continueWalk(walker.person, p, at, onPlatform)
          : walk(walker.person, p);
        const time = walkSeconds(measure(way), how.speed);
        walker.stride = stride(measure(way), time);
        walker.steps = [walker.person, p].filter((q) => q.platform !== undefined).map((q) => ({ at: q.at, gate: q.gate }));
        this.send(walker, way, { seconds: time }, how.tween);
      }
      walker.person = p;
      // Only a figure at work has a bead to name.
      walker.object.userData.bead = p.bead;
      this.stand(walker, how.tween ? 0 : Infinity);
    }
    // A figure goes only with its place: its group's building, or its limit.
    // One that sat has no place: it goes where it is, as a wagon does, when
    // its bead moved on without it.
    for (const [key, walker] of this.walkers) {
      if (placed.has(key)) continue;
      this.walkers.delete(key);
      if (!walker.person.sat || !how.tween) {
        this.root.remove(walker.object);
        continue;
      }
      const { x, z } = walker.object.position;
      this.send(walker, [{ x, z }], { turn: [walker.heading, walker.heading], size: [1, 0], seconds: TWEEN_MIN, last: true }, true);
    }

    this.posts.clear();
    for (const post of l.lamps) this.posts.add(beacon(this.light, post.at.x, PLATFORM_HEIGHT, post.at.z, PLATFORM_LAMP_Y));
    this.lamps = l.lamps.length + l.vehicles.filter((v) => v.lamp).length;
    this.beat(0);

    this.fire(l, how.tween);

    this.counts.clear();
    for (const c of l.counts) {
      this.counts.add(label(`+${c.more}${c.of === "beads" ? "" : ` ${c.of}`}`, "count", c.at.x, 1.6, c.at.z, [1, 0.5]));
    }
    for (const { userData } of this.sheds) {
      const s = userData.shed as Shed;
      const at = userData.sign as [number, number, number] | undefined;
      if (at) this.counts.add(label(sign(s, atWork(l, s.group)), "group", ...at, [0, s.away > 0 ? 0 : 1]));
    }
    const working = [...this.walkers.values()].filter((w) => w.person.bead !== undefined);
    this.beads = [...this.wagons.values(), ...working].map((m) => m.object);
  }

  set still(still: boolean) {
    this.calm = still;
    for (const walker of this.walkers.values()) this.stand(walker, 0);
    this.beat(0);
    for (const at of this.stacks.values()) this.fume(at, 0);
  }

  // What a wagon wears for what is wrong with its bead: chocks and a flag
  // for a hold, a lamp for a fault; for a long wait on a person: dull
  // paint, rust, then moss on top; and for a wait on another bead: a small
  // amber lamp. Nothing for a wagon that is well.
  private mark(wagon: Wagon, v: Pick<Vehicle, "chocked" | "lamp" | "weather" | "waits">) {
    const waits = v.waits !== undefined;
    const marked = `${v.chocked === true}/${v.lamp === true}/${v.weather ?? ""}/${waits}`;
    if ((wagon.marked ?? "false/false//false") === marked) return;
    wagon.marked = marked;
    if (wagon.marks) wagon.object.remove(wagon.marks);
    delete wagon.chocks;
    // The paint is the wagon's own: what it wears is off while it is done.
    repaint(wagon.object, v.weather);
    wagon.marks = new THREE.Group();
    if (v.weather === "mossy") wagon.marks.add(moss(wagon.top));
    if (v.chocked) {
      wagon.chocks = chocks();
      wagon.marks.add(wagon.chocks, flag());
    }
    if (v.lamp) wagon.marks.add(beacon(this.light, -MARK_X, 0, 0, LAMP_Y - 0.2));
    if (waits) wagon.marks.add(lantern(this.amber, wagon.top));
    wagon.object.add(wagon.marks);
  }

  // Bring the faults' lamps on by a time: lit, then dark, all together. A
  // picture that does not move has them lit. True while any flashes.
  private beat(dt: number): boolean {
    const flashing = this.lamps > 0 && !this.calm;
    if (flashing && Number.isFinite(dt)) this.blink = (this.blink + dt) % BLINK;
    this.light.color.setHex(!flashing || this.blink < BLINK / 2 ? lamp.stop : fault.dark);
    return flashing;
  }

  // Every works' chimney and lamp as a layout has its gate: smoke while a
  // run is open, the lamp for how the last one ended. seen is whether the
  // picture moves there: then smoke starts at the chimney, and what is in the
  // air when the run ends rises on; a scrub has the whole plume or none. A
  // works' building is told its gate too, for the pointer.
  private fire(l: Layout, seen: boolean) {
    const works = new Map(l.sheds.filter((s) => s.kind === "works").map((s) => [s.key, s]));
    const built = new Map(this.sheds.map((o) => [(o.userData.shed as Shed).key, o]));
    for (const [key, old] of this.stacks) {
      if (works.has(key)) continue;
      this.fumes.remove(old.root);
      this.stacks.delete(key);
    }
    for (const [key, s] of works) {
      let at = this.stacks.get(key);
      if (!at) {
        at = stack();
        this.stacks.set(key, at);
        this.fumes.add(at.root);
      }
      const building = built.get(key);
      if (building) building.userData.shed = s;
      const mouth = building?.userData[CHIMNEY] as [number, number, number] | undefined;
      at.plume.position.copy(building && mouth ? building.localToWorld(new THREE.Vector3(...mouth)) : new THREE.Vector3(s.at.x, ROOF_Y, s.at.z));
      at.post.position.set(s.at.x + GATE_LAMP_X, 0, s.at.z);
      at.lamp.color.setHex(gateLamp(s.gate));
      const burns = (s.gate?.runs.length ?? 0) > 0;
      if (burns && at.burnt !== Infinity) {
        at.seconds = seen ? 0 : PUFF_SECONDS;
        at.burnt = Infinity;
      } else if (!burns && at.burnt === Infinity) {
        at.burnt = seen ? at.seconds : 0;
      }
      this.fume(at, 0);
    }
  }

  // Bring a works' smoke on by a time. No time (Infinity), or a picture that
  // does not move, is the whole plume of a fire that burns and none of one
  // that is out. True while its smoke moves.
  private fume(at: Stack, dt: number): boolean {
    if (!Number.isFinite(dt) || this.calm) at.seconds = at.burnt === Infinity ? Math.max(at.seconds, PUFF_SECONDS) : Infinity;
    else at.seconds += dt;
    at.puffs.forEach((mesh, i) => {
      const p = puff(i, at.seconds, at.burnt);
      mesh.visible = p !== undefined;
      if (!p) return;
      mesh.position.set(p.x, p.y, p.z);
      mesh.scale.setScalar(p.size);
      mesh.material.opacity = p.shade;
    });
    return !this.calm && smokes(at.seconds, at.burnt);
  }

  // The buildings of a picture drawn again: the next show writes their signs.
  house(sheds: THREE.Object3D[]) {
    this.sheds = sheds;
  }

  // A figure for a person, standing where the person does.
  private figure(p: Person): Walker {
    const { object, clips } = this.kit.figure(p.outfit, hash(p.key));
    const walker: Walker = { object, size: 1, person: p, heading: facing(p.faces), steps: [], actions: {}, stride: 1 };
    const hat = object.getObjectByName(HAT);
    if (hat) walker.hat = hat;
    if (Object.keys(clips).length > 0) {
      walker.mixer = new THREE.AnimationMixer(object);
      for (const [name, clip] of Object.entries(clips) as [Clip, THREE.AnimationClip][]) walker.actions[name] = walker.mixer.clipAction(clip);
    }
    object.position.set(p.at.x, 0, p.at.z);
    object.userData.crew = true;
    return walker;
  }

  // Bring a figure on by a time: along its way, onto or off a platform,
  // turned the way it goes or to what it works at, and on in what it does.
  // No time (Infinity) is where and how it ends up, at once.
  private stand(w: Walker, dt: number) {
    const at = w.object.position;
    const was = { x: at.x, z: at.z };
    if (w.move) {
      w.move.elapsed += dt;
      this.pose(w);
    }
    const moving = w.move !== undefined;
    const gone = Math.hypot(at.x - was.x, at.z - was.z);
    const steps = moving ? w.steps : w.person.platform !== undefined ? [w.person] : [];
    // Up at a platform's edge, down again by the gate behind it.
    at.y = Math.max(
      0,
      ...steps.map((s) => {
        const far = Math.hypot(s.gate.x - s.at.x, s.gate.z - s.at.z);
        return PLATFORM_HEIGHT * Math.min(1, (far - Math.hypot(at.x - s.at.x, at.z - s.at.z)) / STEP);
      }),
    );
    const towards = !moving ? facing(w.person.faces) : gone > 1e-6 ? heading(was, at) : w.heading;
    w.heading = Number.isFinite(dt) ? turn(w.heading, towards, TURN * dt) : towards;
    w.object.rotation.y = w.heading;
    if (w.hat) w.hat.visible = moving || !w.person.sat;

    const mixer = w.mixer;
    if (!mixer) return;
    const now = doing(w.person, moving, !this.hauled(w.person.bead?.id));
    // A pack with no sitting pose: it stands idle, its back to the wagon.
    const next = w.actions[now] ?? (now === "sit" ? w.actions.idle : undefined);
    const last = w.playing !== undefined ? w.actions[w.playing] : undefined;
    // Standing still, a figure stops in the middle of its clip: at work with
    // its hand at the wagon. A walk moves, as the wagons do.
    const frozen = this.calm && now !== "walk";
    if (next && (w.playing !== now || !Number.isFinite(dt) || frozen)) {
      if (!Number.isFinite(dt) || frozen || !last) {
        mixer.stopAllAction();
        next.play();
        next.time = frozen ? next.getClip().duration / 2 : 0;
      } else {
        next.reset().play();
        last.crossFadeTo(next, FADE, false);
      }
      w.playing = now;
    }
    // The working loop keeps its own pace at any speed of the replay; only the
    // walk is as fast as its way.
    next?.setEffectiveTimeScale(now === "walk" ? w.stride : 1);
    mixer.update(Number.isFinite(dt) && !frozen ? dt : 0);
  }

  // Whether a bead's wagon is not at its place yet: a shunter has an order
  // for it.
  private hauled(bead: string | undefined): boolean {
    return bead !== undefined && [...this.engines.values()].some((e) => e.queue.holds(bead));
  }

  // A shunter for every track, and two for every peer's line: its own for
  // goods out, and the peer's engine that brings goods in. One whose track
  // or line is laid another way now starts again at its place there.
  private roster(l: Layout) {
    const wanted = new Map<string, { park: Stop; plan: Plan; guest: boolean; made: string }>();
    for (const t of l.tracks) {
      if (!t.park) continue;
      const park = { at: t.park, line: t.at.z, end: t.at.x + t.length, head: t.at.x - HEADSHUNT };
      wanted.set(t.key, { park, plan: shunting, guest: false, made: JSON.stringify(park) });
    }
    const edge = l.wire.at.x + l.wire.length;
    for (const p of l.peers) {
      for (const way of ["out", "in"] as const) {
        const path = goods(p, edge, way);
        const at = hauling(path)[0]!;
        wanted.set(`${p.key}/${way}`, { park: { at, line: at.z, end: Infinity }, plan: freight(path, way), guest: way === "in", made: JSON.stringify(path) });
      }
    }
    for (const [key, engine] of this.engines) {
      if (wanted.get(key)?.made === engine.made) {
        wanted.delete(key);
        continue;
      }
      this.land(engine.queue.snap());
      this.root.remove(engine.object);
      this.engines.delete(key);
    }
    for (const [key, { park, plan, guest, made }] of wanted) {
      const engine = { queue: new Shunter(park, plan), object: this.kit.make("shunter"), made, guest };
      // Whose it is: no bead's, and the pointer has nothing to ask it.
      engine.object.userData.shunter = key;
      this.engines.set(key, engine);
      this.root.add(engine.object);
      this.drive(engine);
    }
  }

  // Put a shunter and the wagons of its order where its queue has them. A
  // shunter is not turned round: it runs back as it came. A peer's engine
  // looks the way it comes in, down its line to the yard.
  private drive(engine: Engine) {
    const { engine: at, wagons } = engine.queue.pose();
    for (const { key, pose } of wagons) {
      const mover = this.parting.get(key)?.mover ?? this.wagons.get(key);
      if (!mover) continue;
      // Whatever it did by itself is over: it is pulled.
      if (mover.move) {
        mover.move.elapsed = Infinity;
        this.pose(mover);
      }
      mover.object.visible = true;
      mover.object.position.set(pose.x, mover.object.position.y, pose.z);
      mover.object.rotation.y = pose.angle;
    }
    engine.object.position.set(at.x, 0, at.z);
    engine.object.rotation.y = at.angle + (engine.guest ? Math.PI : 0);
    engine.object.visible = !engine.guest || engine.queue.busy;
  }

  // Give a shunter an order. What comes back are the orders it gave up for
  // it; with none it couples to the order's wagons, in its turn. seen is
  // whether the picture moves there: a scrub's order is done at once.
  private give(queue: Shunter, order: Order, seen: boolean): Order[] {
    const back = queue.take(order);
    if (seen && back.length === 0) this.coupled++;
    return back;
  }

  // A shunter let go of an order's wagons: each stands where it was taken,
  // unless a later order has it. One with no place there goes: small and
  // out of the picture, a peer's goods after their stand. One the state has
  // elsewhere at its platform by now rolls there, and so do the wagons that
  // waited to close up.
  private settle(engine: Engine, order: Order) {
    this.coupled++;
    const close = (key: string) => {
      const wagon = this.wagons.get(key);
      if (!wagon || engine.queue.holds(key)) return;
      const at = { x: wagon.object.position.x, z: wagon.object.position.z };
      if (!same(at, wagon.stop.at)) this.send(wagon, [at, wagon.stop.at], {}, true);
    };
    for (const haul of order.wagons) {
      const parting = this.parting.get(haul.key);
      const mover = parting?.mover ?? this.wagons.get(haul.key);
      if (!mover) continue;
      if (haul.to) mover.object.position.set(haul.to.at.x, mover.object.position.y, haul.to.at.z);
      mover.object.rotation.y = 0;
      if (!parting) {
        close(haul.key);
        continue;
      }
      this.parting.delete(haul.key);
      const at = { x: mover.object.position.x, z: mover.object.position.z };
      const stands = parting.stand > 0;
      this.send(mover, [at], { size: [1, stands ? 1 : 0], seconds: stands ? parting.stand : TWEEN_MIN, fade: stands ? TWEEN_MIN : 0, last: true }, true);
    }
    for (const c of order.close) close(c.key);
  }

  // Orders no shunter will carry out: their wagons stand at once where the
  // state has them, and those it has no more are gone.
  private land(orders: Order[]) {
    for (const key of orders.flatMap((o) => [...o.wagons, ...o.close].map((w) => w.key))) {
      const parting = this.parting.get(key);
      const wagon = this.wagons.get(key);
      if (parting) {
        this.parting.delete(key);
        this.drop(parting.mover);
      } else if (wagon) {
        this.send(wagon, [wagon.stop.at], {}, false);
      }
    }
  }

  // Goods on a peer's line: out to the peer past the yard's edge behind the
  // line's shunter, or in from there behind an engine of the peer's to the
  // yard's end, where they stand a moment. kind is the message's (mail,
  // ping, bead), speed the replay's. They are an order like any: they wait
  // their turn out of sight, and with too many before them are not seen.
  goods(peer: string, way: "out" | "in", kind: string | undefined, speed: number) {
    const line = this.layout.peers.find((p) => p.name === peer);
    const engine = line && this.engines.get(`${line.key}/${way}`);
    if (!line || !engine) return;
    const [pick, size] = GOODS[kind ?? ""] ?? GOODS.mail!;
    // No bead rides in it: it is a van, the kit's iron and no type's colour.
    const wagon: Mover = { object: this.kit.make("van", pick), size };
    wagon.object.scale.setScalar(size);
    wagon.object.add(label(kind !== undefined ? `${kind} · ${peer}` : peer, "goods", 0, GOODS_LABEL_Y / size, 0, [0.5, 1]));
    wagon.object.visible = false;
    this.root.add(wagon.object);
    const key = `goods/${this.sent++}`;
    this.parting.set(key, { mover: wagon, engine: `${line.key}/${way}`, stand: way === "in" ? GOODS_STAND : 0 });
    const at = engine.queue.park.at;
    this.land(this.give(engine.queue, { key, wagons: [{ key, from: { at, line: at.z, end: Infinity } }], speed, close: [] }, true));
  }

  // A hook came in over the wire.
  flash() {
    this.lit.material.opacity = 1;
    this.lit.visible = true;
  }

  // Start a mover on its way, or put it at the end of it.
  private send(m: Mover, path: Point[], over: Partial<Move>, tween: boolean) {
    const at = m.object.position;
    // From where it is now, when the last move did not get it to its stop.
    const from = m.move && path[0] && (path[0].x !== at.x || path[0].z !== at.z) ? [{ x: at.x, z: at.z }, ...path] : path;
    const move: Move = {
      path: from,
      y: [at.y, at.y],
      turn: "way",
      size: [m.object.scale.x / m.size || 1, 1],
      seconds: seconds(measure(from)),
      elapsed: 0,
      ease,
      stand: 0,
      fade: 0,
      last: false,
      ...over,
    };
    m.move = move;
    if (move.last) this.leaving.add(m);
    if (!tween) move.elapsed = move.seconds + move.stand + move.fade;
    this.pose(m);
  }

  private pose(m: Mover) {
    const move = m.move;
    if (!move) return;
    const t = move.ease(Math.min(1, Math.max(0, move.elapsed) / move.seconds));
    const pose = along(move.path, t);
    const over = move.elapsed - move.seconds - move.stand;
    const faded = move.fade > 0 ? Math.min(1, Math.max(0, over / move.fade)) : 0;
    m.object.visible = move.elapsed >= 0;
    m.object.position.set(pose.x, move.y[0] + (move.y[1] - move.y[0]) * t, pose.z);
    m.object.rotation.y = move.turn === "way" ? pose.angle : move.turn[0] + (move.turn[1] - move.turn[0]) * t;
    m.object.scale.setScalar(m.size * (move.size[0] + (move.size[1] - move.size[0]) * t) * (1 - faded));
    if (over < move.fade) return;
    delete m.move;
    if (move.turn === "way") m.object.rotation.y = 0;
    if (move.last) this.drop(m);
  }

  // Out of the picture.
  private drop(m: Mover) {
    this.leaving.delete(m);
    // A label is an element of the page: it goes with its object.
    m.object.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
    });
    this.root.remove(m.object);
  }

  // Move everything on by a time in seconds. True while anything still moves.
  tick(dt: number): boolean {
    let moving = false;
    for (const m of [...this.wagons.values(), ...this.leaving]) {
      if (!m.move) continue;
      m.move.elapsed += dt;
      this.pose(m);
      moving = true;
    }
    if (this.beat(dt)) moving = true;
    for (const at of this.stacks.values()) {
      if (this.fume(at, dt)) moving = true;
    }
    // The shunters, after what moves by itself: a wagon behind one is where
    // the shunter has it. No time is every order done at once, unseen.
    for (const engine of this.engines.values()) {
      if (Number.isFinite(dt)) for (const order of engine.queue.tick(dt)) this.settle(engine, order);
      else this.land(engine.queue.snap());
      this.drive(engine);
      if (engine.queue.busy) moving = true;
    }
    // No chocks under a wagon that rolls, or that a shunter has.
    for (const [key, wagon] of this.wagons) {
      if (wagon.chocks) wagon.chocks.visible = !wagon.move && !this.hauled(key);
    }
    for (const walker of this.walkers.values()) {
      this.stand(walker, dt);
      // A figure with clips is never still, unless it was asked to be.
      if (walker.move || (walker.mixer && !this.calm)) moving = true;
    }
    if (this.lit.visible) {
      this.lit.material.opacity -= dt / FLASH;
      this.lit.visible = this.lit.material.opacity > 0;
      moving = true;
    }
    return moving;
  }
}

// The tip of a building: its group, what runs it and how many at once; of a
// works also what its gate runs on, and how its last run ended.
export function house(s: Shed): string {
  const runs = (s.gate?.runs ?? []).map(({ bead, since }) => {
    const from = Date.parse(since ?? "");
    return `runs the gate on ${bead}${Number.isNaN(from) ? "" : ` since ${hour.format(from)}`}`;
  });
  const last = s.gate?.last === "landed" ? ["last run landed"] : s.gate?.last === "failed" ? ["last gate failed"] : [];
  return [s.group, s.runner === "" ? "no group of this yard" : `${s.runner} · limit ${s.limit}`, ...runs, ...last].join("\n");
}

// What a tower is called under the pointer: its provider as it is written,
// and the plan.
export function titled(key: string, p: Provider | undefined): string {
  return p === undefined ? key : p.plan !== undefined ? `${p.name} · ${p.plan}` : p.name;
}

// The day and time of a delivery, in the reader's own: Mon 15:00.
const day = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const UNKNOWN = "unknown";

// When a window starts again: "resets Mon 15:00". Nothing where the provider
// did not say.
export function resets(a: Allowance | undefined): string | undefined {
  const at = Date.parse(a?.resets_at ?? "");
  if (Number.isNaN(at)) return undefined;
  const parts = new Map(day.formatToParts(at).map((p) => [p.type, p.value]));
  return `resets ${parts.get("weekday")} ${parts.get("hour")}:${parts.get("minute")}`;
}

// A tower's sign: the next delivery, when the week starts again. An empty
// tower says it is out first, and one nobody knows the level of says that.
export function delivery(p: Provider | undefined): string {
  const percent = left(p?.weekly);
  if (percent === undefined) return UNKNOWN;
  const next = resets(p?.weekly);
  return percent <= 0 ? ["out", ...(next !== undefined ? [next] : [])].join(" · ") : (next ?? "");
}

// The tip of a tower: what is left of each window, and when it starts again.
export function fuelled(key: string, p: Provider | undefined): string {
  const said = (what: string, a: Allowance | undefined) => {
    const percent = left(a);
    if (percent === undefined) return [];
    const next = resets(a);
    return [`${Math.round(percent)}% of ${what} left${next !== undefined ? `, ${next}` : ""}`];
  };
  const lines = [...said("the week", p?.weekly), ...said("the 5 hours", p?.short)];
  return [titled(key, p), ...(lines.length > 0 ? lines : [UNKNOWN])].join("\n");
}

// The time of day of a fault, in the reader's own time: 14:02.
const hour = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// What is wrong with a bead, in words: "held", "session gave up 14:02",
// "move refused 06:27". Nothing for a bead that is well.
export function wrong(bead: Bead): string | undefined {
  const said: string[] = bead.hold === true ? ["held"] : [];
  if (bead.fault) {
    const when = Date.parse(bead.fault.at);
    said.push(`${faulted(bead.fault)}${Number.isNaN(when) ? "" : ` ${hour.format(when)}`}`);
  }
  return said.length > 0 ? said.join(" · ") : undefined;
}

// How long a wagon has waited on a person at its stage, in words: "in
// backlog 9 days".
export function waited(stage: string, days: number): string {
  const whole = Math.floor(days);
  return `in ${stage} ${whole < 1 ? "under a day" : whole === 1 ? "1 day" : `${whole} days`}`;
}

// What a wagon waits for, in words, with where that stands: "waits for
// yardr-xyz (aiquokka · review)".
export function awaits(w: Wait): string {
  return `waits for ${w.on} (${w.depot} · ${w.stage})`;
}

// The tip of a wagon, or of the figure that works it or sits by it. age is
// the days the wagon has waited on a person, where it does; waits is what
// it waits for, a line for each bead (awaits).
export function describe(bead: Bead, crew: boolean, age?: number, waits: string[] = []): string {
  const faults = wrong(bead);
  const stands = `${bead.depot} · ${bead.type} · ${bead.stage}${faults !== undefined ? ` · ${faults}` : ""}`;
  const where = [stands, ...(age !== undefined ? [waited(bead.stage, age)] : []), ...waits].join("\n");
  return crew ? `${bead.id} — session of ${bead.group ?? "?"}\n${bead.title}\n${where}` : `${bead.id}\n${bead.title}\n${where}`;
}
