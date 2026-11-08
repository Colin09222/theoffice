// The building, cut away: every floor's office in one 3D stack you ride up and down. The floors round the middle of the screen are the real
// thing, built by the floor page's own code (their room, furniture and people, fed by each floor's live stream) and standing in this one
// scene. Every other floor is drawn from a few instanced pieces in its company's colours, five draw calls for the whole tower, and turns
// into the real room as it comes near: built while the camera rests, then shown while its stand-in dissolves. Tap a floor and the camera
// flies in; the floor page takes over that very room without a rebuild, and Back flies out again to the same spot.
import * as THREE from '../vendor/three/three.module.min.js';
import { stage } from './stage.js';
import { api, BASE, session, toast } from './dom.js';
import { getWorld, makeTower, GROUND, FLOOR_H, TOWER_W } from './lobby-scene.js';
import { OfficeView } from './office-scene.js';
import { planFor, seatOf, seatSpot, ROOM_W, ROOM_D, WALL_H } from './layouts.js';
import { tidyLabels } from './labels.js';
import { handOver, takeHandoff } from './handoff.js';
import { environmentMap } from './textures.js';
import { CUT, CUT_AMOUNT, EDGE, cutAmount } from './cutaway.js';

const WS = ROOM_W / TOWER_W;            // the city's scale, the same as on a floor page
// Floor to floor: a room's walls, then air, then the next slab. Pulled apart like an exploded drawing, so a camera tilted well down sees
// over the desks and screens into every room, people included, and the slab above still clears the back wall.
export const FH = 10.5;
// The camera looks well down, as a floor page does, so people show over their desks and screens; the floors above the one in the
// middle rise out of its way (GAP), and the stack closes up again away from it.
const PITCH = 0.55, GAP = 9;
// Zoom: 1 is a floor across the free area; in to a close look at desk height, out to the whole building (both worked out per screen).
const CLOSE = 23;  // the closest the camera comes to the floor in the middle
const TAU = Math.PI * 2;
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const PLATE = TOWER_W * WS + 1.2;       // a floor's slab, as the floor page draws it
const BASE_Y = GROUND * WS + 0.6;       // the lowest floor's room, on top of the lobby podium
const SUN_DIR = new THREE.Vector3(0.74, 0.47, -0.32).normalize();
const FADE_N = 16;                      // vec4s of per-floor fade: up to 64 floors
const FINISH = { wood: '#b8895a', darkwood: '#6e4a33', parquet: '#a87a4c', concrete: '#aaa7a1', tile: '#dcd9d2', carpet: '#8f8b9d', terrazzo: '#d8d0c2', checker: '#cfcac0', rubber: '#4a4d55' };
const SPOT_KEY = 'office:tower-ride';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const slotY = (k) => BASE_Y + k * FH;
/** Where a floor page puts the city under floor n, relative to its room (see OfficeView.buildWorld). A flight carries the city there. */
const pageGround = (n) => -(GROUND + (n - 1) * FLOOR_H) * WS - (n === 1 ? 0.9 : 0.35);

// A 4x4 ordered dither: a stand-in dissolves pixel by pixel, with no transparency to sort.
const BAYER = 'float bayer4(vec2 p){ int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)); int i = x + y * 4; '
  + 'int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(b[i]) + 0.5) / 16.0; }';

/**
 * Every stand-in piece knows its floor (aSlot; 1000 and up for the building's own structure, which never dissolves). Per floor the shader
 * reads how much of the stand-in shows, and during a flight the floors above the one being entered rise out of the way.
 */
function patch(mat, U) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, CUT);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aSlot; uniform vec4 uFade[${FADE_N}]; uniform float uLift; uniform float uLiftFrom; uniform float uRide; uniform float uGap; uniform float uCutOn; varying float vFade; varying vec3 vCutP; varying vec2 vCut; varying float vFar;`)
      .replace('#include <project_vertex>', `
        bool _col = aSlot >= 2999.5, _far = !_col && aSlot >= 1999.5, _struct = _col || (!_far && aSlot >= 999.5);
        float _slot = _col ? aSlot - 3000.0 : _far ? aSlot - 2000.0 : _struct ? aSlot - 1000.0 : aSlot;
        int _si = int(clamp(_slot, 0.0, ${FADE_N * 4 - 1}.0) + 0.5);
        vFade = _struct ? 1.0 : uFade[_si / 4][_si - (_si / 4) * 4];
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        ${CUT_AMOUNT('uCutOn')}
        vCutP = vec3(mvPosition.x, mvPosition.y - (${BASE_Y.toFixed(4)} + _slot * ${FH.toFixed(2)}), mvPosition.z); vCut = _struct ? vec2(0.0) : _cut; vFar = _far ? 1.0 : 0.0;
        // The corner pillar nearest the camera, when it looks in across that corner, stands right in front of the room: it fades.
        #ifdef USE_INSTANCING
          if (_col) { vec2 _c = vec2(instanceMatrix[3].x, instanceMatrix[3].z); bool _near = _c.x * cameraPosition.x > 0.0 && _c.y * cameraPosition.z > 0.0;
            vFar = _near ? -smoothstep(0.3, 0.5, min(abs(_cd.x), abs(_cd.y))) * uCutOn : 0.0; }
        #endif
        mvPosition.y += uGap * smoothstep(0.0, 1.0, _slot - uRide) + (_slot > uLiftFrom ? uLift : 0.0);
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
        if (vFade <= 0.001 || (_far && (vCutP.z > ${EDGE.FB} ? _cut.x : _cut.y) <= 0.001)) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vFade; varying vec3 vCutP; varying vec2 vCut; varying float vFar;\n${BAYER}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float _b = bayer4(gl_FragCoord.xy);
        if (vFade < 0.999 && vFade <= _b) discard;
        // The walls facing the camera go down to their sills; the far ones come up as they do (see cutaway.js).
        if (vFar < 0.0) { if (-vFar > _b) discard; }
        else if (vFar > 0.5) { if ((vCutP.z > ${EDGE.FB} ? vCut.x : vCut.y) <= _b) discard; }
        else if (vCutP.y > ${EDGE.SILL} && ((vCutP.z < ${EDGE.HB} && vCut.x > _b) || (vCutP.x < ${EDGE.HL} && vCut.y > _b))) discard;`);
  };
  mat.customProgramCacheKey = () => `tower2-${mat.type}-${mat.map ? 'map' : 'plain'}`;
  return mat;
}

/** Instances of one shape and material, collected and then built as a single InstancedMesh. */
class Batch {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.items = []; }
  add(slot, x, y, z, sx, sy, sz, ry, color) { this.items.push([slot, x, y, z, sx, sy, sz, ry, color]); }
  build() {
    const n = this.items.length;
    const geo = this.geo.clone();
    const slots = new Float32Array(Math.max(1, n));
    const mesh = new THREE.InstancedMesh(geo, this.mat, Math.max(1, n));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    mesh.setColorAt(0, c.set('#ffffff'));  // allocated even when empty, so the shader always has its colours
    this.items.forEach(([slot, x, y, z, sx, sy, sz, ry, color], i) => {
      m.compose(p.set(x, y, z), q.setFromAxisAngle(up, ry), s.set(sx, sy, sz)); mesh.setMatrixAt(i, m); mesh.setColorAt(i, c.set(color)); slots[i] = slot;
    });
    geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slots, 1));
    mesh.count = n; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    return mesh;
  }
}

function toLetTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#d93a24'; x.fillRect(0, 0, 512, 128);
  x.strokeStyle = '#fff8e6'; x.lineWidth = 6; x.strokeRect(10, 10, 492, 108);
  x.fillStyle = '#fff8e6'; x.font = '700 78px "Barlow Condensed", Barlow, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('TO LET', 256, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** A point in a desk's own frame (built facing the back wall) turned and moved to where the desk stands. */
const local = ([x, z, ry = 0], lx, lz) => [x + lx * Math.cos(ry) + lz * Math.sin(ry), z - lx * Math.sin(ry) + lz * Math.cos(ry)];
const closedNow = (s) => !!s.floor.workMode?.closed && !s.agents.some((a) => a.state !== 'idle');

export class TowerView {
  constructor({ onEnter, onEmpty, labels }) {
    this.onEnter = onEnter; this.onEmpty = onEmpty; this.labels = labels;
    this.scene = new THREE.Scene();
    // The floor page's own look, so the hand-over between them is invisible: its fog, grade, occlusion, lights and exposure.
    this.scene.fog = new THREE.Fog('#ffffff', 140 * WS, 620 * WS);
    this.grade = { vignette: 0.22, grain: 0.016 };
    this.ao = { radius: 0.9, intensity: 1.9, color: '#2b1b10', falloff: 1 };
    this.bloom = 0.1;
    this.camera = new THREE.PerspectiveCamera(24, 1, 1, 3800);
    this.scene.add(new THREE.HemisphereLight('#cfe0f6', '#c4a98a', 1.1));
    this.sun = new THREE.DirectionalLight('#ffdcb4', 2.6); this.scene.add(this.sun, this.sun.target);
    // The floor page's sun casts shadows, which gives every material there a shadowed version of its shader. Here the sun has a shadow
    // map too, drawn once and never again (nothing in the tower casts), so the tower compiles exactly the floor page's shaders and a
    // room handed over doesn't stall on new ones. The real shadows come in on the floor page, under the cross-fade.
    this.staticShadows = true;
    // Its shadow camera looks at a sliver of empty air by the sun, so even that one drawing holds nothing: every surface reads as lit.
    Object.assign(this.sun.shadow.camera, { left: -0.01, right: 0.01, top: 0.01, bottom: -0.01, near: 0.1, far: 0.2 }); this.sun.shadow.camera.updateProjectionMatrix();
    const fill = new THREE.DirectionalLight('#bcd2f5', 0.55); fill.position.set(-17, 13, 23); this.scene.add(fill);
    this.world = getWorld();
    this.env = this.world.environment(); this.scene.environment = this.env; this.scene.environmentIntensity = 0.35;
    // The room's own panorama where a floor page would use it, so a room carried between the two keeps its light.
    if ((stage.q?.density ?? 1) >= 0.6 && stage.renderer) environmentMap(stage.renderer).then((rt) => { if (rt && !this.dead) { this.scene.environment = rt.texture; this.scene.environmentIntensity = 0.5; } });
    this.podium = makeTower(0, { stub: true, env: this.env });
    this.podium.group.scale.setScalar(WS); this.scene.add(this.podium.group);
    this.U = { uFade: { value: Array.from({ length: FADE_N }, () => new THREE.Vector4(1, 1, 1, 1)) }, uLift: { value: 0 }, uLiftFrom: { value: 1e6 }, uRide: { value: 0 }, uGap: { value: GAP } };
    this.mats = {
      solid: patch(new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0 }), this.U),
      glow: patch(new THREE.MeshBasicMaterial({ toneMapped: false }), this.U),
      sign: patch(new THREE.MeshBasicMaterial({ map: toLetTexture(), toneMapped: false }), this.U),
    };
    this.geos = { box: new THREE.BoxGeometry(1, 1, 1), body: new THREE.CapsuleGeometry(0.3, 0.42, 2, 8), ball: new THREE.IcosahedronGeometry(0.5, 1), plane: new THREE.PlaneGeometry(1, 1) };
    this.stand = new THREE.Group(); this.scene.add(this.stand);
    this.slots = []; this.byNumber = new Map(); this.staff = {}; this.rooms = {};
    this.full = new Map(); this.fade = new Float32Array(FADE_N * 4).fill(1);
    this.ride = 0; this.target = 0; this.yaw = 0.35; this.targetYaw = 0.35; this.time = 0;
    this.zoom = 1; this.targetZoom = 1; this.zMin = 0.2; this.zMax = 3.4; this.out = 0; this.pts = new Map(); this.lastInput = 0;
    this.radius = 1; this.w = window.innerWidth; this.h = window.innerHeight; this.turns = []; this.stillFor = 0; this.edge = [0, 1];
    this.plaques = new Map(); this.plaqueRoot = document.createElement('div'); this.plaqueRoot.className = 'tower-plaques';
    this.ray = new THREE.Raycaster(); this.box3 = new THREE.Box3(); this.v = new THREE.Vector3();
    this.ctrl = this.makeControls();
    this.setTier(stage.q || { density: 1 });
    this.bind();
  }

  // ---------- the building's floors ----------

  /** A fresh /api/floors answer: which floors exist, in order. A hidden floor, or one a code is holding, isn't in the stack at all. */
  setFloors(data) {
    const byNum = new Map(data.floors.map((f) => [f.number, f])); const toLet = new Set(data.toLet || []);
    const next = [];
    for (let n = 1; n <= data.towerFloors; n++) {
      const card = byNum.get(n);
      if (card) next.push({ n, card, kind: 'company' });
      else if (toLet.has(n)) next.push({ n, card: null, kind: 'empty' });
    }
    const keyOf = (s) => s.map((x) => `${x.n}${x.kind[0]}${x.card?.slug || ''}`).join(',');
    const changed = keyOf(next) !== keyOf(this.slots);
    const was = this.slots[Math.round(this.ride)]?.n;
    next.forEach((s, k) => { s.k = k; s.plan = planFor(this.rooms[s.n]?.decor?.layout); });
    if (changed) {
      // The floors stay where they are under the camera, whatever moved in or out elsewhere. A real floor follows its company to its new place.
      const bySlug = new Map(next.filter((s) => s.card).map((s) => [s.card.slug, s]));
      const moved = [...this.full.values()];
      this.full.clear(); this.fade.fill(1);
      for (const f of moved) {
        const s = bySlug.get(f.slot.card.slug);
        if (!s) { this.quiet(f); f.view.destroy(); continue; }
        f.slot = s; this.full.set(s.k, f); f.view.root.position.y = slotY(s.k); this.fade[s.k] = 1 - f.show;
      }
      this.slots = next; this.byNumber = new Map(next.map((s) => [s.n, s]));
      const keep = this.byNumber.get(was);
      if (keep) { this.ride = this.target = keep.k; }
      if (this.ride > next.length - 1) this.ride = this.target = Math.max(0, next.length - 1);
    } else next.forEach((s, k) => { this.slots[k].card = s.card; });
    // Busy screens and names change all the time and the pieces don't, but rebuilding them all takes a millisecond, so a poll just does.
    this.buildStandIns();
    this.syncPlaques(true);
  }
  /** Who works where, and each floor's room, from /api/building/staff. */
  setStaff(d) {
    this.staff = d.floors || {}; this.rooms = d.rooms || {};
    for (const s of this.slots) s.plan = planFor(this.rooms[s.n]?.decor?.layout);
    if (this.slots.length) this.buildStandIns();
  }
  async loadStaff() {
    const d = await api('/building/staff').catch(() => null);
    if (d && !this.dead) this.setStaff(d);
  }

  /**
   * Every floor as stand-in pieces: the room's walls in its wall colour, its floor finish, the company's colour round the edge, windows
   * full of sky, the desks where the floor's own plan has them, a lit screen where someone is at work, and the people in their own colours.
   * An empty floor is dark, with a To Let board. All of it is five instanced meshes for the whole building.
   */
  buildStandIns() {
    for (const m of [...this.stand.children]) { m.removeFromParent(); m.geometry.dispose(); }
    const box = new Batch(this.geos.box, this.mats.solid), glow = new Batch(this.geos.box, this.mats.glow), body = new Batch(this.geos.body, this.mats.solid), ball = new Batch(this.geos.ball, this.mats.solid), sign = new Batch(this.geos.plane, this.mats.sign);
    const S = 1000;  // structure: never dissolves
    const N = this.slots.length;
    for (const s of this.slots) {
      const k = s.k, y = slotY(k);
      // The slab, a hair inside the one a real floor draws, so the two never fight over the same surface.
      box.add(S + k, 0, y - 0.27, 0, PLATE - 0.04, 0.38, PLATE - 0.04, 0, '#e9dfcf');
      box.add(S + k, 0, y - 0.54, 0, PLATE + 0.26, 0.1, PLATE + 0.26, 0, '#d4c8b6');
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box.add(3000 + k, px * (PLATE / 2 + 0.36), y - 0.6 + FH / 2, pz * (PLATE / 2 + 0.36), 0.72, FH, 0.72, 0, '#e2d5c1');
      const d = this.rooms[s.n]?.decor || {};
      const L = s.plan;
      const wall = s.kind === 'empty' ? '#5f5a53' : d.wall || '#e9e1d3';
      const finish = s.kind === 'empty' ? '#3f3c38' : FINISH[d.floor] || FINISH.wood;
      const primary = s.card?.colors?.primary || '#8a8174', accent = s.card?.colors?.accent || '#c9b48a';
      // The walls, a hair inside a real floor's.
      box.add(k, 0, y + WALL_H / 2, -ROOM_D / 2 - 0.16, ROOM_W, WALL_H, 0.24, 0, wall);
      box.add(k, -ROOM_W / 2 - 0.16, y + WALL_H / 2, 0, 0.24, WALL_H, ROOM_D + 0.3, 0, wall);
      box.add(k, 0, y - 0.018, 0, ROOM_W + 0.9, 0.012, ROOM_D + 0.9, 0, s.kind === 'empty' ? '#2f2d2a' : primary);
      box.add(k, 0, y - 0.009, 0, ROOM_W, 0.006, ROOM_D, 0, finish);
      for (const [a, b] of L.windows) glow.add(k, (a + b) / 2, y + 1 + (WALL_H - 1.36) / 2, -ROOM_D / 2 - 0.03, b - a, WALL_H - 1.36, 0.02, 0, s.kind === 'empty' ? '#7d8a95' : '#cfe1ee');
      // The front and right walls, drawn only from behind, as the back and left ones are cut away.
      box.add(2000 + k, 0, y + WALL_H / 2, ROOM_D / 2 + 0.16, ROOM_W + 0.3, WALL_H, 0.24, 0, wall);
      box.add(2000 + k, ROOM_W / 2 + 0.16, y + WALL_H / 2, 0, 0.24, WALL_H, ROOM_D + 0.3, 0, wall);
      for (const [a, b] of L.windows) glow.add(2000 + k, (a + b) / 2, y + 1 + (WALL_H - 1.36) / 2, ROOM_D / 2 + 0.03, b - a, WALL_H - 1.36, 0.02, 0, s.kind === 'empty' ? '#7d8a95' : '#cfe1ee');
      if (s.kind === 'empty') { sign.add(k, 0, y + 2.7, -ROOM_D / 2 - 0.01, 7.2, 1.8, 1, 0, '#ffffff'); continue; }
      const staff = this.staff[s.n] || [];
      const mgr = staff.find((p) => p.role === 'manager'); const crew = staff.filter((p) => p.role !== 'manager');
      const boss = this.rooms[s.n]?.boss;
      const rooms = (L.rooms || []).filter((r) => r.kind === 'staff');
      const seats = [[L.manager, mgr, true], [L.boss, boss ? { look: boss.look, busy: false } : null, true]];
      rooms.forEach((r, i) => seats.push([r.desk, crew[i] || null, false]));
      for (let i = rooms.length; i < crew.length; i++) seats.push([seatSpot(L, L.desks.length + ((i - rooms.length) % Math.max(1, L.shared.length))), crew[i], false]);
      for (const [spot, who, big] of seats) {
        if (!spot) continue;
        const W = big ? 3 : 2.3, D = big ? 1.4 : 1.1, ry = spot[2] || 0;
        const [tx, tz] = local(spot, 0, -0.2); box.add(k, tx, y + 0.48, tz, W, 0.96, D, ry, big ? '#6e4a33' : '#dcc7a7');
        const [mx, mz] = local(spot, 0, -0.56); glow.add(k, mx, y + 1.6, mz, 1.05, 0.66, 0.06, ry, who?.busy ? '#bcdcff' : '#2c3038');
        const [cx, cz] = local(spot, 0, 1.12); box.add(k, cx, y + 0.95, cz, big ? 0.8 : 0.7, 0.8, 0.12, ry, big ? primary : accent);
        if (!who) continue;
        const look = who.look || {};
        const { at } = seatOf(spot);
        body.add(k, at[0], y + 1.12, at[1], 1, 1, 1, ry, look.outfitColor || '#27324a');
        ball.add(k, at[0], y + 1.78, at[1], 0.62, 0.62, 0.62, 0, look.skin || '#eec39a');
        if (look.hair && look.hair !== 'none') ball.add(k, at[0], y + 1.95, at[1], 0.66, 0.36, 0.66, 0, look.hairColor || '#4a2f1d');
      }
      for (let i = 0; i < Math.min(d.plants ?? 3, L.plants.length); i++) { const [px, pz] = L.plants[i]; box.add(k, px, y + 0.25, pz, 0.5, 0.5, 0.5, 0, '#b86a4b'); ball.add(k, px, y + 0.95, pz, 1.1, 1.2, 1.1, 0, i % 2 ? '#4f7a54' : '#5e9160'); }
      if (d.coffee !== false && L.coffee) { box.add(k, L.coffee[0], y + 0.53, L.coffee[1], 1.0, 1.06, 3.6, 0, '#5e4436'); if (L.fridge) box.add(k, L.fridge[0], y + 1, L.fridge[1], 0.95, 2, 0.9, 0, '#d9dde2'); }
    }
    // The roof: the last slab, a stepped crown and a mast, all part of the building.
    const top = slotY(N);
    box.add(1000 + N, 0, top - 0.3, 0, PLATE + 0.3, 0.6, PLATE + 0.3, 0, '#e2d5c1');
    let cy = top;
    for (const [w, hh] of [[PLATE - 6, 5.2], [PLATE - 12, 4.4], [PLATE - 18, 3.8]]) { box.add(1000 + N, 0, cy + hh / 2, 0, w, hh, w, 0, '#e6d6be'); box.add(1000 + N, 0, cy + hh + 0.15, 0, w + 0.9, 0.3, w + 0.9, 0, '#c9a86a'); cy += hh + 0.3; }
    box.add(1000 + N, 0, cy + 11, 0, 0.9, 22, 0.9, 0, '#c9a86a');
    glow.add(1000 + N, 0, cy + 22.4, 0, 0.8, 0.8, 0.8, 0, '#ff6a52');
    for (const b of [box, glow, body, ball, sign]) this.stand.add(b.build());
    this.built = true;
    this.fadeAll();
  }
  fadeAll() {
    const f = this.fade;
    for (let i = 0; i < FADE_N; i++) this.U.uFade.value[i].set(f[i * 4], f[i * 4 + 1], f[i * 4 + 2], f[i * 4 + 3]);
  }

  // ---------- the real floors, near the camera ----------

  /** The real floors wanted now: the one in the middle of the screen and its neighbours, as many as this device can carry. */
  wanted() {
    const c = Math.round(this.ride), out = [];
    for (let d = 0; d <= this.radius; d++) for (const k of d ? [c + d, c - d] : [c]) { const s = this.slots[k]; if (s?.kind === 'company') out.push(k); }
    return out;
  }
  manage(dt) {
    const want = this.wanted(); const wantSet = new Set(want);
    // Built only while the building stands still, one floor at a time, nearest first, and then a step a frame (see turn), so building a
    // room never lands in the middle of a swipe.
    if (this.stillFor > 0.15 && !this.building) { const k = want.find((x) => !this.full.has(x) && !(performance.now() - (this.slots[x].failed || -1e9) < 15000)); if (k !== undefined) this.buildFloor(k); }
    for (const f of this.full.values()) {
      const v = f.view;
      if (!f.ready) {
        if (this.stillFor > 0) f.wait = (f.wait || 0) + dt;
        // Shown once its floor is baked, its furniture is in and its people are the kit's models, so nobody watches them swap in.
        const built = !!v.baked && !!v.loading?.settled && ([...v.actors.values()].every((a) => a.char.isModel) || f.wait > 6);
        // Its shaders are compiled off to the side before it is shown, so its first frame on screen doesn't stall on them.
        if (built && !f.compiling) f.compiling = this.compileFloor(f).then(() => { f.ready = true; });
      }
      const show = f.ready && (wantSet.has(f.slot.k) || f.pinned);
      // The real room appears at once behind its stand-in, which then dissolves; going away, the stand-in comes back first.
      f.show += (show ? 1 : -1) * dt / 0.45; f.show = Math.min(1, Math.max(0, f.show));
      const on = show || f.show > 0;
      if (v.root.visible !== on) {
        v.root.visible = on;
        if (!on) for (const a of v.actors.values()) { a.tagOff = true; a.tag.style.visibility = 'hidden'; }
      }
      // Live from the floor's own stream while it is near the middle: opened once the building stands still, closed when it is two away,
      // so a tab holds three streams at most. Coming back, the stream replays what was missed.
      const d = Math.abs(f.slot.k - Math.round(this.ride));
      if (!f.es && this.active && on && d <= 1 && this.stillFor > 0.3) this.listen(f);
      else if (f.es && (!this.active || !on || d > 2)) this.quiet(f);
      this.fade[f.slot.k] = 1 - f.show;
    }
    this.fadeAll();
    // A few spare floors are kept for scrolling back; beyond that the farthest goes.
    const keep = (this.radius * 2 + 1) + 2;
    if (this.full.size > keep) {
      const c = this.ride; const far = [...this.full.values()].filter((f) => !f.view.root.visible && !f.pinned).sort((a, b) => Math.abs(b.slot.k - c) - Math.abs(a.slot.k - c))[0];
      if (far) this.dropFloor(far);
    }
  }
  async buildFloor(k) {
    const slot = this.slots[k];
    this.building = k;
    try {
      const state = await api(`/floors/${slot.card.slug}`);
      if (this.dead || this.slots[k] !== slot || this.full.has(k)) return;
      // A frame to breathe before the room is put together.
      await new Promise((r) => requestAnimationFrame(r));
      if (this.dead || this.slots[k] !== slot) return;
      const view = new OfficeView({ state, labels: this.labels, host: this });
      this.place(view, k, state);
      const f = { slot, view, state, show: 0, ready: false, lastId: state.lastEventId };
      view.root.visible = false;
      this.full.set(k, f);
    } catch (e) {
      if (!this.dead) console.warn('tower: floor unavailable', slot.card.slug, e?.message || e);
      slot.failed = performance.now();
    } finally { this.building = null; }
  }
  place(view, k, state) {
    view.root.position.set(0, slotY(k), 0);
    this.scene.add(view.root);
    view.setSize(this.w, this.h);
    view.setTier(stage.q || { density: 1 });
    if (state) view.setClosed(closedNow(state));
  }
  dropFloor(f) {
    this.quiet(f);
    this.full.delete(f.slot.k);
    this.fade[f.slot.k] = 1;
    f.view.destroy();
  }
  /** The floor's own live stream, while it is on show: people's states, their words, meetings and handoffs, as on its floor page. */
  listen(f) {
    if (f.es || this.dead) return;
    const es = new EventSource(`${BASE}/api/floors/${f.slot.card.slug}/stream?since=${f.lastId || 0}`);
    f.es = es;
    const fresh = (d) => Date.now() - (d._ts || 0) < 15000;
    const on = (type, fn) => es.addEventListener(type, (e) => {
      if (f.es !== es || f.view.dead) return;
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d._id) f.lastId = Math.max(f.lastId || 0, d._id);
      fn(d);
    });
    const s = f.state, v = f.view;
    on('agent', (d) => { const a = s.agents.find((x) => x.id === d.id); if (a) Object.assign(a, { state: d.state, activity: d.activity, taskId: d.taskId }); v.agentEvent(d); v.setClosed(closedNow(s)); });
    on('talk', (d) => { if (fresh(d)) v.life?.line({ id: d._id, from: d.from, to: d.to, fromName: d.fromName, toName: d.toName, text: d.text, kind: d.kind, beat: d.beat, ts: d._ts || d.ts }); });
    on('task', (d) => { const i = s.tasks.findIndex((t) => t.id === d.id); if (i >= 0) s.tasks[i] = { ...s.tasks[i], ...d }; else s.tasks.push(d); v.updateBoard(s.tasks); });
    on('meeting', (d) => { if (fresh(d)) v.meeting(d.manager, d.staff); });
    on('handoff', (d) => { if (fresh(d)) v.handoff(d.from, d.to); });
    on('project', (d) => { if (fresh(d)) v.cheer(); });
    on('help_state', (d) => { if (d.call && fresh(d)) v.phoneCall(d.call); });
    on('floor', (d) => { Object.assign(s.floor, d); v.setClosed(closedNow(s)); if (['name', 'colors', 'decor', 'logoUrl'].some((key) => key in d)) this.dropFloor(f); });
    on('hired', () => this.dropFloor(f));
    on('reload', () => this.dropFloor(f));
  }
  quiet(f) { f.es?.close(); f.es = null; }
  compileFloor(f) {
    const r = stage.renderer, root = f.view.root;
    if (!r?.compileAsync) return Promise.resolve();
    const was = root.visible; root.visible = true;  // compile only looks at what is visible, and only at the moment it is called
    let job;
    try { job = r.compileAsync(root, this.camera, this.scene); } catch { job = Promise.resolve(); } finally { root.visible = was; }
    return Promise.race([job.catch(() => {}), new Promise((res) => setTimeout(res, 2000))]);
  }
  /** A floor's next build step, granted one a frame while the building stands still. See OfficeView.turn. */
  turn() { return this.dead ? null : new Promise((r) => this.turns.push(r)); }

  // ---------- the camera ----------

  /** The part of the screen the tower has: left of the directory on a desktop, above the sheet on a phone. */
  insets() {
    const phone = this.w <= 760;
    return phone ? { left: 0, right: 0, top: 64, bottom: 200 } : { left: 24, right: Math.min(430, this.w * 0.34), top: 74, bottom: 128 };
  }
  /** How far back the camera sits for this screen: a floor's width across the free area (a phone crops a little off the sides). */
  frame() {
    const i = this.insets(), w = this.w, h = this.h;
    const freeW = Math.max(120, w - i.left - i.right), freeH = Math.max(120, h - i.top - i.bottom);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), aspect = w / h;
    // The room's width as the camera sees it at this turn; a phone crops a little off the sides.
    // The room's widest extent, whichever way round the camera is, so going round never breathes in and out.
    const span = (Math.hypot(ROOM_W + 1.5, ROOM_D + 1.5) * 0.97 + 1) * (w <= 760 ? 0.9 : 1);
    let dist = (span / 2) / (tanV * aspect * (freeW / w));
    dist = Math.min(dist, (FH * 4.2 / 2) / (tanV * (freeH / h)));  // never so far that more than four floors fit
    return { dist, i, freeW, freeH, pxPerUnit: h / (2 * dist * tanV) };
  }
  rideY(r = this.ride) { return slotY(0) + r * FH; }
  /** How far a floor stands above its place: the gap over the floor in the middle of the screen, and a flight's lift. */
  offsetOf(k) { return this.U.uGap.value * smooth01(k - this.ride) + (k > this.U.uLiftFrom.value ? this.U.uLift.value : 0); }
  /** The whole building, ground to mast, and how far back a camera must stand to see all of it in the free area. */
  overview(fr) {
    const top = slotY(this.slots.length) + 40, p = 0.42, tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const need = (top * Math.cos(p) + PLATE * 1.2 * Math.sin(p)) / 2 * 1.1;
    return { mid: top / 2, dist: Math.max(fr.dist * 1.2, need / (tanV * (fr.freeH / this.h))) };
  }
  placeCamera() {
    const fr = this.framing = this.frame();
    const all = this.overview(fr); this.zMin = Math.min(0.85, fr.dist / all.dist); this.zMax = Math.max(2.4, fr.dist / CLOSE);
    const z = this.zoom;
    // Out from 1: the camera backs off and drifts to the building's middle, the gap over the floor in view closing a little. In from 1: closer
    // and lower, down to desk height.
    const out = this.out = z < 1 ? smooth01((1 - z) / Math.max(1e-3, 1 - this.zMin)) : 0, inn = z > 1 ? Math.min(1, (z - 1) / (this.zMax - 1)) : 0;
    this.U.uGap.value = GAP * (1 - 0.55 * out);
    const pitch = PITCH + (0.42 - PITCH) * out - (PITCH - 0.2) * Math.sqrt(inn);
    const dist = out > 0 ? fr.dist + (all.dist - fr.dist) * out : fr.dist / z;
    const y = this.rideY() + (1.2 - 0.3 * inn) + (all.mid - this.rideY() - 1.2) * out;
    const c = this.camera;
    c.position.set(Math.sin(this.yaw) * Math.cos(pitch) * dist, y + Math.sin(pitch) * dist, Math.cos(this.yaw) * Math.cos(pitch) * dist);
    c.lookAt(0, y, 0);
    c.setViewOffset(this.w, this.h, (fr.i.right - fr.i.left) / 2, (fr.i.bottom - fr.i.top) / 2, this.w, this.h);
    c.updateProjectionMatrix();
    // Far out, the haze moves back with the camera, so the whole building stays crisp.
    const f = this.scene.fog, back = Math.max(1, dist / fr.dist); f.near = 140 * WS * back; f.far = 620 * WS * back;
  }
  clampTarget(t) { return Math.max(0, Math.min(this.slots.length - 1, t)); }
  /** Where the ride was left this visit, or else the highest floor with a company on it. */
  restoreSpot() {
    let spot = null; try { spot = JSON.parse(sessionStorage.getItem(SPOT_KEY) || 'null'); } catch { /* private mode */ }
    const s = spot && this.byNumber.get(spot.n);
    const top = [...this.slots].reverse().find((x) => x.kind === 'company');
    this.rideTo((s || top || this.slots[0] || { k: 0 }).k, { instant: true });
    if (spot?.yaw !== undefined) this.yaw = this.targetYaw = spot.yaw;
    if (spot?.zoom) this.zoom = this.targetZoom = Math.min(this.zMax, spot.zoom);
  }
  rideTo(k, { instant = false } = {}) { this.target = this.clampTarget(k); if (instant) this.ride = this.target; }
  /** Rides to a floor by its number. */
  rideToFloor(n, opts) { const s = this.byNumber.get(n); if (s) this.rideTo(s.k, opts); }

  // ---------- input: wheel, drag, swipe, keys, taps ----------

  /** Up or down a floor, round by an angle, in or out by a factor: the buttons and keys. */
  step(n) { this.target = this.clampTarget(Math.round(this.target) + n); this.glide = true; this.flyTicket = (this.flyTicket || 0) + 1; this.poke(); }
  turnBy(a) { this.targetYaw = Math.round((this.targetYaw + a) / (Math.PI / 4)) * (Math.PI / 4); this.poke(); }
  zoomBy(f) { this.targetZoom = Math.max(this.zMin, Math.min(this.zMax, this.targetZoom * f)); this.poke(); }
  /** The whole building in view, or back to the floor in the middle when it already is. */
  wholeBuilding() { this.targetZoom = this.targetZoom < 0.95 ? 1 : this.zMin; this.poke(); }
  poke() { this.lastInput = performance.now(); stage.wake?.(); }

  bind() {
    const el = document.getElementById('scene');
    let wheelAt = 0;
    this.onWheel = (e) => {
      if (!this.active || e.target !== el || this.flight) return;
      e.preventDefault(); this.poke();
      const unit = e.deltaMode === 1 ? 40 : 1, dy = e.deltaY * unit, dx = e.deltaX * unit;
      // A pinch on a trackpad arrives as ctrl+wheel: zoom. A sideways two-finger swipe turns. The wheel itself rides the floors.
      if (e.ctrlKey || e.metaKey) { this.targetZoom = Math.max(this.zMin, Math.min(this.zMax, this.targetZoom * Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.012))); return; }
      if (Math.abs(dx) > Math.abs(dy) * 1.5) { this.targetYaw -= dx * 0.004; return; }
      this.target = this.clampTarget(this.target - dy / 150);
      wheelAt = performance.now(); this.wheeling = true; this.flyTicket = (this.flyTicket || 0) + 1;
    };
    this.snapWheel = () => { if (this.wheeling && performance.now() - wheelAt > 160) { this.wheeling = false; this.target = this.clampTarget(Math.round(this.target)); } };
    // Safari's own trackpad pinch.
    this.onGesture = (e) => { if (!this.active || this.flight) return; e.preventDefault(); this.poke(); if (e.type === 'gesturestart') this.gesture = this.targetZoom; else if (this.gesture) this.targetZoom = Math.max(this.zMin, Math.min(this.zMax, this.gesture * e.scale)); };
    this.onDown = (e) => {
      if (!this.active || e.target !== el || this.flight) return;
      this.poke();
      this.pts.set(e.pointerId, [e.clientX, e.clientY]);
      el.setPointerCapture?.(e.pointerId);
      if (this.pts.size === 2) {
        // Two fingers: a pinch. Whatever the first finger was doing stops, and the gesture can no longer be a tap.
        const [a, b] = [...this.pts.values()];
        this.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, zoom: this.targetZoom };
        if (this.drag) { this.drag.moved = true; this.drag.pinched = true; this.target = this.clampTarget(Math.round(this.ride)); this.glide = true; }
        return;
      }
      if (this.pts.size > 2) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), ride: this.ride, yaw: this.targetYaw, moved: false, axis: null, samples: [[performance.now(), this.ride, this.targetYaw]] };
      this.target = this.ride;
    };
    this.onMove = (e) => {
      if (!this.active || !this.pts.has(e.pointerId)) return;
      this.pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pinch && this.pts.size >= 2) {
        const [a, b] = [...this.pts.values()];
        this.targetZoom = Math.max(this.zMin, Math.min(this.zMax, this.pinch.zoom * (Math.hypot(a[0] - b[0], a[1] - b[1]) / this.pinch.d)));
        this.poke(); return;
      }
      const d = this.drag;
      if (!d || d.id !== e.pointerId || d.pinched) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      // Past a few pixels it is a drag, never a tap, and it takes the way it set off: sideways turns, up and down rides the floors.
      if (!d.moved && Math.hypot(dx, dy) > 8) { d.moved = true; d.axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'turn' : 'ride'; d.sx = e.clientX; d.sy = e.clientY; }
      if (!d.moved) return;
      this.poke();
      if (!d.called) { d.called = true; this.flyTicket = (this.flyTicket || 0) + 1; }
      const mx = e.clientX - d.sx, my = e.clientY - d.sy;
      if (d.axis === 'ride') {
        const per = FH * (this.framing?.pxPerUnit || 10) * Math.max(0.35, Math.min(1.6, this.zoom));
        this.ride = this.target = Math.max(-0.35, Math.min(this.slots.length - 0.65, d.ride + my / per));
      } else this.targetYaw = d.yaw - mx * (5.5 / Math.max(320, this.w));
      const now = performance.now(); d.samples.push([now, this.ride, this.targetYaw]); while (d.samples.length > 2 && now - d.samples[0][0] > 120) d.samples.shift();
    };
    this.onUp = (e) => {
      const had = this.pts.delete(e.pointerId);
      if (this.pts.size < 2) this.pinch = null;
      const d = this.drag;
      if (!this.active || !had || !d || d.id !== e.pointerId) return;
      this.drag = null;
      if (d.pinched) return;
      if (!d.moved) { if (e.type !== 'pointercancel' && performance.now() - d.t < 600 && this.pts.size === 0) this.tap(e.clientX, e.clientY); return; }
      // A flick carries on: the speed of the last tenth of a second, projected forward, and a ride settles on a floor.
      const [t0, r0, y0] = d.samples[0], [t1, r1, y1] = d.samples[d.samples.length - 1];
      const dt = t1 > t0 ? (t1 - t0) / 1000 : 0;
      if (d.axis === 'ride') {
        const v = dt ? (r1 - r0) / dt : 0;
        this.target = this.clampTarget(Math.round(this.ride + Math.max(-14, Math.min(14, v * 0.32))));
        this.glide = true;
      } else if (dt) this.targetYaw += Math.max(-2.5, Math.min(2.5, ((y1 - y0) / dt) * 0.22));
    };
    this.onKey = (e) => {
      if (!this.active || this.flight || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = document.activeElement;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.turnBy(e.key === 'ArrowLeft' ? -Math.PI / 4 : Math.PI / 4); return; }
      if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') { e.preventDefault(); this.zoomBy(e.key === '-' || e.key === '_' ? 1 / 1.35 : 1.35); return; }
      const step = { ArrowUp: 1, ArrowDown: -1, PageUp: 3, PageDown: -3, Home: 1e3, End: -1e3 }[e.key];
      if (step === undefined) { if (e.key === 'Enter' && t === document.body) this.enterSlot(Math.round(this.target)); return; }
      e.preventDefault();
      this.step(step);
    };
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('gesturestart', this.onGesture); el.addEventListener('gesturechange', this.onGesture);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    this.unbind = () => {
      el.removeEventListener('wheel', this.onWheel); el.removeEventListener('pointerdown', this.onDown);
      el.removeEventListener('gesturestart', this.onGesture); el.removeEventListener('gesturechange', this.onGesture);
      window.removeEventListener('pointermove', this.onMove); window.removeEventListener('pointerup', this.onUp); window.removeEventListener('pointercancel', this.onUp);
      window.removeEventListener('keydown', this.onKey);
    };
  }
  /** Small buttons for all of it, for anyone who'd rather press than drag, and for screen readers. */
  makeControls() {
    const bar = document.createElement('div'); bar.className = 'tower-ctrl'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Move round the building');
    const NS = 'http://www.w3.org/2000/svg';
    const svg = (d, flip) => () => {
      const g = document.createElementNS(NS, 'svg'); g.setAttribute('viewBox', '0 0 24 24'); g.setAttribute('aria-hidden', 'true'); if (flip) g.setAttribute('class', 'flip');
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); g.append(p); return g;
    };
    const ICON = {
      up: svg('M6 15l6-6 6 6'), down: svg('M6 9l6 6 6-6'),
      left: svg('M4.5 8.5A8 8 0 1 1 4 13M4.5 3.5v5h5'), right: svg('M4.5 8.5A8 8 0 1 1 4 13M4.5 3.5v5h5', true),
      in: svg('M12 5v14M5 12h14'), out: svg('M5 12h14'),
    };
    const add = (key, label, fn, text) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = `tower-btn tb-${key}`; b.dataset.tower = key; b.title = label; b.setAttribute('aria-label', label);
      if (text) b.textContent = text; else b.append(ICON[key]());
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      bar.append(b); return b;
    };
    add('up', 'Floor up', () => this.step(1)); add('down', 'Floor down', () => this.step(-1));
    add('left', 'Turn left', () => this.turnBy(-Math.PI / 4)); add('right', 'Turn right', () => this.turnBy(Math.PI / 4));
    add('in', 'Zoom in', () => this.zoomBy(1.35)); add('out', 'Zoom out', () => this.zoomBy(1 / 1.35));
    this.wholeBtn = add('whole', 'See the whole building', () => this.wholeBuilding(), 'Whole building');
    return bar;
  }
  /** Which floor is under a point on the screen: the nearest floor box the ray goes into. */
  slotAt(x, y) {
    const r = document.getElementById('scene').getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    let best = null, bestD = Infinity;
    const c = Math.round(this.ride);
    for (let k = Math.max(0, c - 8); k <= Math.min(this.slots.length - 1, c + 8); k++) {
      const y0 = slotY(k) + this.offsetOf(k) - 0.6;
      this.box3.min.set(-PLATE / 2, y0, -PLATE / 2); this.box3.max.set(PLATE / 2, y0 + FH, PLATE / 2);
      const hit = this.ray.ray.intersectBox(this.box3, this.v);
      if (hit) { const d = hit.distanceTo(this.ray.ray.origin); if (d < bestD) { bestD = d; best = k; } }
    }
    return best;
  }
  tap(x, y) { const k = this.slotAt(x, y); if (k !== null) this.enterSlot(k); }
  enterSlot(k) {
    const s = this.slots[k]; if (!s) return;
    if (s.kind === 'empty') { this.onEmpty?.(s.n); return; }
    if (s.card.status === 'suspended') { toast('This floor has been closed by the building manager.'); return; }
    this.flyInto(s.n);
  }

  // ---------- floor plaques ----------

  /** A small sign by each floor in view: its number and company, a dot while someone is at work. Pressing it is the same as tapping the floor. */
  syncPlaques(rebuild = false) {
    if (rebuild) { for (const p of this.plaques.values()) p.el.remove(); this.plaques.clear(); }
    const c = Math.round(this.ride), span = this.w <= 760 ? 5 : 4;
    const seen = new Set();
    for (let k = Math.max(0, c - span); k <= Math.min(this.slots.length - 1, c + span); k++) {
      const s = this.slots[k]; seen.add(k);
      let p = this.plaques.get(k);
      if (!p) {
        const el = document.createElement('button'); el.type = 'button'; el.className = `tower-plaque${s.kind === 'empty' ? ' to-let' : ''}`; el.dataset.floor = String(s.n);
        const num = document.createElement('b'); num.textContent = String(s.n);
        const name = document.createElement('span'); name.textContent = s.kind === 'empty' ? 'To let' : s.card.name || 'Moving in';
        el.append(num, name);
        if (s.card?.busy) { const dot = document.createElement('i'); dot.title = `${s.card.busy} at work`; el.append(dot); }
        if (s.card?.colors) el.style.setProperty('--brand', s.card.colors.primary);
        el.setAttribute('aria-label', s.kind === 'empty' ? `Floor ${s.n}, to let` : `Floor ${s.n}, ${s.card.name || 'new company moving in'}. Go in`);
        el.addEventListener('click', () => this.enterSlot(k));
        this.plaqueRoot.append(el);
        p = { el, k }; this.plaques.set(k, p);
      }
    }
    for (const [k, p] of this.plaques) if (!seen.has(k)) { p.el.remove(); this.plaques.delete(k); }
  }
  placePlaques() {
    if (this.plaqueKey === `${Math.round(this.ride)}`) { /* same set */ } else { this.plaqueKey = `${Math.round(this.ride)}`; this.syncPlaques(); }
    const v = this.v; const top = this.framing.i.top, bottom = this.h - this.framing.i.bottom;
    for (const p of this.plaques.values()) {
      // On the slab's edge facing the camera, at its left end, where it covers nobody.
      const [nx, nz] = this.edge;
      v.set(nx * PLATE / 2 - nz * (PLATE / 2 - 0.6), slotY(p.k) + this.offsetOf(p.k) - 0.3, nz * PLATE / 2 + nx * (PLATE / 2 - 0.6)).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * this.w, y = (-v.y * 0.5 + 0.5) * this.h;
      const off = v.z > 1 || y < top - 10 || y > bottom + 30 || this.flight || this.out > 0.85;
      if (p.off !== off) { p.off = off; p.el.classList.toggle('off', off); }
      if (!off) p.el.style.transform = `translate(${Math.max(6, x).toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  // ---------- flying in and out ----------

  /**
   * The floor page's panels exactly as it will lay them out (floors2.css), so the camera ends where the floor page's own camera starts:
   * the card is 268 wide at 12 from the left, the lift column takes 86 on the right, and the boss's own panel sits beside the lift.
   */
  pageInsets(slug) {
    const owner = session.floor?.slug === slug, w = this.w, h = this.h;
    if (w <= 760) return { left: 0, right: 0, top: 58, bottom: (owner ? h * 0.54 : 104) + 44 };
    return { left: Math.min(w * 0.3, 286), right: Math.min(w * 0.42, owner ? 86 + Math.min(420, Math.max(340, w * 0.27)) + 6 : 82), top: 20, bottom: 56 };
  }
  /**
   * Rides to a floor, builds it if it isn't yet, and flies into it; the floor page then carries on with the room. A floor that isn't ready
   * within a couple of seconds (a slow line, a slow device) is gone into through the lift doors instead, as from anywhere else: no waiting.
   */
  async flyInto(n) {
    const s = this.byNumber.get(n);
    if (!s || s.kind !== 'company' || this.flight) return;
    this.rideTo(s.k);
    const ticket = this.flyTicket = (this.flyTicket || 0) + 1;  // a swipe or the wheel meanwhile calls it off
    const giveUp = performance.now() + 2500, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let f = this.full.get(s.k);
    if (!f) { while (this.building != null && performance.now() < giveUp) await wait(30); if (!this.full.has(s.k) && this.building == null) await this.buildFloor(s.k); f = this.full.get(s.k); }
    // A floor still being put together finishes first: a flight into stand-ins would land on a room changing under the camera.
    if (f) { f.pinned = true; while (!f.ready && !this.dead && performance.now() < giveUp) await wait(40); }
    if (this.dead || this.flight || ticket !== this.flyTicket) { if (f && ticket !== this.flyTicket) f.pinned = false; return; }
    if (!f?.ready) { if (f) f.pinned = false; this.onEnter?.(s.card, { seamless: false }); return; }
    const pose = f.view.homePose(this.w, this.h, this.pageInsets(s.card.slug));
    const to = pose.position.clone().add(new THREE.Vector3(0, slotY(s.k), 0));
    this.flight = { kind: 'in', f, ground: slotY(s.k) + pageGround(n), t: 0, dur: reduced() ? 0.35 : 1.45, from: { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone(), view: { ...this.camera.view } }, to: { pos: to, quat: pose.quaternion.clone(), view: pose.view }, pose };
    this.U.uLiftFrom.value = s.k + 0.5;
    try { sessionStorage.setItem(SPOT_KEY, JSON.stringify({ n, yaw: this.targetYaw, zoom: Math.max(1, this.targetZoom) })); } catch { /* private mode */ }
    document.body.classList.add('tower-flying');
  }
  /** Back from a floor page: the same room, in its place in the stack, and the camera flying out from where the floor page left it. */
  flyOutOf(h) {
    const s = this.byNumber.get(h.number);
    if (!s || s.kind !== 'company' || s.card.slug !== h.slug) { h.view.destroy(); return false; }
    const old = this.full.get(s.k); if (old) this.dropFloor(old);
    const view = h.view;
    view.demote(this);
    this.place(view, s.k, h.state);
    for (const a of view.actors.values()) this.labels.append(a.tag);
    const f = { slot: s, view, state: h.state, show: 1, ready: true, lastId: h.state?.lastEventId, pinned: true };
    view.root.visible = true; this.fade[s.k] = 0; this.full.set(s.k, f);
    const lift = 150;
    this.U.uLiftFrom.value = s.k + 0.5; this.U.uLift.value = lift;
    this.U.uRide.value = s.k;
    for (const g of this.full.values()) g.view.root.position.y = slotY(g.slot.k) + this.offsetOf(g.slot.k);
    // Out to the same spot the camera flew in from, when it came from here.
    let spot = null; try { spot = JSON.parse(sessionStorage.getItem(SPOT_KEY) || 'null'); } catch { /* private mode */ }
    this.ride = this.target = s.k; this.targetYaw = this.yaw = spot?.n === h.number && spot.yaw !== undefined ? spot.yaw : this.yaw;
    if (spot?.n === h.number && spot.zoom) this.zoom = this.targetZoom = Math.min(this.zMax, spot.zoom);
    const from = { pos: h.camera.position.clone().add(new THREE.Vector3(0, slotY(s.k), 0)), quat: h.camera.quaternion.clone(), view: { ...h.camera.view } };
    this.placeCamera();
    this.flight = { kind: 'out', f, ground: slotY(s.k) + pageGround(s.n), t: 0, dur: reduced() ? 0.35 : 1.3, from, to: null };
    this.camera.position.copy(from.pos); this.camera.quaternion.copy(from.quat);
    return true;
  }
  updateFlight(dt) {
    const fl = this.flight; fl.t = Math.min(1, fl.t + dt / fl.dur);
    const e = fl.t < 0.5 ? 4 * fl.t ** 3 : 1 - (-2 * fl.t + 2) ** 3 / 2;
    const c = this.camera;
    if (fl.kind === 'out') {
      // Out: the tower's own framing is where the camera lands; the floors above come back down as it pulls away.
      this.placeCamera();
      const to = { pos: c.position.clone(), quat: c.quaternion.clone(), view: { ...c.view } };
      this.orbitLerp(fl.from.pos, to.pos, e, c.position); c.quaternion.slerpQuaternions(fl.from.quat, to.quat, e);
      this.lerpView(fl.from.view, to.view, e);
      this.setLift(150 * (1 - e) ** 2);
      this.world.group.position.y = fl.ground * (1 - e);
      if (fl.t >= 1) { this.flight = null; fl.f.pinned = false; this.U.uLiftFrom.value = 1e6; this.setLift(0); document.body.classList.remove('tower-flying'); }
      return;
    }
    this.orbitLerp(fl.from.pos, fl.to.pos, e, c.position); c.quaternion.slerpQuaternions(fl.from.quat, fl.to.quat, e);
    this.lerpView(fl.from.view, fl.to.view, e);
    this.setLift(150 * e * e);
    // The city comes up to where the floor page has it under this floor, so the landing and the floor page share a background too.
    this.world.group.position.y = fl.ground * e;
    if (fl.t >= 1 && !fl.done) { fl.done = true; this.handIn(fl); }
  }
  /** From one camera spot to another round the tower's axis, not through it: a flight from behind a floor swings round to its front. */
  orbitLerp(a, b, e, out) {
    const ya = Math.atan2(a.x, a.z), yb = Math.atan2(b.x, b.z), d = ((yb - ya + Math.PI) % TAU + TAU) % TAU - Math.PI;
    if (Math.abs(d) < 0.2) return out.lerpVectors(a, b, e);
    const ra = Math.hypot(a.x, a.z), rb = Math.hypot(b.x, b.z), yy = ya + d * e, r = ra + (rb - ra) * e;
    return out.set(Math.sin(yy) * r, a.y + (b.y - a.y) * e, Math.cos(yy) * r);
  }
  lerpView(a, b, e) {
    const c = this.camera;
    c.setViewOffset(this.w, this.h, a.offsetX + (b.offsetX - a.offsetX) * e, a.offsetY + (b.offsetY - a.offsetY) * e, this.w, this.h);
    c.updateProjectionMatrix();
  }
  setLift(v) {
    this.U.uLift.value = v;
    for (const g of this.full.values()) g.view.root.position.y = slotY(g.slot.k) + this.offsetOf(g.slot.k);
  }
  /** The flight has landed: this frame is held on screen while the floor page takes the room, then fades into it. */
  handIn(fl) {
    const f = fl.f, card = f.slot.card;
    if (this.dead) return;
    stage.afterRender = () => {
      stage.freezeFrame();
      this.quiet(f); this.full.delete(f.slot.k);
      f.view.promote(fl.pose);
      handOver('in', card.slug, { view: f.view });
      this.onEnter?.(card, { seamless: true });
    };
  }

  // ---------- the stage's view interface ----------

  /** Nothing moving but the people: the stage may draw every other frame. */
  idle() {
    return !this.flight && !this.drag && !this.pinch && this.stillFor > 3 && this.building == null && !this.turns.length
      && Math.abs(this.targetZoom - this.zoom) < 1e-3 && Math.abs(this.targetYaw - this.yaw) < 1e-3 && [...this.full.values()].every((f) => f.ready && (f.show === 0 || f.show === 1));
  }

  enter() {
    this.active = true;
    const w = this.world; this.scene.add(w.group); w.group.scale.setScalar(WS); w.group.position.set(0, this.flight?.kind === 'out' ? this.flight.ground : 0, 0);
    w.setDetail((stage.q?.density ?? 1) >= 0.6);
    const r = stage.renderer; r.shadowMap.enabled = this.sun.castShadow; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true; r.toneMappingExposure = 0.92;
    document.body.append(this.plaqueRoot, this.ctrl);
    CUT.uCutOn.value = 1;  // the walls facing the camera are cut away (cutaway.js)
  }
  /** Outside, or off to a floor page: the real floors stop listening while nobody can see them. */
  leave() {
    this.active = false; this.plaqueRoot.remove(); this.ctrl.remove(); this.pts.clear(); this.pinch = null; this.drag = null;
    for (const f of this.full.values()) { this.quiet(f); for (const a of f.view.actors.values()) { a.tagOff = true; a.tag.style.visibility = 'hidden'; } }
    const r = stage.renderer; r.shadowMap.enabled = false; r.shadowMap.autoUpdate = true;
  }
  resize(w, h) {
    this.w = w; this.h = h; this.camera.aspect = w / h;
    for (const f of this.full.values()) f.view.setSize(w, h);
    if (!this.flight) this.placeCamera();
  }
  /** Fewer real floors on a device that is struggling: the one in the middle and one either side, or the one in the middle alone. */
  setTier(q) {
    const phone = this.w <= 760;
    this.radius = q.post === false || (q.density ?? 1) < 0.6 ? 0 : phone || (q.density ?? 1) < 1 ? 1 : 2;
    this.sun.castShadow = (q.shadow || 0) > 0;
    if (this.sun.castShadow) { this.sun.shadow.mapSize.set(q.shadow, q.shadow); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    if (this.active) { const r = stage.renderer; r.shadowMap.enabled = this.sun.castShadow; r.shadowMap.needsUpdate = true; }
    this.world?.setDetail((q.density ?? 1) >= 0.6);
    for (const f of this.full.values()) f.view.setTier(q);
  }
  update(dt) {
    if (this.dead) return;
    this.time += dt;
    this.world.update(dt, this.time);
    this.snapWheel();
    const moving = !!this.drag || !!this.pinch || !!this.flight || this.wheeling || Math.abs(this.target - this.ride) > 0.02;
    this.stillFor = moving ? 0 : this.stillFor + dt;
    if (this.turns.length && this.stillFor > 0.12) this.turns.shift()();
    if (this.flight) this.updateFlight(dt);
    else {
      // Wheel and keys ease; a flick glides further and slower, then settles on its floor.
      const k = 1 - Math.exp(-dt * (this.drag ? 30 : this.glide ? 4.2 : 9));
      if (!this.drag) this.ride += (this.target - this.ride) * k;
      if (this.glide && Math.abs(this.target - this.ride) < 0.002) this.glide = false;
      // Turning and zooming ease out with a little damping; the turn goes all the way round.
      this.yaw += (this.targetYaw - this.yaw) * (1 - Math.exp(-dt * 6));
      this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-dt * 7));
      if (Math.abs(this.targetZoom - this.zoom) < 1e-4) this.zoom = this.targetZoom;
      this.placeCamera();
    }
    this.U.uRide.value = this.ride;
    if (!this.flight) for (const g of this.full.values()) g.view.root.position.y = slotY(g.slot.k) + this.offsetOf(g.slot.k);
    // The sun follows the floor in the middle, so every room in view is lit the way its floor page lights it.
    const y = this.rideY();
    this.sun.position.copy(SUN_DIR).multiplyScalar(64).add(this.v.set(0, y, 0)); this.sun.target.position.set(0, y, 0); this.sun.target.updateMatrixWorld();
    this.manage(dt);
    // The slab edge that faces the camera: plaques sit on it, and a tag behind the one above is put away.
    const cx = this.camera.position.x, cz = this.camera.position.z;
    this.edge = Math.abs(cz) >= Math.abs(cx) ? [0, Math.sign(cz) || 1] : [Math.sign(cx), 0];
    if (this.wholeBtn) { const whole = this.targetZoom < 0.95; if (this.wholeBtn.dataset.on !== String(whole)) { this.wholeBtn.dataset.on = String(whole); this.wholeBtn.textContent = whole ? 'Back to the floor' : 'Whole building'; } }
    const c = Math.round(this.ride), phone = this.w <= 760, tags = new Map();
    for (const f of this.full.values()) {
      if (!f.view.root.visible) continue;
      f.view.tagsOn = !this.flight && this.zoom > 0.7 && Math.abs(f.slot.k - c) <= (phone ? 0 : 1);
      // Where the slab of the floor above meets the open side facing the camera: a tag whose person is behind it is put away.
      f.view.coverY = slotY(f.slot.k + 1) + this.offsetOf(f.slot.k + 1) - 0.6; f.view.coverD = PLATE / 2;
      f.view.update(dt);
      if (f.view.tagsOn) for (const [id, a] of f.view.actors) tags.set(`${f.slot.k}:${id}`, a);
    }
    tidyLabels(tags, this.w);
    this.placePlaques();
  }
  destroy() {
    this.dead = true;
    this.unbind?.();
    for (const r of this.turns.splice(0)) r();  // whatever was waiting carries on, and finds its floor gone (or handed to a floor page)
    for (const f of [...this.full.values()]) this.dropFloor(f);
    for (const m of [...this.stand.children]) { m.removeFromParent(); m.geometry.dispose(); }
    this.mats.sign.map.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    for (const g of Object.values(this.geos)) g.dispose();
    this.scene.remove(this.world.group);
    this.scene.visible = false;  // the stage may still draw it once or twice before the next view arrives
    this.plaqueRoot.remove(); this.ctrl.remove();
    document.body.classList.remove('tower-flying');
  }
}
export { takeHandoff };
