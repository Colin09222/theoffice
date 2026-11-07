// The little people. Everything is built from a few low-poly shapes with shared geometry, and every rigid part of a limb,
// the torso or the head is baked into one vertex-coloured mesh, so a character is seven draw calls however it is dressed.
import * as THREE from '../vendor/three/three.module.min.js';
import { mergeColored, disposeMerged } from './batch.js';

const G = {
  head: new THREE.SphereGeometry(0.36, 20, 14),
  body: new THREE.CapsuleGeometry(0.23, 0.26, 4, 12),
  limb: new THREE.CapsuleGeometry(0.075, 0.27, 2, 8),
  eyeWhite: new THREE.SphereGeometry(0.058, 10, 8),
  eye: new THREE.SphereGeometry(0.034, 8, 6),
  hairCap: new THREE.SphereGeometry(0.375, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hairBall: new THREE.IcosahedronGeometry(0.15, 1),
  ball: new THREE.SphereGeometry(0.085, 10, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  cone: new THREE.ConeGeometry(1, 1, 12),
  ring: new THREE.TorusGeometry(0.075, 0.016, 6, 14),
  smile: new THREE.TorusGeometry(0.062, 0.013, 5, 10, Math.PI),
  paper: new THREE.BoxGeometry(0.26, 0.02, 0.34),
  mug: new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10),
  phone: new THREE.BoxGeometry(0.1, 0.17, 0.014),
};
/** One material for every person on the floor: colour lives in the vertices. */
export const CHAR_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
const mats = new Map();
const mat = (color) => {
  let m = mats.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); mats.set(color, m); }
  return m;
};
const part = (geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true;
  return m;
};
const darker = (hex, f = 0.7) => `#${new THREE.Color(hex).multiplyScalar(f).getHexString()}`;

function buildHair(head, look) {
  const c = look.hairColor;
  const style = look.hair;
  if (style === 'none') return;
  const cap = () => { const m = part(G.hairCap, c, 0, 0.03, -0.015); m.rotation.x = -0.18; head.add(m); };
  if (style === 'short') { cap(); head.add(part(G.box, c, 0, 0.2, 0.3, 0.42, 0.08, 0.14)); }
  if (style === 'side') { cap(); const f = part(G.hairBall, c, 0.15, 0.27, 0.22, 1.1, 0.5, 0.55); head.add(f); }
  if (style === 'long') { cap(); head.add(part(G.box, c, 0, -0.14, -0.2, 0.66, 0.62, 0.22)); head.add(part(G.box, c, -0.3, -0.1, 0.05, 0.12, 0.5, 0.36)); head.add(part(G.box, c, 0.3, -0.1, 0.05, 0.12, 0.5, 0.36)); }
  if (style === 'bun') { cap(); head.add(part(G.hairBall, c, 0, 0.44, -0.14)); }
  if (style === 'curly') {
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      head.add(part(G.hairBall, c, Math.cos(a) * 0.27, 0.2 + (i % 2) * 0.09, Math.sin(a) * 0.25 - 0.03));
    }
    head.add(part(G.hairBall, c, 0, 0.34, 0, 1.4, 0.9, 1.4));
  }
  if (style === 'mohawk') for (let i = 0; i < 5; i++) head.add(part(G.box, c, 0, 0.33 + Math.sin((i / 4) * Math.PI) * 0.08, 0.2 - i * 0.11, 0.08, 0.2, 0.1));
  if (style === 'pigtails') { cap(); head.add(part(G.hairBall, c, -0.38, 0.02, -0.04, 0.8, 1.2, 0.8)); head.add(part(G.hairBall, c, 0.38, 0.02, -0.04, 0.8, 1.2, 0.8)); }
}
function buildHat(head, look, accent) {
  const hat = look.hat;
  if (hat === 'cap') { head.add(part(G.hairCap, accent, 0, 0.05, 0, 1.02, 0.9, 1.02)); head.add(part(G.box, accent, 0, 0.17, 0.33, 0.44, 0.035, 0.26)); }
  if (hat === 'beanie') { head.add(part(G.hairCap, accent, 0, 0.05, 0, 1.03, 1.05, 1.03)); head.add(part(G.cyl, darker(accent), 0, 0.14, 0, 0.38, 0.1, 0.38)); }
  if (hat === 'tophat') { head.add(part(G.cyl, '#17181c', 0, 0.33, 0, 0.44, 0.035, 0.44)); head.add(part(G.cyl, '#17181c', 0, 0.54, 0, 0.27, 0.4, 0.27)); head.add(part(G.cyl, accent, 0, 0.39, 0, 0.275, 0.06, 0.275)); }
  if (hat === 'crown') {
    head.add(part(G.cyl, '#e9b949', 0, 0.37, 0, 0.28, 0.12, 0.28));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; head.add(part(G.cone, '#e9b949', Math.cos(a) * 0.24, 0.49, Math.sin(a) * 0.24, 0.065, 0.16, 0.065)); }
  }
  if (hat === 'party') { const c = part(G.cone, accent, 0.06, 0.55, 0, 0.2, 0.42, 0.2); c.rotation.z = -0.12; head.add(c); head.add(part(G.hairBall, '#fff6d8', 0.09, 0.78, 0, 0.32, 0.32, 0.32)); }
  if (hat === 'hardhat') { head.add(part(G.hairCap, '#f2b632', 0, 0.06, 0, 1.03, 0.9, 1.03)); head.add(part(G.cyl, '#f2b632', 0, 0.15, 0, 0.44, 0.03, 0.44)); }
  if (hat === 'headphones') {
    head.add(part(G.box, '#23252b', 0, 0.39, 0, 0.64, 0.05, 0.08));
    head.add(part(G.cyl, '#23252b', -0.36, 0.04, 0, 0.11, 0.08, 0.11).rotateZ(Math.PI / 2)); head.add(part(G.cyl, '#23252b', 0.36, 0.04, 0, 0.11, 0.08, 0.11).rotateZ(Math.PI / 2));
  }
}
function buildOutfit(root, look, parts) {
  const c = look.outfitColor;
  const o = look.outfit;
  parts.body.material = mat(o === 'labcoat' ? '#f2f0ea' : c);
  const add = (m) => parts.torso.add(m);
  if (o === 'suit') { add(part(G.box, '#f4f1ea', 0, 0.2, 0.19, 0.16, 0.22, 0.06)); add(part(G.box, '#a8323a', 0, 0.12, 0.225, 0.05, 0.26, 0.02)); add(part(G.box, darker(c, 0.75), 0, -0.22, 0.2, 0.42, 0.04, 0.05)); }
  if (o === 'shirt') { add(part(G.box, darker(c, 1.3), 0, 0.29, 0.14, 0.28, 0.05, 0.14)); for (let i = 0; i < 3; i++) add(part(G.ball, '#f6f3ea', 0, 0.16 - i * 0.12, 0.235, 0.22, 0.22, 0.12)); add(part(G.box, '#3a2d26', 0, -0.24, 0.2, 0.44, 0.05, 0.06)); }
  if (o === 'hoodie') { add(part(G.hairBall, darker(c, 0.82), 0, 0.32, -0.12, 1.3, 0.75, 0.9)); add(part(G.box, darker(c, 0.82), 0, -0.12, 0.21, 0.24, 0.12, 0.03)); add(part(G.box, '#f1ead8', -0.06, 0.2, 0.23, 0.02, 0.18, 0.02)); add(part(G.box, '#f1ead8', 0.06, 0.2, 0.23, 0.02, 0.18, 0.02)); }
  if (o === 'tee') add(part(G.box, darker(c, 1.45), 0, 0.08, 0.22, 0.17, 0.14, 0.02));
  if (o === 'dress') { const skirt = part(G.cone, c, 0, -0.24, 0, 0.36, 0.5, 0.36); add(skirt); add(part(G.box, darker(c, 0.7), 0, -0.02, 0.2, 0.4, 0.04, 0.1)); }
  if (o === 'labcoat') { add(part(G.box, c, 0, 0.1, 0.21, 0.1, 0.44, 0.03)); add(part(G.box, '#3f8efc', 0.11, 0.07, 0.225, 0.05, 0.04, 0.02)); add(part(G.box, '#e3dfd3', -0.12, -0.12, 0.225, 0.12, 0.1, 0.01)); }
  if (o === 'overalls') { add(part(G.box, '#f2eee4', 0, 0.2, 0.18, 0.32, 0.22, 0.08)); add(part(G.box, c, -0.1, 0.22, 0.22, 0.05, 0.24, 0.02)); add(part(G.box, c, 0.1, 0.22, 0.22, 0.05, 0.24, 0.02)); add(part(G.box, c, 0, 0.02, 0.22, 0.2, 0.14, 0.02)); }
  const sleeve = o === 'tee' ? look.skin : o === 'labcoat' ? '#f2f0ea' : o === 'overalls' ? '#f2eee4' : o === 'dress' ? look.skin : c;
  parts.armL.children[0].material = mat(sleeve); parts.armR.children[0].material = mat(sleeve);
  const trouser = o === 'suit' ? darker(c, 0.85) : o === 'overalls' ? c : o === 'dress' ? look.skin : o === 'labcoat' ? '#3a3f4c' : '#30343f';
  parts.legL.children[0].material = mat(trouser); parts.legR.children[0].material = mat(trouser);
}

const ANIMS = ['walk', 'sit', 'type', 'talk', 'carry', 'cheer', 'think', 'listen', 'stretch', 'sip', 'phone', 'pour'];
/** Unscaled height of the top of the head: where the name label hangs from. */
export const HEAD_TOP = 1.7;

export class Character {
  constructor(look, { accent = '#d9774a', scale = 1 } = {}) {
    this.group = new THREE.Group();
    this.look = look; this.accent = accent; this.scale = scale;
    this.t = Math.random() * 10;
    this.anim = 'stand'; this.blend = Object.fromEntries(ANIMS.map((n) => [n, 0]));
    this.nod = 0;
    this.build();
    this.group.scale.setScalar(scale);
  }
  build() {
    const { look, accent } = this;
    const root = new THREE.Group(); root.position.y = 0.62;
    this.root = root;
    const limb = (x, y, cloth) => {
      const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
      pivot.add(part(G.limb, cloth, 0, -0.2, 0));
      root.add(pivot);
      return pivot;
    };
    const torso = new THREE.Group(); torso.position.y = 0.16; root.add(torso);
    const body = part(G.body, look.outfitColor); torso.add(body);
    root.add(part(G.cyl, look.skin, 0, 0.56, 0, 0.09, 0.12, 0.09));
    const armL = limb(-0.29, 0.36, look.outfitColor), armR = limb(0.29, 0.36, look.outfitColor);
    armL.add(part(G.ball, look.skin, 0, -0.4, 0)); armR.add(part(G.ball, look.skin, 0, -0.4, 0));
    const legL = limb(-0.12, -0.14, '#30343f'), legR = limb(0.12, -0.14, '#30343f');
    const shoe = look.outfit === 'suit' ? '#1c1d22' : look.outfit === 'overalls' ? '#5a4634' : '#2a2c36';
    legL.add(part(G.box, shoe, 0, -0.42, 0.05, 0.16, 0.09, 0.27)); legR.add(part(G.box, shoe, 0, -0.42, 0.05, 0.16, 0.09, 0.27));
    const head = new THREE.Group(); head.position.set(0, 0.7, 0);
    head.add(part(G.head, look.skin, 0, 0, 0, 1, 1.04, 1));
    head.add(part(G.ball, look.skin, -0.35, -0.02, 0, 0.9, 0.9, 0.6)); head.add(part(G.ball, look.skin, 0.35, -0.02, 0, 0.9, 0.9, 0.6));
    // Eyes keep their own mesh so they can blink; everything else on the head is one piece.
    const eyes = new THREE.Group(); head.add(eyes);
    for (const x of [-0.125, 0.125]) {
      const w = part(G.eyeWhite, '#fbfaf6', x, 0.03, 0.3, 1, 1, 0.55); w.castShadow = false; eyes.add(w);
      const p = part(G.eye, '#22202a', x, 0.03, 0.335, 1, 1, 0.8); p.castShadow = false; eyes.add(p);
    }
    const browC = look.hair === 'none' ? darker(look.skin, 0.55) : look.hairColor;
    const bL = part(G.box, browC, -0.13, 0.14, 0.32, 0.12, 0.028, 0.03), bR = part(G.box, browC, 0.13, 0.14, 0.32, 0.12, 0.028, 0.03);
    bL.rotation.z = 0.12; bR.rotation.z = -0.12; head.add(bL, bR);
    const mouth = new THREE.Mesh(G.smile, mat(darker(look.skin, 0.5))); mouth.position.set(0, -0.12, 0.33); mouth.rotation.z = Math.PI; mouth.castShadow = false; head.add(mouth);
    head.add(part(G.hairBall, darker(look.skin, 0.92), 0, -0.03, 0.34, 0.22, 0.2, 0.18));
    head.add(part(G.ball, darker(look.skin, 0.9), -0.2, -0.06, 0.28, 0.5, 0.35, 0.3)); head.add(part(G.ball, darker(look.skin, 0.9), 0.2, -0.06, 0.28, 0.5, 0.35, 0.3));
    if (look.glasses === 'round') { for (const x of [-0.125, 0.125]) { const r = new THREE.Mesh(G.ring, mat('#22202a')); r.position.set(x, 0.03, 0.345); head.add(r); } head.add(part(G.box, '#22202a', 0, 0.03, 0.35, 0.08, 0.014, 0.014)); }
    if (look.glasses === 'shades') { head.add(part(G.box, '#101114', -0.125, 0.03, 0.345, 0.17, 0.09, 0.02)); head.add(part(G.box, '#101114', 0.125, 0.03, 0.345, 0.17, 0.09, 0.02)); head.add(part(G.box, '#101114', 0, 0.05, 0.35, 0.1, 0.02, 0.014)); }
    buildHair(head, look);
    buildHat(head, look, accent);
    root.add(head);
    Object.assign(this, { torso, body, armL, armR, legL, legR, head, eyes });
    buildOutfit(root, look, this);
    // Props: shown only while in use, so they cost nothing the rest of the time.
    this.paper = new THREE.Mesh(G.paper, mat('#fbf7ea')); this.paper.visible = false; this.paper.position.set(0, 0.26, 0.36); this.paper.rotation.x = 0.3; this.paper.userData.keep = true;
    root.add(this.paper);
    this.mug = new THREE.Mesh(G.mug, mat(accent)); this.mug.visible = false; this.mug.position.set(0, -0.42, 0.07); this.mug.userData.keep = true; armR.add(this.mug);
    this.phone = new THREE.Mesh(G.phone, mat('#1b1c22')); this.phone.visible = false; this.phone.position.set(-0.02, -0.4, 0.09); this.phone.rotation.x = -0.6; this.phone.userData.keep = true; armR.add(this.phone);
    this.group.add(root);
    // Each moving part keeps its pivot; everything rigid on it becomes one draw call.
    mergeColored(head, CHAR_MAT, (o) => o.parent === eyes);
    mergeColored(eyes, CHAR_MAT);
    mergeColored(torso, CHAR_MAT);
    for (const pivot of [armL, armR, legL, legR]) mergeColored(pivot, CHAR_MAT);
  }
  setAnim(name) { this.anim = name; }
  /** Advance the procedural animation. Named poses blend so nothing ever snaps. */
  update(dt, speed = 0) {
    this.t += dt;
    const t = this.t, b = this.blend;
    const a = this.anim;
    const seatedAnim = a === 'sit' || a === 'type' || a === 'think' || a === 'stretch';
    const want = {
      walk: speed > 0.01 ? 1 : 0, sit: seatedAnim ? 1 : 0, type: a === 'type' ? 1 : 0, talk: a === 'talk' ? 1 : 0,
      carry: this.paper.visible ? 1 : 0, cheer: a === 'cheer' ? 1 : 0, think: a === 'think' ? 1 : 0, listen: a === 'listen' ? 1 : 0,
      stretch: a === 'stretch' ? 1 : 0, sip: a === 'sip' ? 1 : 0, phone: a === 'phone' ? 1 : 0, pour: a === 'pour' ? 1 : 0,
    };
    const k = Math.min(1, dt * 9);
    for (const n of ANIMS) b[n] += (want[n] - b[n]) * k;
    this.mug.visible = b.sip > 0.2 || b.pour > 0.2;
    this.phone.visible = b.phone > 0.2;
    const swing = Math.sin(t * 9.5);
    const bob = Math.abs(Math.cos(t * 9.5)) * 0.05 * b.walk;
    const breathe = Math.sin(t * 2) * 0.008;
    // Legs: swing when walking, bent forward when sitting.
    this.legL.rotation.x = swing * 0.66 * b.walk - b.sit * 1.5;
    this.legR.rotation.x = -swing * 0.66 * b.walk - b.sit * 1.5;
    this.root.position.y = 0.62 + bob + breathe - b.sit * 0.04 + Math.abs(Math.sin(t * 7)) * 0.14 * b.cheer;
    // A walker leans into the step and sways at the hips; a listener shifts weight now and then.
    this.root.rotation.x = b.walk * 0.07 - b.stretch * 0.1 + b.phone * 0.05;
    this.root.rotation.z = Math.sin(t * 4.75) * 0.035 * b.walk + Math.sin(t * 0.9) * 0.02 * b.listen;
    // Arms: layered from walking, typing, talking, carrying, cheering and the idle moments.
    const typeL = Math.sin(t * 19) * 0.08, typeR = Math.sin(t * 17 + 1.3) * 0.08;
    let aL = -swing * 0.58 * b.walk, aR = swing * 0.58 * b.walk;
    let zL = -0.08, zR = 0.08;
    aL += b.sit * (-0.35) + b.type * (-0.55 + typeL);
    aR += b.sit * (-0.35) + b.type * (-0.55 + typeR);
    zL += b.type * 0.22; zR -= b.type * 0.22;
    aR += b.talk * (-1.25 + Math.sin(t * 5) * 0.32); zR += b.talk * 0.35; aL += b.talk * (-0.45 + Math.sin(t * 3.3) * 0.12);
    aL += b.carry * (-1.15 - aL); aR += b.carry * (-1.15 - aR); zL += b.carry * 0.3; zR -= b.carry * 0.3;
    aL += b.cheer * (-2.9 - aL + Math.sin(t * 11) * 0.2); aR += b.cheer * (-2.9 - aR - Math.sin(t * 11) * 0.2);
    zL -= b.cheer * 0.25; zR += b.cheer * 0.25;
    aR += b.think * (-2.25 - aR); zR += b.think * 0.62; aL += b.think * (-0.6 - aL); zL += b.think * 0.55;
    aL += b.listen * (-0.5 - aL); aR += b.listen * (-0.5 - aR); zL += b.listen * 0.45; zR -= b.listen * 0.45;
    const st = Math.min(1, Math.max(0, Math.sin(t * 1.1) * 0.5 + 0.5));
    aL += b.stretch * (-2.6 - 0.4 * st - aL); aR += b.stretch * (-2.6 - 0.4 * st - aR); zL -= b.stretch * 0.3; zR += b.stretch * 0.3;
    const sipUp = Math.sin(t * 1.4) > 0.3 ? 1 : 0; this.sipK = (this.sipK ?? 0) + (sipUp - (this.sipK ?? 0)) * Math.min(1, dt * 6);
    aR += b.sip * (-1.5 - 0.75 * this.sipK - aR); zR += b.sip * 0.45; aL += b.sip * (-0.2 - aL);
    aR += b.phone * (-1.55 - aR); zR += b.phone * 0.3; aL += b.phone * (-0.3 - aL);
    aR += b.pour * (-1.0 - aR); zR -= b.pour * 0.35; aL += b.pour * (-0.25 - aL);
    this.armL.rotation.x = aL; this.armR.rotation.x = aR;
    this.armL.rotation.z = zL; this.armR.rotation.z = zR;
    this.armR.rotation.y = b.pour * -0.6;
    // Head: small life, looking down while typing or at a phone, tilting while thinking, nodding while talking or listening.
    const nodWave = Math.sin(t * 1.7); const nod = nodWave > 0.75 ? (nodWave - 0.75) * 4 * Math.sin(t * 14) : 0;
    this.head.rotation.x = b.type * (0.14 + Math.sin(t * 6) * 0.02) + Math.sin(t * 0.7) * 0.03 - b.think * 0.1 + b.talk * Math.sin(t * 3) * 0.08
      + b.listen * nod * 0.12 - b.stretch * 0.3 + b.phone * 0.38 + b.pour * 0.22 - b.sip * this.sipK * 0.18;
    this.head.rotation.y = Math.sin(t * 0.43) * 0.22 * (1 - b.type - b.listen * 0.8) + b.talk * Math.sin(t * 2.1) * 0.15;
    this.head.rotation.z = b.think * 0.18 + Math.sin(t * 0.31) * 0.025 + b.listen * Math.sin(t * 0.5) * 0.04;
    this.torso.rotation.z = Math.sin(t * 9.5) * 0.02 * b.walk;
    this.torso.rotation.y = b.talk * Math.sin(t * 2.1) * 0.08;
    // Blink.
    const blink = (t % 3.7) < 0.1 ? 0.15 : 1;
    this.eyes.scale.y = blink;
  }
  dispose() { disposeMerged(this.group); this.group.removeFromParent(); }
}

/** A turntable preview for the character builder, with its own small renderer. */
export function createPreview(canvas, look, accent) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { canvas.hidden = true; return { update() {}, dispose() {} }; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width || 200, rect.height || 240, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#d2e3f5', '#c9bba6', 1.5));
  const sun = new THREE.DirectionalLight('#fff0d8', 2.6); sun.position.set(2.5, 4, 3); sun.castShadow = true; sun.shadow.mapSize.set(512, 512);
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 3, bottom: -1, near: 1, far: 12 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0005; scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 28), new THREE.ShadowMaterial({ opacity: 0.22 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const cam = new THREE.PerspectiveCamera(26, (rect.width || 200) / (rect.height || 240), 0.1, 30);
  cam.position.set(0, 1.5, 5.4); cam.lookAt(0, 0.95, 0);
  let ch = new Character(look, { accent }); scene.add(ch.group);
  let raf, dead = false, last = performance.now();
  const loop = (now) => {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    ch.group.rotation.y = Math.sin(now / 1400) * 0.55;
    ch.update(dt);
    renderer.render(scene, cam);
  };
  raf = requestAnimationFrame(loop);
  return {
    update(next, acc = accent) { ch.dispose(); ch = new Character(next, { accent: acc }); scene.add(ch.group); },
    dispose() { dead = true; cancelAnimationFrame(raf); floor.geometry.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); },
  };
}
