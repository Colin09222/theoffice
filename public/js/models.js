// The furniture is Kenney's CC0 kit and the people Quaternius's (see /models/NOTICE.txt), self-hosted under public/models and loaded
// lazily: a floor asks for the pieces it needs, each file is fetched once and gzipped in transit, and every placement is a
// clone of the cached template. Anything that fails to load simply never appears, and the procedural stand-in stays.
import * as THREE from '../vendor/three/three.module.min.js';
import { loadAddons } from './addons.js';
import { warmFlat } from './toon.js';

const BASE = `${location.pathname.startsWith('/theoffice') ? '/theoffice' : ''}/models/`;
// The server stamps the version of the whole models folder here at start-up (server/statics.js), so these files can be cached for good.
const MODELS_V = '__MODELS_V__';
const files = new Map();
let loader = null;

async function fetchGLTF(path) {
  if (!files.has(path)) {
    files.set(path, loadAddons().then((A) => {
      if (!loader) {
        const manager = new THREE.LoadingManager();
        if (!MODELS_V.startsWith('__')) manager.setURLModifier((u) => (/^(blob|data):/.test(u) ? u : `${u}${u.includes('?') ? '&' : '?'}v=${MODELS_V}`));
        loader = new A.GLTFLoader(manager);
      }
      return new Promise((resolve, reject) => loader.load(BASE + path, resolve, undefined, (e) => reject(new Error(`model ${path}: ${e?.message || 'failed'}`))));
    }).catch((e) => { files.delete(path); throw e; }));
  }
  return files.get(path);
}

/** Kenney's furniture is exported unlit. Each part becomes a lit standard material named after its role, so pieces can be recoloured by role. */
function litMaterial(src) {
  const m = new THREE.MeshStandardMaterial({ color: warmFlat(src.color || '#cccccc'), roughness: 0.82, metalness: 0 });
  m.name = src.name;
  return m;
}
// How much fatter each kit piece is made, in the model's own units (a room unit is 2.5 of them): thin legs and slim tops go chunky so the furniture matches the
// toy-like staff. Things that lie on surfaces or hang on walls stay as they are.
const PUFF = { desk: 0.028, chairDesk: 0.022, chairModernCushion: 0.02, chairRounded: 0.018, tableCross: 0.03, tableRound: 0.024, tableCoffee: 0.02, sideTable: 0.018, sideTableDrawers: 0.012, bookcaseOpen: 0.016, bookcaseOpenLow: 0.014, bookcaseClosed: 0.01, bookcaseClosedWide: 0.01, stoolBar: 0.02, loungeSofa: 0.012, loungeChair: 0.012, loungeChairRelax: 0.012, loungeDesignChair: 0.014, lampRoundFloor: 0.012, lampSquareFloor: 0.012, lampRoundTable: 0.01, coatRackStanding: 0.02, pottedPlant: 0.018, plantSmall1: 0.014, plantSmall2: 0.014, plantSmall3: 0.014, kitchenCabinet: 0.008, kitchenSink: 0.008, kitchenBar: 0.01, kitchenFridgeLarge: 0.008, trashcan: 0.01 };
/** Pushes every corner outward along the average of the faces that meet there. Normals stay as they are, so the flat toon shading stays crisp. */
function puffUp(root, by) {
  root.traverse((o) => {
    if (!o.isMesh || o.geometry.userData.puffed) return;
    const g = o.geometry, p = g.attributes.position, n = g.attributes.normal;
    g.userData.puffed = true;
    if (!n) return;
    const key = (i) => `${Math.round(p.getX(i) * 2000)},${Math.round(p.getY(i) * 2000)},${Math.round(p.getZ(i) * 2000)}`;
    const sum = new Map();
    for (let i = 0; i < p.count; i++) { const k = key(i); let v = sum.get(k); if (!v) sum.set(k, v = [0, 0, 0]); v[0] += n.getX(i); v[1] += n.getY(i); v[2] += n.getZ(i); }
    for (let i = 0; i < p.count; i++) { const [x, y, z] = sum.get(key(i)); const l = Math.hypot(x, y, z) || 1; p.setXYZ(i, p.getX(i) + (x / l) * by, p.getY(i) + (y / l) * by, p.getZ(i) + (z / l) * by); }
    p.needsUpdate = true;
    g.computeBoundingBox(); g.computeBoundingSphere();
  });
}
const furnitureCache = new Map();
/** A furniture template: a group with lit materials, positioned so its footprint centre sits at the origin on the floor. */
export async function furniture(name) {
  if (!furnitureCache.has(name)) {
    furnitureCache.set(name, fetchGLTF(`furniture/${name}.glb`).then((gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      if (PUFF[name]) puffUp(root, PUFF[name]);
      const mats = new Map();
      root.traverse((o) => {
        if (!o.isMesh) return;
        const conv = (mt) => { if (!mats.has(mt)) mats.set(mt, litMaterial(mt)); return mats.get(mt); };
        o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
        o.castShadow = true; o.receiveShadow = true;
      });
      const box = new THREE.Box3().setFromObject(root);
      const tpl = new THREE.Group();
      root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      tpl.add(root);
      tpl.userData.size = box.getSize(new THREE.Vector3());
      return tpl;
    }).catch((e) => { furnitureCache.delete(name); throw e; }));
  }
  return furnitureCache.get(name);
}

/**
 * A copy of a template, placed and scaled. `tint` maps a material role (carpet, wood, metal, plant...) to a colour; tinted
 * parts get their own material so the template stays untouched. The clone shares geometry with the template.
 */
export function place(tpl, { x = 0, y = 0, z = 0, ry = 0, scale = 1, tint = null } = {}) {
  const g = tpl.clone(true);
  g.position.set(x, y, z); g.rotation.y = ry; g.scale.setScalar(scale);
  if (tint) {
    const own = new Map();
    const re = (mt) => { if (!(mt.name in tint)) return mt; if (!own.has(mt)) { const c = mt.clone(); c.color.copy(warmFlat(tint[mt.name])); own.set(mt, c); } return own.get(mt); };
    g.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(re) : re(o.material); });
  }
  return g;
}

// ---------- people ----------

const peopleCache = new Map();
/**
 * One person's template: a skinned mesh with the role of each vertex (skin, hair, top...) in `_slot`, plus the rig, its palette and its
 * bones' bind pose. Variants: male-a .. male-f, female-a .. female-f; `far` picks the coarse copy for floors seen across the tower. Packed by scripts/pack-people.mjs; see /models/NOTICE.txt.
 */
export async function person(variant, { far = false } = {}) {
  const key = far ? `${variant}-far` : variant;
  if (!peopleCache.has(key)) {
    peopleCache.set(key, fetchGLTF(`people/${key}.glb`).then((gltf) => {
      let mesh = null;
      gltf.scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
      const slots = new Uint8Array(mesh.geometry.attributes._slot.count);
      for (let i = 0, a = mesh.geometry.attributes._slot.array; i < slots.length; i++) slots[i] = a[i * 4];
      return { scene: gltf.scene, mesh, slots, extras: gltf.parser.json.extras, variant, far };
    }).catch((e) => { peopleCache.delete(key); throw e; }));
  }
  return peopleCache.get(key);
}
let clips = null;
/** The walk, the idle and the gestures, one file for everyone on the shared rig. */
export const personClips = () => (clips ||= fetchGLTF('people/clips.glb').then((g) => g.animations).catch((e) => { clips = null; throw e; }));

/** True once the addons have loaded and a template is cached, so callers can place synchronously. */
export const cachedFurniture = (name) => furnitureCache.get(name);
export async function skeletonUtils() { return (await loadAddons()).SkeletonUtils; }
