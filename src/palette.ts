// The picture's colours, all of them, and the paint made of them. The look is
// Mini Motorways' (Dinosaur Polo Club): flat colour, a pale ground, and
// nothing saturated but what says something. So there are two kinds here.
// The tones are the greys and creams everything is built of, one set by day
// and one by night; the colours that mean something (a lamp, a provider, a
// fault) are the same in both. Nothing else in the page names a colour of
// the picture: the labels' are the tones ink and pill, which the page hands
// to its stylesheet (main.ts).

import * as THREE from "three";

// By day: a cream map, the depots' beds a little darker, buildings off-white
// under grey roofs. The kits' models are sorted into wall, pale, roof and
// slate by how light each of their own colours is (kit.ts).
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

// Lamps and hard hats: a hat is what tells a crew from the top of the yard,
// hi-vis for builders, white for reviewers.
// wait is the amber of a wagon that waits for another bead, out a lamp that
// is not lit.
export const lamp = { clear: 0x2fc46b, stop: 0xe5484d, wait: 0xffb224, out: 0x4b525b } as const;
// The grey of a works' smoke.
export const smoke = 0x70757c;
// The iron of the coal in a silo's indicators.
export const iron = 0x33373d;
// A silo's band by the provider whose quota it holds, the key as the yard
// has it (a group's kind): Claude's orange, OpenAI's green for codex, a blue
// for kimi, and slate for any other.
export const livery: Record<string, number> = { claude: 0xf0763f, codex: 0x12b886, kimi: 0x3b82f6 };
export function liveried(provider: string): number {
  return Object.hasOwn(livery, provider) ? livery[provider]! : palette.slate;
}
export const hat = { builder: 0xffd21f, reviewer: 0xffffff } as const;
// A lamp that flashes is dark between, and a wheel chock is its own orange.
export const fault = { dark: 0x4a1512, chock: 0xf58a1f } as const;

// What weather does to a wagon that waits: its paint is this much of what it
// was, and moss is a green of its own.
export const weathering = { dull: 0xa6a6a0, rusted: 0xb9744a, moss: 0x7c9a5e } as const;

// How much of the sun's light a face in shadow keeps: a soft shadow, and the
// only shading there is. A face that looks up has all of it, so the ground
// and every roof are their tone exactly.
export const SHADE = 0.76;

// Paint: one material for every tone and for every colour that means
// something, shared by all that wear it. Matt, and every face of one shade:
// under one sun and seen from one side, a face is one flat colour.
const paints = new Map<Tone | number, THREE.MeshLambertMaterial>();
export function paint(of: Tone | number): THREE.MeshLambertMaterial {
  let m = paints.get(of);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: typeof of === "number" ? of : palette[of], flatShading: true });
    paints.set(of, m);
  }
  return m;
}

// A paint under a tint, for a wagon the weather has been at: one for every
// paint and tint, shared by the wagons that wear it.
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

// Day or night: every tone's paint changes where it is, on what wears it,
// and so does the weathered paint made of it. What means something stays.
export function dress(dark: boolean) {
  Object.assign(palette, dark ? night : day);
  for (const [of, m] of paints) if (typeof of !== "number") m.color.setHex(palette[of]);
  for (const w of worn.values()) tint(w);
}

// A tone as a stylesheet writes it.
export function css(tone: Tone): string {
  return `#${palette[tone].toString(16).padStart(6, "0")}`;
}
