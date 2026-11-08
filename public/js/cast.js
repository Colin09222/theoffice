// The cast. Everyone in the office is one of these: a soft, squishy, big-eyed little creature with a job prop, made entirely in code, so a
// floor opens without waiting for a single model. This file is all there is to how the staff look and move: to change the cast, replace it.
// character.js is the interface the rooms drive, and portrait.js photographs whatever this builds.
//
// What a replacement has to provide:
//   specFor(look, { role, accent }) -> a spec: the same person every time for the same look and role
//   class Creature(spec, { detail }): .group, .height, .bottom, .labelClear, .mug/.phone/.paper (objects with .visible), .pose(dt, speed, b, ty, m), .celebrate(), .dispose()
//   drawnFace(spec) -> an SVG for the lists, until the portrait comes back
//
// A person is ONE skinned mesh (one draw call): every part is baked into a single vertex-coloured geometry, rigidly bound to a bone.
import * as THREE from '../vendor/three/three.module.min.js';
import { PEOPLE_RAMP, outlineMaterial } from './toon.js';

// ---------- who someone is ----------

const VIVID = ['#ff8a1f', '#ffc91f', '#ff4f4f', '#ff4f9a', '#b95cf7', '#7a5cff', '#2f9bff', '#12c8e8', '#12d19a', '#5fd82b', '#a8e01f', '#ff6f6f'];
const SHAPES = [
  { w: 1.53, h: 1.93, power: 3.5, taper: 0.16, eyeGap: 0.29, eyeY: 0.29 },
  { w: 1.78, h: 1.57, power: 4.3, eyeGap: 0.35, eyeY: 0.19 },
  { w: 1.62, h: 1.82, power: 2.7, taper: -0.23, eyeGap: 0.29, eyeY: 0.25 },
  { w: 1.79, h: 1.65, power: 2.5, lobe: 0.085, petals: 5, eyeGap: 0.32, eyeY: 0.22 },
  { w: 1.75, h: 1.83, power: 3.3, taper: 0.14, eyeGap: 0.32, eyeY: 0.29 },
  { w: 1.55, h: 2.03, power: 3.0, pinch: 0.13, lobe: 0.035, petals: 3, eyeGap: 0.29, eyeY: 0.32 },
];
const hashOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const hsl = { h: 0, s: 0, l: 0 };
const C = (hex) => new THREE.Color(hex);
const mixHex = (a, b, t) => `#${C(a).lerp(C(b), t).getHexString()}`;
const dim = (hex, f) => `#${C(hex).multiplyScalar(f).getHexString()}`;
/** Bright enough to pop at room size, from a colour that may be anything at all (a navy suit, a black hoodie). */
function vivid(hex) {
  C(hex).getHSL(hsl);
  const c = new THREE.Color().setHSL(hsl.h, Math.max(0.78, hsl.s), Math.min(0.6, Math.max(0.5, hsl.l + 0.08)));
  return `#${c.getHexString()}`;
}
function bodyColour(look, h) {
  const out = look.outfitColor || '#2f9bff';
  C(out).getHSL(hsl);
  // A colourful outfit picks the person's colour; a grey, black or white one leaves it to everything else about them.
  let i = hsl.s > 0.22 ? nearestHue(hsl.h) : h % VIVID.length;
  i = (i + ((h >> 5) % 3) - 1 + VIVID.length) % VIVID.length;
  return VIVID[i];
}
function nearestHue(hue) {
  let best = 0, gap = 2;
  VIVID.forEach((c, i) => { C(c).getHSL(hsl); const d = Math.min(Math.abs(hsl.h - hue), 1 - Math.abs(hsl.h - hue)); if (d < gap) { gap = d; best = i; } });
  return best;
}

/** Each job's two things: what they wear all day (visible at the desk) and what they carry around (put down when they sit). */
export const JOBS = {
  boss: { worn: 'crownlet', held: 'mug' }, manager: { worn: 'tie', held: 'clipboard' }, builder: { worn: 'headset', held: 'laptop' },
  designer: { worn: 'beret', held: 'brush' }, tester: { worn: 'loupe', held: 'bug' }, lawyer: { worn: 'specs', held: 'briefcase' },
  researcher: { worn: 'papers', held: 'book' }, writer: { worn: 'earpencil', held: 'notepad' }, analyst: { worn: 'visor', held: 'chart' },
  marketer: { worn: 'starpin', held: 'megaphone' }, illustrator: { worn: 'splats', held: 'palette' },
};

/** Everything about a person that is theirs: from their own look and job, so it never changes across reloads. */
export function specFor(look = {}, { role = '', accent = '#d9774a' } = {}) {
  const key = JSON.stringify([look.skin, look.hair, look.hairColor, look.outfit, look.outfitColor, look.hat, look.glasses, look.wear]);
  const h = hashOf(key);
  const shape = SHAPES[(h >> 3) % SHAPES.length];
  const color = bodyColour(look, h), hair = look.hairColor ? mixHex(look.hairColor, vivid(look.hairColor), 0.45) : '#4a2f1d';
  return {
    ...shape, h: shape.h, id: h, role, accent, look, color, dark: dim(color, 0.66),
    hairColor: hair, cheek: mixHex('#ff5d78', look.skin || '#f6d7bd', 0.2), phase: ((h >> 7) % 628) / 100,
    browTilt: [0.11, 0.26, -0.18, 0.05][(h >> 11) % 4], mouthWide: 0.86 + ((h >> 13) % 5) * 0.06, eyeBig: 0.9 + ((h >> 16) % 4) * 0.09,
    wonky: (h >> 18) % 5 === 0, job: JOBS[role] || (role ? { worn: null, held: 'mug' } : { worn: null, held: null }),
  };
}

// ---------- the parts ----------

const GEO = {
  ball: new THREE.SphereGeometry(1, 14, 10), tiny: new THREE.SphereGeometry(1, 8, 6),
  arm: new THREE.CapsuleGeometry(1, 1, 3, 8), box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12), cone: new THREE.ConeGeometry(1, 1, 10),
  ring: new THREE.TorusGeometry(1, 0.105, 5, 22),
  brow: new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.16, 0, 0), new THREE.Vector3(0, 0.07, 0), new THREE.Vector3(0.16, 0, 0)), 7, 0.03, 4, false),
};
const INK = '#2a2233', WHITE = '#fffdf3', PAPER = '#fff9e9', GOLD = '#f2b632', METAL = '#39424e', PLUM = '#5b385a';
const smileShape = new THREE.Shape();
smileShape.moveTo(-0.405, 0.04);
smileShape.bezierCurveTo(-0.18, -0.005, 0.12, 0.005, 0.405, 0.07);
smileShape.bezierCurveTo(0.37, -0.34, -0.28, -0.39, -0.405, 0.04);
GEO.smile = new THREE.ShapeGeometry(smileShape, 7);
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

/** The soft pillow of a body: a rounded outline, puffed out front and back. */
function pillow(spec, N, M_) {
  const pos = [], idx = [], signed = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
  for (let j = 0; j <= M_; j++) {
    const lat = -Math.PI / 2 + (Math.PI * j) / M_, radial = Math.pow(Math.max(0, Math.cos(lat)), 0.67);
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      let x = signed(Math.cos(a), 2 / spec.power), y = signed(Math.sin(a), 2 / spec.power);
      const lobes = 1 + (spec.lobe || 0) * Math.cos((spec.petals || 3) * a + 0.3);
      x *= 1 + (spec.taper || 0) * y;
      if (spec.pinch) x *= 1 - spec.pinch * Math.exp(-y * y * 7);
      pos.push(x * spec.w * 0.5 * radial * lobes, y * spec.h * 0.5 * radial * lobes, 0.59 * Math.sin(lat));
    }
  }
  for (let j = 0; j < M_; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + N + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  // Weld the shading across the seam and at the two poles, so the toon bands run round without a crease.
  const n = g.attributes.normal;
  for (let i = 0; i <= N; i++) { n.setXYZ(i, 0, 0, -1); n.setXYZ(M_ * (N + 1) + i, 0, 0, 1); }
  for (let j = 1; j < M_; j++) { const a = j * (N + 1), b = a + N; _n.fromBufferAttribute(n, a).add(_v.fromBufferAttribute(n, b)).normalize(); n.setXYZ(a, _n.x, _n.y, _n.z); n.setXYZ(b, _n.x, _n.y, _n.z); }
  return g;
}

/** Collects parts into one geometry, each vertex tied to the bone it rides on. */
class Rig {
  constructor() { this.bones = []; this.pos = []; this.nor = []; this.col = []; this.idx = []; this.ski = []; this.count = 0; this.color = new THREE.Color(); }
  bone(parent, x = 0, y = 0, z = 0) {
    const b = new THREE.Bone(); b.position.set(x, y, z); b.userData.at = new THREE.Vector3(x, y, z).add(parent ? parent.userData.at : new THREE.Vector3());
    if (parent) parent.add(b);
    b.userData.i = this.bones.length; this.bones.push(b);
    return b;
  }
  add(bone, geo, color, m) {
    const c = this.color.set(color), p = geo.attributes.position, n = geo.attributes.normal, base = this.count, at = bone.userData.at, bi = bone.userData.i;
    _nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m).add(at); this.pos.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize(); this.nor.push(_n.x, _n.y, _n.z);
      this.col.push(c.r, c.g, c.b); this.ski.push(bi);
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
    const si = new Uint8Array(this.count * 4), sw = new Float32Array(this.count * 4);
    for (let i = 0; i < this.count; i++) { si[i * 4] = this.ski[i]; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(this.idx);
    return g;
  }
}

/** One material for everyone: the colour is in the vertices and the shading comes from the shared ramp. */
export const CAST_MAT = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: PEOPLE_RAMP });
const OUTLINE_MAT = outlineMaterial('#241b2d', 0.022);

// ---------- dressing them up ----------

function hairOf(rig, body, s) {
  const c = s.hairColor, top = s.h * 0.5, side = s.w * 0.5, ball = (x, y, z, sx, sy = sx, sz = sx, rz = 0) => rig.add(body, GEO.ball, c, M(x, y, z, sx, sy, sz, 0, 0, rz));
  switch (s.look.hair) {
    case 'short': for (let i = -2; i <= 2; i++) ball(i * 0.17, top - 0.03 + (i % 2 ? 0.05 : 0), 0.04, 0.16, 0.13, 0.15); break;
    case 'side': ball(-0.22, top + 0.03, 0.2, 0.46, 0.17, 0.24, 0.32); ball(0.28, top - 0.06, -0.02, 0.26, 0.11, 0.2, -0.2); break;
    case 'long': ball(0, top - 0.08, -0.12, 0.62, 0.2, 0.4); for (const k of [-1, 1]) ball(k * (side - 0.05), top - 0.62, -0.08, 0.22, 0.62, 0.34); break;
    case 'bun': ball(0, top + 0.26, -0.06, 0.26); ball(0, top + 0.02, -0.06, 0.2, 0.12, 0.2); break;
    case 'curly': for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; ball(Math.cos(a) * 0.48, top + (i % 2) * 0.09 - 0.03, Math.sin(a) * 0.3, 0.24, 0.2, 0.22); } ball(0, top + 0.13, 0, 0.42, 0.25, 0.34); break;
    case 'mohawk': for (let i = 0; i < 6; i++) rig.add(body, GEO.ball, c, M(0, top + 0.04 + Math.sin((i / 5) * Math.PI) * 0.16, 0.4 - i * 0.16, 0.08, 0.3, 0.12)); break;
    case 'pigtails': ball(0, top - 0.02, -0.04, 0.5, 0.15, 0.32); for (const k of [-1, 1]) { ball(k * (side + 0.02), top - 0.42, -0.04, 0.27, 0.32, 0.27); ball(k * (side - 0.08), top - 0.14, -0.02, 0.09); } break;
    default: break;
  }
}
/** What's worn on top of the head; the look's own hat always wins over the job's. Heights are in body units. */
function hatOf(rig, body, s) {
  const look = s.look, a = s.accent, top = s.h * 0.5, add = (g, c, m) => rig.add(body, g, c, m);
  const dome = (c, y = top + 0.06, sx = 0.66, sy = 0.32) => add(GEO.ball, c, M(0, y, -0.02, sx, sy, 0.48));
  const brim = (c, y, r, ry = 0.13, z = 0) => add(GEO.cyl, c, M(0, y, z, r, ry * 0.4, r * 0.85));
  const clear = { cap: 0.24, beanie: 0.3, tophat: 0.9, crown: 0.46, party: 1, hardhat: 0.3, headphones: 0.15, cowboy: 0.62, wizard: 1.25, chef: 0.75, viking: 0.42, pirate: 0.42, beret: 0.32, propeller: 0.5, halo: 0.62 };
  switch (look.hat) {
    case 'cap': dome(a, top + 0.03, 0.64, 0.3); add(GEO.box, a, M(0, top + 0.02, 0.5, 0.56, 0.05, 0.42)); break;
    case 'beanie': dome(a, top + 0.06, 0.66, 0.42); add(GEO.cyl, dim(a, 0.72), M(0, top - 0.08, -0.02, 0.66, 0.14, 0.5)); add(GEO.ball, WHITE, M(0, top + 0.54, 0, 0.13)); break;
    case 'tophat': brim(INK, top + 0.08, 0.72, 0.1); add(GEO.cyl, INK, M(0, top + 0.5, 0, 0.42, 0.78, 0.36)); add(GEO.cyl, a, M(0, top + 0.2, 0, 0.43, 0.14, 0.37)); break;
    case 'crown': add(GEO.cyl, GOLD, M(0, top + 0.13, 0, 0.42, 0.2, 0.34)); for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2; add(GEO.cone, GOLD, M(Math.cos(t) * 0.36, top + 0.36, Math.sin(t) * 0.28, 0.1, 0.32, 0.1)); } break;
    case 'party': add(GEO.cone, a, M(0.08, top + 0.45, 0, 0.3, 0.9, 0.3, 0, 0, -0.15)); add(GEO.ball, '#fff6d8', M(0.15, top + 0.96, 0, 0.13)); break;
    case 'hardhat': dome('#ffc21c', top + 0.03, 0.68, 0.32); brim('#ffc21c', top - 0.03, 0.8, 0.13); break;
    case 'headphones': hatHeadset(rig, body, s, true); break;
    case 'cowboy': brim('#a06a30', top + 0.06, 1, 0.1); add(GEO.ball, '#a06a30', M(0, top + 0.3, 0, 0.44, 0.34, 0.4)); add(GEO.cyl, a, M(0, top + 0.1, 0, 0.45, 0.12, 0.41)); break;
    case 'wizard': brim('#4a3a99', top + 0.05, 0.72, 0.1); add(GEO.cone, '#4a3a99', M(0, top + 0.68, -0.02, 0.46, 1.2, 0.46, -0.08)); add(GEO.ball, GOLD, M(0.14, top + 0.58, 0.28, 0.08)); add(GEO.ball, GOLD, M(-0.1, top + 0.86, 0.18, 0.06)); break;
    case 'chef': add(GEO.cyl, '#fbf7ec', M(0, top + 0.14, 0, 0.42, 0.26, 0.36)); add(GEO.ball, '#fbf7ec', M(0, top + 0.42, 0, 0.62, 0.34, 0.54)); break;
    case 'viking': dome('#aab2ba', top + 0.05, 0.66, 0.34); add(GEO.cyl, '#7a5a38', M(0, top - 0.04, 0, 0.67, 0.12, 0.5)); for (const k of [-1, 1]) add(GEO.cone, '#f6ecd4', M(k * 0.72, top + 0.34, 0, 0.13, 0.6, 0.13, 0, 0, -k * 0.55)); break;
    case 'pirate': add(GEO.cyl, INK, M(0, top + 0.1, 0, 0.5, 0.1, 0.36)); add(GEO.box, INK, M(0, top + 0.28, 0, 1.1, 0.4, 0.42)); add(GEO.ball, WHITE, M(0, top + 0.36, 0.2, 0.14)); break;
    case 'beret': hatBeret(rig, body, s, a); break;
    case 'propeller': dome(a, top + 0.03, 0.64, 0.3); add(GEO.cyl, METAL, M(0, top + 0.34, 0, 0.05, 0.22, 0.05)); add(GEO.box, '#ff4f9a', M(-0.34, top + 0.44, 0, 0.6, 0.04, 0.14)); add(GEO.box, '#2f9bff', M(0.34, top + 0.44, 0, 0.6, 0.04, 0.14)); break;
    case 'halo': add(GEO.ring, '#ffe27a', M(0, top + 0.48, 0, 0.42, 0.42, 0.42, Math.PI / 2)); break;
    default: return 0;
  }
  return clear[look.hat] ?? 0.3;
}
function hatHeadset(rig, body, s) {
  const top = s.h * 0.5, side = s.w * 0.5 - 0.02;
  for (let i = 0; i <= 12; i++) { const a = (Math.PI * i) / 12; rig.add(body, GEO.ball, METAL, M(Math.cos(a) * side, 0.05 + Math.sin(a) * (top + 0.06), -0.02, 0.075)); }
  for (const k of [-1, 1]) rig.add(body, softBox(0.3, 0.46, 0.34, 0.1), METAL, M(k * side, 0.08, 0.02));
  rig.add(body, GEO.tiny, METAL, M(0.58, -0.32, 0.72, 0.09, 0.07, 0.08));
  for (let i = 1; i < 5; i++) { const t = i / 5; rig.add(body, GEO.tiny, METAL, M(0.92 - 0.34 * t, -0.05 - 0.27 * t, 0.2 + 0.52 * t, 0.03)); }
}
function hatBeret(rig, body, s, c) {
  const top = s.h * 0.5;
  rig.add(body, GEO.ball, c, M(-0.12, top + 0.07, 0, 0.72, 0.18, 0.52, 0, 0, -0.18));
  rig.add(body, GEO.tiny, c, M(-0.14, top + 0.26, 0, 0.06, 0.08, 0.06));
}
function glassesOf(rig, body, s) {
  const y = s.eyeY, g = s.eyeGap, glasses = s.look.glasses, ring = (x, c, r = 0.3) => rig.add(body, GEO.ring, c, M(x, y, 0.76, r, r, 0.3));
  if (glasses === 'round') { ring(-g, PLUM); ring(g, PLUM); rig.add(body, GEO.tiny, PLUM, M(0, y + 0.03, 0.8, 0.05, 0.025, 0.025)); }
  if (glasses === 'shades') { for (const k of [-1, 1]) rig.add(body, softBox(0.56, 0.36, 0.05, 0.1), '#14141b', M(k * g, y, 0.76)); rig.add(body, GEO.box, '#14141b', M(0, y + 0.06, 0.78, 0.14, 0.05, 0.03)); }
  if (glasses === 'monocle') { ring(g, GOLD, 0.34); for (let i = 1; i < 6; i++) rig.add(body, GEO.tiny, GOLD, M(g + 0.26 + i * 0.015, y - 0.26 - i * 0.1, 0.72 - i * 0.02, 0.018)); }
  if (glasses === 'eyepatch') { rig.add(body, softBox(0.48, 0.36, 0.05, 0.12), '#14141b', M(-g, y, 0.76)); rig.add(body, GEO.box, '#14141b', M(-0.05, y + 0.22, 0.73, 1.0, 0.03, 0.02, 0, 0, -0.34)); }
}
function wearOf(rig, body, s) {
  const look = s.look, a = s.accent, hair = look.hair === 'none' ? '#4a2f1d' : s.hairColor, w = s.w;
  switch (look.wear) {
    case 'beard': rig.add(body, GEO.ball, hair, M(0, -0.52, 0.46, 0.44, 0.26, 0.2)); rig.add(body, GEO.ball, hair, M(0, -0.72, 0.42, 0.28, 0.18, 0.16)); break;
    case 'moustache': for (const k of [-1, 1]) rig.add(body, GEO.ball, hair, M(k * 0.16, -0.08, 0.6, 0.2, 0.06, 0.06, 0, 0, k * -0.16)); break;
    case 'scarf': rig.add(body, GEO.cyl, a, M(0, -0.5, 0, w * 0.5, 0.2, 0.62)); rig.add(body, softBox(0.2, 0.5, 0.05, 0.05), dim(a, 0.8), M(0.26, -0.8, 0.56)); break;
    case 'bowtie': for (const k of [-1, 1]) rig.add(body, GEO.cone, a, M(k * 0.14, -0.53, 0.6, 0.15, 0.26, 0.06, 0, 0, k * Math.PI / 2)); rig.add(body, GEO.tiny, dim(a, 0.8), M(0, -0.53, 0.63, 0.06)); break;
    case 'tie': tieOf(rig, body, a); break;
    case 'badge': rig.add(body, softBox(0.26, 0.3, 0.03, 0.05), WHITE, M(0.42, -0.5, 0.56)); rig.add(body, softBox(0.2, 0.08, 0.02, 0.02), a, M(0.42, -0.42, 0.575)); break;
    case 'cape': rig.add(body, softBox(w * 0.84, s.h * 0.92, 0.06, 0.1), a, M(0, -0.02, -0.64)); break;
    case 'backpack': rig.add(body, softBox(0.72, 0.8, 0.34, 0.14), a, M(0, -0.08, -0.74)); rig.add(body, softBox(0.44, 0.32, 0.1, 0.06), dim(a, 0.72), M(0, -0.22, -0.92)); break;
    case 'wings': for (const k of [-1, 1]) { rig.add(body, GEO.ball, WHITE, M(k * 0.74, 0.16, -0.62, 0.56, 0.36, 0.06, 0, k * 0.3, k * 0.32)); rig.add(body, GEO.ball, '#eee7d7', M(k * 0.64, -0.14, -0.6, 0.4, 0.24, 0.05, 0, k * 0.3, k * 0.14)); } break;
    default: break;
  }
}
function tieOf(rig, body, a) {
  rig.add(body, GEO.tiny, dim(a, 0.82), M(0, -0.52, 0.595, 0.09, 0.075, 0.05));
  const shape = new THREE.Shape(); shape.moveTo(-0.05, 0); shape.lineTo(0.05, 0); shape.lineTo(0.11, -0.34); shape.lineTo(0, -0.46); shape.lineTo(-0.11, -0.34); shape.closePath();
  rig.add(body, new THREE.ShapeGeometry(shape, 1), a, M(0, -0.57, 0.585));
}
function outfitOf(rig, body, s) {
  const a = s.accent, w = s.w, c = s.color;
  switch (s.look.outfit) {
    case 'suit': { const V = new THREE.Shape(); V.moveTo(-0.2, 0); V.lineTo(0.2, 0); V.lineTo(0, -0.34); V.closePath(); rig.add(body, new THREE.ShapeGeometry(V, 1), WHITE, M(0, -0.5, 0.588)); break; }
    case 'shirt': for (const k of [-1, 1]) rig.add(body, GEO.tiny, WHITE, M(k * 0.12, -0.52, 0.58, 0.14, 0.06, 0.04, 0, 0, k * -0.5)); break;
    case 'hoodie': rig.add(body, GEO.ball, dim(c, 0.82), M(0, -0.5, -0.5, 0.56, 0.3, 0.3)); rig.add(body, softBox(0.56, 0.2, 0.05, 0.08), dim(c, 0.82), M(0, -0.74, 0.56)); break;
    case 'dress': rig.add(body, GEO.cyl, dim(c, 0.78), M(0, -s.h * 0.42, 0, w * 0.52, 0.14, 0.62)); break;
    case 'labcoat': rig.add(body, softBox(w * 0.5, s.h * 0.34, 0.03, 0.08), WHITE, M(0, -0.6, 0.58)); rig.add(body, GEO.box, '#2f9bff', M(0.32, -0.5, 0.6, 0.1, 0.05, 0.015)); break;
    case 'overalls': rig.add(body, softBox(0.62, 0.42, 0.04, 0.08), a, M(0, -0.62, 0.575)); for (const k of [-1, 1]) rig.add(body, GEO.box, a, M(k * 0.24, -0.36, 0.59, 0.06, 0.38, 0.015)); break;
    default: break;
  }
}
/** A company lanyard on everyone: this is where the floor's colours show on a person. */
function lanyard(rig, body, s) {
  for (let i = 0; i <= 5; i++) { const k = -1 + i * 0.4; rig.add(body, GEO.tiny, s.accent, M(k * 0.18, -0.46 - (1 - k * k) * 0.14, 0.572, 0.028)); }
  rig.add(body, softBox(0.28, 0.32, 0.03, 0.05), WHITE, M(0, -0.78, 0.565));
  rig.add(body, softBox(0.22, 0.09, 0.02, 0.02), s.accent, M(0, -0.7, 0.583));
}
/** What the job wears all day. Returns how far it rises above the head, so the name tag clears it. */
function wornOf(rig, body, s) {
  const top = s.h * 0.5, g = s.eyeGap, y = s.eyeY;
  switch (s.job.worn) {
    case 'crownlet': rig.add(body, GEO.cyl, GOLD, M(0, top + 0.08, 0, 0.3, 0.12, 0.25)); for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2; rig.add(body, GEO.cone, GOLD, M(Math.cos(t) * 0.25, top + 0.22, Math.sin(t) * 0.2, 0.07, 0.2, 0.07)); } return 0.3;
    case 'tie': if (s.look.wear !== 'tie') tieOf(rig, body, s.accent); return 0;
    case 'headset': hatHeadset(rig, body, s); return 0.14;
    case 'beret': hatBeret(rig, body, s, PLUM); return 0.3;
    case 'loupe': { const m = new THREE.Group(); rig.add(body, GEO.ring, PLUM, M(g + 0.11, y, 0.98, 0.42, 0.42, 0.42, 0, -0.09)); rig.add(body, GEO.arm, PLUM, M(g + 0.42, y - 0.54, 0.98, 0.08, 0.27, 0.08, 0, 0, 0.42)); rig.add(body, GEO.ball, GOLD, M(g + 0.57, y - 0.76, 1.0, 0.09, 0.13, 0.09)); return 0; }
    case 'specs': if (s.look.glasses === 'none' || !s.look.glasses) { for (const k of [-1, 1]) rig.add(body, GEO.ring, PLUM, M(k * g, y, 0.76, 0.3, 0.3, 0.3)); rig.add(body, GEO.tiny, PLUM, M(0, y + 0.03, 0.8, 0.05, 0.025, 0.025)); } return 0;
    case 'papers': for (let i = 0; i < 5; i++) rig.add(body, GEO.box, i % 2 ? WHITE : PAPER, M(i % 2 ? 0.035 : -0.03, top + 0.03 + i * 0.075, -0.03, 0.82 - i * 0.017, 0.06, 0.6, 0, (i - 2) * 0.105)); return 0.46;
    case 'earpencil': { rig.add(body, GEO.arm, GOLD, M(0.78, top - 0.32, 0.24, 0.05, 0.3, 0.05, 0.1, 0, -0.5)); rig.add(body, GEO.cone, '#ffdca8', M(0.47, top - 0.16, 0.26, 0.05, 0.1, 0.05, 0, 0, 0.9)); return 0; }
    case 'visor': rig.add(body, GEO.cyl, '#16c464', M(0, top - 0.15, 0, s.w * 0.5 + 0.02, 0.1, 0.64)); rig.add(body, GEO.box, '#16c464', M(0, top - 0.1, 0.62, s.w * 0.62, 0.05, 0.36, 0.35)); return 0.02;
    case 'starpin': { const c = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.09 : 0.2, t = (i / 10) * Math.PI * 2 - Math.PI / 2; c[i ? 'lineTo' : 'moveTo'](Math.cos(t) * r, Math.sin(t) * r); } rig.add(body, new THREE.ShapeGeometry(c, 1), GOLD, M(0.5, -0.5, 0.592)); return 0; }
    case 'splats': for (const [x, y2, r, c] of [[-0.45, -0.5, 0.11, '#ff4f4f'], [-0.2, -0.7, 0.08, '#2f9bff'], [0.34, -0.62, 0.12, '#ffc91f'], [0.5, -0.4, 0.07, '#12d19a'], [0.08, -0.9, 0.07, '#b95cf7']]) rig.add(body, GEO.tiny, c, M(x, y2, 0.57, r, r * 0.86, 0.012)); return 0;
    default: return 0;
  }
}
/** The thing a job carries around, on the right. Put down when they sit. */
function heldOf(rig, bone, s) {
  const add = (g, c, m) => rig.add(bone, g, c, m), a = s.accent;
  switch (s.job.held) {
    case 'clipboard': add(softBox(0.5, 0.68, 0.09, 0.06), '#315964', M()); add(softBox(0.4, 0.54, 0.02, 0.025), PAPER, M(0, -0.02, 0.06)); add(softBox(0.18, 0.08, 0.05, 0.02), GOLD, M(0, 0.3, 0.09)); for (let i = 0; i < 4; i++) add(GEO.box, '#8b9c9c', M(-0.03, 0.12 - i * 0.1, 0.075, 0.26, 0.012, 0.002)); break;
    case 'laptop': { add(softBox(0.95, 0.07, 0.56, 0.04), '#2f3640', M(0, -0.24, 0.1)); add(softBox(0.9, 0.56, 0.06, 0.05), '#2f3640', M(0, 0.05, -0.15, 1, 1, 1, -0.2)); add(softBox(0.76, 0.42, 0.02, 0.02), '#8df5d6', M(0, 0.05, -0.11, 1, 1, 1, -0.2)); break; }
    case 'brush': add(GEO.arm, GOLD, M(0, -0.05, 0, 0.05, 0.3, 0.05)); add(GEO.ball, WHITE, M(0, 0.34, 0, 0.07, 0.08, 0.07)); add(GEO.ball, '#caa06a', M(0, 0.5, 0, 0.09, 0.19, 0.08)); add(GEO.ball, '#12c8e8', M(0, 0.67, 0, 0.08, 0.09, 0.07)); break;
    case 'bug': add(GEO.ball, '#ff4f4f', M(0, 0.08, 0.05, 0.2, 0.15, 0.13)); add(GEO.tiny, INK, M(0.2, 0.08, 0.08, 0.09)); for (const x of [-0.1, 0, 0.1]) for (const k of [-1, 1]) add(GEO.tiny, INK, M(x, 0.08 + k * 0.17, 0.06, 0.02, 0.09, 0.02)); break;
    case 'briefcase': add(softBox(0.62, 0.48, 0.24, 0.07), '#5b385a', M()); add(GEO.ring, '#5b385a', M(0, 0.3, 0, 0.17, 0.11, 0.13)); add(GEO.box, GOLD, M(0, 0.03, 0.14, 0.08, 0.11, 0.035)); break;
    case 'book': add(softBox(0.46, 0.6, 0.1, 0.05), a, M()); add(softBox(0.38, 0.52, 0.03, 0.02), PAPER, M(0.015, 0, 0.05)); break;
    case 'notepad': add(softBox(0.44, 0.58, 0.05, 0.04), PAPER, M()); add(GEO.cyl, METAL, M(0, 0.32, 0.02, 0.2, 0.05, 0.03, 0, 0, Math.PI / 2)); for (let i = 0; i < 4; i++) add(GEO.box, '#8b9c9c', M(0, 0.14 - i * 0.13, 0.03, 0.28, 0.012, 0.002)); break;
    case 'chart': add(softBox(0.62, 0.52, 0.05, 0.05), '#fbf7ec', M()); for (const [x, ht, c] of [[-0.18, 0.2, '#ff4f4f'], [-0.02, 0.3, '#ffc91f'], [0.14, 0.42, '#12d19a']]) add(GEO.box, c, M(x, -0.18 + ht / 2, 0.035, 0.11, ht, 0.03)); break;
    case 'megaphone': add(GEO.cone, '#ff4f4f', M(0.24, 0, 0.16, 0.26, 0.56, 0.26, 0, 0, -Math.PI / 2)); add(GEO.cyl, METAL, M(-0.1, 0, 0.16, 0.05, 0.3, 0.05, 0, 0, Math.PI / 2)); add(GEO.ring, WHITE, M(0.48, 0, 0.16, 0.26, 0.26, 0.26, 0, Math.PI / 2)); break;
    case 'palette': { const g = new THREE.Group(); add(GEO.ball, '#d9a36a', M(0, 0, 0, 0.4, 0.3, 0.05)); for (const [x, y2, c] of [[-0.22, 0.1, '#ff4f4f'], [0.02, 0.18, '#ffc91f'], [0.24, 0.1, '#12d19a'], [0.2, -0.1, '#2f9bff']]) add(GEO.tiny, c, M(x, y2, 0.05, 0.075, 0.075, 0.03)); break; }
    case 'mug': add(GEO.cyl, a, M(0, 0, 0, 0.14, 0.26, 0.14)); add(GEO.ring, a, M(0.17, 0, 0, 0.09, 0.09, 0.14, 0, 0, Math.PI / 2)); add(GEO.ball, '#6b4a2e', M(0, 0.13, 0, 0.1, 0.02, 0.1)); break;
    default: break;
  }
}

// ---------- a person ----------

const DETAIL = { 1: [52, 26], 0.7: [38, 18], 0.45: [28, 14] };
const hide = (o) => o.scale.setScalar(1e-4);

export class Creature {
  constructor(spec, { detail = 1 } = {}) {
    this.spec = spec;
    const rig = new Rig();
    const { w, h, eyeGap: g, eyeY: y, color: c, dark } = spec, restY = h * 0.5 + 0.48;
    const root = rig.bone(null), body = rig.bone(root, 0, restY, 0);
    const armPivot = [-1, 1].map((side) => rig.bone(body, side * (w * 0.47), -0.05, 0.02));
    const legPivot = [-1, 1].map((side) => rig.bone(root, side * 0.4, 0.37, 0.03));
    const eyes = [], pupils = [], brows = [];
    for (const side of [-1, 1]) { const e = rig.bone(body, side * g, y, 0.535); eyes.push(e); const pu = rig.bone(e); pupils.push(pu); brows.push(rig.bone(body, side * g, y + 0.48, 0.59)); }
    const mouth = rig.bone(body, spec.id % 7 === 0 ? 0.04 : 0, -0.22, 0.593), focus = rig.bone(body, 0, -0.2, 0.594), oh = rig.bone(body, 0, -0.24, 0.594);
    const held = rig.bone(body, 1.04 * (w / 1.75), -0.4, 0.3), paper = rig.bone(body, 0, -0.18, 0.9);
    const mug = rig.bone(armPivot[1], 0.02, -0.52, 0.16), phone = rig.bone(armPivot[1], 0, -0.48, 0.12);
    // Bones are posed relative to their parents from here on, and the mesh is bound at the rest pose below.
    const [N, Mm] = DETAIL[detail] || DETAIL[0.7];
    const bodyGeo = pillow(spec, N, Mm);
    rig.add(body, bodyGeo, c, M());
    bodyGeo.dispose();
    for (const i of [0, 1]) {
      rig.add(legPivot[i], GEO.arm, c, M(0, -0.08, 0, 0.12, 0.13, 0.13));
      rig.add(legPivot[i], GEO.ball, dark, M((i ? 1 : -1) * 0.025, -0.23, 0.14, 0.235, 0.155, 0.31));
      rig.add(armPivot[i], GEO.arm, c, M(0, -0.25, 0.035, 0.16, 0.195, 0.17));
    }
    // A big-eyed face, a little off-kilter on some, with the wide soft mouth from the proof.
    for (let i = 0; i < 2; i++) {
      let ex = 0.237 * spec.eyeBig, ey = 0.285 * spec.eyeBig;
      if (spec.wonky) { ex *= i ? 1.14 : 0.92; ey *= i ? 1.12 : 0.88; }
      rig.add(eyes[i], GEO.ball, WHITE, M(0, 0, 0, ex, ey, 0.155));
      rig.add(pupils[i], GEO.tiny, INK, M(0, -0.012, 0.143, 0.092 * spec.eyeBig, 0.125 * spec.eyeBig, 0.05));
      rig.add(pupils[i], GEO.tiny, WHITE, M(-0.03, 0.03, 0.19, 0.032, 0.032, 0.012));
      rig.add(brows[i], GEO.brow, INK, M());
      brows[i].position.y = y + ey + 0.13;
    }
    for (const side of [-1, 1]) rig.add(body, GEO.tiny, spec.cheek, M(side * Math.min(0.62, w * 0.34), -0.075, 0.532, 0.122, 0.07, 0.026));
    const mw = spec.mouthWide, mouthTilt = spec.browTilt < 0 ? -0.08 : 0.05;
    rig.add(mouth, GEO.smile, INK, M(0, 0, 0, mw, mw * 0.92, 1, 0, 0, mouthTilt));
    rig.add(mouth, GEO.tiny, '#ff6d7d', M(0.04 * mw, -0.21 * mw, 0.016, 0.18 * mw, 0.075 * mw, 0.022));
    rig.add(mouth, GEO.tiny, WHITE, M(-0.06 * mw, -0.035 * mw, 0.02, 0.2 * mw, 0.05 * mw, 0.02));
    rig.add(focus, GEO.arm, INK, M(0, 0, 0, 0.03, 0.14, 0.015, 0, 0, Math.PI / 2 + 0.1));
    rig.add(oh, GEO.tiny, INK, M(0, 0, 0, 0.13, 0.16, 0.022));
    rig.add(oh, GEO.tiny, '#ff6d7d', M(0.01, -0.08, 0.016, 0.08, 0.05, 0.016));
    lanyard(rig, body, spec);
    outfitOf(rig, body, spec);
    wearOf(rig, body, spec);
    hairOf(rig, body, spec);
    let clear = hatOf(rig, body, spec);
    if (spec.look.hat === 'none' || !spec.look.hat) clear = Math.max(clear, wornOf(rig, body, spec));
    else if (['tie', 'loupe', 'specs', 'earpencil', 'starpin', 'splats'].includes(spec.job.worn)) wornOf(rig, body, spec);
    glassesOf(rig, body, spec);
    heldOf(rig, held, spec);
    // What a person may pick up: shown by scaling their bone up from nothing, so they cost no extra draw calls.
    rig.add(paper, GEO.box, PAPER, M(0, 0, 0, 0.5, 0.03, 0.64, 0.25)); rig.add(paper, GEO.box, '#b8c0cc', M(0, 0.03, -0.02, 0.32, 0.006, 0.34, 0.25));
    rig.add(mug, GEO.cyl, spec.accent, M(0, 0, 0, 0.14, 0.26, 0.14)); rig.add(mug, GEO.ring, spec.accent, M(0.17, 0, 0, 0.09, 0.09, 0.14, 0, 0, Math.PI / 2));
    rig.add(mug, GEO.ball, '#6b4a2e', M(0, 0.13, 0, 0.1, 0.02, 0.1));
    rig.add(phone, softBox(0.2, 0.36, 0.04, 0.03), '#23232b', M()); rig.add(phone, softBox(0.16, 0.29, 0.012, 0.01), '#9fd8ff', M(0, 0, 0.026));

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
    if (detail >= 0.7) { const ol = new THREE.SkinnedMesh(geo, OUTLINE_MAT); ol.frustumCulled = false; ol.bind(skeleton, new THREE.Matrix4()); this.group.add(ol); this.outline = ol; }
    // Where the group goes, its height and how far the head reaches: all a chair and a name tag need to know.
    this.height = h + 0.48; this.bottom = 0.48; this.labelClear = clear;
    this.B = { root, body, armPivot, legPivot, eyes, pupils, brows, mouth, focus, oh, held, paper, mug, phone };
    this.rest = { bodyY: restY, browY: brows.map((b) => b.position.y), browZ: brows.map(() => 0), held: held.position.clone() };
    hide(focus); hide(oh); hide(paper); hide(mug); hide(phone);
    this.paper = { visible: false }; this.mug = { visible: false }; this.phone = { visible: false };
    this.t = (spec.id % 1000) / 37; this.step = spec.phase; this.blinkAt = 1 + (spec.id % 300) / 90;
    this.nextFidget = 3 + (spec.id % 7); this.fidget = -1; this.fidgetT = 0; this.stumbleT = -1; this.nextStumble = 7 + ((spec.id >> 4) % 11);
    this.hopT = -1; this.grin = 0; this.wide = 1;
  }
  /** A little jump for joy when a job is finished. */
  celebrate() { this.hopT = 0; }
  pose(dt, speed, b, ty, m) {
    const s = this.spec, t = (this.t += dt), B = this.B, sit = Math.min(1, b.sit), walk = Math.min(1 - sit, b.walk), lean0 = m?.lean ?? 0;
    const p = t * 2.5 + s.phase, side = (i) => (i ? 1 : -1);
    // Squash and stretch breathes through everything, one wobble per person.
    let squash = Math.sin(p) * (0.018 + 0.014 * (1 - sit)), hop = 0, tilt = Math.sin(p * 0.53) * 0.016 + lean0 * (1 - sit), pitch = 0, headTurn = Math.sin(t * 0.61 + s.phase) * 0.12 * (1 - b.type);
    let lookX = Math.sin(t * 0.7 + s.phase) * 0.018, lookY = 0, browUp = 0, browIn = 0, eyeOpen = 1, grin = 0.6, focus = 0, oh = 0, jit = 0, sway = 0;
    // A waddle: short quick steps, the body rocking from foot to foot and dipping on each one.
    this.step += dt * (8.2 + (m ? (m.pace - 2.6) * 2.4 : 0)) * (speed > 0.01 ? 1 : 0.3);
    const st = this.step, sw = Math.sin(st);
    hop += Math.abs(sw) * 0.13 * walk;
    squash += Math.cos(st * 2) * 0.05 * walk;
    tilt += sw * 0.13 * walk * (1 + (m?.sway ?? 0) * 0.2);
    sway = sw * 0.07 * walk;
    pitch += 0.05 * walk;
    grin = 0.75 * walk + grin * (1 - walk);
    // A stumble now and then, on the way somewhere. Harmless, and they look very surprised about it.
    if (walk > 0.6) { this.nextStumble -= dt; if (this.nextStumble <= 0 && this.stumbleT < 0) { this.stumbleT = 0; this.nextStumble = 11 + Math.random() * 18; } }
    let stum = 0;
    if (this.stumbleT >= 0) {
      this.stumbleT += dt;
      const u = this.stumbleT / 0.55;
      if (u >= 1) this.stumbleT = -1; else { stum = Math.sin(u * Math.PI); pitch += stum * 0.42; hop += stum * 0.12; tilt += Math.sin(u * Math.PI * 3) * 0.1 * stum; oh = Math.max(oh, stum); eyeOpen = Math.max(eyeOpen, 1 + 0.18 * stum); browUp += 0.05 * stum; }
    }
    // The jump for joy: a crouch, up, and a squashy landing.
    let joy = 0;
    if (this.hopT >= 0) {
      this.hopT += dt;
      const u = this.hopT / 0.9;
      if (u >= 1) this.hopT = -1;
      else if (u < 0.22) { const k = Math.sin((u / 0.22) * Math.PI * 0.5); squash -= 0.16 * k; joy = 0.5 * k; }
      else if (u < 0.76) { const a = (u - 0.22) / 0.54; hop += Math.sin(a * Math.PI) * 0.62; squash += 0.12 * Math.sin(a * Math.PI); joy = 1; }
      else { squash -= 0.14 * Math.sin(((u - 0.76) / 0.24) * Math.PI); joy = 0.7; }
    }
    // Cheer: arms up and a hop on the spot.
    hop += Math.abs(Math.sin(t * 7)) * 0.22 * b.cheer; squash += Math.cos(t * 14) * 0.05 * b.cheer; joy = Math.max(joy, b.cheer);
    grin = Math.max(grin, joy);
    browUp += 0.05 * joy; eyeOpen = Math.max(eyeOpen, 1 + 0.1 * joy);
    // Now and then, when they're not busy, a little thing of their own: a wave, a wiggle, a peer around.
    const free = 1 - Math.min(1, b.walk + b.type + b.talk + b.cheer + b.carry + b.stretch + b.sip + b.phone + b.pour + b.think);
    if (free > 0.8) { this.nextFidget -= dt; if (this.nextFidget <= 0 && this.fidget < 0) { this.fidget = Math.floor(Math.random() * 3); this.fidgetT = 0; this.nextFidget = 5 + Math.random() * 9; } }
    let wave = 0;
    if (this.fidget >= 0) {
      this.fidgetT += dt;
      const u = this.fidgetT / 1.5, g = Math.sin(Math.PI * Math.min(1, u));
      if (u >= 1) this.fidget = -1;
      else if (this.fidget === 0) { wave = g; tilt += 0.07 * g; }
      else if (this.fidget === 1) { tilt += Math.sin(u * Math.PI * 3) * 0.11 * g; squash += Math.sin(u * Math.PI * 4) * 0.05 * g; hop += g * 0.05; }
      else { headTurn += Math.sin(u * Math.PI * 2) * 0.28 * g; lookX += Math.sin(u * Math.PI * 2) * 0.05 * g; }
    }
    // Frantic at the keys: everything quivers, the brows knit, the tongue comes out to help.
    const on = ty?.on ?? 0;
    if (b.type > 0.01) {
      focus = Math.max(focus, b.type * on); pitch += 0.06 * b.type; jit = b.type * on;
      squash += Math.sin(t * 22 + s.phase) * 0.013 * jit; hop += Math.abs(Math.sin(t * 15 + s.phase)) * 0.018 * jit;
      browIn += 0.09 * b.type; lookY -= 0.055 * b.type * on; lookY += 0.02 * b.type * (ty?.look ?? 0); headTurn = headTurn * (1 - b.type) + b.type * ((ty?.glance ?? 0) * 0.5 + Math.sin(t * 0.8 + s.phase) * 0.06);
    }
    // Thinking looks up and sideways with one eyebrow going; listening is wide-eyed and nodding along.
    if (b.think > 0.01) { oh = Math.max(oh, 0.6 * b.think); lookY += 0.06 * b.think; lookX += 0.05 * b.think; browUp += 0.04 * b.think; headTurn += Math.sin(t * 0.9) * 0.08 * b.think; }
    if (b.listen > 0.01) { browUp += 0.035 * b.listen; const nod = Math.sin(t * 1.7); pitch += (nod > 0.7 ? (nod - 0.7) * 2.4 : 0) * 0.13 * b.listen; grin = Math.max(grin, 0.7 * b.listen); }
    if (b.sip > 0.01) { eyeOpen = Math.min(eyeOpen, 1 - 0.55 * b.sip); grin = Math.max(grin, 0.8 * b.sip); }
    if (b.stretch > 0.01) { eyeOpen = Math.min(eyeOpen, 1 - 0.7 * b.stretch); oh = Math.max(oh, 0.9 * b.stretch); squash += 0.08 * b.stretch; }
    if (b.pour > 0.01) { focus = Math.max(focus, 0.6 * b.pour); lookY -= 0.03 * b.pour; }
    if (b.phone > 0.01) { lookX -= 0.03 * b.phone; browUp += 0.02 * b.phone * (0.5 + 0.5 * Math.sin(t * 3)); }
    // Talking: the mouth goes, the brows bounce, the whole body nods along with it.
    const flap = 0.5 + 0.5 * Math.sin(t * 12 + s.phase), talk = Math.max(b.talk, b.phone * 0.9);
    if (talk > 0.01) { squash += Math.sin(t * 6 + s.phase) * 0.028 * talk; tilt += Math.sin(t * 3 + s.phase) * 0.05 * talk; browUp += (0.03 + 0.024 * Math.sin(t * 4)) * talk; }
    // The arms, one weight at a time: `a` swings them forward, `o` splays them out from the body.
    let aL = 0.35 * sit, aR = 0.35 * sit, oL = 0.25 - 0.1 * sit, oR = 0.25 - 0.1 * sit;
    const to = (w, ta, tb, ao, bo) => { aL += (ta - aL) * w; aR += (tb - aR) * w; oL += (ao - oL) * w; oR += (bo - oR) * w; };
    aL += -sw * 0.65 * walk; aR += sw * 0.65 * walk;
    if (b.talk > 0.01) to(b.talk, 0.42 + Math.sin(t * 3.3) * 0.14, 1.2 + Math.sin(t * 5 + s.phase) * 0.34, 0.1, 0.55);
    if (b.listen > 0.01) to(b.listen, 0.42, 0.42, -0.1, -0.1);
    if (b.carry > 0.01) to(b.carry, 1.12, 1.12, -0.22, -0.22);
    if (b.think > 0.01) to(b.think, 0.5, 1.7, 0.12, -0.52);
    if (b.stretch > 0.01) to(b.stretch, 2.9, 2.9, 0.22, 0.22);
    if (b.sip > 0.01) { const k = this.sip ?? 0; to(b.sip, 0.2, 1.5 + 0.55 * k, 0.2, -0.32); }
    if (b.phone > 0.01) to(b.phone, 0.3, 2.45, 0.2, 0.42);
    if (b.pour > 0.01) to(b.pour, 0.25, 1.05, 0.2, -0.14);
    if (b.cheer > 0.01) to(b.cheer, 2.95 + Math.sin(t * 11) * 0.22, 2.95 - Math.sin(t * 11) * 0.22, 0.45, 0.45);
    if (b.type > 0.01) {
      // Hands on the keys, tapping as fast as they can go.
      to(b.type, 0.98 + (ty?.l ?? 0) * 0.3, 0.98 + (ty?.r ?? 0) * 0.3, -0.42, -0.42);
    }
    if (wave > 0.01) { aR += (2.55 + Math.sin(t * 16) * 0.3 - aR) * wave; oR += (0.5 - oR) * wave; browUp += 0.04 * wave; grin = Math.max(grin, wave); }
    if (stum > 0.01) { aL += stum * 1.9; aR += stum * 1.7; oL += stum * 0.5; oR += stum * 0.5; }
    B.armPivot[0].rotation.set(-aL, 0, -oL); B.armPivot[1].rotation.set(-aR, 0, oR);
    // Legs: quick little steps, or dangling off the chair with the odd swing.
    const dangle = Math.sin(t * 2.3 + s.phase) * 0.12 * sit;
    B.legPivot[0].rotation.x = sw * 0.7 * walk - 1.3 * sit + dangle; B.legPivot[1].rotation.x = -sw * 0.7 * walk - 1.3 * sit - dangle;
    // The whole soft body.
    const rx = pitch, rz = tilt;
    B.root.position.set(sway, hop, jit * Math.sin(t * 31) * 0.01); B.root.scale.set(1 - squash * 0.52, 1 + squash, 1 - squash * 0.4);
    B.root.rotation.set(rx, 0, rz);
    B.body.position.y = this.rest.bodyY; B.body.rotation.set(0, headTurn, 0);
    // The held prop goes when they sit or have their hands full, and pops back.
    const stowed = Math.max(sit, b.carry, b.phone, b.sip, b.pour, b.type);
    const prop = stowed > 0.5 ? 0 : 1 - stowed * 2;
    this.scaleOf(B.held, Math.max(1e-4, prop));
    this.scaleOf(B.paper, this.paper.visible ? Math.max(1e-4, b.carry) : 1e-4);
    this.scaleOf(B.mug, this.mug.visible ? 1 : 1e-4); this.scaleOf(B.phone, this.phone.visible ? 1 : 1e-4);
    // Sipping: the cup comes up and goes back down on its own little rhythm.
    this.sip = (this.sip ?? 0) + ((Math.sin(t * 1.4) > 0.3 ? 1 : 0) - (this.sip ?? 0)) * Math.min(1, dt * 6);
    // Face.
    const faceE = 1 - Math.exp(-dt * 14);
    this.grin += (grin - this.grin) * faceE;
    if (t > this.blinkAt + 0.14) this.blinkAt = t + 3.2 + ((s.id >> 9) % 8) * 0.25 + Math.random() * 1.6;
    const blink = t >= this.blinkAt ? Math.max(0.1, Math.abs(((t - this.blinkAt) / 0.14) * 2 - 1)) : 1;
    this.wide += (eyeOpen - this.wide) * faceE;
    for (let i = 0; i < 2; i++) {
      B.eyes[i].scale.set(this.wide > 1.05 ? this.wide : 1, Math.max(0.08, blink * this.wide), 1);
      const pu = B.pupils[i]; pu.position.set(lookX + (s.wonky ? (i ? 0.015 : -0.02) : 0), lookY, 0); pu.scale.setScalar(stum > 0.3 ? 0.8 : 1);
      const k = side(i);
      B.brows[i].position.y = this.rest.browY[i] + browUp;
      B.brows[i].rotation.z = k * (s.browTilt + browIn + (b.think > 0.2 && i ? 0.25 : 0));
      B.brows[i].position.x = k * (s.eyeGap - browIn * 0.3);
    }
    // Three mouths, one showing: the wide soft smile (which opens to talk), a concentrating line and a little "oh".
    const open = Math.max(0, 1 - Math.max(focus, oh) * 1.8);
    const my = talk > 0.01 ? (1 - talk) * (0.52 + 0.45 * this.grin) + talk * (0.55 + 0.75 * flap) : 0.52 + 0.45 * this.grin;
    B.mouth.scale.set(Math.max(1e-4, (1 + 0.06 * this.grin + Math.sin(t * 6) * 0.04 * talk) * open), Math.max(1e-4, my * open), 1);
    this.scaleOf(B.focus, Math.max(1e-4, focus * (1 - oh * 0.9)));
    B.focus.position.y = -0.2 + Math.sin(t * 10) * 0.012 * jit;
    this.scaleOf(B.oh, Math.max(1e-4, oh * (0.8 + 0.2 * Math.sin(t * 7))));
  }
  scaleOf(b, v) { if (b.scale.x !== v) b.scale.setScalar(v); }
  dispose() { this.mesh.geometry.dispose(); this.mesh.skeleton.dispose(); this.group.removeFromParent(); }
}

const SVG = 'http://www.w3.org/2000/svg';
const shape = (name, attrs) => { const el = document.createElementNS(SVG, name); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
/** The drawn stand-in in the lists, until the photo is developed: the same colour, the same big eyes and the same smile as the person in the room. */
export function drawnFace(spec) {
  const svg = shape('svg', { viewBox: '0 0 84 100', 'aria-hidden': 'true', class: 'portrait-drawn' });
  svg.append(shape('rect', { x: 11, y: 18, width: 62, height: 78, rx: 28, ry: 30, fill: spec.color }));
  svg.append(shape('ellipse', { cx: 24, cy: 58, rx: 6, ry: 4, fill: spec.cheek }), shape('ellipse', { cx: 60, cy: 58, rx: 6, ry: 4, fill: spec.cheek }));
  for (const x of [32, 52]) { svg.append(shape('ellipse', { cx: x, cy: 45, rx: 9.5, ry: 12, fill: '#fffdf3' }), shape('ellipse', { cx: x, cy: 46, rx: 4, ry: 5.5, fill: '#2a2233' }), shape('circle', { cx: x - 1.5, cy: 43.5, r: 1.6, fill: '#fffdf3' })); }
  svg.append(shape('path', { d: 'M28 62c3 13 26 13 30-1z', fill: '#2a2233' }), shape('path', { d: 'M33 70c5 4 15 4 20 1-4-3-16-4-20-1z', fill: '#ff6d7d' }));
  return svg;
}
/** Which way to look to take a good photo of them: how much of their height to frame, as a share of it. */
export const PORTRAIT_FRAME = { top: 1.02, view: 1.05 };
