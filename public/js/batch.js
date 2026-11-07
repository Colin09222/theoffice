// Merge static meshes into as few draw calls as possible. This is what keeps a full office smooth on a phone.
// mergeMeshes: meshes that share a material become one mesh (the lobby tower uses this).
// mergeColored: every plain-coloured mesh under a root becomes ONE mesh per shadow setting, with its colour baked into a
// vertex colour attribute and one shared material. A whole room, or a whole limb, is a single draw call.
import * as THREE from '../vendor/three/three.module.min.js';

const inv = new THREE.Matrix4(), m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), col = new THREE.Color();

function pushGeometry(o, pos, nor, idx, uv, colors) {
  m.multiplyMatrices(inv, o.matrixWorld);
  nm.getNormalMatrix(m);
  const g = o.geometry, p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv');
  const base = pos.length / 3;
  const shade = o.userData.shade;  // [yLow, yHigh, factorLow, factorHigh]: a baked vertical gradient, so walls and big slabs read as lit
  if (colors) col.copy(o.material.color);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
    if (colors) {
      let f = 1;
      if (shade) { const t = Math.max(0, Math.min(1, (v.y - shade[0]) / (shade[1] - shade[0]))); f = shade[2] + (shade[3] - shade[2]) * t; }
      colors.push(col.r * f, col.g * f, col.b * f);
    }
    v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
    if (uv) { if (u) uv.push(u.getX(i), u.getY(i)); else uv.push(0, 0); }
  }
  if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
  else for (let i = 0; i < p.count; i++) idx.push(base + i);
}
function build(list, pos, nor, idx, uv, colors, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (uv && uv.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colors) geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(idx);
  const merged = new THREE.Mesh(geo, material);
  merged.castShadow = list[0].castShadow; merged.receiveShadow = list[0].receiveShadow;
  merged.userData.merged = true;
  return merged;
}

export function mergeMeshes(root, keep = () => false) {
  root.updateMatrixWorld(true);
  inv.copy(root.matrixWorld).invert();
  const groups = new Map();
  root.traverse((o) => {
    if (o === root || !o.isMesh || o.isInstancedMesh || o.material.transparent || o.material.map || keep(o)) return;
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const pos = [], nor = [], idx = [];
    for (const o of list) pushGeometry(o, pos, nor, idx, null, null);
    const merged = build(list, pos, nor, idx, null, null, list[0].material);
    for (const o of list) o.removeFromParent();
    root.add(merged);
  }
}

/**
 * Bake every plain-coloured mesh under `root` into one vertex-coloured mesh per cast/receive combination, drawn with `material`
 * (a material with vertexColors on). Meshes with a map, transparency, or that `keep` returns true for stay as they are, except
 * that mapped meshes sharing a material are merged with each other (UVs kept).
 */
export function mergeColored(root, material, keep = () => false) {
  root.updateMatrixWorld(true);
  inv.copy(root.matrixWorld).invert();
  const plain = new Map(), mapped = new Map();
  root.traverse((o) => {
    if (o === root || !o.isMesh || o.isInstancedMesh || !o.visible || keep(o) || o.userData.keep) return;
    const mt = o.material;
    if (mt.transparent || mt.map || mt.emissive?.getHex?.() || mt.vertexColors || !mt.color) {
      if (mt.map && !mt.transparent) { const k = `${mt.uuid}|${o.castShadow}|${o.receiveShadow}`; if (!mapped.has(k)) mapped.set(k, []); mapped.get(k).push(o); }
      return;
    }
    const key = `${o.castShadow}|${o.receiveShadow}`;
    if (!plain.has(key)) plain.set(key, []);
    plain.get(key).push(o);
  });
  for (const list of plain.values()) {
    const pos = [], nor = [], idx = [], colors = [];
    for (const o of list) pushGeometry(o, pos, nor, idx, null, colors);
    const merged = build(list, pos, nor, idx, null, colors, material);
    for (const o of list) o.removeFromParent();
    root.add(merged);
  }
  for (const list of mapped.values()) {
    if (list.length < 2) continue;
    const pos = [], nor = [], idx = [], uv = [];
    for (const o of list) pushGeometry(o, pos, nor, idx, uv, null);
    const merged = build(list, pos, nor, idx, uv, null, list[0].material);
    for (const o of list) o.removeFromParent();
    root.add(merged);
  }
}

export function disposeMerged(root) {
  root.traverse((o) => { if (o.userData?.merged) o.geometry.dispose(); });
}
