// The yard's sounds: a whistle on a landing, a bell for a session that is
// stuck, a clank when a shunter couples. Each is made here with the Web
// Audio API as it is asked for: no file is played. cueOf says which of them
// an event of the yard is; Sound plays a cue by its name, and knows nothing
// of the yard.
//
// Off until the reader turns it on: a browser lets no page sound before it
// was touched, and nobody wants one that whistles unasked.

import type { YardEvent } from "./replay";

export type Cue = "whistle" | "bell" | "clank";

// A shunter may finish an animation after the player was paused. Its clank
// is heard only when that frame belongs to playback.
export function clankCue(playing: boolean, couplings: number): Cue | undefined {
  return playing && couplings > 0 ? "clank" : undefined;
}

// The kinds that say a session does not get on by itself any more.
const STUCK = new Set(["session_stalled", "session_prompt_gave_up"]);

// The cue of an event: a bead that landed, or a session that stalled or was
// given up. None for any other. The clank is no event's: the picture has
// its moments (scene.ts).
export function cueOf(event: YardEvent): Cue | undefined {
  if (event.kind === "closed" && event.data?.reason === "merged") return "whistle";
  if (STUCK.has(event.kind) || (event.kind === "advanced" && event.data?.outcome === "gave_up")) return "bell";
  return undefined;
}

// The cues of the events passed together, each once: at 600x a frame may
// hold a dozen landings, and they are one whistle.
export function cues(events: readonly YardEvent[]): Cue[] {
  return [...new Set(events.map(cueOf).filter((c) => c !== undefined))];
}

// Where the choice is remembered: the browser's localStorage, or none.
export type Store = Pick<Storage, "getItem" | "setItem">;
const KEY = "signalbox.sound";

// The seconds before a cue may sound again: one that still sounds is not
// started over itself.
const GAP: Record<Cue, number> = { whistle: 0.8, bell: 0.5, clank: 0.1 };

// A gain that opens to a level, holds it, and dies away by the end.
function envelope(context: AudioContext, at: number, level: number, attack: number, hold: number, length: number): GainNode {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + attack);
  gain.gain.setValueAtTime(level, at + attack + hold);
  // An exponential ramp never gets to nothing.
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  gain.connect(context.destination);
  return gain;
}

// A steam whistle: two pipes a third apart, blown up to their pitch.
function whistle(context: AudioContext, at: number) {
  const out = envelope(context, at, 0.1, 0.04, 0.4, 0.7);
  for (const pitch of [740, 932]) {
    const pipe = context.createOscillator();
    pipe.type = "triangle";
    pipe.frequency.setValueAtTime(pitch * 0.94, at);
    pipe.frequency.linearRampToValueAtTime(pitch, at + 0.08);
    pipe.connect(out);
    pipe.start(at);
    pipe.stop(at + 0.7);
  }
}

// A struck bell: its tone and two overtones off the harmonics, the higher
// the sooner gone.
function bell(context: AudioContext, at: number) {
  for (const [ratio, level, length] of [[1, 0.2, 1.2], [2.76, 0.1, 0.8], [5.4, 0.05, 0.4]] as const) {
    const tone = context.createOscillator();
    tone.frequency.setValueAtTime(660 * ratio, at);
    tone.connect(envelope(context, at, level, 0.005, 0, length));
    tone.start(at);
    tone.stop(at + length);
  }
}

// Buffers meeting: a short burst of noise, kept to the band of struck iron.
function clank(context: AudioContext, at: number) {
  const length = 0.14;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * length), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(1400, at);
  band.Q.setValueAtTime(1.5, at);
  noise.connect(band).connect(envelope(context, at, 0.3, 0.002, 0, length));
  noise.start(at);
}

const VOICES: Record<Cue, (context: AudioContext, at: number) => void> = { whistle, bell, clank };

export class Sound {
  on: boolean;
  private context: AudioContext | undefined;
  // By cue, the context's time from which it may sound again.
  private readonly free: Partial<Record<Cue, number>> = {};

  // store and make are the browser's: asked for only when they are needed,
  // so nothing here wants a page. A browser may refuse its storage; the
  // choice then lasts as long as the page.
  constructor(
    private readonly store: () => Store,
    private readonly make: () => AudioContext,
  ) {
    let kept: string | null = null;
    try {
      kept = this.store().getItem(KEY);
    } catch {
      // Off, as if nothing was kept.
    }
    this.on = kept === "on";
  }

  // Turn it on or off, and remember which. Off is silent at once, whatever
  // still sounds.
  set(on: boolean) {
    this.on = on;
    try {
      this.store().setItem(KEY, on ? "on" : "off");
    } catch {
      // Not remembered.
    }
    if (on) this.wake();
    else void this.context?.suspend();
  }

  // The reader touched the page: with sound on, the context may be made now,
  // or go on. Before a touch a browser would make it suspended, and warn.
  wake() {
    if (!this.on) return;
    this.context ??= this.make();
    if (this.context.state === "suspended") void this.context.resume();
  }

  play(cue: Cue) {
    const context = this.context;
    if (!this.on || context?.state !== "running") return;
    const now = context.currentTime;
    if (now < (this.free[cue] ?? 0)) return;
    this.free[cue] = now + GAP[cue];
    VOICES[cue](context, now);
  }
}
