// The models, all Kenney's and CC0, each pack with its licence beside it in
// public/kit: the Train Kit for rails, wagons, locomotives and shunters,
// City Kit Industrial (city/) for the groups' buildings, Mini Characters
// (people/) for the figures. loadKit is the only way in; everything it hands out lies or
// looks along +x (a building's door looks up the page, to -z), stands on the
// ground and is centred, in the Train Kit's units, so another set of models
// drops in here and nowhere else. A model that does not load is a box of the
// palette instead, and the page still draws.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

// The picture's own colours, for what the kits have no model for (ground,
// platforms, signals, signal boxes) and for a model that is missing.
export const palette = {
  grass: 0x9bc27a,
  ballast: 0xd8cdb4,
  platform: 0xa9abb0,
  brick: 0xb4533c,
  slate: 0x4f5a66,
  cream: 0xeadfb4,
} as const;

// Lamps and hard hats are outside the six: a hat is what tells a crew from
// the top of the yard, hi-vis for builders, white for reviewers.
// wait is the amber of a wagon that waits for another bead, out a lamp that
// is not lit.
export const lamp = { clear: 0x3fd46b, stop: 0xe0453a, wait: 0xffb020, out: 0x343b43 } as const;
// The grey of a works' smoke.
export const smoke = 0x6c7278;
// The iron of the coal in a tower.
export const iron = 0x2a2d31;
export const hat = { builder: 0xffd21f, reviewer: 0xffffff } as const;
// A lamp that flashes is dark between, and a wheel chock is its own orange.
export const fault = { dark: 0x4a1512, chock: 0xf28c1d } as const;

// What weather does to a wagon that waits: its paint is this much of what it
// was, and moss is a green of its own.
export const weathering = { dull: 0xa6a6a0, rusted: 0xb9744a, moss: 0x5d8a3a } as const;

export type Part = "rail" | "wagon" | "locomotive" | "shunter" | "station" | "hut" | "office" | "works";
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
};

// A building as its file has it: the turn that brings its door to -z, and
// the size that sets it beside a wagon.
const buildings: Partial<Record<Part, [turn: number, size: number]>> = {
  station: [0, 1.5],
  hut: [0, 1.9],
  office: [0, 1.7],
  works: [0, 1.5],
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
const boxes: Record<Part, [number, number, number, number]> = {
  rail: [1, 0.12, 0.8, palette.slate],
  wagon: [2.7, 1.3, 1.2, palette.brick],
  locomotive: [2.6, 1.6, 1.3, palette.slate],
  shunter: [2.4, 1.6, 1.2, hat.builder],
  station: [3.2, 1.3, 1.4, palette.cream],
  hut: [2, 1.4, 2.4, palette.brick],
  office: [2.9, 1.2, 1.7, palette.cream],
  works: [2, 2.2, 2.5, palette.slate],
};

function box(part: Part): THREE.Object3D {
  const [length, height, width, colour] = boxes[part];
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, height, width),
    new THREE.MeshStandardMaterial({ color: colour, flatShading: true }),
  );
  mesh.position.y = height / 2;
  const group = new THREE.Group().add(mesh);
  if (part !== "works") return group;
  // A works smokes: its box has a stub of a chimney on the roof.
  const stub = block(palette.brick, STUB, STUB, STUB, height);
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

function block(colour: number, width: number, height: number, depth: number, y: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color: colour, flatShading: true }),
  );
  mesh.position.y = y + height / 2;
  return mesh;
}

// The figure of two boxes: a body in its outfit's colour, and a head.
function boxFigure(outfit: Outfit): Figure {
  const body = FIGURE_HEIGHT * 0.6;
  const colour = outfit === "crew" ? palette.slate : hat[outfit];
  const object = new THREE.Group();
  object.add(block(colour, 0.4, body, 0.55, 0), block(palette.cream, 0.45, FIGURE_HEIGHT - body, 0.45, body));
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
