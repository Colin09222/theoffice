// The cutaway office. Characters act out what the agents are really doing: every state here comes from the SSE stream.
// The whole static room bakes into a handful of vertex-coloured draw calls (see batch.js), the floor carries baked contact
// shadows and window light, and each person is seven or so calls, so a busy floor still runs well on a phone.
import * as THREE from '../vendor/three/three.module.min.js';
import { Character, HEAD_TOP, loadModelCharacter } from './character.js';
import { stage } from './stage.js';
import { mergeColored } from './batch.js';
import { getWorld, makeTower, GROUND, FLOOR_H, TOWER_W } from './lobby-scene.js';
import { furniture, place } from './models.js';
import { planFor, makeNav, planBlocks, seatOf, deskRect, hasSofa, wallLines, doorways, roomAt, roomOfKind, roomCentre, officeSlots, seatSpot, ROOM_W, ROOM_D, WALL_H } from './layouts.js';
import { officeTheme, manner, assignRooms } from './offices.js';
import { textureSet, environmentMap, repeating } from './textures.js';
import { FloorLife, planProgress } from './life.js';
import { tidyLabels } from './labels.js';

const FS = 2.5;  // Kenney's furniture kit is about 0.4 of our room units; a desk comes out 0.96 high
const STAGE = { thinking: 'Thinking', typing: 'Writing', browsing: 'On the web', reading: 'Reading', talking: 'Talking', queued: 'Waiting' };
const SEAT_LEGACY = 0.65, SEAT_MODEL = 0.5;  // cushion heights of the stand-in chair and the kit's desk chair
const HOLD = 0.7;  // seconds each character state stays on stage before the next one shows
const CHAR_SCALE = 1.45;
const WORLD_SCALE = ROOM_W / TOWER_W;  // the room is one tower floor, blown up to walk around in
const SUN_DIR = new THREE.Vector3(0.74, 0.47, -0.32).normalize();
const SUN_FAR = 64;  // the sun's distance, and its shadow box, scale with the floor
const ZOOM_MIN = 0.8, ZOOM_MAX = 3.6;
// The CC0 texture each floor finish uses, and how many room units one repeat of it covers. Checker and rubber stay drawn by hand.
const FLOOR_TEX = { wood: ['wood', 3.2], darkwood: ['darkwood', 3.0], parquet: ['parquet', 2.2], concrete: ['concrete', 5], tile: ['tile', 2.6], carpet: ['carpet', 2.4], terrazzo: ['terrazzo', 3.2] };
const WALL_TEX = { paint: 'plaster', concrete: 'cast', brick: 'brick' };
const ROLE_TITLE = { manager: 'Office Manager', researcher: 'Researcher', writer: 'Writer', builder: 'Builder', designer: 'Designer', analyst: 'Analyst', marketer: 'Marketer', tester: 'Tester', illustrator: 'Illustrator' };
const ON_TABLE = new Set(['radio', 'televisionModern', 'televisionVintage', 'speakerSmall']);

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 16);
const cone = new THREE.ConeGeometry(1, 1, 12); const ico = new THREE.IcosahedronGeometry(0.5, 0);
const sph = new THREE.SphereGeometry(0.5, 14, 10);
const ROOM_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
const mats = new Map();
/** A colour holder: every plain piece bakes into the shared vertex-coloured material, so the material object itself never draws. */
function lam(color) { let m = mats.get(color); if (!m) { m = new THREE.MeshLambertMaterial({ color }); mats.set(color, m); } return m; }
function piece(parent, color, w, hh, d, x, y, z, { cast = true, recv = true, geo = box, mat, shade, ry = 0 } = {}) {
  const m = new THREE.Mesh(geo, mat || lam(color));
  m.scale.set(w, hh, d); m.position.set(x, y + hh / 2, z); m.castShadow = cast; m.receiveShadow = recv;
  if (shade) m.userData.shade = shade;
  if (ry) m.rotation.y = ry;
  parent.add(m);
  return m;
}
const canvasTex = (w, h, draw, repeat) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
};
function seeded(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const mix = (a, b, t) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
const shadeHex = (hex, f) => `#${new THREE.Color(hex).multiplyScalar(f).getHexString()}`;

/** One tile of flooring, drawn once and repeated across the baked floor. */
function floorTile(style, wall) {
  const r = seeded(7);
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  if (style === 'wood') {
    c.width = c.height = 512;
    x.fillStyle = '#9a6b45'; x.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 8; row++) {
      let px = -(row % 2) * 90;
      while (px < 512) {
        const len = 150 + r() * 90; const l = 46 + r() * 12;
        x.fillStyle = `hsl(${24 + r() * 7},${42 + r() * 10}%,${l - 8}%)`; x.fillRect(px, row * 64, len, 63);
        x.strokeStyle = 'rgba(70,40,20,.14)'; x.lineWidth = 1;
        for (let g = 0; g < 4; g++) { x.beginPath(); const gy = row * 64 + r() * 60; x.moveTo(px, gy); x.bezierCurveTo(px + len / 3, gy + 3, px + len / 2, gy - 3, px + len, gy); x.stroke(); }
        x.fillStyle = 'rgba(255,230,200,.07)'; x.fillRect(px, row * 64, len, 2);
        px += len + 1;
      }
    }
    return { c, across: 3 };
  }
  if (style === 'carpet') {
    c.width = c.height = 256;
    x.fillStyle = '#56637c'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.09})`; x.fillRect(r() * 256, r() * 256, 2, 2); }
    x.strokeStyle = 'rgba(0,0,0,.16)'; x.lineWidth = 2; x.strokeRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(255,255,255,.05)'; x.strokeRect(3, 3, 250, 250);
    return { c, across: 7 };
  }
  if (style === 'terrazzo') {
    c.width = c.height = 512;
    x.fillStyle = '#e6dfd1'; x.fillRect(0, 0, 512, 512);
    const cs = ['#c98d6c', '#6f7f8f', '#3f4048', '#d9b86e', '#a9b8a0', '#ffffff', '#b2675a'];
    for (let i = 0; i < 700; i++) {
      x.fillStyle = cs[Math.floor(r() * cs.length)];
      x.beginPath(); const px = r() * 512, py = r() * 512, s = 2 + r() * 9;
      x.moveTo(px, py); for (let k = 0; k < 5; k++) x.lineTo(px + (r() - 0.5) * s * 2, py + (r() - 0.5) * s * 2); x.fill();
    }
    x.strokeStyle = 'rgba(90,80,70,.18)'; x.lineWidth = 3; x.strokeRect(0, 0, 512, 512);
    return { c, across: 3 };
  }
  if (style === 'parquet') {
    c.width = c.height = 512;
    x.fillStyle = '#7d5230'; x.fillRect(0, 0, 512, 512);
    // Blocks of four strips, each block turned from its neighbour.
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 4; k++) {
        x.fillStyle = `hsl(${25 + r() * 7},${40 + r() * 14}%,${30 + r() * 12}%)`;
        if ((i + j) % 2) x.fillRect(i * 128 + k * 32, j * 128, 31, 127); else x.fillRect(i * 128, j * 128 + k * 32, 127, 31);
      }
      x.strokeStyle = 'rgba(40,22,10,.35)'; x.lineWidth = 1.5; x.strokeRect(i * 128, j * 128, 128, 128);
    }
    return { c, across: 3 };
  }
  if (style === 'checker') {
    c.width = c.height = 256;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { x.fillStyle = (i + j) % 2 ? '#2d2a33' : '#f1ebdd'; x.fillRect(i * 128, j * 128, 128, 128); }
    x.strokeStyle = 'rgba(0,0,0,.12)'; x.lineWidth = 1.5; for (const v of [0, 128]) { x.beginPath(); x.moveTo(v, 0); x.lineTo(v, 256); x.moveTo(0, v); x.lineTo(256, v); x.stroke(); }
    return { c, across: 5 };
  }
  if (style === 'tile') {
    c.width = c.height = 256;
    x.fillStyle = '#b8c6c9'; x.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const l = 82 + r() * 7; x.fillStyle = `hsl(190,16%,${l}%)`; x.fillRect(i * 64 + 2, j * 64 + 2, 60, 60); x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(i * 64 + 2, j * 64 + 2, 60, 5); }
    return { c, across: 3 };
  }
  if (style === 'rubber') {
    c.width = c.height = 256;
    x.fillStyle = '#34363d'; x.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.fillStyle = 'rgba(255,255,255,.1)'; x.beginPath(); x.arc(16 + i * 32 + (j % 2) * 16, 16 + j * 32, 7, 0, 7); x.fill(); x.fillStyle = 'rgba(0,0,0,.28)'; x.beginPath(); x.arc(17 + i * 32 + (j % 2) * 16, 18 + j * 32, 6, 0, 7); x.fill(); }
    return { c, across: 4 };
  }
  c.width = c.height = 512;
  x.fillStyle = '#9a9894'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 6000; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.05})`; x.fillRect(r() * 512, r() * 512, 3, 3); }
  for (let i = 0; i < 6; i++) { x.strokeStyle = 'rgba(60,60,60,.08)'; x.lineWidth = 1; x.beginPath(); x.moveTo(r() * 512, r() * 512); x.lineTo(r() * 512, r() * 512); x.stroke(); }
  x.strokeStyle = 'rgba(40,40,40,.25)'; x.lineWidth = 3; x.strokeRect(1, 1, 510, 510);
  return { c, across: 3 };
}

/** One repeat of a wall finish, tinted by the floor's wall colour, so the colour picker still means something. Plain paint needs none. */
function wallSkin(style, wall) {
  const r = seeded(11);
  return canvasTex(512, 512, (x, w, h) => {
    if (style === 'brick') {
      x.fillStyle = mix(wall, '#d8cdbd', 0.6); x.fillRect(0, 0, w, h);
      for (let row = 0; row < 12; row++) {
        const off = row % 2 ? -42 : 0;
        for (let col = 0; col < 7; col++) {
          x.fillStyle = mix(mix(wall, '#9c4f35', 0.72), r() > 0.5 ? '#6f3524' : '#c07a56', r() * 0.42);
          x.fillRect(off + col * 84 + 2, row * 42.67 + 2, 80, 38.6);
          x.fillStyle = 'rgba(255,255,255,.05)'; x.fillRect(off + col * 84 + 2, row * 42.67 + 2, 80, 4);
        }
      }
      return;
    }
    if (style === 'wood') {
      for (let i = 0; i < 8; i++) {
        x.fillStyle = mix(mix(wall, '#6d4528', 0.74), r() > 0.5 ? '#4f3019' : '#8c6239', r() * 0.3); x.fillRect(i * 64, 0, 63, h);
        x.strokeStyle = 'rgba(40,20,8,.14)'; x.lineWidth = 1;
        for (let g = 0; g < 5; g++) { x.beginPath(); const gx = i * 64 + r() * 60; x.moveTo(gx, 0); x.bezierCurveTo(gx + 4, h / 3, gx - 4, h / 2, gx, h); x.stroke(); }
        x.fillStyle = 'rgba(20,10,4,.4)'; x.fillRect(i * 64 + 63, 0, 1, h);
      }
      return;
    }
    if (style === 'panels') {
      x.fillStyle = mix(wall, '#ffffff', 0.25); x.fillRect(0, 0, w, h);
      for (const [px, py, pw, ph] of [[0, 0, 256, 256], [256, 0, 256, 256], [0, 256, 256, 256], [256, 256, 256, 256]]) {
        const g = x.createLinearGradient(px, py, px + pw, py + ph); g.addColorStop(0, 'rgba(255,255,255,.2)'); g.addColorStop(1, 'rgba(0,0,0,.09)');
        x.fillStyle = g; x.fillRect(px + 3, py + 3, pw - 6, ph - 6);
        x.strokeStyle = 'rgba(30,36,46,.42)'; x.lineWidth = 3; x.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3);
      }
      return;
    }
    // Board-formed concrete: faint horizontal pours and the holes the formwork left.
    x.fillStyle = mix(wall, '#9a9a96', 0.72); x.fillRect(0, 0, w, h);
    for (let i = 0; i < 3500; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.05})`; x.fillRect(r() * w, r() * h, 3, 3); }
    x.strokeStyle = 'rgba(40,40,40,.22)'; x.lineWidth = 2; for (const y of [0, 170, 340]) { x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); }
    x.fillStyle = 'rgba(30,30,30,.4)'; for (const [hx, hy] of [[85, 85], [425, 85], [85, 255], [425, 255], [85, 425], [425, 425]]) { x.beginPath(); x.arc(hx, hy, 7, 0, 7); x.fill(); }
  }, [1, 1]);
}
/** Wall art, drawn once from the company's own colours and name. `i` picks which piece of the set this frame shows. */
function artTexture(style, i, primary, accent, name) {
  const initial = (String(name || '?').trim()[0] || '?').toUpperCase();
  const initials = String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  return canvasTex(256, 320, (x, w, h) => {
    if (style === 'logo') {
      x.fillStyle = '#f7f1e4'; x.fillRect(0, 0, w, h);
      x.fillStyle = primary; x.beginPath(); x.arc(w / 2, h * 0.44, 92, 0, 7); x.fill();
      x.strokeStyle = accent; x.lineWidth = 9; x.beginPath(); x.arc(w / 2, h * 0.44, 76, 0, 7); x.stroke();
      x.fillStyle = '#fff8e8'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `600 ${initials.length > 1 ? 74 : 104}px Fraunces, Georgia, serif`; x.fillText(initials || initial, w / 2, h * 0.45);
      x.fillStyle = '#2b2d35'; x.font = '600 22px ui-sans-serif, system-ui, sans-serif';
      let label = String(name || ''); while (x.measureText(label).width > w - 26 && label.length > 3) label = label.slice(0, -1);
      x.fillText(label, w / 2, h * 0.86);
      return;
    }
    if (style === 'posters') {
      const inks = [[primary, accent], [accent, '#23212f'], ['#23212f', primary], ['#f7f1e4', primary]][i % 4];
      x.fillStyle = inks[0]; x.fillRect(0, 0, w, h);
      x.fillStyle = inks[1]; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '800 190px ui-sans-serif, system-ui, sans-serif'; x.fillText(initial, w / 2, h * 0.42);
      for (let k = 0; k < 3; k++) x.fillRect(26, h * 0.72 + k * 22, w - 52 - k * 40, 10);
      return;
    }
    if (style === 'skyline') {
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, mix(primary, '#ffffff', 0.45)); g.addColorStop(0.6, mix(accent, '#ffffff', 0.25)); g.addColorStop(1, accent); x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = mix(accent, '#ffffff', 0.7); x.beginPath(); x.arc(w * (0.3 + (i % 3) * 0.2), h * 0.34, 34, 0, 7); x.fill();
      const r = seeded(21 + i);
      for (let layer = 0; layer < 2; layer++) { x.fillStyle = layer ? primary : mix(primary, '#ffffff', 0.35); for (let px = -8; px < w;) { const bw = 20 + r() * 30, bh = (layer ? 60 : 110) + r() * 90; x.fillRect(px, h - bh, bw, bh); px += bw + 2; } }
      return;
    }
    // The original pair: soft shapes, and bars on a dark ground.
    if (i % 2 === 0) {
      x.fillStyle = '#f4ecdc'; x.fillRect(0, 0, w, h);
      x.fillStyle = primary; x.beginPath(); x.arc(w * 0.42, h * 0.42, 74, 0, 7); x.fill();
      x.fillStyle = accent; x.fillRect(w * 0.3, h * 0.55, w * 0.5, h * 0.24);
      x.strokeStyle = '#22242c'; x.lineWidth = 7; x.beginPath(); x.moveTo(30, h - 50); x.bezierCurveTo(90, h - 120, 140, h - 10, w - 30, h - 80); x.stroke();
      return;
    }
    x.fillStyle = '#1f2230'; x.fillRect(0, 0, w, h);
    for (let k = 0; k < 9; k++) { x.fillStyle = k % 2 ? accent : primary; x.globalAlpha = 0.5 + (k % 3) * 0.2; x.fillRect(20 + k * 24, h - 30 - (30 + ((k * 37) % 150)), 16, 30 + ((k * 37) % 150)); }
    x.globalAlpha = 1; x.strokeStyle = '#f4ecdc'; x.lineWidth = 3; x.strokeRect(10, 10, w - 20, h - 20);
  });
}

function screenTexture(kind, brand, accent) {
  return canvasTex(128, 96, (x, w, h) => {
    const r = seeded(kind === 'code' ? 3 : 8);
    if (kind === 'idle') {
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#1b2440'); g.addColorStop(1, '#0d1222'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = accent; x.globalAlpha = 0.7; x.beginPath(); x.arc(w * 0.5, h * 0.45, 9, 0, 7); x.fill(); x.globalAlpha = 1;
      x.fillStyle = 'rgba(255,255,255,.5)'; x.fillRect(w * 0.5 - 14, h * 0.7, 28, 3);
      return;
    }
    x.fillStyle = kind === 'code' ? '#141c30' : '#f6f3ec'; x.fillRect(0, 0, w, h);
    if (kind === 'code') { x.fillStyle = '#1b2440'; x.fillRect(0, 0, 14, h); x.fillStyle = '#0f1526'; x.fillRect(0, 0, w, 7); x.fillStyle = brand; x.fillRect(4, 2, 18, 3); }
    else { x.fillStyle = brand; x.fillRect(0, 0, w, 10); x.fillStyle = '#ffffff'; x.fillRect(5, 3, 20, 4); x.fillStyle = '#e8e4da'; x.fillRect(0, 10, w, 1); }
    for (let y = 12; y < h; y += 8) {
      const indent = kind === 'code' ? 16 + Math.floor(r() * 4) * 8 : 6;
      let px = indent;
      if (kind === 'code') { x.fillStyle = '#3a4668'; x.fillRect(3, y, 8, 3); }
      while (px < w - 10 && r() > 0.14) {
        const len = 6 + r() * 24;
        x.fillStyle = kind === 'code' ? ['#7dd3fc', '#f9a8d4', '#fde68a', '#a7f3d0', '#cbd5e1', '#c4b5fd'][Math.floor(r() * 6)] : (y < 22 ? '#2b2d36' : y % 24 === 12 ? brand : '#8a8e99');
        x.fillRect(px, y, len, 4); px += len + 4;
      }
      if (kind === 'page' && y > 40 && r() > 0.7) { x.fillStyle = mix(brand, '#ffffff', 0.7); x.fillRect(70, y - 2, 50, 18); y += 16; }
    }
  }, [1, 1]);
}

function makeChair(parent, x, z, color, { big = false, ry = 0 } = {}) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
  const w = big ? 0.8 : 0.7;
  piece(g, '#2c2c33', 0.5, 0.04, 0.5, 0, 0.02, 0, { geo: cyl, cast: false });
  piece(g, '#44454d', 0.07, 0.5, 0.07, 0, 0.05, 0, { geo: cyl });
  piece(g, color, w, 0.13, 0.66, 0, 0.52, 0);
  piece(g, shadeHex(color, 0.82), w, 0.74, 0.1, 0, 0.6, 0.3);
  piece(g, color, w - 0.1, 0.5, 0.06, 0, 0.78, 0.3);
  if (big) { piece(g, '#2c2c33', 0.07, 0.28, 0.4, -w / 2 + 0.03, 0.62, 0.06); piece(g, '#2c2c33', 0.07, 0.28, 0.4, w / 2 - 0.03, 0.62, 0.06); }
  return g;
}

/**
 * A desk. The stand-in desk, monitor, keyboard, mouse and chair go into `legacy`, which the kit's models replace once they
 * load; the screen face, its glow and the progress bar are ours and stay in the room either way.
 */
function makeDesk(parent, detail, legacy, x, z, chairColor, brand, accent, { big = false, seed = 1, ry = 0, live = true } = {}) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
  const dg = new THREE.Group(); dg.position.set(x, 0, z); dg.rotation.y = ry; detail.add(dg);
  const lg = new THREE.Group(); lg.position.set(x, 0, z); lg.rotation.y = ry; legacy.add(lg);
  const r = seeded(seed * 31 + 5);
  const W = big ? 3 : 2.3, D = big ? 1.4 : 1.1;
  const top = big ? '#6e4a33' : '#dcc7a7';
  piece(lg, top, W, 0.08, D, 0, 0.94, -0.2);
  piece(lg, shadeHex(top, 0.8), W, 0.03, D + 0.02, 0, 0.91, -0.2, { cast: false });
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) piece(lg, '#3d3b44', 0.07, 0.91, 0.07, lx * (W / 2 - 0.12), 0, -0.2 + lz * (D / 2 - 0.12));
  piece(lg, '#3d3b44', W - 0.3, 0.05, 0.05, 0, 0.3, -0.2 - D / 2 + 0.12, { cast: false });
  // Monitor, keyboard, mouse.
  piece(lg, '#25262d', 0.3, 0.03, 0.2, 0, 1.02, -0.52, { cast: false });
  piece(lg, '#25262d', 0.1, 0.28, 0.08, 0, 1.03, -0.55);
  piece(lg, '#2a2b33', 1.1, 0.74, 0.06, 0, 1.24, -0.58);
  let screenMat = null, glow = null, bar = null;
  if (live) {
    screenMat = new THREE.MeshBasicMaterial({ color: '#1a2030' });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.64), screenMat);
    screen.position.set(0, 1.61, -0.545); g.add(screen);
    glow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), new THREE.MeshBasicMaterial({ map: parent.userData.glowTex, color: '#000000', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.set(0, 1.56, -0.61); glow.visible = false; glow.userData.keep = true; g.add(glow);
    bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.05), new THREE.MeshBasicMaterial({ color: accent }));
    bar.position.set(-0.5, 1.315, -0.54); bar.scale.x = 0.0001; bar.visible = false; bar.userData.keep = true; g.add(bar);
  }
  piece(lg, '#e9e4d8', 0.74, 0.03, 0.25, 0, 1.02, 0.18);
  piece(lg, '#2a2b33', 0.68, 0.012, 0.19, 0, 1.05, 0.18, { cast: false });
  piece(lg, '#ece6d8', 0.12, 0.04, 0.18, 0.55, 1.02, 0.2, { geo: sph, cast: false });
  // Things people leave on desks: mug, papers, a sticky note, a pen pot, a photo, a small plant.
  piece(dg, r() > 0.5 ? accent : '#f3ead8', 0.14, 0.15, 0.14, -0.8 + r() * 0.1, 1.02, 0.12, { geo: cyl, cast: false });
  piece(dg, '#f6f3ea', 0.34, 0.012, 0.44, 0.78 + r() * 0.1, 1.02, -0.05, { cast: false, ry: (r() - 0.5) * 0.5 });
  piece(dg, '#fbf7ea', 0.3, 0.012, 0.42, 0.74 + r() * 0.1, 1.034, -0.1, { cast: false, ry: (r() - 0.5) * 0.5 });
  piece(dg, ['#f8d66b', '#f7a1b5', '#9be3c8'][Math.floor(r() * 3)], 0.14, 0.14, 0.01, 0.44, 1.37, -0.55, { cast: false });
  piece(dg, '#3d3b44', 0.1, 0.12, 0.1, -0.85, 1.02, -0.4, { geo: cyl, cast: false });
  piece(dg, '#2a2b33', 0.02, 0.2, 0.02, -0.86, 1.1, -0.4, { cast: false, ry: 0.3 }); piece(dg, brand, 0.02, 0.18, 0.02, -0.83, 1.1, -0.42, { cast: false });
  if (big) {
    piece(dg, '#2a2c33', 0.24, 0.03, 0.24, -W / 2 + 0.35, 1.02, -0.4, { geo: cyl, cast: false });
    piece(dg, '#2a2c33', 0.03, 0.5, 0.03, -W / 2 + 0.35, 1.05, -0.4, { cast: false });
    piece(dg, '#e8c76c', 0.32, 0.18, 0.32, -W / 2 + 0.35, 1.5, -0.4, { geo: cone });
    piece(dg, '#f8f3e6', 0.3, 0.012, 0.2, W / 2 - 0.5, 1.02, 0.1, { cast: false });
    piece(dg, '#2a2b33', 0.22, 0.16, 0.02, W / 2 - 0.5, 1.02, -0.45, { cast: false }); piece(dg, brand, 0.18, 0.12, 0.01, W / 2 - 0.5, 1.04, -0.44, { cast: false });
  } else if (r() > 0.45) {
    piece(dg, '#b86a4b', 0.16, 0.13, 0.16, -0.86, 1.02, -0.05, { geo: cyl, cast: false });
    piece(dg, r() > 0.5 ? '#5e9160' : '#4f7a54', 0.22, 0.22, 0.22, -0.86, 1.13, -0.05, { geo: ico });
  }
  makeChair(lg, 0, 0.84, chairColor, { big });
  return { group: g, detail: dg, screenMat, glow, bar, ...seatOf([x, z, ry]) };
}

/** Three kinds of plant, so a floor with many plants does not read as one plant copied. */
function makePlant(parent, x, z, kind = 0, size = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  const canopy = new THREE.Group(); g.add(canopy);
  if (kind === 1) {
    piece(g, '#d9cdb8', 0.34 * size, 0.6 * size, 0.34 * size, 0, 0, 0, { geo: cyl });
    piece(g, '#4a3a2a', 0.08 * size, 1.2 * size, 0.08 * size, 0, 0.55 * size, 0, { geo: cyl });
    canopy.position.y = 1.7 * size;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const leaf = piece(canopy, i % 2 ? '#4f8a52' : '#5fa062', 0.22 * size, 0.04 * size, 0.95 * size, Math.cos(a) * 0.38 * size, 0, Math.sin(a) * 0.38 * size, { ry: -a + Math.PI / 2 });
      leaf.rotation.x = 0.35; leaf.rotation.order = 'YXZ';
    }
  } else if (kind === 2) {
    piece(g, '#5b5f66', 0.5 * size, 0.42 * size, 0.5 * size, 0, 0, 0, { geo: cyl });
    canopy.position.y = 0.42 * size;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + i;
      const b = piece(canopy, i % 3 ? '#3f7246' : '#6aa84f', 0.07 * size, 0.6 * size + (i % 3) * 0.2 * size, 0.07 * size, Math.cos(a) * 0.1 * size, 0, Math.sin(a) * 0.1 * size, { geo: cone });
      b.rotation.z = Math.cos(a) * 0.35; b.rotation.x = -Math.sin(a) * 0.35;
    }
  } else {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * size, 0.2 * size, 0.46 * size, 12), lam('#b86a4b'));
    pot.position.y = 0.23 * size; pot.castShadow = true; g.add(pot);
    piece(g, '#5a4634', 0.5 * size, 0.03 * size, 0.5 * size, 0, 0.44 * size, 0, { geo: cyl, cast: false });
    const leaf = new THREE.IcosahedronGeometry(0.34 * size, 0);
    canopy.position.y = 0.5 * size;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const m = new THREE.Mesh(leaf, lam(i % 2 ? '#4f7a54' : '#5e9160'));
      m.position.set(Math.cos(a) * 0.26 * size, (0.22 + (i % 3) * 0.26) * size, Math.sin(a) * 0.26 * size);
      m.scale.y = 1.25; m.castShadow = true; m.receiveShadow = true; canopy.add(m);
    }
  }
  return { group: g, canopy };
}

const PET_SPEED = { dog: 1.5, cat: 1.5, bunny: 1.9, duck: 1.0, tortoise: 0.45, robot: 1.1 };
function buildPet(kind) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  if (kind === 'duck' || kind === 'bunny' || kind === 'tortoise' || kind === 'robot') {
    const head = new THREE.Group(); const tail = new THREE.Group(); body.add(head, tail);
    if (kind === 'duck') {
      piece(body, '#f5e16a', 0.36, 0.3, 0.5, 0, 0.1, 0, { geo: sph }); piece(body, '#e9cf4e', 0.2, 0.1, 0.26, -0.17, 0.18, -0.02, { geo: sph }); piece(body, '#e9cf4e', 0.2, 0.1, 0.26, 0.17, 0.18, -0.02, { geo: sph });
      for (const s of [-1, 1]) piece(body, '#e8842c', 0.1, 0.1, 0.16, s * 0.09, 0, 0.04, { geo: sph, cast: false });
      head.position.set(0, 0.42, 0.2); piece(head, '#f5e16a', 0.24, 0.24, 0.24, 0, -0.08, 0, { geo: sph }); piece(head, '#e8842c', 0.14, 0.05, 0.14, 0, -0.03, 0.14, { geo: sph, cast: false });
      for (const s of [-1, 1]) piece(head, '#1a1a1e', 0.04, 0.05, 0.03, s * 0.08, 0.01, 0.1, { geo: sph, cast: false });
      tail.position.set(0, 0.3, -0.24); piece(tail, '#e9cf4e', 0.1, 0.1, 0.14, 0, -0.04, -0.04, { geo: cone });
    } else if (kind === 'bunny') {
      piece(body, '#efe7dc', 0.32, 0.3, 0.46, 0, 0.06, 0, { geo: sph });
      for (const [x, z] of [[-0.11, 0.16], [0.11, 0.16], [-0.12, -0.14], [0.12, -0.14]]) piece(body, '#ded2c2', 0.1, 0.08, 0.16, x, 0, z, { geo: sph, cast: false });
      head.position.set(0, 0.34, 0.2); piece(head, '#efe7dc', 0.24, 0.22, 0.24, 0, -0.1, 0, { geo: sph });
      for (const s of [-1, 1]) { const e = piece(head, '#efe7dc', 0.07, 0.3, 0.05, s * 0.07, 0, -0.02, { geo: sph }); e.rotation.z = s * -0.12; piece(head, '#f0b7c3', 0.03, 0.2, 0.02, s * 0.07, 0.04, 0.01, { geo: sph, cast: false }); piece(head, '#1a1a1e', 0.035, 0.04, 0.02, s * 0.07, -0.03, 0.11, { geo: sph, cast: false }); }
      piece(head, '#e58e9f', 0.04, 0.03, 0.02, 0, -0.06, 0.12, { geo: sph, cast: false });
      tail.position.set(0, 0.24, -0.24); piece(tail, '#ffffff', 0.14, 0.14, 0.14, 0, -0.07, 0, { geo: sph, cast: false });
    } else if (kind === 'tortoise') {
      piece(body, '#5c7d46', 0.56, 0.3, 0.68, 0, 0.1, 0, { geo: sph }); piece(body, '#6f9455', 0.34, 0.14, 0.42, 0, 0.3, 0, { geo: sph, cast: false }); piece(body, '#3f5a30', 0.6, 0.06, 0.72, 0, 0.1, 0, { geo: cyl, cast: false });
      for (const [x, z] of [[-0.2, 0.22], [0.2, 0.22], [-0.2, -0.22], [0.2, -0.22]]) piece(body, '#a0a06c', 0.12, 0.12, 0.14, x, 0, z, { geo: sph, cast: false });
      head.position.set(0, 0.24, 0.38); piece(head, '#a0a06c', 0.16, 0.15, 0.2, 0, -0.08, 0, { geo: sph });
      for (const s of [-1, 1]) piece(head, '#1a1a1e', 0.025, 0.03, 0.02, s * 0.05, -0.02, 0.07, { geo: sph, cast: false });
      tail.position.set(0, 0.16, -0.34); piece(tail, '#a0a06c', 0.05, 0.05, 0.12, 0, -0.02, -0.05, { geo: cone });
    } else {
      // A robot vacuum with a little face: a disc that wanders about and blinks at people.
      piece(body, '#2f323a', 0.62, 0.1, 0.62, 0, 0.02, 0, { geo: cyl }); piece(body, '#dfe3e8', 0.56, 0.05, 0.56, 0, 0.12, 0, { geo: cyl, cast: false }); piece(body, '#30e2a0', 0.46, 0.012, 0.03, 0, 0.17, 0.14, { cast: false });
      head.position.set(0, 0.17, 0); piece(head, '#3d4048', 0.22, 0.13, 0.22, 0, 0, 0, { geo: cyl }); for (const s of [-1, 1]) piece(head, '#30e2a0', 0.045, 0.05, 0.03, s * 0.05, 0.05, 0.1, { geo: sph, cast: false });
      tail.position.set(0, 0.3, -0.05); piece(tail, '#8e959c', 0.015, 0.2, 0.015, 0, 0, 0, { geo: cyl, cast: false }); piece(tail, '#f26b6b', 0.05, 0.05, 0.05, 0, 0.2, 0, { geo: sph, cast: false });
    }
    mergeColored(head, ROOM_MAT); mergeColored(tail, ROOM_MAT); mergeColored(body, ROOM_MAT, (o) => o.parent === head || o.parent === tail);
    return { group: g, body, head, tail };
  }
  const c = kind === 'dog' ? '#c08a56' : '#5a5560', c2 = kind === 'dog' ? '#e8d4b4' : '#8a858f';
  piece(body, c, 0.3, 0.28, 0.56, 0, 0.2, 0, { geo: sph });
  piece(body, c2, 0.22, 0.16, 0.4, 0, 0.16, 0.02, { geo: sph });
  const head = new THREE.Group(); head.position.set(0, 0.4, 0.3); body.add(head);
  piece(head, c, 0.3, 0.28, 0.3, 0, -0.14, 0, { geo: sph });
  piece(head, c2, 0.16, 0.12, 0.14, 0, -0.1, 0.12, { geo: sph });
  piece(head, '#1a1a1e', 0.06, 0.05, 0.05, 0, 0.02, 0.19, { geo: sph, cast: false });
  if (kind === 'dog') { for (const s of [-1, 1]) { const e = piece(head, shadeHex(c, 0.75), 0.1, 0.22, 0.06, s * 0.14, -0.1, -0.02, { geo: sph }); e.rotation.z = s * 0.3; } }
  else for (const s of [-1, 1]) piece(head, c, 0.09, 0.16, 0.05, s * 0.1, 0.06, -0.02, { geo: cone });
  for (const s of [-1, 1]) { const e = piece(head, '#1a1a1e', 0.04, 0.045, 0.02, s * 0.08, 0.02, 0.14, { cast: false }); e.scale.z = 0.5; }
  for (const [x, z] of [[-0.1, -0.16], [0.1, -0.16], [-0.1, 0.16], [0.1, 0.16]]) piece(body, c, 0.08, 0.2, 0.08, x, 0, z, { geo: cyl });
  const tail = new THREE.Group(); tail.position.set(0, 0.34, -0.28); body.add(tail);
  piece(tail, c, 0.06, 0.06, 0.3, 0, -0.03, -0.14, { ry: 0 }).rotation.x = 0.5;
  mergeColored(head, ROOM_MAT); mergeColored(tail, ROOM_MAT); mergeColored(body, ROOM_MAT, (o) => o.parent === head || o.parent === tail);
  return { group: g, body, head, tail };
}

export class Actor {
  constructor(view, info, seat, { isBoss = false } = {}) {
    this.view = view; this.id = info.id; this.info = info; this.seat = seat; this.isBoss = isBoss;
    this.char = new Character(info.look, { accent: view.colors.accent, scale: CHAR_SCALE });
    this.manner = manner(String(info.id)); this.char.setManner(this.manner);
    this.pos = new THREE.Vector3(seat.at[0], 0, seat.at[1]);
    this.group = this.char.group;
    this.group.position.copy(this.pos);
    this.heading = Math.PI; this.path = []; this.speed = 0; this.queue = []; this.action = null; this.seated = true; this.state = 'idle'; this.lastShelf = -99; this.idleTimer = 6 + Math.random() * 16; this.taskId = info.taskId ?? null;
    this.shadow = new THREE.Mesh(view.discGeo, view.discMat); this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.02; this.shadow.scale.setScalar(1.6);
    view.root.add(this.shadow);
    view.root.add(this.group);
    this.sitDown();
    this.group.position.y = this.seatY; this.char.blend.sit = 1;  // already sitting when the floor opens
    this.tag = document.createElement('div'); this.tag.className = 'char-tag';
    this.tag.dataset.side = view.actors.size % 2 ? 'left' : 'right';  // bubbles alternate sides, so a huddle stays readable
    this.nameEl = document.createElement('span'); this.nameEl.className = 'char-name'; this.nameEl.textContent = info.name;
    this.bubble = document.createElement('span'); this.bubble.className = 'char-bubble'; this.bubble.hidden = true;
    this.tag.append(this.bubble, this.nameEl);
    if (view.host) { this.tagOff = true; this.tag.style.visibility = 'hidden'; }  // the tower shows it once the floor is in view
    view.labels.append(this.tag);
    // The kit's model takes over from the stand-in when it lands; a failed load changes nothing.
    loadModelCharacter(info.look, { accent: view.colors.accent }).then((mc) => this.swapChar(mc)).catch((e) => { if (!this.dead) console.warn('character model unavailable', e); });
  }
  /** Same place, same pose, same props: the viewer only sees the person get a little more real. */
  swapChar(next) {
    if (this.dead) { next.dispose(); return; }
    const old = this.char;
    next.group.position.copy(old.group.position); next.group.rotation.copy(old.group.rotation);
    next.setAnim(old.anim); next.paper.visible = old.paper.visible; next.setManner(this.manner);
    // Mid-pose stays mid-pose: no standing up and sitting down again, or arms rising afresh, when the model takes over.
    next.inChair = old.inChair; Object.assign(next.blend, old.blend); next.typeK = old.typeK ?? old.blend.type;
    this.view.root.remove(old.group); old.dispose();
    this.char = next; this.group = next.group; this.view.root.add(next.group);
    if (this.seated) this.sitDown();
  }
  destroy() { this.dead = true; this.char.dispose(); this.shadow.removeFromParent(); this.tag.remove(); }
  sitDown() {
    this.seated = true; this.char.inChair = true; this.char.bigDesk = !!this.seat.big;
    // Hips land on the seat cushion; the legs hang in front of the chair, toward the desk. The height eases in with the
    // sitting pose (see update), so nobody hops up onto the seat.
    const f = this.seatFace();
    this.seatY = this.char.seatedY(this.view.modelsOn ? SEAT_MODEL : SEAT_LEGACY);
    this.group.position.set(this.seat.at[0] + Math.sin(f) * 0.06, this.group.position.y, this.seat.at[1] + Math.cos(f) * 0.06);
    this.heading = f; this.group.rotation.y = f;
    this.applyStatePose();
  }
  seatFace() { return this.seat.face ?? Math.PI; }
  /** Up from the chair and half a step back from the desk, whichever way this desk faces. */
  standUp() {
    if (!this.seated) return;
    const f = this.seatFace();
    this.seated = false; this.char.inChair = false;
    this.group.position.x -= Math.sin(f) * 0.36; this.group.position.z -= Math.cos(f) * 0.36;
  }
  goTo(x, z, then) {
    this.seated = false; this.char.inChair = false;
    this.path = this.view.nav.path(this.group.position.x, this.group.position.z, x, z);
    this.afterWalk = then;
    this.char.setAnim('walk');
  }
  /** Do these steps in order, unless a newer real event interrupts them. */
  perform(steps, { scene = false, offDuty = false } = {}) {
    this.queue = [...steps]; this.action = null; this.path = []; this.afterWalk = null; this.scene = scene; this.offDuty = offDuty; this.hush();
    this.next();
  }
  next() {
    this.hush();
    const s = this.queue.shift();
    this.action = s || null;
    if (!s) { this.scene = false; this.offDuty = false; this.view.life?.release(this); this.settle(); return; }
    if (s.unless?.()) { this.next(); return; }
    if (s.run) { s.run(this); this.next(); return; }
    if (s.walk) { const [wx, wz] = this.view.nav.freeNear(s.walk[0], s.walk[1]); this.goTo(wx, wz, () => this.next()); return; }
    if (s.anim || !this.seated) this.char.setAnim(s.anim || 'stand');
    this.holdUntil = this.view.time + (s.hold || 1);
    if (s.face !== undefined) this.faceTo = s.face;
    if (s.paper !== undefined) this.char.paper.visible = s.paper;
    if (s.say) this.speak(s.say, s.to, s.small, s.hold);
  }
  /** Says a line out loud, turned toward whoever it is for. The words sit over this person's head until the step ends. */
  speak(text, toId, small, hold) {
    this.speech = { text, small: !!small };
    const other = toId ? this.view.actors.get(toId) : null;
    if (other && other !== this) {
      other.attend(this, hold);
      if (!this.seated) this.faceTo = Math.atan2(other.group.position.x - this.group.position.x, other.group.position.z - this.group.position.z);
    }
    if (!this.seated || this.action?.anim) this.char.setAnim('talk');
    this.renderBubble();
    this.placeSide();
  }
  hush() { if (this.speech) { this.speech = null; this.renderBubble(); } }
  /** Someone is talking to this person: they turn toward the speaker and hear them out, then go back to what they were doing. */
  attend(other, secs) {
    this.listening = { who: other, until: this.view.time + secs };
    if (!this.seated && !this.action && !this.path.length) this.char.setAnim('listen');
  }
  /** Bubbles open toward the middle of the screen, so a long line never runs off the edge. */
  placeSide() { const side = (this.tagX ?? 0) > (this.view.w || 0) / 2 ? 'left' : 'right'; if (this.tag.dataset.side !== side) this.tag.dataset.side = side; }
  settle() {
    this.char.paper.visible = false;
    // Back to the chair unless already there.
    const [sx, sz] = this.seat.at;
    if (this.seated) { this.applyStatePose(); return; }
    if (Math.hypot(this.group.position.x - sx, this.group.position.z - sz) > 0.3) { this.goTo(sx, sz, () => this.sitDown()); return; }
    this.sitDown();
  }
  applyStatePose() {
    const s = this.state;
    const screen = this.seat.screenMat;
    if (screen) {
      const v = this.view;
      const on = s !== 'idle';
      if (s === 'typing') { screen.map = v.codeTex; screen.color.set('#ffffff'); }
      else if (s === 'browsing' || s === 'reading') { screen.map = v.pageTex; screen.color.set('#ffffff'); }
      else if (on) { screen.map = v.pageTex; screen.color.set('#c9c4ba'); }
      else { screen.map = v.idleTex; screen.color.set('#ffffff'); }
      screen.needsUpdate = true;
      if (this.seat.glow) { this.seat.glow.material.color.set(s === 'typing' ? '#2a5aa8' : '#8a8060'); this.seat.glow.visible = v.detailOn && on; }
      this.showProgress();
    }
    if (!this.seated) return;
    this.char.setAnim(s === 'typing' || s === 'browsing' ? 'type' : s === 'thinking' || s === 'queued' ? 'think' : s === 'talking' ? 'talk' : 'sit');
  }
  // Real events can flip faster than the eye. Each visible state gets a moment on stage, and the ones behind it wait their
  // turn in a short queue. Paced on the wall clock, so a slow frame rate never swallows states that arrive at real-time speed.
  setState(state, activity) {
    const now = performance.now() / 1000;
    const held = this.stateSince !== undefined && now - this.stateSince < HOLD;
    if (this.pending?.length || (held && state !== this.state)) {
      this.pending ||= [];
      const last = this.pending.at(-1);
      if (last && last[0] === state) { last[1] = activity; return; }
      this.pending.push([state, activity]);
      if (this.pending.length > 4) {
        // Too far behind: drop a filler state first, so the visible work (typing, reading, talking) still gets shown.
        const filler = this.pending.findIndex(([st]) => st === 'thinking' || st === 'queued');
        this.pending.splice(filler >= 0 ? filler : 0, 1);
      }
      return;
    }
    this.stateSince = now;
    this.applyState(state, activity);
  }
  applyState(state, activity) {
    const was = this.state;
    this.state = state; this.activity = activity;
    this.renderBubble();
    if (state === was) return;
    this.applyStatePose();
    // Called back to work from a break: the coffee can wait.
    if (state !== 'idle' && this.offDuty) { this.offDuty = false; this.queue = []; this.action = null; this.path = []; this.afterWalk = null; this.hush(); this.view.claims.delete(this); this.settle(); }
    // Reading sometimes means a trip to the bookshelf.
    if (state === 'reading' && this.view.time - this.lastShelf > 25 && this.seated && !this.action && !this.isManager) {
      this.lastShelf = this.view.time;
      const shelf = this.view.plan.shelf;
      this.perform([{ walk: [shelf[0] + 1.0, shelf[1] + (Math.random() - 0.5) * 2] }, { anim: 'listen', hold: 1.8, face: -Math.PI / 2 }]);
    }
  }
  renderBubble() {
    if (this.speech) {
      const key = `say|${this.speech.text}`;
      this.bubble.hidden = false;
      if (this.bubble.dataset.key !== key) {
        this.bubble.dataset.key = key; delete this.bubble.dataset.state;
        const line = document.createElement('span'); line.textContent = this.speech.text;
        this.bubble.className = `char-bubble speech${this.speech.small ? ' small-talk' : ''}`;
        this.bubble.replaceChildren(line);
      }
      return;
    }
    const busy = this.state !== 'idle';
    this.bubble.hidden = !busy;
    if (!busy) { delete this.bubble.dataset.key; return; }
    // The pill over a working person: what they are on, what stage it is at, and how far the plan has really got.
    const task = this.view.taskFor(this);
    const label = this.state === 'queued' ? 'Waiting for a line' : task?.title || this.activity?.slice(0, 40) || 'Thinking';
    const stage = STAGE[this.state] || '';
    const done = task ? planProgress(this.view.tasks, task) : null;
    const key = `work|${label}|${stage}|${done ? `${done.done}/${done.total}` : ''}`;
    if (this.bubble.dataset.key === key && this.bubble.dataset.state === this.state) return;
    this.bubble.dataset.key = key; this.bubble.dataset.state = this.state;
    this.bubble.dataset.text = label;
    this.bubble.className = 'char-bubble task-pill';
    const dots = document.createElement('i'); dots.className = 'dots'; dots.append(document.createElement('b'), document.createElement('b'), document.createElement('b'));
    const text = document.createElement('span'); text.textContent = label;
    this.bubble.replaceChildren(dots, text);
    if (done) { const n = document.createElement('em'); n.className = 'pill-done'; n.textContent = `${done.done}/${done.total}`; n.title = `${done.done} of ${done.total} tasks in this plan are done`; this.bubble.append(n); this.bubble.style.setProperty('--done', `${Math.round((done.done / done.total) * 100)}%`); } else this.bubble.style.removeProperty('--done');
    this.showProgress();
  }
  /** The bar on this person's screen shows the same real count as the pill over their head, and nothing when there is no count. */
  showProgress() {
    const bar = this.seat.bar; if (!bar) return;
    const task = this.state === 'idle' ? null : this.view.taskFor(this);
    const done = task ? planProgress(this.view.tasks, task) : null;
    bar.visible = !!done;
    if (done) { const f = Math.max(0.0001, done.done / done.total); bar.scale.x = f; bar.position.x = -0.5 + f / 2; }
  }
  /** Off the clock: a break, an errand or a word with a colleague, so an idle floor still feels alive. Nothing here pretends to be work. */
  idleErrand() { this.view.life.errand(this); }
  update(dt) {
    const g = this.group, time = this.view.time, wall = performance.now() / 1000;
    if (this.pending?.length && wall - this.stateSince >= HOLD) { const [st, ac] = this.pending.shift(); if (!this.pending.length) this.pending = null; this.stateSince = wall; this.applyState(st, ac); }
    let moving = 0;
    if (this.path.length) {
      const [tx, tz] = this.path[0];
      const dx = tx - g.position.x, dz = tz - g.position.z, d = Math.hypot(dx, dz);
      const v = this.manner.pace;
      if (d < 0.06) { this.path.shift(); if (!this.path.length) { const f = this.afterWalk; this.afterWalk = null; this.char.setAnim('stand'); f?.(); } } else {
        const step = Math.min(d, v * dt);
        g.position.x += (dx / d) * step; g.position.z += (dz / d) * step;
        this.faceTo = Math.atan2(dx, dz);
        moving = 1;
      }
    } else if (this.action && !this.action.walk && (time > this.holdUntil || this.action.until?.())) {
      this.next();
    } else if (!this.action && this.seated && this.state === 'idle' && !this.isBossAway) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) { this.idleTimer = 20 + Math.random() * 40; this.idleErrand(); }
    }
    if (this.seated) this.faceTo = this.seatFace();
    if (this.listening) {
      if (time > this.listening.until || this.listening.who.dead) { this.listening = null; if (!this.seated && !this.action && !this.path.length) this.char.setAnim('stand'); }
      else if (!moving) { const o = this.listening.who.group.position; this.faceTo = Math.atan2(o.x - g.position.x, o.z - g.position.z); }
    }
    if (this.faceTo !== undefined) {
      let diff = this.faceTo - g.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.rotation.y += diff * Math.min(1, dt * 10);
    }
    // Onto the seat and off it at the pace the sitting pose blends, so the hips glide instead of jumping.
    g.position.y += ((this.seated ? this.seatY : 0) - g.position.y) * Math.min(1, dt * 9);
    this.shadow.position.set(g.position.x, 0.02, g.position.z);
    // Outside set hours the staff have gone home: their desks stay, they don't. Checked every frame, so a new hire or a fresh model follows too.
    const home = !!this.view.closed && !this.isBoss;
    if (g.visible === home) { g.visible = !home; this.shadow.visible = !home; this.tag.hidden = home; }
    this.char.update(dt, moving);
  }
}

/**
 * One floor: the room, its furniture and its people, all under `root`. On a floor page it is a view of its own, with a scene, lights, the
 * city below, a camera and controls. In the tower (`host`) the same floor stands in a shared scene at its height, under the tower's camera
 * and lights, with no input of its own; promote() turns it into a floor page's view without rebuilding anything, people mid-stride and all.
 */
export class OfficeView {
  constructor({ state, labels, onSelect, onSmallTalk, keep = null, host = null }) {
    this.labels = labels; this.onSelect = onSelect; this.host = host;
    this.colors = state.floor.colors; this.decor = state.floor.decor; this.logoUrl = state.floor.logoUrl || null; this.companyName = state.floor.name;
    this.plan = planFor(this.decor.layout);
    this.staffCount = state.agents.filter((a) => a.role !== 'manager').length;
    this.scene = new THREE.Scene();
    // Linear fog with a long start: the room and the near city keep their full colour, only the far shore softens.
    this.scene.fog = new THREE.Fog('#ffffff', 140 * WORLD_SCALE, 620 * WORLD_SCALE);
    this.root = new THREE.Group(); this.root.name = `floor-${state.floor.number}`;
    if (!host) this.scene.add(this.root);
    this.grade = { vignette: 0.22, grain: 0.016 };
    this.ao = { radius: 0.9, intensity: 1.9, color: '#2b1b10', falloff: 1 };
    this.bloom = 0.1;
    this.floorNumber = state.floor.number;
    this.camera = host ? host.camera : new THREE.PerspectiveCamera(24, 1, 1, 3800);
    this.tagsOn = true;
    this.time = 0; this.yaw = 0.5; this.targetYaw = 0.5; this.pitch = 0.86; this.zoom = 1; this.targetZoom = 1; this.intro = 0;
    this.pan = new THREE.Vector2(); this.targetPan = new THREE.Vector2();
    // A preview rebuilds the room under the same camera, with no walk-in, so changing an option just changes the room.
    if (keep) { this.yaw = keep.yaw; this.targetYaw = keep.targetYaw; this.zoom = keep.zoom; this.targetZoom = keep.targetZoom; this.intro = 1; if (keep.pan) { this.pan.copy(keep.pan); this.targetPan.copy(keep.targetPan); } this.kept = true; }
    this.offices = new Map(); this.owners = new Map(); this.floorSets = new Map(); this.selected = null;
    this.claims = new Map(); this.actors = new Map(); this.nav = makeNav(); this.deskSlots = []; this.plantSpots = []; this.sway = []; this.tasks = state.tasks || []; this.pins = []; this.insets = null;
    this.life = new FloorLife(this, { onSmallTalk: onSmallTalk || null });
    this.detailOn = (stage.q?.density ?? 1) >= 0.6;
    this.tv = new THREE.Vector3();
    this.codeTex = screenTexture('code', this.colors.primary, this.colors.accent);
    this.pageTex = screenTexture('page', this.colors.primary, this.colors.accent);
    this.idleTex = screenTexture('idle', this.colors.primary, this.colors.accent);
    this.glowTex = canvasTex(64, 64, (x, w, h) => { const g = x.createRadialGradient(32, 32, 4, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,.7)'); g.addColorStop(0.5, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); });
    // A soft disc under every character: a touch of contact shadow where the shadow map is coarse or off.
    this.discGeo = new THREE.CircleGeometry(0.5, 20);
    this.discMat = new THREE.MeshBasicMaterial({ map: canvasTex(64, 64, (x, w, h) => { const g = x.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, 'rgba(20,24,40,.55)'); g.addColorStop(0.55, 'rgba(20,24,40,.24)'); g.addColorStop(1, 'rgba(20,24,40,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }), transparent: true, depthWrite: false });
    this.buildRoom();
    if (!host) this.buildWorld();
    this.syncAgents(state);
    if (!host) this.bind();
    this.loadLooks();
  }
  /** Normal and roughness maps only on a floor page of its own, where the room fills the screen. In the tower a floor is small and there may be several. */
  get pbr() { return !this.host && (stage.q?.density ?? 1) >= 0.6; }
  /** The real materials, a set at a time: floor and wall textures, and a panorama to light and reflect the room. All optional. */
  loadLooks() {
    const pbr = this.pbr;
    if (pbr && stage.renderer && !this.envRT) environmentMap(stage.renderer).then((rt) => { if (!rt) return; if (this.dead) { rt.dispose(); return; } this.envRT?.dispose(); this.envRT = rt; this.scene.environment = rt.texture; this.scene.environmentIntensity = 0.5; }).catch(() => {});
    const style = this.decor.wallMat || 'paint';
    if (WALL_TEX[style]) textureSet(WALL_TEX[style], { pbr }).then((set) => { if (set && !this.dead) this.skinWalls(style, set); });
    this.loadFloorSets();
  }
  /** Fetches any floor textures the rooms now need, then bakes the floor again with them. */
  loadFloorSets() {
    const pbr = this.pbr;
    const want = new Set([this.decor.floor, 'carpet', 'tile', ...[...this.offices.values()].map((o) => o.theme.floor)].filter((f) => FLOOR_TEX[f] && !this.floorSets.has(f)));
    if (!want.size) return;
    for (const f of want) this.floorSets.set(f, null);
    Promise.all([...want].map((f) => textureSet(FLOOR_TEX[f][0], { pbr }).then((set) => { if (set) this.floorSets.set(f, set); }))).then(() => { if (!this.dead) this.bakeFloor(); });
  }
  /** The city below and the tower under our feet: the same world the lobby orbits, scaled so one tower floor is this room. */
  buildWorld() {
    this.world = getWorld();
    const n = this.floorNumber;
    // A little lower than exact, so the tower's own slab sits just under our plate instead of fighting it for the same plane.
    const lift = -(GROUND + (n - 1) * FLOOR_H) * WORLD_SCALE - (n === 1 ? 0.9 : 0.35);  // the ground floor also clears the podium canopy
    this.worldLift = lift;
    this.stub = makeTower(Math.max(0, n - 1), { stub: true, env: this.world.environment() });
    this.stub.group.scale.setScalar(WORLD_SCALE); this.stub.group.position.y = lift;
    this.scene.add(this.stub.group);
  }
  buildRoom() {
    const s = this.scene; const { primary, accent } = this.colors; const d = this.decor; const L = this.plan;
    this.lounge = hasSofa(L);
    for (const [x, z, w, dd, bake] of planBlocks(L, { coffee: d.coffee, arcade: d.arcade, plants: d.plants, staffCount: this.staffCount })) this.nav.block(x, z, w, dd, { bake });
    s.add(new THREE.HemisphereLight('#cfe0f6', '#c4a98a', 1.1));
    const sun = new THREE.DirectionalLight('#ffdcb4', 2.7);
    sun.position.copy(SUN_DIR).multiplyScalar(SUN_FAR); sun.target.position.set(0, 0, 0);
    const size = stage.q?.shadow || 0;
    sun.castShadow = size > 0;
    sun.shadow.mapSize.set(size || 512, size || 512);
    Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 24, bottom: -24, near: 6, far: 150 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.035;
    this.sun = sun;
    s.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#bcd2f5', 0.55); fill.position.set(-17, 13, 23); s.add(fill);
    const env = getWorld().environment();
    s.environment = env; s.environmentIntensity = 0.35;
    const R = this.root;
    const room = new THREE.Group(); R.add(room); this.room = room; room.userData.glowTex = this.glowTex;
    const detail = new THREE.Group(); R.add(detail); this.detail = detail; detail.visible = this.detailOn;
    // Stand-in furniture: shown at once, swapped for the kit's models when they arrive, kept if they never do.
    const legacy = new THREE.Group(); R.add(legacy); this.legacy = legacy;
    const wallZ = -ROOM_D / 2, wallX = -ROOM_W / 2;

    // The floor plate is the top of the tower: a stone slab the size of the shaft, with a glass rail around the terrace left over.
    const plate = TOWER_W * WORLD_SCALE + 1.2;
    piece(room, '#e9dfcf', plate, 0.42, plate, 0, -0.48, 0);
    piece(room, '#d4c8b6', plate + 0.3, 0.12, plate + 0.3, 0, -0.6, 0, { cast: false });
    piece(room, '#d9d0c0', ROOM_W + 1.1, 0.05, ROOM_D + 1.1, 0, -0.08, 0, { recv: true, cast: false });
    piece(room, primary, ROOM_W + 0.9, 0.012, ROOM_D + 0.9, 0, -0.022, 0, { recv: false, cast: false });
    const rail = new THREE.MeshStandardMaterial({ color: '#cfe0ec', roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.4, depthWrite: false, envMap: env });
    for (const [x, z, w, dd] of [[0, plate / 2, plate, 0.06], [0, -plate / 2, plate, 0.06], [plate / 2, 0, 0.06, plate], [-plate / 2, 0, 0.06, plate]]) piece(room, null, w, 1.0, dd, x, 0, z, { cast: false, mat: rail });
    for (const [x, z] of [[-plate / 2 + 1.4, plate / 2 - 1.2], [plate / 2 - 1.4, plate / 2 - 1.2], [plate / 2 - 1.4, -plate / 2 + 1.2], [-plate / 2 + 1.4, -plate / 2 + 1.2]]) { piece(room, '#b9b0a2', 1.6, 0.5, 1.0, x, 0, z); piece(room, '#6c9452', 1.4, 0.45, 0.8, x, 0.5, z); }
    this.floorMat = new THREE.MeshStandardMaterial({ roughness: { carpet: 0.95, rubber: 0.8, tile: 0.35, checker: 0.35 }[d.floor] ?? 0.55, metalness: 0, envMapIntensity: 0.6 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), this.floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.userData.keep = true; room.add(floor);
    this.floorTile = floorTile(d.floor);
    this.officeStatic = new THREE.Group(); R.add(this.officeStatic);

    // Walls: the back one with two big windows looking over the city, the left one solid. A skirting board below and a cornice
    // above, both a shade off the wall colour, and a baked gradient so the walls read as lit from the windows.
    const wall = d.wall, wallDark = shadeHex(wall, 0.9), skirt = mix(wall, '#2a2a30', 0.72), trim = mix(wall, '#ffffff', 0.55);
    const wshade = [0, WALL_H, 0.84, 1.02];
    const backParts = []; { let at = -ROOM_W / 2; for (const [a, b] of L.windows) { backParts.push([at, a]); at = b; } backParts.push([at, ROOM_W / 2]); }
    for (const [a, b] of backParts) piece(room, wall, b - a, WALL_H, 0.3, (a + b) / 2, 0, wallZ - 0.15, { shade: wshade });
    const winMat = new THREE.MeshStandardMaterial({ color: '#a9c8dd', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.3, depthWrite: false, envMapIntensity: 1.2, envMap: env });
    this.winMat = winMat;
    for (const [a, b] of L.windows) {
      piece(room, wall, b - a, 1.0, 0.3, (a + b) / 2, 0, wallZ - 0.15, { shade: wshade });
      piece(room, wall, b - a, 0.36, 0.3, (a + b) / 2, WALL_H - 0.36, wallZ - 0.15, { shade: wshade });
      const w = new THREE.Mesh(new THREE.PlaneGeometry(b - a, WALL_H - 1.36), winMat); w.position.set((a + b) / 2, 1 + (WALL_H - 1.36) / 2, wallZ - 0.15); w.userData.keep = true; room.add(w);
      piece(room, '#2f343d', b - a + 0.1, 0.08, 0.36, (a + b) / 2, 0.96, wallZ - 0.15, { cast: false });
      piece(room, trim, b - a + 0.1, 0.05, 0.5, (a + b) / 2, 0.92, wallZ - 0.1, { cast: false });
      piece(room, '#2f343d', b - a + 0.1, 0.08, 0.36, (a + b) / 2, WALL_H - 0.4, wallZ - 0.15, { cast: false });
      for (let mx = a; mx <= b + 0.01; mx += (b - a) / 4) piece(room, '#2f343d', 0.07, WALL_H - 1.36, 0.14, mx, 1, wallZ - 0.15, { cast: false });
      piece(room, '#2f343d', b - a, 0.05, 0.14, (a + b) / 2, 2.6, wallZ - 0.15, { cast: false });
    }
    piece(room, wall, 0.3, WALL_H, ROOM_D + 0.3, wallX - 0.15, 0, 0, { shade: wshade });
    // Cornice and a sliver of ceiling along both walls; skirting along the bottom.
    piece(room, trim, ROOM_W + 0.6, 0.22, 0.42, 0, WALL_H - 0.22, wallZ - 0.09, { cast: false });
    piece(room, trim, 0.42, 0.22, ROOM_D + 0.3, wallX - 0.09, WALL_H - 0.22, 0, { cast: false });
    piece(room, '#f7f1e4', ROOM_W + 0.6, 0.12, 0.9, 0, WALL_H, wallZ + 0.15, { cast: false });
    piece(room, '#f7f1e4', 0.9, 0.12, ROOM_D + 0.3, wallX + 0.15, WALL_H, 0, { cast: false });
    piece(room, skirt, ROOM_W, 0.16, 0.05, 0, 0, wallZ + 0.025, { cast: false });
    piece(room, skirt, 0.05, 0.16, ROOM_D, wallX + 0.025, 0, 0, { cast: false });
    piece(room, wallDark, ROOM_W, 0.04, 0.03, 0, 0.16, wallZ + 0.015, { cast: false });
    piece(room, wallDark, 0.03, 0.04, ROOM_D, wallX + 0.015, 0.16, 0, { cast: false });
    if (d.wallMat && d.wallMat !== 'paint') { this.wallSkin = this.wallSkinMesh(d.wallMat, wall, backParts); room.add(this.wallSkin); }

    this.buildWalls(room, env);
    this.buildMeeting(room, detail, legacy);

    // Whiteboard, where plans get made.
    const boardMat = new THREE.MeshBasicMaterial({ map: this.boardTexture([]) });
    this.boardMat = boardMat;
    const boardX = L.board, boardZ = (L.boardZ ?? wallZ + 0.12) - 0.06;
    piece(room, '#c9c4b8', 4.6, 2.0, 0.08, boardX, 1.0, boardZ + 0.06);
    const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.84), boardMat); boardFace.position.set(boardX, 2.0, boardZ + 0.11); boardFace.userData.keep = true; room.add(boardFace);
    piece(room, '#8f8a7e', 4.6, 0.05, 0.22, boardX, 1.0, boardZ + 0.16, { cast: false });
    piece(detail, '#d9443a', 0.12, 0.03, 0.03, boardX - 1.1, 1.05, boardZ + 0.2, { cast: false }); piece(detail, '#2a60c0', 0.12, 0.03, 0.03, boardX - 0.9, 1.05, boardZ + 0.2, { cast: false });

    // Wall clock, showing the real time.
    this.clockTex = canvasTex(128, 128, (x) => this.drawClock(x));
    const widest = backParts.reduce((w, p) => (p[1] - p[0] > w[1] - w[0] ? p : w), backParts[0]);
    const clockX = (widest[0] + widest[1]) / 2;
    piece(room, '#2b2d35', 0.92, 0.06, 0.92, clockX, 3.37, wallZ + 0.03, { geo: cyl, cast: false }).rotation.x = Math.PI / 2;
    const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ map: this.clockTex })); clockFace.position.set(clockX, 3.4, wallZ + 0.07); clockFace.userData.keep = true; room.add(clockFace);

    // Neon company sign, over a low console with a plant: the reception wall.
    if (d.neon) {
      const sign = canvasTex(1024, 180, (x, w, h) => { x.clearRect(0, 0, w, h); });
      this.signTex = sign;
      const signZ = L.console ?? L.signZ ?? -0.4;
      piece(room, '#23212f', 0.06, 1.3, 7.2, wallX + 0.03, 2.7, signZ, { cast: false });
      piece(room, accent, 0.07, 0.04, 6.4, wallX + 0.04, 2.78, signZ, { cast: false, mat: new THREE.MeshBasicMaterial({ color: accent }) }).userData.keep = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 1.19), new THREE.MeshBasicMaterial({ map: sign, transparent: true, depthWrite: false }));
      m.position.set(wallX + 0.08, 3.35, signZ); m.rotation.y = Math.PI / 2; m.userData.keep = true;
      room.add(m); this.signMesh = m;
    }
    if (L.console !== null) {
      const cz = L.console;
      piece(room, '#4a3526', 0.5, 0.8, 2.4, wallX + 0.3, 0, cz); piece(room, '#5e4434', 0.56, 0.05, 2.5, wallX + 0.3, 0.8, cz, { cast: false });
      piece(detail, '#f3ead8', 0.3, 0.26, 0.3, wallX + 0.3, 0.85, cz + 0.8, { geo: cyl, cast: false }); piece(detail, '#2a2b33', 0.26, 0.26, 0.2, wallX + 0.3, 0.85, cz - 0.7, { cast: false });
    }
    // Art on the side wall, in the style the boss picked. The company's own logo goes in the first frame when it has one.
    if (d.art) this.hangArt(room, wallX);
    // Bookshelf.
    const shelf = new THREE.Group(); shelf.position.set(L.shelf[0], 0, L.shelf[1]); legacy.add(shelf);
    piece(shelf, '#6f5136', 0.6, 3.1, 2.6, 0, 0, 0);
    piece(shelf, '#553d28', 0.66, 0.08, 2.7, 0.02, 3.02, 0, { cast: false });
    const r = seeded(17);
    for (let row = 0; row < 4; row++) {
      piece(shelf, '#553d28', 0.66, 0.06, 2.6, 0.02, 0.2 + row * 0.72, 0, { cast: false });
      if (row === 2) { piece(shelf, '#f3ead8', 0.3, 0.3, 0.3, 0.15, 0.26 + row * 0.72, -0.9, { geo: sph, cast: false }); piece(shelf, '#4f7a54', 0.24, 0.3, 0.24, 0.15, 0.5 + row * 0.72, -0.9, { geo: ico, cast: false }); }
      for (let bz = row === 2 ? -0.6 : -1.15; bz < 1.15;) {
        const w = 0.1 + r() * 0.12, hh = 0.36 + r() * 0.26;
        if (r() > 0.85) { piece(shelf, ['#e6dcc6', '#7d3f3f', primary][Math.floor(r() * 3)], 0.4, 0.08, 0.5, 0.18, 0.26 + row * 0.72, bz + 0.2, { cast: false }); piece(shelf, '#3c5a78', 0.36, 0.08, 0.46, 0.18, 0.34 + row * 0.72, bz + 0.22, { cast: false }); bz += 0.52; continue; }
        piece(shelf, [primary, accent, '#3c5a78', '#e6dcc6', '#7d3f3f', '#40634f', '#2b2d35'][Math.floor(r() * 7)], 0.4, hh, w, 0.18, 0.26 + row * 0.72, bz, { cast: false });
        bz += w + 0.02;
      }
    }
    // The kitchen corner: counter with sink and coffee machine, a fridge and a tall cupboard on the open side.
    if (d.coffee) {
      const c = new THREE.Group(); c.position.set(L.coffee[0], 0, L.coffee[1]); legacy.add(c);
      const cd = new THREE.Group(); cd.position.set(L.coffee[0], 0, L.coffee[1]); legacy.add(cd);
      piece(c, '#5e4436', 1.0, 1.0, 3.6, 0, 0, 0); piece(c, '#4a3528', 0.03, 0.9, 3.4, -0.5, 0.05, 0, { cast: false });
      for (let i = 0; i < 4; i++) piece(c, '#d8c6a8', 0.02, 0.03, 0.3, -0.51, 0.55, -1.3 + i * 0.86, { cast: false });
      piece(c, '#e8e0d0', 1.1, 0.08, 3.7, 0, 1.0, 0);
      piece(c, '#9aa3ad', 0.7, 0.03, 0.8, 0, 1.08, 0.9, { cast: false }); piece(c, '#7d858e', 0.6, 0.02, 0.7, 0, 1.085, 0.9, { cast: false });
      const tap = piece(c, '#aeb6be', 0.05, 0.42, 0.05, 0.3, 1.08, 0.9, { geo: cyl, cast: false }); tap.rotation.z = 0;
      piece(c, '#aeb6be', 0.05, 0.3, 0.05, 0.16, 1.33, 0.9, { geo: cyl, cast: false }).rotation.z = Math.PI / 2;
      piece(c, '#2f3036', 0.55, 0.62, 0.5, 0, 1.08, -0.9); piece(c, '#c8392b', 0.5, 0.1, 0.46, 0, 1.7, -0.9); piece(c, '#1a1b20', 0.4, 0.08, 0.3, 0, 1.16, -0.9, { cast: false });
      piece(c, '#dfe3e8', 0.22, 0.26, 0.22, 0, 1.08, -0.25, { geo: cyl }); piece(c, '#2a2b33', 0.08, 0.08, 0.08, 0, 1.34, -0.25, { geo: sph, cast: false });
      for (let i = 0; i < 4; i++) piece(cd, ['#f3ead8', primary, accent, '#f3ead8'][i], 0.15, 0.15, 0.15, -0.22 + (i % 2) * 0.3, 1.08, 0.1 + Math.floor(i / 2) * 0.3, { geo: cyl, cast: false });
      piece(cd, '#f0e4c8', 0.3, 0.1, 0.3, 0.2, 1.08, -0.5, { cast: false }); piece(cd, '#e8b24a', 0.12, 0.12, 0.12, 0.2, 1.18, -0.5, { geo: sph, cast: false });
      const f = new THREE.Group(); f.position.set(L.fridge[0], 0, L.fridge[1]); legacy.add(f);
      piece(f, '#d9dde2', 0.95, 2.0, 0.9, 0, 0, 0); piece(f, '#c3c8ce', 0.02, 1.9, 0.86, -0.48, 0.05, 0, { cast: false }); piece(f, '#c3c8ce', 0.03, 0.02, 0.86, -0.49, 0.72, 0, { cast: false });
      piece(f, '#8e949c', 0.04, 0.5, 0.04, -0.5, 1.0, 0.33, { cast: false }); piece(f, '#8e949c', 0.04, 0.3, 0.04, -0.5, 0.3, 0.33, { cast: false });
      piece(f, '#f4c95d', 0.16, 0.16, 0.01, -0.5, 1.5, -0.2, { cast: false }); piece(f, '#7ad1f0', 0.12, 0.14, 0.01, -0.5, 1.2, 0.1, { cast: false });
      piece(f, '#5e4436', 0.95, 2.0, 0.9, 0, 0, 1.0); piece(f, '#4a3528', 0.02, 1.9, 0.86, -0.48, 0.05, 1.0, { cast: false }); piece(f, '#d8c6a8', 0.03, 0.3, 0.03, -0.49, 0.9, 1.0, { cast: false });
    }
    if (d.arcade) {
      const a = new THREE.Group(); a.position.set(L.arcade[0], 0, L.arcade[1]); room.add(a);
      piece(a, accent, 0.9, 2.2, 1.0, 0, 0, 0); piece(a, shadeHex(accent, 0.8), 0.92, 0.3, 1.02, 0, 1.9, 0);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.62), new THREE.MeshBasicMaterial({ color: '#58f3c8' })); scr.position.set(0.46, 1.62, 0); scr.rotation.y = Math.PI / 2; scr.userData.keep = true; a.add(scr);
      piece(a, '#222228', 0.42, 0.06, 0.84, 0.52, 1.05, 0); piece(a, '#d9443a', 0.08, 0.1, 0.08, 0.6, 1.11, 0.2, { geo: cyl, cast: false }); piece(a, '#2a60c0', 0.08, 0.1, 0.08, 0.6, 1.11, -0.2, { geo: cyl, cast: false });
      this.arcadeScreen = scr;
    }
    if (d.rug) {
      const rug = (x, z, w, dd, c, t) => piece(room, c, w, t, dd, x, 0, z, { cast: false });
      for (const [x, z, w, dd, kind] of L.rugs) {
        if (kind === 'worn') { rug(x, z, w, dd, '#7c6450', 0.03); rug(x, z, w - 0.5, dd - 0.5, '#94795f', 0.04); continue; }
        rug(x, z, w, dd, kind === 'plain' ? mix(primary, '#ffffff', 0.25) : primary, 0.03);
        rug(x, z, w - 0.4, dd - 0.4, kind === 'plain' ? mix(accent, '#ffffff', 0.45) : accent, 0.045);
        rug(x, z, w - 0.7, dd - 0.7, kind === 'plain' ? mix(primary, '#ffffff', 0.72) : kind === 'big' ? mix(primary, '#ffffff', 0.42) : primary, 0.06);
      }
    }
    // A lounge in the front corner, until a full staff needs that desk.
    if (this.lounge) {
      const [SOFAX, SOFAZ] = L.sofa;
      const l = new THREE.Group(); l.position.set(SOFAX, 0, SOFAZ); legacy.add(l);
      const ld = new THREE.Group(); ld.position.set(SOFAX, 0, SOFAZ); legacy.add(ld);
      if (d.rug && !L.rugs.some((r) => r[4] === 'worn')) { piece(room, mix(accent, '#ffffff', 0.25), 5.6, 0.03, 3.4, SOFAX, 0, SOFAZ - 0.1, { cast: false }); piece(room, mix(primary, '#ffffff', 0.55), 5.0, 0.04, 2.8, SOFAX, 0, SOFAZ - 0.1, { cast: false }); }
      const sofa = primary, sofaD = shadeHex(primary, 0.8);
      piece(l, sofaD, 3.8, 0.3, 1.2, 0, 0.1, 0.9); piece(l, sofa, 1.75, 0.3, 1.05, -0.9, 0.38, 0.85, { geo: sph }); piece(l, sofa, 1.75, 0.3, 1.05, 0.9, 0.38, 0.85, { geo: sph });
      piece(l, sofa, 3.8, 1.05, 0.36, 0, 0.1, 1.34); piece(l, sofaD, 3.6, 0.12, 0.3, 0, 1.12, 1.34, { geo: sph });
      piece(l, sofa, 0.36, 0.82, 1.2, -1.95, 0.1, 0.9, { geo: sph }); piece(l, sofa, 0.36, 0.82, 1.2, 1.95, 0.1, 0.9, { geo: sph });
      piece(l, '#3d3b44', 0.08, 0.1, 0.08, -1.7, 0, 0.5); piece(l, '#3d3b44', 0.08, 0.1, 0.08, 1.7, 0, 0.5); piece(l, '#3d3b44', 0.08, 0.1, 0.08, -1.7, 0, 1.3); piece(l, '#3d3b44', 0.08, 0.1, 0.08, 1.7, 0, 1.3);
      piece(ld, accent, 0.6, 0.5, 0.26, -1.1, 0.66, 1.08, { geo: sph }); piece(ld, '#f3ead8', 0.6, 0.5, 0.26, 1.1, 0.66, 1.08, { geo: sph });
      piece(l, '#6e4a33', 1.6, 0.08, 0.8, 0, 0.4, -0.6, { geo: cyl }); piece(l, '#3d3b44', 0.08, 0.4, 0.08, 0, 0, -0.6, { geo: cyl }); piece(l, '#3d3b44', 0.5, 0.03, 0.5, 0, 0, -0.6, { geo: cyl, cast: false });
      piece(ld, '#f3ead8', 0.5, 0.05, 0.36, -0.3, 0.48, -0.6, { cast: false, ry: 0.3 }); piece(ld, primary, 0.3, 0.012, 0.36, -0.3, 0.5, -0.6, { cast: false, ry: 0.3 }); piece(ld, accent, 0.15, 0.15, 0.15, 0.42, 0.48, -0.6, { geo: cyl, cast: false });
      piece(ld, '#f3ead8', 0.26, 0.3, 0.26, -0.5, 0.48, -0.5, { geo: cyl, cast: false }); piece(ld, '#5e9160', 0.3, 0.3, 0.3, -0.5, 0.74, -0.5, { geo: ico, cast: false });
      // Floor lamp.
      piece(l, '#2c2c33', 0.4, 0.03, 0.4, 2.4, 0, -0.6, { geo: cyl, cast: false }); piece(l, '#2c2c33', 0.04, 1.9, 0.04, 2.4, 0, -0.6, { geo: cyl });
      piece(l, mix(accent, '#ffffff', 0.4), 0.7, 0.5, 0.7, 2.4, 1.9, -0.6, { geo: cyl });
    }
    // Printer, in the front-left corner.
    const pr = new THREE.Group(); pr.position.set(L.printer[0], 0, L.printer[1]); room.add(pr);
    piece(pr, '#5e5a64', 1.0, 0.75, 1.0, 0, 0, 0); piece(pr, '#e8e4da', 0.92, 0.3, 0.92, 0, 0.75, 0); piece(pr, '#cfcac0', 0.6, 0.06, 0.5, 0.3, 1.05, 0, { cast: false });
    piece(pr, '#fbf7ea', 0.5, 0.04, 0.6, -0.1, 1.05, 0, { cast: false }); piece(pr, '#f3f0e6', 0.4, 0.2, 0.3, 0.2, 0.75, 0.5, { cast: false });
    piece(pr, '#4ad17a', 0.05, 0.03, 0.05, -0.35, 1.05, 0.3, { cast: false, mat: new THREE.MeshBasicMaterial({ color: '#4ad17a' }) }).userData.keep = true;
    // Plants, in a stable order so more means more. Two of them sway a little.
    const spots = L.plants;
    for (let i = 0; i < d.plants; i++) {
      const [x, z] = spots[i];
      const p = makePlant(legacy, x, z, i % 3, i < 2 ? 1.3 : 1);
      if (i < 2) { mergeColored(p.canopy, ROOM_MAT); p.canopy.children.forEach((m) => { m.userData.keep = true; }); this.sway.push(p.canopy); }
      this.plantSpots.push(spots[i]);
    }

    // Desks.
    const mgr = makeDesk(room, detail, legacy, L.manager[0], L.manager[1], primary, primary, accent, { big: true, seed: 2, ry: L.manager[2] });
    this.managerSeat = { at: mgr.at, face: mgr.face, screenMat: mgr.screenMat, glow: mgr.glow, bar: mgr.bar, big: true };
    const bossDesk = makeDesk(room, detail, legacy, L.boss[0], L.boss[1], primary, primary, accent, { big: true, seed: 3, ry: L.boss[2] });
    this.bossSeat = { at: bossDesk.at, face: bossDesk.face, screenMat: bossDesk.screenMat, glow: bossDesk.glow, bar: bossDesk.bar, big: true };
    piece(bossDesk.detail, '#e9b949', 0.8, 0.14, 0.2, 0.85, 1.02, 0.2);
    for (const [x, z] of L.desks) this.deskSlots.push({ x, z, desk: null });
    // The boss's and the manager's rooms are theirs too, done out like everyone else's.
    for (const id of ['manager', 'boss']) { const r = L.rooms.find((x) => x.id === id); if (r) this.addOffice(r, { id, role: id, name: null }, { own: false }); }
    this.buildPlanExtras(room, detail, wallX, wallZ);
    // Pet.
    if (d.pet && d.pet !== 'none') {
      this.pet = buildPet(d.pet); this.petSpeed = PET_SPEED[d.pet] ?? 1.5;
      this.pet.group.position.set(L.pet[0], 0, L.pet[1]);
      R.add(this.pet.group); this.petPath = []; this.petWait = 3;
    }
    mergeColored(room, ROOM_MAT); mergeColored(detail, ROOM_MAT); mergeColored(legacy, ROOM_MAT);
    this.loading = { settled: false };
    this.loadModels().catch((e) => { console.warn('furniture models unavailable, keeping the stand-ins', e); }).finally(() => { this.loading.settled = true; });
  }
  /**
   * The walls that make the rooms. Every pane on a floor goes into one mesh, so ten glass rooms cost one draw call, and the frames bake
   * in with the rest of the room. Door frames get a post each side and a beam over the gap; a screen is waist high and solid.
   */
  buildWalls(room, env) {
    const { primary, accent } = this.colors; const L = this.plan;
    const GH = 3.1, frame = L.frame || '#454852';
    const dado = L.frame ? '#8a6a45' : mix(this.decor.wall, '#f4efe6', 0.55), dadoCap = L.frame ? '#5e4430' : mix(frame, '#ffffff', 0.15);
    const pos = [], idx = [];
    const pane = (x0, z0, x1, z1, y0, y1) => { const b = pos.length / 3; pos.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
    const bar = (x0, z0, x1, z1, y, h, t = 0.08, color = frame) => { const along = x0 !== x1; piece(room, color, along ? x1 - x0 : t, h, along ? t : z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2, { cast: false }); };
    for (const w of wallLines(L)) {
      if (w.low) {
        const along = w.x0 !== w.x1;
        piece(room, primary, along ? w.x1 - w.x0 : 0.1, 1.3, along ? 0.1 : w.z1 - w.z0, (w.x0 + w.x1) / 2, 0, (w.z0 + w.z1) / 2);
        bar(w.x0, w.z0, w.x1, w.z1, 1.3, 0.05, 0.13, accent);
        continue;
      }
      // A solid dado to waist height, so each room reads as a room, and glass above it so the camera still sees in.
      const along = w.x0 !== w.x1;
      piece(room, dado, along ? w.x1 - w.x0 : 0.12, 1.0, along ? 0.12 : w.z1 - w.z0, (w.x0 + w.x1) / 2, 0, (w.z0 + w.z1) / 2, { shade: [0, 1, 0.82, 1] });
      bar(w.x0, w.z0, w.x1, w.z1, 1.0, 0.06, 0.16, dadoCap);
      pane(w.x0, w.z0, w.x1, w.z1, 1.06, GH - 0.1);
      bar(w.x0, w.z0, w.x1, w.z1, GH - 0.1, 0.1);
      for (const [x, z] of [[w.x0, w.z0], [w.x1, w.z1]]) piece(room, frame, 0.09, GH, 0.09, x, 0, z, { cast: false });
    }
    // A beam over every door, so a gap in the glass reads as a way through.
    for (const d of doorways(L)) {
      const half = d.width / 2;
      if (d.along) bar(d.x - half, d.z, d.x + half, d.z, GH - 0.1, 0.1); else bar(d.x, d.z - half, d.x, d.z + half, GH - 0.1, 0.1);
    }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    this.glassMat = new THREE.MeshStandardMaterial({ color: mix(primary, '#dfeaf2', 0.72), roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.18, depthWrite: false, envMap: env, side: THREE.DoubleSide });
    const glass = new THREE.Mesh(geo, this.glassMat); glass.userData.keep = true; glass.renderOrder = 2; room.add(glass);
    this.glassGeo = geo;
  }
  /** The meeting table, or some crates. The glass round it is one of the plan's walls, see buildWalls. */
  buildMeeting(room, detail, legacy) {
    const { primary, accent } = this.colors; const m = this.plan.meet;
    const [tx, tz] = m.table;
    if (m.kind === 'crates') {
      // A door on two crates: the table of every company that started in a garage.
      for (const dx of [-0.75, 0.75]) { piece(room, '#a57f55', 0.85, 0.74, 1.05, tx + dx, 0, tz); for (const y of [0.2, 0.46]) piece(room, '#8a6a45', 0.87, 0.03, 1.07, tx + dx, y, tz, { cast: false }); }
      piece(room, '#6a4b30', 2.5, 0.07, 1.4, tx, 0.74, tz);
      piece(detail, '#2a2b33', 0.42, 0.03, 0.3, tx + 0.3, 0.81, tz, { cast: false }); piece(detail, '#f6f3ea', 0.3, 0.012, 0.4, tx - 0.6, 0.81, tz + 0.1, { cast: false, ry: 0.2 }); piece(detail, accent, 0.12, 0.13, 0.12, tx + 0.9, 0.81, tz + 0.3, { geo: cyl, cast: false });
      this.nav.footprints.push([tx, tz, 2.6, 1.5]);
      return;
    }
    const sx = m.size[0] / 1.5, sz = (m.size[2] ?? m.size[1]) / 1.5;
    piece(legacy, '#efe6d6', 3.2 * sx, 0.08, 1.1 * sz, tx, 0.86, tz); piece(legacy, '#cdbfa6', 3.2 * sx, 0.04, 1.1 * sz, tx, 0.82, tz, { cast: false });
    piece(legacy, '#3d3b44', 0.14, 0.82, 0.8 * sz, tx - 1.3 * sx, 0, tz); piece(legacy, '#3d3b44', 0.14, 0.82, 0.8 * sz, tx + 1.3 * sx, 0, tz);
    piece(detail, '#2a2b33', 0.42, 0.03, 0.3, tx + 0.2, 0.94, tz, { cast: false }); piece(detail, '#f6f3ea', 0.3, 0.012, 0.4, tx - 0.9, 0.94, tz + 0.1, { cast: false, ry: 0.2 });
    piece(detail, '#2c2c33', 0.1, 0.06, 0.1, tx - 0.2, 0.94, tz - 0.3, { geo: cyl, cast: false }); piece(detail, accent, 0.12, 0.13, 0.12, tx + 1.1, 0.94, tz + 0.25, { geo: cyl, cast: false });
    // Chairs at the ends and pushed in at the sides: they sit inside the table's footprint, so the aisles stay open.
    for (const [cx, cz, ry] of m.chairs) { makeChair(legacy, cx, cz, primary, { ry }); this.nav.footprints.push([cx, cz, 0.6, 0.6]); }
  }
  /** A wall finish over the painted walls: one textured draw call covering every solid stretch, carrying the same baked light gradient. */
  wallSkinMesh(style, wall, backParts) {
    const wallZ = -ROOM_D / 2 + 0.006, wallX = -ROOM_W / 2 + 0.006, R = 3.2;
    const pos = [], nor = [], uv = [], col = [], idx = [];
    const shade = (y) => 0.84 + 0.18 * (y / WALL_H);
    const quad = (pts, n, along) => {
      const b = pos.length / 3;
      for (const p of pts) { pos.push(p[0], p[1], p[2]); nor.push(...n); uv.push(along(p) / R, p[1] / R); const f = shade(p[1]); col.push(f, f, f); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const back = (a, b, y0, y1) => quad([[a, y0, wallZ], [b, y0, wallZ], [b, y1, wallZ], [a, y1, wallZ]], [0, 0, 1], (p) => p[0]);
    for (const [a, b] of backParts) back(a, b, 0, WALL_H);
    for (const [a, b] of this.plan.windows) { back(a, b, 0, 1.0); back(a, b, WALL_H - 0.36, WALL_H); }
    quad([[wallX, 0, ROOM_D / 2], [wallX, 0, -ROOM_D / 2], [wallX, WALL_H, -ROOM_D / 2], [wallX, WALL_H, ROOM_D / 2]].reverse().reverse(), [1, 0, 0], (p) => p[2]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: wallSkin(style, wall), vertexColors: true, roughness: style === 'panels' ? 0.6 : 0.92, metalness: 0, side: THREE.DoubleSide }));
    mesh.receiveShadow = true; mesh.userData.keep = true;
    return mesh;
  }
  /** The frames on the left wall (and the back wall, where a plan has room), and the logo if the company has one in a public project. */
  hangArt(room, wallX) {
    const { primary, accent } = this.colors; const d = this.decor; const L = this.plan;
    const style = d.artStyle || 'shapes';
    const texFor = (i) => artTexture(style, i, primary, accent, this.companyName);
    const hang = (z, y, w, hh, i) => {
      piece(room, '#2c2a31', 0.08, hh + 0.16, w + 0.16, wallX + 0.03, y - hh / 2 - 0.08, z);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshLambertMaterial({ map: texFor(i) }));
      m.position.set(wallX + 0.08, y, z); m.rotation.y = Math.PI / 2; m.userData.keep = true; room.add(m);
      return m;
    };
    const frames = L.art.map(([z, y, w, hh], i) => hang(z, y, w, hh, i));
    if (style === 'logo' && this.logoUrl && frames[0]) {
      const img = new Image();
      img.onload = () => {
        if (this.dead) return;
        // The picture sits on a pale card at its own proportions, so a wide logo is never squashed to fit the frame.
        const tex = canvasTex(256, 320, (x, w, h) => {
          x.fillStyle = '#f7f1e4'; x.fillRect(0, 0, w, h);
          const k = Math.min((w - 36) / img.width, (h - 36) / img.height), iw = img.width * k, ih = img.height * k;
          x.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
        });
        // An odd SVG can taint a canvas in some browsers, and uploading that would throw on every frame. The monogram stays instead.
        try { tex.image.getContext('2d').getImageData(0, 0, 1, 1); } catch { tex.dispose(); return; }
        frames[0].material.map?.dispose(); frames[0].material.map = tex; frames[0].material.needsUpdate = true;
        this.logoLoaded = true;  // read by the browser test
      };
      img.src = this.logoUrl;
    }
  }
  /** What makes each plan itself: easels, a roller door, a pegboard, string lights, carpet islands and partitions. All baked, so they add no draw calls. */
  buildPlanExtras(room, detail, wallX, wallZ) {
    const { primary, accent } = this.colors; const L = this.plan; const d = this.decor;
    for (const [i, [x, z, ry]] of (L.easels || []).entries()) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; room.add(g);
      for (const lx of [-0.34, 0.34]) { const leg = piece(g, '#8a6a45', 0.06, 1.9, 0.06, lx, 0, 0.05); leg.rotation.z = lx > 0 ? 0.07 : -0.07; }
      const back = piece(g, '#8a6a45', 0.06, 1.8, 0.06, 0, 0, -0.34); back.rotation.x = 0.2;
      piece(g, '#6a4b30', 0.95, 0.06, 0.14, 0, 0.74, 0.08);
      piece(g, '#f4efe4', 0.92, 1.12, 0.03, 0, 0.78, 0.1);
      if (d.art) { const c = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 1.04), new THREE.MeshLambertMaterial({ map: artTexture(d.artStyle === 'logo' ? 'shapes' : d.artStyle || 'shapes', i + 1, primary, accent, this.companyName) })); c.position.set(0, 1.34, 0.125); c.userData.keep = true; g.add(c); }
    }
    if (L.roller) {
      const [a, b] = L.roller; const w = b - a, cx = (a + b) / 2, H = 3.5, z = wallZ + 0.05;
      piece(room, '#868c93', w, H, 0.05, cx, 0, z, { cast: false });
      for (let y = 0.2; y < H; y += 0.26) piece(room, '#6e747b', w, 0.05, 0.03, cx, y, z + 0.03, { cast: false });
      piece(room, '#3a3d44', w + 0.34, 0.34, 0.2, cx, H, z + 0.04); piece(room, '#3a3d44', 0.17, H, 0.14, a - 0.08, 0, z); piece(room, '#3a3d44', 0.17, H, 0.14, b + 0.08, 0, z);
      for (let i = 0; i * 0.6 < w; i++) piece(room, i % 2 ? '#20222a' : '#f2c230', 0.6, 0.12, 0.02, a + 0.3 + i * 0.6, 0.04, z + 0.05, { cast: false });
      piece(room, '#20222a', 0.5, 0.06, 0.05, cx, 0.5, z + 0.05, { cast: false });
    }
    if (L.pegboard) {
      const [pz, py] = L.pegboard; const x = wallX + 0.04;
      piece(room, '#b78a58', 0.04, 1.5, 3.6, x, py, pz, { cast: false });
      for (let i = 0; i < 6; i++) {
        const tz = pz - 1.45 + i * 0.58, c = [primary, '#3a3d44', accent, '#8e959c', primary, '#3a3d44'][i];
        piece(detail, c, 0.05, 0.62 - (i % 3) * 0.14, 0.09, x + 0.04, py + 0.56, tz, { cast: false });
        if (i % 2) piece(detail, c, 0.05, 0.1, 0.3, x + 0.04, py + 1.1 - (i % 3) * 0.14, tz, { cast: false });
      }
    }
    if (L.bulbs) {
      // String lights along the top of both walls, sagging between the hooks.
      const bulb = (x, y, z) => piece(detail, '#ffe9a8', 0.13, 0.15, 0.13, x, y, z, { geo: ico, cast: false, recv: false });
      for (let i = 0; i * 0.9 <= ROOM_W - 1.2; i++) { const t = (i % 4) / 4; bulb(-ROOM_W / 2 + 0.6 + i * 0.9, 4.18 - Math.sin(t * Math.PI) * 0.22, wallZ + 0.22); }
      for (let i = 0; i * 0.9 <= ROOM_D - 1.2; i++) { const t = (i % 4) / 4; bulb(wallX + 0.22, 4.18 - Math.sin(t * Math.PI) * 0.22, -ROOM_D / 2 + 0.6 + i * 0.9); }
    }
    for (const [cx, cz] of L.pods || []) {
      const carpet = mix(primary, '#d9dde2', 0.72), side = mix(primary, '#d9dde2', 0.45);
      piece(room, side, 6.4, 0.03, 6.2, cx, 0, cz, { cast: false }); piece(room, carpet, 6.1, 0.045, 5.9, cx, 0, cz, { cast: false });
      piece(room, primary, 5.2, 1.46, 0.09, cx, 0, cz, { cast: true }); piece(room, accent, 5.24, 0.05, 0.11, cx, 1.46, cz, { cast: false });
      for (const s of [-1, 1]) piece(room, primary, 0.09, 1.2, 1.0, cx + s * 2.65, 0, cz, { cast: true });
    }
    if (L.bar) {
      const [x, z] = L.bar;
      piece(room, '#4a3526', 0.8, 1.0, 2.5, x, 0, z); piece(room, accent, 0.82, 0.04, 2.52, x, 0.56, z, { cast: false }); piece(room, '#d9cfbe', 1.0, 0.07, 2.7, x, 1.0, z);
      for (let i = 0; i < 5; i++) piece(detail, [primary, accent, '#3c5a78', '#7d3f3f', '#40634f'][i], 0.1, 0.34, 0.1, x + 0.12, 1.07, z - 0.9 + i * 0.44, { geo: cyl, cast: false });
    }
  }
  /**
   * The kit's furniture, placed where the stand-ins are and baked into a few draw calls, then swapped in. Positions and
   * footprints match the stand-ins exactly, so the walking grid and the baked floor shadows are already right.
   */
  async loadModels() {
    const { primary, accent } = this.colors; const d = this.decor; const L = this.plan;
    const names = ['desk', 'chairDesk', 'computerScreen', 'computerKeyboard', 'computerMouse', 'chairModernCushion', 'tableCross', 'bookcaseOpen', 'books', 'pottedPlant', 'plantSmall1', 'plantSmall2', 'plantSmall3', 'trashcan', 'cardboardBoxOpen', 'coatRackStanding', 'laptop'];
    if (d.coffee) names.push('kitchenCabinet', 'kitchenSink', 'kitchenCoffeeMachine', 'kitchenMicrowave', 'kitchenFridgeLarge', 'stoolBar', 'kitchenBar');
    if (this.lounge) names.push('loungeSofa', 'loungeChair', 'tableCoffee', 'lampRoundFloor', 'pillow', 'pillowBlue', 'speaker');
    for (const p of L.props || []) names.push(p.m);
    const wanted = [...new Set(names)];
    const got = await Promise.all(wanted.map((n) => furniture(n)));
    if (this.dead) return;
    const T = Object.fromEntries(wanted.map((n, i) => [n, got[i]]));
    const models = new THREE.Group(); models.userData.fromKit = true;
    let target = models;
    const put = (name, o) => { const m = place(T[name], { scale: FS, ...o }); target.add(m); return m; };
    const chairTint = (c) => ({ carpet: c, carpetBlue: c });
    const desk = (x, z, chairColor, big, ry = 0) => {
      // Built facing the back wall inside its own group, and the group takes the turn.
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; target.add(g);
      const outer = target; target = g;
      const front = Math.PI;  // the kit's desk has its drawer at the back; turned, it faces the sitter
      put('desk', { z: -0.2, ry: front, scale: big ? FS * 1.25 : FS * 1.1 });
      put('computerScreen', { y: big ? 1.2 : 1.06, z: -0.58, ry: 0 });
      // Keys near the front edge, where a seated person's hands land (see TYPE_A in character.js).
      put('computerKeyboard', { y: big ? 1.2 : 1.06, z: big ? 0.26 : 0.19 });
      put('computerMouse', { x: 0.56, y: big ? 1.2 : 1.06, z: big ? 0.28 : 0.21 });
      put('chairDesk', { z: 0.84, ry: Math.PI, tint: chairTint(chairColor), scale: big ? FS * 1.15 : FS });
      if (big) put('laptop', { x: 1.05, y: big ? 1.2 : 1.06, z: -0.15, ry: 0.3 });
      target = outer;
    };
    desk(L.manager[0], L.manager[1], primary, true, L.manager[2]);
    desk(L.boss[0], L.boss[1], primary, true, L.boss[2]);
    const m = L.meet; const [tx, tz] = m.table;
    if (!m.kind) {
      const t = put('tableCross', { x: tx, z: tz, scale: FS * m.size[1] });
      t.scale.x = FS * m.size[0]; t.scale.z = FS * (m.size[2] ?? m.size[1]);
    }
    for (const [cx, cz, ry] of m.chairs) put('chairModernCushion', { x: cx, z: cz, ry, tint: chairTint(primary) });
    // Bookcases against the left wall, with stacks of books on the shelves.
    for (const [z, flip] of [[L.shelf[1] - 0.55, 0], [L.shelf[1] + 0.55, 1]]) {
      put('bookcaseOpen', { x: L.shelf[0] + 0.05, z, ry: Math.PI / 2 });
      for (let s = 0; s < 4; s++) for (const dz of [-0.25, 0.1]) if ((s + flip + (dz > 0 ? 1 : 0)) % 3) put('books', { x: L.shelf[0] + 0.05, y: 0.08 + s * 0.52, z: z + dz, ry: Math.PI / 2 + (s % 2) * 0.25, scale: FS * 0.95, tint: { carpetDarker: s % 2 ? primary : accent } });
    }
    // The pieces that make this plan what it is.
    const propTint = { primary: chairTint(primary), accent: chairTint(accent), cream: { carpetBlue: '#f3ead8' }, lamp: { lamp: mix(accent, '#ffffff', 0.4) } };
    for (const p of L.props || []) put(p.m, { x: p.x, y: p.y ?? 0, z: p.z, ry: p.ry ?? 0, scale: FS * (p.s ?? 1), tint: p.tint ? propTint[p.tint] : null });
    // Plants: the big potted one at the first two spots, the small ones elsewhere.
    for (let i = 0; i < d.plants; i++) {
      const [x, z] = this.plantSpots[i];
      if (i < 2) put('pottedPlant', { x, z, ry: i * 1.3, scale: FS * 1.7 });
      else put(`plantSmall${(i % 3) + 1}`, { x, z, ry: i, scale: FS * 2.6 });
    }
    if (d.coffee) {
      const [cx, cz] = L.coffee;
      // The counter runs along the wall side, with the sink in the middle, the coffee machine and the microwave on top.
      put('kitchenCabinet', { x: cx, z: cz - 1.25, ry: -Math.PI / 2 }); put('kitchenSink', { x: cx, z: cz - 0.15, ry: -Math.PI / 2 }); put('kitchenCabinet', { x: cx, z: cz + 0.95, ry: -Math.PI / 2 });
      put('kitchenBar', { x: cx + 0.02, z: cz + 1.8, ry: -Math.PI / 2 });
      put('kitchenCoffeeMachine', { x: cx + 0.05, y: 1.12, z: cz - 1.3, ry: -Math.PI / 2 }); put('kitchenMicrowave', { x: cx + 0.05, y: 1.12, z: cz + 1.0, ry: -Math.PI / 2 });
      put('kitchenFridgeLarge', { x: L.fridge[0], z: L.fridge[1] + 0.2, ry: -Math.PI / 2 });
      for (const dz of [-0.9, 0.3]) put('stoolBar', { x: cx - 1.05, z: cz + dz, ry: Math.PI / 2, tint: chairTint(accent) });
    }
    if (this.lounge) {
      const [sx, sz] = L.sofa;
      put('loungeSofa', { x: sx - 0.3, z: sz + 1.05, ry: Math.PI, tint: chairTint(primary) });
      put('loungeChair', { x: sx + 2.0, z: sz - 0.5, ry: -Math.PI / 2 - 0.3, tint: chairTint(primary) });
      put('pillow', { x: sx - 1.0, y: 0.52, z: sz + 1.1, ry: Math.PI + 0.3, tint: { carpet: accent }, scale: FS * 0.9 });
      put('pillowBlue', { x: sx + 0.5, y: 0.52, z: sz + 1.1, ry: Math.PI - 0.2, tint: { carpetBlue: '#f3ead8' }, scale: FS * 0.9 });
      put('tableCoffee', { x: sx - 0.2, z: sz - 0.6, ry: 0 });
      put('lampRoundFloor', { x: sx + 2.4, z: sz + 1.0, tint: { lamp: mix(accent, '#ffffff', 0.4) } });
      put('speaker', { x: sx - 2.5, z: sz + 1.1, scale: FS * 1.1 });
    }
    put('trashcan', { x: L.printer[0] + 1.1, z: L.printer[1] + 0.3 });
    put('cardboardBoxOpen', { x: L.printer[0] + 0.1, z: L.printer[1] - 1.1, ry: 0.4 });
    put('coatRackStanding', { x: L.coat[0], z: L.coat[1] });
    this.models = models; this.extraModels = [];
    this.kit = T;
    this.deskInto = (into, x, z, chairColor, ry) => { const keep = target; target = into; desk(x, z, chairColor, false, ry); target = keep; };
    mergeColored(models, ROOM_MAT);
    this.root.add(models);
    this.root.remove(this.legacy);
    for (const a of this.actors.values()) if (a.seated) a.sitDown();
    this.modelsOn = true;
    if (!this.detailOn) models.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.furnishOffices();
  }
  /** The floor is one big texture: each room's own material (a CC0 photo-texture once it has loaded, a drawn tile until then), a darker rim along
   *  the walls, soft contact shadows under every piece of furniture, pools of window and lamp light, and each office's owner lettered by the door.
   *  The normal and roughness maps are baked the same way, so the lights catch the planks and the grout. It costs nothing per frame. */
  bakeFloor() {
    // In the tower a floor is never wider than the screen and there are several, so a quarter of the pixels does; promote() bakes it again at full size.
    const dens = stage.q?.density ?? 1; const W = this.host ? (dens >= 1 ? 1024 : 768) : dens >= 1 ? 2048 : dens >= 0.6 ? 1536 : 1024, H = Math.round(W * ROOM_D / ROOM_W);
    const ppu = W / ROOM_W; const k = W / 1024;
    const px = (wx) => (wx + ROOM_W / 2) * ppu, pz = (wz) => (wz + ROOM_D / 2) * ppu;
    const { c: tile, across } = this.floorTile;
    const base = this.decor.floor;
    const finish = (r) => (r.kind === 'staff' || r.kind === 'office') ? this.offices.get(r.id)?.theme.floor || base : r.kind === 'kitchen' && !['checker', 'tile'].includes(base) ? 'tile' : r.kind === 'meeting' && base === 'concrete' ? 'carpet' : base;
    const pbr = [...this.floorSets.values()].some((v) => v?.normal);
    const fillWith = (x, img, unitsPerTile, rect) => {
      const sc = (ppu * unitsPerTile) / img.width; const pat = x.createPattern(img, 'repeat');
      x.save(); x.beginPath(); x.rect(px(rect[0]), pz(rect[1]), (rect[2] - rect[0]) * ppu, (rect[3] - rect[1]) * ppu); x.clip(); x.scale(sc, sc); x.fillStyle = pat; x.fillRect(0, 0, W / sc, H / sc); x.restore();
    };
    const paintRooms = (x, layer) => {
      const whole = [-ROOM_W / 2, -ROOM_D / 2, ROOM_W / 2, ROOM_D / 2];
      const rooms = [{ rect: whole, kind: 'all' }, ...(this.plan.rooms || []).filter((r) => r.kind !== 'corridor')];
      for (const r of rooms) {
        const f = r.kind === 'all' ? base : finish(r); const set = this.floorSets.get(f); const img = set?.[layer];
        if (img) fillWith(x, img, FLOOR_TEX[f][1], r.rect);
        else if (layer === 'map' && r.kind === 'all') fillWith(x, tile, 22 / across, r.rect);
        else if (layer === 'map' && (f !== base || r.kind === 'all')) { const t = floorTile(f); fillWith(x, t.c, 22 / t.across, r.rect); }
        else if (layer !== 'map') { x.fillStyle = layer === 'normal' ? 'rgb(128,128,255)' : `rgb(${f === 'carpet' ? 240 : f === 'tile' || f === 'checker' ? 90 : 150},${f === 'carpet' ? 240 : f === 'tile' || f === 'checker' ? 90 : 150},${f === 'carpet' ? 240 : f === 'tile' || f === 'checker' ? 90 : 150})`; x.fillRect(px(r.rect[0]), pz(r.rect[1]), (r.rect[2] - r.rect[0]) * ppu, (r.rect[3] - r.rect[1]) * ppu); }
      }
    };
    const old = [this.floorMat.map, this.floorMat.normalMap, this.floorMat.roughnessMap];
    const tex = canvasTex(W, H, (x) => {
      paintRooms(x, 'map');
      // Window light: warm pools, leaning the way the sun does.
      for (const [a, b] of this.plan.windows) {
        const g = x.createLinearGradient(0, 0, 0, H * 0.32); g.addColorStop(0, 'rgba(255,236,200,.24)'); g.addColorStop(1, 'rgba(255,236,200,0)');
        x.fillStyle = g; x.beginPath(); x.moveTo(px(a), 0); x.lineTo(px(b), 0); x.lineTo(px(b - 2.2), H * 0.32); x.lineTo(px(a - 2.2), H * 0.32); x.closePath(); x.fill();
      }
      // A gentle wash per room, and a warm pool under each office's desk lamp.
      const tone = { meeting: this.tint(0.1), kitchen: 'rgba(230,235,235,.1)', lounge: 'rgba(255,190,120,.1)', corridor: 'rgba(0,0,0,.05)' };
      for (const r of this.plan.rooms || []) {
        const [x0, z0, x1, z1] = r.rect;
        if (tone[r.kind]) { x.fillStyle = tone[r.kind]; x.fillRect(px(x0), pz(z0), px(x1) - px(x0), pz(z1) - pz(z0)); }
        if (r.desk) { const s = seatOf(r.desk).at; const g = x.createRadialGradient(px(s[0]), pz(s[1]), 0, px(s[0]), pz(s[1]), 2.4 * ppu); g.addColorStop(0, 'rgba(255,214,150,.2)'); g.addColorStop(1, 'rgba(255,214,150,0)'); x.fillStyle = g; x.fillRect(px(x0), pz(z0), px(x1) - px(x0), pz(z1) - pz(z0)); }
      }
      // A threshold strip in every doorway.
      x.fillStyle = 'rgba(40,32,24,.32)';
      for (const d of doorways(this.plan)) { const hw = (d.width / 2) * ppu, t = 0.14 * ppu; if (d.along) x.fillRect(px(d.x) - hw, pz(d.z) - t, hw * 2, t * 2); else x.fillRect(px(d.x) - t, pz(d.z) - hw, t * 2, hw * 2); }
      // Each room's name by the way in; an office carries its owner's name, like the lettering in an old office block.
      x.save(); x.textBaseline = 'bottom';
      for (const r of this.plan.rooms || []) {
        const o = this.offices.get(r.id);
        const label = r.kind === 'staff' ? (o?.info.name || '') : r.kind === 'corridor' ? (r.label === 'Corridor' ? '' : r.label) : (o?.info.name && r.id === 'manager' ? `${o.info.name} · ${r.label}` : r.label);
        if (!label) continue;
        const [x0, , , z1] = r.rect;
        x.font = `700 ${Math.round(0.42 * ppu)}px ui-sans-serif, system-ui, sans-serif`;
        x.fillStyle = 'rgba(255,255,255,.45)'; x.fillText(label.toUpperCase(), px(x0) + 0.22 * ppu + 1, pz(z1) - 0.14 * ppu + 1);
        x.fillStyle = 'rgba(20,16,12,.62)'; x.fillText(label.toUpperCase(), px(x0) + 0.22 * ppu, pz(z1) - 0.14 * ppu);
      }
      x.restore();
      // A soft dark line under every wall, so the rooms read from above even with no glass glint.
      x.strokeStyle = 'rgba(20,16,12,.34)'; x.lineWidth = 3 * k; x.beginPath(); for (const w of wallLines(this.plan)) { x.moveTo(px(w.x0), pz(w.z0)); x.lineTo(px(w.x1), pz(w.z1)); } x.stroke();
      const rim = (x0, y0, x1, y1, a) => { const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `rgba(20,16,12,${a})`); g.addColorStop(1, 'rgba(20,16,12,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); };
      rim(0, 0, 0, 70 * k, 0.34); rim(0, 0, 70 * k, 0, 0.34); rim(W, 0, W - 40 * k, 0, 0.12); rim(0, H, 0, H - 40 * k, 0.12);
      // Contact shadows under furniture, pulled slightly toward the camera side of the sun.
      x.save(); x.shadowColor = 'rgba(15,12,10,.55)'; x.shadowBlur = 22 * k; x.shadowOffsetX = -6 * k; x.shadowOffsetY = 5 * k; x.fillStyle = 'rgba(15,12,10,.18)';
      for (const [fx, fz, fw, fd] of this.nav.footprints) x.fillRect(px(fx - fw / 2) + 4 * k, pz(fz - fd / 2) + 4 * k, fw * ppu - 8 * k, fd * ppu - 8 * k);
      x.restore();
    });
    tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    this.floorMat.map = tex;
    if (pbr) {
      const n = canvasTex(W, H, (x) => paintRooms(x, 'normal')); n.colorSpace = THREE.NoColorSpace; this.floorMat.normalMap = n; this.floorMat.normalScale.set(0.7, 0.7);
      const r = canvasTex(W, H, (x) => paintRooms(x, 'rough')); r.colorSpace = THREE.NoColorSpace; this.floorMat.roughnessMap = r; this.floorMat.roughness = 1;
    }
    this.floorMat.needsUpdate = true;
    for (const t of old) if (t && t !== this.floorMat.map && t !== this.floorMat.normalMap && t !== this.floorMat.roughnessMap) t.dispose();
  }
  tint(a) { const c = new THREE.Color(this.colors.primary); return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`; }
  drawClock(x) {
    const now = new Date(); const w = 128;
    x.clearRect(0, 0, w, w);
    x.fillStyle = '#f7f3ea'; x.beginPath(); x.arc(64, 64, 62, 0, 7); x.fill();
    x.strokeStyle = '#2b2d35'; x.lineWidth = 3;
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; x.beginPath(); x.moveTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50); x.lineTo(64 + Math.cos(a) * (i % 3 ? 55 : 58), 64 + Math.sin(a) * (i % 3 ? 55 : 58)); x.stroke(); }
    const hand = (ang, len, wd, col) => { x.strokeStyle = col; x.lineWidth = wd; x.lineCap = 'round'; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(ang) * len, 64 + Math.sin(ang) * len); x.stroke(); };
    const h = now.getHours() % 12, m = now.getMinutes(), sec = now.getSeconds();
    hand(((h + m / 60) / 12) * Math.PI * 2 - Math.PI / 2, 30, 5, '#2b2d35');
    hand(((m + sec / 60) / 60) * Math.PI * 2 - Math.PI / 2, 46, 4, '#2b2d35');
    hand((sec / 60) * Math.PI * 2 - Math.PI / 2, 50, 1.5, this.colors.primary);
    x.fillStyle = this.colors.primary; x.beginPath(); x.arc(64, 64, 4, 0, 7); x.fill();
  }
  boardTexture(tasks) {
    const { primary, accent } = this.colors;
    return canvasTex(704, 340, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#fdfcf8'); g.addColorStop(1, '#eeebe2'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(0,0,0,.05)'; x.fillRect(0, 0, w, 6); x.fillRect(0, 0, 6, h);
      const marker = (col) => { x.strokeStyle = col; x.fillStyle = col; x.lineCap = 'round'; x.lineJoin = 'round'; };
      if (!tasks.length) {
        x.font = '600 40px Fraunces, Georgia, serif'; x.fillStyle = primary; x.fillText('Big ideas', 30, 58);
        marker('#7d8594'); x.lineWidth = 3;
        for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(34, 104 + i * 42); x.bezierCurveTo(200, 94 + i * 44, 300, 114 + i * 40, 420 - i * 50, 104 + i * 42); x.stroke(); }
        marker('#2a60c0'); x.lineWidth = 4; x.strokeRect(490, 60, 150, 90); x.beginPath(); x.moveTo(500, 140); x.lineTo(560, 90); x.lineTo(600, 120); x.lineTo(630, 70); x.stroke();
        marker(primary); x.beginPath(); x.arc(560, 230, 42, 0, 7); x.stroke(); x.beginPath(); x.moveTo(560, 188); x.lineTo(560, 230); x.lineTo(595, 250); x.stroke();
        return;
      }
      const title = (tasks[0].plan || 'The plan').slice(0, 30);
      x.font = '600 36px Fraunces, Georgia, serif'; x.fillStyle = primary; x.fillText(title, 30, 54);
      marker(primary); x.lineWidth = 3; x.beginPath(); x.moveTo(30, 66); x.lineTo(34 + x.measureText(title).width, 70); x.stroke();
      x.font = '600 23px ui-sans-serif, system-ui, sans-serif';
      tasks.slice(0, 6).forEach((t, i) => {
        const y = 108 + i * 38;
        marker(t.status === 'done' ? '#3d8a55' : t.status === 'blocked' ? '#c8455a' : '#2f3340'); x.lineWidth = 3;
        x.strokeRect(32, y - 18, 22, 22);
        if (t.status === 'done') { x.lineWidth = 4; x.beginPath(); x.moveTo(36, y - 7); x.lineTo(43, y + 1); x.lineTo(58, y - 20); x.stroke(); }
        else if (t.status === 'doing' || t.status === 'review') { x.fillStyle = accent; x.fillRect(36, y - 14, 14, 14); }
        x.fillStyle = t.status === 'done' ? '#8a8e99' : '#2f3340';
        const label = t.title.slice(0, 32);
        x.fillText(label, 66, y);
        if (t.status === 'done') { x.lineWidth = 2; x.strokeStyle = '#8a8e99'; x.beginPath(); x.moveTo(66, y - 8); x.lineTo(66 + x.measureText(label).width, y - 8); x.stroke(); }
      });
      // A diagram scribble on the right: boxes, arrows and a little chart.
      marker('#2a60c0'); x.lineWidth = 3;
      x.strokeRect(470, 96, 92, 50); x.strokeRect(590, 96, 92, 50); x.strokeRect(530, 190, 92, 50);
      x.beginPath(); x.moveTo(562, 121); x.lineTo(588, 121); x.moveTo(580, 114); x.lineTo(588, 121); x.lineTo(580, 128); x.stroke();
      x.beginPath(); x.moveTo(516, 146); x.lineTo(574, 188); x.moveTo(636, 146); x.lineTo(578, 188); x.stroke();
      marker(primary); x.lineWidth = 4; x.beginPath(); x.moveTo(470, 300); x.lineTo(500, 270); x.lineTo(540, 288); x.lineTo(590, 250); x.lineTo(640, 262); x.lineTo(680, 232); x.stroke();
      marker('#c8455a'); x.lineWidth = 3; x.beginPath(); x.arc(632, 262, 10, 0, 7); x.stroke();
    });
  }
  updateBoard(tasks) {
    this.tasks = tasks;
    for (const a of this.actors.values()) if (a.state !== 'idle') a.renderBubble();
    const shown = tasks.filter((t) => ['todo', 'doing', 'review', 'blocked', 'done'].includes(t.status));
    const open = shown.some((t) => t.status !== 'done');
    const list = open ? shown : [];
    const key = JSON.stringify(list.map((t) => [t.title, t.status]));
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.boardMat.map?.dispose();
    this.boardMat.map = this.boardTexture(list);
    this.boardMat.needsUpdate = true;
  }
  setFloorName(name) {
    this.floorName = name;
    if (!this.signTex) return;
    const c = this.signTex.image; const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    let size = 92;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    do { x.font = `600 ${size}px Fraunces, Georgia, serif`; size -= 6; } while (x.measureText(name).width > c.width - 80 && size > 28);
    x.shadowColor = this.colors.accent; x.shadowBlur = 34; x.fillStyle = '#fff8e8';
    x.fillText(name, c.width / 2, c.height / 2 + 4); x.fillText(name, c.width / 2, c.height / 2 + 4);
    x.shadowBlur = 0; x.strokeStyle = this.colors.accent; x.lineWidth = 2; x.strokeText(name, c.width / 2, c.height / 2 + 4);
    this.signTex.needsUpdate = true;
  }
  /** Staff arrive, and existing ones keep their place. Called for the snapshot and each hire. Everyone gets a room of their own. */
  syncAgents(state) {
    this.setFloorName(state.floor.name);
    const staff = state.agents.filter((a) => a.role !== 'manager');
    const fresh = staff.filter((a) => !this.actors.has(a.id));
    this.owners = assignRooms(this.plan, staff, this.owners);
    for (const a of fresh) {
      const i = this.seatCount = (this.seatCount ?? 0) + 1;
      const roomId = this.owners.get(a.id);
      const room = roomId ? this.plan.rooms.find((r) => r.id === roomId) : null;
      // Past the last free room, a second desk goes into an office that already has someone in it.
      const spot = room ? room.desk : seatSpot(this.plan, this.plan.desks.length + ((i - 1) % this.plan.shared.length));
      const host = room || roomAt(this.plan, ...seatOf(spot).at);
      const [x, z, ry] = spot;
      const g = new THREE.Group(); this.room.add(g); g.userData.glowTex = this.glowTex;
      const tmp = new THREE.Group();
      const desk = makeDesk(g, tmp, tmp, x, z, this.colors.accent, this.colors.primary, this.colors.accent, { seed: i + 7, ry });
      this.nav.block(...deskRect(spot));
      const actor = new Actor(this, a, { at: desk.at, face: desk.face, screenMat: desk.screenMat, glow: desk.glow, bar: desk.bar });
      actor.deskPos = [x, z, ry]; actor.office = host?.id || null;
      this.actors.set(a.id, actor);
      actor.setState(a.state, a.activity);
      if (room) this.addOffice(room, a, { own: true, actor });
      else if (host && this.offices.has(host.id)) { const o = this.offices.get(host.id); o.shared = [...(o.shared || []), { info: a, desk: spot, seed: i + 7 }]; }
    }
    for (const a of staff) { const o = this.offices.get(this.actors.get(a.id)?.office); if (o?.info.id === a.id) o.info = a; }
    // The rooms nobody has yet are still furnished, and say so on the door, ready for the next hire.
    const owned = new Set(this.owners.values()); let vacant = 0;
    for (const r of this.plan.rooms) if (r.kind === 'staff' && !owned.has(r.id) && !this.offices.has(r.id)) { this.nav.block(...deskRect(r.desk)); this.addOffice(r, { id: `free-${r.id}`, role: 'vacant', name: null }, { own: true }); vacant++; }
    if (fresh.length || vacant || !this.floorMat.map) { this.rebuildOffices(); this.bakeFloor(); this.loadFloorSets(); if (this.modelsOn) this.furnishOffices(); }
    const seen = new Set();
    const mgr = state.agents.find((a) => a.role === 'manager');
    if (mgr) {
      seen.add(mgr.id);
      if (!this.actors.has(mgr.id)) {
        const actor = new Actor(this, mgr, this.managerSeat); actor.isManager = true;
        this.actors.set(mgr.id, actor); actor.setState(mgr.state, mgr.activity);
      }
      this.manager = this.actors.get(mgr.id);
    }
    if (!this.boss) {
      this.boss = new Actor(this, { id: 'boss', name: state.floor.boss.name, look: state.floor.boss.look }, this.bossSeat, { isBoss: true });
      this.actors.set('boss', this.boss);
    }
    seen.add('boss');
    // The two bosses' rooms carry their names on the door too.
    const names = { manager: mgr?.name, boss: state.floor.boss?.name };
    let renamed = false;
    for (const id of ['manager', 'boss']) { const o = this.offices.get(id); if (o && names[id] && o.info.name !== names[id]) { o.info = { ...o.info, name: names[id] }; renamed = true; } }
    if (renamed) this.drawSigns();
    this.updateBoard(state.tasks);
  }
  /** Records whose a room is and how it's done out. The furniture follows in rebuildOffices and furnishOffices. */
  addOffice(room, info, { own = true, actor = null } = {}) {
    const theme = officeTheme(info);
    const slots = officeSlots(room);
    // Everything that stands on the floor is in the way of walking; rugs and wall pieces aren't.
    for (const t of theme.things) { const sl = t.slot && slots.slots[t.slot]; if (sl) this.nav.block(sl.x, sl.z, 0.8, 0.8); }
    this.offices.set(room.id, { room, info, theme, slots, own, actor });
  }
  /** Each office's own look, baked into one group: a feature wall in its owner's colour, what hangs on it, the stand-in desks, and the door signs. */
  rebuildOffices() {
    const { primary, accent } = this.colors;
    const old = [this.officeStatic, this.officeDetail, this.officeLegacy];
    const st = new THREE.Group(), dt = new THREE.Group(), lg = new THREE.Group();
    dt.visible = this.detailOn;
    for (const o of this.offices.values()) {
      const { room, theme, slots } = o; const [x0, z0, x1, z1] = room.rect;
      const backOuter = z0 <= -ROOM_D / 2 + 0.01;
      // The wall behind, painted: full height on an inside wall, a band under the windows on the outer one.
      const fw = x1 - x0 - 0.16, fh = backOuter ? 1.0 : 2.2, fz = z0 + (backOuter ? 0.03 : 0.1);
      piece(st, theme.wall, fw, fh, 0.05, (x0 + x1) / 2, 0, fz, { cast: false, shade: [0, fh, 0.8, 1.05] });
      piece(st, mix(theme.wall, '#ffffff', 0.3), fw, 0.04, 0.07, (x0 + x1) / 2, fh, fz, { cast: false });
      const wallMid = [(x0 + x1) / 2, fz + 0.05];
      for (const t of theme.things) if (t.p) this.officeThing(t, o, st, dt, wallMid, fh);
      if (o.own) {
        const [dx, dz, dry] = room.desk;
        makeDesk(st, dt, lg, dx, dz, accent, primary, accent, { seed: (o.actor?.id?.length || 3) * 7 + room.id.length, ry: dry, live: false });
      }
      for (const sh of o.shared || []) makeDesk(st, dt, lg, sh.desk[0], sh.desk[1], accent, primary, accent, { seed: sh.seed, ry: sh.desk[2], live: false });
    }
    mergeColored(st, ROOM_MAT); mergeColored(dt, ROOM_MAT); mergeColored(lg, ROOM_MAT);
    this.root.add(st, dt); if (!this.modelsOn) this.root.add(lg);
    this.officeStatic = st; this.officeDetail = dt; this.officeLegacy = lg;
    for (const g of old) if (g && g !== st) { g.removeFromParent(); g.traverse((m) => { if (m.userData?.merged) m.geometry.dispose(); }); }
    this.drawSigns();
  }
  /** One of the drawn pieces a role's room has: things on the wall, on the desk, or standing in a slot. All plain colour, so they bake. */
  officeThing(t, o, st, dt, [wx, wz], fh) {
    const { primary, accent } = this.colors; const r = seeded(o.room.id.length * 13 + 5);
    const sl = t.slot ? o.slots.slots[t.slot] : null;
    const wallY = Math.min(fh, 2.2) - 0.25;
    const onWall = (w, h) => ({ x: wx, y: Math.max(1.05, wallY - h), z: wz });
    const stand = (fn) => { if (!sl) return; const g = new THREE.Group(); g.position.set(sl.x, 0, sl.z); g.rotation.y = sl.ry; st.add(g); fn(g); };
    const [dx, dz, dry] = o.room.desk; const onDesk = (fn) => { const g = new THREE.Group(); g.position.set(dx, 0, dz); g.rotation.y = dry; dt.add(g); fn(g); };
    switch (t.p) {
      case 'pegboard': { const p = onWall(2.4, 1.2); piece(st, '#b78a58', 2.4, 1.2, 0.04, p.x, p.y, p.z, { cast: false }); for (let i = 0; i < 7; i++) piece(dt, [primary, '#3a3d44', accent, '#8e959c'][i % 4], 0.1, 0.3 + (i % 3) * 0.15, 0.05, p.x - 1.0 + i * 0.33, p.y + 0.35, p.z + 0.04, { cast: false }); break; }
      case 'moodboard': { const p = onWall(2.2, 1.1); piece(st, '#efe8dc', 2.2, 1.1, 0.04, p.x, p.y, p.z, { cast: false }); for (let i = 0; i < 9; i++) piece(dt, ['#f2a7a0', '#f6d27a', '#9fd3c7', primary, accent, '#c7b8ea', '#2b2d35', '#ffffff', '#e98a6b'][i], 0.48, 0.28, 0.02, p.x - 0.75 + (i % 3) * 0.75, p.y + 0.1 + Math.floor(i / 3) * 0.33, p.z + 0.04, { cast: false, ry: (r() - 0.5) * 0.1 }); break; }
      case 'posters': { for (let i = 0; i < 3; i++) { const p = onWall(0.8, 1.1); piece(st, [accent, primary, '#23212f'][i], 0.7, 1.0, 0.03, p.x - 1.0 + i * 1.0, p.y, p.z, { cast: false }); piece(dt, '#fff8e8', 0.4, 0.4, 0.02, p.x - 1.0 + i * 1.0, p.y + 0.45, p.z + 0.03, { cast: false, geo: i === 1 ? cyl : box }); } break; }
      case 'charts': case 'scribbles': case 'bugboard': case 'orgchart': {
        const p = onWall(2.4, 1.2); const cork = t.p === 'bugboard';
        piece(st, cork ? '#b98d5f' : '#f6f4ee', 2.4, 1.2, 0.04, p.x, p.y, p.z, { cast: false }); piece(st, '#8f8a7e', 2.5, 0.05, 0.08, p.x, p.y - 0.05, p.z + 0.03, { cast: false });
        if (t.p === 'charts') for (let i = 0; i < 6; i++) piece(dt, i % 2 ? accent : primary, 0.22, 0.2 + r() * 0.7, 0.02, p.x - 0.8 + i * 0.32, p.y + 0.12, p.z + 0.04, { cast: false });
        else if (t.p === 'bugboard') for (let i = 0; i < 8; i++) { piece(dt, ['#fbf7ea', '#f8d66b', '#9be3c8'][i % 3], 0.32, 0.26, 0.02, p.x - 0.9 + (i % 4) * 0.6, p.y + 0.2 + Math.floor(i / 4) * 0.5, p.z + 0.04, { cast: false }); piece(dt, '#d9443a', 0.06, 0.06, 0.03, p.x - 0.9 + (i % 4) * 0.6, p.y + 0.42 + Math.floor(i / 4) * 0.5, p.z + 0.05, { cast: false, geo: sph }); }
        else if (t.p === 'orgchart') { piece(dt, primary, 0.5, 0.22, 0.02, p.x, p.y + 0.85, p.z + 0.04, { cast: false }); for (let i = 0; i < 4; i++) { piece(dt, accent, 0.4, 0.2, 0.02, p.x - 0.75 + i * 0.5, p.y + 0.3, p.z + 0.04, { cast: false }); piece(dt, '#7d8594', 0.02, 0.3, 0.02, p.x - 0.75 + i * 0.5, p.y + 0.5, p.z + 0.04, { cast: false }); } piece(dt, '#7d8594', 1.5, 0.02, 0.02, p.x, p.y + 0.8, p.z + 0.04, { cast: false }); }
        else for (let i = 0; i < 5; i++) piece(dt, ['#2a60c0', '#d9443a', '#2f3340'][i % 3], 0.5 + r() * 1.0, 0.03, 0.02, p.x - 0.2 + (r() - 0.5) * 0.6, p.y + 0.2 + i * 0.18, p.z + 0.04, { cast: false, ry: 0 });
        break;
      }
      case 'trophy': onDesk((g) => { piece(g, '#e9b949', 0.18, 0.08, 0.18, -1.15, 1.2, -0.45, { geo: cyl, cast: false }); piece(g, '#e9b949', 0.06, 0.16, 0.06, -1.15, 1.28, -0.45, { geo: cyl, cast: false }); piece(g, '#e9b949', 0.24, 0.2, 0.24, -1.15, 1.44, -0.45, { geo: cone }); }); break;
      case 'second-screen': onDesk((g) => { piece(g, '#2a2b33', 0.8, 0.52, 0.05, 0.85, 1.3, -0.5, { ry: -0.35 }); piece(g, '#25262d', 0.08, 0.3, 0.06, 0.85, 1.0, -0.5); piece(g, '#3b5f8f', 0.72, 0.44, 0.01, 0.84, 1.34, -0.47, { ry: -0.35, cast: false }); }); break;
      case 'manuscript': onDesk((g) => { for (let i = 0; i < 4; i++) piece(g, '#fbf7ea', 0.34, 0.03, 0.44, -0.75, 1.0 + i * 0.03, -0.3, { cast: false, ry: (r() - 0.5) * 0.3 }); piece(g, '#2f3036', 0.5, 0.14, 0.34, 0.75, 1.0, -0.35); piece(g, '#fbf7ea', 0.3, 0.2, 0.01, 0.75, 1.12, -0.48, { cast: false }); }); break;
      case 'rack': stand((g) => { piece(g, '#25272e', 0.7, 1.9, 0.7, 0, 0, 0); for (let i = 0; i < 7; i++) { piece(g, '#3a3d44', 0.62, 0.02, 0.02, 0, 0.3 + i * 0.22, 0.36, { cast: false }); piece(g, i % 3 ? '#4ad17a' : accent, 0.04, 0.04, 0.02, 0.22, 0.36 + i * 0.22, 0.37, { cast: false, mat: new THREE.MeshBasicMaterial({ color: i % 3 ? '#4ad17a' : accent }) }).userData.keep = true; } }); break;
      case 'globe': stand((g) => { piece(g, '#5e4436', 0.5, 0.06, 0.5, 0, 0, 0, { geo: cyl }); piece(g, '#5e4436', 0.05, 0.9, 0.05, 0, 0.05, 0, { geo: cyl }); piece(g, '#3c78a8', 0.56, 0.56, 0.56, 0, 0.95, 0, { geo: sph }); piece(g, '#6aa84f', 0.3, 0.2, 0.2, 0.12, 1.25, 0.14, { geo: sph, cast: false }); }); break;
      case 'easel': stand((g) => {
        for (const lx of [-0.3, 0.3]) { const leg = piece(g, '#8a6a45', 0.05, 1.7, 0.05, lx, 0, 0.05); leg.rotation.z = lx > 0 ? 0.07 : -0.07; }
        piece(g, '#6a4b30', 0.85, 0.05, 0.12, 0, 0.7, 0.08); piece(g, '#f4efe4', 0.8, 0.95, 0.03, 0, 0.74, 0.1); piece(g, accent, 0.5, 0.4, 0.01, -0.05, 1.05, 0.12, { cast: false, geo: sph }); piece(g, primary, 0.3, 0.3, 0.01, 0.15, 0.9, 0.125, { cast: false });
      }); break;
      default: break;
    }
  }
  /** The kit's furniture for every office, one baked group. Rebuilt on each hire; the templates are cached, so it's quick. */
  async furnishOffices() {
    if (!this.kit) return;
    const token = this.furnishToken = (this.furnishToken || 0) + 1;
    this.furnishing = (this.furnishing || 0) + 1;
    const names = new Set();
    for (const o of this.offices.values()) for (const t of o.theme.things) if (t.m) { names.add(t.m); if (ON_TABLE.has(t.m)) names.add('sideTableDrawers'); }
    const missing = [...names].filter((n) => !this.kit[n]);
    // Each piece on its own: one that fails to load is just left out.
    const got = await Promise.allSettled(missing.map((n) => furniture(n)));
    this.furnishing--;
    missing.forEach((n, i) => { if (got[i].status === 'fulfilled') this.kit[n] = got[i].value; });
    // Whichever pass finishes builds from the offices as they are now, so a slow earlier pass can't put back an old room.
    if (this.dead || (token < this.furnishedToken)) return;
    this.furnishedToken = token;
    const T = this.kit; const g = new THREE.Group(); g.userData.fromKit = true;
    const tints = (c) => ({ carpet: c, carpetBlue: c });
    for (const o of this.offices.values()) {
      if (o.own) this.deskInto(g, o.room.desk[0], o.room.desk[1], this.colors.accent, o.room.desk[2]);
      for (const sh of o.shared || []) this.deskInto(g, sh.desk[0], sh.desk[1], this.colors.accent, sh.desk[2]);
      for (const t of o.theme.things) {
        if (!t.m || !T[t.m]) continue;
        const at = t.rug ? { x: o.slots.rug.x, z: o.slots.rug.z, ry: o.slots.ry } : o.slots.slots[t.slot];
        if (!at || (o.shared?.length && t.slot?.startsWith('side'))) continue;
        let y = 0;
        if (ON_TABLE.has(t.m) && T.sideTableDrawers) { const tb = place(T.sideTableDrawers, { x: at.x, z: at.z, ry: at.ry, scale: FS }); g.add(tb); y = T.sideTableDrawers.userData.size.y * FS; }
        g.add(place(T[t.m], { x: at.x, y, z: at.z, ry: at.ry, scale: FS * (t.s ?? 1), tint: t.rug ? tints(mix(o.theme.wall, '#f4efe6', 0.45)) : t.m.startsWith('chair') || t.m.startsWith('lounge') ? tints(o.theme.wall) : null }));
      }
    }
    mergeColored(g, ROOM_MAT);
    if (!this.detailOn) g.traverse((m) => { if (m.isMesh) m.castShadow = false; });
    const old = this.officeModels; this.officeModels = g; this.root.add(g);
    if (old) { old.removeFromParent(); old.traverse((m) => { if (m.userData?.merged) m.geometry.dispose(); }); }
    this.officeLegacy?.removeFromParent();
    for (const a of this.actors.values()) if (a.seated) a.sitDown();
  }
  /** A name plate over every office door, all on one texture: the owner's name and what they do, so you can find anyone at a glance. */
  drawSigns() {
    const list = [...this.offices.values()].filter((o) => o.room.door);
    const cols = 2, rows = Math.max(1, Math.ceil(list.length / cols)); const cw = 512, ch = 128;
    const tex = canvasTex(cw * cols, ch * rows, (x) => {
      list.forEach((o, i) => {
        const px = (i % cols) * cw, py = Math.floor(i / cols) * ch;
        x.fillStyle = '#1f2129'; x.fillRect(px, py, cw, ch);
        x.fillStyle = o.theme.wall; x.fillRect(px, py, 18, ch);
        x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 4; x.strokeRect(px + 2, py + 2, cw - 4, ch - 4);
        const free = o.info.role === 'vacant';
        const name = free ? 'Free office' : o.info.name || (o.room.id === 'boss' ? 'The boss' : 'Office'); const role = free ? 'Ready for a hire' : o.room.id === 'boss' ? 'Boss' : ROLE_TITLE[o.info.role] || o.info.title || o.info.role || '';
        x.textBaseline = 'middle'; x.fillStyle = '#fff8e8';
        let size = 58; do { x.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`; size -= 4; } while (x.measureText(name).width > cw - 60 && size > 24);
        x.fillText(name, px + 36, py + ch * 0.4);
        x.font = '600 30px ui-sans-serif, system-ui, sans-serif'; x.fillStyle = mix(o.theme.wall, '#ffffff', 0.6); x.fillText(role.toUpperCase(), px + 38, py + ch * 0.8);
      });
    });
    const pos = [], uv = [], idx = [];
    list.forEach((o, i) => {
      const d = o.room.door; const along = d.side === 'n' || d.side === 's';
      const u0 = (i % cols) / cols, u1 = u0 + 1 / cols, v1 = 1 - Math.floor(i / cols) / rows, v0 = v1 - 1 / rows;
      const w = 1.25, y0 = 3.14, y1 = 3.76, lean = 0.22; const b = pos.length / 3;
      if (along) pos.push(d.x - w, y0, d.z + 0.07, d.x + w, y0, d.z + 0.07, d.x + w, y1, d.z + 0.07 - lean, d.x - w, y1, d.z + 0.07 - lean);
      else pos.push(d.x + 0.07, y0, d.z + w, d.x + 0.07, y0, d.z - w, d.x + 0.07 - lean, y1, d.z - w, d.x + 0.07 - lean, y1, d.z + w);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1); idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    if (this.signMesh2) { this.signMesh2.removeFromParent(); this.signMesh2.geometry.dispose(); this.signMesh2.material.map.dispose(); this.signMesh2.material.dispose(); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    tex.anisotropy = 8;
    this.signMesh2 = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }));
    this.root.add(this.signMesh2);
  }
  /** The outer walls in a real material, tinted by the wall colour, with its normal and roughness maps where the tier allows. */
  skinWalls(style, set) {
    const wall = this.decor.wall;
    if (!this.wallSkin) { const back = []; { let at = -ROOM_W / 2; for (const [a, b] of this.plan.windows) { back.push([at, a]); at = b; } back.push([at, ROOM_W / 2]); } this.wallSkin = this.wallSkinMesh('paint', wall, back); this.room.add(this.wallSkin); }
    const m = this.wallSkin.material;
    m.map?.dispose(); m.map = repeating(set.map, { color: true });
    if (set.normal) { m.normalMap = repeating(set.normal); m.normalScale.set(0.8, 0.8); }
    if (set.rough) { m.roughnessMap = repeating(set.rough); m.roughness = 1; }
    m.color.set(style === 'brick' ? mix(wall, '#ffffff', 0.7) : style === 'paint' ? mix(wall, '#ffffff', 0.15) : mix(wall, '#ffffff', 0.45));
    m.needsUpdate = true;
  }
  /** Shows who was tapped: a ring at their feet and a lit name tag, until someone else (or nobody) is. */
  highlight(id) {
    for (const a of this.actors.values()) { const on = a.id === id; if (on) { a.tag.dataset.selected = '1'; a.nameEl.style.outline = `2px solid ${this.colors.accent}`; a.nameEl.style.outlineOffset = '2px'; } else if (a.tag.dataset.selected) { delete a.tag.dataset.selected; a.nameEl.style.outline = ''; } }
    this.selected = id && this.actors.has(id) ? id : null;
    if (!this.ring) {
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 40), new THREE.MeshBasicMaterial({ color: this.colors.accent, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
      this.ring.rotation.x = -Math.PI / 2; this.ring.renderOrder = 3; this.root.add(this.ring);
    }
    this.ring.visible = !!this.selected;
  }
  /** The person under a tap, by their projected body on screen, nearest the camera first. Null when the tap is on nothing. */
  pick(cx, cy) {
    const r = document.getElementById('scene').getBoundingClientRect(); const x = cx - r.left, y = cy - r.top;
    let best = null, bestD = Infinity;
    for (const a of this.actors.values()) {
      this.tv.copy(a.group.position).project(this.camera);
      const fx = (this.tv.x * 0.5 + 0.5) * this.w, fy = (-this.tv.y * 0.5 + 0.5) * this.h;
      if (a.tagX === undefined || this.tv.z > 1) continue;
      const hx = a.tagX, hy = a.tagY; const tall = Math.max(24, fy - hy);
      // Distance from the tap to the line from feet to head, with a little give for small people far away.
      const dx = hx - fx, dy = hy - fy; const t = Math.max(0, Math.min(1, ((x - fx) * dx + (y - fy) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(x - (fx + dx * t), y - (fy + dy * t));
      if (d < Math.max(16, tall * 0.32) && d < bestD) { best = a; bestD = d; }
    }
    return best;
  }
  /** The floor is closed and nobody has been called in: everyone but the boss goes home. */
  setClosed(on) { this.closed = !!on; }
  agentEvent(ev) { const a = this.actors.get(ev.id); if (a) { a.taskId = ev.taskId ?? null; a.setState(ev.state, ev.activity); } }
  taskFor(actor) { return actor.taskId == null ? null : this.tasks.find((t) => t.id === actor.taskId) || null; }
  /** A free place to stand and talk to someone: in the same room as them, on the side the camera can see, and not where someone else is already standing. */
  visitSpot(seat, visitor = null) {
    const [mx, mz] = seat.at;
    const room = roomAt(this.plan, mx, mz);
    const inside = (x, z) => !room || (x > room.rect[0] + 0.25 && x < room.rect[2] - 0.25 && z > room.rect[1] + 0.25 && z < room.rect[3] - 0.25);
    const free = (x, z) => [...this.claims.entries()].every(([who, c]) => who === visitor || Math.hypot(c[0] - x, c[1] - z) > 0.95);
    for (const r of [1.5, 1.9, 2.4, 3.0, 3.6]) for (let i = 0; i < 12; i++) {
      // Starting toward the camera (+z), then working round both ways.
      const a = ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI) / 6;
      const x = mx + Math.sin(a) * r, z = mz + Math.cos(a) * r;
      if (Math.abs(x) < ROOM_W / 2 - 0.4 && Math.abs(z) < ROOM_D / 2 - 0.4 && inside(x, z) && !this.nav.isBlocked(x, z) && free(x, z) && this.nav.reachable(mx, mz, x, z)) return { at: [x, z], face: Math.atan2(mx - x, mz - z) };
    }
    const at = this.nav.freeNear(mx + 1.5, mz + 1.5);
    return { at, face: Math.atan2(mx - at[0], mz - at[1]) };
  }
  /** The boss walks over for a word whenever they message the manager. */
  bossTalks() {
    const b = this.boss, m = this.manager;
    if (!b || !m || b.action) return;
    const v = this.visitSpot(this.managerSeat, b);
    this.claims.set(b, v.at);
    b.perform([{ walk: v.at }, { anim: 'talk', hold: 2.8, face: v.face }]);
  }
  /** The whole batch in the meeting room: the visible moment a plan is made. The manager reads out the real assignments, and the team listens. */
  meeting(managerId, staffIds) { this.life.meeting(managerId, staffIds); }
  /** The manager rings buddehbot. Purely for show: a seated manager stands up, takes the call, and gets back to work. */
  phoneCall(managerId) {
    const m = this.actors.get(managerId);
    if (!m || m.action) return;
    m.standUp();
    m.perform([{ anim: 'phone', hold: 3.2 }]);
  }
  /** Finished work is physically carried over, unless the words that go with it are already on their way. */
  handoff(fromId, toId) { this.life.handoff(fromId, toId); }
  cheer() {
    for (const a of this.actors.values()) {
      if (a.action) continue;
      a.standUp();
      a.perform([{ anim: 'cheer', hold: 1.8 }]);
    }
  }
  /**
   * Drag to turn the room, or to slide across it once zoomed in; pinch or scroll to zoom, toward the pointer; two fingers also slide. Shift-drag,
   * or a right-button drag, always turns. A tap on a person fires `office:agent-tap` with their id and rings them; a tap on nothing clears it.
   */
  bind() {
    const el = document.getElementById('scene');
    this.pts = new Map();
    const clampPan = (v) => { const f = Math.max(0, 1 - 1 / this.targetZoom) + 0.08; v.x = Math.max(-ROOM_W / 2 * f, Math.min(ROOM_W / 2 * f, v.x)); v.y = Math.max(-ROOM_D / 2 * f, Math.min(ROOM_D / 2 * f, v.y)); return v; };
    // Screen pixels to a slide across the floor, at the current distance and turn.
    const slide = (dx, dy) => {
      const per = (2 * this.camDist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / (this.h || 1);
      const c = Math.cos(this.yaw), sn = Math.sin(this.yaw), up = 1 / Math.max(0.4, Math.sin(this.pitch));
      this.targetPan.x -= (dx * c + dy * sn * up) * per; this.targetPan.y -= (-dx * sn + dy * c * up) * per;
      clampPan(this.targetPan);
    };
    this.onDown = (e) => { if (e.target !== el) return; this.pts.set(e.pointerId, [e.clientX, e.clientY]); this.moved = 0; this.turning = e.shiftKey || e.button === 2; el.setPointerCapture?.(e.pointerId); };
    this.onMove = (e) => {
      if (!this.pts.has(e.pointerId)) return;
      const [px, py] = this.pts.get(e.pointerId);
      const dx = e.clientX - px, dy = e.clientY - py;
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.pts.size === 1) {
        if (this.targetZoom > 1.12 && !this.turning) slide(dx, dy);
        else this.targetYaw = Math.max(-0.2, Math.min(1.25, this.targetYaw - dx * 0.006));
      } else if (this.pts.size === 2) {
        const other = [...this.pts.entries()].find(([k]) => k !== e.pointerId)[1];
        const before = Math.hypot(px - other[0], py - other[1]), after = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
        this.targetZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.targetZoom * (after / (before || 1))));
        slide(dx / 2, dy / 2);
      }
      this.pts.set(e.pointerId, [e.clientX, e.clientY]);
    };
    this.onUp = (e) => {
      const was = this.pts.has(e.pointerId), single = this.pts.size === 1;
      this.pts.delete(e.pointerId);
      if (!was || !single || this.moved > 8 || e.type === 'pointercancel') return;
      const a = this.pick(e.clientX, e.clientY);
      this.highlight(a ? a.id : null);
      if (a) el.dispatchEvent(new CustomEvent('office:agent-tap', { detail: { id: a.id }, bubbles: true }));
    };
    this.onWheel = (e) => {
      if (e.target !== el) return; e.preventDefault();
      const before = this.targetZoom;
      this.targetZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.targetZoom * Math.exp(-e.deltaY * 0.0012)));
      // Zoom toward the pointer: slide by the part of its offset from the middle that the zoom takes away.
      const r = el.getBoundingClientRect(); const i = this.insetNow || { left: 0, right: 0, top: 0, bottom: 0 };
      const cx = r.left + i.left + (this.visW || r.width) / 2, cy = r.top + i.top + (this.visH || r.height) / 2;
      const f = 1 - before / this.targetZoom;
      if (f) slide(-(e.clientX - cx) * f, -(e.clientY - cy) * f);
      else clampPan(this.targetPan);
    };
    this.onMenu = (e) => { if (e.target === el) e.preventDefault(); };
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onMenu);
    this.unbind = () => {
      el.removeEventListener('pointerdown', this.onDown); window.removeEventListener('pointermove', this.onMove);
      window.removeEventListener('pointerup', this.onUp); window.removeEventListener('pointercancel', this.onUp); el.removeEventListener('wheel', this.onWheel); el.removeEventListener('contextmenu', this.onMenu);
    };
  }
  enter() {
    const r = stage.renderer;
    r.shadowMap.enabled = this.sun.castShadow; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true;  // the stage redraws it every other frame
    r.toneMappingExposure = 0.92;
    const w = this.world; this.scene.add(w.group); w.group.scale.setScalar(WORLD_SCALE); w.group.position.set(0, this.worldLift, 0);
    w.setDetail((stage.q?.density ?? 1) >= 0.6);
  }
  leave() { const r = stage.renderer; r.shadowMap.enabled = false; r.shadowMap.autoUpdate = true; r.toneMappingExposure = 0.84; }
  setTier(q) {
    this.detailOn = q.density >= 0.6;
    this.detail.visible = this.detailOn;
    if (this.officeDetail) this.officeDetail.visible = this.detailOn;
    for (const a of this.actors.values()) if (a.seat.glow) a.seat.glow.visible = this.detailOn && a.state !== 'idle';
    if (this.host) return;  // the tower owns the lights and the city
    this.sun.castShadow = q.shadow > 0;
    if (q.shadow > 0) { this.sun.shadow.mapSize.set(q.shadow, q.shadow); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    stage.renderer.shadowMap.enabled = this.sun.castShadow;
    this.world.setDetail(q.density >= 0.6);
  }
  /** Frees what this floor made for itself. Model geometry is shared with the cached templates; only our own and the merged batches go. */
  disposeTree(root) {
    root.traverse((o) => {
      if (o.geometry && o.geometry !== box && o.geometry !== cyl && o.geometry !== cone && o.geometry !== ico && o.geometry !== sph && !o.geometry.parameters?.shared && (o.userData.merged || !root.userData.fromKit)) o.geometry.dispose?.();
      if (o.material?.map && o.material.map !== this.glowTex && !root.userData.sharedMaps) o.material.map.dispose();
    });
  }
  /**
   * The tower hands this floor to a floor page. The room moves into a scene of its own at the origin, with its own camera where the
   * tower's camera already is relative to the room (`pose`), its own lights, the city below and the controls. Nothing in it is rebuilt.
   */
  promote(pose = null) {
    if (!this.host) return;
    this.host = null;
    this.root.removeFromParent(); this.root.position.set(0, 0, 0); this.root.visible = true;
    this.scene.add(this.root); this.root.updateMatrixWorld(true);
    this.camera = new THREE.PerspectiveCamera(24, 1, 1, 3800);
    this.kept = true; this.intro = 1; this.tagsOn = true;
    for (const a of this.actors.values()) { a.tagOff = false; a.tag.style.visibility = ''; }
    if (pose) {
      this.yaw = this.targetYaw = pose.yaw; this.zoom = this.targetZoom = pose.zoom; this.pan.set(pose.pan[0], pose.pan[1]); this.targetPan.copy(this.pan); this.sized = true;
      this.insets = { ...pose.insets }; this.insetNow = { ...pose.insets };
    }
    this.buildWorld(); this.bind();
    // The walls and the floor again with their normal and roughness maps, and the floor baked at full size, once the frame rate can spare it.
    this.floorSets.clear(); this.loadLooks();
    setTimeout(() => { if (!this.dead && !this.host) this.bakeFloor(); }, 700);
  }
  /** The other way: a floor page's view goes back into the tower without being rebuilt. The tower places the root and owns the camera. */
  demote(host) {
    if (this.host) return;
    this.unbind?.(); this.unbind = null;
    if (this.world) this.scene.remove(this.world.group);
    if (this.stub) { this.stub.group.removeFromParent(); this.disposeTree(this.stub.group); this.stub = null; }
    this.root.removeFromParent();
    this.host = host; this.camera = host.camera;
  }
  destroy() {
    this.dead = true;
    this.unbind?.();
    for (const a of this.actors.values()) a.destroy();
    this.actors.clear();
    if (this.world) this.scene.remove(this.world.group);  // shared with the lobby, so never disposed here
    this.root.removeFromParent();
    for (const root of [this.room, this.detail, this.legacy, this.models, this.officeStatic, this.officeDetail, this.officeLegacy, this.officeModels, this.stub?.group, this.pet?.group].filter(Boolean)) this.disposeTree(root);
    this.glassGeo?.dispose(); this.glassMat?.dispose();
    this.envRT?.dispose(); this.ring?.geometry.dispose(); this.ring?.material.dispose();
    if (this.signMesh2) { this.signMesh2.geometry.dispose(); this.signMesh2.material.map.dispose(); this.signMesh2.material.dispose(); }
    for (const t of [this.floorMat.normalMap, this.floorMat.roughnessMap]) t?.dispose();
    for (const k of ['normalMap', 'roughnessMap']) this.wallSkin?.material[k]?.dispose();
    this.codeTex.dispose(); this.pageTex.dispose(); this.idleTex.dispose(); this.glowTex.dispose(); this.discGeo.dispose(); this.discMat.map.dispose(); this.discMat.dispose();
  }
  resize(w, h) {
    this.w = w; this.h = h;
    // A phone sees a corner of the floor up close rather than the whole of it too small to read; a drag slides across the rest.
    // Not so close that a room's pin ends up under the page's own controls; a pinch goes closer.
    if (!this.sized && !this.kept) { const phone = w <= 760; this.zoom = this.targetZoom = phone ? 1.3 : 1.25; const pz = phone ? 0 : -1.5; this.pan.set(0, pz); this.targetPan.set(0, pz); }
    this.sized = true;
    if (!this.insetNow) this.insetNow = { ...(this.insets || this.defaultInsets()) };
    this.applyInsets();
  }
  defaultInsets() {
    const phone = this.w <= 760;
    return phone ? { left: 0, right: 0, top: 58, bottom: this.h * 0.54 + 44 } : { left: 0, right: Math.min(430, this.w * 0.34), top: 76, bottom: 60 };
  }
  /** The part of the screen the room may use: the page says what its panels cover, and the room eases over to fit what is left. */
  setInsets(next) { this.insets = next; if (this.insetNow && this.intro < 1) { this.insetNow = { ...next }; this.applyInsets(); } }
  applyInsets() {
    const { w, h, insetNow: i } = this;
    this.visW = Math.max(120, w - i.left - i.right); this.visH = Math.max(120, h - i.top - i.bottom);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, (i.right - i.left) / 2, (i.bottom - i.top) / 2, w, h);
    this.camera.updateProjectionMatrix();
  }
  placeCamera(dist, px = 0, pz = 0) {
    const y = Math.sin(this.pitch) * dist, r = Math.cos(this.pitch) * dist;
    this.camera.position.set(px + Math.sin(this.yaw) * r, y, pz + Math.cos(this.yaw) * r);
    this.camera.lookAt(px, 0.8, pz + 0.3);
  }
  /** The closest camera distance at which every corner of the room lands inside the free area. Cached per angle. */
  fitDistance() {
    const key = `${this.yaw.toFixed(3)}|${this.visW.toFixed(0)}|${this.visH.toFixed(0)}`;
    if (key === this.fitKey) return this.fitValue;
    const cam = this.camera; const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const fx = tan * cam.aspect * (this.visW / this.w), fy = tan * (this.visH / this.h);
    const corners = [];
    const hx = ROOM_W / 2 + 0.6, hz = ROOM_D / 2 + 0.6;
    for (const x of [-hx, hx]) for (const z of [-hz, hz]) for (const y of [-1, WALL_H + 0.2]) corners.push(new THREE.Vector3(x, y, z));
    const v = new THREE.Vector3();
    const fits = (d) => {
      this.placeCamera(d); cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      return corners.every((c) => { v.copy(c).applyMatrix4(cam.matrixWorldInverse); const z = -v.z; return z > 0.5 && Math.abs(v.x) <= fx * z && Math.abs(v.y) <= fy * z; });
    };
    let lo = 10, hi = 240;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    this.fitKey = key; this.fitValue = hi;
    return hi;
  }
  /** In the tower: the screen the tags are placed against. */
  setSize(w, h) { this.w = w; this.h = h; }
  /**
   * Where a floor page's camera starts, relative to the room, on a screen this size: the tower flies its own camera here before it hands
   * the floor over, so the first frame of the floor page is the last frame of the flight. Worked out on a spare camera.
   */
  homePose(w, h, insets = null) {
    const keep = { camera: this.camera, w: this.w, h: this.h, insetNow: this.insetNow, visW: this.visW, visH: this.visH, fitKey: this.fitKey, fitValue: this.fitValue, yaw: this.yaw };
    const cam = new THREE.PerspectiveCamera(24, 1, 1, 3800);
    const phone = w <= 760, zoom = phone ? 1.3 : 1.25, pan = [0, phone ? 0 : -1.5];
    Object.assign(this, { camera: cam, w, h, yaw: 0.5, fitKey: null });
    this.insetNow = { ...(insets || this.defaultInsets()) }; this.applyInsets();
    this.placeCamera(this.fitDistance() / zoom, pan[0], pan[1]);
    cam.updateMatrixWorld();
    const pose = { position: cam.position.clone(), quaternion: cam.quaternion.clone(), fov: cam.fov, aspect: cam.aspect, view: { ...cam.view }, yaw: 0.5, zoom, pan, insets: { ...this.insetNow } };
    Object.assign(this, keep);
    return pose;
  }
  update(dt) {
    this.time += dt;
    // The light through the windows drifts a little, like clouds passing.
    const drift = Math.sin(this.time * 0.07);
    if (!this.host) {
      this.intro = Math.min(1, this.intro + dt / 1.35);
      this.easeInsets(dt);
      this.world.update(dt, this.time);
      const e = 1 - Math.pow(1 - this.intro, 3);
      const k = 1 - Math.exp(-dt * 6);
      this.yaw += (this.targetYaw - this.yaw) * k;
      this.zoom += (this.targetZoom - this.zoom) * k;
      this.pan.lerp(this.targetPan, k);
      // Fit the room to the free area at any aspect ratio, and let the intro pull back from close up.
      const dist = (this.fitDistance() / this.zoom) * (1.5 - 0.5 * e);
      this.camDist = dist;
      this.placeCamera(dist, this.pan.x, this.pan.y);
      this.sun.position.set(SUN_DIR.x + drift * 0.05, SUN_DIR.y, SUN_DIR.z + Math.cos(this.time * 0.05) * 0.04).multiplyScalar(SUN_FAR);
      this.sun.intensity = 2.5 + drift * 0.25;
    }
    // Scrolling screens read as real work.
    this.codeTex.offset.y = (this.time * 0.25) % 1;
    this.pageTex.offset.y = (this.time * 0.05) % 1;
    if (this.arcadeScreen) this.arcadeScreen.material.color.setHSL((this.time * 0.1) % 1, 0.7, 0.62);
    this.winMat.opacity = 0.3 + drift * 0.04;
    for (let i = 0; i < this.sway.length; i++) { const c = this.sway[i]; c.rotation.z = Math.sin(this.time * 0.9 + i * 2) * 0.035; c.rotation.x = Math.cos(this.time * 0.7 + i) * 0.025; }
    const sec = Math.floor(Date.now() / 1000);
    if (sec !== this.clockSec) { this.clockSec = sec; this.drawClock(this.clockTex.image.getContext('2d')); this.clockTex.needsUpdate = true; }
    this.life.update(dt);
    for (const a of this.actors.values()) { a.update(dt); this.placeTag(a); }
    // On a slow device the first furnishing pass can stall behind the frame loop; another pass picks it up.
    // Paced on the wall clock and one at a time, since a test or a slow frame can run room time far ahead of real time.
    const now = performance.now();
    if (this.modelsOn && !this.officeModels && !this.furnishing && now - (this.lastFurnish ?? now) > 8000) { this.lastFurnish = now; this.furnishOffices(); }
    this.lastFurnish ??= now;
    if (this.ring?.visible) { const a = this.actors.get(this.selected); if (!a) this.ring.visible = false; else { this.ring.position.set(a.group.position.x, 0.04, a.group.position.z); this.ring.scale.setScalar(1 + Math.sin(this.time * 4) * 0.06); } }
    // In the tower the labels of every floor in view are tidied together, by the tower.
    if (!this.host) { this.placePins(); tidyLabels(this.actors, this.w); }
    this.updatePet(dt);
  }
  easeInsets(dt) {
    const want = this.insets; if (!want || !this.insetNow) return;
    const now = this.insetNow, k = 1 - Math.exp(-dt * 7); let moved = false;
    for (const key of ['left', 'right', 'top', 'bottom']) {
      const d = want[key] - now[key];
      if (Math.abs(d) > 0.5) { now[key] += d * k; moved = true; } else if (d) { now[key] = want[key]; moved = true; }
    }
    if (moved) this.applyInsets();
  }
  /** Where the page's round pins float. Each one sits over the room it opens, above the glass so it stays off the people. */
  pinAnchors() {
    const L = this.plan; const top = 3.55;
    const over = (kind, id) => { const r = id ? (L.rooms || []).find((x) => x.id === id) : roomOfKind(L, kind); const [x, z] = r ? roomCentre(r) : [0, 0]; return [x, top, z]; };
    return { chat: over(null, 'manager'), requests: over(null, 'boss'), tasks: over('meeting'), talk: over('kitchen'), projects: over('lounge'), orders: [L.printer[0] + 0.3, 2.2, L.printer[1]] };
  }
  setPins(list) { this.pins = list; this.pinKey = ''; }
  /** Pins only move with the camera, so most frames leave the page alone. */
  placePins() {
    if (!this.pins.length) return;
    const key = `${this.yaw.toFixed(3)}|${this.zoom.toFixed(3)}|${this.pan.x.toFixed(3)}|${this.pan.y.toFixed(3)}|${this.intro.toFixed(2)}|${this.visW.toFixed(0)}|${this.visH.toFixed(0)}`;
    if (key === this.pinKey) return;
    this.pinKey = key;
    this.camera.updateMatrixWorld();
    for (const p of this.pins) {
      this.tv.set(p.at[0], p.at[1], p.at[2]).project(this.camera);
      const x = (this.tv.x * 0.5 + 0.5) * this.w, y = (-this.tv.y * 0.5 + 0.5) * this.h;
      p.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
  }
  placeTag(a) {
    const p = this.tv.copy(a.group.position); p.y += (a.char.labelY ?? HEAD_TOP * CHAR_SCALE) + 0.2;
    if (this.host) {
      // In the tower: the root stands at its floor's height, and a tag off the screen, or on a floor the tower has quietened, is put away.
      p.add(this.root.position).project(this.camera);
      const off = !this.tagsOn || p.z > 1 || Math.abs(p.x) > 1.25 || Math.abs(p.y) > 1.25;
      if (off !== !!a.tagOff) { a.tagOff = off; a.tag.style.visibility = off ? 'hidden' : ''; }
      if (off) { a.tagX = undefined; return; }
    } else p.project(this.camera);
    const x = (p.x * 0.5 + 0.5) * this.w, y = (-p.y * 0.5 + 0.5) * this.h;
    a.tagX = x; a.tagY = y;
    a.liftNow = (a.liftNow || 0) + ((a.lift || 0) - (a.liftNow || 0)) * 0.18;
    a.tag.style.transform = `translate(-50%,-100%) translate(${x.toFixed(1)}px,${(y - a.liftNow).toFixed(1)}px)`;
    // Nearer people keep their labels on top of farther ones.
    const z = Math.round((1 - p.z) * 5000);
    if (z !== a.tagZ) { a.tagZ = z; a.tag.style.zIndex = z; }
  }
  updatePet(dt) {
    if (!this.pet) return;
    const g = this.pet.group;
    const next = this.petPath[0];
    if (next) {
      const dx = next[0] - g.position.x, dz = next[1] - g.position.z, dist = Math.hypot(dx, dz);
      if (dist < 0.1) { this.petPath.shift(); return; }
      const step = Math.min(dist, this.petSpeed * dt);
      g.position.x += (dx / dist) * step; g.position.z += (dz / dist) * step; g.rotation.y = Math.atan2(dx, dz);
      g.position.y = Math.abs(Math.sin(this.time * 11)) * 0.05; this.pet.body.rotation.z = Math.sin(this.time * 11) * 0.06;
      this.pet.head.rotation.x = 0; this.pet.tail.rotation.z = Math.sin(this.time * 14) * 0.5;
      return;
    }
    this.petWait -= dt; g.position.y = 0; this.pet.body.rotation.z = 0;
    // Sitting: the head looks around, the tail flicks now and then.
    this.pet.head.rotation.y = Math.sin(this.time * 0.8) * 0.5; this.pet.head.rotation.x = Math.sin(this.time * 0.5) * 0.1;
    this.pet.tail.rotation.z = Math.sin(this.time * 3) * 0.2;
    if (this.petWait <= 0) {
      this.petWait = 3 + Math.random() * 7;
      // Off to somewhere open, around the furniture.
      const [x, z] = this.nav.freeNear((Math.random() - 0.5) * (ROOM_W - 3), (Math.random() - 0.5) * (ROOM_D - 2));
      this.petPath = this.nav.path(g.position.x, g.position.z, x, z);
    }
  }
}
