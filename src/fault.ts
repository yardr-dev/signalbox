// What went wrong in this browser, told to the script that serves the page
// live (scripts/serve.mjs, POST api/fault), which writes it to its log: a
// phone's console is on the phone, and the log is where the yard can read.
// Told are the picture refused, lost, given back or drawn light, and an
// error nobody caught; nothing of what the reader does, and no timing. The
// snapshot's page has no script to tell and tells nobody.

// One report: when, a short kind, what was said, the browser and its screen
// (the page's width and height in its own pixels, and the screen's to one).
export interface Fault {
  at: string;
  what: string;
  detail: string;
  agent: string;
  screen: string;
}

// Milliseconds between two reports: the script takes one a second from a
// connection and drops the rest, so the page keeps well clear of that.
export const PACE = 2000;
// The reports of one visit, at most: an error in every frame is told MOST
// times and then no more, and does not fill the log.
export const MOST = 30;
// The characters of a report's detail, at most: the script takes 4 KB.
export const LONG = 1000;

// The reports of a visit, in order. They wait until the page knows whether a
// script serves it (served), and then go one every PACE, or nowhere.
export class Faults {
  private live: boolean | undefined;
  private held: Fault[] = [];
  private count = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly send: (fault: Fault) => void,
    // The browser's own, called as its own: see Losses (canvas.ts).
    private readonly wait: (then: () => void, ms: number) => ReturnType<typeof setTimeout> = (then, ms) => setTimeout(then, ms),
  ) {}

  report(fault: Fault) {
    if (this.live === false || ++this.count > MOST) return;
    this.held.push({ ...fault, detail: fault.detail.slice(0, LONG) });
    this.next();
  }

  served(live: boolean) {
    this.live = live;
    if (!live) this.held = [];
    this.next();
  }

  private next() {
    if (this.live !== true || this.timer !== undefined) return;
    const fault = this.held.shift();
    if (fault === undefined) return;
    try {
      this.send(fault);
    } catch {
      // Not told: a report that cannot be sent is no fault of the page's.
    }
    this.timer = this.wait(() => {
      this.timer = undefined;
      this.next();
    }, PACE);
  }
}

// What an error says and where it was thrown: its message and the first line
// of its stack. One browser starts the stack with the error's name and
// message, another with the line itself. where is said for an error that
// has no stack.
export function told(err: unknown, where = ""): string {
  if (!(err instanceof Error)) return where === "" ? String(err) : `${String(err)} (${where})`;
  const head = err.message === "" ? err.name : `${err.name}: ${err.message}`;
  const stack = err.stack ?? "";
  const line = (stack.startsWith(head) ? stack.slice(head.length) : stack)
    .split("\n")
    .map((l) => l.trim().replace(/^at /, ""))
    .find((l) => l !== "");
  const at = line ?? where;
  return at === "" ? head : `${head} (${at})`;
}

// To the page's own origin, beside the page. A beacon outlives the page that
// sent it; a browser without one has fetch do the same.
function post(fault: Fault) {
  const url = new URL(`${import.meta.env.BASE_URL}api/fault`, window.location.href).href;
  const body = JSON.stringify(fault);
  if (typeof navigator.sendBeacon === "function") navigator.sendBeacon(url, body);
  else void fetch(url, { method: "POST", body, keepalive: true }).catch(() => undefined);
}

const faults = new Faults(post);

// Tell the script what went wrong: what is the kind, detail what was said.
export function report(what: string, detail = "") {
  faults.report({
    at: new Date().toISOString(),
    what,
    detail,
    agent: navigator.userAgent,
    screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
  });
}

// Whether a script serves the page, once the page knows: what was reported
// until then goes now, or nowhere.
export function served(live: boolean) {
  faults.served(live);
}

// Errors nobody caught, from now on.
export function listen() {
  window.addEventListener("error", (e) => report("error", told(e.error ?? e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : "")));
  window.addEventListener("unhandledrejection", (e) => report("rejection", told(e.reason)));
}
