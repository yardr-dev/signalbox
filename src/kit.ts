// The models: Kenney's Train Kit (CC0, public/kit/License.txt) for rails,
// wagons and locomotives. loadKit is the only way in; everything it hands out
// lies along +x, stands on the ground and is centred, in the kit's own units,
// so another set of models drops in here and nowhere else. A model that does
// not load is a box of the palette instead, and the page still draws.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// The picture's own colours, for what the kit has no model for (ground,
// platforms, buildings, signals, robot arms) and for a model that is missing.
export const palette = {
  grass: 0x9bc27a,
  ballast: 0xd8cdb4,
  platform: 0xa9abb0,
  brick: 0xb4533c,
  slate: 0x4f5a66,
  cream: 0xeadfb4,
} as const;

// Lamps are the one thing outside the six.
export const lamp = { clear: 0x3fd46b, stop: 0xe0453a } as const;

export type Part = "rail" | "wagon" | "locomotive";

export interface Kit {
  // A fresh copy of a part. Wagons come in several kinds; pick is any number
  // and the same number gives the same kind.
  make(part: Part, pick?: number): THREE.Object3D;
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
  // train-diesel-a stays in public/kit for the engines to come; nothing
  // draws it yet.
};

// Length, height, width of the box that stands in for a part.
const boxes: Record<Part, [number, number, number, number]> = {
  rail: [1, 0.12, 0.8, palette.slate],
  wagon: [2.7, 1.3, 1.2, palette.brick],
  locomotive: [2.6, 1.6, 1.3, palette.slate],
};

function box(part: Part): THREE.Object3D {
  const [length, height, width, colour] = boxes[part];
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, height, width),
    new THREE.MeshStandardMaterial({ color: colour, flatShading: true }),
  );
  mesh.position.y = height / 2;
  return new THREE.Group().add(mesh);
}

export async function loadKit(base: string): Promise<Kit> {
  const loader = new GLTFLoader().setPath(`${base}kit/`);
  const load = async (name: string): Promise<THREE.Object3D | undefined> => {
    try {
      const model = (await loader.loadAsync(`${name}.glb`)).scene;
      // The kit's models run along z; the yard's tracks along x.
      model.rotation.y = Math.PI / 2;
      return new THREE.Group().add(model);
    } catch (err) {
      console.warn(`kit: ${name} did not load, drawing a box`, err);
      return undefined;
    }
  };
  const parts = Object.keys(files) as Part[];
  const loaded = await Promise.all(parts.map((part) => Promise.all(files[part].map(load))));
  const models = new Map<Part, (THREE.Object3D | undefined)[]>(parts.map((part, i) => [part, loaded[i] ?? []]));

  return {
    make(part, pick = 0) {
      const kinds = models.get(part) ?? [];
      const model = kinds[Math.abs(pick) % Math.max(kinds.length, 1)];
      return model ? model.clone() : box(part);
    },
  };
}
