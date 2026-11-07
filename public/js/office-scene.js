// The cutaway office. Characters act out what the agents are really doing: every state here comes from the SSE stream.
// The whole static room bakes into a handful of vertex-coloured draw calls (see batch.js), the floor carries baked contact
// shadows and window light, and each person is seven or so calls, so a busy floor still runs well on a phone.
import * as THREE from '../vendor/three/three.module.min.js';
import { Character, HEAD_TOP } from './character.js';
import { stage } from './stage.js';
import { mergeColored } from './batch.js';
import { getWorld, makeTower, GROUND, FLOOR_H, TOWER_W } from './lobby-scene.js';

const ROOM_W = 22, ROOM_D = 13.6, WALL_H = 4.6;
const DESKS = [[-6.6, 0.6], [-2.2, 0.6], [2.2, 0.6], [6.6, 0.6], [-6.6, 4.5], [-2.2, 4.5], [2.2, 4.5], [6.6, 4.5]];
const MANAGER_DESK = [-6.9, -3.9], BOSS_DESK = [7.0, -3.9];
const BOARD = [-0.4, -6.25];
const MEET = { x0: -3.4, x1: 2.6, z0: -6.8, z1: -3.0, table: [-0.4, -4.75] };
const SHELF = [-10.3, 2.4], COFFEE = [10.2, 1.7], FRIDGE = [10.2, -1.5], ARCADE = [-9.8, 6.0], SOFA = [6.9, 5.1], PRINTER = [-9.9, 4.5];
const CELL = 0.5;
const HOLD = 0.7;  // seconds each character state stays on stage before the next one shows
const CHAR_SCALE = 1.45;
const WORLD_SCALE = ROOM_W / TOWER_W;  // the room is one tower floor, blown up to walk around in
const SUN_DIR = new THREE.Vector3(0.78, 0.58, -0.26).normalize();

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
  c.width = c.height = 512;
  x.fillStyle = '#9a9894'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 6000; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.05})`; x.fillRect(r() * 512, r() * 512, 3, 3); }
  for (let i = 0; i < 6; i++) { x.strokeStyle = 'rgba(60,60,60,.08)'; x.lineWidth = 1; x.beginPath(); x.moveTo(r() * 512, r() * 512); x.lineTo(r() * 512, r() * 512); x.stroke(); }
  x.strokeStyle = 'rgba(40,40,40,.25)'; x.lineWidth = 3; x.strokeRect(1, 1, 510, 510);
  return { c, across: 3 };
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

function makeNav() {
  const cols = Math.round(ROOM_W / CELL), rows = Math.round(ROOM_D / CELL);
  const blocked = new Uint8Array(cols * rows);
  const toCell = (x, z) => [Math.max(0, Math.min(cols - 1, Math.floor((x + ROOM_W / 2) / CELL))), Math.max(0, Math.min(rows - 1, Math.floor((z + ROOM_D / 2) / CELL)))];
  const toWorld = (cx, cz) => [(cx + 0.5) * CELL - ROOM_W / 2, (cz + 0.5) * CELL - ROOM_D / 2];
  const footprints = [];
  const block = (x, z, w, d, { bake = true } = {}) => {
    const [a, b] = toCell(x - w / 2, z - d / 2), [c, e] = toCell(x + w / 2, z + d / 2);
    for (let i = a; i <= c; i++) for (let j = b; j <= e; j++) blocked[j * cols + i] = 1;
    if (bake) footprints.push([x, z, w, d]);
  };
  // True when the straight line between two points crosses no furniture.
  const clear = (a, b) => { const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL * 0.5)); for (let i = 1; i < steps; i++) { const t = i / steps; const [cx, cz] = toCell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); if (blocked[cz * cols + cx]) return false; } return true; };
  const path = (fx, fz, tx, tz) => {
    const [sx, sz] = toCell(fx, fz), [gx, gz] = toCell(tx, tz);
    const start = sz * cols + sx, goal = gz * cols + gx;
    const prev = new Int32Array(cols * rows).fill(-1); prev[start] = start;
    const q = [start];
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      if (cur === goal) break;
      const cx = cur % cols, cz = (cur / cols) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const n = nz * cols + nx;
        if (prev[n] !== -1) continue;
        // Goals may sit inside furniture (a chair), but paths never cut corners through it.
        if (blocked[n] && n !== goal) continue;
        if (dx && dz && (blocked[cz * cols + nx] || blocked[nz * cols + cx])) continue;
        prev[n] = cur; q.push(n);
      }
    }
    if (prev[goal] === -1) return [[tx, tz]];
    const out = [];
    for (let c = goal; c !== start; c = prev[c]) out.push(toWorld(c % cols, (c / cols) | 0));
    out.reverse();
    // String-pulling: keep only the corners that matter.
    const smooth = []; let anchor = [fx, fz];
    for (let i = 0; i < out.length; i++) {
      const next = out[i + 1];
      if (!next || !clear(anchor, next)) { smooth.push(out[i]); anchor = out[i]; }
    }
    if (smooth.length) smooth[smooth.length - 1] = [tx, tz]; else smooth.push([tx, tz]);
    return smooth;
  };
  return { block, path, clear, footprints };
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

function makeDesk(parent, detail, x, z, chairColor, brand, accent, { big = false, seed = 1 } = {}) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  const dg = new THREE.Group(); dg.position.set(x, 0, z); detail.add(dg);
  const r = seeded(seed * 31 + 5);
  const W = big ? 3 : 2.3, D = big ? 1.4 : 1.1;
  const top = big ? '#6e4a33' : '#dcc7a7';
  piece(g, top, W, 0.08, D, 0, 0.94, -0.2);
  piece(g, shadeHex(top, 0.8), W, 0.03, D + 0.02, 0, 0.91, -0.2, { cast: false });
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) piece(g, '#3d3b44', 0.07, 0.91, 0.07, lx * (W / 2 - 0.12), 0, -0.2 + lz * (D / 2 - 0.12));
  piece(g, '#3d3b44', W - 0.3, 0.05, 0.05, 0, 0.3, -0.2 - D / 2 + 0.12, { cast: false });
  // Monitor, keyboard, mouse.
  piece(g, '#25262d', 0.3, 0.03, 0.2, 0, 1.02, -0.52, { cast: false });
  piece(g, '#25262d', 0.1, 0.28, 0.08, 0, 1.03, -0.55);
  piece(g, '#2a2b33', 1.1, 0.74, 0.06, 0, 1.24, -0.58);
  const screenMat = new THREE.MeshBasicMaterial({ color: '#1a2030' });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.64), screenMat);
  screen.position.set(0, 1.61, -0.545); g.add(screen);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), new THREE.MeshBasicMaterial({ map: parent.userData.glowTex, color: '#000000', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.set(0, 1.56, -0.61); glow.visible = false; glow.userData.keep = true; g.add(glow);
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.05), new THREE.MeshBasicMaterial({ color: accent }));
  bar.position.set(-0.5, 1.315, -0.54); bar.scale.x = 0.0001; bar.visible = false; bar.userData.keep = true; g.add(bar);
  piece(g, '#e9e4d8', 0.74, 0.03, 0.25, 0, 1.02, 0.18);
  piece(g, '#2a2b33', 0.68, 0.012, 0.19, 0, 1.05, 0.18, { cast: false });
  piece(g, '#ece6d8', 0.12, 0.04, 0.18, 0.55, 1.02, 0.2, { geo: sph, cast: false });
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
  makeChair(g, 0, 0.84, chairColor, { big });
  return { group: g, screenMat, glow, bar, seat: [x, z + 0.84] };
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

function buildPet(kind) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
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
    this.pos = new THREE.Vector3(seat.at[0], 0, seat.at[1]);
    this.group = this.char.group;
    this.group.position.copy(this.pos);
    this.heading = Math.PI; this.path = []; this.speed = 0; this.queue = []; this.action = null; this.seated = true; this.state = 'idle'; this.lastShelf = -99; this.idleTimer = 6 + Math.random() * 16; this.progress = 0;
    this.shadow = new THREE.Mesh(view.discGeo, view.discMat); this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.02; this.shadow.scale.setScalar(1.6);
    view.scene.add(this.shadow);
    view.scene.add(this.group);
    this.sitDown();
    this.tag = document.createElement('div'); this.tag.className = 'char-tag';
    this.tag.dataset.side = view.actors.size % 2 ? 'left' : 'right';  // bubbles alternate sides, so a huddle stays readable
    this.nameEl = document.createElement('span'); this.nameEl.className = 'char-name'; this.nameEl.textContent = info.name;
    this.bubble = document.createElement('span'); this.bubble.className = 'char-bubble'; this.bubble.hidden = true;
    this.tag.append(this.bubble, this.nameEl);
    view.labels.append(this.tag);
  }
  destroy() { this.char.dispose(); this.shadow.removeFromParent(); this.tag.remove(); }
  sitDown() {
    this.seated = true;
    // Hips land on the seat cushion; the legs hang in front of the chair.
    this.group.position.set(this.seat.at[0], 0.65 - 0.365 * CHAR_SCALE, this.seat.at[1] - 0.06);
    this.heading = Math.PI; this.group.rotation.y = this.heading;
    this.applyStatePose();
  }
  goTo(x, z, then) {
    this.seated = false;
    this.group.position.y = 0;
    this.path = this.view.nav.path(this.group.position.x, this.group.position.z, x, z);
    this.afterWalk = then;
    this.char.setAnim('walk');
  }
  /** Do these steps in order, unless a newer real event interrupts them. */
  perform(steps) { this.queue = [...steps]; this.action = null; this.path = []; this.afterWalk = null; this.next(); }
  next() {
    const s = this.queue.shift();
    this.action = s || null;
    if (!s) { this.settle(); return; }
    if (s.walk) this.goTo(s.walk[0], s.walk[1], () => this.next());
    else { this.char.setAnim(s.anim || 'stand'); this.holdUntil = this.view.time + (s.hold || 1); if (s.face !== undefined) this.faceTo = s.face; if (s.paper !== undefined) this.char.paper.visible = s.paper; }
  }
  settle() {
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
      if (this.seat.bar) this.seat.bar.visible = s === 'typing' || s === 'browsing';
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
    if (state === 'idle') this.progress = 0;
    this.applyStatePose();
    // Reading sometimes means a trip to the bookshelf.
    if (state === 'reading' && this.view.time - this.lastShelf > 25 && this.seated && !this.action && !this.isManager) {
      this.lastShelf = this.view.time;
      this.perform([{ walk: [SHELF[0] + 1.0, SHELF[1] + (Math.random() - 0.5) * 2] }, { anim: 'listen', hold: 1.8, face: -Math.PI / 2 }]);
    }
  }
  renderBubble() {
    const busy = this.state !== 'idle';
    const text = this.activity ? this.activity.slice(0, 40) : '';
    this.bubble.hidden = !busy;
    if (busy) {
      if (this.bubble.dataset.text !== text || this.bubble.dataset.state !== this.state) {
        this.bubble.dataset.text = text; this.bubble.dataset.state = this.state;
        const dots = document.createElement('i'); dots.className = 'dots'; dots.append(document.createElement('b'), document.createElement('b'), document.createElement('b'));
        const label = document.createElement('span'); label.textContent = this.state === 'queued' ? 'Waiting for a line' : text || 'Thinking';
        this.bubble.replaceChildren(dots, label);
      }
    }
  }
  /** Off the clock: a small errand now and then, so an idle floor still feels alive. Nothing here pretends to be work. */
  idleErrand() {
    const d = this.view.decor;
    const options = [];
    if (d.coffee) options.push([{ walk: [COFFEE[0] - 1.0, COFFEE[1] + (Math.random() - 0.5) * 1.6] }, { anim: 'sip', hold: 3.5 + Math.random() * 2, face: Math.PI / 2 }]);
    if (d.arcade) options.push([{ walk: [ARCADE[0] + 1.0, ARCADE[1]] }, { anim: 'phone', hold: 3, face: -Math.PI / 2 }]);
    const plant = this.view.plantSpots[Math.floor(Math.random() * this.view.plantSpots.length)];
    if (plant) options.push([{ walk: [plant[0] + plant[2], plant[1] + plant[3]] }, { anim: 'pour', hold: 3, face: Math.atan2(-plant[2], -plant[3]) }]);
    options.push([{ walk: [SHELF[0] + 1.0, SHELF[1] + (Math.random() - 0.5) * 1.5] }, { anim: 'listen', hold: 2.5, face: -Math.PI / 2 }]);
    options.push([{ walk: [this.view.lounge ? SOFA[0] - 2.9 : 0.5, this.view.lounge ? SOFA[1] + 0.2 : -2.3] }, { anim: 'phone', hold: 3.5, face: this.view.lounge ? Math.PI / 2 : 0 }]);
    options.push([{ anim: 'stretch', hold: 2.6 }]);
    options.push([{ anim: 'stretch', hold: 2.2 }]);
    this.perform(options[Math.floor(Math.random() * options.length)]);
  }
  update(dt) {
    const g = this.group, time = this.view.time, wall = performance.now() / 1000;
    if (this.pending?.length && wall - this.stateSince >= HOLD) { const [st, ac] = this.pending.shift(); if (!this.pending.length) this.pending = null; this.stateSince = wall; this.applyState(st, ac); }
    let moving = 0;
    if (this.path.length) {
      const [tx, tz] = this.path[0];
      const dx = tx - g.position.x, dz = tz - g.position.z, d = Math.hypot(dx, dz);
      const v = 2.6;
      if (d < 0.06) { this.path.shift(); if (!this.path.length) { const f = this.afterWalk; this.afterWalk = null; this.char.setAnim('stand'); f?.(); } } else {
        const step = Math.min(d, v * dt);
        g.position.x += (dx / d) * step; g.position.z += (dz / d) * step;
        this.faceTo = Math.atan2(dx, dz);
        moving = 1;
      }
    } else if (this.action && !this.action.walk && time > this.holdUntil) {
      this.next();
    } else if (!this.action && this.seated && this.state === 'idle' && !this.isBossAway) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) { this.idleTimer = 20 + Math.random() * 40; this.idleErrand(); }
    }
    if (this.seated) this.faceTo = Math.PI;
    if (this.faceTo !== undefined) {
      let diff = this.faceTo - g.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.rotation.y += diff * Math.min(1, dt * 10);
    }
    // The screen's progress bar fills while real work streams in, and resets when the agent goes idle.
    if (this.seat.bar && this.seat.bar.visible) { this.progress = Math.min(1, this.progress + dt / 24); this.seat.bar.scale.x = Math.max(0.0001, this.progress); this.seat.bar.position.x = -0.5 + this.progress / 2; }
    this.shadow.position.set(g.position.x, 0.02, g.position.z);
    this.char.update(dt, moving);
  }
}

export class OfficeView {
  constructor({ state, labels, onSelect }) {
    this.labels = labels; this.onSelect = onSelect;
    this.colors = state.floor.colors; this.decor = state.floor.decor;
    this.staffCount = state.agents.filter((a) => a.role !== 'manager').length;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2('#c9d8e4', 0.0024 / WORLD_SCALE);
    this.grade = { vignette: 0.24, grain: 0.018 };
    this.floorNumber = state.floor.number;
    this.camera = new THREE.PerspectiveCamera(24, 1, 1, 2600);
    this.time = 0; this.yaw = 0.5; this.targetYaw = 0.5; this.pitch = 0.86; this.zoom = 1; this.targetZoom = 1; this.intro = 0;
    this.actors = new Map(); this.nav = makeNav(); this.deskSlots = []; this.plantSpots = []; this.sway = [];
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
    this.buildWorld();
    this.syncAgents(state);
    this.bind();
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
    const s = this.scene; const { primary, accent } = this.colors; const d = this.decor;
    s.add(new THREE.HemisphereLight('#dbe8f7', '#bfae98', 1.25));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.5);
    sun.position.copy(SUN_DIR).multiplyScalar(44); sun.target.position.set(0, 0, 0);
    const size = stage.q?.shadow || 0;
    sun.castShadow = size > 0;
    sun.shadow.mapSize.set(size || 512, size || 512);
    Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 17, bottom: -17, near: 4, far: 100 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.035;
    this.sun = sun;
    s.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#e8f0ff', 0.32); fill.position.set(-12, 9, 16); s.add(fill);
    const env = getWorld().environment();
    const room = new THREE.Group(); s.add(room); this.room = room; room.userData.glowTex = this.glowTex;
    const detail = new THREE.Group(); s.add(detail); this.detail = detail; detail.visible = this.detailOn;
    const wallZ = -ROOM_D / 2, wallX = -ROOM_W / 2;
    const block = (x, z, w, dd, o) => this.nav.block(x, z, w, dd, o);

    // The floor plate is the top of the tower: a stone slab the size of the shaft, with a glass rail around the terrace left over.
    const plate = TOWER_W * WORLD_SCALE + 1.2;
    piece(room, '#e9dfcf', plate, 0.42, plate, 0, -0.48, 0);
    piece(room, '#d4c8b6', plate + 0.3, 0.12, plate + 0.3, 0, -0.6, 0, { cast: false });
    piece(room, '#d9d0c0', ROOM_W + 1.1, 0.05, ROOM_D + 1.1, 0, -0.08, 0, { recv: true, cast: false });
    piece(room, primary, ROOM_W + 0.9, 0.012, ROOM_D + 0.9, 0, -0.022, 0, { recv: false, cast: false });
    const rail = new THREE.MeshStandardMaterial({ color: '#cfe0ec', roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.4, depthWrite: false, envMap: env });
    for (const [x, z, w, dd] of [[0, plate / 2, plate, 0.06], [0, -plate / 2, plate, 0.06], [plate / 2, 0, 0.06, plate], [-plate / 2, 0, 0.06, plate]]) piece(room, null, w, 1.0, dd, x, 0, z, { cast: false, mat: rail });
    for (const [x, z] of [[-plate / 2 + 1.4, plate / 2 - 1.2], [plate / 2 - 1.4, plate / 2 - 1.2], [plate / 2 - 1.4, -plate / 2 + 1.2], [-plate / 2 + 1.4, -plate / 2 + 1.2]]) { piece(room, '#b9b0a2', 1.6, 0.5, 1.0, x, 0, z); piece(room, '#6c9452', 1.4, 0.45, 0.8, x, 0.5, z); }
    this.floorMat = new THREE.MeshStandardMaterial({ roughness: d.floor === 'carpet' ? 0.95 : 0.6, metalness: 0 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), this.floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.userData.keep = true; room.add(floor);
    this.floorTile = floorTile(d.floor);

    // Walls: the back one with two big windows looking over the city, the left one solid. A skirting board below and a cornice
    // above, both a shade off the wall colour, and a baked gradient so the walls read as lit from the windows.
    const wall = d.wall, wallDark = shadeHex(wall, 0.9), skirt = mix(wall, '#2a2a30', 0.72), trim = mix(wall, '#ffffff', 0.55);
    const wshade = [0, WALL_H, 0.84, 1.02];
    const backParts = [[-ROOM_W / 2, -7.6], [-3.1, 3.5], [8.7, ROOM_W / 2]];
    for (const [a, b] of backParts) piece(room, wall, b - a, WALL_H, 0.3, (a + b) / 2, 0, wallZ - 0.15, { shade: wshade });
    const winMat = new THREE.MeshStandardMaterial({ color: '#a9c8dd', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.3, depthWrite: false, envMapIntensity: 1.2, envMap: env });
    this.winMat = winMat;
    for (const [a, b] of [[-7.6, -3.1], [3.5, 8.7]]) {
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

    // The glass meeting room around the whiteboard: thin dark frame, tinted panes, a long table.
    const glass = new THREE.MeshStandardMaterial({ color: mix(primary, '#dfeaf2', 0.7), roughness: 0.04, metalness: 0.15, transparent: true, opacity: 0.2, depthWrite: false, envMap: env, side: THREE.DoubleSide });
    const GH = 3.1;
    const pane = (x, z, w, dd) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w || dd, GH - 0.2), glass); m.position.set(x, 0.1 + (GH - 0.2) / 2, z); if (!w) m.rotation.y = Math.PI / 2; m.userData.keep = true; room.add(m); };
    const frame = '#2b2d35';
    for (const x of [MEET.x0, MEET.x1]) {
      pane(x, (MEET.z0 + MEET.z1) / 2, 0, MEET.z1 - MEET.z0);
      piece(room, frame, 0.08, GH, 0.08, x, 0, MEET.z1, { cast: false }); piece(room, frame, 0.08, 0.1, MEET.z1 - MEET.z0, x, GH - 0.1, (MEET.z0 + MEET.z1) / 2, { cast: false });
      piece(room, frame, 0.1, 0.1, MEET.z1 - MEET.z0, x, 0, (MEET.z0 + MEET.z1) / 2, { cast: false });
      piece(room, '#f3f1ea', 0.02, 0.1, MEET.z1 - MEET.z0, x, 1.25, (MEET.z0 + MEET.z1) / 2, { cast: false, mat: new THREE.MeshBasicMaterial({ color: '#eef1f4', transparent: true, opacity: 0.55, depthWrite: false }) }).userData.keep = true;
      block(x, (MEET.z0 + MEET.z1) / 2, 0.3, MEET.z1 - MEET.z0, { bake: false });
    }
    for (const [a, b] of [[MEET.x0, -1.6], [0.8, MEET.x1]]) {
      pane((a + b) / 2, MEET.z1, b - a, 0);
      piece(room, frame, b - a, 0.1, 0.08, (a + b) / 2, GH - 0.1, MEET.z1, { cast: false }); piece(room, frame, b - a, 0.1, 0.1, (a + b) / 2, 0, MEET.z1, { cast: false });
      piece(room, frame, 0.08, GH, 0.08, a === MEET.x0 ? b : a, 0, MEET.z1, { cast: false });
      piece(room, '#f3f1ea', b - a, 0.1, 0.02, (a + b) / 2, 1.25, MEET.z1, { cast: false, mat: new THREE.MeshBasicMaterial({ color: '#eef1f4', transparent: true, opacity: 0.55, depthWrite: false }) }).userData.keep = true;
      block((a + b) / 2, MEET.z1, b - a, 0.3, { bake: false });
    }
    piece(room, frame, MEET.x1 - MEET.x0, 0.1, 0.08, (MEET.x0 + MEET.x1) / 2, GH - 0.1, MEET.z1, { cast: false });
    piece(room, mix(primary, '#5a5a66', 0.55), MEET.x1 - MEET.x0 - 0.6, 0.02, MEET.z1 - MEET.z0 - 0.5, MEET.table[0], 0, MEET.table[1] + 0.2, { cast: false });
    const [tx, tz] = MEET.table;
    piece(room, '#efe6d6', 3.2, 0.08, 1.1, tx, 0.86, tz); piece(room, '#cdbfa6', 3.2, 0.04, 1.1, tx, 0.82, tz, { cast: false });
    piece(room, '#3d3b44', 0.14, 0.82, 0.8, tx - 1.3, 0, tz); piece(room, '#3d3b44', 0.14, 0.82, 0.8, tx + 1.3, 0, tz);
    piece(detail, '#2a2b33', 0.42, 0.03, 0.3, tx + 0.2, 0.94, tz, { cast: false }); piece(detail, '#f6f3ea', 0.3, 0.012, 0.4, tx - 0.9, 0.94, tz + 0.1, { cast: false, ry: 0.2 });
    piece(detail, '#2c2c33', 0.1, 0.06, 0.1, tx - 0.2, 0.94, tz - 0.3, { geo: cyl, cast: false }); piece(detail, accent, 0.12, 0.13, 0.12, tx + 1.1, 0.94, tz + 0.25, { geo: cyl, cast: false });
    block(tx, tz, 3.4, 1.3);
    // Chairs at the ends and pushed in at the front: they sit inside the table's footprint, so the aisles stay open.
    for (const [cx, cz, ry] of [[tx - 2.05, tz, Math.PI / 2], [tx + 2.05, tz, -Math.PI / 2], [tx - 1.0, tz + 0.8, Math.PI], [tx + 0.8, tz + 0.8, Math.PI]]) { makeChair(room, cx, cz, primary, { ry }); this.nav.footprints.push([cx, cz, 0.6, 0.6]); }

    // Whiteboard, where plans get made.
    const boardMat = new THREE.MeshBasicMaterial({ map: this.boardTexture([]) });
    this.boardMat = boardMat;
    piece(room, '#c9c4b8', 4.6, 2.3, 0.08, BOARD[0], 1.2, wallZ + 0.06);
    const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.12), boardMat); boardFace.position.set(BOARD[0], 2.33, wallZ + 0.11); boardFace.userData.keep = true; room.add(boardFace);
    piece(room, '#8f8a7e', 4.6, 0.05, 0.22, BOARD[0], 1.2, wallZ + 0.16, { cast: false });
    piece(detail, '#d9443a', 0.12, 0.03, 0.03, BOARD[0] - 1.1, 1.25, wallZ + 0.2, { cast: false }); piece(detail, '#2a60c0', 0.12, 0.03, 0.03, BOARD[0] - 0.9, 1.25, wallZ + 0.2, { cast: false });
    block(BOARD[0], wallZ + 0.12, 4.6, 0.2, { bake: false });

    // Wall clock, showing the real time.
    this.clockTex = canvasTex(128, 128, (x) => this.drawClock(x));
    piece(room, '#2b2d35', 0.92, 0.06, 0.92, -9.3, 3.37, wallZ + 0.03, { geo: cyl, cast: false }).rotation.x = Math.PI / 2;
    const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ map: this.clockTex })); clockFace.position.set(-9.3, 3.4, wallZ + 0.07); clockFace.userData.keep = true; room.add(clockFace);

    // Neon company sign, over a low console with a plant: the reception wall.
    if (d.neon) {
      const sign = canvasTex(1024, 180, (x, w, h) => { x.clearRect(0, 0, w, h); });
      this.signTex = sign;
      piece(room, '#23212f', 0.06, 1.3, 7.2, wallX + 0.03, 2.7, -2.3, { cast: false });
      piece(room, accent, 0.07, 0.04, 6.4, wallX + 0.04, 2.78, -2.3, { cast: false, mat: new THREE.MeshBasicMaterial({ color: accent }) }).userData.keep = true;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 1.19), new THREE.MeshBasicMaterial({ map: sign, transparent: true, depthWrite: false }));
      m.position.set(wallX + 0.08, 3.35, -2.3); m.rotation.y = Math.PI / 2; m.userData.keep = true;
      room.add(m); this.signMesh = m;
    }
    piece(room, '#4a3526', 0.5, 0.8, 2.4, wallX + 0.3, 0, -2.3); piece(room, '#5e4434', 0.56, 0.05, 2.5, wallX + 0.3, 0.8, -2.3, { cast: false });
    piece(detail, '#f3ead8', 0.3, 0.26, 0.3, wallX + 0.3, 0.85, -1.5, { geo: cyl, cast: false }); piece(detail, '#2a2b33', 0.26, 0.26, 0.2, wallX + 0.3, 0.85, -3.0, { cast: false });
    block(wallX + 0.3, -2.3, 0.7, 2.6);
    // Art on the side wall.
    if (d.art) {
      const art = canvasTex(256, 320, (x, w, h) => {
        x.fillStyle = '#f4ecdc'; x.fillRect(0, 0, w, h);
        x.fillStyle = primary; x.beginPath(); x.arc(w * 0.42, h * 0.42, 74, 0, 7); x.fill();
        x.fillStyle = accent; x.fillRect(w * 0.3, h * 0.55, w * 0.5, h * 0.24);
        x.strokeStyle = '#22242c'; x.lineWidth = 7; x.beginPath(); x.moveTo(30, h - 50); x.bezierCurveTo(90, h - 120, 140, h - 10, w - 30, h - 80); x.stroke();
      });
      const art2 = canvasTex(256, 200, (x, w, h) => {
        x.fillStyle = '#1f2230'; x.fillRect(0, 0, w, h);
        for (let i = 0; i < 9; i++) { x.fillStyle = i % 2 ? accent : primary; x.globalAlpha = 0.5 + (i % 3) * 0.2; x.fillRect(20 + i * 24, h - 30 - (30 + ((i * 37) % 90)), 16, 30 + ((i * 37) % 90)); }
        x.globalAlpha = 1; x.strokeStyle = '#f4ecdc'; x.lineWidth = 3; x.strokeRect(10, 10, w - 20, h - 20);
      });
      const frame = (z, y, tex, w, hh) => { piece(room, '#2c2a31', 0.08, hh + 0.16, w + 0.16, wallX + 0.03, y - hh / 2 - 0.08, z); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshLambertMaterial({ map: tex })); m.position.set(wallX + 0.08, y, z); m.rotation.y = Math.PI / 2; m.userData.keep = true; room.add(m); };
      frame(4.9, 2.5, art, 1.4, 1.75); frame(-5.6, 2.6, art2, 1.5, 1.15);
    }
    // Bookshelf.
    const shelf = new THREE.Group(); shelf.position.set(SHELF[0], 0, SHELF[1]); room.add(shelf);
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
    block(SHELF[0], SHELF[1], 0.9, 2.8);
    // The kitchen corner: counter with sink and coffee machine, a fridge and a tall cupboard on the open side.
    if (d.coffee) {
      const c = new THREE.Group(); c.position.set(COFFEE[0], 0, COFFEE[1]); room.add(c);
      const cd = new THREE.Group(); cd.position.set(COFFEE[0], 0, COFFEE[1]); detail.add(cd);
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
      block(COFFEE[0], COFFEE[1], 1.2, 3.8);
      const f = new THREE.Group(); f.position.set(FRIDGE[0], 0, FRIDGE[1]); room.add(f);
      piece(f, '#d9dde2', 0.95, 2.0, 0.9, 0, 0, 0); piece(f, '#c3c8ce', 0.02, 1.9, 0.86, -0.48, 0.05, 0, { cast: false }); piece(f, '#c3c8ce', 0.03, 0.02, 0.86, -0.49, 0.72, 0, { cast: false });
      piece(f, '#8e949c', 0.04, 0.5, 0.04, -0.5, 1.0, 0.33, { cast: false }); piece(f, '#8e949c', 0.04, 0.3, 0.04, -0.5, 0.3, 0.33, { cast: false });
      piece(detail, '#f4c95d', 0.16, 0.16, 0.01, FRIDGE[0] - 0.5, 1.5, FRIDGE[1] - 0.2, { cast: false }); piece(detail, '#7ad1f0', 0.12, 0.14, 0.01, FRIDGE[0] - 0.5, 1.2, FRIDGE[1] + 0.1, { cast: false });
      piece(f, '#5e4436', 0.95, 2.0, 0.9, 0, 0, 1.0); piece(f, '#4a3528', 0.02, 1.9, 0.86, -0.48, 0.05, 1.0, { cast: false }); piece(f, '#d8c6a8', 0.03, 0.3, 0.03, -0.49, 0.9, 1.0, { cast: false });
      block(FRIDGE[0], FRIDGE[1] + 0.5, 1.1, 2.0);
    }
    if (d.arcade) {
      const a = new THREE.Group(); a.position.set(ARCADE[0], 0, ARCADE[1]); room.add(a);
      piece(a, accent, 0.9, 2.2, 1.0, 0, 0, 0); piece(a, shadeHex(accent, 0.8), 0.92, 0.3, 1.02, 0, 1.9, 0);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.62), new THREE.MeshBasicMaterial({ color: '#58f3c8' })); scr.position.set(0.46, 1.62, 0); scr.rotation.y = Math.PI / 2; scr.userData.keep = true; a.add(scr);
      piece(a, '#222228', 0.42, 0.06, 0.84, 0.52, 1.05, 0); piece(a, '#d9443a', 0.08, 0.1, 0.08, 0.6, 1.11, 0.2, { geo: cyl, cast: false }); piece(a, '#2a60c0', 0.08, 0.1, 0.08, 0.6, 1.11, -0.2, { geo: cyl, cast: false });
      this.arcadeScreen = scr;
      block(ARCADE[0], ARCADE[1], 1.1, 1.2);
    }
    if (d.rug) {
      const rug = (x, z, w, dd, c, t) => piece(room, c, w, t, dd, x, 0, z, { cast: false });
      rug(BOSS_DESK[0], BOSS_DESK[1] + 0.6, 5, 3.6, primary, 0.03);
      rug(BOSS_DESK[0], BOSS_DESK[1] + 0.6, 4.6, 3.2, accent, 0.045);
      rug(BOSS_DESK[0], BOSS_DESK[1] + 0.6, 4.3, 2.9, primary, 0.06);
    }
    // A lounge in the front corner, until a full staff needs that desk.
    if (this.staffCount < 8) {
      this.lounge = true;
      const l = new THREE.Group(); l.position.set(SOFA[0], 0, SOFA[1]); room.add(l);
      const ld = new THREE.Group(); ld.position.set(SOFA[0], 0, SOFA[1]); detail.add(ld);
      if (d.rug) { piece(l, mix(accent, '#ffffff', 0.25), 5.6, 0.03, 3.4, 0, 0, -0.1, { cast: false }); piece(l, mix(primary, '#ffffff', 0.55), 5.0, 0.04, 2.8, 0, 0, -0.1, { cast: false }); }
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
      block(SOFA[0], SOFA[1] + 0.6, 4.4, 2.0); block(SOFA[0], SOFA[1] - 0.6, 1.8, 1.0); block(SOFA[0] + 2.4, SOFA[1] - 0.6, 0.6, 0.6);
    }
    // Printer, in the front-left corner.
    const pr = new THREE.Group(); pr.position.set(PRINTER[0], 0, PRINTER[1]); room.add(pr);
    piece(pr, '#5e5a64', 1.0, 0.75, 1.0, 0, 0, 0); piece(pr, '#e8e4da', 0.92, 0.3, 0.92, 0, 0.75, 0); piece(pr, '#cfcac0', 0.6, 0.06, 0.5, 0.3, 1.05, 0, { cast: false });
    piece(pr, '#fbf7ea', 0.5, 0.04, 0.6, -0.1, 1.05, 0, { cast: false }); piece(pr, '#f3f0e6', 0.4, 0.2, 0.3, 0.2, 0.75, 0.5, { cast: false });
    piece(pr, '#4ad17a', 0.05, 0.03, 0.05, -0.35, 1.05, 0.3, { cast: false, mat: new THREE.MeshBasicMaterial({ color: '#4ad17a' }) }).userData.keep = true;
    block(PRINTER[0], PRINTER[1], 1.2, 1.2);
    // Plants, in a stable order so more means more. Two of them sway a little.
    const spots = [[-10.1, -6.0, 0.8, 0.8], [10.2, -5.9, -0.8, 0.9], [-4.0, -2.5, 0.9, 0.6], [3.4, -2.5, -0.9, 0.6], [10.3, 5.9, -0.9, -0.6], [-4.4, 6.2, 0, -0.9], [-0.2, 6.2, 0, -0.9], [-10.2, -0.3, 0.9, 0]];
    for (let i = 0; i < d.plants; i++) {
      const [x, z] = spots[i];
      const p = makePlant(room, x, z, i % 3, i < 2 ? 1.3 : 1);
      if (i < 2) { mergeColored(p.canopy, ROOM_MAT); p.canopy.children.forEach((m) => { m.userData.keep = true; }); this.sway.push(p.canopy); }
      block(x, z, 0.8, 0.8); this.plantSpots.push(spots[i]);
    }

    // Desks.
    const mgr = makeDesk(room, detail, MANAGER_DESK[0], MANAGER_DESK[1], primary, primary, accent, { big: true, seed: 2 });
    block(MANAGER_DESK[0], MANAGER_DESK[1] - 0.2, 3.2, 1.6);
    this.managerSeat = { at: mgr.seat, screenMat: mgr.screenMat, glow: mgr.glow, bar: mgr.bar };
    const bossDesk = makeDesk(room, detail, BOSS_DESK[0], BOSS_DESK[1], primary, primary, accent, { big: true, seed: 3 });
    block(BOSS_DESK[0], BOSS_DESK[1] - 0.2, 3.2, 1.6);
    this.bossSeat = { at: bossDesk.seat, screenMat: bossDesk.screenMat, glow: bossDesk.glow, bar: bossDesk.bar };
    piece(detail, '#e9b949', 0.8, 0.14, 0.2, BOSS_DESK[0] + 0.85, 1.02, BOSS_DESK[1] + 0.2);
    for (const [x, z] of DESKS) this.deskSlots.push({ x, z, desk: null });
    // Pet.
    if (d.pet !== 'none') {
      this.pet = buildPet(d.pet);
      this.pet.group.position.set(2, 0, -1.6);
      s.add(this.pet.group); this.petTarget = [2, -1.6]; this.petWait = 3;
    }
    mergeColored(room, ROOM_MAT); mergeColored(detail, ROOM_MAT);
  }
  /** The floor is one big texture: the tiles, a darker rim along the walls, soft contact shadows under every piece of furniture
   *  and warm pools of light in front of the windows. It costs nothing per frame, so the low tier gets grounded furniture too. */
  bakeFloor() {
    const W = 1024, H = 640; const { c: tile, across } = this.floorTile;
    const old = this.floorMat.map;
    const tex = canvasTex(W, H, (x) => {
      const pat = x.createPattern(tile, 'repeat'); const sc = W / (across * tile.width);
      x.save(); x.scale(sc, sc); x.fillStyle = pat; x.fillRect(0, 0, W / sc, H / sc); x.restore();
      const px = (wx) => (wx + ROOM_W / 2) / ROOM_W * W, pz = (wz) => (wz + ROOM_D / 2) / ROOM_D * H;
      // Window light: two warm pools, leaning the way the sun does.
      for (const [a, b] of [[-7.6, -3.1], [3.5, 8.7]]) {
        const g = x.createLinearGradient(0, 0, 0, H * 0.5); g.addColorStop(0, 'rgba(255,236,200,.26)'); g.addColorStop(1, 'rgba(255,236,200,0)');
        x.fillStyle = g; x.beginPath(); x.moveTo(px(a), 0); x.lineTo(px(b), 0); x.lineTo(px(b - 2.2), H * 0.5); x.lineTo(px(a - 2.2), H * 0.5); x.closePath(); x.fill();
      }
      // Ambient occlusion along the walls and a faint rim on the open sides.
      const rim = (x0, y0, x1, y1, a) => { const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `rgba(20,16,12,${a})`); g.addColorStop(1, 'rgba(20,16,12,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); };
      rim(0, 0, 0, 70, 0.34); rim(0, 0, 70, 0, 0.34); rim(W, 0, W - 40, 0, 0.12); rim(0, H, 0, H - 40, 0.12);
      // Contact shadows under furniture, pulled slightly toward the camera side of the sun.
      x.save(); x.shadowColor = 'rgba(15,12,10,.55)'; x.shadowBlur = 22; x.shadowOffsetX = -6; x.shadowOffsetY = 5; x.fillStyle = 'rgba(15,12,10,.18)';
      for (const [fx, fz, fw, fd] of this.nav.footprints) x.fillRect(px(fx - fw / 2) + 4, pz(fz - fd / 2) + 4, fw / ROOM_W * W - 8, fd / ROOM_D * H - 8);
      x.restore();
    });
    tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    this.floorMat.map = tex; this.floorMat.needsUpdate = true;
    old?.dispose();
  }
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
  /** Staff arrive, and existing ones keep their place. Called for the snapshot and each hire. */
  syncAgents(state) {
    this.setFloorName(state.floor.name);
    const seen = new Set();
    const staff = state.agents.filter((a) => a.role !== 'manager');
    let added = 0;
    staff.forEach((a, i) => {
      seen.add(a.id);
      if (this.actors.has(a.id)) return;
      const [x, z] = DESKS[Math.min(i, DESKS.length - 1)];
      const g = new THREE.Group(); this.room.add(g); const dg = new THREE.Group(); this.detail.add(dg); g.userData.glowTex = this.glowTex;
      const desk = makeDesk(g, dg, x, z, this.colors.accent, this.colors.primary, this.colors.accent, { seed: i + 7 });
      mergeColored(g, ROOM_MAT); mergeColored(dg, ROOM_MAT);
      this.nav.block(x, z - 0.2, 2.5, 1.3);
      const actor = new Actor(this, a, { at: desk.seat, screenMat: desk.screenMat, glow: desk.glow, bar: desk.bar });
      this.actors.set(a.id, actor);
      actor.setState(a.state, a.activity);
      added++;
    });
    if (added || !this.floorMat.map) this.bakeFloor();
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
    this.updateBoard(state.tasks);
  }
  agentEvent(ev) { const a = this.actors.get(ev.id); if (a) a.setState(ev.state, ev.activity); }
  /** The boss walks over for a word whenever they message the manager. */
  bossTalks() {
    const b = this.boss, m = this.manager;
    if (!b || !m || b.action) return;
    const [mx, mz] = this.managerSeat.at;
    b.perform([{ walk: [mx + 2.3, mz + 0.6] }, { anim: 'talk', hold: 2.8, face: -Math.PI / 2 }]);
  }
  /** The whole batch in the glass room: the visible moment a plan is made. The manager talks at the board, the team listens. */
  meeting(managerId, staffIds) {
    const [tx, tz] = MEET.table;
    const stand = [BOARD[0] - 0.3, tz - 1.2];
    const spots = [[tx - 2.3, MEET.z1 - 0.5], [tx + 0.05, MEET.z1 - 0.45], [tx + 2.3, MEET.z1 - 0.5], [tx - 1.3, MEET.z1 + 0.65], [tx + 1.3, MEET.z1 + 0.65], [tx, MEET.z1 + 1.4], [tx - 2.5, MEET.z1 + 0.6], [tx + 2.5, MEET.z1 + 0.6]];
    const m = this.actors.get(managerId);
    m?.perform([{ walk: stand }, { anim: 'talk', hold: 2.4, face: 0 }, { anim: 'talk', hold: 1.6, face: Math.PI }, { anim: 'talk', hold: 2.0, face: 0 }]);
    staffIds.forEach((id, i) => {
      const a = this.actors.get(id); if (!a) return;
      const sp = spots[i % spots.length];
      const face = Math.atan2(stand[0] - sp[0], stand[1] - sp[1]);
      a.perform([{ walk: sp }, { anim: 'listen', hold: 5.2 - i * 0.2, face }]);
    });
  }
  /** Finished work is physically carried over to the manager. */
  handoff(fromId, toId) {
    const a = this.actors.get(fromId), b = this.actors.get(toId);
    if (!a || !b || a === b) return;
    const [mx, mz] = b.seat.at;
    a.perform([{ anim: 'stand', hold: 0.1, paper: true }, { walk: [mx + 1.8, mz + 0.5] }, { anim: 'talk', hold: 1.2, paper: false, face: -Math.PI / 2 }]);
  }
  cheer() {
    for (const a of this.actors.values()) {
      if (a.action) continue;
      const was = a.seated;
      if (was) { a.seated = false; a.group.position.y = 0; a.group.position.z += 0.3; }
      a.perform([{ anim: 'cheer', hold: 1.8 }]);
    }
  }
  bind() {
    const el = document.getElementById('scene');
    this.pts = new Map();
    this.onDown = (e) => { if (e.target !== el) return; this.pts.set(e.pointerId, [e.clientX, e.clientY]); this.moved = 0; el.setPointerCapture?.(e.pointerId); };
    this.onMove = (e) => {
      if (!this.pts.has(e.pointerId)) return;
      const [px, py] = this.pts.get(e.pointerId);
      const dx = e.clientX - px, dy = e.clientY - py;
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.pts.size === 1) {
        this.targetYaw = Math.max(-0.2, Math.min(1.25, this.targetYaw - dx * 0.006));
      } else if (this.pts.size === 2) {
        const other = [...this.pts.entries()].find(([k]) => k !== e.pointerId)[1];
        const before = Math.hypot(px - other[0], py - other[1]), after = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
        this.targetZoom = Math.max(0.8, Math.min(2.4, this.targetZoom * (after / (before || 1))));
      }
      this.pts.set(e.pointerId, [e.clientX, e.clientY]);
    };
    this.onUp = (e) => { this.pts.delete(e.pointerId); };
    this.onWheel = (e) => { if (e.target !== el) return; e.preventDefault(); this.targetZoom = Math.max(0.8, Math.min(2.4, this.targetZoom * Math.exp(-e.deltaY * 0.0012))); };
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    this.unbind = () => {
      el.removeEventListener('pointerdown', this.onDown); window.removeEventListener('pointermove', this.onMove);
      window.removeEventListener('pointerup', this.onUp); window.removeEventListener('pointercancel', this.onUp); el.removeEventListener('wheel', this.onWheel);
    };
  }
  enter() {
    const r = stage.renderer;
    r.shadowMap.enabled = this.sun.castShadow; r.shadowMap.autoUpdate = !stage.lowEnd; r.shadowMap.needsUpdate = true;
    r.toneMappingExposure = 1.04;
    const w = this.world; this.scene.add(w.group); w.group.scale.setScalar(WORLD_SCALE); w.group.position.set(0, this.worldLift, 0);
    w.setDetail((stage.q?.density ?? 1) >= 0.6);
  }
  leave() { const r = stage.renderer; r.shadowMap.enabled = false; r.shadowMap.autoUpdate = true; r.toneMappingExposure = 1.0; }
  setTier(q) {
    this.sun.castShadow = q.shadow > 0;
    if (q.shadow > 0) { this.sun.shadow.mapSize.set(q.shadow, q.shadow); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    stage.renderer.shadowMap.enabled = this.sun.castShadow;
    this.detailOn = q.density >= 0.6;
    this.detail.visible = this.detailOn;
    for (const a of this.actors.values()) if (a.seat.glow) a.seat.glow.visible = this.detailOn && a.state !== 'idle';
    this.world.setDetail(q.density >= 0.6);
  }
  destroy() {
    this.unbind();
    for (const a of this.actors.values()) a.destroy();
    this.actors.clear();
    this.scene.remove(this.world.group);  // shared with the lobby, so never disposed here
    for (const root of [this.room, this.detail, this.stub.group, this.pet?.group].filter(Boolean)) root.traverse((o) => {
      if (o.geometry && o.geometry !== box && o.geometry !== cyl && o.geometry !== cone && o.geometry !== ico && o.geometry !== sph && !o.geometry.parameters?.shared) o.geometry.dispose?.();
      if (o.material?.map && o.material.map !== this.glowTex) o.material.map.dispose();
    });
    this.codeTex.dispose(); this.pageTex.dispose(); this.idleTex.dispose(); this.glowTex.dispose(); this.discGeo.dispose(); this.discMat.map.dispose(); this.discMat.dispose();
  }
  resize(w, h) {
    this.w = w; this.h = h;
    const phone = w <= 760;
    // Keep the room inside the area the panel leaves free.
    const panel = phone ? 0 : Math.min(430, w * 0.34);
    const sheet = phone ? h * 0.54 : 0;
    const top = phone ? 58 : 76, bottom = phone ? 44 : 60; // room for the title above and the controls below
    const vw = w - panel, vh = h - sheet - top - bottom;
    this.visW = vw; this.visH = vh;
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, panel / 2, (sheet + bottom - top) / 2, w, h);
    this.camera.updateProjectionMatrix();
  }
  placeCamera(dist) {
    const y = Math.sin(this.pitch) * dist, r = Math.cos(this.pitch) * dist;
    this.camera.position.set(Math.sin(this.yaw) * r, y, Math.cos(this.yaw) * r);
    this.camera.lookAt(0, 0.8, 0.3);
  }
  /** The closest camera distance at which every corner of the room lands inside the free area. Cached per angle. */
  fitDistance() {
    const key = `${this.yaw.toFixed(3)}|${this.visW}|${this.visH}`;
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
  update(dt) {
    this.time += dt; this.intro = Math.min(1, this.intro + dt / 1.35);
    this.world.update(dt, this.time);
    // On phones the shadows redraw every third frame. Nobody can tell, and it saves about a third of the draw calls.
    if (stage.lowEnd && (this.frame = (this.frame || 0) + 1) % 3 === 0) stage.renderer.shadowMap.needsUpdate = true;
    const e = 1 - Math.pow(1 - this.intro, 3);
    const k = 1 - Math.exp(-dt * 6);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.zoom += (this.targetZoom - this.zoom) * k;
    // Fit the room to the free area at any aspect ratio, and let the intro pull back from close up.
    const dist = (this.fitDistance() / this.zoom) * (1.5 - 0.5 * e);
    this.placeCamera(dist);
    // Scrolling screens read as real work.
    this.codeTex.offset.y = (this.time * 0.25) % 1;
    this.pageTex.offset.y = (this.time * 0.05) % 1;
    if (this.arcadeScreen) this.arcadeScreen.material.color.setHSL((this.time * 0.1) % 1, 0.7, 0.62);
    // The light through the windows drifts a little, like clouds passing.
    const drift = Math.sin(this.time * 0.07);
    this.sun.position.set(SUN_DIR.x + drift * 0.05, SUN_DIR.y, SUN_DIR.z + Math.cos(this.time * 0.05) * 0.04).multiplyScalar(44);
    this.sun.intensity = 2.5 + drift * 0.25;
    this.winMat.opacity = 0.3 + drift * 0.04;
    for (let i = 0; i < this.sway.length; i++) { const c = this.sway[i]; c.rotation.z = Math.sin(this.time * 0.9 + i * 2) * 0.035; c.rotation.x = Math.cos(this.time * 0.7 + i) * 0.025; }
    const sec = Math.floor(Date.now() / 1000);
    if (sec !== this.clockSec) { this.clockSec = sec; this.drawClock(this.clockTex.image.getContext('2d')); this.clockTex.needsUpdate = true; }
    for (const a of this.actors.values()) { a.update(dt); this.placeTag(a); }
    this.updatePet(dt);
  }
  placeTag(a) {
    const p = this.tv.copy(a.group.position); p.y += HEAD_TOP * CHAR_SCALE + 0.2;
    p.project(this.camera);
    const x = (p.x * 0.5 + 0.5) * this.w, y = (-p.y * 0.5 + 0.5) * this.h;
    a.tag.style.transform = `translate(-50%,-100%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    // Nearer people keep their labels on top of farther ones.
    const z = Math.round((1 - p.z) * 5000);
    if (z !== a.tagZ) { a.tagZ = z; a.tag.style.zIndex = z; }
  }
  updatePet(dt) {
    if (!this.pet) return;
    const g = this.pet.group;
    const dx = this.petTarget[0] - g.position.x, dz = this.petTarget[1] - g.position.z, d = Math.hypot(dx, dz);
    if (d > 0.08) {
      g.position.x += (dx / d) * 1.5 * dt; g.position.z += (dz / d) * 1.5 * dt; g.rotation.y = Math.atan2(dx, dz);
      g.position.y = Math.abs(Math.sin(this.time * 11)) * 0.05; this.pet.body.rotation.z = Math.sin(this.time * 11) * 0.06;
      this.pet.head.rotation.x = 0; this.pet.tail.rotation.z = Math.sin(this.time * 14) * 0.5;
    } else {
      this.petWait -= dt; g.position.y = 0; this.pet.body.rotation.z = 0;
      // Sitting: the head looks around, the tail flicks now and then.
      this.pet.head.rotation.y = Math.sin(this.time * 0.8) * 0.5; this.pet.head.rotation.x = Math.sin(this.time * 0.5) * 0.1;
      this.pet.tail.rotation.z = Math.sin(this.time * 3) * 0.2;
      if (this.petWait <= 0) {
        this.petWait = 3 + Math.random() * 7;
        // Only straight, open lanes: the aisles between the desk rows, and the rug in the lounge now and then.
        const lanes = [[(Math.random() - 0.5) * 15, -1.6], [(Math.random() - 0.5) * 15, 2.6]];
        this.petTarget = lanes[Math.floor(Math.random() * lanes.length)];
        if (Math.abs(this.petTarget[1] - g.position.z) > 0.6) { this.petTarget = [g.position.x > 0 ? 8.6 : -8.6, this.petTarget[1]]; }
      }
    }
  }
}
