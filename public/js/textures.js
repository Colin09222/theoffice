// CC0 PBR texture sets from Poly Haven and ambientCG (see /assets/NOTICE.txt), lazy-loaded a set at a time. The static server doesn't serve
// .jpg and the page's CSP forbids blob: images, so scripts/pack-textures.mjs wraps each set's JPEGs in a small .glb, and they're read straight
// out of it with createImageBitmap. A set that fails to load simply resolves to null and the procedural stand-in stays.
import * as THREE from '../vendor/three/three.module.min.js';

const BASE = `${location.pathname.startsWith('/theoffice') ? '/theoffice' : ''}/assets/3d/`;
const packs = new Map();

async function readPack(file, opts) {
  const res = await fetch(`${BASE}${file}.glb`);
  if (!res.ok) throw new Error(`texture ${file}: ${res.status}`);
  const buf = await res.arrayBuffer(); const view = new DataView(buf);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const bin = 20 + jsonLen + 8;
  const out = {};
  await Promise.all(json.images.map(async (img) => {
    const v = json.bufferViews[img.bufferView];
    out[img.name] = await createImageBitmap(new Blob([new Uint8Array(buf, bin + v.byteOffset, v.byteLength)], { type: img.mimeType }), opts);
  }));
  return out;
}
const pack = (file, opts) => {
  if (!packs.has(file)) packs.set(file, readPack(file, opts).catch((e) => { console.warn('texture pack unavailable', e); packs.delete(file); return null; }));
  return packs.get(file);
};
/** A texture set: { map, normal?, rough? }, each an ImageBitmap. The normal and roughness maps are a separate download the low tier skips. */
export async function textureSet(name, { pbr = true } = {}) {
  const [base, extra] = await Promise.all([pack(name), pbr ? pack(`${name}-pbr`) : null]);
  return base ? { ...base, ...(extra || {}) } : null;
}
/** The room's reflections and soft light, from a small CC0 panorama. Null if it doesn't load. */
export async function environmentMap(renderer) {
  const p = await pack('env', { imageOrientation: 'flipY' });
  if (!p?.env) return null;
  const tex = new THREE.Texture(p.env); tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  const pm = new THREE.PMREMGenerator(renderer); const rt = pm.fromEquirectangular(tex);
  tex.dispose(); pm.dispose();
  return rt;
}
/** A repeating texture from a bitmap, for the walls. */
export function repeating(bitmap, { color = false, repeat = 1 } = {}) {
  const t = new THREE.Texture(bitmap); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 4;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
