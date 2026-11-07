// The cutaway office. Characters act out what the agents are really doing: every state here comes from the SSE stream.
import * as THREE from '../vendor/three/three.module.min.js';
import { Character } from './character.js';
import { stage } from './stage.js';
import { mergeMeshes } from './batch.js';

const ROOM_W = 22, ROOM_D = 13.6, WALL_H = 4.6;
const DESKS = [[-6.6, 0.5], [-2.2, 0.5], [2.2, 0.5], [6.6, 0.5], [-6.6, 4.4], [-2.2, 4.4], [2.2, 4.4], [6.6, 4.4]];
const MANAGER_DESK = [-6.6, -3.9], BOSS_DESK = [6.8, -3.9];
const BOARD = [-0.4, -6.25];
const SHELF = [-10.2, 2.4], COFFEE = [10.1, 2.4], ARCADE = [10.1, -1.4], SOFA = [6.9, 5.1];
const CELL = 0.5;

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
const mats = new Map();
function lam(color) { let m = mats.get(color); if (!m) { m = new THREE.MeshLambertMaterial({ color }); mats.set(color, m); } return m; }
function piece(parent, color, w, hh, d, x, y, z, { cast = true, recv = true, geo = box, mat } = {}) {
  const m = new THREE.Mesh(geo, mat || lam(color));
  m.scale.set(w, hh, d); m.position.set(x, y + hh / 2, z); m.castShadow = cast; m.receiveShadow = recv;
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

function floorTexture(style) {
  const r = seeded(7);
  if (style === 'wood') return canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#a97c54'; x.fillRect(0, 0, w, h);
    for (let row = 0; row < 8; row++) {
      let px = -(row % 2) * 90;
      while (px < w) {
        const len = 150 + r() * 90; const l = 44 + r() * 14;
        x.fillStyle = `hsl(${26 + r() * 6},${40 + r() * 8}%,${l}%)`; x.fillRect(px, row * 64, len, 63);
        x.strokeStyle = 'rgba(70,40,20,.13)';
        for (let g = 0; g < 4; g++) { x.beginPath(); const gy = row * 64 + r() * 60; x.moveTo(px, gy); x.bezierCurveTo(px + len / 3, gy + 3, px + len / 2, gy - 3, px + len, gy); x.stroke(); }
        px += len + 1;
      }
    }
  }, [3, 2]);
  if (style === 'carpet') return canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#5b6277'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.08})`; x.fillRect(r() * w, r() * h, 2, 2); }
    x.strokeStyle = 'rgba(0,0,0,.14)'; x.lineWidth = 2; x.strokeRect(0, 0, w, h);
  }, [6, 4]);
  if (style === 'terrazzo') return canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#e4dccd'; x.fillRect(0, 0, w, h);
    const cs = ['#c98d6c', '#6f7f8f', '#3f4048', '#d9b86e', '#a9b8a0', '#ffffff'];
    for (let i = 0; i < 620; i++) {
      x.fillStyle = cs[Math.floor(r() * cs.length)];
      x.beginPath(); const px = r() * w, py = r() * h, s = 2 + r() * 9;
      x.moveTo(px, py); for (let k = 0; k < 4; k++) x.lineTo(px + (r() - 0.5) * s * 2, py + (r() - 0.5) * s * 2); x.fill();
    }
  }, [3, 2]);
  return canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#9b9a97'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.05})`; x.fillRect(r() * w, r() * h, 3, 3); }
    x.strokeStyle = 'rgba(40,40,40,.22)'; x.lineWidth = 2; x.strokeRect(1, 1, w - 2, h - 2);
  }, [3, 2]);
}

const WINDOW_TEX = () => canvasTex(512, 256, (x, w, h) => {
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2c2f58'); g.addColorStop(0.45, '#8c5a7a'); g.addColorStop(0.72, '#f0946a'); g.addColorStop(1, '#ffc78a');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const r = seeded(21);
  for (let layer = 0; layer < 2; layer++) {
    let px = 0;
    while (px < w) {
      const bw = 18 + r() * 30, bh = (layer ? 44 : 80) + r() * 60;
      x.fillStyle = layer ? '#2b2740' : '#5a4560'; x.fillRect(px, h - bh, bw, bh);
      if (layer) for (let wy = h - bh + 6; wy < h - 5; wy += 10) for (let wx = px + 4; wx < px + bw - 4; wx += 8) if (r() > 0.6) { x.fillStyle = '#ffd690'; x.fillRect(wx, wy, 3, 5); }
      px += bw + r() * 4;
    }
  }
});

function screenTexture(kind, brand) {
  return canvasTex(128, 96, (x, w, h) => {
    const r = seeded(kind === 'code' ? 3 : 8);
    x.fillStyle = kind === 'code' ? '#121a2b' : '#f4f1e8'; x.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 8) {
      const indent = kind === 'code' ? Math.floor(r() * 4) * 8 : 6;
      let px = 6 + indent;
      while (px < w - 12 && r() > 0.12) {
        const len = 6 + r() * 24;
        x.fillStyle = kind === 'code' ? ['#7dd3fc', '#f9a8d4', '#fde68a', '#a7f3d0', '#cbd5e1'][Math.floor(r() * 5)] : (y < 14 ? brand : '#6b6f78');
        x.fillRect(px, y, len, 4); px += len + 4;
      }
    }
  }, [1, 1]);
}

function makeNav() {
  const cols = Math.round(ROOM_W / CELL), rows = Math.round(ROOM_D / CELL);
  const blocked = new Uint8Array(cols * rows);
  const toCell = (x, z) => [Math.max(0, Math.min(cols - 1, Math.floor((x + ROOM_W / 2) / CELL))), Math.max(0, Math.min(rows - 1, Math.floor((z + ROOM_D / 2) / CELL)))];
  const toWorld = (cx, cz) => [(cx + 0.5) * CELL - ROOM_W / 2, (cz + 0.5) * CELL - ROOM_D / 2];
  const block = (x, z, w, d) => {
    const [a, b] = toCell(x - w / 2, z - d / 2), [c, e] = toCell(x + w / 2, z + d / 2);
    for (let i = a; i <= c; i++) for (let j = b; j <= e; j++) blocked[j * cols + i] = 1;
  };
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
    const clear = (a, b) => { const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL * 0.5)); for (let i = 1; i < steps; i++) { const t = i / steps; const [cx, cz] = toCell(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); if (blocked[cz * cols + cx]) return false; } return true; };
    for (let i = 0; i < out.length; i++) {
      const next = out[i + 1];
      if (!next || !clear(anchor, next)) { smooth.push(out[i]); anchor = out[i]; }
    }
    if (smooth.length) smooth[smooth.length - 1] = [tx, tz]; else smooth.push([tx, tz]);
    return smooth;
  };
  return { block, path };
}

function makeDesk(parent, x, z, brand, { big = false } = {}) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  const W = big ? 3 : 2.3, D = big ? 1.4 : 1.15;
  piece(g, big ? '#6e4a33' : '#d7c3a4', W, 0.1, D, 0, 0.92, -0.2);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) piece(g, '#3d3b44', 0.08, 0.92, 0.08, lx * (W / 2 - 0.1), 0, -0.2 + lz * (D / 2 - 0.1));
  // Monitor and keyboard.
  piece(g, '#25262d', 0.12, 0.26, 0.12, 0, 1.02, -0.5);
  piece(g, '#25262d', 1.06, 0.72, 0.07, 0, 1.24, -0.55);
  const screenMat = new THREE.MeshBasicMaterial({ color: '#1a2030' });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.62), screenMat);
  screen.position.set(0, 1.6, -0.51); g.add(screen);
  piece(g, '#e7e2d6', 0.72, 0.03, 0.24, 0, 1.02, 0.05);
  piece(g, '#ece6d8', 0.2, 0.14, 0.2, -0.82, 1.02, -0.2);
  // Chair, in the brand colour.
  piece(g, '#2c2c33', 0.08, 0.5, 0.08, 0, 0, 0.72);
  piece(g, brand, 0.7, 0.13, 0.66, 0, 0.5, 0.72);
  piece(g, brand, 0.7, 0.72, 0.1, 0, 0.62, 1.06);
  return { group: g, screenMat, seat: [x, z + 0.74] };
}

function makePlant(parent, x, z, size = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * size, 0.2 * size, 0.46 * size, 10), lam('#b86a4b'));
  pot.position.y = 0.23 * size; pot.castShadow = true; g.add(pot);
  const leaf = new THREE.IcosahedronGeometry(0.34 * size, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = new THREE.Mesh(leaf, lam(i % 2 ? '#4f7a54' : '#5e9160'));
    m.position.set(Math.cos(a) * 0.26 * size, (0.72 + (i % 3) * 0.26) * size, Math.sin(a) * 0.26 * size);
    m.scale.y = 1.25; m.castShadow = true; g.add(m);
  }
  return g;
}

function buildPet(kind) {
  const g = new THREE.Group();
  const c = kind === 'dog' ? '#c08a56' : '#5a5560';
  piece(g, c, 0.28, 0.28, 0.58, 0, 0.24, 0);
  piece(g, c, 0.3, 0.3, 0.3, 0, 0.42, 0.34);
  if (kind === 'dog') { piece(g, '#7e5a38', 0.08, 0.2, 0.12, -0.15, 0.48, 0.34); piece(g, '#7e5a38', 0.08, 0.2, 0.12, 0.15, 0.48, 0.34); } else { const ear = new THREE.ConeGeometry(0.07, 0.14, 4); for (const s of [-1, 1]) { const m = new THREE.Mesh(ear, lam(c)); m.position.set(s * 0.1, 0.78, 0.34); g.add(m); } }
  for (const [x, z] of [[-0.1, -0.2], [0.1, -0.2], [-0.1, 0.2], [0.1, 0.2]]) piece(g, c, 0.07, 0.2, 0.07, x, 0, z);
  const tail = piece(g, c, 0.06, 0.06, 0.3, 0, 0.36, -0.42); tail.rotation.x = 0.7;
  piece(g, '#1a1a1e', 0.04, 0.04, 0.02, -0.07, 0.48, 0.5, { cast: false }); piece(g, '#1a1a1e', 0.04, 0.04, 0.02, 0.07, 0.48, 0.5, { cast: false });
  return { group: g, tail };
}

export class Actor {
  constructor(view, info, seat, { isBoss = false } = {}) {
    this.view = view; this.id = info.id; this.info = info; this.seat = seat; this.isBoss = isBoss;
    this.char = new Character(info.look, { accent: view.colors.accent, scale: 1.3 });
    this.pos = new THREE.Vector3(seat.at[0], 0, seat.at[1]);
    this.group = this.char.group;
    this.group.position.copy(this.pos);
    this.heading = Math.PI; this.path = []; this.speed = 0; this.queue = []; this.action = null; this.seated = true; this.state = 'idle'; this.lastShelf = -99; this.idleTimer = 4 + Math.random() * 16;
    view.scene.add(this.group);
    this.sitDown();
    this.tag = document.createElement('div'); this.tag.className = 'char-tag';
    this.nameEl = document.createElement('span'); this.nameEl.className = 'char-name'; this.nameEl.textContent = info.name;
    this.bubble = document.createElement('span'); this.bubble.className = 'char-bubble'; this.bubble.hidden = true;
    this.tag.append(this.bubble, this.nameEl);
    view.labels.append(this.tag);
  }
  destroy() { this.char.dispose(); this.tag.remove(); }
  sitDown() {
    this.seated = true;
    this.group.position.set(this.seat.at[0], 0.15, this.seat.at[1] - 0.05);
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
      if (s === 'typing') { screen.map = v.codeTex; screen.color.set('#ffffff'); }
      else if (s === 'browsing' || s === 'reading') { screen.map = v.pageTex; screen.color.set('#ffffff'); }
      else if (s === 'thinking' || s === 'talking' || s === 'queued') { screen.map = v.pageTex; screen.color.set('#b9b4aa'); }
      else { screen.map = null; screen.color.set('#1a2030'); }
      screen.needsUpdate = true;
    }
    if (!this.seated) return;
    this.char.setAnim(s === 'typing' || s === 'browsing' ? 'type' : s === 'thinking' || s === 'queued' ? 'think' : s === 'talking' ? 'talk' : s === 'reading' ? 'type' : 'sit');
  }
  // Real events can flip faster than the eye. Each visible state gets a moment on stage; the newest one waits its turn.
  setState(state, activity) {
    const now = this.view.time;
    if (this.stateSince !== undefined && now - this.stateSince < 1.1 && state !== this.state) { this.pending = [state, activity]; return; }
    this.pending = null;
    this.stateSince = now;
    this.applyState(state, activity);
  }
  applyState(state, activity) {
    const was = this.state;
    this.state = state; this.activity = activity;
    this.renderBubble();
    if (state === was) return;
    this.applyStatePose();
    // Reading sometimes means a trip to the bookshelf.
    if (state === 'reading' && this.view.time - this.lastShelf > 25 && this.seated && !this.action && !this.isManager) {
      this.lastShelf = this.view.time;
      this.perform([{ walk: [SHELF[0] + 0.9, SHELF[1] + (Math.random() - 0.5) * 2] }, { anim: 'stand', hold: 1.6, face: -Math.PI / 2 }]);
    }
  }
  renderBubble() {
    const busy = this.state !== 'idle';
    const text = this.activity ? this.activity.slice(0, 34) : '';
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
  update(dt) {
    const g = this.group, time = this.view.time;
    if (this.pending && time - this.stateSince >= 1.1) { const [st, ac] = this.pending; this.pending = null; this.stateSince = time; this.applyState(st, ac); }
    let moving = 0;
    if (this.path.length) {
      const [tx, tz] = this.path[0];
      const dx = tx - g.position.x, dz = tz - g.position.z, d = Math.hypot(dx, dz);
      const v = 2.5;
      if (d < 0.06) { this.path.shift(); if (!this.path.length) { const f = this.afterWalk; this.afterWalk = null; this.char.setAnim('stand'); f?.(); } } else {
        const step = Math.min(d, v * dt);
        g.position.x += (dx / d) * step; g.position.z += (dz / d) * step;
        this.faceTo = Math.atan2(dx, dz);
        moving = 1;
      }
    } else if (this.action && !this.action.walk && time > this.holdUntil) {
      this.next();
    } else if (!this.action && this.seated && this.state === 'idle' && !this.isBossAway) {
      // Off the clock: stretch the legs now and then, so an idle floor still feels alive.
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idleTimer = 18 + Math.random() * 40;
        const options = [];
        if (this.view.decor.coffee) options.push([COFFEE[0] - 0.9, COFFEE[1] + (Math.random() - 0.5)]);
        if (this.view.decor.arcade) options.push([ARCADE[0] - 1, ARCADE[1]]);
        options.push([SHELF[0] + 0.9, SHELF[1]], [BOARD[0] + 1.6, BOARD[1] + 1.4]);
        const pick = options[Math.floor(Math.random() * options.length)];
        this.perform([{ walk: pick }, { anim: 'stand', hold: 2.5 + Math.random() * 2 }]);
      }
    }
    if (this.seated) this.faceTo = Math.PI;
    if (this.faceTo !== undefined) {
      let diff = this.faceTo - g.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.rotation.y += diff * Math.min(1, dt * 10);
    }
    this.char.update(dt, moving);
  }
}

export class OfficeView {
  constructor({ state, labels, onSelect }) {
    this.labels = labels; this.onSelect = onSelect;
    this.colors = state.floor.colors; this.decor = state.floor.decor;
    this.staffCount = state.agents.filter((a) => a.role !== 'manager').length;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#16172a');
    this.camera = new THREE.PerspectiveCamera(24, 1, 1, 200);
    this.time = 0; this.yaw = 0.5; this.targetYaw = 0.5; this.pitch = 0.86; this.zoom = 1; this.targetZoom = 1; this.intro = 0;
    this.actors = new Map(); this.nav = makeNav(); this.deskSlots = [];
    this.tv = new THREE.Vector3();
    this.codeTex = screenTexture('code', this.colors.primary);
    this.pageTex = screenTexture('page', this.colors.primary);
    this.buildRoom();
    this.syncAgents(state);
    mergeMeshes(this.room);
    this.bind();
  }
  buildRoom() {
    const s = this.scene; const { primary, accent } = this.colors; const d = this.decor;
    s.add(new THREE.HemisphereLight('#fff4e4', '#7a7088', 1.95));
    const sun = new THREE.DirectionalLight('#ffd9b0', 1.75);
    sun.position.set(10, 20, 11); sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const size = stage.lowEnd ? 1024 : 2048;
    sun.shadow.mapSize.set(size, size);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 16, bottom: -16, near: 1, far: 60 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    s.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#ffe9d2', 0.55); fill.position.set(-8, 8, 14); s.add(fill);
    const room = new THREE.Group(); s.add(room); this.room = room;

    // Slab, floor, skirting: a slice cut out of the tower.
    piece(room, '#2a2833', ROOM_W + 1.1, 0.9, ROOM_D + 1.1, 0, -0.95, 0, { recv: false });
    piece(room, primary, ROOM_W + 1.1, 0.08, ROOM_D + 1.1, 0, -0.1, 0, { recv: false, cast: false });
    const tex = floorTexture(d.floor);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), new THREE.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; room.add(floor);

    // Back wall and side wall with big dusk windows, cut low on the open sides.
    const wall = d.wall;
    const wallZ = -ROOM_D / 2, wallX = -ROOM_W / 2;
    const backParts = [[-ROOM_W / 2, -7.6], [-3.1, 3.5], [8.7, ROOM_W / 2]];
    for (const [a, b] of backParts) piece(room, wall, b - a, WALL_H, 0.3, (a + b) / 2, 0, wallZ - 0.15);
    const winMat = new THREE.MeshBasicMaterial({ map: WINDOW_TEX() });
    for (const [a, b] of [[-7.6, -3.1], [3.5, 8.7]]) {
      piece(room, wall, b - a, 1.0, 0.3, (a + b) / 2, 0, wallZ - 0.15);
      piece(room, wall, b - a, 0.36, 0.3, (a + b) / 2, WALL_H - 0.36, wallZ - 0.15);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(b - a, WALL_H - 1.36), winMat); w.position.set((a + b) / 2, 1 + (WALL_H - 1.36) / 2, wallZ - 0.25); room.add(w);
      for (let mx = a; mx <= b + 0.01; mx += (b - a) / 3) piece(room, '#3a3640', 0.07, WALL_H - 1.36, 0.08, mx, 1, wallZ - 0.1, { cast: false });
    }
    piece(room, wall, 0.3, WALL_H, ROOM_D + 0.3, wallX - 0.15, 0, -0.0);
    piece(room, '#f7f1e4', ROOM_W + 0.6, 0.1, 0.42, 0, WALL_H, wallZ - 0.15, { cast: false });
    piece(room, '#f7f1e4', 0.42, 0.1, ROOM_D + 0.3, wallX - 0.15, WALL_H, 0, { cast: false });
    piece(room, primary, ROOM_W, 0.2, 0.05, 0, 0, wallZ + 0.03, { cast: false });
    piece(room, primary, 0.05, 0.2, ROOM_D, wallX + 0.03, 0, 0, { cast: false });

    // Whiteboard, where plans get made.
    const boardMat = new THREE.MeshBasicMaterial({ map: this.boardTexture(['']) });
    this.boardMat = boardMat;
    piece(room, '#b9b4a8', 4.5, 2.2, 0.1, BOARD[0], 1.25, wallZ + 0.07);
    const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 2.02), boardMat); boardFace.position.set(BOARD[0], 2.35, wallZ + 0.13); room.add(boardFace);
    this.nav.block(BOARD[0], wallZ + 0.3, 4.6, 0.4);
    piece(room, '#8f8a7e', 4.5, 0.05, 0.2, BOARD[0], 1.25, wallZ + 0.16, { cast: false });

    // Neon company sign.
    if (d.neon) {
      const sign = canvasTex(1024, 180, (x, w, h) => {
        x.clearRect(0, 0, w, h);
      });
      this.signTex = sign;
      piece(room, '#23212f', 0.06, 1.2, 7, wallX + 0.03, 2.75, -2.3, { cast: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 1.19), new THREE.MeshBasicMaterial({ map: sign, transparent: true, depthWrite: false }));
      m.position.set(wallX + 0.08, 3.35, -2.3); m.rotation.y = Math.PI / 2;
      room.add(m); this.signMesh = m;
    }
    // Art on the side wall.
    if (d.art) {
      const art = canvasTex(256, 320, (x, w, h) => {
        x.fillStyle = '#f4ecdc'; x.fillRect(0, 0, w, h);
        x.fillStyle = primary; x.beginPath(); x.arc(w * 0.42, h * 0.42, 74, 0, 7); x.fill();
        x.fillStyle = accent; x.fillRect(w * 0.3, h * 0.55, w * 0.5, h * 0.24);
        x.strokeStyle = '#22242c'; x.lineWidth = 7; x.beginPath(); x.moveTo(30, h - 50); x.bezierCurveTo(90, h - 120, 140, h - 10, w - 30, h - 80); x.stroke();
      });
      const frame = (z) => { piece(room, '#2c2a31', 0.08, 1.9, 1.56, wallX + 0.03, 1.55, z); const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.75), new THREE.MeshLambertMaterial({ map: art })); m.position.set(wallX + 0.08, 2.5, z); m.rotation.y = Math.PI / 2; room.add(m); };
      frame(4.6);
    }
    // Bookshelf.
    const shelf = new THREE.Group(); shelf.position.set(SHELF[0], 0, SHELF[1]); room.add(shelf);
    piece(shelf, '#6f5136', 0.6, 3, 2.6, 0, 0, 0);
    const r = seeded(17);
    for (let row = 0; row < 4; row++) {
      piece(shelf, '#553d28', 0.66, 0.06, 2.6, 0.02, 0.2 + row * 0.7, 0, { cast: false });
      for (let bz = -1.1; bz < 1.1;) {
        const w = 0.1 + r() * 0.12, hh = 0.36 + r() * 0.24;
        piece(shelf, [primary, accent, '#3c5a78', '#e6dcc6', '#7d3f3f', '#40634f'][Math.floor(r() * 6)], 0.4, hh, w, 0.18, 0.26 + row * 0.7, bz, { cast: false });
        bz += w + 0.02;
      }
    }
    this.nav.block(SHELF[0], SHELF[1], 0.8, 2.8);
    // Coffee bar.
    if (d.coffee) {
      const c = new THREE.Group(); c.position.set(COFFEE[0], 0, COFFEE[1]); room.add(c);
      piece(c, '#5e4436', 1, 1.05, 2.5, 0, 0, 0);
      piece(c, '#e8e0d0', 1.1, 0.08, 2.6, 0, 1.05, 0);
      piece(c, '#2f3036', 0.6, 0.7, 0.6, 0, 1.13, -0.5);
      piece(c, '#c8392b', 0.5, 0.08, 0.5, 0, 1.83, -0.5);
      for (let i = 0; i < 3; i++) piece(c, ['#f3ead8', primary, accent][i], 0.15, 0.17, 0.15, -0.05, 1.13, 0.2 + i * 0.28, { geo: cyl });
      this.nav.block(COFFEE[0], COFFEE[1], 1.2, 2.7);
    }
    if (d.arcade) {
      const a = new THREE.Group(); a.position.set(ARCADE[0], 0, ARCADE[1]); room.add(a);
      piece(a, accent, 0.9, 2.2, 1.0, 0, 0, 0);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.62), new THREE.MeshBasicMaterial({ color: '#58f3c8' })); scr.position.set(-0.46, 1.62, 0); scr.rotation.y = -Math.PI / 2; a.add(scr);
      piece(a, '#222228', 0.42, 0.06, 0.84, -0.52, 1.05, 0);
      this.arcadeScreen = scr;
      this.nav.block(ARCADE[0], ARCADE[1], 1.1, 1.2);
    }
    if (d.rug) {
      const rug = (x, z, w, dd, c, t) => piece(room, c, w, t, dd, x, 0, z, { cast: false });
      rug(BOSS_DESK[0], BOSS_DESK[1] + 0.6, 5, 3.6, primary, 0.03);
      rug(BOSS_DESK[0], BOSS_DESK[1] + 0.6, 4.6, 3.2, accent, 0.045);
      rug(BOSS_DESK[0], BOSS_DESK[1] + 0.6, 4.3, 2.9, primary, 0.06);
    }
    // A lounge in the front corner, until a full staff needs that desk.
    if (this.staffCount < 8) {
      const l = new THREE.Group(); l.position.set(SOFA[0], 0, SOFA[1]); room.add(l);
      if (d.rug) piece(l, accent, 5.6, 0.03, 3.1, 0, 0, -0.2, { cast: false });
      piece(l, primary, 3.8, 0.55, 1.1, 0, 0.12, 0.9); piece(l, primary, 3.8, 1.05, 0.34, 0, 0.12, 1.34);
      piece(l, primary, 0.34, 0.8, 1.1, -1.9, 0.12, 0.9); piece(l, primary, 0.34, 0.8, 1.1, 1.9, 0.12, 0.9);
      piece(l, accent, 0.76, 0.42, 0.22, -0.9, 0.67, 1.08); piece(l, '#f3ead8', 0.76, 0.42, 0.22, 0.9, 0.67, 1.08);
      piece(l, '#6e4a33', 1.8, 0.08, 0.9, 0, 0.42, -0.5); for (const [x, z] of [[-0.8, -0.85], [0.8, -0.85], [-0.8, -0.15], [0.8, -0.15]]) piece(l, '#3d3b44', 0.07, 0.42, 0.07, x, 0, z);
      piece(l, '#f3ead8', 0.5, 0.05, 0.36, -0.3, 0.5, -0.5); piece(l, accent, 0.17, 0.17, 0.17, 0.42, 0.5, -0.5, { geo: cyl });
      this.nav.block(SOFA[0], SOFA[1] + 0.2, 4.4, 2.5);
    }
    // Printer and lamp fill the back corners of the room with something to look at.
    const pr = new THREE.Group(); pr.position.set(-9.9, 0, 5.6); room.add(pr);
    piece(pr, '#5e5a64', 1, 0.8, 1, 0, 0, 0); piece(pr, '#e8e4da', 0.92, 0.3, 0.92, 0, 0.8, 0); piece(pr, '#fbf7ea', 0.5, 0.05, 0.6, 0, 1.1, 0);
    this.nav.block(-9.9, 5.6, 1.2, 1.2);
    // Plants, in a stable order so more means more.
    const spots = [[-10.1, -6.0], [10.2, -5.9], [-3.9, -5.9], [3.1, -5.9], [10.3, 5.9], [-4.4, 6.2], [-0.2, 6.2], [-10.2, -0.4]];
    for (let i = 0; i < d.plants; i++) { makePlant(room, spots[i][0], spots[i][1], i < 2 ? 1.3 : 1); this.nav.block(spots[i][0], spots[i][1], 0.8, 0.8); }

    // Desks.
    const mgr = makeDesk(room, MANAGER_DESK[0], MANAGER_DESK[1], accent, { big: true });
    this.nav.block(MANAGER_DESK[0], MANAGER_DESK[1] - 0.2, 3.2, 1.6);
    this.managerSeat = { at: mgr.seat, screenMat: mgr.screenMat };
    const bossDesk = makeDesk(room, BOSS_DESK[0], BOSS_DESK[1], primary, { big: true });
    this.nav.block(BOSS_DESK[0], BOSS_DESK[1] - 0.2, 3.2, 1.6);
    this.bossSeat = { at: bossDesk.seat, screenMat: bossDesk.screenMat };
    piece(room, '#e9b949', 0.8, 0.14, 0.2, BOSS_DESK[0] + 0.85, 1.02, BOSS_DESK[1] + 0.25);
    for (const [x, z] of DESKS) {
      this.deskSlots.push({ x, z, desk: null });
    }
    // Pet.
    if (d.pet !== 'none') {
      this.pet = buildPet(d.pet);
      this.pet.group.position.set(2, 0, -1.8);
      s.add(this.pet.group); this.petTarget = [2, -1.8]; this.petWait = 3;
    }
  }
  boardTexture(lines) {
    return canvasTex(640, 300, (x, w, h) => {
      x.fillStyle = '#fdfcf7'; x.fillRect(0, 0, w, h);
      x.font = '600 38px Fraunces, Georgia, serif'; x.fillStyle = this.colors.primary;
      x.fillText(lines[0] || 'Big ideas', 26, 50);
      x.font = '600 25px ui-sans-serif, system-ui, sans-serif';
      lines.slice(1, 7).forEach((l, i) => {
        x.fillStyle = '#343842'; x.fillText(`${l.slice(0, 38)}`, 58, 98 + i * 38);
        x.strokeStyle = this.colors.primary; x.lineWidth = 3; x.strokeRect(26, 78 + i * 38, 20, 20);
      });
      if (lines.length < 2) {
        x.strokeStyle = '#c7c2b6'; x.lineWidth = 3;
        for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(30, 90 + i * 42); x.bezierCurveTo(200, 80 + i * 44, 300, 100 + i * 40, 420 - i * 50, 90 + i * 42); x.stroke(); }
      }
    });
  }
  updateBoard(tasks) {
    const open = tasks.filter((t) => ['todo', 'doing', 'review', 'blocked'].includes(t.status));
    const shown = open.length ? open : [];
    const key = JSON.stringify(shown.map((t) => t.title));
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.boardMat.map?.dispose();
    this.boardMat.map = this.boardTexture(shown.length ? [shown[0].plan || 'The plan', ...shown.map((t) => t.title)] : ['']);
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
    x.shadowColor = this.colors.accent; x.shadowBlur = 30; x.fillStyle = '#fff8e8';
    x.fillText(name, c.width / 2, c.height / 2 + 4); x.fillText(name, c.width / 2, c.height / 2 + 4);
    this.signTex.needsUpdate = true;
  }
  /** Staff arrive, and existing ones keep their place. Called for the snapshot and each hire. */
  syncAgents(state) {
    this.setFloorName(state.floor.name);
    const seen = new Set();
    const staff = state.agents.filter((a) => a.role !== 'manager');
    staff.forEach((a, i) => {
      seen.add(a.id);
      if (this.actors.has(a.id)) return;
      const [x, z] = DESKS[Math.min(i, DESKS.length - 1)];
      const desk = makeDesk(this.room, x, z, this.colors.accent);
      this.nav.block(x, z - 0.2, 2.5, 1.3);
      const actor = new Actor(this, a, { at: desk.seat, screenMat: desk.screenMat });
      this.actors.set(a.id, actor);
      actor.setState(a.state, a.activity);
    });
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
    b.perform([{ walk: [mx + 2.3, mz + 0.7] }, { anim: 'talk', hold: 2.6, face: -Math.PI / 2 }]);
  }
  /** The whole batch at the whiteboard: the visible moment a plan is made. */
  meeting(managerId, staffIds) {
    const spots = [[BOARD[0] + 1.9, BOARD[1] + 3.0], [BOARD[0] + 0.5, BOARD[1] + 3.3], [BOARD[0] - 0.9, BOARD[1] + 3.3], [BOARD[0] - 2.3, BOARD[1] + 3.0], [BOARD[0] + 3.2, BOARD[1] + 2.4], [BOARD[0] - 3.5, BOARD[1] + 2.4], [BOARD[0] + 1.2, BOARD[1] + 4.2], [BOARD[0] - 1.6, BOARD[1] + 4.2]];
    const m = this.actors.get(managerId);
    m?.perform([{ walk: [BOARD[0] - 0.2, BOARD[1] + 1.4] }, { anim: 'talk', hold: 5.5, face: Math.PI }]);
    staffIds.forEach((id, i) => {
      const a = this.actors.get(id); if (!a) return;
      a.perform([{ walk: spots[i % spots.length] }, { anim: 'stand', hold: 4.6 - i * 0.2, face: Math.PI }]);
    });
  }
  /** Finished work is physically carried over to the manager. */
  handoff(fromId, toId) {
    const a = this.actors.get(fromId), b = this.actors.get(toId);
    if (!a || !b || a === b) return;
    const [mx, mz] = b.seat.at;
    a.perform([{ anim: 'stand', hold: 0.1, paper: true }, { walk: [mx + 1.7, mz + 0.6] }, { anim: 'talk', hold: 1.1, paper: false, face: -Math.PI / 2 }]);
  }
  cheer() {
    for (const a of this.actors.values()) {
      if (a.action) continue;
      const was = a.seated;
      if (was) { a.seated = false; a.group.position.y = 0; a.group.position.z += 0.25; }
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
  enter() { const r = stage.renderer; r.shadowMap.enabled = true; r.shadowMap.autoUpdate = !stage.lowEnd; r.shadowMap.needsUpdate = true; this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }
  leave() { const r = stage.renderer; r.shadowMap.enabled = false; r.shadowMap.autoUpdate = true; }
  destroy() {
    this.unbind();
    for (const a of this.actors.values()) a.destroy();
    this.actors.clear();
    this.scene.traverse((o) => {
      if (o.geometry && o.geometry !== box && o.geometry !== cyl && !o.geometry.parameters?.shared) o.geometry.dispose?.();
      if (o.material?.map) o.material.map.dispose();
    });
    this.codeTex.dispose(); this.pageTex.dispose();
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
    for (const a of this.actors.values()) { a.update(dt); this.placeTag(a); }
    this.updatePet(dt);
  }
  placeTag(a) {
    const p = this.tv.copy(a.group.position); p.y += a.seated ? 2.15 : 2.5;
    p.project(this.camera);
    const x = (p.x * 0.5 + 0.5) * this.w, y = (-p.y * 0.5 + 0.5) * this.h;
    a.tag.style.transform = `translate(-50%,-100%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  }
  updatePet(dt) {
    if (!this.pet) return;
    const g = this.pet.group;
    const dx = this.petTarget[0] - g.position.x, dz = this.petTarget[1] - g.position.z, d = Math.hypot(dx, dz);
    if (d > 0.08) { g.position.x += (dx / d) * 1.4 * dt; g.position.z += (dz / d) * 1.4 * dt; g.rotation.y = Math.atan2(dx, dz); g.position.y = Math.abs(Math.sin(this.time * 11)) * 0.04; } else {
      this.petWait -= dt; g.position.y = 0;
      if (this.petWait <= 0) {
        this.petWait = 2 + Math.random() * 6;
        // Only straight, open lanes: the aisles between the desk rows.
        const lanes = [[(Math.random() - 0.5) * 16, -1.8], [(Math.random() - 0.5) * 16, 2.6]];
        this.petTarget = lanes[Math.floor(Math.random() * lanes.length)];
        if (Math.abs(this.petTarget[1] - g.position.z) > 0.6) { this.petTarget = [g.position.x > 0 ? 9 : -9, this.petTarget[1]]; }
      }
    }
    this.pet.tail.rotation.z = Math.sin(this.time * 14) * 0.5;
  }
}
