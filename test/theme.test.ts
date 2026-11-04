// @vitest-environment node
import { afterEach, describe, expect, test } from "vitest";
import { dress, paint, palette } from "../src/palette";
import { frost, SNOW, SNOWFLAKE, themed } from "../src/theme";

describe("the page's theme", () => {
  test("?theme=snowflake asks for snow; anything else is no theme", () => {
    expect(themed("?theme=snowflake")).toBe("snowflake");
    expect(themed("?board&theme=snowflake")).toBe("snowflake");
    expect(themed("")).toBeUndefined();
    expect(themed("?board")).toBeUndefined();
    expect(themed("?theme=nope")).toBeUndefined();
    expect(themed("?theme=")).toBeUndefined();
  });

  test("the crew wears Snowflake's brand blue, the roofs snow", () => {
    expect(SNOWFLAKE).toBe(0x29b5e8);
    expect(SNOW).toBe(0xffffff);
  });
});

describe("a light frost on the ground", () => {
  afterEach(() => dress(false));

  test("mixes the ground and the beds toward white; dress alone gives the frost back", () => {
    for (const dark of [false, true]) {
      dress(dark);
      const before = { ...palette };
      frost("snowflake", dark);
      for (const tone of ["ground", "bed"] as const) {
        // Toward white: every channel up, and the paint with it.
        const was = [before[tone] >> 16, (before[tone] >> 8) & 0xff, before[tone] & 0xff] as const;
        const is = [palette[tone] >> 16, (palette[tone] >> 8) & 0xff, palette[tone] & 0xff] as const;
        expect(is[0]).toBeGreaterThan(was[0]);
        expect(is[1]).toBeGreaterThan(was[1]);
        expect(is[2]).toBeGreaterThan(was[2]);
        expect(paint(tone).color.getHex()).toBe(palette[tone]);
      }
      dress(dark);
      expect({ ...palette }).toEqual(before);
    }
    // Without the theme the ground is as it was.
    const before = { ...palette };
    frost(undefined, false);
    expect({ ...palette }).toEqual(before);
  });
});
