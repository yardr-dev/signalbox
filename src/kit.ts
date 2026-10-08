// The models, all Kenney's and CC0, each pack with its licence beside it in
// public/kit: the Train Kit for rails, wagons, locomotives and shunters,
// City Kit Industrial (city/) for the groups' buildings and the providers'
// silos, Mini Characters (people/) for the figures. loadKit is the only way in; everything it hands out lies or
// looks along +x (a building's door looks up the page, to -z), stands on the
// ground and is centred, in the Train Kit's units, so another set of models
// drops in here and nowhere else. A model that does not load is a box of the
// palette instead, and the page still draws.
//
// The packs paint a model from a texture they share, and a model wears it
// here as it came: the kit's own iron, white, glass and dark. Only where the
// pack had painted a face in a colour (COLOUR says which) is it painted
// again, by accented: in an accent of the palette (palette.ts), or left for
// the scene to paint (TINT). A figure is the pack's own altogether. The rails
// alone are painted flat, in the track's tone: they are the ribbon a track
// reads as.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { building, hat, paint, type Accent, type Tone } from "./palette";

export type Part = "rail" | "wagon" | "van" | "locomotive" | "shunter" | "station" | "hut" | "office" | "works" | "silo";
export type Outfit = "builder" | "reviewer" | "crew";
// What a figure can be seen doing: the pack's idle, walk, interact-right and
// sit.
export type Clip = "idle" | "walk" | "work" | "sit";

// A figure of its own: its bones are not shared with the next one. A box
// figure has no clips and stands as it is.
export interface Figure {
  object: THREE.Object3D;
  clips: Partial<Record<Clip, THREE.AnimationClip>>;
}

export interface Kit {
  // A fresh copy of a part. Wagons come in several kinds; pick is any number
  // and the same number gives the same kind.
  make(part: Part, pick?: number): THREE.Object3D;
  // A figure in an outfit; pick as for a part.
  figure(outfit: Outfit, pick?: number): Figure;
}

const files: Record<Part, string[]> = {
  // One unit of track, to be laid end to end.
  rail: ["track"],
  // What a bead rides in: the kinds the pack painted a colour, which is
  // where the bead's goes. A container's box, a tank's barrel, a load of logs.
  wagon: [
    "train-carriage-container-blue",
    "train-carriage-container-green",
    "train-carriage-container-red",
    "train-carriage-tank",
    "train-carriage-wood",
  ],
  // The kinds that are iron all over, with no face for a bead's colour: they
  // carry a peer's goods.
  van: ["train-carriage-box", "train-carriage-coal"],
  locomotive: ["train-locomotive-a"],
  // The engine that moves the wagons: a track's, or a peer's line's.
  shunter: ["train-diesel-a"],
  // The plainest long building, a small warehouse, a small office, a factory
  // with its chimneys.
  station: ["city/building-s"],
  hut: ["city/building-i"],
  office: ["city/building-p"],
  works: ["city/building-m"],
  // The pack's large tank: a drum with a band round it.
  silo: ["city/detail-tank-large"],
};

// The tank is 0.96 of the pack's units high: a silo a little lower than a
// signal box, and as wide as one.
const SILO_SIZE = 2.6;
// The height a silo stands to, model or box.
export const SILO_HEIGHT = 0.96 * SILO_SIZE;

// A building as its file has it: the turn that brings its door to -z, and
// the size that sets it beside a wagon.
const buildings: Partial<Record<Part, [turn: number, size: number]>> = {
  station: [0, 1.5],
  hut: [0, 1.9],
  office: [0, 1.7],
  works: [0, 1.5],
  silo: [0, SILO_SIZE],
};

// The pack's figures by outfit: for a crew the ones a hard hat sits on, with
// no hair above the head. Its only things to carry are aids (canes, glasses,
// a crutch), so a reviewer has nothing in hand: the hat says who is who. The
// crew member is the one in a peaked cap.
const figures: Record<Outfit, string[]> = {
  builder: ["people/character-male-e", "people/character-female-f"],
  reviewer: ["people/character-male-a"],
  crew: ["people/character-male-c"],
};
const clips: Record<Clip, string> = { idle: "idle", walk: "walk", work: "interact-right", sit: "sit" };
// A figure is 0.67 of the pack's units tall: about a wagon's height here, so
// it reads from the whole yard.
const FIGURE_SIZE = 2;
const FIGURE_HEIGHT = 1.35;

// The name of a material the scene replaces with a colour of its own: a
// silo's band, by its provider, and the body of what carries a bead, by the
// bead.
export const TINT = "tint";

// Length, height, width of the box that stands in for a part.
// A building's is in its walls' accent, what a bead rides in is the scene's
// to paint, and what carries none is a tone.
const boxes: Record<Part, [number, number, number, Tone | Accent | typeof TINT]> = {
  rail: [1, 0.12, 0.8, "track"],
  wagon: [2.7, 1.3, 1.2, TINT],
  van: [2.7, 1.3, 1.2, "roof"],
  locomotive: [2.6, 1.6, 1.3, TINT],
  shunter: [2.4, 1.6, 1.2, "slate"],
  station: [3.2, 1.3, 1.4, building.station[0]],
  hut: [2, 1.4, 2.4, building.hut[0]],
  office: [2.9, 1.2, 1.7, building.office[0]],
  works: [2, 2.2, 2.5, building.works[0]],
  silo: [3.6, SILO_HEIGHT, 3.6, building.silo[0]],
};

function box(part: Part): THREE.Object3D {
  const [length, height, width, wears] = boxes[part];
  const body = block(wears === TINT ? "slate" : wears, length, height, width, 0);
  if (wears === TINT) body.material = accent();
  const group = new THREE.Group().add(body);
  if (part === "silo") {
    // A silo's box has the band its provider's colour goes on.
    const band = block("slate", length + 0.1, height / 4, width + 0.1, height / 4);
    band.material = accent();
    return group.add(band);
  }
  if (part !== "works") return group;
  // A works smokes: its box has a stub of a chimney on the roof.
  const stub = block(building.works[1], STUB, STUB, STUB, height);
  stub.position.x = length / 4;
  group.userData[CHIMNEY] = [length / 4, height + STUB, 0];
  return group.add(stub);
}

// A works says where its chimney's mouth is, from its own middle on the
// ground: userData[CHIMNEY], as [x, y, z]. A plain list, so a copy has it too.
export const CHIMNEY = "chimney";
const STUB = 0.5;

// The mouth of a model's chimney: the middle of what stands highest on it.
// Of several stacks of one height it is the one nearest the middle of them
// all, not the air between two.
function chimney(model: THREE.Object3D): [number, number, number] | undefined {
  const all: THREE.Vector3[] = [];
  model.updateMatrixWorld(true);
  model.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    const at = (part.geometry as THREE.BufferGeometry).getAttribute("position");
    for (let i = 0; at && i < at.count; i++) all.push(new THREE.Vector3().fromBufferAttribute(at, i).applyMatrix4(part.matrixWorld));
  });
  const height = Math.max(0, ...all.map((v) => v.y));
  const top = all.filter((v) => v.y > height * 0.99);
  if (top.length === 0) return undefined;
  const mean = (of: THREE.Vector3[]) => of.reduce((sum, v) => sum.add(v), new THREE.Vector3()).divideScalar(of.length);
  const middle = mean(top);
  const nearest = top.reduce((a, b) => (a.distanceTo(middle) <= b.distanceTo(middle) ? a : b));
  // A stack is narrow beside its building: a tenth of its height across.
  const mouth = mean(top.filter((v) => v.distanceTo(nearest) < height / 10));
  return [mouth.x, mouth.y, mouth.z];
}

// The pack's models have one material, a palette texture, and a part's
// colour is where its corners lie on it. The accent, the orange of a tank's
// band, is this column of it, above the middle. A tint cannot go on the
// texture, which every model shares: the faces that lie there become a
// second material of the mesh, by the name of TINT, for the scene to replace
// with a colour of its own.
const ACCENT_U = 0.719;
function accent(): THREE.MeshStandardMaterial {
  const tint = new THREE.MeshStandardMaterial({ color: 0xff9f38, roughness: 0.95 });
  tint.name = TINT;
  return tint;
}
export function banded(model: THREE.Object3D) {
  model.traverse((part) => {
    if (!(part instanceof THREE.Mesh) || Array.isArray(part.material)) return;
    const geometry = part.geometry as THREE.BufferGeometry;
    const uv = geometry.getAttribute("uv");
    const index = geometry.getIndex();
    if (!uv || !index) return;
    const own: number[] = [];
    const band: number[] = [];
    for (let i = 0; i + 2 < index.count; i += 3) {
      const corners = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const lies = corners.every((c) => Math.abs(uv.getX(c) - ACCENT_U) < 0.05 && uv.getY(c) < 0.5);
      (lies ? band : own).push(...corners);
    }
    if (band.length === 0) return;
    geometry.setIndex([...own, ...band]);
    geometry.clearGroups();
    geometry.addGroup(0, own.length, 0);
    geometry.addGroup(own.length, band.length, 1);
    part.material = [part.material, accent()];
  });
}

// How light one of the packs' colours is, of 1.
function light(red: number, green: number, blue: number): number {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

// One of the packs' colours as a tone: by how light it is, whatever its hue.
// White and the palest are a wall, and the darkest slate, so a model keeps
// its own lights and darks and loses its colours.
const LIGHT: [above: number, tone: Tone][] = [
  [0.8, "wall"],
  [0.55, "pale"],
  [0.3, "roof"],
];
export function toned(red: number, green: number, blue: number): Tone {
  const is = light(red, green, blue);
  return LIGHT.find(([above]) => is > above)?.[1] ?? "slate";
}

// A colour of the packs' own, or one of their neutrals: by its saturation,
// the gap between the most and the least of its red, green and blue as a
// part of the most. The packs' texture is swatches, and they lie apart on
// this: white, the irons, the darks, the pale glass and the creams are 0.38
// at most, and every swatch that is a colour 0.48 at least: the reds and
// oranges, yellow, green, the blues, purple and pink, and the browns of wood
// and brick with them, which no saturation parts from a blue. COLOUR is
// between the two. A swatch that fades from a neutral into a colour (glass
// into blue, skin into tan) is parted where it crosses.
export const COLOUR = 0.45;
export function coloured(red: number, green: number, blue: number): boolean {
  const most = Math.max(red, green, blue);
  return most > 0 && (most - Math.min(red, green, blue)) / most > COLOUR;
}

// Where a colour is on the wheel, of 1 all round, and how far two such are
// apart. A swatch of the packs fades within a hue: two faces this near are of
// one colour of a model, and two further apart of two.
const HUE = 1 / 8;
function hue(red: number, green: number, blue: number): number {
  const most = Math.max(red, green, blue);
  const gap = most - Math.min(red, green, blue);
  if (gap === 0) return 0;
  const sixth = most === red ? ((green - blue) / gap + 6) % 6 : most === green ? (blue - red) / gap + 2 : (red - green) / gap + 4;
  return sixth / 6;
}
function round(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

// A texture's colours by where a corner lies on it, read once for each
// image. None where the page cannot read it.
type Texel = (u: number, v: number) => [number, number, number];
const read = new WeakMap<object, Texel | undefined>();
function texels(map: THREE.Texture): Texel | undefined {
  if (read.has(map.source)) return read.get(map.source);
  let texel: Texel | undefined;
  try {
    const image = map.image as CanvasImageSource & { width: number; height: number };
    const { width, height } = image;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const pen = canvas.getContext("2d", { willReadFrequently: true })!;
    pen.drawImage(image, 0, 0);
    const { data } = pen.getImageData(0, 0, width, height);
    // A model's file has its texture the way up its corners count: v from
    // the top.
    const pixel = (t: number, size: number) => Math.min(size - 1, Math.floor((t - Math.floor(t)) * size));
    texel = (u, v) => {
      const i = 4 * (pixel(v, height) * width + pixel(u, width));
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    };
  } catch (err) {
    console.warn("kit: a texture could not be read, its models are as the pack has them", err);
  }
  read.set(map.source, texel);
  return texel;
}

// The colour the pack painted a face, by the middle of it on its texture.
// None where the texture cannot be read.
function texture(u: number, v: number, wears: THREE.Material): [number, number, number] | undefined {
  const { map } = wears as THREE.MeshStandardMaterial;
  return map ? texels(map)?.(u, v) : undefined;
}

// What a face is painted in: a tone or an accent of the palette, or TINT for
// the scene to say.
export type Wear = Tone | Accent | typeof TINT;

// A rail's faces: the track's tone, with what the pack had dark, its rails,
// dark on it. A rail whose texture cannot be read is all the track's.
function sleeper(u: number, v: number, wears: THREE.Material): Wear {
  const tone = toned(...(texture(u, v, wears) ?? [255, 255, 255]));
  return tone === "slate" || tone === "roof" ? "slate" : "track";
}

// What the faces the pack painted a colour are painted in here, for each
// part that wears its texture: the first for the lightest of a model's
// colours, the second for any other it has. A building's are its kind's
// walls' and roof's (palette.ts). What carries a bead leaves them all to the
// scene, which paints them by the bead. An engine and a van carry none, and
// the pack's yellow would be a wagon's lamp from far out: they are overlay,
// Catppuccin's grey.
const trims: Record<Exclude<Part, "rail">, readonly [Wear, Wear]> = {
  wagon: [TINT, TINT],
  locomotive: [TINT, TINT],
  van: ["overlay", "overlay"],
  shunter: ["overlay", "overlay"],
  station: building.station,
  hut: building.hut,
  office: building.office,
  works: building.works,
  silo: building.silo,
};

// The faces of a mesh, each by its corners, the middle of them on the
// texture and the material it wears.
function* faces(part: THREE.Mesh): Generator<{ face: number[]; u: number; v: number; own: THREE.Material }> {
  const geometry = part.geometry as THREE.BufferGeometry;
  const uv = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  const corners = index ? index.count : (geometry.getAttribute("position")?.count ?? 0);
  const corner = (i: number) => (index ? index.getX(i) : i);
  const wears = [part.material].flat() as THREE.Material[];
  const runs = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: corners, materialIndex: 0 }];
  for (const run of runs) {
    const own = wears[run.materialIndex ?? 0];
    if (!own) continue;
    for (let i = run.start; i + 2 < Math.min(run.start + run.count, corners); i += 3) {
      const face = [corner(i), corner(i + 1), corner(i + 2)];
      const middle = (of: "getX" | "getY") => (uv ? face.reduce((sum, c) => sum + uv[of](c), 0) / 3 : 0);
      yield { face, u: middle("getX"), v: middle("getY"), own };
    }
  }
}

// Give every face of a model the material wear names for it. The faces are
// sorted by it, a material of the mesh for each, and every part throws and
// takes the yard's one shadow.
function sorted(model: THREE.Object3D, wear: (u: number, v: number, own: THREE.Material) => THREE.Material) {
  model.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    part.castShadow = part.receiveShadow = true;
    const by = new Map<THREE.Material, number[]>();
    for (const { face, u, v, own } of faces(part)) {
      const wears = wear(u, v, own);
      const all = by.get(wears) ?? [];
      by.set(wears, all);
      all.push(...face);
    }
    if (by.size === 0) return;
    const geometry = part.geometry as THREE.BufferGeometry;
    geometry.setIndex([...by.values()].flat());
    geometry.clearGroups();
    let start = 0;
    [...by.values()].forEach((all, n) => {
      geometry.addGroup(start, all.length, n);
      start += all.length;
    });
    part.material = [...by.keys()];
  });
}

// Leave a model in the pack's texture, and paint again only the faces the
// pack had painted a colour (coloured): in first where they are of the
// lightest of the model's colours, in other where of another hue, a paint of
// the palette or, for TINT, one material for the scene to replace. Glass,
// the packs' second material, and a face that is the scene's already (a
// silo's band) stay as they are, and so does a model whose texture cannot be
// read.
export function accented(model: THREE.Object3D, [first, other]: readonly [Wear, Wear]) {
  const colour = (u: number, v: number, own: THREE.Material) => {
    if (own.name === TINT || own.name.endsWith("specular")) return undefined;
    const is = texture(u, v, own);
    return is && coloured(...is) ? is : undefined;
  };
  let lightest: [number, number, number] | undefined;
  model.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    for (const { u, v, own } of faces(part)) {
      const is = colour(u, v, own);
      if (is && (!lightest || light(...is) > light(...lightest))) lightest = is;
    }
  });
  const tint = accent();
  const wears = (named: Wear) => (named === TINT ? tint : paint(named));
  sorted(model, (u, v, own) => {
    const is = colour(u, v, own);
    if (!is || !lightest) return own;
    return wears(round(hue(...is), hue(...lightest)) < HUE ? first : other);
  });
}

// Paint a model flat: every face in the palette's paint of what tone names
// for it, by the middle of the face on its texture and the material it
// wore. A face the scene paints itself (TINT) stays as it is, or becomes of
// one such material for the whole model.
export function flat(model: THREE.Object3D, tone: (u: number, v: number, wears: THREE.Material) => Wear) {
  const tint = accent();
  sorted(model, (u, v, own) => {
    const named = own.name === TINT ? TINT : tone(u, v, own);
    return named !== TINT ? paint(named) : own.name === TINT ? own : tint;
  });
}

function block(of: Tone | Accent | number, width: number, height: number, depth: number, y: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), paint(of));
  mesh.position.y = y + height / 2;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// The figure of two boxes: a body in its outfit's colour, and a head.
function boxFigure(outfit: Outfit): Figure {
  const body = FIGURE_HEIGHT * 0.6;
  const object = new THREE.Group();
  object.add(block(outfit === "crew" ? "slate" : hat[outfit], 0.4, body, 0.55, 0), block("wall", 0.45, FIGURE_HEIGHT - body, 0.45, body));
  return { object, clips: {} };
}

// A hard hat on a figure's head bone, in the pack's units: a shell over the
// top of the head, which ends 0.33 above the bone, and a crown on it. It is
// one part by the name of HAT: a figure that sits has it off.
export const HAT = "hat";
function wear(figure: THREE.Object3D, colour: number) {
  const head = figure.getObjectByName("head");
  if (!head) return;
  const shell = block(colour, 0.36, 0.07, 0.34, 0.3);
  const crown = block(colour, 0.26, 0.05, 0.24, 0.37);
  // The head is a little behind its bone.
  shell.position.z = crown.position.z = -0.02;
  const hat = new THREE.Group().add(shell, crown);
  hat.name = HAT;
  head.add(hat);
}

export async function loadKit(base: string): Promise<Kit> {
  const loader = new GLTFLoader().setPath(`${base}kit/`);
  const load = async (name: string) => {
    try {
      return await loader.loadAsync(`${name}.glb`);
    } catch (err) {
      console.warn(`kit: ${name} did not load, drawing a box`, err);
      return undefined;
    }
  };
  const part = async (part: Part, name: string): Promise<THREE.Object3D | undefined> => {
    const model = (await load(name))?.scene;
    if (!model) return undefined;
    // The Train Kit's models run along z; the yard's tracks along x.
    const [turn, size] = buildings[part] ?? [Math.PI / 2, 1];
    model.rotation.y = turn;
    model.scale.setScalar(size);
    const group = new THREE.Group().add(model);
    if (part === "silo") banded(model);
    if (part === "rail") flat(model, sleeper);
    else accented(model, trims[part]);
    const mouth = part === "works" ? chimney(group) : undefined;
    if (mouth) group.userData[CHIMNEY] = mouth;
    return group;
  };
  const person = async (name: string): Promise<Figure | undefined> => {
    const file = await load(name);
    if (!file) return undefined;
    // The pack's figures look along z.
    file.scene.rotation.y = Math.PI / 2;
    file.scene.scale.setScalar(FIGURE_SIZE);
    // In the pack's own colours, and under the yard's one sun and shadow.
    file.scene.traverse((part) => {
      if (part instanceof THREE.Mesh) part.castShadow = part.receiveShadow = true;
    });
    const found: Figure["clips"] = {};
    for (const [clip, name] of Object.entries(clips) as [Clip, string][]) {
      const animation = file.animations.find((a) => a.name === name);
      if (animation) found[clip] = animation;
    }
    return { object: new THREE.Group().add(file.scene), clips: found };
  };
  const parts = Object.keys(files) as Part[];
  const outfits = Object.keys(figures) as Outfit[];
  const [loaded, cast] = await Promise.all([
    Promise.all(parts.map((p) => Promise.all(files[p].map((name) => part(p, name))))),
    Promise.all(outfits.map((o) => Promise.all(figures[o].map(person)))),
  ]);
  const models = new Map<Part, (THREE.Object3D | undefined)[]>(parts.map((part, i) => [part, loaded[i] ?? []]));
  const people = new Map<Outfit, (Figure | undefined)[]>(outfits.map((outfit, i) => [outfit, cast[i] ?? []]));

  return {
    make(part, pick = 0) {
      const kinds = models.get(part) ?? [];
      const model = kinds[Math.abs(pick) % Math.max(kinds.length, 1)];
      return model ? model.clone() : box(part);
    },
    figure(outfit, pick = 0) {
      const kinds = people.get(outfit) ?? [];
      const model = kinds[Math.abs(pick) % Math.max(kinds.length, 1)];
      if (!model) return boxFigure(outfit);
      // A plain clone would move the first figure's bones.
      const object = cloneSkinned(model.object);
      if (outfit !== "crew") wear(object, hat[outfit]);
      return { object, clips: model.clips };
    },
  };
}
