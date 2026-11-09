// The cast. Everyone in the office is Colon's bean (his own design): one smooth, glossy vinyl-toy body with two tiny black bead eyes, two stubby arms
// ending in chunky sausage-finger hands, and two short legs on flat-soled feet. People differ by colour, hat, outfit and the thing they carry. All made
// in code, so a floor opens without waiting for a single model. This file is all there is to how the staff look and move: to change the cast, replace it.
// character.js is the interface the rooms drive, and portrait.js photographs whatever this builds.
//
// What a replacement has to provide:
//   specFor(look, { role, accent }) -> a spec: the same person every time for the same look and role
//   class Creature(spec, { detail }): .group, .height, .bottom, .labelClear, .mug/.phone/.paper (objects with .visible), .pose(dt, speed, b, ty, m), .celebrate(), .dispose()
//   drawnFace(spec) -> an SVG for the lists, until the portrait comes back
//
// A person is ONE skinned mesh (one draw call): every part is baked into a single vertex-coloured geometry bound to a bone.
import * as THREE from '../vendor/three/three.module.min.js';
import { BODY_COLOR, SUIT_COLOR, TIE_COLOR } from './looks.js';

// ---------- who someone is ----------

const hashOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const C = (hex) => new THREE.Color(hex);
const dim = (hex, f) => `#${C(hex).multiplyScalar(f).getHexString()}`;
const mixHex = (a, b, t) => `#${C(a).lerp(C(b), t).getHexString()}`;
/** Body colour is the person; the suit picks a colour that stands apart from it, and the tie one that stands apart from the suit. Everything else is the same little fellow. */
const gap = (a, b) => { const x = C(a), y = C(b); return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b); };
const apart = (list, start, from, min) => { for (let i = 0; i < list.length; i++) { const c = list[(start + i) % list.length]; if (from.every((f) => gap(c, f) >= min)) return c; } return list[start % list.length]; };
/** Each job's hat and outfit. Today the whole office is in suits and bareheaded: change a line here and that job changes everywhere. outfit: none | tie | suit | waistcoat | hivis | labcoat. */
export const JOBS = Object.fromEntries(['boss', 'manager', 'builder', 'designer', 'tester', 'lawyer', 'researcher', 'writer', 'analyst', 'marketer', 'illustrator'].map((r) => [r, { hat: 'none', outfit: 'suit' }]));
/** The boss picks their own hat and glasses in the character builder. An outfit saved before the suits stays on until they pick a suit or tie colour. */
const OUTFIT_OF_LOOK = { labcoat: 'labcoat', overalls: 'hivis', shirt: 'tie', tee: 'none', hoodie: 'none' };

/** Everything about a person that is theirs: from their own look and job, so it never changes across reloads. */
export function specFor(look = {}, { role = '', accent = '#d9774a' } = {}) {
  // Who someone is comes from the parts of their look the builder no longer changes, so trying on a hat never turns them a different colour.
  const key = JSON.stringify([look.skin, look.hair, look.hairColor, look.outfit, look.outfitColor, look.wear]);
  const h = hashOf(key), job = JOBS[role] || { hat: 'none', outfit: 'suit' }, boss = role === 'boss';
  const color = look.bodyColor || BODY_COLOR[h % BODY_COLOR.length];
  const suit = look.suitColor || apart(SUIT_COLOR, (h >>> 4) % SUIT_COLOR.length, [color], 0.32);
  const tie = look.tieColor || apart(TIE_COLOR, (h >>> 9) % TIE_COLOR.length, [suit, color], 0.4);
  return {
    id: h, role, accent, look, color, suit, tie, hat: boss && look.hat && look.hat !== 'none' ? look.hat : job.hat, outfit: boss && !look.suitColor && !look.tieColor ? (OUTFIT_OF_LOOK[look.outfit] || 'suit') : job.outfit,
    glasses: boss && look.glasses && look.glasses !== 'none' ? look.glasses : null, trousers: ((h >>> 13) % 5) < 2, phase: ((h >>> 7) % 628) / 100,
  };
}

// ---------- the bean ----------

const H = 2, HH = H / 2, LEG = 0.35;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
/** The body's shape, everywhere, from its height (e: -1 at the bottom to 1 at the top) and the way round it (th: 0 is the front). Fuller below, narrower above, a kidney curve from the side. */
const kidney = (e) => 0.15 * (e - 0.15) * (e - 0.15) - 0.06;
const BW = (e) => 0.8 - 0.15 * sstep(-0.55, 0.75, e), BD = (e) => 0.63 - 0.1 * sstep(-0.4, 0.8, e);
const round = (e) => Math.pow(Math.max(0, 1 - e * e), 0.35);
function surf(th, e, o = new THREE.Vector3()) {
  const f = round(e);
  return o.set(BW(e) * f * Math.sin(th), HH * e, kidney(e) + BD(e) * f * Math.cos(th));
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
function surfNormal(th, e, o = new THREE.Vector3()) {
  const h = 0.008;
  surf(th + h, e, _a); surf(th - h, e, _b); _a.sub(_b);
  surf(th, Math.min(e + h, 0.9995), _c); surf(th, Math.max(e - h, -0.9995), _d); _c.sub(_d);
  return o.crossVectors(_a, _c).normalize();
}
const EYE_E = 0.47, EYE_X = 0.235;
const eyeAt = (() => { const th = Math.asin(EYE_X / (BW(EYE_E) * round(EYE_E))); return { th, z: surf(th, EYE_E).z }; })();

const beans = new Map();
/** One shared body per quality level: smooth normals straight from the shape, so the gloss runs round it without a seam. */
function beanGeometry(N, R) {
  const k = `${N}x${R}`;
  if (beans.has(k)) return beans.get(k);
  const pos = [], nor = [], idx = [], p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let j = 0; j <= R; j++) {
    const phi = -Math.PI / 2 + (Math.PI * j) / R, e = j === 0 ? -1 : j === R ? 1 : Math.sin(phi);
    for (let i = 0; i < N; i++) {
      const th = -Math.PI + (i / N) * Math.PI * 2;
      surf(th, e, p); pos.push(p.x, p.y, p.z);
      if (j === 0 || j === R) n.set(0, j ? 1 : -1, 0); else surfNormal(th, e, n);
      nor.push(n.x, n.y, n.z);
    }
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < N; i++) {
    const a = j * N + i, b = j * N + ((i + 1) % N), c = (j + 1) * N + ((i + 1) % N), d = (j + 1) * N + i;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  beans.set(k, g);
  return g;
}

// ---------- the parts ----------

/** The rounded parts, built once at each quality level: the small stuff is what phones can least afford, and can least see. */
const partsAt = (ball, tiny, cap, rad, lathe) => ({
  ball: new THREE.SphereGeometry(1, ball, Math.round(ball * 0.7)), tiny: new THREE.SphereGeometry(1, tiny, Math.round(tiny * 0.75)),
  sausage: new THREE.CapsuleGeometry(1, 1, cap, rad), box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 18), cone: new THREE.ConeGeometry(1, 1, 12),
  ring: new THREE.TorusGeometry(1, 0.105, 6, 22),
  foot: new THREE.LatheGeometry([[0.001, 0], [0.18, 0], [0.215, 0.012], [0.232, 0.05], [0.218, 0.095], [0.175, 0.14], [0.14, 0.18], [0.128, 0.24]].map(([r, y]) => new THREE.Vector2(r, y)), lathe),
});
const GEO = { 1: partsAt(16, 9, 4, 9, 16), 0.7: partsAt(11, 7, 3, 7, 12), 0.45: partsAt(8, 5, 2, 6, 9) };
/** The set for the person being built right now (a person is built in one go, so a module variable is all this needs). */
let G = GEO[1];
const INK = '#17151c', WHITE = '#fbfaf5', PAPER = '#fff9e9', GOLD = '#f2b632', METAL = '#39424e', PLUM = '#3a2a44', TAN = '#b98b55', KHAKI = '#d8c08a';
const box3 = new Map();
/** A soft-edged slab (a clipboard, a laptop). Built once per size. */
function softBox(w, h, d, r) {
  const k = [w, h, d, r].join();
  if (box3.has(k)) return box3.get(k);
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.015, d - r), bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: r * 0.32, bevelThickness: r * 0.5, curveSegments: 4 });
  g.translate(0, 0, -d / 2); box3.set(k, g);
  return g;
}
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _n = new THREE.Vector3(), _v = new THREE.Vector3(), _nm = new THREE.Matrix3();
const M = (x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));

/** The arm: a smooth tapering tube, wider at the shoulder where it grows out of the body. Built once per range and quality. */
const tubes = new Map();
const ARM_R = (y) => mix(0.16, 0.114, sstep(-0.02, -0.26, y));
function armTube(yTop, yEnd, rings, sides, grow = 1) {
  const k = [yTop, yEnd, rings, sides, grow].join();
  if (tubes.has(k)) return tubes.get(k);
  const pos = [], idx = [];
  for (let j = 0; j <= rings; j++) {
    const y = mix(yTop, yEnd, j / rings), r = ARM_R(y) * grow;
    for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; pos.push(Math.sin(a) * r, y, Math.cos(a) * r); }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) { const a = j * sides + i, b = j * sides + ((i + 1) % sides), c = (j + 1) * sides + ((i + 1) % sides), d = (j + 1) * sides + i; idx.push(a, b, c, a, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  tubes.set(k, g);
  return g;
}

/** A piece of cloth fitted to the body. pt(u, v) says where on the body each corner goes as [th, e]; it stands off the surface and rolls down to nothing at its edges, so it looks padded. */
const cloths = new Map();
function cloth(name, pt, { nu = 28, nv = 14, off = 0.03, roll = 0.14, wrap = false } = {}, q = 1) {
  const k = `${name}|${q}`;
  if (cloths.has(k)) return cloths.get(k);
  const cols = Math.max(4, Math.round(nu * q)), rows = Math.max(3, Math.round(nv * q)), pos = [], idx = [], p = new THREE.Vector3(), n = new THREE.Vector3();
  const across = wrap ? cols : cols + 1;
  for (let j = 0; j <= rows; j++) for (let i = 0; i < across; i++) {
    const u = i / cols, v = j / rows, [th, e] = pt(u, v);
    const edge = Math.min(1, ...(wrap ? [] : [u, 1 - u].map((x) => x / roll)), ...[v, 1 - v].map((x) => x / roll));
    surf(th, e, p); surfNormal(th, e, n); p.addScaledVector(n, off * (0.25 + 0.75 * sstep(0, 1, edge)));
    pos.push(p.x, p.y, p.z);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < (wrap ? cols : cols); i++) {
    const a = j * across + i, b = j * across + ((i + 1) % across), c = (j + 1) * across + ((i + 1) % across), d = (j + 1) * across + i;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  // Whichever way round pt() walks, the cloth faces outward.
  const [th0, e0] = pt(0.5, 0.5), mid = Math.floor(rows / 2) * across + Math.floor(cols / 2);
  if (surfNormal(th0, e0, n).dot(_v.fromBufferAttribute(g.attributes.normal, mid)) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  cloths.set(k, g);
  return g;
}

/** Collects parts into one geometry, each vertex tied to the bone (or two bones) it rides on. */
class Rig {
  constructor() { this.bones = []; this.pos = []; this.nor = []; this.col = []; this.glo = []; this.idx = []; this.ski = []; this.count = 0; this.color = new THREE.Color(); }
  bone(parent, x = 0, y = 0, z = 0) {
    const b = new THREE.Bone(); b.position.set(x, y, z); b.userData.at = new THREE.Vector3(x, y, z).add(parent ? parent.userData.at : new THREE.Vector3());
    if (parent) parent.add(b);
    b.userData.i = this.bones.length; this.bones.push(b);
    return b;
  }
  /** `gloss` 0..1 scales the shine; `blend` is { bone, w(localPoint) }: a second bone this part leans towards, for a soft elbow. */
  add(bone, geo, color, m, { gloss = 1, blend = null } = {}) {
    const c = this.color.set(color), p = geo.attributes.position, n = geo.attributes.normal, base = this.count, at = bone.userData.at, bi = bone.userData.i;
    _nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m);
      const w = blend ? blend.w(_v) : 0;
      this.ski.push(bi, blend ? blend.bone.userData.i : 0, 1 - w, w);
      _v.add(at); this.pos.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize(); this.nor.push(_n.x, _n.y, _n.z);
      this.col.push(c.r, c.g, c.b); this.glo.push(gloss);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    this.count += p.count;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('gloss', new THREE.Float32BufferAttribute(this.glo, 1));
    const si = new Uint8Array(this.count * 4), sw = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) { si[i * 4] = this.ski[i * 4]; si[i * 4 + 1] = this.ski[i * 4 + 1]; sw[i * 4] = this.ski[i * 4 + 2]; sw[i * 4 + 1] = this.ski[i * 4 + 3]; }
    g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(this.idx);
    return g;
  }
}

// ---------- the shine ----------

/**
 * The gloss, painted once into a small picture of a shiny ball and read by every person's surface normal: a single texture look-up, so a phone can
 * afford it for a full room, in one draw call each. Red is how lit that side is; alpha is the white of the highlights, added on top.
 */
function matcap() {
  const S = 128, data = new Uint8Array(S * S * 4);
  const L = new THREE.Vector3(-0.32, 0.62, 0.72).normalize();
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = ((i + 0.5) / S) * 2 - 1, y = ((j + 0.5) / S) * 2 - 1, r2 = x * x + y * y, z = Math.sqrt(Math.max(0, 1 - r2));
    const ndl = Math.max(0, x * L.x + y * L.y + z * L.z);
    const rim = sstep(0.55, 1, r2);
    const lit = Math.min(1, 0.6 + 0.48 * Math.pow(ndl, 0.8)) * (1 - 0.18 * rim) * (1 - 0.42 * sstep(0.9, 1, r2));  // the edge falls away dark, so a person stands out from whatever is behind them
    // A big soft window highlight up and to the left, a long quiet sheen down the right flank, and a little light round the edge.
    const big = 0.9 * Math.exp(-(((x + 0.3) ** 2) / 0.03 + ((y - 0.56) ** 2) / 0.016));
    const soft = 0.18 * Math.exp(-(((x + 0.28) ** 2) / 0.15 + ((y - 0.5) ** 2) / 0.1));
    const flank = 0.14 * Math.exp(-(((x - 0.62) ** 2) / 0.012 + ((y + 0.18) ** 2) / 0.1));
    const edge = 0.03 * sstep(0.82, 1, r2);
    const a = Math.min(1, big + soft + flank + edge);
    const o = (j * S + i) * 4, v = Math.round(lit * 255);
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = Math.round(a * 255);
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}
/** One material for everyone: the colour is in the vertices, the gloss in the picture above, and its strength per part in the `gloss` attribute. */
export const CAST_MAT = new THREE.MeshMatcapMaterial({ vertexColors: true, matcap: matcap(), toneMapped: false, fog: false });
CAST_MAT.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float gloss;\nvarying float vGloss;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGloss = gloss;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vGloss;')
    .replace('vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;',
      'float lit = matcapColor.r;\nvec3 outgoingLight = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.0 + 1.1 * (1.0 - lit))) * mix(0.55, 1.05, lit) + vec3(matcapColor.a * vGloss);');
};
CAST_MAT.customProgramCacheKey = () => 'bean-gloss';


// ---------- dressing them ----------

/** How far the V of a neckline has dropped at this angle round the front. */
const vee = (th, half) => Math.max(0, 1 - Math.abs(th) / half);
const TOP = 0.2, HEM = -0.55, V_HALF = 0.62, V_BOTTOM = -0.1;

/** The white collar and shirt front, with the knot and blade of a tie. Everyone's collar sits where the top of the bean begins. */
function shirtAndTie(rig, body, s, q, tieEnd = -0.27) {
  const add = (name, pt, color, o, gl = 0.5) => rig.add(body, cloth(name, pt, o, q), color, M(), { gloss: gl });
  add('shirt', (u, v) => { const th = (u - 0.5) * 2 * (V_HALF + 0.14); return [th, mix(-0.22, TOP + 0.005 - 0.07 * vee(th, 0.55), v)]; }, WHITE, { nu: 16, nv: 10, off: 0.014, roll: 0.04 });
  add('tie', (u, v) => { const w = mix(0.05, 0.11, Math.min(1, v / 0.78)) * (v > 0.78 ? 1 - (v - 0.78) / 0.22 : 1); return [(u - 0.5) * 2 * w, mix(TOP - 0.1, tieEnd, v)]; }, s.tie, { nu: 6, nv: 12, off: 0.028, roll: 0.12 });
  const e = TOP - 0.07; rig.add(body, G.ball, s.tie, M(0, e * HH, surf(0, e).z + 0.03, 0.05, 0.042, 0.03), { gloss: 0.7 });
}
function suit(rig, body, s, q) {
  shirtAndTie(rig, body, s, q);
  const add = (name, pt, color, o, gl = 0.55) => rig.add(body, cloth(name, pt, o, q), color, M(), { gloss: gl }), lapel = mixHex(s.suit, '#ffffff', 0.1);
  // The jacket: all the way round, with a V at the front and a hem that curves away below the buttons.
  add('jacket', (u, v) => { const th = (u - 0.5) * Math.PI * 2; return [th, mix(HEM + 0.05 * Math.exp(-th * th * 6), mix(TOP - 0.18 * Math.sin(th) ** 2, V_BOTTOM, vee(th, V_HALF)), v)]; }, s.suit, { nu: 60, nv: 16, off: 0.04, roll: 0.06, wrap: true });
  for (const k of [-1, 1]) {
    // A lapel: a band folded back along each side of the V, wide at the collar and narrowing to the buttons.
    add(`lapel${k}`, (u, v) => [k * (V_HALF * (1 - v) + u * mix(0.3, 0.12, v)), mix(TOP + 0.01, V_BOTTOM, v) - u * 0.05], lapel, { nu: 8, nv: 10, off: 0.056, roll: 0.2 });
  }
  // The white collar: tight round the neck in the V, with a point on each side lying over the lapels.
  add('collar', (u, v) => { const th = (u - 0.5) * 1.5; return [th, mix(TOP - 0.03, TOP + 0.06 - 0.09 * vee(th, 0.28), v)]; }, WHITE, { nu: 18, nv: 4, off: 0.05, roll: 0.25 }, 0.65);
  for (const k of [-1, 1]) add(`point${k}`, (u, v) => [k * mix(0.04, 0.38, u * (1 - 0.55 * v)), mix(TOP + 0.02, TOP - 0.2, v)], WHITE, { nu: 5, nv: 6, off: 0.064, roll: 0.25 }, 0.6);
  // Buttons, down the front below the V.
  for (const e of [V_BOTTOM - 0.08, V_BOTTOM - 0.2]) rig.add(body, G.tiny, mixHex(s.suit, '#000000', 0.5), M(0.05, e * HH, surf(0.08, e).z + 0.048, 0.03, 0.03, 0.016), { gloss: 0.8 });
}
function waistcoat(rig, body, s, q) {
  shirtAndTie(rig, body, s, q);
  const add = (name, pt, color, o, gl = 0.5) => rig.add(body, cloth(name, pt, o, q), color, M(), { gloss: gl });
  add('vest', (u, v) => { const th = (u - 0.5) * Math.PI * 2; return [th, mix(-0.33 - 0.06 * vee(th, 0.5), mix(TOP - 0.03, -0.18, vee(th, 0.75)), v)]; }, s.suit, { nu: 56, nv: 14, off: 0.042, roll: 0.06, wrap: true });
  for (const e of [-0.22, -0.32]) rig.add(body, G.tiny, GOLD, M(0, e, surf(0, e).z + 0.05, 0.028, 0.028, 0.014), { gloss: 0.8 });
}
function hivis(rig, body, s, q) {
  const add = (name, pt, color, o) => rig.add(body, cloth(name, pt, o, q), color, M(), { gloss: 0.45 }), LIME = '#d8f53a';
  add('hivis', (u, v) => { const th = (u - 0.5) * Math.PI * 2; return [th, mix(-0.34, mix(TOP, 0.0, vee(th, 0.5)), v)]; }, '#ff7a1a', { nu: 48, nv: 12, off: 0.04, roll: 0.07, wrap: true });
  for (const e of [-0.1, -0.24]) add(`band${e}`, (u, v) => [(u - 0.5) * Math.PI * 2, e + v * 0.08], LIME, { nu: 40, nv: 2, off: 0.054, roll: 0.5, wrap: true });
}
function labcoat(rig, body, s, q) {
  const add = (name, pt, color, o, gl = 0.5) => rig.add(body, cloth(name, pt, o, q), color, M(), { gloss: gl });
  add('coat', (u, v) => { const th = (u - 0.5) * Math.PI * 2, k = Math.min(1, Math.max(0, (0.8 - Math.abs(th)) / 0.7)); return [th, mix(-0.7, mix(TOP, -0.7, k), v)]; }, '#f6f6f2', { nu: 56, nv: 16, off: 0.042, roll: 0.05, wrap: true });
  for (const k of [-1, 1]) add(`pocket${k}`, (u, v) => [k * mix(0.55, 1.0, u), mix(-0.5, -0.34, v)], '#e6e6df', { nu: 6, nv: 5, off: 0.056, roll: 0.25 });
}
function plainTie(rig, body, s, q) {
  shirtAndTie(rig, body, s, q, -0.48);
}
function trousers(rig, body, s, q) {
  // Only what shows below the jacket: they run up under it and close round the bottom of the body.
  rig.add(body, cloth('trousers', (u, v) => [(u - 0.5) * Math.PI * 2, mix(-0.992, HEM + 0.12, v)], { nu: 32, nv: 10, off: 0.02, roll: 0.05, wrap: true }, q), s.suit, M(), { gloss: 0.5 });
}

/** Hats sit round the top of the head: y 0 is the very top of the bean. */
function hatOf(rig, hat, s) {
  const a = s.accent, add = (g, c, m, gl = 0.6) => rig.add(hat, g, c, m, { gloss: gl });
  const dome = (c, y = -0.05, sx = 0.44, sy = 0.27, sz = sx * 0.88) => add(G.ball, c, M(0, y, 0, sx, sy, sz));
  const brim = (c, y, r, t = 0.05, z = 0) => add(G.cyl, c, M(0, y, z, r, t, r * 0.88));
  const clear = { cap: 0.18, beanie: 0.24, tophat: 0.68, crown: 0.42, crownlet: 0.2, party: 0.72, hardhat: 0.3, headphones: 0.12, cowboy: 0.45, wizard: 0.92, chef: 0.6, viking: 0.32, pirate: 0.34, beret: 0.14, propeller: 0.4, halo: 0.55, bowler: 0.3, detective: 0.3, explorer: 0.32, visor: 0.02 };
  switch (s.hat) {
    case 'hardhat': dome('#ffc21c', -0.04, 0.46, 0.34); brim('#ffc21c', -0.16, 0.58, 0.05, 0.05); add(G.ball, '#ffd65a', M(0, 0.25, 0, 0.05, 0.03, 0.34)); break;
    case 'tophat': brim(INK, -0.2, 0.54, 0.04); add(G.cyl, INK, M(0, 0.2, 0, 0.3, 0.78, 0.27)); add(G.cyl, a, M(0, -0.08, 0, 0.31, 0.11, 0.28)); break;
    case 'bowler': brim(INK, -0.17, 0.54, 0.035); dome(INK, -0.06, 0.4, 0.33); add(G.cyl, a, M(0, -0.14, 0, 0.385, 0.05, 0.35)); break;
    case 'beret': add(G.ball, PLUM, M(-0.04, -0.07, 0, 0.5, 0.14, 0.44, 0, 0, -0.18)); add(G.tiny, PLUM, M(-0.08, 0.07, 0, 0.04, 0.05, 0.04)); break;
    case 'detective': brim(TAN, -0.15, 0.56, 0.04); add(G.cyl, TAN, M(0, 0.02, 0, 0.32, 0.3, 0.28)); dome(TAN, 0.15, 0.32, 0.1); add(G.cyl, '#5a3a20', M(0, -0.09, 0, 0.325, 0.08, 0.285)); break;
    case 'explorer': dome(KHAKI, -0.03, 0.5, 0.36); brim(KHAKI, -0.2, 0.66, 0.045); add(G.tiny, '#c8a96e', M(0, 0.31, 0, 0.06, 0.045, 0.06)); break;
    case 'cap': dome(a, -0.06, 0.43, 0.25); add(softBox(0.44, 0.04, 0.34, 0.03), a, M(0, -0.17, 0.42, 1, 1, 1, 0.14)); break;
    case 'visor': add(G.cyl, '#16c464', M(0, -0.18, 0, 0.47, 0.06, 0.42)); add(softBox(0.56, 0.03, 0.34, 0.03), '#16c464', M(0, -0.16, 0.44, 1, 1, 1, 0.3)); break;
    case 'crownlet': add(G.cyl, GOLD, M(0, 0.03, 0, 0.22, 0.1, 0.19), 0.9); for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2; add(G.cone, GOLD, M(Math.cos(t) * 0.18, 0.14, Math.sin(t) * 0.15, 0.06, 0.16, 0.06), 0.9); } break;
    case 'crown': add(G.cyl, GOLD, M(0, 0.0, 0, 0.36, 0.16, 0.31), 0.9); for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2; add(G.cone, GOLD, M(Math.cos(t) * 0.31, 0.21, Math.sin(t) * 0.27, 0.09, 0.28, 0.09), 0.9); } break;
    case 'beanie': dome(a, -0.04, 0.47, 0.36); add(G.cyl, dim(a, 0.72), M(0, -0.19, 0, 0.48, 0.12, 0.43)); add(G.ball, WHITE, M(0, 0.36, 0, 0.1)); break;
    case 'party': add(G.cone, a, M(0.05, 0.28, 0, 0.26, 0.74, 0.26, 0, 0, -0.14)); add(G.ball, WHITE, M(0.11, 0.7, 0, 0.09)); break;
    case 'headphones': for (let i = 0; i <= 12; i++) { const t = (Math.PI * i) / 12; add(G.tiny, METAL, M(Math.cos(t) * 0.5, -0.46 + Math.sin(t) * 0.5, 0, 0.055)); } for (const k of [-1, 1]) add(softBox(0.18, 0.3, 0.26, 0.08), METAL, M(k * 0.52, -0.5, 0.03)); break;
    case 'cowboy': brim('#a06a30', -0.16, 0.78, 0.04); add(G.ball, '#a06a30', M(0, 0.02, 0, 0.36, 0.3, 0.32)); add(G.cyl, a, M(0, -0.1, 0, 0.365, 0.08, 0.325)); break;
    case 'wizard': brim('#4a3a99', -0.18, 0.58, 0.04); add(G.cone, '#4a3a99', M(0, 0.36, 0, 0.36, 1.1, 0.36, -0.08)); add(G.ball, GOLD, M(0.1, 0.25, 0.22, 0.06)); add(G.ball, GOLD, M(-0.08, 0.5, 0.14, 0.05)); break;
    case 'chef': add(G.cyl, '#fbf7ec', M(0, -0.04, 0, 0.36, 0.28, 0.32)); add(G.ball, '#fbf7ec', M(0, 0.24, 0, 0.5, 0.3, 0.44)); break;
    case 'viking': dome('#aab2ba', -0.05, 0.46, 0.34); add(G.cyl, '#7a5a38', M(0, -0.19, 0, 0.47, 0.1, 0.41)); for (const k of [-1, 1]) add(G.cone, '#f6ecd4', M(k * 0.54, 0.12, 0, 0.1, 0.46, 0.1, 0, 0, -k * 0.55)); break;
    case 'pirate': add(G.cyl, INK, M(0, -0.12, 0, 0.42, 0.08, 0.32)); add(G.box, INK, M(0, 0.04, 0, 0.92, 0.32, 0.34)); add(G.ball, WHITE, M(0, 0.1, 0.17, 0.1)); break;
    case 'propeller': dome(a, -0.06, 0.43, 0.25); add(G.cyl, METAL, M(0, 0.26, 0, 0.04, 0.18, 0.04)); add(G.box, '#ff4f9a', M(-0.26, 0.36, 0, 0.46, 0.03, 0.11)); add(G.box, '#2f9bff', M(0.26, 0.36, 0, 0.46, 0.03, 0.11)); break;
    case 'halo': add(G.ring, '#ffe27a', M(0, 0.42, 0, 0.32, 0.32, 0.32, Math.PI / 2), 0.9); break;
    default: return 0;
  }
  return clear[s.hat] ?? 0.25;
}
/** The writer's pencil, if anyone is ever given one: tucked where an ear would be. */
const earPencil = (rig, body) => { rig.add(body, G.sausage, GOLD, M(0.5, 0.62, -0.08, 0.035, 0.2, 0.035, 0.7, 0, -0.5), { gloss: 0.6 }); rig.add(body, G.cone, '#ffdca8', M(0.42, 0.66, 0.26, 0.035, 0.09, 0.035, 2.2, 0, -0.5), { gloss: 0.3 }); };
/** Glasses and the like sit on the beads. */
function glassesOf(rig, body, s) {
  const y = EYE_E * HH, g = EYE_X, z = eyeAt.z + 0.05, ring = (x, c, r = 0.135) => rig.add(body, G.ring, c, M(x, y, z, r, r, 0.3), { gloss: 0.8 });
  if (s.glasses === 'round') { ring(-g, PLUM); ring(g, PLUM); rig.add(body, G.tiny, PLUM, M(0, y + 0.02, z, 0.09, 0.016, 0.016)); }
  if (s.glasses === 'shades') { for (const k of [-1, 1]) rig.add(body, softBox(0.27, 0.17, 0.03, 0.05), '#14141b', M(k * g, y, z)); rig.add(body, G.box, '#14141b', M(0, y + 0.03, z, 0.16, 0.03, 0.02)); }
  if (s.glasses === 'monocle') { ring(g, GOLD, 0.14); for (let i = 1; i < 6; i++) rig.add(body, G.tiny, GOLD, M(g + 0.12 + i * 0.01, y - 0.12 - i * 0.06, z - i * 0.012, 0.012)); }
  if (s.glasses === 'eyepatch') { rig.add(body, softBox(0.24, 0.2, 0.03, 0.06), '#14141b', M(-g, y, z)); rig.add(body, G.box, '#14141b', M(-0.05, y + 0.1, z - 0.02, 1.0, 0.02, 0.012, 0, 0, -0.32)); }
}

// ---------- a person ----------

const DETAIL = { 1: [44, 30], 0.7: [32, 20], 0.45: [22, 14] };
const hide = (o) => o.scale.setScalar(1e-4);
const SHOULDER = 0.08, HIP_X = 0.33, HIP_Y = 0.44;

export class Creature {
  constructor(spec, { detail = 1 } = {}) {
    this.spec = spec;
    G = GEO[detail] || GEO[0.7];
    const rig = new Rig(), q = detail >= 1 ? 1 : detail >= 0.7 ? 0.72 : 0.42, s = spec, c = s.color, restY = LEG + HH, kinds = [-1, 1];
    const root = rig.bone(null), body = rig.bone(root, 0, restY, 0);
    const armPivot = kinds.map((k) => rig.bone(body, k * 0.62, SHOULDER, -0.02));
    const fore = armPivot.map((a) => rig.bone(a, 0, -0.24, 0));
    const hand = fore.map((f) => rig.bone(f, 0, -0.2, 0));
    const fist = hand.map((h) => rig.bone(h, 0, -0.17, 0));
    const thumb = hand.map((h, i) => rig.bone(h, kinds[i] * -0.1, -0.08, 0.03));
    const legPivot = kinds.map((k) => rig.bone(root, k * HIP_X, HIP_Y, 0.03));
    const eyes = kinds.map((k) => rig.bone(body, k * EYE_X, EYE_E * HH, eyeAt.z - 0.01));
    const hat = rig.bone(body, 0, HH, kidney(1));
    const paper = rig.bone(body, 0, -0.2, 0.88), mug = rig.bone(hand[1], 0, -0.1, 0.08), phone = rig.bone(hand[1], 0, -0.08, 0.1);

    const [N, R] = DETAIL[detail] || DETAIL[0.7];
    rig.add(body, beanGeometry(N, R), c, M(), { gloss: 1 });
    const sleeved = s.outfit === 'suit' || s.outfit === 'labcoat' || s.outfit === 'waistcoat';
    const sleeve = s.outfit === 'suit' ? s.suit : s.outfit === 'labcoat' ? '#f6f6f2' : s.outfit === 'waistcoat' ? WHITE : c;
    const rings = Math.max(4, Math.round(8 * q)), sides = Math.max(6, Math.round(11 * q));
    for (const i of [0, 1]) {
      const k = kinds[i];
      // The arm: sleeve to the wrist, a white cuff, then a chunky hand of sausage fingers in the body colour.
      rig.add(armPivot[i], G.ball, sleeve, M(0, 0.01, 0, 0.165, 0.165, 0.165), { gloss: sleeved ? 0.55 : 1 });
      rig.add(armPivot[i], armTube(0.04, -0.36, rings, sides, sleeved ? 1.1 : 1), sleeve, M(), { gloss: sleeved ? 0.55 : 1, blend: { bone: fore[i], w: (p) => sstep(-0.18, -0.3, p.y) } });
      if (s.outfit === 'suit') rig.add(fore[i], armTube(-0.34, -0.41, 2, sides, 1.16), WHITE, M(0, 0.24, 0), { gloss: 0.6 });
      else rig.add(fore[i], armTube(-0.36, -0.42, 2, sides), sleeved ? WHITE : c, M(0, 0.24, 0), { gloss: 0.8 });
      rig.add(hand[i], G.ball, c, M(0, -0.075, 0, 0.145, 0.12, 0.1));
      // Three fat fingers fanned out, and a stubby thumb on the inside.
      const fingers = [[-0.3, -0.105, 0.135], [0, 0, 0.145], [0.3, 0.105, 0.135]];
      for (const [a, x, l] of fingers) rig.add(fist[i], G.sausage, c, M(x, -0.01 - l * 0.34, 0, 0.056, l * 0.48, 0.056, 0, 0, a));
      rig.add(thumb[i], G.sausage, c, M(0, -0.06, 0, 0.052, 0.085, 0.052));
      // A short stumpy leg, trousered or bare, on a rounded flat-soled foot.
      rig.add(legPivot[i], G.sausage, s.trousers ? s.suit : c, M(0, -0.16, 0, 0.15, 0.12, 0.155), { gloss: s.trousers ? 0.55 : 1 });
      rig.add(legPivot[i], G.foot, c, M(0, -HIP_Y, 0.05, 1.08, 1, 1.32));
    }
    if (s.trousers) trousers(rig, body, s, q);
    ({ suit, waistcoat, hivis, labcoat, tie: plainTie }[s.outfit] || (() => {}))(rig, body, s, q);
    // The two tiny black bead eyes, each with its speck of light.
    for (const e of eyes) { rig.add(e, G.ball, INK, M(0, 0, 0, 0.062, 0.062, 0.042), { gloss: 0.6 }); rig.add(e, G.tiny, '#ffffff', M(-0.019, 0.024, 0.037, 0.016, 0.016, 0.01), { gloss: 0 }); }
    const clear = hatOf(rig, hat, s);
    if (s.hat === 'earpencil') earPencil(rig, body);
    if (s.glasses) glassesOf(rig, body, s);
    // What a person may pick up: shown by scaling their bone up from nothing, so they cost no extra draw calls.
    rig.add(paper, G.box, PAPER, M(0, 0, 0, 0.5, 0.03, 0.64, 0.25), { gloss: 0.3 }); rig.add(paper, G.box, '#b8c0cc', M(0, 0.03, -0.02, 0.32, 0.006, 0.34, 0.25), { gloss: 0.1 });
    rig.add(mug, G.cyl, s.accent, M(0, 0, 0, 0.11, 0.22, 0.11)); rig.add(mug, G.ring, s.accent, M(0.14, 0, 0, 0.075, 0.075, 0.1, 0, 0, Math.PI / 2)); rig.add(mug, G.ball, '#6b4a2e', M(0, 0.11, 0, 0.09, 0.02, 0.09), { gloss: 0.2 });
    rig.add(phone, softBox(0.16, 0.3, 0.035, 0.025), '#23232b', M()); rig.add(phone, softBox(0.13, 0.24, 0.01, 0.008), '#9fd8ff', M(0, 0, 0.022), { gloss: 0.3 });

    this.group = new THREE.Group();
    this.group.add(root);
    const geo = rig.geometry();
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(rig.bones, rig.bones.map((b) => new THREE.Matrix4().makeTranslation(-b.userData.at.x, -b.userData.at.y, -b.userData.at.z)));
    const mesh = new THREE.SkinnedMesh(geo, CAST_MAT);
    mesh.castShadow = true; mesh.frustumCulled = false;
    this.group.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
    this.mesh = mesh;
    // Where the group goes, its height and how far the head reaches: all a chair and a name tag need to know.
    this.height = H + LEG; this.bottom = LEG; this.labelClear = clear;
    this.B = { root, body, armPivot, fore, hand, fist, thumb, legPivot, eyes, hat, paper, mug, phone };
    this.rest = { bodyY: restY, hatY: hat.position.y, eyeX: eyes.map((e) => e.position.x), eyeY: eyes[0].position.y };
    hide(paper); hide(mug); hide(phone);
    this.paper = { visible: false }; this.mug = { visible: false }; this.phone = { visible: false };
    this.t = (spec.id % 1000) / 37; this.step = spec.phase; this.blinkAt = 1 + (spec.id % 300) / 90;
    this.nextFidget = 2 + (spec.id % 7); this.fidget = -1; this.fidgetT = 0; this.stumbleT = -1; this.nextStumble = 7 + ((spec.id >>> 4) % 11);
    this.hopT = -1; this.wide = 1; this.shut = 0; this.hatP = 0; this.hatV = 0; this.peekT = -1; this.nextPeek = 3 + (spec.id % 9); this.audience = null;
    this.pose(0, 0, { walk: 0, sit: 0, type: 0, talk: 0, carry: 0, cheer: 0, think: 0, listen: 0, stretch: 0, sip: 0, phone: 0, pour: 0 });
  }
  /** A little jump for joy when a job is finished. */
  celebrate() { this.hopT = 0; }
  pose(dt, speed, b, ty, m) {
    const s = this.spec, t = (this.t += dt), B = this.B, sit = Math.min(1, b.sit), stand = 1 - sit, walk = Math.min(stand, b.walk), lean0 = m?.lean ?? 0;
    const p = t * 2.5 + s.phase, side = (i) => (i ? 1 : -1);
    // Squash and stretch breathes through everything, one wobble per person.
    let squash = Math.sin(p) * (0.016 + 0.012 * stand), hop = 0, tilt = Math.sin(p * 0.53) * 0.016 + lean0 * stand, pitch = 0, turn = Math.sin(t * 0.61 + s.phase) * 0.1 * (1 - b.type);
    let lookX = Math.sin(t * 0.7 + s.phase) * 0.012, lookY = 0, eyeOpen = 1, jit = 0, sway = 0, shut = 0;
    // A waddle: short quick steps, the body rocking from foot to foot and dipping on each one.
    this.step += dt * (8.2 + (m ? (m.pace - 2.6) * 2.4 : 0)) * (speed > 0.01 ? 1 : 0.3);
    const st = this.step, sw = Math.sin(st);
    hop += Math.abs(sw) * 0.11 * walk; squash += Math.cos(st * 2) * 0.05 * walk; tilt += sw * 0.14 * walk * (1 + (m?.sway ?? 0) * 0.2); sway = sw * 0.06 * walk; pitch += 0.05 * walk;
    // A stumble now and then, on the way somewhere. Harmless, and they look very surprised about it.
    if (walk > 0.6) { this.nextStumble -= dt; if (this.nextStumble <= 0 && this.stumbleT < 0) { this.stumbleT = 0; this.nextStumble = 11 + Math.random() * 18; } }
    let stum = 0;
    if (this.stumbleT >= 0) {
      this.stumbleT += dt;
      const u = this.stumbleT / 0.55;
      if (u >= 1) this.stumbleT = -1; else { stum = Math.sin(u * Math.PI); pitch += stum * 0.42; hop += stum * 0.12; tilt += Math.sin(u * Math.PI * 3) * 0.1 * stum; eyeOpen = Math.max(eyeOpen, 1 + 0.5 * stum); }
    }
    // The jump for joy: a crouch, up, and a squashy landing. In the air it's his pose: one arm up, one leg raised.
    let joy = 0;
    if (this.hopT >= 0) {
      this.hopT += dt;
      const u = this.hopT / 0.9;
      if (u >= 1) this.hopT = -1;
      else if (u < 0.22) { const k = Math.sin((u / 0.22) * Math.PI * 0.5); squash -= 0.16 * k; joy = 0.5 * k; }
      else if (u < 0.76) { const a = (u - 0.22) / 0.54; hop += Math.sin(a * Math.PI) * 0.62; squash += 0.12 * Math.sin(a * Math.PI); joy = 1; }
      else { squash -= 0.14 * Math.sin(((u - 0.76) / 0.24) * Math.PI); joy = 0.7; }
    }
    // Cheer: the happy pose, hopping on the spot.
    hop += Math.abs(Math.sin(t * 7)) * 0.22 * b.cheer; squash += Math.cos(t * 14) * 0.05 * b.cheer; joy = Math.max(joy, b.cheer);
    eyeOpen = Math.max(eyeOpen, 1 + 0.25 * joy);
    // When they're not busy, something of their own: a wave, a leg in the air, a hop, hands on hips, a thumbs up or a small bow with the eyes shut.
    const free = 1 - Math.min(1, b.walk + b.type + b.talk + b.cheer + b.carry + b.stretch + b.sip + b.phone + b.pour + b.think);
    if (free > 0.8) { this.nextFidget -= dt; if (this.nextFidget <= 0 && this.fidget < 0) { this.fidget = Math.floor(Math.random() * 6); this.fidgetT = 0; this.nextFidget = 4 + Math.random() * 7; } }
    let wave = 0, legUp = 0, hips = 0, thumbs = 0, bow = 0;
    if (this.fidget >= 0) {
      this.fidgetT += dt;
      const len = [1.7, 1.5, 0.9, 2.2, 1.8, 2][this.fidget], u = this.fidgetT / len, g = Math.sin(Math.PI * Math.min(1, u)), hold = Math.min(1, Math.min(u, 1 - u) * 6);
      if (u >= 1 || free < 0.5) this.fidget = -1;
      else if (this.fidget === 0) { wave = hold; tilt += 0.07 * g; }
      else if (this.fidget === 1) { if (stand > 0.8) { legUp = hold; tilt += 0.1 * g * (s.id % 2 ? 1 : -1); eyeOpen = Math.max(eyeOpen, 1.12); } else wave = hold; }
      else if (this.fidget === 2) { if (stand > 0.8) { hop += g * 0.42; squash += Math.sin(u * Math.PI * 2) * 0.1; } else lookX += Math.sin(u * Math.PI * 2) * 0.05 * g; }
      else if (this.fidget === 3) { hips = stand > 0.8 ? hold : 0; turn += Math.sin(u * Math.PI * 2) * 0.2 * g; }
      else if (this.fidget === 4) thumbs = hold;
      else { bow = hold; shut = Math.max(shut, hold); }
    }
    // Seated with their back to us, every so often they swivel right round in the chair to see who's watching, eyes wide, and go back to it.
    let peek = 0;
    if (sit > 0.6 && this.audience != null) {
      this.nextPeek -= dt;
      if (this.nextPeek <= 0 && this.peekT < 0) { this.peekT = 0; this.nextPeek = 7 + Math.random() * 15; }
    }
    if (this.peekT >= 0) { this.peekT += dt; const u = this.peekT / 2.6; if (u >= 1) this.peekT = -1; else peek = Math.min(1, Math.min(u, 1 - u) * 5); }
    // Frantic at the keys: everything quivers, and the eyes never leave the screen.
    const on = ty?.on ?? 0;
    if (b.type > 0.01) {
      pitch += 0.06 * b.type; jit = b.type * on;
      squash += Math.sin(t * 22 + s.phase) * 0.013 * jit; hop += Math.abs(Math.sin(t * 15 + s.phase)) * 0.018 * jit;
      lookY -= 0.03 * b.type * on; lookY += 0.012 * b.type * (ty?.look ?? 0); turn = turn * (1 - b.type) + b.type * ((ty?.glance ?? 0) * 0.5 + Math.sin(t * 0.8 + s.phase) * 0.06);
    }
    if (peek > 0.01) { const aim = Math.atan2(Math.sin(this.audience), Math.cos(this.audience)); turn += (Math.max(-2.7, Math.min(2.7, aim)) - turn) * peek; eyeOpen = Math.max(eyeOpen, 1 + 0.22 * peek); pitch -= 0.04 * peek; lookY += 0.015 * peek; }
    if (b.think > 0.01) { lookY += 0.04 * b.think; lookX += 0.04 * b.think; turn += Math.sin(t * 0.9) * 0.08 * b.think; }
    if (b.listen > 0.01) { const nod = Math.sin(t * 1.7); pitch += (nod > 0.7 ? (nod - 0.7) * 2.4 : 0) * 0.13 * b.listen; }
    if (b.sip > 0.01) eyeOpen = Math.min(eyeOpen, 1 - 0.5 * b.sip);
    if (b.stretch > 0.01) { shut = Math.max(shut, 0.9 * b.stretch); squash += 0.08 * b.stretch; }
    if (b.pour > 0.01) lookY -= 0.02 * b.pour;
    if (b.phone > 0.01) lookX -= 0.02 * b.phone;
    // Talking: no mouth to do it with, so the whole body nods along and the eyes get wider on the words.
    const talk = Math.max(b.talk, b.phone * 0.9);
    if (talk > 0.01) { squash += Math.sin(t * 6 + s.phase) * 0.03 * talk; tilt += Math.sin(t * 3 + s.phase) * 0.05 * talk; pitch += (Math.sin(t * 6.5 + s.phase) > 0.2 ? 0.05 : 0) * talk; eyeOpen = Math.max(eyeOpen, 1 + 0.2 * talk * (0.5 + 0.5 * Math.sin(t * 9))); }
    // The arms, one weight at a time: `a` swings them forward, `o` splays them out from the body, `e` bends the elbow forward and `n` folds the forearm in.
    let aL = 0.12 + 0.3 * sit, aR = 0.12 + 0.3 * sit, oL = 0.18, oR = 0.18, eL = 0.25 + 0.35 * sit, eR = 0.25 + 0.35 * sit, nL = 0, nR = 0;
    const to = (w, ta, tb, ao, bo, ea = eL, eb = eR) => { aL += (ta - aL) * w; aR += (tb - aR) * w; oL += (ao - oL) * w; oR += (bo - oR) * w; eL += (ea - eL) * w; eR += (eb - eR) * w; };
    aL += -sw * 0.6 * walk; aR += sw * 0.6 * walk;
    if (b.talk > 0.01) to(b.talk, 0.42 + Math.sin(t * 3.3) * 0.14, 1.1 + Math.sin(t * 5 + s.phase) * 0.34, 0.15, 0.5, 0.5, 0.7);
    if (b.listen > 0.01) to(b.listen, 0.3, 0.3, 0.05, 0.05, 0.4, 0.4);
    if (b.carry > 0.01) to(b.carry, 1.1, 1.1, -0.3, -0.3, 0.3, 0.3);
    if (b.think > 0.01) to(b.think, 0.4, 1.2, 0.12, -0.3, 0.4, 1.6);
    if (b.stretch > 0.01) to(b.stretch, 2.9, 2.9, 0.3, 0.3, 0.2, 0.2);
    if (b.sip > 0.01) { const k = this.sip ?? 0; to(b.sip, 0.2, 1.1 + 0.3 * k, 0.2, -0.35, 0.3, 1.0 + 0.4 * k); }
    if (b.phone > 0.01) to(b.phone, 0.3, 1.9, 0.2, 0.55, 0.3, 1.5);
    if (b.pour > 0.01) to(b.pour, 0.25, 1.05, 0.2, -0.14, 0.3, 0.4);
    // Hands out over the keys, tapping as fast as they can go.
    if (b.type > 0.01) to(b.type, 1.05 + (ty?.l ?? 0) * 0.32, 1.05 + (ty?.r ?? 0) * 0.32, -0.5, -0.5, 0.55, 0.55);
    if (b.cheer > 0.01 || joy > 0.01) { const up = s.id % 2, w = joy; if (up) to(w, 2.9 + Math.sin(t * 11) * 0.2, 0.3, 0.3, 1.2, 0.3, 0.3); else to(w, 0.3, 2.9 + Math.sin(t * 11) * 0.2, 1.2, 0.3, 0.3, 0.3); }
    if (wave > 0.01) { const up = 2.75 + Math.sin(t * 16) * 0.28; aR += (up - aR) * wave; oR += (0.75 - oR) * wave; eR += (0.25 + Math.sin(t * 16) * 0.25 - eR) * wave; }
    if (legUp > 0.01) { const up = s.id % 2; if (up) to(legUp, 2.7, 0.3, 0.3, 1.2, 0.3, 0.3); else to(legUp, 0.3, 2.7, 1.2, 0.3, 0.3, 0.3); }
    if (hips > 0.01) { oL += (0.95 - oL) * hips; oR += (0.95 - oR) * hips; aL += (-0.08 - aL) * hips; aR += (-0.08 - aR) * hips; eL *= 1 - hips; eR *= 1 - hips; nL += 1.9 * hips; nR += 1.9 * hips; }
    if (thumbs > 0.01) { aR += (1.15 - aR) * thumbs; oR += (0.28 - oR) * thumbs; eR += (0.62 - eR) * thumbs; }
    if (bow > 0.01) to(bow, 0.5, 0.5, -0.5, -0.5, 0.55, 0.55);
    if (stum > 0.01) { aL += stum * 1.9; aR += stum * 1.7; oL += stum * 0.5; oR += stum * 0.5; }
    pitch += bow * 0.55;
    B.armPivot[0].rotation.set(-aL, 0, -oL); B.armPivot[1].rotation.set(-aR, 0, oR);
    B.fore[0].rotation.set(-eL, 0, nL); B.fore[1].rotation.set(-eR, 0, -nR);
    // Thumbs up: three fingers close into a fist, and the thumb stands up.
    B.fist[1].scale.setScalar(1 - 0.55 * thumbs); B.fist[0].scale.setScalar(1);
    B.thumb[1].rotation.x = -1.5 * thumbs; B.thumb[1].scale.setScalar(1 + 0.2 * thumbs);
    // Legs: quick little steps, or stuck out off the chair with the odd swing, soles to the world.
    const dangle = Math.sin(t * 2.3 + s.phase) * 0.12 * sit, liftL = s.id % 2 ? legUp : 0, liftR = s.id % 2 ? 0 : legUp;
    const joyLeg = joy > 0.3 ? joy : 0;
    B.legPivot[0].rotation.x = sw * 0.62 * walk - 1.3 * sit + dangle - 1.25 * (liftL + (s.id % 2 ? joyLeg : 0));
    B.legPivot[1].rotation.x = -sw * 0.62 * walk - 1.3 * sit - dangle - 1.25 * (liftR + (s.id % 2 ? 0 : joyLeg));
    B.legPivot[0].rotation.z = -0.06 * stand; B.legPivot[1].rotation.z = 0.06 * stand;
    // The whole soft body: squash from the feet, a lean, a bit of bounce, and the head-end turning to look about.
    B.root.position.set(sway, hop, jit * Math.sin(t * 31) * 0.01); B.root.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.4);
    B.root.rotation.set(pitch, 0, tilt);
    B.body.position.y = this.rest.bodyY; B.body.rotation.y = turn;
    // A hat, if they have one, gets a beat behind on the way up and comes down a beat late.
    const h = Math.min(dt, 0.05), acc = (hop - this.hatP) * 190 - this.hatV * 13; this.hatV += acc * h; this.hatP += this.hatV * h;
    B.hat.position.y = this.rest.hatY + Math.min(0.4, Math.max(0, this.hatP - hop)); B.hat.rotation.z = -tilt * 0.5;
    this.scaleOf(B.paper, this.paper.visible ? Math.max(1e-4, b.carry) : 1e-4);
    this.scaleOf(B.mug, this.mug.visible ? 1 : 1e-4); this.scaleOf(B.phone, this.phone.visible ? 1 : 1e-4);
    this.sip = (this.sip ?? 0) + ((Math.sin(t * 1.4) > 0.3 ? 1 : 0) - (this.sip ?? 0)) * Math.min(1, dt * 6);
    // Eyes: a blink, a glance, wide when surprised, shut for a bow or a stretch.
    const faceE = 1 - Math.exp(-dt * 14);
    if (t > this.blinkAt + 0.14) this.blinkAt = t + 3.2 + ((s.id >>> 9) % 8) * 0.25 + Math.random() * 1.6;
    const blink = t >= this.blinkAt ? Math.max(0.12, Math.abs(((t - this.blinkAt) / 0.14) * 2 - 1)) : 1;
    this.wide += (eyeOpen - this.wide) * faceE; this.shut += (shut - this.shut) * faceE;
    for (let i = 0; i < 2; i++) {
      B.eyes[i].scale.set(this.wide, Math.max(0.12, Math.min(blink, 1 - this.shut * 0.88) * this.wide), this.wide);
      B.eyes[i].position.x = this.rest.eyeX[i] + lookX; B.eyes[i].position.y = this.rest.eyeY + lookY;
    }
  }
  scaleOf(b, v) { if (b.scale.x !== v) b.scale.setScalar(v); }
  dispose() { this.mesh.geometry.dispose(); this.mesh.skeleton.dispose(); this.group.removeFromParent(); }
}

const SVG = 'http://www.w3.org/2000/svg';
const shape = (name, attrs) => { const el = document.createElementNS(SVG, name); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
/** The drawn stand-in in the lists, until the photo is developed: the same little fellow, the top of the bean with its dot eyes over the collar, lapels and tie. */
export function drawnFace(spec) {
  const svg = shape('svg', { viewBox: '0 0 84 100', 'aria-hidden': 'true', class: 'portrait-drawn' });
  svg.append(shape('path', { d: 'M42 14C60 14 72 30 72 54C72 88 62 100 42 100C22 100 12 88 12 54C12 30 24 14 42 14Z', fill: spec.color }));
  svg.append(shape('path', { d: 'M12 74C14 92 22 100 42 100C62 100 70 92 72 74C60 66 52 58 42 58C32 58 24 66 12 74Z', fill: spec.suit }));
  svg.append(shape('path', { d: 'M28 64L42 58L56 64L42 86Z', fill: '#fbfaf5' }));
  svg.append(shape('path', { d: 'M39.5 64H44.5L46 80L42 86L38 80Z', fill: spec.tie }));
  svg.append(shape('ellipse', { cx: 33, cy: 30, rx: 8, ry: 5, fill: '#fff', opacity: 0.45, transform: 'rotate(-24 33 30)' }));
  for (const x of [33, 51]) svg.append(shape('circle', { cx: x, cy: 42, r: 3.4, fill: '#17151c' }), shape('circle', { cx: x - 1.1, cy: 40.8, r: 0.9, fill: '#fff' }));
  return svg;
}
/** Which way to look to take a good photo of them: how much of their height to frame, as a share of it. */
export const PORTRAIT_FRAME = { top: 1.02, view: 1.05 };
