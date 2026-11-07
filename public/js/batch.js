// Merge static meshes that share a material into one draw call. This is what keeps a full office smooth on a phone.
import * as THREE from '../vendor/three/three.module.min.js';

const inv = new THREE.Matrix4(), m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();

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
    for (const o of list) {
      m.multiplyMatrices(inv, o.matrixWorld);
      nm.getNormalMatrix(m);
      const g = o.geometry, p = g.getAttribute('position'), n = g.getAttribute('normal');
      const base = pos.length / 3;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
      else for (let i = 0; i < p.count; i++) idx.push(base + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    const merged = new THREE.Mesh(geo, list[0].material);
    merged.castShadow = list[0].castShadow; merged.receiveShadow = list[0].receiveShadow;
    merged.userData.merged = true;
    for (const o of list) o.removeFromParent();
    root.add(merged);
  }
}

export function disposeMerged(root) {
  root.traverse((o) => { if (o.userData?.merged) o.geometry.dispose(); });
}
