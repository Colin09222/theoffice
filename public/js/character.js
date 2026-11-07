// The little people. Two kinds share one interface (group, setAnim, update, paper/mug/phone, dispose, seatedY, labelY):
// - Character: built from a few low-poly shapes, every rigid part baked into one vertex-coloured mesh. It appears at once and
//   stays if a model never arrives.
// - ModelCharacter: one of Kenney's CC0 mini characters (see /models/NOTICE.txt), a 7-bone rig with its own walk, idle and
//   sit clips, recoloured to the saved look. The same procedural layers (typing, talking, carrying, cheering, thinking...)
//   are added on top of the clips by turning the bones, so every agent state reads the same on both.
import * as THREE from '../vendor/three/three.module.min.js';
import { mergeColored, disposeMerged } from './batch.js';
import { character as loadCharacterAsset, accessory, skeletonUtils, ATLAS } from './models.js';

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
  halo: new THREE.TorusGeometry(0.22, 0.035, 6, 18),
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
function buildHat(head, look, accent, dome = 1) {
  const hat = look.hat;
  if (hat === 'cap') { head.add(part(G.hairCap, accent, 0, 0.05 * dome, 0, 1.02 * dome, 0.9, 1.02 * dome)); head.add(part(G.box, accent, 0, 0.17, 0.33 * dome, 0.44, 0.035, 0.26)); }
  if (hat === 'beanie') { head.add(part(G.hairCap, accent, 0, 0.05 * dome, 0, 1.03 * dome, 1.05, 1.03 * dome)); head.add(part(G.cyl, darker(accent), 0, 0.14, 0, 0.38 * dome, 0.1, 0.38 * dome)); }
  if (hat === 'tophat') { head.add(part(G.cyl, '#17181c', 0, 0.33, 0, 0.44, 0.035, 0.44)); head.add(part(G.cyl, '#17181c', 0, 0.54, 0, 0.27, 0.4, 0.27)); head.add(part(G.cyl, accent, 0, 0.39, 0, 0.275, 0.06, 0.275)); }
  if (hat === 'crown') {
    head.add(part(G.cyl, '#e9b949', 0, 0.37, 0, 0.28, 0.12, 0.28));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; head.add(part(G.cone, '#e9b949', Math.cos(a) * 0.24, 0.49, Math.sin(a) * 0.24, 0.065, 0.16, 0.065)); }
  }
  if (hat === 'party') { const c = part(G.cone, accent, 0.06, 0.55, 0, 0.2, 0.42, 0.2); c.rotation.z = -0.12; head.add(c); head.add(part(G.hairBall, '#fff6d8', 0.09, 0.78, 0, 0.32, 0.32, 0.32)); }
  if (hat === 'hardhat') { head.add(part(G.hairCap, '#f2b632', 0, 0.06 * dome, 0, 1.03 * dome, 0.9, 1.03 * dome)); head.add(part(G.cyl, '#f2b632', 0, 0.15, 0, 0.44 * dome, 0.03, 0.44 * dome)); }
  if (hat === 'headphones') {
    head.add(part(G.box, '#23252b', 0, 0.39, 0, 0.64, 0.05, 0.08));
    head.add(part(G.cyl, '#23252b', -0.36, 0.04, 0, 0.11, 0.08, 0.11).rotateZ(Math.PI / 2)); head.add(part(G.cyl, '#23252b', 0.36, 0.04, 0, 0.11, 0.08, 0.11).rotateZ(Math.PI / 2));
  }
  if (hat === 'cowboy') { head.add(part(G.cyl, '#8a5a2b', 0, 0.3, 0, 0.62, 0.035, 0.5)); head.add(part(G.cyl, '#8a5a2b', 0, 0.45, 0, 0.27, 0.3, 0.27)); head.add(part(G.cyl, accent, 0, 0.34, 0, 0.28, 0.06, 0.28)); }
  if (hat === 'wizard') { head.add(part(G.cyl, '#3c2f7c', 0, 0.3, 0, 0.46, 0.035, 0.46)); const c = part(G.cone, '#3c2f7c', 0, 0.68, -0.02, 0.32, 0.8, 0.32); c.rotation.x = -0.1; head.add(c); head.add(part(G.hairBall, '#f4c95d', 0.1, 0.56, 0.2, 0.3, 0.3, 0.3)); head.add(part(G.hairBall, '#f4c95d', -0.08, 0.76, 0.12, 0.22, 0.22, 0.22)); }
  if (hat === 'chef') { head.add(part(G.cyl, '#f7f4ec', 0, 0.36, 0, 0.3, 0.18, 0.3)); head.add(part(G.hairBall, '#f7f4ec', 0, 0.6, 0, 2.3, 1.5, 2.3)); }
  if (hat === 'viking') { head.add(part(G.hairCap, '#8e959c', 0, 0.05 * dome, 0, 1.03 * dome, 0.95, 1.03 * dome)); head.add(part(G.cyl, '#6d4a2c', 0, 0.16, 0, 0.39 * dome, 0.05, 0.39 * dome)); for (const s of [-1, 1]) { const horn = part(G.cone, '#efe6d0', s * 0.42, 0.4, 0, 0.07, 0.36, 0.07); horn.rotation.z = -s * 0.5; head.add(horn); } }
  if (hat === 'pirate') { head.add(part(G.cyl, '#17181c', 0, 0.3, 0, 0.46, 0.05, 0.34)); const crown = part(G.box, '#17181c', 0, 0.34, 0, 0.72, 0.24, 0.3); head.add(crown); head.add(part(G.hairBall, '#f4f1ea', 0, 0.48, 0.14, 0.42, 0.42, 0.2)); }
  if (hat === 'beret') { const b = part(G.hairBall, accent, 0.06, 0.34, 0, 2.5, 0.9, 2.5); b.rotation.z = -0.2; head.add(b); head.add(part(G.cyl, darker(accent), 0, 0.26, 0, 0.3, 0.05, 0.3)); }
  if (hat === 'propeller') { head.add(part(G.hairCap, accent, 0, 0.05 * dome, 0, 1.02 * dome, 0.9, 1.02 * dome)); head.add(part(G.cyl, '#2b2d35', 0, 0.44, 0, 0.04, 0.14, 0.04)); head.add(part(G.box, '#e0559b', -0.2, 0.5, 0, 0.4, 0.03, 0.12)); head.add(part(G.box, '#3f8efc', 0.2, 0.5, 0, 0.4, 0.03, 0.12)); }
  if (hat === 'halo') { const r = new THREE.Mesh(G.halo, mat('#ffe27a')); r.position.y = 0.62; r.rotation.x = Math.PI / 2; head.add(r); }
}
/** Styles the kit's heads don't have, added on top of whatever hair the variant came with. Sizes are in the same head units as a hat. */
function buildModelHair(head, look) {
  const c = look.hairColor;
  if (look.hair === 'mohawk') for (let i = 0; i < 6; i++) head.add(part(G.box, c, 0, 0.27 + Math.sin((i / 5) * Math.PI) * 0.12, 0.28 - i * 0.12, 0.09, 0.24, 0.11));
  if (look.hair === 'bun') head.add(part(G.hairBall, c, 0, 0.42, -0.18, 1.05, 1.05, 1.05));
  if (look.hair === 'pigtails') for (const s of [-1, 1]) head.add(part(G.hairBall, c, s * 0.42, 0.02, -0.06, 0.95, 1.4, 0.95));
  if (look.hair === 'curly') for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; head.add(part(G.hairBall, c, Math.cos(a) * 0.3, 0.3 + (i % 2) * 0.07, Math.sin(a) * 0.28 - 0.04, 0.95, 0.85, 0.95)); }
  if (look.hair === 'long') { head.add(part(G.box, c, 0, -0.36, -0.28, 0.66, 0.66, 0.12)); for (const s of [-1, 1]) head.add(part(G.box, c, s * 0.36, -0.36, -0.08, 0.1, 0.6, 0.34)); }
}
/** Everything worn apart from a hat. `head` and `chest` are groups already sized for the character they sit on, facing +z. */
function buildExtras(head, chest, look, accent) {
  const e = look.wear;
  if (!e || e === 'none') return;
  const hair = look.hair === 'none' ? '#4a2f1d' : look.hairColor;
  if (e === 'beard') { head.add(part(G.box, hair, 0, -0.26, 0.28, 0.5, 0.26, 0.14)); head.add(part(G.box, hair, 0, -0.34, 0.3, 0.3, 0.16, 0.12)); }
  if (e === 'moustache') for (const s of [-1, 1]) { const m = part(G.box, hair, s * 0.08, -0.1, 0.36, 0.17, 0.05, 0.06); m.rotation.z = s * -0.25; head.add(m); }
  if (e === 'scarf') { chest.add(part(G.cyl, accent, 0, 0.3, 0.03, 0.34, 0.15, 0.34)); chest.add(part(G.box, darker(accent, 0.85), 0.14, 0.02, 0.32, 0.17, 0.42, 0.06)); }
  if (e === 'bowtie') for (const s of [-1, 1]) { const b = part(G.cone, accent, s * 0.1, 0.25, 0.33, 0.1, 0.2, 0.05); b.rotation.z = s * Math.PI / 2; chest.add(b); }
  if (e === 'tie') { chest.add(part(G.box, accent, 0, 0.0, 0.32, 0.11, 0.42, 0.03)); chest.add(part(G.box, darker(accent, 0.8), 0, 0.26, 0.32, 0.15, 0.08, 0.04)); }
  if (e === 'badge') { chest.add(part(G.box, '#f7f4ec', 0.14, 0.06, 0.32, 0.16, 0.2, 0.02)); chest.add(part(G.box, accent, 0.14, 0.12, 0.33, 0.14, 0.06, 0.02)); }
  if (e === 'cape') { chest.add(part(G.box, accent, 0, -0.14, -0.34, 0.62, 0.74, 0.04)); chest.add(part(G.cyl, darker(accent, 0.8), 0, 0.3, 0, 0.3, 0.07, 0.3)); }
  if (e === 'backpack') { chest.add(part(G.box, accent, 0, 0.03, -0.38, 0.46, 0.5, 0.2)); chest.add(part(G.box, darker(accent, 0.8), 0, -0.06, -0.5, 0.3, 0.22, 0.07)); }
  if (e === 'wings') for (const s of [-1, 1]) { const w = part(G.box, '#f7f4ec', s * 0.42, 0.12, -0.42, 0.6, 0.34, 0.04); w.rotation.y = s * 0.55; w.rotation.z = s * 0.35; chest.add(w); const t = part(G.box, '#e6e0d2', s * 0.36, -0.1, -0.4, 0.42, 0.24, 0.04); t.rotation.y = s * 0.55; t.rotation.z = s * 0.2; chest.add(t); }
}
/** The eyewear the kit has no model for. */
function buildFaceWear(head, look, z, y = 0.03) {
  if (look.glasses === 'monocle') { const r = new THREE.Mesh(G.ring, mat('#e9b949')); r.position.set(0.14, y, 0.345 + z); r.scale.setScalar(1.25); head.add(r); head.add(part(G.box, '#e9b949', 0.235, y - 0.17, 0.33 + z, 0.014, 0.22, 0.014)); }
  if (look.glasses === 'eyepatch') { head.add(part(G.box, '#101114', -0.14, y - 0.02, 0.345 + z, 0.2, 0.17, 0.03)); const s = part(G.box, '#101114', 0, y + 0.08, 0.34 + z, 0.82, 0.028, 0.02); s.rotation.z = -0.2; head.add(s); }
}
/** How far above the head's centre a hat reaches, in head units, so a name label clears it. */
/** How far a hat rises above the kit's head, in the same units, so a name label clears it. */
const HAT_CLEAR = { cap: 0.1, beanie: 0.14, tophat: 0.45, crown: 0.3, party: 0.65, hardhat: 0.1, headphones: 0.08, cowboy: 0.3, wizard: 0.8, chef: 0.65, viking: 0.3, pirate: 0.25, beret: 0.14, propeller: 0.3, halo: 0.34 };
const HAT_TOP = { none: 0, cap: 0.1, beanie: 0.2, tophat: 0.75, crown: 0.58, party: 0.95, hardhat: 0.12, headphones: 0.42, cowboy: 0.5, wizard: 1.0, chef: 0.75, viking: 0.5, pirate: 0.45, beret: 0.3, propeller: 0.56, halo: 0.68 };
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

/** The blend state every character keeps: which named poses are active, eased so nothing ever snaps. */
function wantFor(anim, speed, carrying) {
  const a = anim;
  const seated = a === 'sit' || a === 'type' || a === 'think' || a === 'stretch';
  return {
    walk: speed > 0.01 ? 1 : 0, sit: seated ? 1 : 0, type: a === 'type' ? 1 : 0, talk: a === 'talk' ? 1 : 0,
    carry: carrying ? 1 : 0, cheer: a === 'cheer' ? 1 : 0, think: a === 'think' ? 1 : 0, listen: a === 'listen' ? 1 : 0,
    stretch: a === 'stretch' ? 1 : 0, sip: a === 'sip' ? 1 : 0, phone: a === 'phone' ? 1 : 0, pour: a === 'pour' ? 1 : 0,
  };
}
/** Arm angles (x: forward swing, z: outward) and head turns for the current blend. Shared by both kinds of character. */
function poseFor(b, t, dt, self) {
  const swing = Math.sin(t * 9.5);
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
  const sipUp = Math.sin(t * 1.4) > 0.3 ? 1 : 0; self.sipK = (self.sipK ?? 0) + (sipUp - (self.sipK ?? 0)) * Math.min(1, dt * 6);
  aR += b.sip * (-1.5 - 0.75 * self.sipK - aR); zR += b.sip * 0.45; aL += b.sip * (-0.2 - aL);
  aR += b.phone * (-1.55 - aR); zR += b.phone * 0.3; aL += b.phone * (-0.3 - aL);
  aR += b.pour * (-1.0 - aR); zR -= b.pour * 0.35; aL += b.pour * (-0.25 - aL);
  const nodWave = Math.sin(t * 1.7); const nod = nodWave > 0.75 ? (nodWave - 0.75) * 4 * Math.sin(t * 14) : 0;
  const headX = b.type * (0.14 + Math.sin(t * 6) * 0.02) + Math.sin(t * 0.7) * 0.03 - b.think * 0.1 + b.talk * Math.sin(t * 3) * 0.08
    + b.listen * nod * 0.12 - b.stretch * 0.3 + b.phone * 0.38 + b.pour * 0.22 - b.sip * self.sipK * 0.18;
  const headY = Math.sin(t * 0.43) * 0.22 * (1 - b.type - b.listen * 0.8) + b.talk * Math.sin(t * 2.1) * 0.15;
  const headZ = b.think * 0.18 + Math.sin(t * 0.31) * 0.025 + b.listen * Math.sin(t * 0.5) * 0.04;
  return { aL, aR, zL, zR, headX, headY, headZ, swing };
}

export class Character {
  constructor(look, { accent = '#d9774a', scale = 1 } = {}) {
    this.group = new THREE.Group();
    this.look = look; this.accent = accent; this.scale = scale;
    this.t = Math.random() * 10;
    this.anim = 'stand'; this.blend = Object.fromEntries(ANIMS.map((n) => [n, 0]));
    this.nod = 0;
    this.build();
    this.group.scale.setScalar(scale);
    this.headTop = HEAD_TOP * scale;
    this.labelY = (HEAD_TOP + (HAT_TOP[look.hat] || 0) * 0.36) * scale;
  }
  /** Group height that puts the hips on a seat whose cushion is `seatTop` high. */
  seatedY(seatTop) { return seatTop - 0.365 * this.scale; }
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
    buildFaceWear(head, look, 0);
    buildHair(head, look);
    buildHat(head, look, accent);
    root.add(head);
    Object.assign(this, { torso, body, armL, armR, legL, legR, head, eyes });
    buildOutfit(root, look, this);
    buildExtras(head, torso, look, accent);
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
  setManner(m) { this.manner = m; }
  /** Advance the procedural animation. Named poses blend so nothing ever snaps. */
  update(dt, speed = 0) {
    this.t += dt;
    const t = this.t, b = this.blend;
    const want = wantFor(this.anim, speed, this.paper.visible);
    const k = Math.min(1, dt * 9);
    for (const n of ANIMS) b[n] += (want[n] - b[n]) * k;
    this.mug.visible = b.sip > 0.2 || b.pour > 0.2;
    this.phone.visible = b.phone > 0.2;
    const p = poseFor(b, t, dt, this);
    const bob = Math.abs(Math.cos(t * 9.5)) * 0.05 * b.walk;
    const breathe = Math.sin(t * 2) * 0.008;
    // Legs: swing when walking, bent forward when sitting.
    this.legL.rotation.x = p.swing * 0.66 * b.walk - b.sit * 1.5;
    this.legR.rotation.x = -p.swing * 0.66 * b.walk - b.sit * 1.5;
    this.root.position.y = 0.62 + bob + breathe - b.sit * 0.04 + Math.abs(Math.sin(t * 7)) * 0.14 * b.cheer;
    // A walker leans into the step and sways at the hips; a listener shifts weight now and then.
    this.root.rotation.x = b.walk * 0.07 - b.stretch * 0.1 + b.phone * 0.05;
    this.root.rotation.z = Math.sin(t * 4.75) * 0.035 * b.walk + Math.sin(t * 0.9) * 0.02 * b.listen;
    this.armL.rotation.x = p.aL; this.armR.rotation.x = p.aR;
    this.armL.rotation.z = p.zL; this.armR.rotation.z = p.zR;
    this.armR.rotation.y = b.pour * -0.6;
    this.head.rotation.x = p.headX; this.head.rotation.y = p.headY; this.head.rotation.z = p.headZ;
    this.torso.rotation.z = Math.sin(t * 9.5) * 0.02 * b.walk;
    this.torso.rotation.y = b.talk * Math.sin(t * 2.1) * 0.08;
    // Blink.
    const blink = (t % 3.7) < 0.1 ? 0.15 : 1;
    this.eyes.scale.y = blink;
  }
  dispose() { disposeMerged(this.group); this.group.removeFromParent(); }
}

// ---------- Kenney's mini characters ----------

/** Which atlas cell ([column, row] of the 8x4 colormap) each variant uses for its skin, hair, top and trousers, measured from the meshes. */
const VARIANTS = {
  'character-male-a': { skin: [1, 2], hair: [3, 3], top: [4, 2], legs: [0, 1] },
  'character-male-b': { skin: [2, 2], hair: [0, 2], top: [7, 2], legs: [0, 1] },
  'character-male-c': { skin: [2, 2], hair: [0, 2], top: [3, 3], legs: [0, 1] },
  'character-male-d': { skin: [2, 2], hair: [0, 2], top: [3, 3], legs: [3, 3] },
  'character-male-e': { skin: [2, 2], hair: [1, 2], top: [7, 3], legs: [0, 3] },
  'character-male-f': { skin: [0, 2], hair: [3, 3], top: [2, 2], legs: [4, 2] },
  'character-female-a': { skin: [1, 2], hair: [3, 3], top: [0, 1], legs: [2, 1] },
  'character-female-b': { skin: [2, 2], hair: [0, 2], top: [2, 1], legs: [0, 3] },
  'character-female-c': { skin: [0, 2], hair: [1, 3], top: [0, 1], legs: [7, 2] },
  'character-female-d': { skin: [2, 2], hair: [0, 2], top: [1, 3], legs: [3, 3] },
  'character-female-e': { skin: [2, 2], hair: [3, 3], top: [7, 3], legs: [3, 3] },
  'character-female-f': { skin: [2, 2], hair: [1, 2], top: [3, 3], legs: [0, 3] },
};
/** Outfits map to the variants whose clothes are closest; the hair style then picks a side, and the rest of the look picks within it. */
const BY_OUTFIT = {
  suit: ['character-male-d', 'character-female-d'], shirt: ['character-male-e', 'character-female-e'], hoodie: ['character-male-a', 'character-female-f'],
  tee: ['character-male-b', 'character-female-a'], dress: ['character-female-d', 'character-female-b'], labcoat: ['character-male-e', 'character-female-e'],
  overalls: ['character-male-c', 'character-female-b'],
};
const FEMALE_HAIR = ['long', 'bun', 'pigtails'], MALE_HAIR = ['short', 'side', 'mohawk'];
const hashLook = (look) => { let h = 7; for (const ch of JSON.stringify([look.skin, look.hairColor, look.outfitColor, look.glasses, look.hat])) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
export function variantFor(look) {
  if (look.body && look.body !== 'auto' && VARIANTS[`character-${look.body}`]) return `character-${look.body}`;
  const cands = BY_OUTFIT[look.outfit] || BY_OUTFIT.tee;
  const female = cands.map((c) => c.includes('female'));
  let i = hashLook(look) % cands.length;
  if (FEMALE_HAIR.includes(look.hair) && female.includes(true)) i = female.indexOf(true);
  else if (MALE_HAIR.includes(look.hair) && female.includes(false)) i = female.indexOf(false);
  return cands[i];
}
const MODEL_HEAD = 0.53;  // our head parts are sized for a head of radius 0.36; this fits them to the kit's
export const MODEL_SCALE = 2.45;  // model units are about 0.67 per person; the room's people stand about 1.65 tall, 1.7 desks

/** Replaces the colours of chosen atlas cells, keeping each cell's light-to-dark shading. Uniforms live on the material so a clone keeps its look. */
function tintMaterial(src, slots, means) {
  const m = src.clone();
  const cells = [], tints = [], meansU = [];
  for (const [cell, color] of slots) {
    cells.push(new THREE.Vector2(cell[0], cell[1]));
    tints.push(new THREE.Color(color));
    meansU.push(means[cell[1] * ATLAS.cols + cell[0]] || new THREE.Color(0.5, 0.5, 0.5));
  }
  while (cells.length < 4) { cells.push(new THREE.Vector2(-1, -1)); tints.push(new THREE.Color(1, 1, 1)); meansU.push(new THREE.Color(1, 1, 1)); }
  m.userData.tint = { uCells: { value: cells }, uTints: { value: tints }, uMeans: { value: meansU }, uCount: { value: slots.length } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.tint);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uCells[4]; uniform vec3 uTints[4]; uniform vec3 uMeans[4]; uniform int uCount;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec2 _cell = floor(vMapUv * vec2(${ATLAS.cols.toFixed(1)}, ${ATLAS.rows.toFixed(1)}));
          for (int i = 0; i < 4; i++) { if (i >= uCount) break; if (_cell == uCells[i]) diffuseColor.rgb *= uTints[i] / max(uMeans[i], vec3(0.03)); } }`);
  };
  m.customProgramCacheKey = () => 'tinted-atlas';
  m.roughness = 0.78; m.metalness = 0;
  return m;
}

export class ModelCharacter {
  /** `asset` is a loaded template from models.js; `utils` is SkeletonUtils; `glasses` an optional accessory scene to clone. */
  constructor(asset, utils, look, { accent = '#d9774a', scale = MODEL_SCALE, variant, glasses = null } = {}) {
    this.group = new THREE.Group();
    this.look = look; this.accent = accent; this.scale = scale; this.variant = variant;
    this.t = Math.random() * 10;
    this.anim = 'stand'; this.blend = Object.fromEntries(ANIMS.map((n) => [n, 0]));
    this.isModel = true;
    const model = utils.clone(asset.scene);
    this.model = model;
    // The kit's people face +z, the same way ours do, so the model needs no turn inside its group.
    this.group.add(model);
    this.group.scale.setScalar(scale);
    const bone = (n) => { let b = null; model.traverse((o) => { if (o.name === n) b = o; }); return b; };
    this.root = bone('root'); this.torso = bone('torso'); this.head = bone('head');
    // Poses call the arm on the -x side "L", so the rig's own left and right are matched to that by position, not by name.
    const armA = bone('arm-left'), armB = bone('arm-right'), legA = bone('leg-left'), legB = bone('leg-right');
    const swap = (armA?.position.x ?? 0) > 0;
    this.armL = swap ? armB : armA; this.armR = swap ? armA : armB; this.legL = swap ? legB : legA; this.legR = swap ? legA : legB;
    this.rest = new Map();
    for (const b of [this.root, this.torso, this.head, this.armL, this.armR, this.legL, this.legR]) if (b) this.rest.set(b, { q: b.quaternion.clone(), p: b.position.clone() });
    // Recolour: skin and hair on the head, skin, top and trousers on the body.
    const v = VARIANTS[variant] || VARIANTS['character-male-a'];
    const o = look.outfit;
    const top = o === 'labcoat' ? '#f2f0ea' : look.outfitColor;
    const legs = o === 'suit' ? darker(look.outfitColor, 0.85) : o === 'overalls' ? look.outfitColor : o === 'dress' ? look.outfitColor : null;
    const bald = look.hair === 'none' || look.hair === 'mohawk';  // a mohawk is ours, so the variant's own hair goes
    const headSlots = [[v.skin, look.skin], [v.hair, bald ? look.skin : look.hairColor]];
    const bodySlots = [[v.skin, look.skin], [v.top, top]];
    if (legs && (v.legs[0] !== v.top[0] || v.legs[1] !== v.top[1])) bodySlots.push([v.legs, legs]);
    this.materials = [];
    model.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true; obj.receiveShadow = false; obj.frustumCulled = false;
      const slots = obj.name === 'head-mesh' ? headSlots : bodySlots;
      if (asset.means && obj.material?.map) { obj.material = tintMaterial(obj.material, slots, asset.means); this.materials.push(obj.material); }
    });
    // Clips: idle, walk and sit from the kit, cross-faded by the same blend the procedural character uses.
    this.mixer = new THREE.AnimationMixer(model);
    const clip = (n) => asset.animations.find((c) => c.name === n);
    this.actions = {};
    for (const n of ['idle', 'walk', 'sit']) { const c = clip(n); if (c) { const a = this.mixer.clipAction(c); a.play(); a.setEffectiveWeight(n === 'idle' ? 1 : 0); this.actions[n] = a; } }
    if (this.actions.walk) this.actions.walk.setEffectiveTimeScale(1.35);
    // A hat from our own parts and glasses from the kit, on the head bone. The hat group is sized to the model's head.
    if (this.head) {
      // The head mesh spans y 0..0.38 from this bone and is about 0.19 across from its centre, which is one "head unit" at 0.53.
      const hat = new THREE.Group(); hat.position.set(0, 0.19, -0.002); hat.scale.setScalar(MODEL_HEAD);
      buildHat(hat, look, accent, 1.22);
      buildModelHair(hat, look);
      buildFaceWear(hat, look, 0.0, -0.06);
      const chest = new THREE.Group();
      if (this.torso) { chest.position.set(0, 0.07, 0.012); chest.scale.setScalar(0.4); }
      buildExtras(hat, chest, look, accent);
      if (hat.children.length) { mergeColored(hat, CHAR_MAT); this.head.add(hat); this.hat = hat; }
      if (chest.children.length && this.torso) { mergeColored(chest, CHAR_MAT); this.torso.add(chest); this.chest = chest; }
      if (glasses) {
        const g = glasses.clone(true);
        g.traverse((obj) => { if (obj.isMesh) { obj.castShadow = false; obj.frustumCulled = false; } });
        g.position.set(0, 0.125, 0.085); this.head.add(g); this.glasses = g;
      }
    }
    // Props, scaled back to world size and held in the right hand.
    const ps = 1 / scale;
    this.paper = new THREE.Mesh(G.paper, mat('#fbf7ea')); this.paper.visible = false; this.paper.position.set(0, 0.11, 0.11); this.paper.rotation.x = 0.3; this.paper.scale.setScalar(ps);
    if (this.torso) this.torso.add(this.paper);
    this.mug = new THREE.Mesh(G.mug, mat(accent)); this.mug.visible = false; this.mug.position.set(0, -0.13, 0.02); this.mug.scale.setScalar(ps);
    this.phone = new THREE.Mesh(G.phone, mat('#1b1c22')); this.phone.visible = false; this.phone.position.set(0.01, -0.12, 0.03); this.phone.rotation.x = -0.6; this.phone.scale.setScalar(ps);
    if (this.armR) this.armR.add(this.mug, this.phone);
    this.headTop = 0.672 * scale;
    this.labelY = this.headTop + (HAT_CLEAR[look.hat] || 0) * MODEL_HEAD * scale;
  }
  seatedY(seatTop) { return seatTop - 0.03 * this.scale; }
  setAnim(name) { this.anim = name; }
  /** How this person moves (see manner in offices.js): their pace sets the walk clip's speed, and the rest shapes how they stand about. */
  setManner(m) { this.manner = m; if (m && this.actions.walk) this.actions.walk.setEffectiveTimeScale(1.35 * (m.pace / 2.6)); }
  update(dt, speed = 0) {
    this.t += dt;
    const t = this.t, b = this.blend;
    const want = wantFor(this.anim, speed, this.paper.visible);
    const k = Math.min(1, dt * 9);
    for (const n of ANIMS) b[n] += (want[n] - b[n]) * k;
    this.mug.visible = b.sip > 0.2 || b.pour > 0.2;
    this.phone.visible = b.phone > 0.2;
    const A = this.actions;
    const sit = Math.min(1, b.sit), walk = Math.min(1 - sit, b.walk);
    A.sit?.setEffectiveWeight(sit); A.walk?.setEffectiveWeight(walk); A.idle?.setEffectiveWeight(Math.max(0, 1 - sit - walk));
    // Back to the rest pose first: the mixer only writes the bones a playing clip has tracks for (the sit clip has no head
    // or torso track), and our turns below are relative, so without this they would pile up frame after frame.
    for (const [bone, r] of this.rest) { bone.quaternion.copy(r.q); bone.position.copy(r.p); }
    this.mixer.update(dt);
    // The kit's clips set the base pose; our poses turn the bones on top of it.
    const p = poseFor(b, t, dt, this);
    const lean = b.walk * 0.05 - b.stretch * 0.1 + b.phone * 0.05;
    if (this.root) {
      this.root.position.y += (Math.abs(Math.sin(t * 7)) * 0.045 * b.cheer + Math.sin(t * 2) * 0.002);
      this.root.rotateX(lean); this.root.rotateZ(Math.sin(t * 0.9) * 0.02 * b.listen);
    }
    const armX = 1 - walk;  // the walk clip swings the arms itself
    // Our arm layers assume a hanging arm; the clips start from a slightly spread one, so the outward turn is eased back a little.
    if (this.armL) { this.armL.rotateX(p.aL * armX + p.aL * walk * 0.2 * (1 - b.walk)); this.armL.rotateZ(p.zL * 0.9 + 0.1); }
    if (this.armR) { this.armR.rotateX(p.aR * armX + p.aR * walk * 0.2 * (1 - b.walk)); this.armR.rotateZ(p.zR * 0.9 - 0.1); this.armR.rotateY(b.pour * -0.6); }
    if (this.head) { this.head.rotateX(p.headX); this.head.rotateY(p.headY); this.head.rotateZ(p.headZ); }
    if (this.torso) this.torso.rotateY(b.talk * Math.sin(t * 2.1) * 0.08);
    const m = this.manner;
    if (m) {
      // Standing about, everyone has their own way of doing it: a lean, a slow shift of weight, and something to do with their arms.
      const still = Math.max(0, 1 - sit - walk - b.talk - b.sip - b.phone - b.cheer - b.pour - b.stretch - b.type - b.think - b.carry);
      if (this.root) { this.root.rotateZ((m.lean + Math.sin(t * m.shift) * 0.012) * (1 - sit)); this.root.position.x += Math.sin(t * m.shift) * 0.006 * still; }
      if (m.stance === 1 && this.armR) { this.armR.rotateZ(0.5 * still); this.armR.rotateX(-0.35 * still); }
      if (m.stance === 2) { if (this.armL) this.armL.rotateX(-0.9 * still); if (this.armR) this.armR.rotateX(-0.9 * still); }
      if (m.stance === 3) { if (this.armL) this.armL.rotateX(0.45 * still); if (this.armR) this.armR.rotateX(0.45 * still); }
      if (this.head) this.head.rotateY(Math.sin(t * 0.37 + m.shift * 9) * 0.22 * still);
      if (m.sway && this.torso) this.torso.rotateY(Math.sin(t * 7.6) * 0.05 * m.sway * walk);
    }
  }
  dispose() {
    for (const m of this.materials) m.dispose();
    if (this.hat) disposeMerged(this.hat);
    if (this.chest) disposeMerged(this.chest);
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model);
    // Each person's cloned skeleton has its own bone texture on the GPU, and it stays there until told otherwise.
    this.model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
    this.group.removeFromParent();
  }
}

/**
 * Loads the model character for a look. Resolves to a ready ModelCharacter, or rejects (the caller keeps its procedural one).
 * Everything it needs is cached after the first call, so a floor's crew costs one fetch per distinct variant.
 */
export async function loadModelCharacter(look, opts = {}) {
  const variant = variantFor(look);
  const [asset, utils, glasses] = await Promise.all([
    loadCharacterAsset(variant), skeletonUtils(),
    look.glasses === 'round' ? accessory('aid-glasses') : look.glasses === 'shades' ? accessory('aid-sunglasses') : null,
  ]);
  return new ModelCharacter(asset, utils, look, { ...opts, variant, glasses });
}

/** A turntable preview for the character builder, with its own small renderer. The model replaces the stand-in when it lands. */
export function createPreview(canvas, look, accent) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { canvas.hidden = true; return { update() {}, dispose() {} }; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width || 200, rect.height || 240, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#cfe0f5', '#b9a88f', 1.6));
  const sun = new THREE.DirectionalLight('#ffe4c4', 2.8); sun.position.set(2.5, 4, 3); sun.castShadow = true; sun.shadow.mapSize.set(512, 512);
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 3, bottom: -1, near: 1, far: 12 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0005; scene.add(sun);
  const fill = new THREE.DirectionalLight('#dbe8ff', 0.6); fill.position.set(-3, 2, -2); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 28), new THREE.ShadowMaterial({ opacity: 0.22 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const cam = new THREE.PerspectiveCamera(26, (rect.width || 200) / (rect.height || 240), 0.1, 30);
  cam.position.set(0, 1.65, 6.3); cam.lookAt(0, 1.12, 0);  // room above the head for the tallest hat
  let ch = new Character(look, { accent }); scene.add(ch.group);
  let gen = 0, raf, dead = false, last = performance.now();
  // The person on screen stays until the next one is ready, so changing an option never flashes a stand-in once the model is cached.
  const swapIn = (next, acc) => {
    const my = ++gen;
    return loadModelCharacter(next, { accent: acc, scale: 2.5 }).then((mc) => {  // the same height in the frame as the stand-in
      if (dead || my !== gen) { mc.dispose(); return; }
      const y = ch.group.rotation.y;
      ch.dispose(); ch = mc; ch.group.rotation.y = y; scene.add(ch.group);
    }).catch(() => {
      if (dead || my !== gen) return;
      ch.dispose(); ch = new Character(next, { accent: acc }); scene.add(ch.group);
    });
  };
  swapIn(look, accent);
  let shown = '';
  const loop = (now) => {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    // The canvas may only get its real size once it is on the page, and a phone can turn. Keep the picture in proportion either way.
    const size = `${canvas.clientWidth}x${canvas.clientHeight}`;
    if (size !== shown && canvas.clientWidth && canvas.clientHeight) { shown = size; renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); cam.aspect = canvas.clientWidth / canvas.clientHeight; cam.updateProjectionMatrix(); }
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    // People walk with their backs to the room's camera, so here they turn round to face you.
    ch.group.rotation.y = Math.PI + Math.sin(now / 1400) * 0.55;
    ch.update(dt);
    renderer.render(scene, cam);
  };
  raf = requestAnimationFrame(loop);
  return {
    update(next, acc = accent) { swapIn({ ...next }, acc); },
    dispose() { dead = true; gen++; cancelAnimationFrame(raf); floor.geometry.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); },
  };
}
