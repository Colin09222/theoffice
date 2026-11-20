// buddehbot, the mailroom robot (round 2, r2-j50; docs/redesign/OFFICE-ANSWERS-2.md, Q21 and section 3 "Look"). A small boxy robot on two wheels,
// the only non-bean in the building: about 0.8 of a bean's height, under 1,500 triangles, an Ink body with Slate panels, a flat head with one
// round eye light, and a Tower Red rubber stamp held in a clamp hand. The eye shows its state: Amber = busy, Teal = awake and free, off = asleep
// or away. A name plate on its chest reads "buddehbot" (the owner's choice, ROUND2.md). No skeleton: it rolls, so it is cheap to move.
import * as THREE from '../vendor/three/three.module.min.js';

export const BEAN_HEIGHT = 1.7;                 // character.js HEAD_TOP
export const ROBOT_HEIGHT = BEAN_HEIGHT * 0.8;  // about 0.8 of a bean's height
export const MAX_TRIANGLES = 1500;
import { COLORS, eyeFor } from './mailroom-state.js';
export { COLORS, eyeFor };

/** A box with rounded corners in plan: a rounded rectangle extruded, with few segments so it stays cheap. */
function roundedBox(w, h, d, r, mat) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 2 }); g.translate(0, 0, -d / 2);
  return new THREE.Mesh(g, mat);
}
function namePlate(mat) {
  const doc = globalThis.document;
  if (doc?.createElement) {
    const c = doc.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
    if (x) {
      x.fillStyle = COLORS.brass; x.fillRect(0, 0, 256, 64); x.fillStyle = COLORS.ink; x.fillRect(4, 4, 248, 56);
      x.fillStyle = '#F6F1E7'; x.font = '600 34px "DM Sans", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('buddehbot', 128, 34);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; mat = new THREE.MeshBasicMaterial({ map: t });
    }
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.105), mat); m.name = 'name-plate'; m.userData.text = 'buddehbot';
  return m;
}

/** The robot, standing on the floor at the origin, facing +z. Returns { group, eye, setState(state), stamp, triangles }. */
export function makeRobot() {
  const ink = new THREE.MeshStandardMaterial({ color: COLORS.ink, roughness: 0.55, metalness: 0.25 });
  const slate = new THREE.MeshStandardMaterial({ color: COLORS.slate, roughness: 0.6, metalness: 0.2 });
  const red = new THREE.MeshStandardMaterial({ color: COLORS.red, roughness: 0.7 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#15171d', roughness: 0.9 });
  const group = new THREE.Group(); group.name = 'buddehbot';
  const H = ROBOT_HEIGHT, wheelR = 0.17;
  // Two wheels on an axle.
  for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.09, 12), rubber); w.rotation.z = Math.PI / 2; w.position.set(s * 0.27, wheelR, 0); group.add(w); }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), slate); axle.rotation.z = Math.PI / 2; axle.position.y = wheelR; group.add(axle);
  // The square body, rounded at the corners, with Slate panels on its sides and front.
  const bodyH = H * 0.5, bodyY = wheelR + 0.06 + bodyH / 2;
  const body = roundedBox(0.5, bodyH, 0.42, 0.06, ink); body.position.y = bodyY; group.add(body);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.02, bodyH * 0.7, 0.3), slate); p.position.set(s * 0.255, bodyY, 0); group.add(p); }
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.36, bodyH * 0.45, 0.02), slate); front.position.set(0, bodyY - bodyH * 0.12, 0.215); group.add(front);
  const plate = namePlate(new THREE.MeshBasicMaterial({ color: COLORS.brass })); plate.position.set(0, bodyY + bodyH * 0.28, 0.222); group.add(plate);
  // A short neck and a flat head with one round eye light.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), slate); neck.position.y = bodyY + bodyH / 2 + 0.04; group.add(neck);
  const headH = H - (bodyY + bodyH / 2 + 0.08), headY = H - headH / 2;
  const head = roundedBox(0.44, headH, 0.34, 0.05, ink); head.position.y = headY; group.add(head);
  const eyeMat = new THREE.MeshBasicMaterial({ color: COLORS.teal, toneMapped: false });
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), eyeMat); eye.position.set(0, headY, 0.172); eye.name = 'eye'; group.add(eye);
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 16), slate); rim.position.set(0, headY, 0.171); group.add(rim);
  // One arm, a clamp hand, and the Tower Red rubber stamp in it.
  const arm = new THREE.Group(); arm.position.set(0.3, bodyY + bodyH * 0.25, 0.05); group.add(arm);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.06), slate); upper.position.y = -0.13; arm.add(upper);
  for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.07, 0.05), slate); c.position.set(s * 0.04, -0.29, 0); arm.add(c); }
  const stamp = new THREE.Group(); stamp.position.y = -0.3; arm.add(stamp);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.1, 8), red); stamp.add(handle);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.035, 0.08), red); base.position.y = -0.065; stamp.add(base);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  let triangles = 0;
  group.traverse((o) => { if (o.isMesh) { const g = o.geometry; triangles += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return {
    group, eye, arm, stamp, plate, triangles, height: H,
    state: 'free',
    setState(state) { this.state = state; eyeMat.color.set(eyeFor(state)); },
  };
}
