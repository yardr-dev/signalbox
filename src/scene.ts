// Draws a layout: the kit's rails, wagons and locomotives, and boxes in the
// palette for the rest. Nothing here decides where a thing is; layout.ts did.

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { lamp, palette, type Kit } from "./kit";
import {
  BAY_COLUMNS,
  BAY_DEPTH,
  BAY_WIDTH,
  BOARD_X,
  PLATFORM_LENGTH,
  SIDING_Z,
  type Layout,
  type Point,
  type Shed,
} from "./layout";
import type { Bead } from "./yard";

// Heights, and the few sizes layout.ts has no say in.
const GROUND_Y = -0.3;
const PLATFORM_HEIGHT = 0.45;
const PLATFORM_WIDTH = 1.4;
const WALL_HEIGHT = 0.6;
const POLE_PITCH = 12;
const POLE_HEIGHT = 3.2;
const CREW_SCALE = 0.7;

export interface Picture {
  root: THREE.Group;
  // What the pointer can ask about, each with userData.bead.
  beads: THREE.Object3D[];
  // The box on the ground everything stands in, for the first view. A peer's
  // line counts only where it starts: it runs off the page on purpose.
  bounds: THREE.Box3;
}

const materials = new Map<number, THREE.MeshStandardMaterial>();
function material(colour: number): THREE.MeshStandardMaterial {
  let m = materials.get(colour);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: colour, flatShading: true, roughness: 0.95 });
    materials.set(colour, m);
  }
  return m;
}

// A box standing on y, centred on x and z.
function block(colour: number, width: number, height: number, depth: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(colour));
  mesh.position.set(x, y + height / 2, z);
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
      this.at.forEach((m, i) => instances.setMatrixAt(i, m.clone().multiply(part.matrixWorld)));
      group.add(instances);
    });
    return group;
  }
}

function bufferStop(x: number, z: number): THREE.Object3D {
  const stop = new THREE.Group();
  stop.add(block(palette.slate, 0.3, 0.9, 1.1, x, 0, z));
  stop.add(block(lamp.stop, 0.34, 0.3, 1.14, x, 0.55, z));
  return stop;
}

function signal(x: number, z: number): THREE.Object3D {
  const post = new THREE.Group();
  post.add(block(palette.slate, 0.16, 2.6, 0.16, x, PLATFORM_HEIGHT, z));
  post.add(block(palette.slate, 0.5, 0.9, 0.4, x, PLATFORM_HEIGHT + 2.3, z));
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: lamp.clear }));
  light.position.set(x, PLATFORM_HEIGHT + 2.9, z + 0.22);
  post.add(light);
  return post;
}

// A group of people: a station building. A group that runs sessions: an
// engine shed, open above so its crews show, a stall per bay.
function shed(s: Shed, kit: Kit, beads: THREE.Object3D[]): THREE.Object3D {
  const g = new THREE.Group();
  if (s.people) {
    g.add(block(palette.cream, 2.6, 1.5, 1.4, s.at.x + 0.7, 0, s.at.z));
    g.add(block(palette.slate, 3, 0.25, 1.8, s.at.x + 0.7, 1.5, s.at.z));
    return g;
  }
  const columns = Math.min(s.bays.length, BAY_COLUMNS);
  const rows = Math.ceil(s.bays.length / BAY_COLUMNS);
  if (rows === 0) return g;
  const width = columns * BAY_WIDTH;
  const depth = rows * BAY_DEPTH;
  const cx = s.at.x + (width - BAY_WIDTH) / 2;
  const cz = s.at.z + (s.away * (depth - BAY_DEPTH)) / 2;
  g.add(block(palette.slate, width + 0.2, 0.08, depth + 0.2, cx, 0, cz));
  for (let c = 0; c <= columns; c++) {
    g.add(block(palette.brick, 0.12, WALL_HEIGHT, depth, s.at.x - BAY_WIDTH / 2 + c * BAY_WIDTH, 0, cz));
  }
  // The back wall is the one away from the track.
  g.add(block(palette.brick, width + 0.12, WALL_HEIGHT, 0.12, cx, 0, cz + (s.away * depth) / 2));
  for (const bay of s.bays) {
    if (!bay.crew) continue;
    const crew = kit.make("crew");
    crew.scale.setScalar(CREW_SCALE);
    // Nose to the track.
    crew.rotation.y = (s.away * Math.PI) / 2;
    crew.position.set(bay.at.x, 0.08, bay.at.z);
    crew.userData.bead = bay.crew;
    crew.userData.crew = true;
    g.add(crew);
    beads.push(crew);
  }
  return g;
}

function signalBox(x: number, z: number): THREE.Object3D {
  const g = new THREE.Group();
  g.add(block(palette.brick, 3, 1.6, 2.2, x, 0, z));
  g.add(block(palette.cream, 3.3, 1.2, 2.5, x, 1.6, z));
  g.add(block(palette.slate, 3.8, 0.3, 3, x, 2.8, z));
  return g;
}

export function draw(l: Layout, kit: Kit): Picture {
  const root = new THREE.Group();
  const beads: THREE.Object3D[] = [];
  const bounds = new THREE.Box3();
  const rails = new Rails();
  const grow = (x: number, z: number) => bounds.expandByPoint(new THREE.Vector3(x, 0, z));

  for (const b of l.boards) {
    root.add(block(palette.ballast, b.width, -GROUND_Y, b.depth, b.at.x + b.width / 2, GROUND_Y, b.at.z + b.depth / 2));
    root.add(label(b.depot, "depot", b.at.x + 1, 0, b.at.z + 2, [0, 0.5]));
    grow(b.at.x, b.at.z);
    grow(b.at.x + b.width, b.at.z + b.depth);
  }

  for (const t of l.tracks) {
    rails.run(t.at, t.length);
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
    root.add(block(p.terminal ? palette.cream : palette.platform, PLATFORM_LENGTH, PLATFORM_HEIGHT, PLATFORM_WIDTH, p.at.x, 0, p.at.z));
    // On the platform's edge away from its track, at its right end: in the
    // middle it would cover the wagons behind it, further left the sheds' names.
    const edge = p.at.z + (p.siding ? -1 : 1) * (PLATFORM_WIDTH / 2);
    root.add(label(p.stage, p.siding ? "stage siding" : "stage", p.at.x + 3.2, 0, edge));
    if (p.signal) root.add(signal(p.at.x + PLATFORM_LENGTH / 2 - 0.4, p.at.z));
  }

  // A shed's name is on its side away from the track, clear of its bays; a
  // platform's second shed has it a line further out, clear of the first's.
  const beside = new Map<string, number>();
  for (const s of l.sheds) {
    const n = beside.get(s.platform) ?? 0;
    beside.set(s.platform, n + 1);
    root.add(shed(s, kit, beads));
    const text = s.people ? s.group : `${s.group} · ${s.limit}`;
    const out = BAY_DEPTH / 2 + 0.3 + (n % 2) * 1.3;
    root.add(label(text, "group", s.at.x - BAY_WIDTH / 2, 0, s.at.z + s.away * out, [0, s.away > 0 ? 0 : 1]));
  }

  for (const v of l.vehicles) {
    const model = v.kind === "locomotive" ? kit.make("locomotive") : kit.make("wagon", hash(v.bead.id));
    model.position.set(v.at.x, 0, v.at.z);
    model.userData.bead = v.bead;
    root.add(model);
    beads.push(model);
  }
  for (const c of l.counts) {
    root.add(label(`+${c.more}${c.of === "beads" ? "" : ` ${c.of}`}`, "count", c.at.x, 1.6, c.at.z, [1, 0.5]));
  }

  for (const b of l.boxes) {
    root.add(signalBox(b.at.x, b.at.z));
    root.add(label(b.name, "crew", b.at.x, 3.4, b.at.z, [0.5, 1]));
    grow(b.at.x - 2, b.at.z - 2);
    grow(b.at.x + 2, b.at.z + 2);
  }

  // The telegraph wire, on poles.
  const wire = l.wire;
  root.add(block(palette.slate, wire.length, 0.06, 0.06, wire.at.x + wire.length / 2, POLE_HEIGHT - 0.2, wire.at.z));
  for (let x = 0; x <= wire.length; x += POLE_PITCH) {
    root.add(block(palette.slate, 0.16, POLE_HEIGHT, 0.16, wire.at.x + x, GROUND_Y, wire.at.z));
    root.add(block(palette.slate, 0.12, 0.12, 1.2, wire.at.x + x, POLE_HEIGHT - 0.3, wire.at.z));
  }
  root.add(label("hooks", "wire", wire.at.x + 1, POLE_HEIGHT, wire.at.z, [0, 1]));
  grow(wire.at.x, wire.at.z);

  for (const p of l.peers) {
    rails.run(p.at, p.length);
    root.add(block(palette.ballast, p.length, -GROUND_Y - 0.02, 1.6, p.at.x + p.length / 2, GROUND_Y, p.at.z));
    root.add(block(palette.cream, 2.4, 0.9, 0.2, p.at.x + 2, 1.2, p.at.z - 1.2));
    root.add(block(palette.slate, 0.16, 1.2, 0.16, p.at.x + 2, 0, p.at.z - 1.2));
    root.add(label(`to ${p.name} →`, "peer", p.at.x + 2, 2.3, p.at.z - 1.2, [0.5, 1]));
    grow(p.at.x - 2, p.at.z - 3);
  }

  root.add(rails.build(kit.make("rail")));
  return { root, beads, bounds };
}

export function describe(bead: Bead, crew: boolean): string {
  const where = `${bead.depot} · ${bead.type} · ${bead.stage}`;
  return crew ? `${bead.id} — session of ${bead.group ?? "?"}\n${bead.title}\n${where}` : `${bead.id}\n${bead.title}\n${where}`;
}
