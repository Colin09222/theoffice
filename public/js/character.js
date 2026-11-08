// The people, as the rooms see them: one interface (group, setAnim, update, paper/mug/phone, dispose, seatedY, labelY) driven by the floor's real data.
// What they look like and how they move is cast.js and only cast.js, so a different cast is one file. Everything here is about behaviour: which poses
// are on, how they blend, and how the typing goes. Nothing is downloaded, so everybody is there the moment a floor opens.
import * as THREE from '../vendor/three/three.module.min.js';
import { specFor, Creature, drawnFace, PORTRAIT_FRAME } from './cast.js';
import { stage } from './stage.js';

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
  if (!s) s = self.typist = { rate: 4.6 + Math.random() * 1.8, ph: Math.random() * 6.3, burst: 2 + Math.random() * 5, gap: 0, on: 0, glance: 0 };
  if (w < 0.01) { s.on = 0; return { l: 0, r: 0, on: 0, look: 0, glance: 0, nod: 0 }; }
  if (s.gap > 0) { s.gap -= dt; if (s.gap <= 0) s.burst = 2.5 + Math.random() * 5; }
  else if ((s.burst -= dt) <= 0) { s.gap = 0.5 + Math.random() * 1.2; s.glance = (Math.random() - 0.5) * 0.5; }
  s.on += ((s.gap > 0 ? 0 : 1) - s.on) * Math.min(1, dt * 7);  // hands settle and pick up again over about 0.2s
  // Frantic: about five taps a second per hand; the pace drifts a little so it never reads as a loop.
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
/** The cast's own units to room units, at the scale a floor's people are drawn at. */
const FIT = 0.6;

/** A staff member's job, known to the room before the lists ask for their badge photo. */
const JOB_OF = new Map();
export const rememberJob = (look, role) => { if (look) JOB_OF.set(JSON.stringify(look), role); };
export const jobOf = (look) => JOB_OF.get(JSON.stringify(look)) || '';

export class Character {
  constructor(look, { accent = '#d9774a', scale = 1, role = '' } = {}) {
    this.look = look; this.accent = accent; this.scale = scale; this.role = role;
    this.anim = 'stand'; this.blend = Object.fromEntries(ANIMS.map((n) => [n, 0]));
    this.spec = specFor(look, { role, accent });
    this.creature = new Creature(this.spec, { detail: stage.q?.density ?? 1 });
    this.group = this.creature.group;
    const s = scale * FIT;
    this.group.scale.setScalar(s);
    this.paper = this.creature.paper; this.mug = this.creature.mug; this.phone = this.creature.phone;
    this.headTop = this.creature.height * s;
    this.labelY = (this.creature.height + this.creature.labelClear) * s;
    this.fit = s;
    this.ready = true; this.isModel = true;
  }
  /** Group height that puts the body on a seat whose cushion is `seatTop` high. Their feet swing free. */
  seatedY(seatTop) { return seatTop - (this.creature.bottom - 0.03) * this.fit; }
  setAnim(name) { this.anim = name; }
  setManner(m) { this.manner = m; }
  /** A little jump for joy, when a job is finished. */
  celebrate() { this.creature.celebrate(); }
  update(dt, speed = 0) {
    const b = this.blend;
    ease(this, wantFor(this.anim, speed, this.paper.visible, this.inChair), dt);
    this.mug.visible = b.sip > 0.2 || b.pour > 0.2;
    this.phone.visible = b.phone > 0.2;
    this.creature.audience = this.audience;
    this.creature.pose(dt, speed, b, typing(this, dt, b.type), this.manner);
  }
  dispose() { this.creature.dispose(); }
}

/** The drawn badge face for a look, for the lists, until a photo is developed. */
export const drawnPortrait = (look, accent) => drawnFace(specFor(look || {}, { role: jobOf(look), accent }));

/** A turntable preview for the character builder, with its own small renderer. */
export function createPreview(canvas, look, accent) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { canvas.hidden = true; return { update() {}, dispose() {} }; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width || 200, rect.height || 240, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff6e6', '#d8c4ad', 2.3));
  const sun = new THREE.DirectionalLight('#fff1d8', 2.2); sun.position.set(2.5, 4, 3); sun.castShadow = true; sun.shadow.mapSize.set(512, 512);
  Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 3, bottom: -1, near: 1, far: 12 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0005; scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 28), new THREE.ShadowMaterial({ opacity: 0.22 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const cam = new THREE.PerspectiveCamera(26, (rect.width || 200) / (rect.height || 240), 0.1, 30);
  cam.position.set(0, 1.65, 6.3); cam.lookAt(0, 1.12, 0);  // room above the head for the tallest hat
  const make = (l, a) => { const c = new Character(l, { accent: a, scale: 1.4, role: 'boss' }); c.setAnim('stand'); return c; };  // this is the boss choosing their own look
  let ch = make(look, accent); scene.add(ch.group);
  let raf, dead = false, last = performance.now(), shown = '';
  const loop = (now) => {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    // The canvas may only get its real size once it is on the page, and a phone can turn. Keep the picture in proportion either way.
    const size = `${canvas.clientWidth}x${canvas.clientHeight}`;
    if (size !== shown && canvas.clientWidth && canvas.clientHeight) { shown = size; renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); cam.aspect = canvas.clientWidth / canvas.clientHeight; cam.updateProjectionMatrix(); }
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    // The preview's camera is out in front of them, so everyone faces it, swaying a little from side to side.
    ch.group.rotation.y = Math.sin(now / 1400) * 0.55;
    ch.update(dt);
    renderer.render(scene, cam);
  };
  raf = requestAnimationFrame(loop);
  return {
    update(next, acc = accent) { const y = ch.group.rotation.y; ch.dispose(); ch = make({ ...next }, acc); ch.group.rotation.y = y; scene.add(ch.group); },
    dispose() { dead = true; cancelAnimationFrame(raf); ch.dispose(); floor.geometry.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); },
  };
}

export { PORTRAIT_FRAME };
