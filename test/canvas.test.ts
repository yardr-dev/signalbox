import { describe, expect, test } from "vitest";
import { canvas, failed, LOST, Refused } from "../src/canvas";

// A renderer that only remembers how fine it was told to draw.
function stub() {
  return { ratio: 0, setPixelRatio(ratio: number) { this.ratio = ratio; } };
}

describe("the canvas", () => {
  test("draws the screen's own pixels, and no more than the cap", () => {
    expect(canvas(stub, 3, 2, false).ratio).toBe(2);
    expect(canvas(stub, 2, 2, false).ratio).toBe(2);
    expect(canvas(stub, 1, 2, false).ratio).toBe(1);
    expect(canvas(stub, 1.5, 2, false).ratio).toBe(1.5);
  });

  test("a browser that gives no picture is a refusal, with what it said", () => {
    const refuse = () => {
      throw new Error("THREE.WebGLRenderer: Error creating WebGL context.");
    };
    let thrown: unknown;
    try {
      canvas<ReturnType<typeof stub>>(refuse, 2, 2, true);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Refused);
    expect((thrown as Refused).live).toBe(true);
    expect((thrown as Refused).message).toBe("THREE.WebGLRenderer: Error creating WebGL context.");
  });
});

describe("the note when the page could not be drawn", () => {
  const refusal = new Error("THREE.WebGLRenderer: Error creating WebGL context.");

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
