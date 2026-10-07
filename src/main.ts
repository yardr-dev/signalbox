// The page: load the yard's snapshot, lay it out, draw it, and let the
// pointer move the camera over it. With the yard's events beside the
// snapshot it plays them: the bar at the bottom is the player's. Served by
// scripts/serve.mjs it follows the yard as it runs: the snapshot is the
// yard now, and the feed's events move the picture as the replay's do.

import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { ASKING, brief, card, missing, NEEDS_LIVE, NO_ANSWER } from "./card";
import { loadKit, palette } from "./kit";
import { layout } from "./layout";
import { Player, SPEEDS } from "./player";
import { line, outgrown } from "./replay";
import { describe, draw, house, Stock } from "./scene";
import { cues, Sound } from "./sound";
import "./style.css";
import type { Card, Detail } from "./card";
import type { Shed, Slots } from "./layout";
import type { Log, YardEvent } from "./replay";
import type { Bead, Yard } from "./yard";

// Where the camera stands from what it looks at: turned a little off the
// tracks and looking down, so a track still reads left to right.
const AZIMUTH = THREE.MathUtils.degToRad(22);
const ELEVATION = THREE.MathUtils.degToRad(40);
const DISTANCE = 400;
// Pixels per unit of ground below which the sheds' names are hidden.
const FAR = 14;
// Pixels a pointer may move between down and up and still have clicked.
const SLOP = 5;

const base = import.meta.env.BASE_URL;
const host = document.getElementById("yard")!;
const tip = document.getElementById("tip")!;
const side = document.getElementById("card")!;
const note = document.getElementById("note")!;
const bar = document.getElementById("bar")!;
const play = document.getElementById("play")!;
const live = document.getElementById("live")!;
const speeds = document.getElementById("speeds")!;
const mute = document.getElementById("sound")!;
const scrub = document.getElementById("scrub") as HTMLInputElement;
const clock = document.getElementById("clock")!;
const current = document.getElementById("event")!;

// The yard's events, when the snapshot came with them. Without the file the
// page is the still picture.
async function events(): Promise<Log | undefined> {
  try {
    const response = await fetch(`${base}events.json`);
    const log = response.ok ? ((await response.json()) as Log) : undefined;
    return log && log.events.length > 0 ? log : undefined;
  } catch {
    return undefined;
  }
}

// What the serve script answers on api/snapshot: the three files of a
// snapshot in one, taken now.
interface Snapshot {
  yard: Yard;
  layout: Partial<Slots>;
  log: Log;
}

// The yard as it is now, where the serve script serves the page. A static
// server has no such path: it answers that, or the page itself, and the page
// is then the committed snapshot. A yard that does not answer is an error.
async function snapshot(): Promise<Snapshot | undefined> {
  let response: Response;
  try {
    response = await fetch(`${base}api/snapshot`);
  } catch {
    return undefined;
  }
  if (response.status === 404 || response.headers.get("content-type")?.startsWith("application/json") !== true) return undefined;
  const body = (await response.json()) as Snapshot & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `api/snapshot: ${response.status}`);
  return body;
}

// What a yard is built of, without its beads: two snapshots of one structure
// are drawn the same.
function shape(yard: Yard, slots: Partial<Slots>): string {
  return JSON.stringify([{ ...yard, beads: [], taken_at: "" }, slots]);
}

// The yard's clock, in the reader's own time.
const time = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

// A day and a time of the yard, in the reader's own: a bead may be weeks old.
const dated = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const when = (iso: string) => (Number.isNaN(Date.parse(iso)) ? iso : dated.format(Date.parse(iso)));

// Put a card on the page. All of it is text of the yard: none is markup.
function show(c: Card) {
  const el = (tag: string, name: string, text: string) => {
    const e = document.createElement(tag);
    e.className = name;
    e.textContent = text;
    return e;
  };
  const facts = document.createElement("dl");
  for (const [what, value] of c.facts) facts.append(el("dt", "", what), el("dd", "", value));
  side.replaceChildren(el("div", "id", c.id), el("h2", "", c.title));
  if (c.facts.length > 0) side.append(facts);
  if (c.body !== "") side.append(el("p", "body", c.body));
  for (const n of c.notes) side.append(el("h3", "", n.head), el("p", "", n.text));
  if (c.remark !== "") side.append(el("p", "remark", c.remark));
  side.scrollTop = 0;
  side.hidden = false;
}

async function start() {
  const api = await snapshot();
  const files = async (): Promise<Snapshot> => {
    const response = await fetch(`${base}yard.json`);
    if (!response.ok) throw new Error(`yard.json: ${response.status}`);
    // The slots given so far. The page only reads them: what the file does
    // not hold yet is placed after what it does, the same way on every load.
    const remembered = await fetch(`${base}layout.json`);
    return {
      yard: (await response.json()) as Yard,
      layout: remembered.ok ? ((await remembered.json()) as Partial<Slots>) : {},
      log: { taken_at: "", beads: [], events: [] },
    };
  };
  let { yard, layout: slots } = api ?? (await files());
  const kit = await loadKit(base);
  // The structure stands through a replay; only the beads change. Live, a
  // new snapshot may bring another structure: see adopt.
  const plan = (beads: Bead[]) => layout({ ...yard, beads }, slots);
  let picture = draw(plan(yard.beads), kit);
  const log = api ? api.log : await events();
  // Live, the window ends when the snapshot was taken, and the page opens
  // there; a replay opens at its start.
  const first = log && new Player(yard, log, api && Date.parse(yard.taken_at));
  if (api) first?.follow();
  const stock = new Stock(plan(first ? first.state.beads : yard.beads), kit, picture.sheds);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.grass);
  scene.add(picture.root, stock.root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a70, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-60, 120, 80);
  scene.add(sun);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  host.append(renderer.domElement);
  const labels = new CSS2DRenderer();
  labels.domElement.id = "labels";
  host.append(labels.domElement);

  // Orthographic, in pixels: zoom is pixels per unit of the yard.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4 * DISTANCE);
  const centre = picture.bounds.getCenter(new THREE.Vector3());
  const away = new THREE.Vector3(
    Math.sin(AZIMUTH) * Math.cos(ELEVATION),
    Math.sin(ELEVATION),
    Math.cos(AZIMUTH) * Math.cos(ELEVATION),
  ).multiplyScalar(DISTANCE);
  camera.position.copy(centre).add(away);
  camera.lookAt(centre);

  // Pan with a drag or one finger, zoom with the wheel or a pinch. The view
  // does not turn: the yard is a diagram, and its labels read one way.
  const controls = new MapControls(camera, host);
  controls.target.copy(centre);
  // The controls aimed the camera at the origin when they were made.
  controls.update();
  controls.enableRotate = false;
  controls.zoomToCursor = true;
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };

  const size = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
    return { w, h };
  };

  // The first view holds the whole yard.
  const fit = () => {
    const { w, h } = size();
    camera.updateMatrixWorld();
    const seen = new THREE.Box3();
    const { min, max } = picture.bounds;
    for (const x of [min.x, max.x]) {
      for (const z of [min.z, max.z]) {
        seen.expandByPoint(new THREE.Vector3(x, 0, z).applyMatrix4(camera.matrixWorldInverse));
      }
    }
    const extent = seen.getSize(new THREE.Vector3());
    const middle = seen.getCenter(new THREE.Vector3());
    camera.zoom = Math.min(w / extent.x, h / extent.y) * 0.94;
    controls.minZoom = camera.zoom * 0.5;
    controls.maxZoom = 80;
    // Look at the ground under the middle of what is seen.
    const eye = new THREE.Vector3(middle.x, middle.y, 0).applyMatrix4(camera.matrixWorld);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const ground = eye.addScaledVector(forward, -eye.y / forward.y);
    controls.target.copy(ground);
    camera.position.copy(ground).add(away);
    camera.updateProjectionMatrix();
    controls.update();
  };

  const render = () => {
    host.classList.toggle("far", camera.zoom < FAR);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  };

  // A wagon, or the figure at work on it, says under the pointer which bead
  // it is; a building which group's it is.
  const ray = new THREE.Raycaster();
  const under = (e: PointerEvent) => {
    const box = host.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - box.left) / box.width) * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1),
      camera,
    );
    let hit: THREE.Object3D | null = ray.intersectObjects([...stock.beads, ...picture.sheds], true)[0]?.object ?? null;
    while (hit && !hit.userData.bead && !hit.userData.shed) hit = hit.parent;
    return hit;
  };
  const point = (e: PointerEvent) => {
    const hit = under(e);
    if (!hit) {
      tip.style.display = "none";
      return;
    }
    tip.textContent = hit.userData.shed ? house(hit.userData.shed as Shed) : describe(hit.userData.bead as Bead, hit.userData.crew === true);
    tip.style.display = "block";
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8)}px`;
  };
  host.addEventListener("pointermove", point);
  host.addEventListener("pointerdown", point);
  host.addEventListener("pointerleave", () => (tip.style.display = "none"));

  // A click on a wagon, or on the figure at work on it, opens the bead's
  // card; a click on anything else of the yard, or Escape, closes it. The
  // camera stays where it is.
  // Counts the cards opened and closed: an answer of the yard that comes
  // when its card was replaced or closed is dropped.
  let turn = 0;
  const open = async (bead: Bead) => {
    const mine = ++turn;
    // No serve script, no yard to ask: the card is the snapshot's bead.
    if (!api) return show(brief(bead, when, NEEDS_LIVE));
    show(brief(bead, when, ASKING));
    let next: Card;
    try {
      const response = await fetch(`${base}api/bead/${encodeURIComponent(bead.id)}`);
      if (response.status === 404) next = missing(bead.id);
      else if (!response.ok) throw new Error(`api/bead: ${response.status}`);
      else next = card((await response.json()) as Detail, when);
    } catch {
      next = brief(bead, when, NO_ANSWER);
    }
    if (mine === turn) show(next);
  };
  const shut = () => {
    turn++;
    side.hidden = true;
  };
  // A click, not the end of a drag or a pinch: one pointer, up where it
  // went down.
  let pressed: { x: number; y: number } | undefined;
  host.addEventListener("pointerdown", (e) => {
    pressed = e.isPrimary && e.button === 0 ? { x: e.clientX, y: e.clientY } : undefined;
  });
  host.addEventListener("pointerup", (e) => {
    const from = pressed;
    pressed = undefined;
    if (!from || Math.hypot(e.clientX - from.x, e.clientY - from.y) > SLOP) return;
    const bead = under(e)?.userData.bead as Bead | undefined;
    if (bead) void open(bead);
    else shut();
  });
  // The replay controls sit over the yard but outside its canvas. They are
  // still elsewhere on the page, so a click there closes the card too.
  document.addEventListener("pointerup", (e) => {
    const target = e.target;
    if (target instanceof Node && !host.contains(target) && !side.contains(target)) shut();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") shut();
  });

  // Drawn again on the next frame, and on every frame while anything moves.
  let stale = true;
  // A reader who asked for less motion sees the figures standing, not at it.
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  stock.still = calm.matches;
  calm.addEventListener("change", () => {
    stock.still = calm.matches;
    stale = true;
  });
  controls.addEventListener("change", () => (stale = true));
  window.addEventListener("resize", () => {
    size();
    stale = true;
  });
  fit();

  const hint = "drag to pan, scroll or pinch to zoom";
  if (first) {
    let player = first;
    // The yard's clock is its machine's, not the reader's: the snapshot says
    // how far the two are apart.
    let skew = api ? Date.parse(yard.taken_at) - Date.now() : 0;
    const now = () => Date.now() + skew;
    // Whether the feed's line is open.
    let fed = false;
    document.body.classList.add("replay");
    bar.hidden = false;
    const sound = new Sound(
      () => window.localStorage,
      () => new AudioContext(),
    );
    const told = () => {
      mute.setAttribute("aria-pressed", String(sound.on));
      play.textContent = player.playing ? "Pause" : "Play";
      live.textContent = fed || !player.live ? "Live" : "Live · no feed";
      live.setAttribute("aria-pressed", String(player.live));
      // Live, the window grows.
      scrub.max = String(player.to - player.from);
      for (const b of speeds.querySelectorAll("button")) b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === player.speed));
      scrub.value = String(player.clock - player.from);
      clock.textContent = time.format(player.clock);
      current.textContent = player.shown ? line(player.shown) : "";
    };
    for (const x of SPEEDS) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.speed = String(x);
      b.textContent = `${x}x`;
      b.addEventListener("click", () => {
        player.speed = x;
        told();
      });
      speeds.append(b);
    }
    play.addEventListener("click", () => {
      if (player.live) {
        // Paused, the picture stays at this moment while the yard goes on.
        player.live = false;
        player.playing = false;
      } else {
        // At the end of the window, play starts the day again.
        if (!player.playing && player.clock >= player.to) seek(player.from);
        player.playing = !player.playing;
      }
      told();
    });
    mute.addEventListener("click", () => {
      sound.set(!sound.on);
      told();
    });
    // Sound left on by an earlier visit starts with the first touch of this
    // one: a browser lets no page sound before.
    for (const touch of ["pointerup", "keydown"]) window.addEventListener(touch, () => sound.wake());
    // A scrub is a new state, not a move: everything stands where it was
    // then. It leaves the yard as it runs for the replay of the window.
    const seek = (clock: number) => {
      player.live = false;
      player.seek(clock);
      stock.show(plan(player.state.beads), { tween: false });
      stale = true;
      told();
    };
    scrub.addEventListener("input", () => seek(player.from + Number(scrub.value)));
    told();

    const run = (dt: number) => {
      if (api) player.extend(now());
      if (!player.playing) return;
      const passed = player.advance(dt);
      // Live, the yard's own pace, whatever speed the bar was left at.
      const speed = player.live ? 1 : player.speed;
      for (const cue of cues(passed)) sound.play(cue);
      for (const e of passed) {
        if (e.kind === "hook") stock.flash();
        const peer = e.data?.peer;
        if (peer !== undefined && e.kind === "peer_message_sent") stock.goods(peer, "out", e.data?.kind, speed);
        if (peer !== undefined && e.kind === "peer_message_received") stock.goods(peer, "in", e.data?.kind, speed);
      }
      if (passed.length > 0) {
        // A bead an advance took out of the state went past the buffer.
        const left = new Set(passed.filter((e) => e.kind === "advanced").map((e) => e.bead ?? ""));
        stock.show(plan(player.state.beads), { tween: true, left, speed });
      }
      // Played to the window's end, the replay is at now: it stays there.
      if (api && !player.live && player.clock >= player.to) player.follow();
      told();
    };

    const noted = () => {
      const window = api
        ? `following the yard, events since ${time.format(player.from)}`
        : `${log.events.length} events, ${time.format(player.from)} to ${time.format(player.to)}`;
      note.textContent = `${yard.depots.length} depots · ${window} · ${hint}`;
    };
    if (api) follow();

    // The yard as it runs: back to now on the bar, the feed's events into
    // the window, and a new snapshot when they outgrow this one.
    function follow() {
      live.hidden = false;
      live.addEventListener("click", () => {
        player.extend(now());
        player.follow();
        stock.show(plan(player.state.beads), { tween: false });
        stale = true;
        told();
      });

      // Take a snapshot in place of the one the page has: what it is built
      // of may be new, the slots it remembers keep everything placed where
      // it was. The picture is drawn again only when the structure changed.
      const adopt = (next: Snapshot) => {
        const before = player;
        const reshaped = shape(next.yard, next.layout) !== shape(yard, slots);
        ({ yard, layout: slots } = next);
        skew = Date.parse(yard.taken_at) - Date.now();
        player = new Player(yard, next.log, now());
        // What the feed said since the snapshot was taken.
        for (const event of before.after(player.seq)) player.append(event);
        player.speed = before.speed;
        if (before.live) {
          player.follow();
        } else {
          player.seek(before.clock);
          player.playing = before.playing;
        }
        if (reshaped) {
          // A label is an element of the page: it goes with its object.
          picture.root.traverse((o) => {
            if (o instanceof CSS2DObject) o.element.remove();
          });
          scene.remove(picture.root);
          picture = draw(plan(yard.beads), kit);
          scene.add(picture.root);
          stock.house(picture.sheds);
        }
        stock.show(plan(player.state.beads), { tween: before.live });
        stale = true;
        noted();
        told();
      };
      // One at a time: what asks while one is on its way gets the next.
      let asking = false;
      let again = false;
      const refresh = async () => {
        again = true;
        if (asking) return;
        asking = true;
        try {
          while (again) {
            again = false;
            const next = await snapshot();
            if (next) adopt(next);
          }
        } catch (err) {
          // The picture stays as it is; the next event that asks tries again.
          console.warn(err);
        } finally {
          asking = false;
        }
      };

      const listen = () => {
        const feed = new EventSource(`${base}api/feed?after=${player.seq}`);
        feed.onopen = () => {
          fed = true;
          told();
        };
        feed.onmessage = (message) => {
          const event = JSON.parse(message.data as string) as YardEvent;
          if (!player.append(event)) return;
          if (outgrown(event, player.world)) void refresh();
        };
        // More happened than the feed could say: start again from a snapshot.
        feed.addEventListener("reset", () => void refresh());
        feed.onerror = () => {
          fed = false;
          told();
          // The browser comes back by itself and says where it was; when it
          // has given up, a new line goes on after what the window holds.
          if (feed.readyState !== EventSource.CLOSED) return;
          feed.close();
          setTimeout(listen, 3000);
        };
      };
      listen();
    }
    // The frames: the replay's clock, what is on its way, and the picture
    // when either changed it. A frame after a long pause (a hidden tab)
    // counts as a short one, so the day does not jump.
    let before = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - before) / 1000, 0.1);
      before = now;
      run(dt);
      const moving = stock.tick(dt);
      // A shunter took wagons on or let go of them in this frame.
      if (stock.coupled > 0) sound.play("clank");
      stock.coupled = 0;
      if (moving || stale) {
        stale = false;
        render();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    noted();
  } else {
    // Nothing runs the frames of a still picture.
    stock.still = true;
    controls.addEventListener("change", render);
    window.addEventListener("resize", render);
    note.textContent = `${yard.depots.length} depots · ${yard.beads.length} open beads · as of ${yard.taken_at.replace("T", " ").replace("Z", " UTC")} · ${hint}`;
  }
  render();
  // For whoever drives the page from outside (a screenshot, a test).
  document.body.dataset.ready = "true";
}

start().catch((err: unknown) => {
  console.error(err);
  note.textContent = `signalbox could not draw the yard: ${err instanceof Error ? err.message : String(err)}`;
});
