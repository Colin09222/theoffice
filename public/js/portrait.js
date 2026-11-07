// ID-badge photos. Everyone gets a real headshot taken from their own 3D model, one at a time and out of the way of the room.
// Until it's developed (or where there's no WebGL at all) they get a drawn face in their own colours, which is never a letter in a box.
import * as THREE from '../vendor/three/three.module.min.js';
import { stage } from './stage.js';
import { h } from './dom.js';
import { loadModelCharacter } from './character.js';

const SVG = 'http://www.w3.org/2000/svg';
const W = 168, H = 200;
const photos = new Map();   // look key -> data URL
const waiting = new Map();  // look key -> { look, els: Set }
let running = false;

const keyOf = (look) => JSON.stringify(look);
const shape = (name, attrs) => { const el = document.createElementNS(SVG, name); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

/** The drawn stand-in: shoulders in their outfit, a face in their skin, hair in their hair. */
function drawn(look = {}) {
  const svg = shape('svg', { viewBox: '0 0 84 100', 'aria-hidden': 'true', class: 'portrait-drawn' });
  const skin = look.skin || '#e8b98f', hair = look.hairColor || '#3b2a20', top = look.outfitColor || '#2f4a6b';
  svg.append(shape('path', { d: 'M8 100c0-22 14-32 34-32s34 10 34 32z', fill: top }));
  svg.append(shape('rect', { x: 34, y: 56, width: 16, height: 18, rx: 6, fill: skin }));
  if (look.hair === 'long' || look.hair === 'pigtails') svg.append(shape('path', { d: 'M18 38c0-18 10-28 24-28s24 10 24 28v26H18z', fill: hair }));
  svg.append(shape('ellipse', { cx: 42, cy: 40, rx: 21, ry: 24, fill: skin }));
  if (look.hair !== 'none') svg.append(shape('path', { d: look.hair === 'mohawk' ? 'M36 18c0-8 3-14 6-14s6 6 6 14z' : look.hair === 'bun' ? 'M21 36c0-14 9-22 21-22s21 8 21 22c-12-8-28-8-42 0zM35 12a7 7 0 1 1 14 0 7 7 0 0 1-14 0z' : 'M20 38c0-16 9-26 22-26s22 10 22 26c-6-9-14-12-22-12s-16 3-22 12z', fill: hair }));
  svg.append(shape('circle', { cx: 34, cy: 42, r: 2.6, fill: '#1c1712' }), shape('circle', { cx: 50, cy: 42, r: 2.6, fill: '#1c1712' }));
  svg.append(shape('path', { d: 'M35 52c4 4 10 4 14 0', fill: 'none', stroke: '#1c1712', 'stroke-width': 2.4, 'stroke-linecap': 'round' }));
  return svg;
}

/** A photo frame for this look. It fills itself in if the picture has to be taken first. */
export function portrait(look, { accent = '#d9774a', name = '' } = {}) {
  const el = h('span.portrait', { 'aria-hidden': 'true', title: name || null }, drawn(look));
  if (!look) return el;
  const key = keyOf(look);
  if (photos.has(key)) { el.append(h('img', { src: photos.get(key), alt: '', width: W, height: H })); return el; }
  if (!stage.ok) return el;
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
    scene.add(new THREE.HemisphereLight('#fff4e0', '#9f8f7a', 2.2));
    const key = new THREE.DirectionalLight('#fff0d8', 2.6); key.position.set(1.5, 3, 4); scene.add(key);
    const cam = new THREE.PerspectiveCamera(18, W / H, 0.1, 40);
    const at = new THREE.Vector3();
    while (waiting.size) {
      const [k, job] = waiting.entries().next().value;
      waiting.delete(k);
      if (![...job.els].some((el) => el.isConnected)) continue;  // redrawn since it was asked for; a later render asks again if it matters
      const mc = await loadModelCharacter(job.look, { accent: job.accent, scale: 2.5 });
      if (document.hidden) await new Promise((r) => setTimeout(r, 200));
      mc.update?.(0.016);
      mc.group.rotation.y = Math.PI - 0.32;
      scene.add(mc.group); mc.group.updateMatrixWorld(true);
      (mc.head || mc.group).getWorldPosition(at);
      cam.position.set(at.x + 0.15, at.y + 0.5, at.z + 4.4); cam.lookAt(at.x, at.y + 0.22, at.z);
      renderer.render(scene, cam);
      const url = canvas.toDataURL('image/webp', 0.86);
      scene.remove(mc.group); mc.dispose?.();
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
