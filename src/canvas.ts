// The canvas the yard is drawn on: how many pixels it asks the browser for,
// and what the page says when the browser gives it none. A browser refuses
// every new picture after its own drawing process fell over, and may take
// one back at any time; neither is the yard's fault, and the note says so.

// What the page needs of a renderer here: a stub in a test is one too.
interface Drawn {
  setPixelRatio(ratio: number): void;
}

// The browser gave no picture when it was asked for one. live is whether the
// page follows a yard, whose web view then still has its lists.
export class Refused extends Error {
  readonly live: boolean;
  constructor(cause: unknown, live: boolean) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "Refused";
    this.live = live;
  }
}

// Make the renderer and set how fine it draws: the screen's own pixels, and
// no more than cap of them to one of the page's.
export function canvas<R extends Drawn>(make: () => R, device: number, cap: number, live: boolean): R {
  let renderer: R;
  try {
    renderer = make();
  } catch (err) {
    throw new Refused(err, live);
  }
  renderer.setPixelRatio(Math.min(device, cap));
  return renderer;
}

// The note while the browser has taken the picture back.
export const LOST = "the browser dropped the picture; it comes back on its own or with a reload";

// The note when the page could not be drawn: what went wrong, and after a
// refusal what helps.
export function failed(err: unknown): string {
  const what = `signalbox could not draw the yard: ${err instanceof Error ? err.message : String(err)}`;
  if (!(err instanceof Refused)) return what;
  const lists = err.live ? " The yard's lists are still readable in its web view." : "";
  return `${what.replace(/\.$/, "")}. Close other tabs with 3D in them, or restart the browser.${lists}`;
}
