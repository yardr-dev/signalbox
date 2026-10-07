// Draws a layout: the kit's rails, wagons and locomotives, and boxes in the
// palette for the rest. Nothing here decides where a thing is; layout.ts did.
// draw is what stands still: the structure, the same through a replay. Stock
// is what moves: wagons, crews and counts, shown again for every state.

import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { lamp, palette, type Kit } from "./kit";
import {
  BAY_COLUMNS,
  BAY_DEPTH,
  BAY_WIDTH,
  BOARD_X,
  PEER_RAIL_Z,
  PLATFORM_LENGTH,
  SIDING_Z,
  type Layout,
  type Point,
  type Shed,
} from "./layout";
import { along, brake, ease, exit, goods, goodsSeconds, GOODS_STAND, headway, measure, pull, route, seconds, TWEEN_MIN, type Stop } from "./motion";
import type { Bead } from "./yard";

// Heights, and the few sizes layout.ts has no say in.
const GROUND_Y = -0.3;
const PLATFORM_HEIGHT = 0.45;
const PLATFORM_WIDTH = 1.4;
const WALL_HEIGHT = 0.6;
const POLE_PITCH = 12;
const POLE_HEIGHT = 3.2;
const CREW_SCALE = 0.7;
const BAY_Y = 0.08;
// A peer's goods by the kind of the message: the kit's wagon and its size. A
// ping is the lighter wagon: the kit has no empty flat, so it is the box van
// small.
const GOODS: Record<string, [pick: number, size: number]> = { mail: [0, 1], bead: [1, 1], ping: [0, 0.65] };
const GOODS_LABEL_Y = 2.1;
// The seconds the wire stays lit after a hook.
const FLASH = 0.6;

export interface Picture {
  root: THREE.Group;
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
function shed(s: Shed): THREE.Object3D {
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
    root.add(shed(s));
    const text = s.people ? s.group : `${s.group} · ${s.limit}`;
    const out = BAY_DEPTH / 2 + 0.3 + (n % 2) * 1.3;
    root.add(label(text, "group", s.at.x - BAY_WIDTH / 2, 0, s.at.z + s.away * out, [0, s.away > 0 ? 0 : 1]));
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
    // A rail each way: out on the near one, in on the far one.
    rails.run({ x: p.at.x, z: p.at.z + PEER_RAIL_Z }, p.length);
    rails.run({ x: p.at.x, z: p.at.z - PEER_RAIL_Z }, p.length);
    root.add(block(palette.ballast, p.length, -GROUND_Y - 0.02, 1.6 + 2 * PEER_RAIL_Z, p.at.x + p.length / 2, GROUND_Y, p.at.z));
    // The sign, behind the far rail.
    root.add(block(palette.cream, 2.4, 0.9, 0.2, p.at.x + 2, 1.2, p.at.z - 2));
    root.add(block(palette.slate, 0.16, 1.2, 0.16, p.at.x + 2, 0, p.at.z - 2));
    root.add(label(`to ${p.name} →`, "peer", p.at.x + 2, 2.3, p.at.z - 2, [0.5, 1]));
    grow(p.at.x - 2, p.at.z - 3);
  }

  root.add(rails.build(kit.make("rail")));
  return { root, bounds };
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
}

interface Engine extends Mover {
  // Where it is, or is going.
  at: Point;
  home: Point;
  away: 1 | -1;
}

export interface Show {
  // Move to the new places, or stand there at once (a scrub, the first view).
  tween: boolean;
  // The beads that left for good: they roll out past the buffer.
  left?: ReadonlySet<string>;
}

// The moving stock. show takes a layout and brings every wagon, crew and
// count to where it has them; tick moves what is on its way.
export class Stock {
  readonly root = new THREE.Group();
  // What the pointer can ask about, each with userData.bead.
  beads: THREE.Object3D[] = [];

  private readonly wagons = new Map<string, Wagon>();
  private readonly crews = new Map<string, Engine>();
  private readonly leaving = new Set<Mover>();
  // The seconds ticked so far, and when the last goods started, by line and
  // direction: the next keep their headway.
  private clock = 0;
  private readonly started = new Map<string, number>();
  private readonly counts = new THREE.Group();
  private readonly lit: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private layout: Layout;

  constructor(
    l: Layout,
    private readonly kit: Kit,
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
    this.root.add(this.counts, this.lit);
    this.show(l, { tween: false });
  }

  show(l: Layout, how: Show) {
    this.layout = l;
    // Nothing is on its way any more: every move is at its end.
    if (!how.tween) this.tick(Infinity);

    const tracks = new Map(l.tracks.map((t) => [t.key, t]));
    const sidings = new Map(l.sidings.map((t) => [t.key, t]));
    const platforms = new Map(l.platforms.map((p) => [p.key, p]));
    const standing = new Set<string>();
    for (const v of l.vehicles) {
      standing.add(v.key);
      const platform = platforms.get(v.platform);
      const track = platform && tracks.get(`${platform.depot}/${platform.flow}`);
      const mouth = sidings.get(v.platform)?.at;
      const stop: Stop = {
        at: v.at,
        line: track?.at.z ?? v.at.z,
        end: track ? track.at.x + track.length : v.at.x,
        ...(mouth !== undefined ? { mouth } : {}),
      };
      let wagon = this.wagons.get(v.key);
      if (!wagon) {
        const object = v.kind === "locomotive" ? this.kit.make("locomotive") : this.kit.make("wagon", hash(v.bead.id));
        wagon = { object, size: 1, stop };
        this.wagons.set(v.key, wagon);
        this.root.add(object);
        // New to the picture: it grows where it stands.
        this.send(wagon, [v.at], { size: [0, 1], seconds: TWEEN_MIN }, how.tween);
      } else if (wagon.stop.at.x !== v.at.x || wagon.stop.at.z !== v.at.z) {
        this.send(wagon, route(wagon.stop, stop), {}, how.tween);
      }
      wagon.stop = stop;
      wagon.object.userData.bead = v.bead;
    }
    for (const [key, wagon] of this.wagons) {
      if (standing.has(key)) continue;
      this.wagons.delete(key);
      const out = how.left?.has(key) === true;
      this.send(wagon, out ? exit(wagon.stop) : [wagon.stop.at], { size: [1, 0], last: true, ...(out ? {} : { seconds: TWEEN_MIN }) }, how.tween);
    }

    const out = new Set<string>();
    for (const c of l.crews) {
      out.add(c.key);
      const y = c.out ? PLATFORM_HEIGHT : BAY_Y;
      // In its bay it stands nose to the track; out, along its wagon.
      const turn = c.out ? 0 : (c.away * Math.PI) / 2;
      let crew = this.crews.get(c.key);
      if (!crew) {
        const object = this.kit.make("crew");
        object.userData.crew = true;
        crew = { object, size: CREW_SCALE, at: c.home, home: c.home, away: c.away };
        this.crews.set(c.key, crew);
        this.root.add(object);
        object.position.set(c.home.x, BAY_Y, c.home.z);
        object.rotation.y = (c.away * Math.PI) / 2;
        object.scale.setScalar(CREW_SCALE);
      }
      crew.home = c.home;
      if (crew.at.x !== c.at.x || crew.at.z !== c.at.z) {
        const at = crew.object.position;
        this.send(crew, [{ x: at.x, z: at.z }, c.at], { y: [at.y, y], turn: [crew.object.rotation.y, turn] }, how.tween);
      }
      crew.at = c.at;
      crew.object.userData.bead = c.bead;
    }
    for (const [key, crew] of this.crews) {
      if (out.has(key)) continue;
      this.crews.delete(key);
      // The session is over: back into its bay, and out of sight there.
      const at = crew.object.position;
      this.send(
        crew,
        [{ x: at.x, z: at.z }, crew.home],
        { y: [at.y, BAY_Y], turn: [crew.object.rotation.y, (crew.away * Math.PI) / 2], last: true },
        how.tween,
      );
    }

    this.counts.clear();
    for (const c of l.counts) {
      this.counts.add(label(`+${c.more}${c.of === "beads" ? "" : ` ${c.of}`}`, "count", c.at.x, 1.6, c.at.z, [1, 0.5]));
    }
    this.beads = [...this.wagons.values(), ...this.crews.values()].map((m) => m.object);
  }

  // Goods on a peer's line: out to the peer past the yard's edge, or in from
  // there to the yard's end, where they stand a moment. kind is the
  // message's (mail, ping, bead), speed the replay's.
  goods(peer: string, way: "out" | "in", kind: string | undefined, speed: number) {
    const line = this.layout.peers.find((p) => p.name === peer);
    if (!line) return;
    const wire = this.layout.wire;
    const [pick, size] = GOODS[kind ?? ""] ?? GOODS.mail!;
    const wagon: Mover = { object: this.kit.make("wagon", pick), size };
    wagon.object.add(label(kind !== undefined ? `${kind} · ${peer}` : peer, "goods", 0, GOODS_LABEL_Y / size, 0, [0.5, 1]));
    this.root.add(wagon.object);
    const key = `${peer}/${way}`;
    const wait = headway(this.clock, this.started.get(key));
    this.started.set(key, this.clock + wait);
    this.send(
      wagon,
      goods(line, wire.at.x + wire.length, way),
      {
        size: [1, 1],
        seconds: goodsSeconds(speed),
        elapsed: -wait,
        ease: way === "out" ? pull : brake,
        stand: way === "out" ? 0 : GOODS_STAND,
        fade: TWEEN_MIN,
        last: true,
      },
      true,
    );
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
    if (move.last) {
      this.leaving.delete(m);
      // A label is an element of the page: it goes with its object.
      m.object.traverse((o) => {
        if (o instanceof CSS2DObject) o.element.remove();
      });
      this.root.remove(m.object);
    }
  }

  // Move everything on by a time in seconds. True while anything still moves.
  tick(dt: number): boolean {
    // Everything put at its end: no goods are left to keep a headway from.
    if (Number.isFinite(dt)) this.clock += dt;
    else this.started.clear();
    let moving = false;
    for (const m of [...this.wagons.values(), ...this.crews.values(), ...this.leaving]) {
      if (!m.move) continue;
      m.move.elapsed += dt;
      this.pose(m);
      moving = true;
    }
    if (this.lit.visible) {
      this.lit.material.opacity -= dt / FLASH;
      this.lit.visible = this.lit.material.opacity > 0;
      moving = true;
    }
    return moving;
  }
}

export function describe(bead: Bead, crew: boolean): string {
  const where = `${bead.depot} · ${bead.type} · ${bead.stage}${bead.hold === true ? " · held" : ""}`;
  return crew ? `${bead.id} — session of ${bead.group ?? "?"}\n${bead.title}\n${where}` : `${bead.id}\n${bead.title}\n${where}`;
}
