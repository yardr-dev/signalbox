import { describe, expect, test } from "vitest";
import { begin, canvas, failed, keep, lighter, Losses, LOST, Refused, WAIT, wanted } from "../src/canvas";
import type { Store } from "../src/canvas";

// A renderer that only remembers what it was made with and told to draw.
function stub(antialias: boolean) {
  return { antialias, ratio: 0, shadowMap: { enabled: false }, setPixelRatio(ratio: number) { this.ratio = ratio; } };
}

// A browser's memory, and one that refuses to be read or written.
function kept(held: Record<string, string> = {}): Store & { held: Record<string, string> } {
  return {
    held,
    getItem: (key) => held[key] ?? null,
    setItem: (key, value) => void (held[key] = value),
    removeItem: (key) => void delete held[key],
  };
}
const closed = (): Store => {
  throw new Error("SecurityError");
};
const refusal = new Error("THREE.WebGLRenderer: Error creating WebGL context.");

describe("the canvas", () => {
  test("draws the screen's own pixels, and no more than the cap", () => {
    expect(canvas(stub, 3, 2, false, false).ratio).toBe(2);
    expect(canvas(stub, 2, 2, false, false).ratio).toBe(2);
    expect(canvas(stub, 1, 2, false, false).ratio).toBe(1);
    expect(canvas(stub, 1.5, 2, false, false).ratio).toBe(1.5);
  });

  test("the full picture is antialiased and has the sun's shadow", () => {
    const full = canvas(stub, 3, 2, false, false);
    expect(full.antialias).toBe(true);
    expect(full.shadowMap.enabled).toBe(true);
  });

  test("a light one has neither, and one pixel to one of the page's", () => {
    const light = canvas(stub, 3, 2, false, true);
    expect(light.antialias).toBe(false);
    expect(light.shadowMap.enabled).toBe(false);
    expect(light.ratio).toBe(1);
  });

  test("a browser that gives no picture is a refusal, with what it said", () => {
    const refuse = () => {
      throw refusal;
    };
    let thrown: unknown;
    try {
      canvas<ReturnType<typeof stub>>(refuse, 2, 2, true, false);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Refused);
    expect((thrown as Refused).live).toBe(true);
    expect((thrown as Refused).message).toBe("THREE.WebGLRenderer: Error creating WebGL context.");
  });
});

describe("what the address and the browser say of the picture", () => {
  test("nothing said is the full picture", () => {
    expect(wanted("", () => kept())).toBeUndefined();
    expect(wanted("?speed=2", () => kept())).toBeUndefined();
  });

  test("?light asks for the light one", () => {
    expect(wanted("?light", () => kept())).toBe("asked");
    expect(wanted("?a=1&light", () => kept())).toBe("asked");
  });

  test("a fall is remembered on this browser, until ?full", () => {
    const store = kept();
    keep(() => store);
    expect(store.held).toEqual({ "signalbox.light": "true" });
    expect(wanted("", () => store)).toBe("kept");
    expect(wanted("?full", () => store)).toBeUndefined();
    expect(store.held).toEqual({});
    expect(wanted("", () => store)).toBeUndefined();
  });

  test("?light is asked for, whatever is remembered", () => {
    expect(wanted("?light", () => kept({ "signalbox.light": "true" }))).toBe("asked");
  });

  test("a browser that refuses its storage remembers nothing, and the page goes on", () => {
    expect(wanted("", closed)).toBeUndefined();
    expect(wanted("?full", closed)).toBeUndefined();
    expect(wanted("?light", closed)).toBe("asked");
    expect(() => keep(closed)).not.toThrow();
  });
});

describe("the first picture", () => {
  // A browser that refuses the first n pictures asked of it.
  function browser(refused: number) {
    const asked: boolean[] = [];
    return {
      asked,
      make(antialias: boolean) {
        asked.push(antialias);
        if (asked.length <= refused) throw refusal;
        return stub(antialias);
      },
    };
  }

  test("is the full one, and nothing is remembered", () => {
    const store = kept();
    const { renderer, why } = begin(browser(0).make, 3, 2, false, "", () => store);
    expect(why).toBeUndefined();
    expect([renderer.antialias, renderer.shadowMap.enabled, renderer.ratio]).toEqual([true, true, 2]);
    expect(store.held).toEqual({});
  });

  test("is the light one when the address asks, and that is not remembered", () => {
    const store = kept();
    const { renderer, why } = begin(browser(0).make, 3, 2, false, "?light", () => store);
    expect(why).toBe("asked");
    expect([renderer.antialias, renderer.shadowMap.enabled, renderer.ratio]).toEqual([false, false, 1]);
    expect(store.held).toEqual({});
  });

  test("is the light one after an earlier fall", () => {
    const { renderer, why } = begin(browser(0).make, 3, 2, false, "", () => kept({ "signalbox.light": "true" }));
    expect(why).toBe("kept");
    expect(renderer.shadowMap.enabled).toBe(false);
  });

  test("refused, is asked once more as a light one, and that is remembered", () => {
    const store = kept();
    const chrome = browser(1);
    const { renderer, why } = begin(chrome.make, 3, 2, false, "", () => store);
    expect(chrome.asked).toEqual([true, false]);
    expect(why).toBe("refused");
    expect([renderer.antialias, renderer.shadowMap.enabled, renderer.ratio]).toEqual([false, false, 1]);
    expect(wanted("", () => store)).toBe("kept");
  });

  test("refused twice is a refusal, with what the browser said, and nothing is remembered", () => {
    const store = kept();
    const chrome = browser(2);
    let thrown: unknown;
    try {
      begin(chrome.make, 3, 2, true, "", () => store);
    } catch (err) {
      thrown = err;
    }
    expect(chrome.asked).toEqual([true, false]);
    expect(thrown).toBeInstanceOf(Refused);
    expect((thrown as Refused).live).toBe(true);
    expect(store.held).toEqual({});
  });

  test("a light one refused is not asked for again", () => {
    const chrome = browser(1);
    expect(() => begin(chrome.make, 3, 2, false, "?light", () => kept())).toThrow(Refused);
    expect(chrome.asked).toEqual([false]);
  });
});

describe("the losses of the full picture", () => {
  // A clock whose timers run when the test says.
  function clock() {
    const timers = new Map<number, { then: () => void; ms: number }>();
    let next = 0;
    return {
      timers,
      wait: (then: () => void, ms: number) => {
        timers.set(++next, { then, ms });
        return next as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: (timer: ReturnType<typeof setTimeout>) => void timers.delete(timer as unknown as number),
      run() {
        for (const [id, { then }] of [...timers]) {
          timers.delete(id);
          then();
        }
      },
    };
  }
  function watched() {
    const time = clock();
    const seen = { falls: 0 };
    return { time, seen, losses: new Losses(() => seen.falls++, time.wait, time.cancel) };
  }

  test("one that comes back in time is no fall", () => {
    const { time, seen, losses } = watched();
    losses.lost();
    expect([...time.timers.values()].map((t) => t.ms)).toEqual([WAIT]);
    losses.restored();
    time.run();
    expect(seen.falls).toBe(0);
  });

  test("one that does not come back in time is", () => {
    const { time, seen, losses } = watched();
    losses.lost();
    expect(seen.falls).toBe(0);
    time.run();
    expect(seen.falls).toBe(1);
  });

  test("a second is at once, though the first came back", () => {
    const { time, seen, losses } = watched();
    losses.lost();
    losses.restored();
    losses.lost();
    expect(seen.falls).toBe(1);
    expect(time.timers.size).toBe(0);
  });

  test("a second while the first is still out is one fall, not two", () => {
    const { time, seen, losses } = watched();
    losses.lost();
    losses.lost();
    time.run();
    expect(seen.falls).toBe(1);
  });
});

describe("the losses, on the browser's own clock", () => {
  // A browser's timers throw when they are called as a method of anything
  // but the window: the page's losses once did, and never fell.
  test("call its timers as the browser's own", () => {
    const real = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
    const set: Array<() => void> = [];
    let cleared = 0;
    const own = (self: unknown) => {
      if (self !== undefined && self !== globalThis) throw new TypeError("Illegal invocation");
    };
    globalThis.setTimeout = function (this: unknown, then: () => void) {
      own(this);
      return set.push(then);
    } as unknown as typeof setTimeout;
    globalThis.clearTimeout = function (this: unknown) {
      own(this);
      cleared++;
    } as typeof clearTimeout;
    try {
      let falls = 0;
      const losses = new Losses(() => falls++);
      losses.lost();
      expect(set.length).toBe(1);
      losses.restored();
      expect(cleared).toBe(1);
      set[0]?.();
      expect(falls).toBe(1);
    } finally {
      globalThis.setTimeout = real.set;
      globalThis.clearTimeout = real.clear;
    }
  });
});

describe("the note of a light picture", () => {
  test("says why it is one", () => {
    expect(lighter("asked")).toBe("light picture");
    expect(lighter("kept")).toBe("light picture, as the full one failed here before: ?full asks for it again");
    expect(lighter("refused")).toBe("the browser refused the picture; drawing it lighter");
    expect(lighter("dropped")).toBe("the browser dropped the picture; drawing it lighter");
  });
});

describe("the note when the page could not be drawn", () => {

  test("after a refusal it says what it said before, and what helps", () => {
    expect(failed(new Refused(refusal, false))).toBe(
      "signalbox could not draw the yard: THREE.WebGLRenderer: Error creating WebGL context. Close other tabs with 3D in them, or restart the browser.",
    );
  });

  test("a page that follows a yard says where its lists still are", () => {
    expect(failed(new Refused(refusal, true))).toBe(
      "signalbox could not draw the yard: THREE.WebGLRenderer: Error creating WebGL context. Close other tabs with 3D in them, or restart the browser. The yard's lists are still readable in its web view.",
    );
  });

  test("a refusal that was no error is said as it came", () => {
    expect(failed(new Refused("no WebGL", false))).toBe("signalbox could not draw the yard: no WebGL. Close other tabs with 3D in them, or restart the browser.");
  });

  test("any other failure is said as before: the browser is not to blame", () => {
    expect(failed(new Error("yard.json: 404"))).toBe("signalbox could not draw the yard: yard.json: 404");
    expect(failed("gone")).toBe("signalbox could not draw the yard: gone");
  });

  test("a dropped picture says that it comes back", () => {
    expect(LOST).toBe("the browser dropped the picture; it comes back on its own or with a reload");
  });
});
