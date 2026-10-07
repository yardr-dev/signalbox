// The page: load the yard's snapshot, lay it out, draw it, and let the
// pointer move the camera over it.

import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { loadKit, palette } from "./kit";
import { layout } from "./layout";
import { describe, draw } from "./scene";
import "./style.css";
import type { Slots } from "./layout";
import type { Bead, Yard } from "./yard";

// Where the camera stands from what it looks at: turned a little off the
// tracks and looking down, so a track still reads left to right.
const AZIMUTH = THREE.MathUtils.degToRad(22);
const ELEVATION = THREE.MathUtils.degToRad(40);
const DISTANCE = 400;
// Pixels per unit of ground below which the sheds' names are hidden.
const FAR = 14;

const base = import.meta.env.BASE_URL;
const host = document.getElementById("yard")!;
const tip = document.getElementById("tip")!;
const note = document.getElementById("note")!;

async function start() {
  const response = await fetch(`${base}yard.json`);
  if (!response.ok) throw new Error(`yard.json: ${response.status}`);
  const yard = (await response.json()) as Yard;
  // The slots given so far. The page only reads them: what the file does not
  // hold yet is placed after what it does, the same way on every load.
  const remembered = await fetch(`${base}layout.json`);
  const slots = remembered.ok ? ((await remembered.json()) as Partial<Slots>) : {};
  const picture = draw(layout(yard, slots), await loadKit(base));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.grass);
  scene.add(picture.root);
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

  // A wagon or a crew under the pointer says which bead it is.
  const ray = new THREE.Raycaster();
  const point = (e: PointerEvent) => {
    const box = host.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - box.left) / box.width) * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1),
      camera,
    );
    let hit: THREE.Object3D | null = ray.intersectObjects(picture.beads, true)[0]?.object ?? null;
    while (hit && !hit.userData.bead) hit = hit.parent;
    if (!hit) {
      tip.style.display = "none";
      return;
    }
    tip.textContent = describe(hit.userData.bead as Bead, hit.userData.crew === true);
    tip.style.display = "block";
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 8)}px`;
  };
  host.addEventListener("pointermove", point);
  host.addEventListener("pointerdown", point);
  host.addEventListener("pointerleave", () => (tip.style.display = "none"));

  controls.addEventListener("change", render);
  window.addEventListener("resize", () => {
    size();
    render();
  });
  fit();
  render();

  note.textContent = `${yard.depots.length} depots · ${yard.beads.length} open beads · as of ${yard.taken_at.replace("T", " ").replace("Z", " UTC")} · drag to pan, scroll or pinch to zoom`;
  // For whoever drives the page from outside (a screenshot, a test).
  document.body.dataset.ready = "true";
}

start().catch((err: unknown) => {
  console.error(err);
  note.textContent = `signalbox could not draw the yard: ${err instanceof Error ? err.message : String(err)}`;
});
