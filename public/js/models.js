// The furniture is Kenney's CC0 kit (see /models/NOTICE.txt), self-hosted under public/models and loaded
// lazily: a floor asks for the pieces it needs, each file is fetched once and gzipped in transit, and every placement is a
// clone of the cached template. Anything that fails to load simply never appears, and the procedural stand-in stays.
import * as THREE from '../vendor/three/three.module.min.js';
import { loadAddons } from './addons.js';

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
  const m = new THREE.MeshStandardMaterial({ color: src.color?.clone() || new THREE.Color('#cccccc'), roughness: 0.82, metalness: 0 });
  m.name = src.name;
  return m;
}
const furnitureCache = new Map();
/** A furniture template: a group with lit materials, positioned so its footprint centre sits at the origin on the floor. */
export async function furniture(name) {
  if (!furnitureCache.has(name)) {
    furnitureCache.set(name, fetchGLTF(`furniture/${name}.glb`).then((gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
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
    const re = (mt) => { if (!(mt.name in tint)) return mt; if (!own.has(mt)) { const c = mt.clone(); c.color.set(tint[mt.name]); own.set(mt, c); } return own.get(mt); };
    g.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(re) : re(o.material); });
  }
  return g;
}

/** True once the addons have loaded and a template is cached, so callers can place synchronously. */
export const cachedFurniture = (name) => furnitureCache.get(name);
