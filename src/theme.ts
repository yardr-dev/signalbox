// The page's theme: ?theme=snowflake draws the yard wintry and
// Snowflake-branded for the demo; without it the page is exactly as it was.
// One place: a later theme is a row in THEMES and a case where snowflake's
// is, not a branch per file. What the address names that is not here is
// ignored.

import * as THREE from "three";
import { paint, palette } from "./palette";

// The themes the page knows, by what ?theme= names them.
const THEMES = ["snowflake"] as const;
export type Theme = (typeof THEMES)[number];

// The sources a theme draws a station for, added to ?sources=: one row per
// theme, so ?theme=snowflake alone draws the Snowflake station.
export const STATIONS: Record<Theme, readonly string[]> = {
  snowflake: ["snowflake"],
};

// Snowflake's brand blue, worn by the crew under the theme: the theme's one
// sanctioned exception to copying tokens, approved by mckean. Snow is white,
// as a reviewer's hat already is.
export const SNOWFLAKE = 0x29b5e8;
export const SNOW = 0xffffff;

// The theme the address asks for, if it names one the page knows.
export function themed(search: string): Theme | undefined {
  const name = new URLSearchParams(search).get("theme");
  return name !== null && (THEMES as readonly string[]).includes(name) ? (name as Theme) : undefined;
}

// The billboard's face under the theme: Snowflake's official logo, kept
// under the theme's folder (NOTICE says whose it is). Without the theme
// nothing is asked for; a logo that does not load leaves a blank white
// panel, and the page still draws.
export async function loadLogo(base: string, theme: Theme | undefined): Promise<THREE.Texture | undefined> {
  if (theme === undefined) return undefined;
  try {
    const logo = await new THREE.TextureLoader().loadAsync(`${base}theme/snowflake/snowflake-logo-color-rgb@2x.png`);
    logo.colorSpace = THREE.SRGBColorSpace;
    return logo;
  } catch (err) {
    console.warn("theme: the Snowflake logo did not load, the billboard is blank", err);
    return undefined;
  }
}

// A light frost on the ground under the theme: the ground and the depots'
// beds mixed toward white, further by day than by night. After dress, so a
// change of day and night keeps it; dress alone gives the frost back.
export function frost(theme: Theme | undefined, dark: boolean) {
  if (theme === undefined) return;
  const white = new THREE.Color(SNOW);
  for (const tone of ["ground", "bed"] as const) {
    const mixed = new THREE.Color(palette[tone]).lerp(white, dark ? 0.25 : 0.55).getHex();
    palette[tone] = mixed;
    paint(tone).color.setHex(mixed);
  }
}
