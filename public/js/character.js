// The little people. Everything is built from a few low-poly shapes with shared geometry, so a floor stays cheap to draw.
import * as THREE from '../vendor/three/three.module.min.js';
import { mergeMeshes, disposeMerged } from './batch.js';

const G = {
  head: new THREE.IcosahedronGeometry(0.34, 2),
  body: new THREE.CapsuleGeometry(0.21, 0.28, 3, 10),
  limb: new THREE.CapsuleGeometry(0.075, 0.26, 2, 7),
  eye: new THREE.SphereGeometry(0.038, 8, 6),
  hairCap: new THREE.SphereGeometry(0.36, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hairBall: new THREE.IcosahedronGeometry(0.15, 1),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  cone: new THREE.ConeGeometry(1, 1, 12),
  ring: new THREE.TorusGeometry(0.075, 0.016, 6, 14),
  paper: new THREE.BoxGeometry(0.26, 0.02, 0.34),
};
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
  if (style === 'short') cap();
  if (style === 'side') { cap(); const f = part(G.hairBall, c, 0.15, 0.27, 0.22, 1.1, 0.5, 0.55); head.add(f); }
  if (style === 'long') { cap(); head.add(part(G.box, c, 0, -0.14, -0.2, 0.66, 0.62, 0.22)); }
  if (style === 'bun') { cap(); head.add(part(G.hairBall, c, 0, 0.44, -0.14)); }
  if (style === 'curly') {
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      head.add(part(G.hairBall, c, Math.cos(a) * 0.27, 0.2 + (i % 2) * 0.09, Math.sin(a) * 0.25 - 0.03));
    }
    head.add(part(G.hairBall, c, 0, 0.34, 0, 1.4, 0.9, 1.4));
  }
  if (style === 'mohawk') for (let i = 0; i < 5; i++) head.add(part(G.box, c, 0, 0.33 + Math.sin((i / 4) * Math.PI) * 0.08, 0.2 - i * 0.11, 0.08, 0.2, 0.1));
  if (style === 'pigtails') { cap(); head.add(part(G.hairBall, c, -0.36, 0.02, -0.04, 0.8, 1.2, 0.8)); head.add(part(G.hairBall, c, 0.36, 0.02, -0.04, 0.8, 1.2, 0.8)); }
}
function buildHat(head, look, accent) {
  const hat = look.hat;
  if (hat === 'cap') { head.add(part(G.hairCap, accent, 0, 0.05, 0, 1.02, 0.9, 1.02)); head.add(part(G.box, accent, 0, 0.17, 0.33, 0.44, 0.035, 0.26)); }
  if (hat === 'beanie') { head.add(part(G.hairCap, accent, 0, 0.05, 0, 1.03, 1.05, 1.03)); head.add(part(G.cyl, darker(accent), 0, 0.14, 0, 0.36, 0.1, 0.36)); }
  if (hat === 'tophat') { head.add(part(G.cyl, '#17181c', 0, 0.33, 0, 0.42, 0.035, 0.42)); head.add(part(G.cyl, '#17181c', 0, 0.54, 0, 0.26, 0.4, 0.26)); head.add(part(G.cyl, accent, 0, 0.39, 0, 0.265, 0.06, 0.265)); }
  if (hat === 'crown') {
    head.add(part(G.cyl, '#e9b949', 0, 0.36, 0, 0.27, 0.12, 0.27));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; head.add(part(G.cone, '#e9b949', Math.cos(a) * 0.23, 0.48, Math.sin(a) * 0.23, 0.065, 0.16, 0.065)); }
  }
  if (hat === 'party') { const c = part(G.cone, accent, 0.06, 0.53, 0, 0.2, 0.42, 0.2); c.rotation.z = -0.12; head.add(c); head.add(part(G.hairBall, '#fff6d8', 0.09, 0.76, 0, 0.32, 0.32, 0.32)); }
  if (hat === 'hardhat') { head.add(part(G.hairCap, '#f2b632', 0, 0.06, 0, 1.03, 0.9, 1.03)); head.add(part(G.cyl, '#f2b632', 0, 0.15, 0, 0.42, 0.03, 0.42)); }
  if (hat === 'headphones') {
    head.add(part(G.box, '#23252b', 0, 0.37, 0, 0.62, 0.05, 0.08));
    head.add(part(G.cyl, '#23252b', -0.34, 0.04, 0, 0.11, 0.08, 0.11).rotateZ(Math.PI / 2)); head.add(part(G.cyl, '#23252b', 0.34, 0.04, 0, 0.11, 0.08, 0.11).rotateZ(Math.PI / 2));
  }
}
function buildOutfit(root, look, parts) {
  const c = look.outfitColor;
  const o = look.outfit;
  parts.torso.material = mat(o === 'labcoat' ? '#f2f0ea' : c);
  const add = (m) => parts.torso.add(m);
  if (o === 'suit') { add(part(G.box, '#f4f1ea', 0, 0.2, 0.17, 0.14, 0.2, 0.06)); add(part(G.box, '#a8323a', 0, 0.16, 0.2, 0.04, 0.2, 0.02)); }
  if (o === 'shirt') add(part(G.box, darker(c, 1.3), 0, 0.27, 0.13, 0.26, 0.05, 0.13));
  if (o === 'hoodie') { add(part(G.hairBall, darker(c, 0.82), 0, 0.3, -0.12, 1.3, 0.75, 0.9)); add(part(G.box, darker(c, 0.82), 0, -0.1, 0.19, 0.22, 0.1, 0.03)); }
  if (o === 'tee') add(part(G.box, darker(c, 1.45), 0, 0.08, 0.2, 0.15, 0.13, 0.02));
  if (o === 'dress') { const skirt = part(G.cone, c, 0, -0.2, 0, 0.32, 0.46, 0.32); add(skirt); }
  if (o === 'labcoat') { add(part(G.box, c, 0, 0.1, 0.19, 0.1, 0.4, 0.03)); add(part(G.box, '#3f8efc', 0.1, 0.07, 0.2, 0.05, 0.04, 0.02)); }
  if (o === 'overalls') { add(part(G.box, '#f2eee4', 0, 0.2, 0.16, 0.3, 0.2, 0.08)); add(part(G.box, c, -0.09, 0.22, 0.2, 0.045, 0.22, 0.02)); add(part(G.box, c, 0.09, 0.22, 0.2, 0.045, 0.22, 0.02)); }
  const sleeve = o === 'tee' ? look.skin : o === 'labcoat' ? '#f2f0ea' : o === 'overalls' ? '#f2eee4' : o === 'dress' ? look.skin : c;
  parts.armL.children[0].material = mat(sleeve); parts.armR.children[0].material = mat(sleeve);
  const trouser = o === 'suit' ? darker(c, 0.85) : o === 'overalls' ? c : o === 'dress' ? look.skin : o === 'labcoat' ? '#3a3f4c' : '#30343f';
  parts.legL.children[0].material = mat(trouser); parts.legR.children[0].material = mat(trouser);
}

export class Character {
  constructor(look, { accent = '#d9774a', scale = 1 } = {}) {
    this.group = new THREE.Group();
    this.look = look; this.accent = accent;
    this.t = Math.random() * 10;
    this.anim = 'stand'; this.blend = { walk: 0, sit: 0, type: 0, talk: 0, carry: 0, cheer: 0, think: 0 };
    this.build();
    this.group.scale.setScalar(scale);
  }
  build() {
    const { look, accent } = this;
    const root = new THREE.Group(); root.position.y = 0.62;
    this.root = root;
    const limb = (x, y, skinOrCloth) => {
      const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
      pivot.add(part(G.limb, skinOrCloth, 0, -0.19, 0));
      root.add(pivot);
      return pivot;
    };
    const torso = part(G.body, look.outfitColor, 0, 0.16, 0);
    root.add(torso);
    const armL = limb(-0.27, 0.34, look.outfitColor), armR = limb(0.27, 0.34, look.outfitColor);
    const handL = part(G.hairBall, look.skin, 0, -0.37, 0, 0.55, 0.55, 0.55); armL.add(handL);
    const handR = part(G.hairBall, look.skin, 0, -0.37, 0, 0.55, 0.55, 0.55); armR.add(handR);
    const legL = limb(-0.11, -0.12, '#30343f'), legR = limb(0.11, -0.12, '#30343f');
    legL.add(part(G.box, '#1c1d22', 0, -0.4, 0.05, 0.14, 0.08, 0.24)); legR.add(part(G.box, '#1c1d22', 0, -0.4, 0.05, 0.14, 0.08, 0.24));
    const head = new THREE.Group(); head.position.set(0, 0.66, 0);
    head.add(part(G.head, look.skin));
    const eyeL = part(G.eye, '#22202a', -0.115, 0.03, 0.305), eyeR = part(G.eye, '#22202a', 0.115, 0.03, 0.305);
    eyeL.castShadow = false; eyeR.castShadow = false;
    head.add(eyeL, eyeR);
    head.add(part(G.box, darker(look.skin, 0.62), 0, -0.11, 0.315, 0.09, 0.016, 0.02));
    head.add(part(G.hairBall, darker(look.skin, 0.92), 0, -0.04, 0.33, 0.24, 0.22, 0.2));
    if (look.glasses === 'round') { for (const x of [-0.115, 0.115]) { const r = new THREE.Mesh(G.ring, mat('#22202a')); r.position.set(x, 0.03, 0.325); head.add(r); } head.add(part(G.box, '#22202a', 0, 0.03, 0.33, 0.08, 0.014, 0.014)); }
    if (look.glasses === 'shades') { head.add(part(G.box, '#101114', -0.115, 0.03, 0.325, 0.16, 0.09, 0.02)); head.add(part(G.box, '#101114', 0.115, 0.03, 0.325, 0.16, 0.09, 0.02)); head.add(part(G.box, '#101114', 0, 0.05, 0.33, 0.1, 0.02, 0.014)); }
    buildHair(head, look);
    buildHat(head, look, accent);
    root.add(head);
    Object.assign(this, { torso, armL, armR, legL, legR, head, eyeL, eyeR });
    buildOutfit(root, look, this);
    this.paper = new THREE.Mesh(G.paper, mat('#fbf7ea')); this.paper.visible = false; this.paper.position.set(0, 0.24, 0.31); this.paper.rotation.x = 0.3;
    root.add(this.paper);
    this.group.add(root);
    // Each moving part keeps its pivot; everything rigid on it becomes one draw call.
    mergeMeshes(head, (o) => o === eyeL || o === eyeR);
    mergeMeshes(torso);
    for (const pivot of [armL, armR, legL, legR]) mergeMeshes(pivot);
  }
  setAnim(name) { this.anim = name; }
  /** Advance the procedural animation. Named poses blend so nothing ever snaps. */
  update(dt, speed = 0) {
    this.t += dt;
    const t = this.t, b = this.blend;
    const a = this.anim;
    const want = { walk: speed > 0.01 ? 1 : 0, sit: a === 'sit' || a === 'type' || a === 'think' ? 1 : 0, type: a === 'type' ? 1 : 0, talk: a === 'talk' ? 1 : 0, carry: this.paper.visible ? 1 : 0, cheer: a === 'cheer' ? 1 : 0, think: a === 'think' ? 1 : 0 };
    const k = Math.min(1, dt * 9);
    for (const n of Object.keys(b)) b[n] += (want[n] - b[n]) * k;
    const swing = Math.sin(t * 9.5);
    const bob = Math.abs(Math.cos(t * 9.5)) * 0.045 * b.walk;
    const breathe = Math.sin(t * 2) * 0.008;
    // Legs: swing when walking, bent forward when sitting.
    this.legL.rotation.x = swing * 0.62 * b.walk - b.sit * 1.5;
    this.legR.rotation.x = -swing * 0.62 * b.walk - b.sit * 1.5;
    this.root.position.y = 0.62 + bob + breathe - b.sit * 0.03 + Math.abs(Math.sin(t * 7)) * 0.12 * b.cheer;
    // Arms: layered from walking, typing, talking, carrying and cheering.
    const typeL = Math.sin(t * 19) * 0.09, typeR = Math.sin(t * 17 + 1.3) * 0.09;
    let aL = -swing * 0.55 * b.walk, aR = swing * 0.55 * b.walk;
    aL += b.sit * (-0.35) + b.type * (-0.95 + typeL);
    aR += b.sit * (-0.35) + b.type * (-0.95 + typeR);
    aR += b.talk * (-1.35 + Math.sin(t * 5) * 0.32);
    aL += b.carry * (-1.15 - aL); aR += b.carry * (-1.15 - aR);
    aL += b.cheer * (-2.9 - aL + Math.sin(t * 11) * 0.2); aR += b.cheer * (-2.9 - aR - Math.sin(t * 11) * 0.2);
    aR += b.think * (-1.9 - aR);
    this.armL.rotation.x = aL; this.armR.rotation.x = aR;
    this.armL.rotation.z = -0.08 - b.cheer * 0.25 - b.carry * -0.3; this.armR.rotation.z = 0.08 + b.cheer * 0.25 - b.carry * 0.3 + b.think * 0.5;
    // Head: small life, plus looking down while typing and tilting while thinking.
    this.head.rotation.x = b.type * 0.12 + Math.sin(t * 0.7) * 0.03 - b.think * 0.1;
    this.head.rotation.y = Math.sin(t * 0.43) * 0.22 * (1 - b.type) + b.talk * Math.sin(t * 2.1) * 0.15;
    this.head.rotation.z = b.think * 0.16 + Math.sin(t * 0.31) * 0.025;
    this.torso.rotation.z = Math.sin(t * 9.5) * 0.02 * b.walk;
    // Blink.
    const blink = (t % 3.7) < 0.1 ? 0.15 : 1;
    this.eyeL.scale.y = blink; this.eyeR.scale.y = blink;
  }
  dispose() { disposeMerged(this.group); this.group.removeFromParent(); }
}

/** A turntable preview for the character builder, with its own small renderer. */
export function createPreview(canvas, look, accent) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { canvas.hidden = true; return { update() {}, dispose() {} }; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width || 200, rect.height || 240, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff3e0', '#5a4a66', 2.1));
  const sun = new THREE.DirectionalLight('#ffe2c0', 2.2); sun.position.set(2, 4, 3); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(26, (rect.width || 200) / (rect.height || 240), 0.1, 30);
  cam.position.set(0, 1.5, 5.2); cam.lookAt(0, 0.92, 0);
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
    dispose() { dead = true; cancelAnimationFrame(raf); renderer.dispose(); renderer.forceContextLoss?.(); },
  };
}
