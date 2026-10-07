// The models, all Kenney's and CC0, each pack with its licence beside it in
// public/kit: the Train Kit for rails, wagons, locomotives and shunters,
// City Kit Industrial (city/) for the groups' buildings and the providers'
// silos, Mini Characters (people/) for the figures. loadKit is the only way in; everything it hands out lies or
// looks along +x (a building's door looks up the page, to -z), stands on the
// ground and is centred, in the Train Kit's units, so another set of models
// drops in here and nowhere else. A model that does not load is a box of the
// palette instead, and the page still draws.
//
// None is drawn in its own colours: the packs paint a model from a texture
// they share, and flat sorts its faces into the palette's tones instead
// (palette.ts), so the yard is one flat picture.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { hat, paint, type Tone } from "./palette";

export type Part = "rail" | "wagon" | "locomotive" | "shunter" | "station" | "hut" | "office" | "works" | "silo";
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
  wagon: [
    "train-carriage-box",
    "train-carriage-container-blue",
    "train-carriage-container-green",
    "train-carriage-container-red",
    "train-carriage-coal",
    "train-carriage-tank",
    "train-carriage-wood",
  ],
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

// Length, height, width of the box that stands in for a part.
const boxes: Record<Part, [number, number, number, Tone]> = {
  rail: [1, 0.12, 0.8, "track"],
  wagon: [2.7, 1.3, 1.2, "roof"],
  locomotive: [2.6, 1.6, 1.3, "slate"],
  shunter: [2.4, 1.6, 1.2, "slate"],
  station: [3.2, 1.3, 1.4, "wall"],
  hut: [2, 1.4, 2.4, "wall"],
  office: [2.9, 1.2, 1.7, "wall"],
  works: [2, 2.2, 2.5, "pale"],
  silo: [3.6, SILO_HEIGHT, 3.6, "wall"],
};

function box(part: Part): THREE.Object3D {
  const [length, height, width, tone] = boxes[part];
  const group = new THREE.Group().add(block(tone, length, height, width, 0));
  if (part === "silo") {
    // A silo's box has the band its provider's colour goes on.
    const band = block("slate", length + 0.1, height / 4, width + 0.1, height / 4);
    band.material = accent();
    return group.add(band);
  }
  if (part !== "works") return group;
  // A works smokes: its box has a stub of a chimney on the roof.
  const stub = block("roof", STUB, STUB, STUB, height);
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
export const TINT = "tint";
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

// One of the packs' colours as a tone: by how light it is, whatever its hue.
// White and the palest are a wall, and the darkest slate, so a model keeps
// its own lights and darks and loses its colours.
const LIGHT: [above: number, tone: Tone][] = [
  [0.8, "wall"],
  [0.55, "pale"],
  [0.3, "roof"],
];
export function toned(red: number, green: number, blue: number): Tone {
  const light = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return LIGHT.find(([above]) => light > above)?.[1] ?? "slate";
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
    console.warn("kit: a texture could not be read, its models are one tone", err);
  }
  read.set(map.source, texel);
  return texel;
}

// The tone of a face of a model, by the colour its texture has there. Glass
// is the packs' second material, and a tone of its own beside a wall; a
// model whose texture cannot be read is all of one tone.
function texture(u: number, v: number, wears: THREE.Material): Tone {
  if (wears.name.endsWith("specular")) return "pale";
  const { map } = wears as THREE.MeshStandardMaterial;
  const texel = map ? texels(map) : undefined;
  return texel ? toned(...texel(u, v)) : "pale";
}

// A part's faces by its texture, each part in its own way. Rail is the
// track's tone with its rails dark on it. What rolls is a tone darker than
// what stands, so a wagon is seen before a building and on a platform.
const DARKER: Partial<Record<Tone, Tone>> = { wall: "pale", pale: "roof", roof: "slate" };
const ROLLS = new Set<Part>(["wagon", "locomotive", "shunter"]);
function textured(part: Part): (u: number, v: number, wears: THREE.Material) => Tone {
  return (u, v, wears) => {
    const tone = texture(u, v, wears);
    if (part === "rail") return tone === "slate" || tone === "roof" ? "slate" : "track";
    return ROLLS.has(part) ? (DARKER[tone] ?? tone) : tone;
  };
}

// Paint a model flat: every face in the palette's paint of the tone that
// tone names for it, by the middle of the face on its texture and the
// material it wore. The faces are sorted by their paint, a material of the
// mesh for each. A face the scene paints itself (TINT) stays as it is.
export function flat(model: THREE.Object3D, tone: (u: number, v: number, wears: THREE.Material) => Tone = texture) {
  model.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    part.castShadow = part.receiveShadow = true;
    const geometry = part.geometry as THREE.BufferGeometry;
    const uv = geometry.getAttribute("uv");
    const index = geometry.getIndex();
    const corners = index ? index.count : (geometry.getAttribute("position")?.count ?? 0);
    const corner = (i: number) => (index ? index.getX(i) : i);
    const wears = [part.material].flat() as THREE.Material[];
    const runs = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: corners, materialIndex: 0 }];
    const sorted = new Map<THREE.Material, number[]>();
    for (const run of runs) {
      const own = wears[run.materialIndex ?? 0];
      if (!own) continue;
      for (let i = run.start; i + 2 < Math.min(run.start + run.count, corners); i += 3) {
        const face = [corner(i), corner(i + 1), corner(i + 2)];
        const middle = (of: "getX" | "getY") => (uv ? face.reduce((sum, c) => sum + uv[of](c), 0) / 3 : 0);
        const wear = own.name === TINT ? own : paint(tone(middle("getX"), middle("getY"), own));
        const faces = sorted.get(wear) ?? [];
        sorted.set(wear, faces);
        faces.push(...face);
      }
    }
    if (sorted.size === 0) return;
    geometry.setIndex([...sorted.values()].flat());
    geometry.clearGroups();
    let start = 0;
    [...sorted.values()].forEach((faces, n) => {
      geometry.addGroup(start, faces.length, n);
      start += faces.length;
    });
    part.material = [...sorted.keys()];
  });
}

function block(of: Tone | number, width: number, height: number, depth: number, y: number): THREE.Mesh {
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
function wear(figure: THREE.Object3D, colour: Tone) {
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
    flat(model, textured(part));
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
    flat(file.scene);
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
