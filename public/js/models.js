// The furniture and the people are Kenney's CC0 kits (see /models/NOTICE.txt), self-hosted under public/models and loaded
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

// ---------- people ----------

/** The colour atlas Kenney's characters share: 8 columns by 4 rows of flat cells, each with a lighter and a darker band. */
export const ATLAS = { cols: 8, rows: 4 };
/** Mean sRGB colour of every atlas cell, read once from the texture, so a tint can replace a cell's colour and keep its shading. */
function cellMeans(image) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d'); x.drawImage(image, 0, 0, 512, 512);
  const d = x.getImageData(0, 0, 512, 512).data;
  const means = [];
  const cw = 512 / ATLAS.cols, ch = 512 / ATLAS.rows;
  for (let r = 0; r < ATLAS.rows; r++) for (let col = 0; col < ATLAS.cols; col++) {
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let py = r * ch + 8; py < (r + 1) * ch - 8; py += 4) for (let px = col * cw + 4; px < (col + 1) * cw - 4; px += 4) {
      const i = (py * 512 + px) * 4; sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++;
    }
    means[r * ATLAS.cols + col] = new THREE.Color(sr / n / 255, sg / n / 255, sb / n / 255).convertSRGBToLinear();
  }
  return means;
}

const charCache = new Map();
/** A character template: the loaded scene (never shown itself), its clips, and the atlas means. Variants: character-male-a .. character-female-f. */
export async function character(variant) {
  if (!charCache.has(variant)) {
    charCache.set(variant, fetchGLTF(`characters/${variant}.glb`).then((gltf) => {
      let map = null;
      gltf.scene.traverse((o) => { if (o.isMesh && o.material?.map) map = o.material.map; });
      const means = map?.image ? cellMeans(map.image) : null;
      return { scene: gltf.scene, animations: gltf.animations, means, map };
    }).catch((e) => { charCache.delete(variant); throw e; }));
  }
  return charCache.get(variant);
}
/** The glasses from the same kit. */
export const accessory = (name) => fetchGLTF(`characters/${name}.glb`).then((g) => g.scene);

/** True once the addons have loaded and a template is cached, so callers can place synchronously. */
export const cachedFurniture = (name) => furnitureCache.get(name);
export async function skeletonUtils() { return (await loadAddons()).SkeletonUtils; }
