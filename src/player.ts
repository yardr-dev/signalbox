// The replay's clock: where in the window it is, how fast it runs, and the
// state of the yard there. No page here: main.ts has the bar and the frames.
//
// A page that follows a yard as it runs has a window that grows: its end is
// now (extend), and the feed's events join it (append). Live, the clock
// stands at that end and every event is passed as it comes; scrubbed back,
// it is the replay of the window so far.

import { SHOWN, state, step, world, type Log, type State, type World, type YardEvent } from "./replay";
import type { Yard } from "./yard";

// Seconds of the yard a second of the page: 60x makes an hour a minute.
export const SPEEDS = [1, 10, 60, 600] as const;

export class Player {
  // The window, and the clock in it: the yard's time, in milliseconds.
  readonly from: number;
  to: number;
  clock: number;
  playing = false;
  // Following the yard: the clock is the window's end.
  live = false;
  speed: number = 60;
  // The yard at the clock, and the last event the replay shows up to it.
  state: State;
  shown: YardEvent | undefined;
  readonly world: World;

  private readonly log: Log;
  private readonly times: number[];
  // How many of the window's events the state holds.
  private count = 0;

  // now is the yard's time when the snapshot was taken, for a window that
  // ends there and not at its last event.
  constructor(
    private readonly yard: Yard,
    log: Log,
    now?: number,
  ) {
    // Its own list: the feed's events are added to it.
    this.log = { ...log, events: [...log.events] };
    this.times = log.events.map((e) => Date.parse(e.at));
    this.world = world(yard, log);
    this.from = this.times[0] ?? now ?? 0;
    this.to = Math.max(this.times.at(-1) ?? this.from, now ?? this.from);
    this.clock = this.from;
    this.state = state(yard, log, 0);
    this.seek(this.from);
  }

  // The number of the window's last event: the feed goes on after it.
  get seq(): number {
    return this.log.events.at(-1)?.seq ?? 0;
  }

  // The window's events after a number, oldest first.
  after(seq: number): YardEvent[] {
    return this.log.events.filter((e) => e.seq > seq);
  }

  // One more event at the window's end. False for one the window holds
  // already: a feed that starts again may say it twice.
  append(event: YardEvent): boolean {
    if (event.seq <= this.seq) return false;
    this.log.events.push(event);
    // Never before the one before it: the window stays in the log's order.
    const at = Math.max(Date.parse(event.at), this.times.at(-1) ?? -Infinity);
    this.times.push(at);
    if (at > this.to) this.to = at;
    return true;
  }

  // The window ends no earlier than this: the yard's time now.
  extend(now: number) {
    if (now > this.to) this.to = now;
  }

  // Stand at a time: the state is built again from the window's start.
  seek(clock: number) {
    this.clock = Math.min(this.to, Math.max(this.from, clock));
    this.count = this.times.filter((t) => t <= this.clock).length;
    this.state = state(this.yard, this.log, this.count);
    this.shown = this.log.events.slice(0, this.count).reverse().find((e) => SHOWN.has(e.kind));
  }

  // Go to the window's end and stay there as it grows.
  follow() {
    this.seek(this.to);
    this.live = true;
    this.playing = true;
  }

  // Run on by a time of the page, in seconds. The events it passed come
  // back, oldest first; the window's end stops the play, unless it is live:
  // then the clock is that end, and everything the window holds is passed.
  advance(dt: number): YardEvent[] {
    this.clock = this.live ? this.to : Math.min(this.to, this.clock + dt * this.speed * 1000);
    const passed: YardEvent[] = [];
    while (this.count < this.times.length && this.times[this.count]! <= this.clock) {
      const event = this.log.events[this.count++]!;
      this.state = step(this.state, event, this.world);
      if (SHOWN.has(event.kind)) this.shown = event;
      passed.push(event);
    }
    if (!this.live && this.clock >= this.to) this.playing = false;
    return passed;
  }
}
