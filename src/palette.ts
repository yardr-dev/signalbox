// The picture's colours, all of them but the kit's own, and the paint made of
// them. The look is Mini Motorways' (Dinosaur Polo Club) ground and labels,
// the kit's own models on it in the texture they came in, and Catppuccin's
// accents where the kit had painted a building a colour (kit.ts says which
// faces those are). So there are three kinds here. The tones are the greys
// and creams the ground, the track and the platforms are built of, one set
// by day and one by night. The accents are Catppuccin's, Latte's by day and
// Mocha's by night under the same names: the faces of what stands that the
// kit had in a colour are painted in them, and so is what the scene builds
// of boxes. What rolls is the kit's own, colours and all. The colours that mean something of their own (a lamp, a fault, the
// weather) are the same in both. Nothing else in the page names a colour of
// the picture: the labels' are the tones ink and pill, which the page hands
// to its stylesheet (main.ts).

import * as THREE from "three";

// By day: a cream map, the depots' beds a little darker. wall, pale, roof and
// slate are what the scene builds of boxes in (a platform's signal, a silo's
// indicators), and what a rail's faces are sorted into by how light the kit
// had them (kit.ts).
const day = {
  ground: 0xf4efe4,
  bed: 0xe8e1d2,
  // A sleeper: laid end to end they are the ribbon a track reads as.
  track: 0x968f85,
  platform: 0xd2cfc9,
  // A flow's last platform.
  terminal: 0xf7f4ee,
  wall: 0xfcfbf8,
  pale: 0xdcd8d0,
  roof: 0xaeaaa3,
  slate: 0x666a71,
  // A label's letters, and the pill they stand on.
  ink: 0x4a4f57,
  pill: 0xffffff,
};

export type Tone = keyof typeof day;

// By night: the same picture on a near-black blue, every tone in its place
// between the others, and the labels turned round.
const night: Record<Tone, number> = {
  ground: 0x141923,
  bed: 0x1c2330,
  track: 0x626b7e,
  platform: 0x353e4f,
  terminal: 0x465064,
  wall: 0x8f98ab,
  pale: 0x747d90,
  roof: 0x5c6578,
  slate: 0x495264,
  ink: 0xe4e7ec,
  pill: 0x262e3c,
};

// The tones as they are now: dress changes them.
export const palette: Record<Tone, number> = { ...day };

// Catppuccin's fourteen accents and the middle one of its three overlays
// (github.com/catppuccin/palette, palette.json 1.8.0): Latte by day.
const latte = {
  rosewater: 0xdc8a78,
  flamingo: 0xdd7878,
  pink: 0xea76cb,
  mauve: 0x8839ef,
  red: 0xd20f39,
  maroon: 0xe64553,
  peach: 0xfe640b,
  yellow: 0xdf8e1d,
  green: 0x40a02b,
  teal: 0x179299,
  sky: 0x04a5e5,
  sapphire: 0x209fb5,
  blue: 0x1e66f5,
  lavender: 0x7287fd,
  overlay: 0x8c8fa1,
};

export type Accent = keyof typeof latte;

// Mocha by night: an accent keeps its name, so what is mauve is mauve.
const mocha: Record<Accent, number> = {
  rosewater: 0xf5e0dc,
  flamingo: 0xf2cdcd,
  pink: 0xf5c2e7,
  mauve: 0xcba6f7,
  red: 0xf38ba8,
  maroon: 0xeba0ac,
  peach: 0xfab387,
  yellow: 0xf9e2af,
  green: 0xa6e3a1,
  teal: 0x94e2d5,
  sky: 0x89dceb,
  sapphire: 0x74c7ec,
  blue: 0x89b4fa,
  lavender: 0xb4befe,
  overlay: 0x7f849c,
};

// The accents as they are now: dress changes them with the tones.
export const accents: Record<Accent, number> = { ...latte };

// What stands, by its kind: two accents, the second a neighbour of the
// first. A building of boxes has its walls in one and its roof in the other.
// One of the kit's keeps its texture, and has the first where the kit had
// painted it its lightest colour and the second where another (kit.ts): a
// trim, for the kit's buildings are iron and white. The colour says nothing:
// a hut is a hut's colour in every depot. Red and maroon are no building's:
// red is a fault's and a stop lamp's. box is a signal box, post a pole of the
// telegraph, board a peer's sign.
export const building = {
  box: ["rosewater", "flamingo"],
  station: ["teal", "green"],
  hut: ["yellow", "peach"],
  office: ["sky", "sapphire"],
  works: ["lavender", "mauve"],
  silo: ["pink", "pink"],
  post: ["yellow", "yellow"],
  board: ["sapphire", "sapphire"],
} as const satisfies Record<string, readonly [wall: Accent, roof: Accent]>;
export type Building = keyof typeof building;

// A wagon and a locomotive are the kit's, in its texture, and no colour of
// theirs is named here but these two: what the box wears that stands for one
// whose model did not load. The lightest blue of the kit's blue container
// and the lightest green of its locomotive, as the texture has them, by day
// and by night as the texture is.
export const stand = { wagon: 0x658dd6, locomotive: 0x56c186 } as const;

// Lamps carry the signal's meaning.
// wait is the amber of a wagon that waits for another bead, out a lamp that
// is not lit.
export const lamp = { clear: 0x2fc46b, stop: 0xe5484d, wait: 0xffb224, out: 0x4b525b } as const;
// The grey of a works' smoke.
export const smoke = 0x70757c;
// The iron of the coal in a silo's indicators.
export const iron = 0x33373d;
// A silo's band by the provider whose quota it holds, the key as the yard
// has it (a group's kind): peach for Claude's orange, green for OpenAI's of
// codex, blue for kimi, and overlay for any other.
export const livery: Record<string, Accent> = { claude: "peach", codex: "green", kimi: "blue" };
export function liveried(provider: string): Accent {
  return Object.hasOwn(livery, provider) ? livery[provider]! : "overlay";
}
// The people are the kit's own, in its colours. A hard hat is ours, and what
// tells a crew from the top of the yard: hi-vis for builders, white for
// reviewers.
export const hat = { builder: 0xffd21f, reviewer: 0xffffff } as const;
// A lamp that flashes is dark between, and a wheel chock is its own orange.
export const fault = { dark: 0x4a1512, chock: 0xf58a1f } as const;

// What weather does to a wagon that waits: its paint, the kit's texture, is
// this much of what it was, and moss is a green of its own.
export const weathering = { dull: 0xa6a6a0, rusted: 0xb9744a, moss: 0x7c9a5e } as const;

// How much of the sun's light a face in shadow keeps: a soft shadow, and the
// only shading there is. A face that looks up has all of it, so the ground
// and every roof are their tone exactly.
export const SHADE = 0.76;

// A tone or an accent as it is now.
export function shade(of: Tone | Accent): number {
  return Object.hasOwn(palette, of) ? palette[of as Tone] : accents[of as Accent];
}

// Paint: one material for every tone, every accent and every colour that
// means something, shared by all that wear it. Matt, and every face of one shade:
// under one sun and seen from one side, a face is one flat colour.
const paints = new Map<Tone | Accent | number, THREE.MeshLambertMaterial>();
export function paint(of: Tone | Accent | number): THREE.MeshLambertMaterial {
  let m = paints.get(of);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: typeof of === "number" ? of : shade(of), flatShading: true });
    paints.set(of, m);
  }
  return m;
}

// A paint under a tint, for a wagon the weather has been at: one for every
// paint and tint, shared by the wagons that wear it. The kit's texture is a
// paint like any: it is white under its picture, and the tint goes there.
const worn = new Map<string, { m: THREE.Material; from: THREE.Material; by: number }>();
export function tinted(from: THREE.Material, by: number): THREE.Material {
  const key = `${from.uuid}/${by}`;
  let w = worn.get(key);
  if (!w) {
    w = { m: from.clone(), from, by };
    worn.set(key, w);
    tint(w);
  }
  return w.m;
}
function tint({ m, from, by }: { m: THREE.Material; from: THREE.Material; by: number }) {
  const { color } = m as THREE.MeshLambertMaterial;
  if (color) color.copy((from as THREE.MeshLambertMaterial).color).multiply(new THREE.Color(by));
}

// Day or night: every tone's and every accent's paint changes where it is,
// on what wears it, and so does the weathered paint made of it. What means
// something of its own stays.
export function dress(dark: boolean) {
  Object.assign(palette, dark ? night : day);
  Object.assign(accents, dark ? mocha : latte);
  for (const [of, m] of paints) if (typeof of !== "number") m.color.setHex(shade(of));
  for (const w of worn.values()) tint(w);
}

// A tone as a stylesheet writes it.
export function css(tone: Tone): string {
  return `#${palette[tone].toString(16).padStart(6, "0")}`;
}
