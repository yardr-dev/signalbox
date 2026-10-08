// @vitest-environment node
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import snapshot from "../public/yard.json";
import { banded, CHIMNEY, COLOUR, coloured, accented, flat, HAT, loadKit, SILO_HEIGHT, TINT, toned, type Kit, type Part } from "../src/kit";
import { HEADSHUNT, layout, people, PLACE_X, SHED_WIDTH, type Gate, type Shed } from "../src/layout";
import { GOODS_END, goodsSeconds, PUFF_SECONDS, PUFFS, RUN_OUT, TWEEN_MIN, WALK_MAX } from "../src/motion";
import { accents, building, dress, fault as tint, hat, iron, lamp, liveried, livery, paint, palette, SHADE, shade, smoke, stand, tinted, weathering, type Accent, type Tone } from "../src/palette";
import { BACKLOG, COUPLING } from "../src/shunt";
import { awaits, delivery, describe as tip, draw, fuelled, gateLamp, house, refuel, resets, sign, Stock, titled, waited, wrong } from "../src/scene";
import type { Bead, Edge, Provider, Quota, Yard } from "../src/yard";

// A picture as a page has it once it is read: its size and its pixels, four
// bytes each. A PNG as the packs' textures are: eight bits, with a palette,
// or red, green and blue with or without alpha, and not interlaced.
interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}
async function png(file: Uint8Array<ArrayBuffer>): Promise<Pixels> {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let [width, height, kind] = [0, 0, 0];
  let palette: Uint8Array = new Uint8Array();
  const packed: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 8; at < file.length; ) {
    const size = view.getUint32(at);
    const name = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const body = file.subarray(at + 8, at + 8 + size);
    if (name === "IHDR") {
      [width, height, kind] = [view.getUint32(at + 8), view.getUint32(at + 12), body[9]!];
      if (body[8] !== 8 || body[12] !== 0) throw new Error("png: eight bits and not interlaced, or it is not read");
    }
    if (name === "PLTE") palette = body;
    if (name === "IDAT") packed.push(body);
    at += size + 12;
  }
  const each = { 2: 3, 3: 1, 6: 4 }[kind];
  if (each === undefined) throw new Error(`png: colour type ${kind} is not read`);
  const lines = new Uint8Array(await new Response(new Blob(packed).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const row = width * each;
  const raw = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const filter = lines[y * (row + 1)]!;
    for (let x = 0; x < row; x++) {
      const left = x >= each ? raw[y * row + x - each]! : 0;
      const up = y > 0 ? raw[(y - 1) * row + x]! : 0;
      const corner = x >= each && y > 0 ? raw[(y - 1) * row + x - each]! : 0;
      const near = [left, up, corner].reduce((a, b) => (Math.abs(left + up - corner - b) < Math.abs(left + up - corner - a) ? b : a));
      const guess = [0, left, up, (left + up) >> 1, near][filter]!;
      raw[y * row + x] = lines[y * (row + 1) + 1 + x]! + guess;
    }
  }
  const data = new Uint8Array(width * height * 4).fill(255);
  for (let i = 0; i < width * height; i++) {
    const from = kind === 3 ? palette.subarray(3 * raw[i]!, 3 * raw[i]! + 3) : raw.subarray(i * each, i * each + 3);
    data.set(from, i * 4);
  }
  return { width, height, data };
}

// The kit's files as the page is served them, under this address, and a
// texture read as the browser reads one.
const KIT = "http://kit.test/";
const served = async (address: unknown) => new Response(await readFile(new URL(`../public${new URL(String(address instanceof Request ? address.url : address)).pathname}`, import.meta.url)));

// No file of the kit is there: every model is its box. And no page: a label
// is an element, of which the scene needs little, and a canvas gives back the
// picture drawn on it.
let kit: Kit;
const warned: string[] = [];
beforeAll(async () => {
  vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
  class Element {
    style = {};
    ownerDocument = { defaultView: { Element } };
    parentNode = null;
    setAttribute() {}
    remove() {}
  }
  class Canvas extends Element {
    getContext() {
      let drawn: Pixels | undefined;
      return { drawImage: (image: Pixels) => void (drawn = image), getImageData: () => drawn };
    }
  }
  vi.stubGlobal("document", { createElement: (tag: string) => (tag === "canvas" ? new Canvas() : new Element()) });
  vi.spyOn(console, "warn").mockImplementation((text: string) => void warned.push(text));
  kit = await loadKit("/");
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const yard = snapshot as Yard;
const meshes = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((part) => {
    if (part instanceof THREE.Mesh) n++;
  });
  return n;
};

describe("a kit whose files are missing", () => {
  test("a figure is two boxes and stands as it is: no clips", () => {
    for (const outfit of ["builder", "reviewer", "crew"] as const) {
      const figure = kit.figure(outfit, 7);
      expect(meshes(figure.object), outfit).toBe(2);
      expect(figure.clips).toEqual({});
      // About a wagon's height, on the ground.
      const box = new THREE.Box3().setFromObject(figure.object);
      expect(box.min.y).toBeCloseTo(0);
      expect(box.max.y).toBeGreaterThan(1.2);
      expect(box.max.y).toBeLessThan(1.7);
    }
    // Each its own: moving one moves no other.
    expect(kit.figure("builder").object).not.toBe(kit.figure("builder").object);
  });

  test("a building, a wagon and a rail are a box each", () => {
    for (const part of ["station", "hut", "office", "wagon", "van", "locomotive", "shunter", "rail"] as const) {
      expect(meshes(kit.make(part)), part).toBe(1);
    }
    // A works' box has a stub of a chimney, and says where its mouth is.
    const works = kit.make("works");
    expect(meshes(works)).toBe(2);
    const top = new THREE.Box3().setFromObject(works).max.y;
    expect(works.userData[CHIMNEY]).toEqual([expect.any(Number), top, 0]);
    expect(works.clone().userData[CHIMNEY]).toEqual(works.userData[CHIMNEY]);
    expect(warned).toContain("kit: people/character-male-e did not load, drawing a box");
    expect(warned).toContain("kit: city/building-i did not load, drawing a box");
  });

  test("a building's box is in its walls' accent, a wagon's and a locomotive's in the kit's own blue and green, and a shunter's and a van's a tone", () => {
    const wears = (o: THREE.Object3D) => {
      const seen: THREE.Material[] = [];
      o.traverse((part) => {
        if (part instanceof THREE.Mesh) seen.push(part.material as THREE.Material);
      });
      return seen;
    };
    for (const part of ["station", "hut", "office", "silo"] as const) expect(wears(kit.make(part))[0], part).toBe(paint(building[part][0]));
    expect(wears(kit.make("works"))).toEqual([paint(building.works[0]), paint(building.works[1])]);
    // As the kit's texture has them: the lightest of its blue container and
    // of its locomotive's green. Nothing of them is left for the scene.
    expect([stand.wagon, stand.locomotive]).toEqual([0x658dd6, 0x56c186]);
    for (const part of ["wagon", "locomotive"] as const) expect(wears(kit.make(part)), part).toEqual([paint(stand[part])]);
    expect(wears(kit.make("shunter"))).toEqual([paint("slate")]);
    expect(wears(kit.make("van"))).toEqual([paint("roof")]);
  });

  test("a silo is a box with the band its provider's colour goes on", () => {
    const silo = kit.make("silo");
    const named: string[] = [];
    silo.traverse((part) => {
      if (part instanceof THREE.Mesh) named.push((part.material as THREE.Material).name);
    });
    expect(named).toEqual(["", TINT]);
    expect(new THREE.Box3().setFromObject(silo).max.y).toBeCloseTo(SILO_HEIGHT);
    expect(warned).toContain("kit: city/detail-tank-large did not load, drawing a box");
  });

  test("a model's faces on the palette's orange become a material of their own, the rest keep the model's", () => {
    // Three faces as the pack's files have them, one material and a colour
    // by where the corners lie: a wall, the band, and one that only touches it.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Array(27).fill(0), 3));
    const wall = [0.844, 0.6];
    const orange = [0.719, 0.4];
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([...wall, ...wall, ...wall, ...orange, ...orange, ...orange, ...orange, ...orange, 0.719, 0.6], 2));
    geometry.setIndex([3, 4, 5, 0, 1, 2, 6, 7, 8]);
    const own = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(geometry, own);
    banded(new THREE.Group().add(mesh));
    const materials = mesh.material as unknown as THREE.Material[];
    expect(materials.map((m) => m.name)).toEqual(["", TINT]);
    expect(materials[0]).toBe(own);
    expect(geometry.groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 3, materialIndex: 1 },
    ]);
    expect([...geometry.getIndex()!.array]).toEqual([0, 1, 2, 6, 7, 8, 3, 4, 5]);
    // A model with no orange on it is left as it is.
    const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), own);
    banded(plain);
    expect(plain.material).toBe(own);
  });

  test("a model is painted flat: its faces sorted by the tone of each, in the palette's paint, and the band left for the scene", () => {
    // Three faces of one material, as banded leaves a silo: a wall, the
    // band, and a dark one. The tone is asked for by the middle of a face.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Array(27).fill(0), 3));
    const wall = [0.1, 0.6];
    const orange = [0.719, 0.4];
    const dark = [0.9, 0.9];
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([...dark, ...dark, 0.9, 0.6, ...orange, ...orange, ...orange, ...wall, ...wall, ...wall], 2));
    geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const own = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(geometry, own);
    const model = new THREE.Group().add(mesh);
    banded(model);
    const band = (mesh.material as unknown as THREE.Material[])[1]!;
    const asked: [number, number, THREE.Material][] = [];
    flat(model, (u, v, wears) => {
      asked.push([u, v, wears]);
      return u > 0.5 ? "slate" : "wall";
    });
    expect(mesh.material).toEqual([paint("slate"), paint("wall"), band]);
    expect(band.name).toBe(TINT);
    expect([...geometry.getIndex()!.array]).toEqual([0, 1, 2, 6, 7, 8, 3, 4, 5]);
    expect(geometry.groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 },
      { start: 6, count: 3, materialIndex: 2 },
    ]);
    // Nobody is asked about the band, and the others by their middles.
    expect(asked.map(([, , wears]) => wears)).toEqual([own, own]);
    expect(asked[0]![0]).toBeCloseTo(0.9);
    expect(asked[0]![1]).toBeCloseTo(0.8);
    expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
    // Paint is matt and flat, and one for all that wear a tone.
    expect(paint("wall")).toBe(paint("wall"));
    expect(paint("wall")).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(paint("wall").flatShading).toBe(true);
    expect(paint("wall").map).toBeNull();
  });

  test("the faces a model leaves to the scene are one material of it, by the name of the band's", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Array(27).fill(0), 3));
    const body = [0.1, 0.6];
    const frame = [0.9, 0.9];
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([...body, ...body, ...body, ...frame, ...frame, ...frame, ...body, ...body, ...body], 2));
    geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    flat(mesh, (u) => (u > 0.5 ? "slate" : TINT));
    const [left, frames] = mesh.material as unknown as THREE.Material[];
    expect(left!.name).toBe(TINT);
    expect(frames).toBe(paint("slate"));
    expect(geometry.groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 3, materialIndex: 1 },
    ]);
    // An accent is paint as a tone is.
    const plain = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    flat(plain, () => "mauve");
    expect(plain.material).toEqual([paint("mauve")]);
  });

  test("a colour of the packs is a tone by how light it is, whatever its hue", () => {
    expect(toned(255, 255, 255)).toBe("wall");
    expect(toned(0xd0, 0xe4, 0xff)).toBe("wall");
    expect(toned(0x90, 0x98, 0xb0)).toBe("pale");
    expect(toned(0x38, 0x38, 0x40)).toBe("slate");
    // The red, the green and the blue of the containers: no accent is left.
    const tones: Tone[] = [toned(0xe0, 0x50, 0x58), toned(0x60, 0xcc, 0x90), toned(0x60, 0x90, 0xd8)];
    for (const tone of tones) expect(["pale", "roof"]).toContain(tone);
  });
});

describe("the kit's own models", () => {
  // The files themselves, loaded as the page loads them.
  let own: Kit;
  const textures: Record<string, Pixels> = {};
  beforeAll(async () => {
    for (const pack of ["", "city/"]) textures[pack] = await png(await readFile(new URL(`../public/kit/${pack}Textures/colormap.png`, import.meta.url)));
    vi.stubGlobal("fetch", served);
    // The loader says how far it is, to nobody here, and asks the page for
    // an address only for a picture inside a file: the packs' lie beside.
    vi.stubGlobal("ProgressEvent", class {});
    vi.stubGlobal("self", { URL });
    vi.stubGlobal("createImageBitmap", async (file: Blob) => ({ ...(await png(new Uint8Array(await file.arrayBuffer()))), close() {} }));
    const before = warned.length;
    own = await loadKit(KIT);
    expect(warned.slice(before)).toEqual([]);
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
  });

  // A texture's swatches: sixteen columns of four rows, each one colour or
  // one that fades down it. The saturation of a swatch from its least to its
  // most, as COLOUR measures it.
  const swatch = ({ width, height, data }: Pixels, row: number, column: number): [number, number] | undefined => {
    const all: number[] = [];
    for (let y = (row * height) / 4; y < ((row + 1) * height) / 4; y++) {
      for (let x = (column * width) / 16; x < ((column + 1) * width) / 16; x++) {
        const [red, green, blue] = data.subarray(4 * (y * width + x), 4 * (y * width + x) + 3) as unknown as [number, number, number];
        const most = Math.max(red, green, blue);
        all.push(most === 0 ? -1 : (most - Math.min(red, green, blue)) / most);
      }
    }
    // The texture is black where it has no swatch.
    return all.every((s) => s < 0) ? undefined : [Math.min(...all), Math.max(...all)];
  };
  // The swatches of a texture on each side of COLOUR, and those it parts,
  // each as row and column.
  const sides = (pack: string) => {
    const found = { neutral: [] as string[], colour: [] as string[], parted: [] as string[] };
    let [neutral, colour] = [0, 1];
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 16; column++) {
        const span = swatch(textures[pack]!, row, column);
        if (!span) continue;
        const side = span[1] <= COLOUR ? "neutral" : span[0] > COLOUR ? "colour" : "parted";
        found[side].push(`${row}/${column}`);
        if (side === "neutral") neutral = Math.max(neutral, span[1]);
        if (side === "colour") colour = Math.min(colour, span[0]);
      }
    }
    return { ...found, most: neutral, least: colour };
  };

  test("COLOUR parts the swatches of the packs' textures: white, iron, dark, pale glass and cream below it, and every hue above, wood with them", () => {
    const train = sides("");
    // Row 1: red, blue, the pale glass and its fade into blue, purple, pink.
    // Row 2: white, terracotta, wood, skin and its fade into tan, cream,
    // green, yellow, orange. Row 3: glass, the whites, red, orange, and from
    // column 8 the darks and the irons.
    expect(train.colour).toEqual(["1/0", "1/1", "1/2", "1/3", "1/6", "1/7", "1/8", "1/9", "2/2", "2/3", "2/4", "2/5", "2/10", "2/11", "2/12", "2/13", "2/14", "2/15", "3/4", "3/5", "3/6", "3/7"]);
    expect(train.neutral).toEqual(["1/4", "2/0", "2/1", "2/6", "2/8", "2/9", "3/0", "3/2", "3/3", "3/8", "3/9", "3/10", "3/11", "3/12", "3/13", "3/14", "3/15"]);
    expect(train.parted).toEqual(["1/5", "2/7", "3/1"]);
    const city = sides("city/");
    // Row 0: blue, glass, purple, pink, pale pink. Row 1: terracotta, wood,
    // skin, cream, green, yellow, orange, red. Row 2: the irons, the darks,
    // white. Row 3: dark, green, brick, slate blue, glass, a deep blue and a
    // periwinkle that fades across the line, white.
    expect(city.colour).toEqual(["0/0", "0/1", "0/4", "0/5", "0/6", "0/7", "1/0", "1/1", "1/2", "1/3", "1/8", "1/9", "1/10", "1/11", "1/12", "1/13", "1/14", "1/15", "3/2", "3/3", "3/4", "3/12"]);
    expect(city.parted).toEqual(["0/3", "1/5", "3/5", "3/9", "3/13"]);
    expect(city.neutral.length).toBe(31);
    // The two sides lie well apart: the line is between them, not on one.
    for (const { most, least } of [train, city]) {
      expect(most).toBeLessThan(0.39);
      expect(least).toBeGreaterThan(0.48);
      expect(COLOUR).toBeGreaterThan(most + 0.05);
      expect(COLOUR).toBeLessThan(least - 0.03);
    }
    // As the kit asks it: the wagons' irons and white are no colour, glass
    // neither, and a container's red, green and blue are, and a log's brown.
    expect([coloured(0x86, 0x8b, 0xa1), coloured(255, 255, 255), coloured(0x38, 0x38, 0x3d), coloured(0xd0, 0xe8, 0xff), coloured(0, 0, 0)]).toEqual([false, false, false, false, false]);
    expect([coloured(0xe7, 0x58, 0x5e), coloured(0x61, 0xcb, 0x8b), coloured(0x67, 0x94, 0xd9), coloured(0xb0, 0x60, 0x41)]).toEqual([true, true, true, true]);
  });

  // What a model wears, and how much of it by the area of its faces: the
  // pack's texture ("texture"), its glass, TINT, or a paint of the palette
  // by its name.
  const named = new Map<THREE.Material, string>(([...Object.values(building).flat(), "overlay", "track", "slate"] as const).map((of) => [paint(of), of]));
  const worn = (model: THREE.Object3D) => {
    const area: Record<string, number> = {};
    model.updateMatrixWorld(true);
    model.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      expect(part.castShadow && part.receiveShadow).toBe(true);
      const geometry = part.geometry as THREE.BufferGeometry;
      const [at, index] = [geometry.getAttribute("position"), geometry.getIndex()!];
      const materials = [part.material].flat() as THREE.MeshStandardMaterial[];
      const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: index.count, materialIndex: 0 }];
      for (const { start, count, materialIndex } of groups) {
        const m = materials[materialIndex ?? 0]!;
        const name = named.get(m) ?? (m.name === TINT ? TINT : m.name.endsWith("specular") ? "glass" : m.map ? "texture" : "other");
        for (let i = start; i < start + count; i += 3) {
          const [a, b, c] = [0, 1, 2].map((n) => new THREE.Vector3().fromBufferAttribute(at, index.getX(i + n)).applyMatrix4(part.matrixWorld));
          area[name] = (area[name] ?? 0) + new THREE.Triangle(a, b, c).getArea();
        }
      }
    });
    return area;
  };
  const kinds = (part: Part, n: number) => Array.from({ length: n }, (_, pick) => worn(own.make(part, pick)));

  // The colours the pack painted a model, each as the texture has it under
  // a face, with the area of the faces that have it: those of more than a
  // trim, a colour of the pack's (coloured) or its iron.
  const hex = (colour: number) => colour.toString(16).padStart(6, "0");
  const painted = (model: THREE.Object3D, colour: boolean) => {
    const area = new Map<number, number>();
    model.updateMatrixWorld(true);
    model.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      const geometry = part.geometry as THREE.BufferGeometry;
      const [at, uv, index] = [geometry.getAttribute("position"), geometry.getAttribute("uv"), geometry.getIndex()!];
      const { width, height, data } = (part.material as THREE.MeshStandardMaterial).map!.image as Pixels;
      const pixel = (t: number, size: number) => Math.min(size - 1, Math.floor((t - Math.floor(t)) * size));
      for (let i = 0; i < index.count; i += 3) {
        const face = [0, 1, 2].map((n) => index.getX(i + n));
        const [a, b, c] = face.map((n) => new THREE.Vector3().fromBufferAttribute(at, n).applyMatrix4(part.matrixWorld));
        const middle = (of: "getX" | "getY") => face.reduce((sum, n) => sum + uv[of](n), 0) / 3;
        const from = 4 * (pixel(middle("getY"), height) * width + pixel(middle("getX"), width));
        const is = (data[from]! << 16) | (data[from + 1]! << 8) | data[from + 2]!;
        area.set(is, (area.get(is) ?? 0) + new THREE.Triangle(a, b, c).getArea());
      }
    });
    return [...area].filter(([is, of]) => of > 0.3 && coloured(is >> 16, (is >> 8) & 0xff, is & 0xff) === colour).map(([is]) => is);
  };
  // The texture is a picture: its colours are as a screen has them.
  const texel = (colour: number) => linear(colour);
  const STOCK = ["container-blue", "container-green", "container-red", "tank", "wood"];

  test("what rolls wears the pack's texture as it came, colours and all: nothing of it is the scene's or the palette's", () => {
    // Three containers, a tank, a load of logs; two vans; a locomotive and
    // a shunter. A shunter's windows are glass of the texture.
    for (const of of [...kinds("wagon", 5), ...kinds("van", 2), ...kinds("locomotive", 1), ...kinds("shunter", 1)]) {
      expect(Object.keys(of)).toEqual(["texture"]);
      expect(of.texture).toBeGreaterThan(20);
    }
    // The pack's own colours are on them: a container's from its dark to its
    // light, the red of a tank's ends, the logs, the green and the red of
    // the locomotive, the shunter's yellow. A van is iron all over.
    const colours = (part: Part, pick: number) => painted(own.make(part, pick), true).map(hex);
    expect(colours("wagon", 0)).toEqual(expect.arrayContaining(["595cbf", "658dd6"]));
    expect(colours("wagon", 1)).toEqual(expect.arrayContaining(["1f886b", "56c186"]));
    expect(colours("wagon", 2)).toEqual(expect.arrayContaining(["b53137", "e05359"]));
    expect(colours("wagon", 3)).toEqual(expect.arrayContaining(["b53137", "e05359"]));
    expect(colours("wagon", 4)).toEqual(expect.arrayContaining(["b46444", "ec9368"]));
    expect(colours("locomotive", 0)).toEqual(expect.arrayContaining(["319b74", "56c186", "bf393f", "d54a50"]));
    expect(colours("shunter", 0)).toEqual(expect.arrayContaining(["ff9d36", "ffb046"]));
    for (const pick of [0, 1]) expect(colours("van", pick)).toEqual([]);
    // The box that stands for one that did not load is of them.
    expect(colours("wagon", 0)).toContain(hex(stand.wagon));
    expect(colours("locomotive", 0)).toContain(hex(stand.locomotive));
  });

  test("what means something is told from the kit's paint: the clear and amber lamps on every wagon, and a red lamp, a flag and chocks from the ground they are seen against", () => {
    // A mark against every colour of a model, fresh, dull and rusted, in the
    // sun and in the shade: the least of the distances, to two places.
    const least = (mark: Triple[], own: number[]) => {
      const faces = own.flatMap((is) => [texel(is), times(texel(is), linear(weathering.dull)), times(texel(is), linear(weathering.rusted))]).flatMap((face) => [face, lit(face, SHADE)]);
      return Math.round(100 * Math.min(...faces.flatMap((face) => mark.map((m) => apart(m, face))))) / 100;
    };
    // A lamp shines: it is its colour whatever the sun does. A flag and
    // chocks are painted, and have a side in the shade.
    const marks: Record<string, Triple[]> = {
      amber: [linear(lamp.wait)],
      clear: [linear(lamp.clear)],
      lamp: [linear(lamp.stop)],
      flag: [linear(lamp.stop), lit(linear(lamp.stop), SHADE)],
      chocks: [linear(tint.chock), lit(linear(tint.chock), SHADE)],
    };
    const models = [...STOCK.map((name, pick) => [name, own.make("wagon", pick)] as const), ["locomotive", own.make("locomotive")] as const];
    const figures = Object.fromEntries(models.map(([name, model]) => [name, Object.fromEntries(Object.entries(marks).map(([mark, as]) => [mark, least(as, painted(model, true))]))]));
    expect(figures).toEqual({
      "container-blue": { amber: 0.33, clear: 0.39, lamp: 0.11, flag: 0.05, chocks: 0.18 },
      "container-green": { amber: 0.21, clear: 0.18, lamp: 0.29, flag: 0.26, chocks: 0.21 },
      "container-red": { amber: 0.24, clear: 0.44, lamp: 0.02, flag: 0.01, chocks: 0.11 },
      tank: { amber: 0.24, clear: 0.44, lamp: 0.02, flag: 0.01, chocks: 0.11 },
      wood: { amber: 0.11, clear: 0.31, lamp: 0.09, flag: 0.08, chocks: 0.05 },
      locomotive: { amber: 0.21, clear: 0.18, lamp: 0.03, flag: 0.01, chocks: 0.12 },
    });
    for (const [name, model] of models) {
      // The amber of a wait lies on the roof: it reads on every colour.
      expect(figures[name]!.amber, `amber on ${name}`).toBeGreaterThan(READS);
      expect(figures[name]!.clear, `clear on ${name}`).toBeGreaterThan(READS);
      // And every mark reads on the iron of frame and wheels.
      for (const [mark, as] of Object.entries(marks)) expect(least(as, painted(model, false)), `${mark} on the iron of ${name}`).toBeGreaterThan(READS);
    }
    // The kit's red is a fault's red, and its logs are near chocks' orange:
    // by colour a red lamp and a flag are not told from a red container, a
    // tank's ends or a locomotive's beams. They stand on a post over the
    // roof, and chocks lie on the rail: what they are seen against is the
    // ground, and there they read, by day and by night.
    for (const dark of [false, true]) {
      dress(dark);
      for (const tone of ["ground", "bed", "track", "platform", "terminal"] satisfies Tone[]) {
        const under = [linear(palette[tone]), lit(linear(palette[tone]), SHADE)];
        for (const mark of ["lamp", "flag", "chocks"]) {
          expect(Math.min(...under.flatMap((face) => marks[mark]!.map((m) => apart(m, face)))), `${mark} on ${tone} ${dark ? "by night" : "by day"}`).toBeGreaterThan(READS);
        }
      }
    }
    dress(false);
  });

  test("the weather is seen on every colour of the kit's: dull and rusted are told from fresh, and moss from rust", () => {
    const moss = linear(weathering.moss);
    for (const [pick, name] of STOCK.entries()) {
      const model = own.make("wagon", pick);
      for (const is of [...painted(model, true), ...painted(model, false)]) {
        const fresh = texel(is);
        const dull = times(fresh, linear(weathering.dull));
        const rusted = times(fresh, linear(weathering.rusted));
        // The darks of a frame have little to lose: they are not asked.
        const slate = toned(is >> 16, (is >> 8) & 0xff, is & 0xff) === "slate";
        if (!slate) expect(apart(fresh, dull), `dull ${hex(is)} of ${name}`).toBeGreaterThan(READS);
        expect(apart(fresh, rusted), `rusted ${hex(is)} of ${name}`).toBeGreaterThan(READS);
        // Rust is a step on from dull on the iron every wagon has, and on
        // its blue and green. On the kit's red and its logs it is not: rust
        // is their own hue, and there the iron beside them says it.
        const warm = (is >> 16) > 1.5 * ((is >> 8) & 0xff);
        if (!warm && !slate) expect(apart(dull, rusted), `rusted on from dull ${hex(is)} of ${name}`).toBeGreaterThan(0.08);
        if (warm) expect(apart(dull, rusted), `rusted on from dull ${hex(is)} of ${name}`).toBeLessThan(0.08);
        expect(Math.min(apart(moss, rusted), apart(moss, lit(rusted, SHADE)), apart(lit(moss, SHADE), lit(rusted, SHADE))), `moss on ${hex(is)} of ${name}`).toBeGreaterThan(READS);
      }
    }
  });

  test("a building wears the pack's texture, and the little the pack painted a colour is its kind's accents: the lightest hue its walls', another its roof's", () => {
    const [station] = kinds("station", 1);
    const [hut] = kinds("hut", 1);
    const [office] = kinds("office", 1);
    const [works] = kinds("works", 1);
    // A station and a works have the pack's yellow alone: their walls'.
    expect(Object.keys(station!).sort()).toEqual(["glass", "teal", "texture"]);
    expect(Object.keys(works!).sort()).toEqual(["glass", "lavender", "texture"]);
    // A hut and an office have a plant by the door too, green in its pot:
    // their roof's.
    expect(Object.keys(hut!).sort()).toEqual(["glass", "peach", "texture", "yellow"]);
    expect(Object.keys(office!).sort()).toEqual(["glass", "sapphire", "sky", "texture"]);
    // The pack's buildings are iron and white: the accent is a trim.
    for (const of of [station!, hut!, office!, works!]) {
      const accent = Object.entries(of).reduce((sum, [name, area]) => (name === "texture" || name === "glass" ? sum : sum + area), 0);
      expect(accent).toBeGreaterThan(0.1);
      expect(accent).toBeLessThan(of.texture! / 8);
    }
    // A silo's band is its provider's, and the tank has no colour beside it.
    const [silo] = kinds("silo", 1);
    expect(Object.keys(silo!).sort()).toEqual(["texture", TINT]);
    // The rails are flat, in the track's tone, as they were.
    expect(Object.keys(kinds("rail", 1)[0]!).sort()).toEqual(["slate", "track"]);
  });

  test("a wagon in the yard wears the kit's texture and nothing else, whatever its bead's type, and night changes none of it", () => {
    const bead = (id: string, type: string): Bead => ({ id, title: id, type, stage: "backlog", depot: "signalbox", priority: 2, created_at: "2099-01-01T00:00:00Z" });
    const stock = new Stock(layout({ ...yard, beads: [bead("signalbox-a", "task"), bead("signalbox-m", "memory"), bead("signalbox-s", "spike")] }), own);
    const wears = new Set<THREE.MeshStandardMaterial>();
    for (const id of ["signalbox-a", "signalbox-m", "signalbox-s"]) {
      stock.root.children.find((o) => (o.userData.bead as Bead | undefined)?.id === id)!.traverse((part) => {
        if (part instanceof THREE.Mesh) for (const m of [part.material].flat()) wears.add(m as THREE.MeshStandardMaterial);
      });
    }
    // A file of the pack has one material: its texture, white under it.
    expect(wears.size).toBeGreaterThan(0);
    const as = () => [...wears].map((m) => [m.map !== null, m.name === TINT, m.color.getHex()]);
    for (const is of as()) expect(is).toEqual([true, false, 0xffffff]);
    const day = as();
    dress(true);
    expect(as()).toEqual(day);
    dress(false);
  });

  test("weathering tints the whole wagon, the kit's texture with it, and leaves the kit's own material as it was", () => {
    const now = Date.parse("2099-01-20T00:00:00Z");
    const aged = (id: string, days: number): Bead => ({ id, title: id, type: "task", stage: "backlog", depot: "signalbox", priority: 2, created_at: new Date(now - days * 24 * 60 * 60 * 1000).toISOString() });
    const stock = new Stock(layout({ ...yard, beads: [aged("signalbox-fresh", 0), aged("signalbox-dull", 3), aged("signalbox-rusted", 7)] }, {}, now), own);
    const wears = (id: string) => {
      const seen = new Set<THREE.MeshStandardMaterial>();
      stock.root.children.find((o) => (o.userData.bead as Bead | undefined)?.id === id)!.traverse((part) => {
        if (part instanceof THREE.Mesh) for (const m of [part.material].flat()) seen.add(m as THREE.MeshStandardMaterial);
      });
      return [...seen];
    };
    const [fresh] = wears("signalbox-fresh");
    expect(fresh!.map).not.toBeNull();
    for (const [id, by] of [["signalbox-dull", weathering.dull], ["signalbox-rusted", weathering.rusted]] as const) {
      const worn = wears(id);
      // Every part of it: no face keeps the fresh paint.
      expect(worn.length, id).toBe(1);
      expect(worn[0]!.map, id).not.toBeNull();
      expect(worn[0]!.color.getHex(), id).toBe(new THREE.Color(by).getHex());
    }
    // What the kit hands out next is fresh.
    expect(fresh!.color.getHex()).toBe(0xffffff);
    for (let pick = 0; pick < 5; pick++) {
      own.make("wagon", pick).traverse((part) => {
        if (part instanceof THREE.Mesh) expect((part.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff);
      });
    }
  });

  test("a model whose texture cannot be read is as the pack has it", () => {
    const worn = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), worn);
    accented(mesh, [TINT, TINT]);
    expect(mesh.material).toEqual([worn]);
    expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
  });
});

describe("the kit's figures", () => {
  // The pack's files as far as a figure goes: one mesh in the texture all
  // its figures share, on a head bone.
  const worn = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  let cast: Kit;
  beforeAll(async () => {
    const loading = vi.spyOn(GLTFLoader.prototype, "loadAsync").mockImplementation(async (name) => {
      if (!String(name).startsWith("people/")) throw new Error("no such file");
      const head = new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), worn));
      head.name = "head";
      return { scene: new THREE.Group().add(head), animations: [] } as never;
    });
    cast = await loadKit("/");
    loading.mockRestore();
  });

  test("a figure is the pack's own: its texture as it came, under the yard's sun, and no paint of the palette", () => {
    for (const outfit of ["builder", "reviewer", "crew"] as const) {
      const own: THREE.Mesh[] = [];
      cast.figure(outfit).object.traverse((part) => {
        if (part instanceof THREE.Mesh && !part.parent?.name.startsWith(HAT)) own.push(part);
      });
      expect(own.length, outfit).toBe(1);
      expect(own[0]!.material, outfit).toBe(worn);
      expect(own[0]!.castShadow && own[0]!.receiveShadow, outfit).toBe(true);
    }
    expect(worn.map).not.toBeNull();
  });

  test("a builder's hard hat is hi-vis and a reviewer's white, by day and by night; the crew has none", () => {
    const hats = (outfit: "builder" | "reviewer" | "crew") => {
      const seen: number[] = [];
      cast.figure(outfit).object.getObjectByName(HAT)?.traverse((part) => {
        if (part instanceof THREE.Mesh) seen.push((part.material as THREE.MeshLambertMaterial).color.getHex());
      });
      return seen;
    };
    for (const dark of [false, true]) {
      dress(dark);
      expect(hats("builder")).toEqual([hat.builder, hat.builder]);
      expect(hats("reviewer")).toEqual([hat.reviewer, hat.reviewer]);
      expect(hats("crew")).toEqual([]);
    }
    dress(false);
    expect([hat.builder, hat.reviewer]).toEqual([0xffd21f, 0xffffff]);
  });
});

// A colour as the light has it, and how far two are apart to the eye: their
// distance in Oklab (Ottosson 2020), where 0.02 is about the least that is
// seen and black to white is 1. Two that are READS apart are told from one
// another at a glance, whatever their lightness.
type Triple = [number, number, number];
const READS = 0.1;
const linear = (colour: number): Triple => {
  const { r, g, b } = new THREE.Color(colour);
  return [r, g, b];
};
const times = (a: Triple, b: Triple): Triple => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const lit = (a: Triple, by: number): Triple => [a[0] * by, a[1] * by, a[2] * by];
const oklab = ([r, g, b]: Triple): Triple => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const apart = (a: Triple, b: Triple) => {
  const [p, q] = [oklab(a), oklab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

// How far a colour is from grey: the widest gap between its red, green and
// blue, of 1.
const chroma = (colour: number) => {
  const parts = [colour >> 16, (colour >> 8) & 0xff, colour & 0xff];
  return (Math.max(...parts) - Math.min(...parts)) / 255;
};

describe("the palette", () => {
  afterAll(() => dress(false));

  test("by day and by night the tones are near grey, and only what means something is not", () => {
    for (const dark of [false, true]) {
      dress(dark);
      for (const [tone, colour] of Object.entries(palette)) expect(chroma(colour), `${tone} ${dark ? "by night" : "by day"}`).toBeLessThan(0.12);
      // An accent is a colour in both, but for overlay, which is no provider's.
      for (const [accent, colour] of Object.entries(accents)) {
        if (accent !== "overlay") expect(chroma(colour), `${accent} ${dark ? "by night" : "by day"}`).toBeGreaterThan(0.09);
      }
      expect(chroma(accents.overlay)).toBeLessThan(0.12);
    }
    const bold = [lamp.clear, lamp.stop, lamp.wait, tint.chock, hat.builder];
    for (const colour of bold) expect(chroma(colour), colour.toString(16)).toBeGreaterThan(0.5);
  });

  test("the accents are Catppuccin's: Latte's by day and Mocha's by night, under the same names, and their paint changes where it is", () => {
    // As palette.json has them.
    const latte = { rosewater: 0xdc8a78, flamingo: 0xdd7878, pink: 0xea76cb, mauve: 0x8839ef, red: 0xd20f39, maroon: 0xe64553, peach: 0xfe640b, yellow: 0xdf8e1d, green: 0x40a02b, teal: 0x179299, sky: 0x04a5e5, sapphire: 0x209fb5, blue: 0x1e66f5, lavender: 0x7287fd, overlay: 0x8c8fa1 };
    const mocha = { rosewater: 0xf5e0dc, flamingo: 0xf2cdcd, pink: 0xf5c2e7, mauve: 0xcba6f7, red: 0xf38ba8, maroon: 0xeba0ac, peach: 0xfab387, yellow: 0xf9e2af, green: 0xa6e3a1, teal: 0x94e2d5, sky: 0x89dceb, sapphire: 0x74c7ec, blue: 0x89b4fa, lavender: 0xb4befe, overlay: 0x7f849c };
    dress(false);
    const mauve = paint("mauve");
    const rusted = tinted(mauve, weathering.rusted) as THREE.MeshLambertMaterial;
    expect(accents).toEqual(latte);
    expect(mauve.color.getHex()).toBe(latte.mauve);
    expect(shade("mauve")).toBe(latte.mauve);
    expect(shade("wall")).toBe(palette.wall);
    dress(true);
    expect(accents).toEqual(mocha);
    expect(paint("mauve")).toBe(mauve);
    expect(mauve.color.getHex()).toBe(mocha.mauve);
    expect(rusted.color.getHex()).toBe(new THREE.Color(mocha.mauve).multiply(new THREE.Color(weathering.rusted)).getHex());
    dress(false);
    expect(mauve.color.getHex()).toBe(latte.mauve);
  });

  test("a building is its kind's two accents; none is red or maroon, which are a fault's", () => {
    expect(Object.keys(building).sort()).toEqual(["board", "box", "hut", "office", "post", "silo", "station", "works"]);
    const worn: Accent[] = Object.values(building).flat();
    for (const accent of worn) {
      expect(Object.keys(accents)).toContain(accent);
      expect(["red", "maroon"]).not.toContain(accent);
    }
    // The kinds of building that stand in a depot are told apart by their roofs.
    const roofs = (["station", "hut", "office", "works"] as const).map((kind) => building[kind][1]);
    expect(new Set(roofs).size).toBe(4);
  });

  test("a provider's band stands out from its silo, and from another provider's, by day and by night", () => {
    for (const dark of [false, true]) {
      dress(dark);
      const bands = ["claude", "codex", "kimi", "any other"].map(liveried);
      expect(bands).toEqual(["peach", "green", "blue", "overlay"]);
      for (const band of bands) {
        for (const wall of building.silo) expect(apart(linear(shade(band)), linear(shade(wall))), `${band} on ${wall} ${dark ? "by night" : "by day"}`).toBeGreaterThan(READS);
        for (const other of bands) if (other !== band) expect(apart(linear(shade(band)), linear(shade(other))), `${band} by ${other}`).toBeGreaterThan(READS);
      }
    }
  });

  test("night is the same picture: the ground dark, the labels turned round, and every tone in its place between the others", () => {
    const light = (colour: number) => (colour >> 16) + ((colour >> 8) & 0xff) + (colour & 0xff);
    const order = () => (["slate", "roof", "pale", "wall"] satisfies Tone[]).sort((a, b) => light(palette[b]) - light(palette[a]));
    dress(false);
    const day = { ...palette };
    expect(order()).toEqual(["wall", "pale", "roof", "slate"]);
    expect(light(day.bed)).toBeLessThan(light(day.ground));
    expect(light(day.ink)).toBeLessThan(light(day.pill));
    dress(true);
    expect(order()).toEqual(["wall", "pale", "roof", "slate"]);
    expect(light(palette.ground)).toBeLessThan(light(0x202430));
    expect(light(palette.bed)).toBeGreaterThan(light(palette.ground));
    expect(light(palette.ink)).toBeGreaterThan(light(palette.pill));
    for (const tone of Object.keys(day) as Tone[]) expect(palette[tone], tone).not.toBe(day[tone]);
  });

  test("night changes a tone's paint where it is, and the weathered paint made of it; a lamp's stays, and a provider's is its accent's", () => {
    dress(false);
    const wall = paint("wall");
    const rusted = tinted(wall, weathering.rusted);
    const stop = paint(lamp.stop);
    const claude = paint(liveried("claude"));
    const by = (of: THREE.MeshLambertMaterial) => of.color.clone().multiply(new THREE.Color(weathering.rusted)).getHex();
    const day = wall.color.getHex();
    expect((rusted as THREE.MeshLambertMaterial).color.getHex()).toBe(by(wall));
    dress(true);
    expect(wall.color.getHex()).toBe(palette.wall);
    expect(wall.color.getHex()).not.toBe(day);
    expect(tinted(wall, weathering.rusted)).toBe(rusted);
    expect((rusted as THREE.MeshLambertMaterial).color.getHex()).toBe(by(wall));
    expect(stop.color.getHex()).toBe(lamp.stop);
    expect(livery.claude).toBe("peach");
    expect(claude.color.getHex()).toBe(accents.peach);
    // A provider with no colour is overlay, as overlay is now.
    expect(paint(liveried("grok")).color.getHex()).toBe(accents.overlay);
    dress(false);
    expect(wall.color.getHex()).toBe(day);
  });
});

describe("the box the first view holds", () => {
  // A dir depot with no flow, as a fresh yard has it: a board and nothing on it.
  const bare: Yard = { ...yard, depots: [{ name: "papers", kind: "dir" }], flows: [{ depot: "papers", flows: [] }], routes: [], peers: [], beads: [] };

  test("a board with no flow has its whole plot in it, in whatever slot it stands", () => {
    for (const slot of [0, 4]) {
      const l = layout(bare, { depots: { papers: slot } });
      const board = l.boards[0]!;
      expect(l.tracks).toEqual([]);
      expect(board.width).toBeGreaterThan(0);
      expect(board.depth).toBeGreaterThan(0);
      const { min, max } = draw(l, kit).bounds;
      expect(min.x).toBeLessThanOrEqual(board.at.x);
      expect(min.z).toBeLessThanOrEqual(board.at.z);
      expect(max.x).toBeGreaterThanOrEqual(board.at.x + board.width);
      expect(max.z).toBeGreaterThanOrEqual(board.at.z + board.depth);
    }
  });

  test("it is as high as the signal boxes: their signs are not over the view's edge", () => {
    const { min, max } = draw(layout(bare), kit).bounds;
    expect(min.y).toBe(0);
    expect(max.y).toBeGreaterThanOrEqual(new THREE.Box3().setFromObject(draw(layout(bare), kit).root).max.y);
  });
});

describe("the figures of the stock", () => {
  const idle = yard.beads.filter((b) => b.group !== "yardr-builders");
  const work: Bead = { id: "signalbox-w", title: "w", type: "task", stage: "new", depot: "signalbox", group: "yardr-builders", working: true, priority: 2, created_at: "2000-01-01T00:00:00Z" };
  const quiet = layout({ ...yard, beads: [...idle, { ...work, working: false }] });
  const busy = layout({ ...yard, beads: [...idle, work] });
  // The wagon's board has a hut of its own: the figure comes from there.
  const place = people(quiet).find((p) => p.key.startsWith("signalbox/default/new/yardr-builders#"))!;
  const post = busy.work.find((w) => w.key === work.id)!;
  // The figure of the first place of the builders' hut.
  const first = (stock: Stock) => {
    const crew = stock.root.children.filter((o) => o.userData.crew === true);
    expect(crew.length).toBe(people(quiet).length);
    return crew.find((o) => o.position.x === place.at.x && o.position.z === place.at.z) ?? crew.find((o) => o.userData.bead?.id === work.id)!;
  };

  const home = (figure: THREE.Object3D) => {
    expect(figure.position.x).toBeCloseTo(place.at.x);
    expect(figure.position.y).toBe(0);
    expect(figure.position.z).toBeCloseTo(place.at.z);
  };

  test("a session start walks one out of its place to the wagon, the end back", () => {
    const stock = new Stock(quiet, kit);
    const figure = first(stock);
    home(figure);
    expect(stock.beads).not.toContain(figure);

    stock.show(busy, { tween: true });
    // Not there at once: it has a way to go, and is on it.
    expect(figure.position).toMatchObject({ x: place.at.x, z: place.at.z });
    expect(stock.tick(WALK_MAX / 4)).toBe(true);
    const under = { x: figure.position.x, z: figure.position.z };
    expect(under).not.toEqual(place.at);
    expect(under).not.toEqual(post.at);
    // On the ground until the platform.
    expect(figure.position.y).toBe(0);
    stock.tick(WALK_MAX);
    expect(figure.position.x).toBeCloseTo(post.at.x);
    expect(figure.position.z).toBeCloseTo(post.at.z);
    // Up on the platform, turned to its wagon, and the bead's under the pointer.
    expect(figure.position.y).toBeGreaterThan(0.4);
    stock.tick(1);
    expect(figure.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(stock.beads).toContain(figure);
    expect(tip(figure.userData.bead as Bead, figure.userData.crew === true)).toContain("signalbox-w — session of yardr-builders");
    // A box figure at work moves nothing more.
    expect(stock.tick(0.1)).toBe(false);

    stock.show(quiet, { tween: true });
    stock.tick(WALK_MAX / 4);
    expect(figure.position.x).not.toBeCloseTo(post.at.x);
    stock.tick(WALK_MAX);
    home(figure);
    expect(stock.beads).not.toContain(figure);
  });

  test("an end during the walk turns the figure home from where it is", () => {
    const stock = new Stock(quiet, kit);
    const figure = first(stock);
    stock.show(busy, { tween: true });
    stock.tick(WALK_MAX / 4);
    const interrupted = { x: figure.position.x, z: figure.position.z };
    expect(interrupted).not.toEqual(place.at);
    stock.show(quiet, { tween: true });
    // It heads home from its current point instead of visiting the wagon.
    stock.tick(WALK_MAX / 4);
    expect(figure.position.x).toBeLessThan(interrupted.x);
    expect(figure.position.x).not.toBeCloseTo(post.at.x);
    stock.tick(WALK_MAX);
    home(figure);
  });

  test("the replay's speed is the walk's: at 10x it is there in a move's least, at 1x not yet", () => {
    for (const [speed, there] of [[1, false], [10, true]] as const) {
      const stock = new Stock(quiet, kit);
      const figure = first(stock);
      stock.show(busy, { tween: true, speed });
      stock.tick(TWEEN_MIN);
      expect(figure.position.x === post.at.x && figure.position.z === post.at.z, `${speed}x`).toBe(there);
    }
  });

  test("a building's door is to its platform, and no one of its crew stands behind it", () => {
    const sheds = draw(quiet, kit).sheds;
    for (const object of sheds) {
      const s = object.userData.shed as (typeof quiet.sheds)[number];
      // The kit's door looks to -z: up the page, where a main line's platform is.
      expect(object.rotation.y, s.key).toBe(s.away > 0 ? 0 : Math.PI);
      const wall = new THREE.Box3().setFromObject(object).max.x;
      for (const p of s.places) expect(p.at.x, p.key).toBeGreaterThan(wall);
    }
    expect(sheds.some((o) => (o.userData.shed as (typeof quiet.sheds)[number]).places.length > 0)).toBe(true);
  });

  test("a scrub snaps: at the wagon at once, and at home at once", () => {
    const stock = new Stock(quiet, kit);
    const figure = first(stock);
    stock.show(busy, { tween: false });
    expect(figure.position.x).toBeCloseTo(post.at.x);
    expect(figure.position.z).toBeCloseTo(post.at.z);
    expect(figure.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(stock.tick(0.1)).toBe(false);
    // In the middle of a walk too.
    stock.show(quiet, { tween: true });
    stock.tick(WALK_MAX / 4);
    stock.show(busy, { tween: false });
    expect(figure.position.x).toBeCloseTo(post.at.x);
    stock.show(quiet, { tween: false });
    home(figure);
    expect(figure.rotation.y).toBeCloseTo(-Math.PI / 2);
  });

  test("a session that ends badly seats its figure where it worked, back to the wagon; the next one stands it up", () => {
    const at = "2000-01-01T14:02:00Z";
    const stalled = layout({ ...yard, beads: [...idle, { ...work, working: false, fault: { kind: "stalled", at } }] });
    const crew = (stock: Stock) => stock.root.children.filter((o) => o.userData.crew === true);
    const stock = new Stock(quiet, kit);
    const figure = first(stock);
    stock.show(busy, { tween: true });
    stock.tick(WALK_MAX);
    stock.tick(1);
    expect(figure.rotation.y).toBeCloseTo(Math.PI / 2);

    stock.show(stalled, { tween: true });
    // No walk: it is where it was, and turns its back.
    expect(figure.position).toMatchObject({ x: post.at.x, z: post.at.z });
    stock.tick(1);
    expect(figure.position).toMatchObject({ x: post.at.x, z: post.at.z });
    expect(figure.position.y).toBeGreaterThan(0.4);
    expect(figure.rotation.y).toBeCloseTo(-Math.PI / 2);
    expect(stock.tick(0.1)).toBe(false);
    // The bead's under the pointer still, and the tip says what is wrong.
    expect(stock.beads).toContain(figure);
    expect(tip(figure.userData.bead as Bead, true)).toContain(`session stalled ${clock(at)}`);
    // Not out: its place at the hut has a figure again.
    expect(crew(stock).length).toBe(people(quiet).length + 1);
    const fresh = crew(stock).find((o) => o.position.x === place.at.x && o.position.z === place.at.z)!;
    expect(fresh).not.toBe(figure);

    // The next session on the bead: the one that sat, not the one at home.
    stock.show(busy, { tween: true });
    expect(crew(stock).length).toBe(people(busy).length);
    expect(crew(stock)).toContain(figure);
    expect(crew(stock)).not.toContain(fresh);
    stock.tick(1);
    expect(figure.position).toMatchObject({ x: post.at.x, z: post.at.z });
    expect(figure.rotation.y).toBeCloseTo(Math.PI / 2);

    // The bead moves on without it: the figure that sat is gone, where it sat.
    stock.show(stalled, { tween: true });
    stock.show(quiet, { tween: true });
    expect(figure.position).toMatchObject({ x: post.at.x, z: post.at.z });
    expect(stock.tick(TWEEN_MIN / 2)).toBe(true);
    expect(figure.scale.x).toBeLessThan(1);
    stock.tick(TWEEN_MIN);
    expect(crew(stock)).not.toContain(figure);
    expect(crew(stock).length).toBe(people(quiet).length);
    expect(stock.tick(0.1)).toBe(false);

    // A scrub to the fault: sat at the wagon at once.
    stock.show(stalled, { tween: false });
    const sat = crew(stock).find((o) => o.userData.bead?.id === work.id)!;
    expect(sat.position).toMatchObject({ x: post.at.x, z: post.at.z });
    expect(sat.rotation.y).toBeCloseTo(-Math.PI / 2);
    expect(crew(stock).length).toBe(people(quiet).length + 1);
  });

  test("the first place is out from the door; a sign counts who is out; a building says whose it is", () => {
    const hut = quiet.sheds.find((s) => s.group === "yardr-builders")!;
    expect(place.at.x).toBeCloseTo(hut.at.x + SHED_WIDTH / 2 + PLACE_X);
    expect(sign(hut)).toBe("yardr-builders · 0 of 3 out");
    expect(sign(hut, 2)).toBe("yardr-builders · 2 of 3 out");
    expect(house(hut)).toBe("yardr-builders\nherdr · limit 3");
    const station = quiet.sheds.find((s) => s.kind === "station")!;
    expect(sign(station)).toBe(station.group);
    expect(house(station)).toBe(`${station.group}\nmanual · limit 50`);
    const works = quiet.sheds.find((s) => s.key === "signalbox/default/approved/signalbox-assembly")!;
    expect(sign(works)).toBe("signalbox-assembly · 1");
  });
});

// A fault's time of day as the tip has it: the reader's own.
const clock = (at: string) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.parse(at));

describe("the faults of the stock", () => {
  const bead = (id: string, over: Partial<Bead> = {}): Bead => ({ id, title: id, type: "task", stage: "new", depot: "signalbox", priority: 2, created_at: "2000-01-01T00:00:00Z", ...over });
  const at = (...beads: Bead[]) => layout({ ...yard, beads });
  const wagon = (stock: Stock, id: string) => stock.root.children.find((o) => (o.userData.bead as Bead | undefined)?.id === id && o.userData.crew !== true)!;
  const when = "2000-01-01T06:27:00Z";
  // The colours of a thing's parts, and of the lamps' own.
  const colours = (o: THREE.Object3D) => {
    const seen: number[] = [];
    o.traverse((part) => {
      if (part instanceof THREE.Mesh) seen.push((part.material as THREE.MeshBasicMaterial).color.getHex());
    });
    return seen;
  };
  const run = (stock: Stock) => {
    for (let n = 0; stock.tick(0.02); n++) if (n > 5000) throw new Error("the stock never came to a stand");
  };

  test("a held wagon has chocks at its wheels and a red flag, until it is let go", () => {
    const well = at(bead("signalbox-a"));
    const stock = new Stock(well, kit);
    const a = wagon(stock, "signalbox-a");
    expect(meshes(a)).toBe(1);
    stock.show(at(bead("signalbox-a", { hold: true })), { tween: true });
    expect(colours(a).filter((c) => c === tint.chock).length).toBe(2);
    expect(colours(a)).toContain(lamp.stop);
    // No chocks under it while the shunter takes it into the siding: they lie where it stands.
    const chocks = () => {
      const shown: boolean[] = [];
      a.traverse((part) => {
        if (part instanceof THREE.Mesh && (part.material as THREE.MeshBasicMaterial).color.getHex() === tint.chock) shown.push(part.parent!.visible);
      });
      return shown;
    };
    stock.tick(0.02);
    expect(chocks()).toEqual([false, false]);
    run(stock);
    expect(chocks()).toEqual([true, true]);
    // Nothing flashes for a hold: the picture comes to a stand.
    expect(stock.tick(0.1)).toBe(false);
    expect(tip(a.userData.bead as Bead, false)).toContain("· held");

    stock.show(well, { tween: true });
    expect(meshes(a)).toBe(1);
  });

  test("a refused move is a lamp on the wagon, flashing red until the bead moves", () => {
    const refused = at(bead("signalbox-a", { fault: { kind: "move_refused", at: when } }));
    const stock = new Stock(at(bead("signalbox-a")), kit);
    const a = wagon(stock, "signalbox-a");
    expect(stock.tick(0.1)).toBe(false);
    stock.show(refused, { tween: true });
    expect(meshes(a)).toBe(3);
    // Lit, dark, lit: and the picture never comes to a stand.
    const lit: boolean[] = [];
    for (let n = 0; n < 40; n++) {
      expect(stock.tick(0.05)).toBe(true);
      const seen = colours(a);
      expect(seen.includes(lamp.stop) || seen.includes(tint.dark)).toBe(true);
      lit.push(seen.includes(lamp.stop));
    }
    expect(lit).toContain(true);
    expect(lit).toContain(false);
    expect(tip(a.userData.bead as Bead, false)).toContain(`· move refused ${clock(when)}`);
    // A reader who asked for less motion sees it lit, and still.
    stock.still = true;
    expect(stock.tick(0.1)).toBe(false);
    expect(colours(a)).toContain(lamp.stop);
    stock.still = false;

    stock.show(at(bead("signalbox-a", { stage: "review" })), { tween: true });
    expect(meshes(a)).toBe(1);
    run(stock);
    expect(stock.tick(0.1)).toBe(false);
  });

  test("a bead with no route lights its platform's lamp, not its wagon's", () => {
    const lost = at(bead("signalbox-a", { fault: { kind: "unrouted", at: when } }));
    const stock = new Stock(lost, kit);
    expect(meshes(wagon(stock, "signalbox-a"))).toBe(1);
    const post = lost.lamps[0]!;
    const bulbs = () => {
      const found: THREE.Mesh[] = [];
      stock.root.traverse((o) => {
        // The works have lamps too, and none of them is lit.
        const lit = o instanceof THREE.Mesh && ([lamp.stop, tint.dark] as number[]).includes((o.material as THREE.MeshBasicMaterial).color.getHex());
        if (lit && o.geometry instanceof THREE.SphereGeometry) found.push(o);
      });
      return found;
    };
    expect(bulbs().map((b) => [b.position.x, b.position.z])).toEqual([[post.at.x, post.at.z]]);
    expect(stock.tick(0.1)).toBe(true);
    stock.show(at(bead("signalbox-a")), { tween: true });
    expect(bulbs()).toEqual([]);
    expect(stock.tick(1)).toBe(false);
  });

  test("the tip names what is wrong in words", () => {
    expect(wrong(bead("signalbox-a"))).toBeUndefined();
    expect(wrong(bead("signalbox-a", { hold: true }))).toBe("held");
    expect(wrong(bead("signalbox-a", { fault: { kind: "gave_up", at: when } }))).toBe(`session gave up ${clock(when)}`);
    expect(wrong(bead("signalbox-a", { fault: { kind: "harness_error", at: when } }))).toBe(`session harness error ${clock(when)}`);
    expect(wrong(bead("signalbox-a", { fault: { kind: "ended_question", at: when } }))).toBe(`session ended with question ${clock(when)}`);
    expect(wrong(bead("signalbox-a", { fault: { kind: "stranded", at: when } }))).toBe(`stranded ${clock(when)}`);
    expect(wrong(bead("signalbox-a", { fault: { kind: "unrouted", at: when } }))).toBe(`unrouted ${clock(when)}`);
    expect(wrong(bead("signalbox-a", { hold: true, fault: { kind: "move_refused", at: "" } }))).toBe("held · move refused");
    expect(tip(bead("signalbox-a", { fault: { kind: "move_refused", at: when } }), false)).toBe(`signalbox-a\nsignalbox-a\nsignalbox · task · new · move refused ${clock(when)}`);
  });
});

describe("the weather of the stock", () => {
  const now = Date.parse("2099-01-20T00:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const bead = (id: string, days: number, over: Partial<Bead> = {}): Bead => ({
    id,
    title: id,
    type: "task",
    stage: "backlog",
    depot: "signalbox",
    priority: 2,
    created_at: new Date(now - days * day).toISOString(),
    ...over,
  });
  // The yard a time later: every wagon that much older.
  const at = (beads: Bead[], later = 0) => layout({ ...yard, beads }, {}, now + later * day);
  const wagon = (stock: Stock, id: string) => stock.root.children.find((o) => (o.userData.bead as Bead | undefined)?.id === id)!;
  const paint = (o: THREE.Object3D) => {
    const seen: THREE.MeshStandardMaterial[] = [];
    o.traverse((part) => {
      if (part instanceof THREE.Mesh) seen.push(part.material as THREE.MeshStandardMaterial);
    });
    return seen;
  };

  test("the paint dulls, rusts, and moss grows on top; a wagon that moves on is fresh again", () => {
    const beads = [bead("signalbox-a", 0), bead("signalbox-b", 0)];
    const stock = new Stock(at(beads), kit);
    const a = wagon(stock, "signalbox-a");
    const [fresh] = paint(a);
    const tinted = (colour: number) => fresh!.color.clone().multiply(new THREE.Color(colour)).getHex();

    stock.show(at(beads, 3), { tween: true });
    expect(paint(a).map((m) => m.color.getHex())).toEqual([tinted(weathering.dull)]);
    stock.show(at(beads, 7), { tween: true });
    expect(paint(a).map((m) => m.color.getHex())).toEqual([tinted(weathering.rusted)]);
    expect(fresh!.color.getHex()).not.toBe(tinted(weathering.rusted));

    // Moss lies on the rust, on the wagon's top.
    stock.show(at(beads, 14), { tween: true });
    const mossy = paint(a);
    expect(mossy[0]!.color.getHex()).toBe(tinted(weathering.rusted));
    const moss = mossy.filter((m) => m.color.getHex() === weathering.moss);
    expect(moss.length).toBe(mossy.length - 1);
    expect(moss.length).toBeGreaterThan(0);
    const top = new THREE.Box3().setFromObject(a).max.y;
    expect(top).toBeGreaterThan(1.3);
    expect(top).toBeLessThan(1.4);
    expect((a.userData.age as number)).toBe(14);

    // Built now: it waits on the yard, and its own paint is back.
    stock.show(at(beads.map((b) => ({ ...b, stage: "new" })), 14), { tween: true });
    expect(paint(a)).toEqual([fresh]);
    expect(a.userData.age).toBeUndefined();
  });

  test("a step's paint is one material, whatever wears it", () => {
    // Two copies of one model have one material, as the kit's files do.
    const shared = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const twins: Kit = {
      ...kit,
      make: (part, pick) => (part === "wagon" ? new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.3, 1.2), shared)) : kit.make(part, pick)),
    };
    const stock = new Stock(at([bead("signalbox-a", 8), bead("signalbox-b", 9), bead("signalbox-c", 4)]), twins);
    const [a, b, c] = ["signalbox-a", "signalbox-b", "signalbox-c"].map((id) => paint(wagon(stock, id))[0]!);
    expect(a).toBe(b);
    expect(a).not.toBe(shared);
    expect(c).not.toBe(a);
    // The kit's own is as it was.
    expect(shared.color.getHex()).toBe(0x808080);
  });

  test("the tip says how long it has waited, in days", () => {
    expect(waited("backlog", 9.7)).toBe("in backlog 9 days");
    expect(waited("decide", 1.2)).toBe("in decide 1 day");
    expect(waited("decide", 0.04)).toBe("in decide under a day");
    const old = bead("signalbox-a", 9);
    expect(tip(old, false, 9.2)).toBe("signalbox-a\nsignalbox-a\nsignalbox · task · backlog\nin backlog 9 days");
    expect(tip(old, false)).toBe("signalbox-a\nsignalbox-a\nsignalbox · task · backlog");
  });
});

describe("the colours of the stock", () => {
  const bead = (id: string, type: string, over: Partial<Bead> = {}): Bead => ({ id, title: id, type, stage: "backlog", depot: "signalbox", priority: 2, created_at: "2099-01-01T00:00:00Z", ...over });
  // The paint of a thing's body: its own parts, and not what is put on it.
  const body = (o: THREE.Object3D) => {
    const seen: THREE.Material[] = [];
    o.traverse((part) => {
      if (part instanceof THREE.Mesh) seen.push(...([part.material].flat() as THREE.Material[]));
    });
    return seen;
  };
  // A train stands at its platform with its wagons alone: the others are
  // at their own.
  const beads = [bead("signalbox-a", "task", { stage: "new" }), bead("yardr-b", "task", { depot: "yardr" }), bead("signalbox-t", "train"), bead("signalbox-w", "wagon", { train: "signalbox-t" }), bead("aiquokka-s", "spike", { depot: "aiquokka" })];

  test("a wagon says nothing of its bead's type by its paint: a box is the kit's blue for every type, a locomotive's the kit's green", () => {
    const stock = new Stock(layout({ ...yard, beads }), kit);
    const of = (id: string) => body(stock.root.children.find((o) => (o.userData.bead as Bead | undefined)?.id === id)!);
    for (const id of ["signalbox-a", "yardr-b", "signalbox-w", "aiquokka-s"]) expect(of(id), id).toEqual([paint(stand.wagon)]);
    expect(of("signalbox-t")).toEqual([paint(stand.locomotive)]);
    // Nothing that rolls is left for the scene to paint, a shunter neither.
    stock.root.traverse((part) => {
      if (part instanceof THREE.Mesh) for (const m of [part.material].flat()) expect((m as THREE.Material).name).not.toBe(TINT);
    });
  });

  test("night leaves a wagon's colour as it is, under the weather too: the kit's is the same by day and by night", () => {
    const now = Date.parse("2099-01-09T00:00:00Z");
    const stock = new Stock(layout({ ...yard, beads: [bead("signalbox-a", "task"), bead("signalbox-b", "task", { created_at: "2099-01-08T23:00:00Z" })] }, {}, now), kit);
    const of = (id: string) => (body(stock.root.children.find((o) => (o.userData.bead as Bead | undefined)?.id === id)!)[0] as THREE.MeshLambertMaterial).color.getHex();
    const rusted = new THREE.Color(stand.wagon).multiply(new THREE.Color(weathering.rusted)).getHex();
    expect([of("signalbox-b"), of("signalbox-a")]).toEqual([stand.wagon, rusted]);
    dress(true);
    expect([of("signalbox-b"), of("signalbox-a")]).toEqual([stand.wagon, rusted]);
    dress(false);
  });

  test("a building of the scene's own is its kind's accents: a signal box, the telegraph's poles, a peer's board", () => {
    const worn = new Set<THREE.Material>();
    draw(layout(yard), kit).root.traverse((part) => {
      if (part instanceof THREE.Mesh) for (const m of [part.material].flat()) worn.add(m as THREE.Material);
    });
    for (const kind of ["box", "post", "board"] as const) {
      for (const accent of building[kind]) expect(worn.has(paint(accent)), `${kind} ${accent}`).toBe(true);
    }
    // The kit's are their boxes here: all walls.
    for (const kind of ["station", "hut", "works"] as const) expect(worn.has(paint(building[kind][0])), kind).toBe(true);
    // Nothing that stands is a fault's red.
    expect(worn.has(paint("red")) || worn.has(paint("maroon")) || worn.has(paint(lamp.stop))).toBe(false);
  });
});

describe("the shunters of the stock", () => {
  // signalbox's track, with nothing on it but what a test puts there.
  const TRACK = "signalbox/default";
  const bead = (id: string, stage: string): Bead => ({ id, title: id, type: "task", stage, depot: "signalbox", priority: 2, created_at: "2000-01-01T00:00:00Z" });
  const at = (...beads: Bead[]) => layout({ ...yard, beads });
  const empty = at();
  const track = empty.tracks.find((t) => t.key === TRACK)!;
  const shunter = (stock: Stock, key = TRACK) => stock.root.children.find((o) => o.userData.shunter === key)!;
  const wagon = (stock: Stock, id: string) => stock.root.children.find((o) => (o.userData.bead as Bead | undefined)?.id === id && o.userData.crew !== true);
  const stands = (l: ReturnType<typeof layout>, id: string) => l.vehicles.find((v) => v.key === id)!.at;
  const wears = (o: THREE.Object3D) => {
    const seen: THREE.Material[] = [];
    o.traverse((part) => {
      if (part instanceof THREE.Mesh) seen.push(part.material as THREE.Material);
    });
    return seen;
  };
  // On until nothing moves: what was seen each time comes back.
  const run = <T>(stock: Stock, see: () => T): T[] => {
    const seen: T[] = [];
    for (let n = 0; stock.tick(0.02); n++) {
      seen.push(see());
      if (n > 5000) throw new Error("the stock never came to a stand");
    }
    return seen;
  };

  test("one for every track, parked on its headshunt; a peer's line has its own, and the peer's is out of sight", () => {
    const stock = new Stock(empty, kit);
    for (const t of empty.tracks) {
      expect(t.park, t.key).toEqual({ x: t.at.x - HEADSHUNT + 2, z: t.at.z });
      expect(shunter(stock, t.key).position, t.key).toMatchObject({ x: t.park!.x, y: 0, z: t.park!.z });
    }
    expect(stock.root.children.filter((o) => o.userData.shunter !== undefined).length).toBe(empty.tracks.length + 2 * empty.peers.length);
    const [line] = empty.peers;
    expect(shunter(stock, `${line!.key}/out`)).toMatchObject({ visible: true, position: { x: GOODS_END + COUPLING } });
    expect(shunter(stock, `${line!.key}/in`).visible).toBe(false);
    // No bead's: the pointer asks a wagon, not its engine.
    expect(stock.beads.some((o) => o.userData.shunter !== undefined)).toBe(false);
    expect(stock.tick(0.1)).toBe(false);
  });

  test("a depot's track has the kit's shunter, and a peer's line its locomotive, both ways", () => {
    // What the kit was asked for, by the model it gave.
    const parts = new Map<THREE.Object3D, Part>();
    const asked: Kit = {
      ...kit,
      make(part, pick) {
        const made = kit.make(part, pick);
        parts.set(made, part);
        return made;
      },
    };
    const stock = new Stock(empty, asked);
    const part = (key: string) => parts.get(shunter(stock, key));
    expect(empty.tracks.length).toBeGreaterThan(0);
    for (const t of empty.tracks) expect(part(t.key), t.key).toBe("shunter");
    expect(empty.peers.length).toBeGreaterThan(0);
    for (const p of empty.peers) {
      expect(part(`${p.key}/out`), p.key).toBe("locomotive");
      expect(part(`${p.key}/in`), p.key).toBe("locomotive");
    }
    // In the kit's own paint, as a train's: the two that meet are alike.
    const [line] = empty.peers;
    expect(wears(shunter(stock, `${line!.key}/out`))).toEqual([paint(stand.locomotive)]);
    expect(wears(shunter(stock, `${line!.key}/in`))).toEqual(wears(shunter(stock, `${line!.key}/out`)));
    // A train keeps its locomotive, and no engine of a track is one.
    expect(wears(shunter(stock))).toEqual([paint("slate")]);
  });

  test("the locomotive fits a peer's line at the yard's end: clear of the goods there, and on the rail", () => {
    // The kit's locomotive is 2.6 long and a van 2.7 (train-locomotive-a,
    // train-carriage-box): longer than the diesel's 2.4.
    const [LOCOMOTIVE, VAN] = [2.6, 2.7];
    const [line] = empty.peers;
    const stock = new Stock(empty, kit);
    // Its own, parked: behind it the goods it will take on.
    const out = shunter(stock, `${line!.key}/out`).position.x;
    expect(out - LOCOMOTIVE / 2).toBeGreaterThan(line!.at.x + GOODS_END + VAN / 2);
    // The peer's, come in: before the goods it brought, where the line begins.
    const engine = shunter(stock, `${line!.key}/in`);
    stock.goods(line!.name, "in", "mail", 1);
    stock.tick(goodsSeconds(1));
    expect(engine.visible).toBe(true);
    expect(engine.position.x).toBeCloseTo(line!.at.x + GOODS_END - COUPLING);
    expect(engine.position.x + LOCOMOTIVE / 2).toBeLessThan(line!.at.x + GOODS_END - VAN / 2);
    expect(engine.position.x - LOCOMOTIVE / 2).toBeGreaterThan(line!.at.x);
  });

  test("an advance is the shunter coming for the wagon and taking it to the next platform", () => {
    const [from, to] = [at(bead("w", "new")), at(bead("w", "review"))];
    const stock = new Stock(from, kit);
    const [engine, w] = [shunter(stock), wagon(stock, "w")!];
    stock.show(to, { tween: true });
    // Not by itself: it stands until it is fetched.
    expect(w.position).toMatchObject(stands(from, "w"));
    stock.tick(0.2);
    expect(w.position).toMatchObject(stands(from, "w"));
    expect(engine.position.x).toBeGreaterThan(track.park!.x);
    const seen = run(stock, () => ({ wagon: w.position.x, engine: engine.position.x }));
    const moving = seen.filter((s) => s.wagon > stands(from, "w").x && s.wagon < stands(to, "w").x);
    expect(moving.length).toBeGreaterThan(10);
    for (const s of moving) expect(s.engine - s.wagon).toBeCloseTo(COUPLING);
    expect(w.position).toMatchObject(stands(to, "w"));
    expect(w.rotation.y).toBe(0);
    expect(engine.position).toMatchObject(track.park!);
  });

  test("a scrub puts the wagon at its place and the shunter at its own, at once", () => {
    const [from, to] = [at(bead("w", "new")), at(bead("w", "review"))];
    const stock = new Stock(from, kit);
    stock.show(to, { tween: true });
    stock.tick(0.6);
    expect(shunter(stock).position.x).not.toBe(track.park!.x);
    stock.show(from, { tween: false });
    expect(wagon(stock, "w")!.position).toMatchObject(stands(from, "w"));
    expect(shunter(stock).position).toMatchObject(track.park!);
    expect(stock.tick(0.1)).toBe(false);
  });

  test("a shunter's job is two couplings for the page to sound: the order taken, and its wagons let go; a scrub is none", () => {
    const [from, to] = [at(bead("w", "new")), at(bead("w", "review"))];
    const stock = new Stock(from, kit);
    expect(stock.coupled).toBe(0);
    stock.show(to, { tween: true });
    expect(stock.coupled).toBe(1);
    run(stock, () => undefined);
    expect(stock.coupled).toBe(2);
    stock.coupled = 0;
    // Back by a scrub, and on again by one: nothing was seen to move.
    stock.show(from, { tween: false });
    stock.show(to, { tween: false });
    // Given up half way: the wagons were never let go of.
    stock.show(from, { tween: true });
    stock.tick(0.6);
    stock.show(to, { tween: false });
    run(stock, () => undefined);
    expect(stock.coupled).toBe(1);
  });

  test("more moves than a shunter keeps up with are not transported: the picture is the state", () => {
    const stages = ["backlog", "new", "review", "approved", "decide"];
    const ids = ["a", "b", "c", "d"];
    const from = at(...ids.map((id, i) => bead(id, stages[i]!)));
    const to = at(...ids.map((id, i) => bead(id, stages[i + 1]!)));
    expect(ids.length).toBeGreaterThan(BACKLOG);
    const stock = new Stock(from, kit);
    stock.show(to, { tween: true });
    for (const id of ids) expect(wagon(stock, id)!.position, id).toMatchObject(stands(to, id));
    expect(shunter(stock).position).toMatchObject(track.park!);
    expect(stock.tick(0.1)).toBe(false);
    // As many as it keeps up with are taken, one after another.
    const few = new Stock(from, kit);
    few.show(at(...ids.map((id, i) => bead(id, stages[i < BACKLOG ? i + 1 : i]!))), { tween: true });
    for (const id of ids.slice(0, BACKLOG)) expect(wagon(few, id)!.position, id).toMatchObject(stands(from, id));
    run(few, () => 0);
    for (const id of ids.slice(0, BACKLOG)) expect(wagon(few, id)!.position, id).toMatchObject(stands(to, id));
  });

  test("the wagons behind close up when the one before them has been pulled away, not before", () => {
    const from = at(bead("a", "new"), { ...bead("b", "new"), created_at: "2000-01-02T00:00:00Z" });
    const to = at(bead("a", "review"), { ...bead("b", "new"), created_at: "2000-01-02T00:00:00Z" });
    const stock = new Stock(from, kit);
    const [a, b] = [wagon(stock, "a")!, wagon(stock, "b")!];
    stock.show(to, { tween: true });
    const seen = run(stock, () => ({ a: a.position.x, b: b.position.x }));
    // While the first stood, the second did too.
    for (const s of seen.filter((s) => s.a === stands(from, "a").x)) expect(s.b).toBe(stands(from, "b").x);
    expect(b.position).toMatchObject(stands(to, "b"));
    expect(stands(to, "b")).toEqual(stands(from, "a"));
  });

  test("a wagon in the way of one coming in makes room at once", () => {
    // The older bead stands first at a platform: the one there moves back.
    const young = { ...bead("b", "review"), created_at: "2000-01-02T00:00:00Z" };
    const [from, to] = [at(bead("a", "new"), young), at(bead("a", "review"), young)];
    expect(stands(to, "a")).toEqual(stands(from, "b"));
    const stock = new Stock(from, kit);
    const [a, b] = [wagon(stock, "a")!, wagon(stock, "b")!];
    stock.show(to, { tween: true });
    stock.tick(TWEEN_MIN);
    stock.tick(0.01);
    expect(b.position).toMatchObject(stands(to, "b"));
    expect(a.position).toMatchObject(stands(from, "a"));
    run(stock, () => 0);
    expect(a.position).toMatchObject(stands(to, "a"));
  });

  test("a bead that left goes out past the buffer behind the shunter, and is gone", () => {
    const stock = new Stock(at(bead("w", "approved")), kit);
    const [engine, w] = [shunter(stock), wagon(stock, "w")!];
    stock.show(empty, { tween: true, left: new Set(["w"]) });
    expect(stock.beads).not.toContain(w);
    expect(stock.root.children).toContain(w);
    const seen = run(stock, () => ({ wagon: w.position.x, engine: engine.position.x }));
    expect(Math.max(...seen.map((s) => s.wagon))).toBeCloseTo(track.at.x + track.length + RUN_OUT, 0);
    expect(Math.max(...seen.map((s) => s.engine))).toBeGreaterThan(track.at.x + track.length + RUN_OUT);
    expect(stock.root.children).not.toContain(w);
    expect(engine.position).toMatchObject(track.park!);
  });

  test("a peer's goods wait out of sight for their engine, run behind it, and are gone", () => {
    const [line] = empty.peers;
    for (const way of ["out", "in"] as const) {
      const stock = new Stock(empty, kit);
      const engine = shunter(stock, `${line!.key}/${way}`);
      const before = new Set(stock.root.children);
      stock.goods(line!.name, way, "mail", 1);
      const goods = stock.root.children.find((o) => !before.has(o))!;
      expect(goods.visible).toBe(false);
      stock.tick(goodsSeconds(1) / 2);
      expect(goods.visible && engine.visible).toBe(true);
      // The engine first, the way they go.
      expect((engine.position.x - goods.position.x) * (way === "out" ? 1 : -1)).toBeCloseTo(COUPLING);
      run(stock, () => 0);
      expect(stock.root.children).not.toContain(goods);
      expect(engine.visible).toBe(way === "out");
    }
  });
});

describe("the lamps of the wagons that wait", () => {
  const bead = (id: string, over: Partial<Bead> = {}): Bead => ({ id, title: id, type: "task", stage: "backlog", depot: "signalbox", priority: 2, created_at: "2000-01-01T00:00:00Z", ...over });
  const at = (beads: Bead[], edges: Edge[]) => layout({ ...yard, beads, edges });
  const wagon = (stock: Stock, id: string) => stock.root.children.find((o) => (o.userData.bead as Bead | undefined)?.id === id && o.userData.crew !== true)!;
  const amber = (o: THREE.Object3D) => {
    let n = 0;
    o.traverse((part) => {
      if (part instanceof THREE.Mesh && (part.material as THREE.MeshBasicMaterial).color.getHex() === lamp.wait) n++;
    });
    return n;
  };
  // What the stock draws that is no wagon's own: a line between two wagons
  // would be one more of these.
  const loose = (stock: Stock) => {
    let n = 0;
    stock.root.traverse((o) => {
      if (o instanceof THREE.Mesh) n++;
    });
    return n - stock.root.children.filter((o) => o.userData.bead !== undefined).reduce((sum, o) => sum + meshes(o), 0);
  };
  const meshes = (o: THREE.Object3D) => {
    let n = 0;
    o.traverse((part) => {
      if (part instanceof THREE.Mesh) n++;
    });
    return n;
  };
  const a = bead("signalbox-a", { stage: "new" });
  const b = bead("signalbox-b");
  const waits = [{ from: "signalbox-a", to: "signalbox-b" }];

  test("across platforms of one board: an amber lamp on the wagon that waits, and no line between the two", () => {
    const stock = new Stock(at([a, b], waits), kit);
    const [waiting, blocker] = [wagon(stock, "signalbox-b"), wagon(stock, "signalbox-a")];
    expect(amber(waiting)).toBe(1);
    expect(amber(blocker)).toBe(0);
    // The edge adds the lamp to its wagon and nothing else to the yard.
    expect(loose(stock)).toBe(loose(new Stock(at([a, b], []), kit)));
    expect(tip(waiting.userData.bead as Bead, false, undefined, waiting.userData.waits as string[])).toContain("\nwaits for signalbox-a (signalbox · new)");
    expect(tip(blocker.userData.bead as Bead, false, undefined, blocker.userData.waits as string[])).not.toContain("waits for");
    // The lamp is lit and still: the picture comes to a stand.
    expect(stock.tick(0.1)).toBe(false);
  });

  test("at one platform: the same lamp, and no line", () => {
    const beside = { ...a, stage: "backlog" };
    const stock = new Stock(at([beside, b], waits), kit);
    expect(amber(wagon(stock, "signalbox-b"))).toBe(1);
    expect(amber(wagon(stock, "signalbox-a"))).toBe(0);
    expect(loose(stock)).toBe(loose(new Stock(at([beside, b], []), kit)));
    expect(wagon(stock, "signalbox-b").userData.waits).toEqual(["waits for signalbox-a (signalbox · backlog)"]);
  });

  test("the lamp stays lit and its tip follows the blocker when a shunter moves it", () => {
    const stock = new Stock(at([a, b], waits), kit);
    const waiting = wagon(stock, "signalbox-b");
    stock.show(at([{ ...a, stage: "review" }, b], waits), { tween: true });
    expect(amber(waiting)).toBe(1);
    expect(waiting.userData.waits).toEqual(["waits for signalbox-a (signalbox · review)"]);
  });

  test("a wagon that waits for one on another board has the same lamp, and its tip names the bead, the board and the stage", () => {
    const far = bead("yardr-x", { depot: "yardr" });
    const edges = [{ from: "yardr-x", to: "signalbox-b" }];
    const l = at([far, b], edges);
    const stock = new Stock(l, kit);
    const waiting = wagon(stock, "signalbox-b");
    expect(amber(waiting)).toBe(1);
    expect(amber(wagon(stock, "yardr-x"))).toBe(0);
    expect(awaits({ on: "yardr-x", depot: "yardr", stage: "backlog" })).toBe("waits for yardr-x (yardr · backlog)");
    expect(tip(waiting.userData.bead as Bead, false, 9, waiting.userData.waits as string[])).toBe("signalbox-b\nsignalbox-b\nsignalbox · task · backlog\nin backlog 9 days\nwaits for yardr-x (yardr · backlog)");
    expect(stock.tick(0.1)).toBe(false);
  });

  test("a wagon that waits for two has one lamp, and a line of its tip for each", () => {
    const far = bead("yardr-x", { depot: "yardr" });
    const stock = new Stock(at([a, far, b], [...waits, { from: "yardr-x", to: "signalbox-b" }]), kit);
    const waiting = wagon(stock, "signalbox-b");
    expect(amber(waiting)).toBe(1);
    expect(waiting.userData.waits).toEqual(["waits for signalbox-a (signalbox · new)", "waits for yardr-x (yardr · backlog)"]);
  });

  test("closing the blocker puts the lamp out, and the tip says no more of it", () => {
    const stock = new Stock(at([a, b], waits), kit);
    const waiting = wagon(stock, "signalbox-b");
    stock.show(at([b], waits), { tween: true });
    expect(amber(waiting)).toBe(0);
    expect(waiting.userData.waits).toEqual([]);
  });
});

describe("the works of the stock", () => {
  const key = "signalbox/default/approved/signalbox-assembly";
  const bare: Yard = { ...yard, beads: [] };
  const at = (gate?: Gate) => layout(bare, {}, undefined, gate ? { [key]: gate } : {});
  const running: Gate = { runs: [{ bead: "signalbox-a", since: "2000-01-01T06:27:00Z" }] };
  const landed: Gate = { runs: [], last: "landed" };
  const failed: Gate = { runs: [], last: "failed" };
  // The puffs in the air, and the lit lamps of the works: no wagon is there
  // to have one.
  const puffs = (stock: Stock) => {
    const seen: THREE.Mesh[] = [];
    stock.root.traverseVisible((o) => {
      if (o instanceof THREE.Mesh && (o.material as THREE.MeshBasicMaterial).color.getHex() === smoke) seen.push(o);
    });
    return seen;
  };
  const lamps = (stock: Stock) => {
    const seen: number[] = [];
    stock.root.traverseVisible((o) => {
      if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry && o.material instanceof THREE.MeshBasicMaterial) seen.push(o.material.color.getHex());
    });
    return seen.filter((c) => c === lamp.clear || c === lamp.stop);
  };
  const works = at().sheds.filter((s) => s.kind === "works").length;

  test("a works with no run has a lamp that is out, and no smoke", () => {
    const stock = new Stock(at(), kit);
    expect(works).toBeGreaterThan(1);
    expect(puffs(stock)).toEqual([]);
    expect(lamps(stock)).toEqual([]);
    expect(stock.tick(0.02)).toBe(false);
    expect([gateLamp(undefined), gateLamp(running), gateLamp({ runs: [] })]).toEqual([lamp.out, lamp.out, lamp.out]);
    expect([gateLamp(landed), gateLamp(failed)]).toEqual([lamp.clear, lamp.stop]);
    // A run open puts out what the one before it left.
    expect(gateLamp({ ...running, last: "failed" })).toBe(lamp.out);
  });

  test("a run that starts is smoke from the chimney's mouth, a puff at a time; its end lights the lamp and the smoke rises away", () => {
    const picture = draw(at(), kit);
    const stock = new Stock(at(), kit, picture.sheds);
    stock.show(at(running), { tween: true });
    expect(puffs(stock)).toHaveLength(1);
    // Over the stub of its box: a quarter of its length right of its middle.
    const shed = at().sheds.find((s) => s.key === key)!;
    const mouth = puffs(stock)[0]!.getWorldPosition(new THREE.Vector3());
    expect(mouth.x).toBeCloseTo(shed.at.x + 0.5);
    expect(mouth.z).toBeCloseTo(shed.at.z);
    expect(mouth.y).toBeCloseTo(new THREE.Box3().setFromObject(picture.sheds.find((o) => (o.userData.shed as Shed).key === key)!).max.y);
    expect(stock.tick(PUFF_SECONDS / 2)).toBe(true);
    expect(puffs(stock).length).toBeGreaterThan(1);
    expect(puffs(stock).length).toBeLessThan(PUFFS);
    for (let t = 0; t < 2 * PUFF_SECONDS; t += 0.1) stock.tick(0.1);
    expect(puffs(stock)).toHaveLength(PUFFS);
    expect(puffs(stock).every((p) => p.getWorldPosition(new THREE.Vector3()).y >= mouth.y)).toBe(true);
    expect(lamps(stock)).toEqual([]);
    // The pointer is told of the run.
    const told = picture.sheds.find((o) => (o.userData.shed as Shed).key === key)!.userData.shed as Shed;
    expect(house(told)).toBe(`signalbox-assembly\nexec · limit 1\nruns the gate on signalbox-a since ${clock(running.runs[0]!.since!)}`);

    stock.show(at(landed), { tween: true });
    expect(lamps(stock)).toEqual([lamp.clear]);
    expect(puffs(stock)).toHaveLength(PUFFS);
    stock.tick(PUFF_SECONDS / 2);
    expect(puffs(stock).length).toBeLessThan(PUFFS);
    expect(stock.tick(PUFF_SECONDS / 2)).toBe(false);
    expect(puffs(stock)).toEqual([]);
    // It stays green until the next run starts.
    stock.show(at(landed), { tween: true });
    expect(lamps(stock)).toEqual([lamp.clear]);
    stock.show(at(running), { tween: true });
    expect(lamps(stock)).toEqual([]);
    stock.show(at(failed), { tween: true });
    expect(lamps(stock)).toEqual([lamp.stop]);
  });

  test("a scrub snaps: the whole plume of a run that is open, and none of one that is over", () => {
    const stock = new Stock(at(), kit);
    stock.show(at(running), { tween: false });
    expect(puffs(stock)).toHaveLength(PUFFS);
    stock.show(at(failed), { tween: false });
    expect(puffs(stock)).toEqual([]);
    expect(lamps(stock)).toEqual([lamp.stop]);
    expect(stock.tick(0.02)).toBe(false);
    stock.show(at(), { tween: false });
    expect(lamps(stock)).toEqual([]);
  });

  test("a picture that does not move has the plume standing, and the tip says how the last run ended", () => {
    const stock = new Stock(at(), kit);
    stock.still = true;
    stock.show(at(running), { tween: true });
    expect(puffs(stock)).toHaveLength(PUFFS);
    expect(stock.tick(0.02)).toBe(false);
    stock.show(at(landed), { tween: true });
    expect(puffs(stock)).toEqual([]);
    const shed = (gate: Gate) => at(gate).sheds.find((s) => s.key === key)!;
    expect(house(shed(landed))).toBe("signalbox-assembly\nexec · limit 1\nlast run landed");
    expect(house(shed(failed))).toBe("signalbox-assembly\nexec · limit 1\nlast gate failed");
    expect(house(shed({ runs: [{ bead: "signalbox-a" }] }))).toBe("signalbox-assembly\nexec · limit 1\nruns the gate on signalbox-a");
  });
});

describe("the providers' silos", () => {
  const next = "2099-01-05T13:00:00Z";
  // The day and the time of it where the tests run.
  const at = (iso: string) => {
    const parts = new Map(new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(Date.parse(iso)).map((p) => [p.type, p.value]));
    return `${parts.get("weekday")} ${parts.get("hour")}:${parts.get("minute")}`;
  };
  const provider = (key: string, weekly?: number, short?: number): Provider => ({
    key,
    name: key.toUpperCase(),
    ...(weekly !== undefined ? { weekly: { used_percent: weekly, resets_at: next } } : {}),
    ...(short !== undefined ? { short: { used_percent: short, resets_at: next } } : {}),
  });
  const quota = (...providers: Provider[]): Quota => ({ taken_at: "2099-01-01T00:00:00Z", providers });
  // The fixture's crew are kimi and claude: a silo each.
  const towers = () => draw(layout(yard), kit).towers;
  const parts = (o: THREE.Object3D) => o.userData.silo as { week: THREE.Mesh; short: THREE.Mesh; name: { element: { textContent: string } }; plan: { element: { textContent: string } }; sign: { element: { textContent: string; className: string } } };
  const colour = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).color.getHex();
  const of = (all: THREE.Object3D[], key: string) => all.find((o) => o.userData.tower.provider === key)!;

  test("one for every provider in use, at its place, and until it is filled it stands empty and says unknown", () => {
    const l = layout(yard);
    const all = draw(l, kit).towers;
    expect(all.map((o) => [o.userData.tower.key, o.position.x, o.position.z])).toEqual(l.towers.map((t) => [t.key, t.at.x, t.at.z]));
    for (const o of all) {
      expect(parts(o).week.visible).toBe(false);
      expect(parts(o).short.visible).toBe(false);
      expect(parts(o).sign.element.textContent).toBe("unknown");
    }
  });

  test("the first indicator is as full as the week has left, the second as the five hours, the sign says the next delivery", () => {
    const all = towers();
    refuel(all, quota({ ...provider("claude", 55, 8), plan: "max" }, provider("kimi", 25)));
    const claude = parts(of(all, "claude"));
    expect(claude.week.visible).toBe(true);
    // Of the whole of each indicator, as high as it is at 100.
    refuel([of(all, "kimi")], quota(provider("kimi", 0, 0)));
    const full = parts(of(all, "kimi"));
    expect(claude.week.scale.y / full.week.scale.y).toBeCloseTo(0.45);
    expect(claude.short.scale.y / full.short.scale.y).toBeCloseTo(0.92);
    expect(full.short.scale.y).toBeLessThan(full.week.scale.y);
    expect(colour(claude.week)).toBe(iron);
    expect(claude.name.element.textContent).toBe("CLAUDE");
    expect(claude.plan.element.textContent).toBe("max");
    expect(claude.sign.element.textContent).toBe(`resets ${at(next)}`);
    expect(full.name.element.textContent).toBe("KIMI");
    expect(full.plan.element.textContent).toBe("");
    // Both outside the silo, to its right, the five hours' beyond the week's.
    const kimi = of(all, "kimi");
    kimi.updateMatrixWorld(true);
    const tank = new THREE.Box3().setFromObject(kimi.children.find((c) => !(c instanceof THREE.Mesh) && c.children.some((m) => m instanceof THREE.Mesh))!);
    const week = new THREE.Box3().setFromObject(full.week);
    const short = new THREE.Box3().setFromObject(full.short);
    expect(week.min.x).toBeGreaterThan(tank.max.x);
    expect(short.min.x).toBeGreaterThan(week.max.x);
    expect(week.min.y).toBeGreaterThan(0);
  });

  test("its band is its provider's colour, and overlay for one the table does not have", () => {
    const y = { ...yard, crew: [...yard.crew, { ...yard.crew[0]!, name: "c", kind: "codex" }, { ...yard.crew[0]!, name: "g", kind: "grok" }] };
    const band = (o: THREE.Object3D) => {
      const found: number[] = [];
      o.traverse((part) => {
        if (part instanceof THREE.Mesh && part.material instanceof THREE.MeshLambertMaterial && part.material.name !== TINT) found.push(part.material.color.getHex());
      });
      return found;
    };
    const all = draw(layout(y), kit).towers;
    expect(all.map((o) => o.userData.tower.provider).sort()).toEqual(["claude", "codex", "grok", "kimi"]);
    for (const o of all) {
      const provider = o.userData.tower.provider as string;
      expect(band(o), provider).toContain(shade(liveried(provider)));
      // No part is left in the kit's own tint.
      o.traverse((part) => {
        if (part instanceof THREE.Mesh) for (const m of [part.material].flat()) expect((m as THREE.Material).name).not.toBe(TINT);
      });
    }
    expect(liveried("claude")).toBe(livery.claude);
    expect(liveried("grok")).toBe("overlay");
    expect(liveried("toString")).toBe("overlay");
    expect(new Set(["claude", "codex", "kimi", "grok"].map(liveried)).size).toBe(4);
    // A refuel leaves the band as it is.
    refuel(all, quota(provider("claude", 99, 99)));
    expect(band(of(all, "claude"))).toContain(shade("peach"));
  });

  test("under 20 percent left the fill is amber, under 5 red, and at none there is no coal and the sign says out", () => {
    const all = towers();
    const kimi = parts(of(all, "kimi"));
    const filled = (weekly: number, short?: number) => refuel(all, quota(provider("kimi", weekly, short)));
    filled(80);
    expect(colour(kimi.week)).toBe(iron);
    filled(81, 96);
    expect(colour(kimi.week)).toBe(lamp.wait);
    expect(colour(kimi.short)).toBe(lamp.stop);
    filled(95.5, 85);
    expect(colour(kimi.week)).toBe(lamp.stop);
    expect(colour(kimi.short)).toBe(lamp.wait);
    expect(kimi.sign.element.textContent).toBe(`resets ${at(next)}`);
    expect(kimi.sign.element.className).toBe("label fuel plain");
    filled(100, 100);
    expect(kimi.week.visible).toBe(false);
    expect(kimi.short.visible).toBe(false);
    expect(kimi.sign.element.textContent).toBe(`out · resets ${at(next)}`);
    // Read from far out too, where a sign that only says when is hidden.
    expect(kimi.sign.element.className).toBe("label fuel");
    // The next delivery fills it again.
    filled(0);
    expect(kimi.week.visible).toBe(true);
    expect(colour(kimi.week)).toBe(iron);
  });

  test("a provider the quota does not have, and no quota at all, is a silo with empty indicators that says unknown", () => {
    const all = towers();
    refuel(all, quota(provider("claude", 10, 10)));
    expect(parts(of(all, "kimi")).sign.element.textContent).toBe("unknown");
    expect(parts(of(all, "kimi")).name.element.textContent).toBe("kimi");
    expect(parts(of(all, "kimi")).week.visible).toBe(false);
    expect(parts(of(all, "claude")).week.visible).toBe(true);
    refuel(all, undefined);
    for (const o of all) {
      expect(parts(o).week.visible).toBe(false);
      expect(parts(o).short.visible).toBe(false);
      expect(parts(o).sign.element.textContent).toBe("unknown");
    }
    // Five hours alone say nothing of the week: their indicator is filled, the sign is not.
    refuel(all, quota(provider("kimi", undefined, 50)));
    expect(parts(of(all, "kimi")).short.visible).toBe(true);
    expect(parts(of(all, "kimi")).sign.element.textContent).toBe("unknown");
  });

  test("the sign and the tip in words", () => {
    expect(resets({ used_percent: 1, resets_at: next })).toBe(`resets ${at(next)}`);
    expect(resets({ used_percent: 1 })).toBeUndefined();
    expect(resets({ used_percent: 1, resets_at: "soon" })).toBeUndefined();
    expect(delivery(undefined)).toBe("unknown");
    expect(delivery({ key: "k", name: "K", weekly: { used_percent: 100 } })).toBe("out");
    expect(delivery({ key: "k", name: "K", weekly: { used_percent: 40 } })).toBe("");
    expect(titled("kimi", undefined)).toBe("kimi");
    expect(fuelled("kimi", undefined)).toBe("kimi\nunknown");
    expect(fuelled("claude", { ...provider("claude", 55.4, 8), plan: "max" })).toBe(`CLAUDE · max\n45% of the week left, resets ${at(next)}\n92% of the 5 hours left, resets ${at(next)}`);
    expect(fuelled("grok", provider("grok", 15))).toBe(`GROK\n85% of the week left, resets ${at(next)}`);
  });

  test("the first view holds them: they stand left of the board's edge", () => {
    const l = layout(yard);
    const { bounds, towers } = draw(l, kit);
    expect(bounds.min.x).toBeLessThan(Math.min(...l.towers.map((t) => t.at.x)));
    // Each whole, the silo and its indicators, which stand higher than it.
    // The signals of the boards are higher still, and the bounds leave them
    // to what lies behind them.
    for (const o of towers) {
      const whole = new THREE.Box3().setFromObject(o);
      expect(whole.max.y).toBeGreaterThan(SILO_HEIGHT);
      expect(bounds.clone().expandByScalar(1e-6).containsBox(whole), o.userData.tower.key).toBe(true);
    }
  });
});
