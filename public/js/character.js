// The little people. Two kinds share one interface (group, setAnim, update, paper/mug/phone, dispose, seatedY, labelY):
// - Character: built from a few low-poly shapes, every rigid part baked into one vertex-coloured mesh. It appears at once and
//   stays if a model never arrives.
// - ModelCharacter: one of Quaternius's CC0 people (see /models/NOTICE.txt) on a 22-bone rig, with the walk and idle clips
//   shared and every pose solved live on top (hips on the seat, hands placed by IK), so every agent state reads the same on both.
import * as THREE from '../vendor/three/three.module.min.js';
import { mergeColored, disposeMerged } from './batch.js';
import { person as loadPersonAsset, personClips, skeletonUtils } from './models.js';

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
/** Glasses, in head units, for the packed people (eyes about 0.47 of a head out from the middle and a little low). */
function buildGlasses(head, look) {
  const x = 0.17, y = -0.03, z = 0.33;
  if (look.glasses === 'round') { for (const s of [-1, 1]) { const r = new THREE.Mesh(G.ring, mat('#22202a')); r.position.set(s * x, y, z); r.scale.setScalar(1.15); head.add(r); } head.add(part(G.box, '#22202a', 0, y, z, 0.09, 0.014, 0.014)); }
  if (look.glasses === 'shades') { for (const s of [-1, 1]) head.add(part(G.box, '#101114', s * x, y, z, 0.2, 0.11, 0.02)); head.add(part(G.box, '#101114', 0, y + 0.02, z, 0.14, 0.02, 0.014)); }
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

/**
 * The blend state every character keeps: which named poses are active, eased so nothing ever snaps. `inChair` is set by
 * whoever seats the person: someone who talks, cheers or takes a call from their chair keeps sitting while they do it.
 */
function wantFor(anim, speed, carrying, inChair) {
  const a = anim;
  const seated = speed <= 0.01 && (inChair || a === 'sit' || a === 'type' || a === 'think' || a === 'stretch');
  return {
    walk: speed > 0.01 ? 1 : 0, sit: seated ? 1 : 0, type: a === 'type' ? 1 : 0, talk: a === 'talk' ? 1 : 0,
    carry: carrying ? 1 : 0, cheer: a === 'cheer' ? 1 : 0, think: a === 'think' ? 1 : 0, listen: a === 'listen' ? 1 : 0,
    stretch: a === 'stretch' ? 1 : 0, sip: a === 'sip' ? 1 : 0, phone: a === 'phone' ? 1 : 0, pour: a === 'pour' ? 1 : 0,
  };
}
/**
 * Typing the way people do it: bursts of quick taps with the hands taking turns, then a pause to read the screen. Each
 * person keeps their own pace and phase, so a row of desks never moves in step. `l` and `r` are how far each hand is
 * lifted (0 resting on the keys, 1 at the top of a tap), `on` how much typing is going on right now (0 in a pause).
 */
function typing(self, dt, w) {
  let s = self.typist;
  if (!s) s = self.typist = { rate: 2.2 + Math.random() * 0.7, ph: Math.random() * 6.3, burst: 1 + Math.random() * 4, gap: 0, on: 0, glance: 0 };
  if (w < 0.01) { s.on = 0; return { l: 0, r: 0, on: 0, look: 0, glance: 0, nod: 0 }; }
  if (s.gap > 0) { s.gap -= dt; if (s.gap <= 0) s.burst = 2.5 + Math.random() * 5; }
  else if ((s.burst -= dt) <= 0) { s.gap = 0.7 + Math.random() * 1.8; s.glance = (Math.random() - 0.5) * 0.5; }
  s.on += ((s.gap > 0 ? 0 : 1) - s.on) * Math.min(1, dt * 7);  // hands settle and pick up again over about 0.2s
  // About 2-3 taps a second per hand; the pace drifts a little so it never reads as a loop.
  s.ph += dt * s.rate * Math.PI * 2 * (0.85 + 0.3 * Math.sin(s.ph * 0.13));
  const lift = (x) => { const c = Math.sin(x); return c > 0 ? c * c : 0; };
  return { l: lift(s.ph) * s.on, r: lift(s.ph + Math.PI) * s.on, on: s.on, look: 1 - s.on, glance: s.glance * (1 - s.on), nod: Math.sin(s.ph) * s.on };
}
/**
 * Moves every pose weight toward what is wanted on a critically damped spring: it sets off from standstill, never
 * overshoots and is most of the way there in 0.2s, so a change of pose never jumps on its first frame.
 */
function ease(self, want, dt) {
  const b = self.blend, v = (self.blendV ||= Object.fromEntries(ANIMS.map((n) => [n, 0])));
  const w = 14, h = Math.min(dt, 0.1), e = Math.exp(-w * h);
  for (const n of ANIMS) {
    const x0 = b[n] - want[n], c = v[n] + w * x0;
    b[n] = want[n] + (x0 + c * h) * e; v[n] = (v[n] - w * c * h) * e;
    if (b[n] < 0 || b[n] > 1) { b[n] = Math.min(1, Math.max(0, b[n])); v[n] = 0; }
  }
}
/** Arm angles (x: forward swing, z: outward) and head turns for the current blend. Shared by both kinds of character. */
function poseFor(b, t, dt, self) {
  const swing = Math.sin(t * 9.5);
  const ty = typing(self, dt, b.type); self.ty = ty;
  let aL = -swing * 0.58 * b.walk, aR = swing * 0.58 * b.walk;
  let zL = -0.08, zR = 0.08;
  aL += b.sit * (-0.35) + b.type * (-0.55 - ty.l * 0.07);
  aR += b.sit * (-0.35) + b.type * (-0.55 - ty.r * 0.07);
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
  // A typist looks down at the keys with a small nod in time, and up at the screen when they stop to read.
  const headX = b.type * (0.12 + ty.nod * 0.02 - ty.look * 0.12) + Math.sin(t * 0.7) * 0.03 - b.think * 0.1 + b.talk * Math.sin(t * 3) * 0.08
    + b.listen * nod * 0.12 - b.stretch * 0.3 + b.phone * 0.38 + b.pour * 0.22 - b.sip * self.sipK * 0.18;
  const headY = Math.sin(t * 0.43) * 0.22 * Math.max(0, 1 - b.type - b.listen * 0.8) + b.type * ty.glance + b.talk * Math.sin(t * 2.1) * 0.15;
  const headZ = b.think * 0.18 + Math.sin(t * 0.31) * 0.025 + b.listen * Math.sin(t * 0.5) * 0.04;
  return { aL, aR, zL, zR, headX, headY, headZ, swing };
}

/**
 * Stands in for a person in the 3D building until their model has loaded, at no cost: nothing to build, draw or animate. A floor there
 * stays hidden until every model is in, so nobody ever sees it; the procedural person is for a floor page, which shows at once.
 */
export class PendingCharacter {
  constructor(look, { scale = 1 } = {}) {
    this.group = new THREE.Group(); this.look = look; this.scale = scale; this.isModel = false;
    this.anim = 'stand'; this.blend = Object.fromEntries(ANIMS.map((n) => [n, 0]));
    this.paper = { visible: false }; this.mug = { visible: false }; this.phone = { visible: false };
    this.headTop = HEAD_TOP * scale; this.labelY = HEAD_TOP * scale;
  }
  seatedY(seatTop) { return seatTop - 0.365 * this.scale; }
  setAnim(name) { this.anim = name; }
  setManner(m) { this.manner = m; }
  update() {}
  dispose() { this.group.removeFromParent(); }
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
    const want = wantFor(this.anim, speed, this.paper.visible, this.inChair);
    ease(this, want, dt);
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

// ---------- the people ----------
// Quaternius's Ultimate Modular Men and Women (see /models/NOTICE.txt): one skinned mesh and one material per person. The vertices name
// their role (skin, hair, top...) and the material holds the palette, so everyone shares one shader. Poses are the shared walk and idle
// clips with the rest solved live: hips onto the seat, feet on the floor, and every hand placed with two-bone IK.

/** World height per model unit: the rig stands 1.86 tall, so a person is about 2.6 room units, right beside a 1.06 desk and a 0.5 seat. */
export const MODEL_SCALE = 1.38;
const BODIES = /^(male|female)-[a-f]$/;
/** Outfits map to the people dressed closest; the hair style then picks a side, and the rest of the look picks within it. */
const BY_OUTFIT = {
  suit: ['male-d', 'female-d'], shirt: ['male-a', 'female-a'], hoodie: ['male-b', 'female-f'], tee: ['male-a', 'female-a'],
  dress: ['female-b', 'female-e'], labcoat: ['male-d', 'female-d'], overalls: ['male-c', 'female-c'],
};
const FEMALE_HAIR = ['long', 'bun', 'pigtails'], MALE_HAIR = ['short', 'side', 'mohawk'];
const hashLook = (look) => { let h = 7; for (const ch of JSON.stringify([look.skin, look.hairColor, look.outfitColor, look.glasses, look.hat])) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
export function variantFor(look) {
  if (look.body && BODIES.test(look.body)) return look.body;
  const cands = BY_OUTFIT[look.outfit] || BY_OUTFIT.tee;
  const female = cands.map((c) => c.includes('female'));
  let i = hashLook(look) % cands.length;
  if (FEMALE_HAIR.includes(look.hair) && female.includes(true)) i = female.indexOf(true);
  else if (MALE_HAIR.includes(look.hair) && female.includes(false)) i = female.indexOf(false);
  return cands[i];
}

const TROUSERS = ['#2a3448', '#3a3d45', '#27262e', '#4a4438', '#2f3d37', '#3d3346'], SHOES = ['#241f1c', '#3b2a20', '#1d2230', '#55432f', '#2c2c32', '#6a6459'];
/** The colour of every role for this person, as linear RGB, in the slot order of the packed model. */
function personColours(asset, look, accent) {
  const h = hashLook(look), o = look.outfit, c = (x) => new THREE.Color(x);
  const skin = c(look.skin), hairless = look.hair === 'none';
  const top = c(o === 'labcoat' ? '#f2efe8' : look.outfitColor);
  const legs = c(o === 'suit' ? darker(look.outfitColor, 0.85) : o === 'overalls' || o === 'dress' ? look.outfitColor : o === 'labcoat' ? '#3a3f4c' : TROUSERS[(h >> 3) % TROUSERS.length]);
  const own = (role, fallback) => c(asset.extras.palette[role]?.hex || fallback);
  const roles = {
    skin, skinDark: skin.clone().multiplyScalar(0.84), hair: c(look.hairColor), brow: hairless ? skin.clone().multiplyScalar(0.5) : c(look.hairColor).multiplyScalar(0.62),
    eye: c('#17120f'), top, legs, shirt: c(o === 'hoodie' ? '#d8d4ca' : '#efeadf'), accent: c(accent), shoes: c(SHOES[(h >> 7) % SHOES.length]), sole: c('#d9d5ca'),
    dark: own('dark', '#2b2b30'), fixed: own('fixed', '#8a8a86'),
  };
  return asset.extras.roles.map((r) => roles[r] || c('#808080'));
}
const ROLE_COUNT = 13;
const PERSON_MAT = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.74, metalness: 0 });
/** A copy of the one person material holding this person's colours. Every copy compiles to the same program. */
function dressed(colours) {
  const m = PERSON_MAT.clone();
  m.userData.roles = { value: colours };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRoles = m.userData.roles;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 _slot; uniform vec3 uRoles[${ROLE_COUNT}]; varying vec3 vRole;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRole = uRoles[int(_slot.x)];');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRole;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vRole;');
  };
  m.customProgramCacheKey = () => 'person-roles';
  return m;
}
/** The same geometry with the hair left out, for the bald (and for a mohawk, which is ours). Built once per body. */
const baldCache = new WeakMap();
function baldGeometry(asset) {
  if (baldCache.has(asset)) return baldCache.get(asset);
  const src = asset.mesh.geometry, hair = asset.extras.roles.indexOf('hair'), idx = src.index.array, out = [];
  for (let i = 0; i < idx.length; i += 3) if (asset.slots[idx[i]] !== hair) out.push(idx[i], idx[i + 1], idx[i + 2]);
  const g = new THREE.BufferGeometry();
  for (const k of Object.keys(src.attributes)) g.setAttribute(k, src.attributes[k]);
  g.setIndex(out);
  baldCache.set(asset, g);
  return g;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _pole = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const worldQ = (o, out) => out.setFromRotationMatrix(_m.extractRotation(o.matrixWorld));
const worldP = (o, out) => out.setFromMatrixPosition(o.matrixWorld);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth01 = (x) => { const c = clamp01(x); return c * c * (3 - 2 * c); };
const PHONE_TILT = new THREE.Quaternion().setFromAxisAngle(AX, -0.6);
const HIP_Y = 0.93, SEAT_CLEAR = 0.1;      // model units: the hip joint standing, and how far it sits above a cushion
const PERSON_TOP = 1.87;
// A keyboard on a desk, from the seat: how far in front (room units) and how high. The manager's and boss's desk is deeper and taller.
const KEYS_Z = 0.59, KEYS_Z_BIG = 0.52, KEYS_Y = 1.1, KEYS_Y_BIG = 1.24;
// Where each hand goes in the model's own space, per hand side (+1 = model +x, the person's left).
const HEAD_C = new THREE.Vector3(0, 1.71, 0.05), HEAD_R = 0.125, CHEST_C = new THREE.Vector3(0, 1.3, 0.04);

/** Turns `bone` so the point `tip` (in its own frame) heads for the world point `target`, by weight `w`. Nothing assumes which way the bone's axes lie. */
function aim(bone, tip, target, w) {
  worldP(bone, _a); worldQ(bone, _q0);
  _b.copy(tip).applyQuaternion(_q0).normalize();
  _c.subVectors(target, _a).normalize();
  _q1.setFromUnitVectors(_b, _c).multiply(_q0);
  worldQ(bone.parent, _q2).invert();
  _q2.multiply(_q1);
  if (w >= 0.999) bone.quaternion.copy(_q2); else bone.quaternion.slerp(_q2, w);
  bone.updateWorldMatrix(false, true);
}

export class ModelCharacter {
  constructor(asset, utils, clips, look, { accent = '#d9774a', scale = MODEL_SCALE, variant } = {}) {
    this.group = new THREE.Group();
    this.look = look; this.accent = accent; this.scale = scale; this.variant = variant;
    this.t = Math.random() * 10;
    this.anim = 'stand'; this.blend = Object.fromEntries(ANIMS.map((n) => [n, 0]));
    this.isModel = true; this.far = !!asset.far;
    const model = utils.clone(asset.scene);
    this.model = model;
    this.group.add(model);
    this.group.scale.setScalar(scale);
    let mesh = null; model.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
    this.mesh = mesh;
    this.material = dressed(personColours(asset, look, accent));
    mesh.material = this.material;
    if (look.hair === 'none' || look.hair === 'mohawk') mesh.geometry = baldGeometry(asset);
    mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false;
    const bone = (n) => model.getObjectByName(n);
    const B = this.bones = {
      root: bone('Root'), body: bone('Body'), abdomen: bone('Abdomen'), torso: bone('Torso'), chest: bone('Chest'), neck: bone('Neck'), head: bone('Head'),
    };
    this.torso = B.chest; this.head = B.head;
    // Each limb remembers its bone lengths in model units, and the joint after it even where the rig has no such child (the foot hangs off the root).
    this.group.updateMatrixWorld(true);  // the group's scale is part of what is measured below
    const bindW = (b) => worldP(b, new THREE.Vector3());
    const limb = (upper, lower, end) => {
      const q = worldQ(upper, new THREE.Quaternion()), qL = worldQ(lower, new THREE.Quaternion());
      const a = bindW(upper), b = bindW(lower), c = bindW(end);
      return {
        upper, lower, end,
        upperTip: b.clone().sub(a).applyQuaternion(q.clone().invert()), lowerTip: c.clone().sub(b).applyQuaternion(qL.clone().invert()),
        l1: a.distanceTo(b) / scale, l2: b.distanceTo(c) / scale,
      };
    };
    this.limbs = { L: limb(bone('UpperArmL'), bone('LowerArmL'), bone('WristL')), R: limb(bone('UpperArmR'), bone('LowerArmR'), bone('WristR')),
      legL: limb(bone('UpperLegL'), bone('LowerLegL'), bone('FootL')), legR: limb(bone('UpperLegR'), bone('LowerLegR'), bone('FootR')) };
    // What each wrist and foot looks like at rest, world-relative, so a hand can be laid flat and a foot stood flat whatever the arm did.
    this.handRest = { L: worldQ(this.limbs.L.end, new THREE.Quaternion()), R: worldQ(this.limbs.R.end, new THREE.Quaternion()) };
    this.footRest = { legL: this.limbs.legL.end.quaternion.clone(), legR: this.limbs.legR.end.quaternion.clone() };
    this.modelInv = new THREE.Quaternion();
    // Hat, glasses and the rest of what they wear, sized for this head and held in the model's own axes.
    const inModelAxes = (b, at, s) => {
      const g = new THREE.Group(), q = worldQ(b, new THREE.Quaternion()).invert();
      g.quaternion.copy(q); g.position.copy(at).sub(bindW(b).divideScalar(scale)).applyQuaternion(q); g.scale.setScalar(s);
      return g;
    };
    const hat = inModelAxes(B.head, HEAD_C, HEAD_R / 0.36);
    buildHat(hat, look, accent, 1.06);
    buildModelHair(hat, look);
    buildGlasses(hat, look);
    buildFaceWear(hat, look, 0.0, 0.0);
    const chest = inModelAxes(B.chest, CHEST_C, 0.4);
    buildExtras(hat, chest, look, accent);
    if (hat.children.length) { mergeColored(hat, CHAR_MAT); B.head.add(hat); this.hat = hat; }
    if (chest.children.length) { mergeColored(chest, CHAR_MAT); B.chest.add(chest); this.chestWear = chest; }
    // Props, in room units and held in the right hand; a paper carried against the chest.
    const ps = 1 / scale, wrist = this.limbs.R.end;
    const hand = new THREE.Group(), hq = worldQ(wrist, new THREE.Quaternion()).invert();
    hand.quaternion.copy(hq); this.handGroup = hand; wrist.add(hand);
    const front = inModelAxes(B.chest, new THREE.Vector3(0, 1.18, 0.2), 1);
    this.paper = new THREE.Mesh(G.paper, mat('#fbf7ea')); this.paper.visible = false; this.paper.rotation.x = 0.3; this.paper.scale.setScalar(ps); front.add(this.paper); B.chest.add(front);
    this.mug = new THREE.Mesh(G.mug, mat(accent)); this.mug.visible = false; this.mug.position.set(0, -0.04, 0.05); this.mug.scale.setScalar(ps);
    this.phone = new THREE.Mesh(G.phone, mat('#1b1c22')); this.phone.visible = false; this.phone.position.set(0, -0.02, 0.06); this.phone.scale.setScalar(ps);
    hand.add(this.mug, this.phone);
    // Clips: the idle and the walk, cross-faded by the same blend the stand-in uses.
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    // What the clips last wrote to each bone. The mixer only writes a bone whose value changed, so without this the turns made below would pile up.
    this.pose = [];
    model.traverse((o) => { if (o.isBone) this.pose.push({ b: o, q: o.quaternion.clone(), p: o.position.clone() }); });
    const ph = Math.random();
    for (const [key, name] of [['idle', 'Idle_Neutral'], ['walk', 'Walk']]) {
      const clip = clips.find((c) => c.name === name); if (!clip) continue;
      const a = this.mixer.clipAction(clip); a.play(); a.time = ph * clip.duration; a.setEffectiveWeight(key === 'idle' ? 1 : 0); this.actions[key] = a;
    }
    this.headTop = PERSON_TOP * scale;
    this.labelY = this.headTop + (HAT_CLEAR[look.hat] || 0) * HEAD_R / 0.36 * scale;
    // A head and shoulders for the ID photos (portrait.js), as a share of the person's height.
    this.portraitView = 0.3;
  }
  /** Group height that puts the hips on a seat whose cushion is `seatTop` high. The legs reach down to the floor on their own. */
  seatedY(seatTop) { return seatTop + (SEAT_CLEAR - HIP_Y) * this.scale; }
  setAnim(name) { this.anim = name; }
  /** How this person moves (see manner in offices.js): their pace sets the walk's speed, and the rest shapes how they stand about. */
  setManner(m) { this.manner = m; if (m && this.actions.walk) this.actions.walk.setEffectiveTimeScale(1.05 * (m.pace / 2.6)); }
  /** Turns a bone about an axis given in the model's own space. */
  spin(bone, axis, angle) {
    if (!bone || Math.abs(angle) < 1e-4) return;
    worldQ(this.model, _q0); _e.copy(axis).applyQuaternion(_q0);
    worldQ(bone, _q1); _q2.setFromAxisAngle(_e, angle).multiply(_q1);
    worldQ(bone.parent, _q0).invert();
    bone.quaternion.copy(_q0.multiply(_q2));
    bone.updateWorldMatrix(false, true);
  }
  /** Two-bone IK: lays the limb so its end reaches `target` (model space), the middle joint bending toward `pole` (model space direction). */
  solve(limb, tx, ty, tz, px, py, pz, w) {
    const { upper, lower } = limb, S = _a, T = _d;
    worldP(upper, S);
    T.set(tx, ty, tz).applyMatrix4(this.model.matrixWorld);
    const s = this.scale, l1 = limb.l1 * s, l2 = limb.l2 * s;
    _b.subVectors(T, S);
    const reach = Math.min(_b.length(), (l1 + l2) * 0.996);
    if (reach < 1e-4) return;
    _b.normalize();
    T.copy(S).addScaledVector(_b, reach);
    const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    _pole.set(px, py, pz).applyQuaternion(worldQ(this.model, _q0));
    _pole.addScaledVector(_b, -_pole.dot(_b)).normalize();
    _c.copy(S).addScaledVector(_b, a).addScaledVector(_pole, h);
    const E = _e.copy(_c), T2 = _d.copy(T);  // the aim below reuses the scratch vectors
    const elbow = E.clone(), wrist = T2.clone();
    aim(upper, limb.upperTip, elbow, w);
    aim(lower, limb.lowerTip, wrist, w);
  }
  /** Lays a hand flat, or leaves it where the forearm put it (w 0). `fx, fz` is the way the fingers point, in model space; the palm faces down. */
  layHand(limb, rest, fx, fy, fz, w) {
    if (w <= 0.001) return;
    const wrist = limb.end;
    worldQ(this.model, _q0);
    _a.set(fx, fy, fz).normalize().applyQuaternion(_q0);
    _b.set(limb === this.limbs.L ? 1 : -1, 0, 0);  // the hand pointed out to the side in the bind pose
    _c.set(0, -1, 0).applyQuaternion(_q0);          // the palm, down
    _d.crossVectors(_a, _c).normalize();
    _c.crossVectors(_d, _a).normalize();
    // Bind frame: x along the hand, -y through the palm.
    _m.makeBasis(_b.set(limb === this.limbs.L ? 1 : -1, 0, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3().crossVectors(_b, new THREE.Vector3(0, -1, 0)));
    const m2 = new THREE.Matrix4().makeBasis(_a, _c, new THREE.Vector3().crossVectors(_a, _c));
    _q1.setFromRotationMatrix(m2.multiply(_m.invert()));
    _q1.multiply(rest);
    worldQ(wrist.parent, _q2).invert();
    wrist.quaternion.slerp(_q2.multiply(_q1), w);
    wrist.updateWorldMatrix(false, true);
  }
  update(dt, speed = 0) {
    this.t += dt;
    const t = this.t, b = this.blend, s = this.scale;
    const want = wantFor(this.anim, speed, this.paper.visible, this.inChair);
    ease(this, want, dt);
    this.mug.visible = b.sip > 0.2 || b.pour > 0.2;
    this.phone.visible = b.phone > 0.2;
    const A = this.actions;
    const sit = Math.min(1, b.sit), walk = Math.min(1 - sit, b.walk);
    A.walk?.setEffectiveWeight(walk); A.idle?.setEffectiveWeight(Math.max(0, 1 - walk));
    for (const r of this.pose) { r.b.quaternion.copy(r.q); r.b.position.copy(r.p); }
    this.mixer.update(dt);
    for (const r of this.pose) { r.q.copy(r.b.quaternion); r.p.copy(r.b.position); }
    const p = poseFor(b, t, dt, this), ty = this.ty, m = this.manner;
    // Everything below is measured against the rig as the clips left it this frame.
    this.group.updateWorldMatrix(true, true);
    const B = this.bones;
    const still = m ? Math.max(0, 1 - sit - walk - b.talk - b.sip - b.phone - b.cheer - b.pour - b.stretch - b.type - b.think - b.carry) : 0;
    // The spine: a little forward over the keys, a little of everyone's own way of standing, and a breath.
    const ky = (this.typeK = clamp01((this.typeK ?? 0) + Math.sign((this.anim === 'type' ? 1 : 0) - (this.typeK ?? 0)) * dt * 2.8));
    if (b.cheer > 0.001) B.body.position.y += Math.abs(Math.sin(t * 7)) * 0.05 * b.cheer;
    this.spin(B.abdomen, AX, 0.05 * sit + 0.1 * smooth01(ky) + 0.06 * b.walk - b.stretch * 0.1 + b.phone * 0.05);
    this.spin(B.chest, AX, Math.sin(t * 2) * 0.012 + 0.03 * smooth01(ky));
    if (m) { this.spin(B.abdomen, AZ, (m.lean + Math.sin(t * m.shift) * 0.012) * (1 - sit)); this.spin(B.torso, AY, Math.sin(t * 7.6) * 0.05 * m.sway * walk); }
    this.spin(B.chest, AY, b.talk * Math.sin(t * 2.1) * 0.08);
    // The head keeps its own little life going, turned in the model's axes.
    this.spin(B.head, AX, p.headX); this.spin(B.head, AY, p.headY + (m ? Math.sin(t * 0.37 + m.shift * 9) * 0.22 * still : 0)); this.spin(B.head, AZ, p.headZ);
    // Seated: hips stay where the seat holds them (the group has been lowered), knees forward, shins and feet to the floor.
    if (sit > 0.001) this.seatLegs(sit);
    this.poseHands(b, t, ty, still, m);
    if (this.mug.visible || this.phone.visible) this.holdProps();
  }
  seatLegs(w) {
    const groupY = this.group.position.y, s = this.scale;
    const floorY = -groupY / s;
    for (const [limb, side] of [[this.limbs.legL, 1], [this.limbs.legR, -1]]) {
      worldP(limb.upper, _a); _b.copy(_a); this.model.worldToLocal(_b);
      const hx = _b.x, hy = _b.y, hz = _b.z;
      const kneeX = hx + side * 0.012, kneeY = hy - 0.02, kneeZ = hz + limb.l1 * 0.98;
      const ankleY = floorY + 0.045, ankleZ = kneeZ + 0.02;
      // A pole out in front keeps the knee bending the right way.
      this.solve(limb, kneeX, ankleY, ankleZ, side * 0.1, 0.25, 1, w);
      const foot = limb.end;
      // The foot follows the ankle and stays flat on the floor.
      _a.set(kneeX, ankleY, ankleZ).applyMatrix4(this.model.matrixWorld); foot.parent.worldToLocal(_a);
      foot.position.lerp(_a, w);
      const rest = limb === this.limbs.legL ? this.footRest.legL : this.footRest.legR;
      foot.quaternion.slerp(rest, w);
      foot.updateWorldMatrix(false, true);
    }
  }
  /** Where the hands go: on the keys at the desk, at the mouth with a mug, and so on, each hand blended like the rest of the pose. */
  poseHands(b, t, ty, still, m) {
    const s = this.scale, sit = Math.min(1, b.sit);
    let lx = 0, ly = 0, lz = 0, lw = 0, rx = 0, ry = 0, rz = 0, rw = 0;
    const toL = (w, x, y, z) => { if (w <= 0) return; lx += w * (x - lx); ly += w * (y - ly); lz += w * (z - lz); lw = 1 - (1 - lw) * (1 - w); };
    const toR = (w, x, y, z) => { if (w <= 0) return; rx += w * (x - rx); ry += w * (y - ry); rz += w * (z - rz); rw = 1 - (1 - rw) * (1 - w); };
    // Hands on the thighs, in a chair.
    toL(sit, 0.13, 1.0, 0.26); toR(sit, -0.13, 1.0, 0.26);
    // Standing about: everyone has their own way of doing it.
    if (m && still > 0.001) {
      if (m.stance === 1) toR(still, -0.2, 0.98, 0.0);
      if (m.stance === 2) { toL(still, 0.05, 1.2, 0.18); toR(still, -0.07, 1.16, 0.17); }
      if (m.stance === 3) { toL(still, 0.18, 0.86, 0.02); toR(still, -0.18, 0.86, 0.02); }
    }
    toL(b.listen, 0.07, 0.94, 0.19); toR(b.listen, -0.07, 0.94, 0.19);
    toL(b.talk, 0.15, 1.0 + Math.sin(t * 3.3) * 0.02, 0.24); toR(b.talk, -0.16 + Math.sin(t * 2.3) * 0.03, 1.22 + Math.sin(t * 5) * 0.05, 0.28 + Math.sin(t * 3.7) * 0.03);
    toL(b.carry, 0.14, 1.12, 0.3); toR(b.carry, -0.14, 1.12, 0.3);
    toL(b.cheer, 0.26, 1.95 + Math.sin(t * 11) * 0.03, 0.1); toR(b.cheer, -0.26, 1.95 - Math.sin(t * 11) * 0.03, 0.1);
    toL(b.think, 0.1, 1.1, 0.2); toR(b.think, -0.03, 1.6, 0.25);
    const st = clamp01(Math.sin(t * 1.1) * 0.5 + 0.5);
    toL(b.stretch, 0.25, 2.0 + 0.08 * st, 0); toR(b.stretch, -0.25, 2.0 + 0.08 * st, 0);
    toL(b.sip, 0.15, 1.0, 0.2); toR(b.sip, -0.08, 1.1 + 0.5 * (this.sipK ?? 0), 0.2);
    toL(b.phone, 0.15, 1.0, 0.2); toR(b.phone, -0.19, 1.66, 0.08);
    toL(b.pour, 0.15, 1.0, 0.2); toR(b.pour, -0.2, 1.12, 0.33);
    // Typing is on top of everything else: wrists just short of the keyboard, the fingers lying on it.
    const k = this.typeK ?? 0;
    if (k > 0.001) {
      const big = !!this.bigDesk, kz = (big ? KEYS_Z_BIG : KEYS_Z) / s, ky = ((big ? KEYS_Y_BIG : KEYS_Y) - this.group.position.y) / s;
      const up = smooth01(k / 0.75);
      toL(up, 0.11, ky + 0.02 + (ty?.l ?? 0) * 0.018, kz - 0.17 + (ty?.l ?? 0) * 0.006);
      toR(up, -0.11, ky + 0.02 + (ty?.r ?? 0) * 0.018, kz - 0.17 + (ty?.r ?? 0) * 0.006);
    }
    // Elbows out and a little down, so an arm never folds through the body.
    if (lw > 0.001) this.solve(this.limbs.L, lx / lw, ly / lw, lz / lw, 0.9, -0.55, -0.5, lw);
    if (rw > 0.001) this.solve(this.limbs.R, rx / rw, ry / rw, rz / rw, -0.9, -0.55, -0.5, rw);
    if (k > 0.001) {
      const w = smooth01((k - 0.25) / 0.6);
      this.layHand(this.limbs.L, this.handRest.L, -0.15, -0.12, 1, w);
      this.layHand(this.limbs.R, this.handRest.R, 0.15, -0.12, 1, w);
    }
  }
  /** A mug or phone stays upright in the hand whichever way the arm is turned. */
  holdProps() {
    worldQ(this.handGroup, _q0).invert();
    worldQ(this.model, _q1);
    this.mug.quaternion.copy(_q0).multiply(_q1);
    this.phone.quaternion.copy(_q0).multiply(_q1).multiply(PHONE_TILT);
  }
  dispose() {
    this.material.dispose();
    if (this.hat) disposeMerged(this.hat);
    if (this.chestWear) disposeMerged(this.chestWear);
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model);
    // Each person's cloned skeleton has its own bone texture on the GPU, and it stays there until told otherwise.
    this.model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
    this.group.removeFromParent();
  }
}

/**
 * Loads the model character for a look. Resolves to a ready ModelCharacter, or rejects (the caller keeps its procedural one).
 * Everything it needs is cached after the first call, so a floor's crew costs one fetch per distinct body.
 */
export async function loadModelCharacter(look, opts = {}) {
  const variant = variantFor(look);
  const [asset, utils, clips] = await Promise.all([loadPersonAsset(variant, { far: !!opts.far }), skeletonUtils(), personClips()]);
  return new ModelCharacter(asset, utils, clips, look, { ...opts, variant });
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
    return loadModelCharacter(next, { accent: acc, scale: 0.91 }).then((mc) => {  // the same height in the frame as the stand-in
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
