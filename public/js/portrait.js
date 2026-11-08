// ID-badge photos. Everyone gets a real headshot of their own 3D self, one at a time and out of the way of the room. Until it's developed
// (or where there's no WebGL at all) they get a drawn face in the same colours and the same big eyes, from the cast's own spec.
import * as THREE from '../vendor/three/three.module.min.js';
import { stage } from './stage.js';
import { h } from './dom.js';
import { Character, drawnPortrait, jobOf } from './character.js';

const W = 168, H = 200;
const photos = new Map();   // look key -> data URL
const waiting = new Map();  // look key -> { look, els: Set }
let running = false;

const keyOf = (look) => JSON.stringify(look);

/** A photo frame for this look. It fills itself in if the picture has to be taken first. */
export function portrait(look, { accent = '#d9774a', name = '', develop: shoot = true } = {}) {
  const el = h('span.portrait', { 'aria-hidden': 'true', title: name || null }, drawnPortrait(look, accent));
  if (!look) return el;
  const key = keyOf(look);
  if (photos.has(key)) { el.append(h('img', { src: photos.get(key), alt: '', width: W, height: H })); return el; }
  // A photo already taken is used; otherwise the drawn face, with no renderer started for it. (The option is renamed in here:
  // as `develop` it hid the function below, and setTimeout was handed `true` to run as a string, which the CSP rightly refuses.)
  if (!stage.ok || !shoot) return el;
  const job = waiting.get(key) || { look, accent, els: new Set() };
  job.els.add(el); waiting.set(key, job);
  if (!running) { running = true; setTimeout(develop, 500); }
  return el;
}

async function develop() {
  let renderer;
  try {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#fff7e8', '#e0ccb2', 2.4));
    const key = new THREE.DirectionalLight('#fff3dc', 2.4); key.position.set(1.5, 3, 4); scene.add(key);
    const cam = new THREE.PerspectiveCamera(18, W / H, 0.1, 40);
    while (waiting.size) {
      const [k, job] = waiting.entries().next().value;
      waiting.delete(k);
      if (![...job.els].some((el) => el.isConnected)) continue;  // redrawn since it was asked for; a later render asks again if it matters
      const mc = new Character(job.look, { accent: job.accent, scale: 2.2, role: jobOf(job.look) });
      if (document.hidden) await new Promise((r) => setTimeout(r, 200));
      mc.update(0.016);
      mc.group.rotation.y = 0.22;  // just off square-on, so the big eyes both look at you
      scene.add(mc.group); mc.group.updateMatrixWorld(true);
      // Frame the whole soft face from the person's own height, so a wizard's hat and a very short manager both fit.
      const tall = mc.headTop, top = mc.labelY;
      const view = Math.max(tall * 0.92, top * 0.98), aimY = top - view * 0.5;
      cam.position.set(0.12, aimY + tall * 0.04, view / 2 / Math.tan(THREE.MathUtils.degToRad(9)) + 0.4);
      cam.lookAt(0, aimY, 0);
      renderer.render(scene, cam);
      const url = canvas.toDataURL('image/webp', 0.86);
      scene.remove(mc.group); mc.dispose();
      photos.set(k, url);
      for (const el of job.els) if (!el.querySelector('img')) el.append(h('img', { src: url, alt: '', width: W, height: H }));
      for (const el of document.querySelectorAll(`.portrait[data-look-key="${CSS.escape(k)}"]`)) if (!el.querySelector('img')) el.append(h('img', { src: url, alt: '', width: W, height: H }));
      await new Promise((r) => setTimeout(r, 30));  // give the room its frame back
    }
  } catch { /* the drawn faces stay, and they are fine */ } finally {
    renderer?.dispose(); renderer?.forceContextLoss?.();
    running = false;
    if (waiting.size && stage.ok) { running = true; setTimeout(develop, 1500); }
  }
}
