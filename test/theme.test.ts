// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { dress, paint, palette } from "../src/palette";
import { frost, loadLogo, SNOW, SNOWFLAKE, STAR_URL, STATIONS, starCard, themed } from "../src/theme";

describe("the page's theme", () => {
  test("?theme=snowflake asks for snow; anything else is no theme", () => {
    expect(themed("?theme=snowflake")).toBe("snowflake");
    expect(themed("?board&theme=snowflake")).toBe("snowflake");
    expect(themed("")).toBeUndefined();
    expect(themed("?board")).toBeUndefined();
    expect(themed("?theme=nope")).toBeUndefined();
    expect(themed("?theme=")).toBeUndefined();
  });

  test("?theme=snowflake draws the snowflake station: one row of stations per theme", () => {
    expect(STATIONS.snowflake).toEqual(["snowflake"]);
  });

  test("the crew wears Snowflake's brand blue, the roofs snow", () => {
    expect(SNOWFLAKE).toBe(0x29b5e8);
    expect(SNOW).toBe(0xffffff);
  });

  test("without the theme no logo is asked for; one that does not load is no logo", async () => {
    await expect(loadLogo("http://logo.test/", undefined)).resolves.toBeUndefined();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // No document here, so no image loads: the billboard is blank instead.
      await expect(loadLogo("http://logo.test/", "snowflake")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  test("without the theme there is no star card; with it the mark and the code link to the repository", () => {
    expect(STAR_URL).toBe("https://github.com/yardr-dev/yardr");
    expect(starCard("http://logo.test/", undefined)).toBe("");
    const card = starCard("http://logo.test/", "snowflake");
    // One link to the repository, the mark beside the code, the call to
    // action under them; the pictures are the theme's, off the base.
    expect(card).toBe(
      `<a href="https://github.com/yardr-dev/yardr">` +
        `<img class="mark" src="http://logo.test/theme/snowflake/GitHub_Invertocat_Black.png" alt="GitHub"/>` +
        `<img class="qr" src="http://logo.test/theme/snowflake/github-qr.png" alt="QR code to yardr on GitHub"/>` +
        `<span>Star us on GitHub</span></a>`,
    );
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
