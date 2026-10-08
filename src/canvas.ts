// The canvas the yard is drawn on: how many pixels it asks the browser for,
// and what the page says when the browser gives it none. A browser refuses
// every new picture after its own drawing process fell over, and may take
// one back at any time; neither is the yard's fault, and the note says so.
//
// A browser that refuses or drops the picture is asked once more for a light
// one: no shadow, no antialiasing, one pixel to one of the page's. That is
// the least the yard can be drawn with, and the page takes it at three
// moments: refused at the start, lost and not given back within WAIT, lost a
// second time. It then starts light on this browser until ?full is asked;
// ?light asks for the light picture outright.
//
// A phone or a tablet is not asked for the full picture at all: its browser
// drops it, and the first visit would be a loss and a wait. It starts light
// (see handheld), and ?full asks for the full one there as anywhere.

// What the page needs of a renderer here: a stub in a test is one too.
interface Drawn {
  setPixelRatio(ratio: number): void;
  shadowMap: { enabled: boolean };
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
// no more than cap of them to one of the page's. A light one is not
// antialiased, draws one pixel to one of the page's and has no shadow map:
// the sun then casts none, and nothing else of the page knows of it.
export function canvas<R extends Drawn>(make: (antialias: boolean) => R, device: number, cap: number, live: boolean, light: boolean): R {
  let renderer: R;
  try {
    renderer = make(!light);
  } catch (err) {
    throw new Refused(err, live);
  }
  renderer.setPixelRatio(light ? 1 : Math.min(device, cap));
  renderer.shadowMap.enabled = !light;
  return renderer;
}

// Why the picture is a light one: the address asked for it, the browser
// remembered an earlier fall, the device is a phone or a tablet, or the
// browser refused or dropped the full one now.
export type Why = "asked" | "kept" | "handheld" | "refused" | "dropped";

// What handheld asks of the window: a stub in a test is one too.
export type View = Pick<Window, "matchMedia" | "innerWidth" | "innerHeight">;

// The shorter side of the viewport, in CSS px, a handheld is under.
const HANDHELD = 900;

// A phone or a tablet: the pointer is coarse, matchMedia("(pointer: coarse)"),
// and the shorter side of the viewport is under 900 CSS px. Both, as a
// laptop with a touch screen has a fine pointer too and gets the full
// picture, and so does a large touch screen on a wall.
export function handheld(view: View): boolean {
  return view.matchMedia("(pointer: coarse)").matches && Math.min(view.innerWidth, view.innerHeight) < HANDHELD;
}

// Where a fall is remembered: the browser's localStorage, or none.
export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const KEY = "signalbox.light";

// What the address and the browser's memory say of the picture, before it is
// made. ?full forgets an earlier fall and asks for the full picture on a
// handheld too; ?light asks whatever else is said. A fall remembered on a
// handheld is a fall of the full picture asked for there, and is said first.
export function wanted(search: string, store: () => Store, handheld: boolean): Why | undefined {
  const query = new URLSearchParams(search);
  const full = query.has("full");
  let kept = false;
  try {
    if (full) store().removeItem(KEY);
    else kept = store().getItem(KEY) !== null;
  } catch {
    // A browser that refuses its storage remembers no fall.
  }
  return query.has("light") ? "asked" : kept ? "kept" : handheld && !full ? "handheld" : undefined;
}

// The page fell to the light picture on its own: the next visit starts there.
export function keep(store: () => Store) {
  try {
    store().setItem(KEY, "true");
  } catch {
    // Not kept: the next visit asks for the full picture again.
  }
}

// The first renderer of the page: as wanted, and when the browser refuses the
// full picture, once more as a light one. A light one refused is a refusal.
// refusal is what the browser said of the full picture, when a light one is
// drawn in its place.
export function begin<R extends Drawn>(make: (antialias: boolean) => R, device: number, cap: number, live: boolean, search: string, store: () => Store, handheld: boolean): { renderer: R; why: Why | undefined; refusal?: string } {
  const why = wanted(search, store, handheld);
  try {
    return { renderer: canvas(make, device, cap, live, why !== undefined), why };
  } catch (err) {
    if (why !== undefined) throw err;
    let renderer: R;
    try {
      renderer = canvas(make, device, cap, live, true);
    } catch {
      // What the browser said of the full picture is what went wrong.
      throw err;
    }
    keep(store);
    return { renderer, why: "refused", refusal: err instanceof Error ? err.message : String(err) };
  }
}

// Milliseconds a lost picture has to come back in.
export const WAIT = 3000;

// The losses of the full picture: fall is called when it is given up for a
// light one, which is when the browser did not give it back within WAIT, or
// took it a second time.
export class Losses {
  private count = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly fall: () => void,
    // The browser's own, called as its own: a timer of the window's refuses
    // to be called as a method of anything else.
    private readonly wait: (then: () => void, ms: number) => ReturnType<typeof setTimeout> = (then, ms) => setTimeout(then, ms),
    private readonly cancel: (timer: ReturnType<typeof setTimeout>) => void = (timer) => clearTimeout(timer),
  ) {}

  lost() {
    this.restored();
    if (++this.count > 1) this.fall();
    else this.timer = this.wait(this.fall, WAIT);
  }

  restored() {
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
  }
}

// The note while the browser has taken the picture back.
export const LOST = "the browser dropped the picture; it comes back on its own or with a reload";

// What the note says of a light picture, after what it says of the yard.
export function lighter(why: Why): string {
  switch (why) {
    case "asked":
      return "light picture";
    case "kept":
      return "light picture, as the full one failed here before: ?full asks for it again";
    case "handheld":
      return "light picture on a phone: ?full asks for the full one";
    case "refused":
      return "the browser refused the picture; drawing it lighter";
    case "dropped":
      return "the browser dropped the picture; drawing it lighter";
  }
}

// The note when the page could not be drawn: what went wrong, and after a
// refusal what helps.
export function failed(err: unknown): string {
  const what = `signalbox could not draw the yard: ${err instanceof Error ? err.message : String(err)}`;
  if (!(err instanceof Refused)) return what;
  const lists = err.live ? " The yard's lists are still readable in its web view." : "";
  return `${what.replace(/\.$/, "")}. Close other tabs with 3D in them, or restart the browser.${lists}`;
}
