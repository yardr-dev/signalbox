// The replay's clock: where in the window it is, how fast it runs, and the
// state of the yard there. No page here: main.ts has the bar and the frames.

import { SHOWN, state, step, world, type Log, type State, type World, type YardEvent } from "./replay";
import type { Yard } from "./yard";

// Seconds of the yard a second of the page: 60x makes an hour a minute.
export const SPEEDS = [1, 10, 60, 600] as const;

export class Player {
  // The window, and the clock in it: the yard's time, in milliseconds.
  readonly from: number;
  readonly to: number;
  clock: number;
  playing = false;
  speed: number = 60;
  // The yard at the clock, and the last event the replay shows up to it.
  state: State;
  shown: YardEvent | undefined;

  private readonly times: number[];
  private readonly world: World;
  // How many of the window's events the state holds.
  private count = 0;

  constructor(
    private readonly yard: Yard,
    private readonly log: Log,
  ) {
    this.times = log.events.map((e) => Date.parse(e.at));
    this.world = world(yard, log);
    this.from = this.times[0] ?? 0;
    this.to = this.times.at(-1) ?? this.from;
    this.clock = this.from;
    this.state = state(yard, log, 0);
    this.seek(this.from);
  }

  // Stand at a time: the state is built again from the window's start.
  seek(clock: number) {
    this.clock = Math.min(this.to, Math.max(this.from, clock));
    this.count = this.times.filter((t) => t <= this.clock).length;
    this.state = state(this.yard, this.log, this.count);
    this.shown = this.log.events.slice(0, this.count).reverse().find((e) => SHOWN.has(e.kind));
  }

  // Run on by a time of the page, in seconds. The events it passed come
  // back, oldest first; the window's end stops the play.
  advance(dt: number): YardEvent[] {
    this.clock = Math.min(this.to, this.clock + dt * this.speed * 1000);
    const passed: YardEvent[] = [];
    while (this.count < this.times.length && this.times[this.count]! <= this.clock) {
      const event = this.log.events[this.count++]!;
      this.state = step(this.state, event, this.world);
      if (SHOWN.has(event.kind)) this.shown = event;
      passed.push(event);
    }
    if (this.clock >= this.to) this.playing = false;
    return passed;
  }
}
