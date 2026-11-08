// Packs Quaternius's Ultimate Modular Men and Women (CC0) for the wire: every person becomes one skinned mesh on a 22-bone rig, with the
// colour of each part held as a role (skin, hair, top, legs...) instead of a material, so one draw call and one material dress anyone.
// Finger bones fold into the wrist, the walk and idle clips go in one shared file, and normals, skin weights and clip rotations are small integers.
//
// Usage: node scripts/pack-people.mjs <folder of the men's .gltf> <folder of the women's .gltf> <output folder>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from '../public/vendor/three/three.module.min.js';

const [, , MEN, WOMEN, OUT] = process.argv;
if (!OUT) { console.error('usage: pack-people <men> <women> <out>'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

// Each of the twelve people the character builder offers: the source file and what every material on it is. `[low, y, high]` splits a material at a height.
const BODIES = {
  'male-a': ['M', 'Casual_2', { Skin: 'skin', Skin_Darker: 'skinDark', LightBrown: 'top', LightBlue: 'legs', Red_Dark: 'shoes', White: 'sole', Hair: 'hair', Eyebrows: 'brow', Eye: 'eye' }],
  'male-b': ['M', 'Casual_Hoodie', { Skin: 'skin', Purple: ['shoes', 0.22, 'top'], LightBlue: 'legs', White: 'sole', Hair: 'hair', Eyebrows: 'brow', Eye: 'eye' }],
  'male-c': ['M', 'Farmer', { Skin: 'skin', LightBlue: 'top', Brown: ['shoes', 0.3, 'shirt'], Brown2: 'sole', Beige: 'fixed', Red: 'accent', Eyebrows: 'brow', Eye: 'eye' }],
  'male-d': ['M', 'Suit', { Skin: 'skin', Suit: 'top', White: 'shirt', Tie: 'accent', Black: ['shoes', 0.3, 'dark'], DarkBrown: 'dark', Grey: 'dark', Hair: 'hair', Eyebrows: 'brow', Eye: 'eye' }],
  'male-e': ['M', 'Worker', { Skin: 'skin', Worker_Vest: 'top', LightBrown: 'shirt', Brown: 'legs', Brown2: 'dark', Worker_Yellow: 'fixed', Grey: 'shoes', Black: 'sole', Moustache: 'hair', Eyebrows: 'brow', Eye: 'eye' }],
  'male-f': ['M', 'Punk', { Skin: 'skin', White: 'shirt', Black: ['shoes', 0.3, 'top'], LightBlue: 'legs', Red: 'hair', Red_Dark: 'hair', Earrings: 'fixed', Eyebrows: 'brow', Eye: 'eye' }],
  'female-a': ['F', 'Casual', { Skin: 'skin', White: 'top', Orange: 'legs', Grey: 'shoes', Hair_Blond: 'hair', Hair_Brown: 'brow', Brown: 'eye' }],
  'female-b': ['F', 'Formal', { Skin: 'skin', Red: ['shoes', 1.5, 'hair'], LimeGreen: 'top', Gold: 'fixed', Brown: 'eye' }],
  'female-c': ['F', 'Worker', { Skin: 'skin', Worker_Vest: 'top', White: 'shirt', Worker_Yellow: 'fixed', Black: 'shoes', DarkBrown: 'hair', Brown_02: 'legs', Brown2: 'dark', Brown: 'eye' }],
  'female-d': ['F', 'Suit', { Skin: 'skin', Black: ['shoes', 0.22, 'top'], White: 'shirt', Hair_Blond: 'hair', Hair_Brown: 'brow', Brown: 'eye' }],
  'female-e': ['F', 'Adventurer', { Skin: 'skin', LightGreen: 'top', Green: 'dark', White: 'shirt', Brown2: 'shoes', Gold: 'fixed', Brown_02: 'legs', Hair_Brown: 'hair', Brown: 'eye' }],
  'female-f': ['F', 'Punk', { Skin: 'skin', Pink: ['top', 1.6, 'hair'], Black: ['shoes', 0.3, 'legs'], Grey: 'sole', Hair_Brown: 'brow', Brown: 'eye' }],
};
// The roles a vertex can have, in slot order. `skinDark` is a shadow on the face, kept relative to the skin; `dark`, `sole` and `fixed` keep the model's own colour.
const ROLES = ['skin', 'skinDark', 'hair', 'brow', 'eye', 'top', 'legs', 'shirt', 'accent', 'shoes', 'sole', 'dark', 'fixed'];
const CLIPS = ['Idle_Neutral', 'Walk', 'Interact', 'Wave'];
// The rig the app poses: everything else (fingers, IK helpers) folds into its nearest kept ancestor.
const KEEP = new Set(['Root', 'Body', 'Hips', 'Abdomen', 'Torso', 'Chest', 'Neck', 'Head',
  'Shoulder.L', 'UpperArm.L', 'LowerArm.L', 'Wrist.L', 'Shoulder.R', 'UpperArm.R', 'LowerArm.R', 'Wrist.R',
  'UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R']);
// What a source model carries in its hand rather than wears: left out, so nobody sits at a desk holding it.
const HELD = { 'male-d': ['Cube.204'] };
const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMP_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function reader(j) {
  const buf = Buffer.from(j.buffers[0].uri.split(',')[1], 'base64');
  return (i) => {
    const a = j.accessors[i], v = j.bufferViews[a.bufferView], n = COMP[a.type], sz = COMP_BYTES[a.componentType];
    const stride = v.byteStride || n * sz, off = (v.byteOffset || 0) + (a.byteOffset || 0), out = new Array(a.count * n);
    const rd = { 5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = buf[rd](off + k * stride + c * sz);
    return out;
  };
}
const glbParts = () => {
  const chunks = []; let len = 0;
  const views = [];
  const add = (buf, target) => {
    if (len % 4) { const pad = Buffer.alloc(4 - (len % 4)); chunks.push(pad); len += pad.length; }
    views.push({ buffer: 0, byteOffset: len, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf); len += buf.length;
    return views.length - 1;
  };
  return { add, views, bin: () => Buffer.concat(chunks), get len() { return len; } };
};
function writeGlb(path, json, bin) {
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  const pad = bin.length % 4 ? Buffer.alloc(4 - (bin.length % 4)) : Buffer.alloc(0);
  const body = Buffer.concat([bin, pad]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + text.length + 8 + body.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(text.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(body.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([head, jh, text, bh, body]));
}

/** Parents and the bind pose of the kept bones, from the file's inverse bind matrices. */
function skeletonOf(j, read) {
  const parent = new Array(j.nodes.length).fill(-1);
  j.nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  const skin = j.skins[0], ibm = read(skin.inverseBindMatrices);
  const world = new Map();
  skin.joints.forEach((node, i) => { world.set(node, new THREE.Matrix4().fromArray(ibm, i * 16).invert()); });
  return { parent, skin, world };
}

function packBody(name, [gender, file, roles]) {
  const dir = gender === 'M' ? MEN : WOMEN;
  const j = JSON.parse(readFileSync(join(dir, `${file}.gltf`), 'utf8'));
  const read = reader(j), { parent, skin, world } = skeletonOf(j, read);
  const nodeName = (i) => j.nodes[i].name;
  const keptAncestor = (node) => { let n = node; while (n >= 0 && !KEEP.has(nodeName(n))) n = parent[n]; if (n < 0) throw new Error(`no kept ancestor for ${nodeName(node)}`); return n; };
  // Kept bones in hierarchy order, each carrying its local bind pose, then the mesh node.
  const armatureRoot = j.nodes.findIndex((n) => n.name === 'CharacterArmature');
  const order = [], seen = new Set();
  const visit = (i) => { if (KEEP.has(nodeName(i)) && !seen.has(i)) { seen.add(i); order.push(i); } for (const c of j.nodes[i].children || []) visit(c); };
  visit(armatureRoot);
  const outIndex = new Map(order.map((n, k) => [n, k]));
  const nodes = order.map((n) => {
    const local = new THREE.Matrix4();
    const p = parent[n];
    if (world.has(p)) local.copy(world.get(p)).invert().multiply(world.get(n)); else local.copy(world.get(n));
    const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    local.decompose(t, q, s);
    return { name: nodeName(n), translation: t.toArray(), rotation: q.toArray(), children: [] };
  });
  order.forEach((n, k) => { const p = parent[n]; if (outIndex.has(p)) nodes[outIndex.get(p)].children.push(k); });
  nodes.forEach((n) => { if (!n.children.length) delete n.children; });

  // Merge every primitive into one, marking each vertex with its role.
  const pos = [], nor = [], jnt = [], wgt = [], slot = [], idx = [];
  const palette = {};
  const toNew = new Map(skin.joints.map((node, i) => [i, order.indexOf(keptAncestor(node))]));
  for (const m of j.meshes) if (!HELD[name]?.includes(m.name)) for (const p of m.primitives) {
    const matName = j.materials[p.material].name;
    let role = roles[matName];
    if (role === undefined) throw new Error(`${file}: material ${matName} has no role`);
    const color = (j.materials[p.material].pbrMetallicRoughness?.baseColorFactor || [1, 1, 1]).slice(0, 3);
    const P = read(p.attributes.POSITION), N = read(p.attributes.NORMAL), J = read(p.attributes.JOINTS_0), W = read(p.attributes.WEIGHTS_0);
    const I = p.indices != null ? read(p.indices) : Array.from({ length: P.length / 3 }, (_, i) => i);
    const base = pos.length / 3;
    const count = P.length / 3;
    for (let v = 0; v < count; v++) {
      pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
      // Weights folded to the kept bones, the four strongest kept, summing to exactly 255.
      const acc = new Map();
      for (let b = 0; b < 4; b++) { const nb = toNew.get(J[v * 4 + b]); acc.set(nb, (acc.get(nb) || 0) + W[v * 4 + b]); }
      const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
      const bytes = top.map(([, w]) => Math.round((w / sum) * 255));
      bytes[0] += 255 - bytes.reduce((s, b) => s + b, 0);
      for (let b = 0; b < 4; b++) { jnt.push(top[b]?.[0] ?? 0); wgt.push(bytes[b] ?? 0); }
      const r = Array.isArray(role) ? (P[v * 3 + 1] < role[1] ? role[0] : role[2]) : role;
      const s = ROLES.indexOf(r);
      if (s < 0) throw new Error(`${file}: unknown role ${r}`);
      slot.push(s);
      palette[r] ||= { hex: `#${new THREE.Color().setRGB(color[0], color[1], color[2], THREE.LinearSRGBColorSpace).getHexString(THREE.SRGBColorSpace)}` };
    }
    for (const i of I) idx.push(base + i);
  }
  // The kit is flat-shaded, so its vertices come three to a triangle. Weld them, drop the normals, and let the shader work out each facet.
  const remap = new Map(), wPos = [], wJnt = [], wWgt = [], wSlot = [];
  const keyOf = (v) => `${Math.round(pos[v * 3] * 4000)},${Math.round(pos[v * 3 + 1] * 4000)},${Math.round(pos[v * 3 + 2] * 4000)}|${slot[v]}|${jnt.slice(v * 4, v * 4 + 4)}|${wgt.slice(v * 4, v * 4 + 4)}`;
  const newIndex = [];
  for (let v = 0; v < pos.length / 3; v++) {
    const k = keyOf(v);
    let n = remap.get(k);
    if (n === undefined) { n = wPos.length / 3; remap.set(k, n); wPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); for (let b = 0; b < 4; b++) { wJnt.push(jnt[v * 4 + b]); wWgt.push(wgt[v * 4 + b]); } wSlot.push(slot[v]); }
    newIndex.push(n);
  }
  const wIdx = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = newIndex[idx[i]], b = newIndex[idx[i + 1]], c = newIndex[idx[i + 2]];
    if (a !== b && b !== c && a !== c) wIdx.push(a, b, c);
  }
  // Write it as one skinned mesh, in full and as a coarse copy for the rooms far down the tower.
  const emit = (fileName, wPos, wJnt, wWgt, wSlot, wIdx) => {
  const g = glbParts();
  const vc = wPos.length / 3, tris = wIdx.length / 3;
  const posBuf = Buffer.alloc(vc * 12), jntBuf = Buffer.alloc(vc * 4), wgtBuf = Buffer.alloc(vc * 4), slotBuf = Buffer.alloc(vc * 4);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < vc; v++) {
    for (let c = 0; c < 3; c++) { const x = wPos[v * 3 + c]; posBuf.writeFloatLE(x, v * 12 + c * 4); min[c] = Math.min(min[c], x); max[c] = Math.max(max[c], x); }
    for (let b = 0; b < 4; b++) { jntBuf.writeUInt8(wJnt[v * 4 + b], v * 4 + b); wgtBuf.writeUInt8(wWgt[v * 4 + b], v * 4 + b); }
    slotBuf.writeUInt8(wSlot[v], v * 4);
  }
  const idxBuf = Buffer.alloc(wIdx.length * 2);
  wIdx.forEach((v, i) => idxBuf.writeUInt16LE(v, i * 2));
  const ibm = read(skin.inverseBindMatrices);
  const keptIbm = Buffer.alloc(order.length * 64);
  order.forEach((n, k) => {
    const i = skin.joints.indexOf(n);
    for (let c = 0; c < 16; c++) keptIbm.writeFloatLE(ibm[i * 16 + c], k * 64 + c * 4);
  });
  const accessors = [];
  const acc = (view, ctype, count, type, extra = {}) => { accessors.push({ bufferView: view, componentType: ctype, count, type, ...extra }); return accessors.length - 1; };
  const aPos = acc(g.add(posBuf, 34962), 5126, vc, 'VEC3', { min, max });
    const aJnt = acc(g.add(jntBuf, 34962), 5121, vc, 'VEC4');
  const aWgt = acc(g.add(wgtBuf, 34962), 5121, vc, 'VEC4', { normalized: true });
  const aSlot = acc(g.add(slotBuf, 34962), 5121, vc, 'VEC4');
  const aIdx = acc(g.add(idxBuf, 34963), 5123, wIdx.length, 'SCALAR');
  const aIbm = acc(g.add(keptIbm), 5126, order.length, 'MAT4');
  const meshNode = { name: 'person', mesh: 0, skin: 0 };
  const allNodes = [...nodes, meshNode];
  const roots = [order.findIndex((n) => parent[n] === armatureRoot || !outIndex.has(parent[n]))];
  const json = {
    asset: { version: '2.0', generator: 'pack-people.mjs' },
    scene: 0, scenes: [{ nodes: [...roots, allNodes.length - 1] }], nodes: allNodes,
    meshes: [{ name: 'person', primitives: [{ attributes: { POSITION: aPos, JOINTS_0: aJnt, WEIGHTS_0: aWgt, _SLOT: aSlot }, indices: aIdx }] }],
    skins: [{ joints: order.map((n, k) => k), inverseBindMatrices: aIbm }],
    accessors, bufferViews: g.views, buffers: [{ byteLength: g.len }],
    extras: { palette, roles: ROLES, tris },
  };
  writeGlb(join(OUT, `${fileName}.glb`), json, g.bin());
  return { vc, tris };
  };
  const full = emit(name, wPos, wJnt, wWgt, wSlot, wIdx);
  // The coarse copy: vertices snapped to a grid cell by cell (one cell per role, so colours keep their edges), about 1400 triangles.
  const collapse = (cell) => {
    const map = new Map(), P = [], J = [], W = [], S = [], n = [], back = new Int32Array(wPos.length / 3);
    for (let v = 0; v < wPos.length / 3; v++) {
      const key = `${Math.floor(wPos[v * 3] / cell)},${Math.floor(wPos[v * 3 + 1] / cell)},${Math.floor(wPos[v * 3 + 2] / cell)},${wSlot[v]}`;
      let c = map.get(key);
      if (c === undefined) { c = P.length / 3; map.set(key, c); P.push(0, 0, 0); for (let b = 0; b < 4; b++) { J.push(wJnt[v * 4 + b]); W.push(wWgt[v * 4 + b]); } S.push(wSlot[v]); n.push(0); }
      P[c * 3] += wPos[v * 3]; P[c * 3 + 1] += wPos[v * 3 + 1]; P[c * 3 + 2] += wPos[v * 3 + 2]; n[c]++; back[v] = c;
    }
    for (let c = 0; c < n.length; c++) for (let a = 0; a < 3; a++) P[c * 3 + a] /= n[c];
    const I = [], seen = new Set();
    for (let t = 0; t < wIdx.length; t += 3) {
      const a = back[wIdx[t]], b = back[wIdx[t + 1]], c = back[wIdx[t + 2]];
      if (a === b || b === c || a === c) continue;
      const k = [a, b, c].sort((x, y) => x - y).join(',');
      if (seen.has(k)) continue;
      seen.add(k); I.push(a, b, c);
    }
    return { P, J, W, S, I };
  };
  let lo = 0.012, hi = 0.14, best = collapse(hi);
  for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2, c = collapse(mid); if (c.I.length / 3 > 1500) lo = mid; else { hi = mid; best = c; } }
  const far = emit(`${name}-far`, best.P, best.J, best.W, best.S, best.I);
  return { ...full, farTris: far.tris };
}

/** The clips, once, for everybody: every bone sampled at 15 frames a second, rotations as small integers, a translation only where a bone really moves. */
function packClips() {
  const j = JSON.parse(readFileSync(join(MEN, 'Suit.gltf'), 'utf8'));
  const read = reader(j), { parent, world } = skeletonOf(j, read);
  const nodeName = (i) => j.nodes[i].name;
  const armatureRoot = j.nodes.findIndex((n) => n.name === 'CharacterArmature');
  const order = [], seen = new Set();
  const visit = (i) => { if (KEEP.has(nodeName(i)) && !seen.has(i)) { seen.add(i); order.push(i); } for (const c of j.nodes[i].children || []) visit(c); };
  visit(armatureRoot);
  const outIndex = new Map(order.map((n, k) => [n, k]));
  const nodes = order.map((n) => {
    const local = new THREE.Matrix4();
    const p = parent[n];
    if (world.has(p)) local.copy(world.get(p)).invert().multiply(world.get(n)); else local.copy(world.get(n));
    const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    local.decompose(t, q, s);
    return { name: nodeName(n), translation: t.toArray(), rotation: q.toArray(), children: [] };
  });
  order.forEach((n, k) => { const p = parent[n]; if (outIndex.has(p)) nodes[outIndex.get(p)].children.push(k); });
  nodes.forEach((n) => { if (!n.children.length) delete n.children; });
  const g = glbParts(), accessors = [], animations = [];
  const acc = (view, ctype, count, type, extra = {}) => { accessors.push({ bufferView: view, componentType: ctype, count, type, ...extra }); return accessors.length - 1; };
  const sampleTrack = (times, values, n, t) => {
    if (t <= times[0]) return values.slice(0, n);
    for (let i = 1; i < times.length; i++) if (t <= times[i]) {
      const a = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
      const out = [];
      if (n === 4) {
        const q0 = new THREE.Quaternion().fromArray(values, (i - 1) * 4), q1 = new THREE.Quaternion().fromArray(values, i * 4);
        return q0.slerp(q1, a).toArray();
      }
      for (let c = 0; c < n; c++) out.push(values[(i - 1) * n + c] + (values[i * n + c] - values[(i - 1) * n + c]) * a);
      return out;
    }
    return values.slice((times.length - 1) * n, times.length * n);
  };
  for (const name of CLIPS) {
    const an = j.animations.find((a) => a.name === name);
    let dur = 0;
    for (const s of an.samplers) dur = Math.max(dur, j.accessors[s.input].max[0]);
    const FPS = 15, N = Math.round(dur * FPS) + 1;
    const times = Array.from({ length: N }, (_, i) => (i / (N - 1)) * dur);
    const timeBuf = Buffer.alloc(N * 4); times.forEach((t, i) => timeBuf.writeFloatLE(t, i * 4));
    const aInput = acc(g.add(timeBuf), 5126, N, 'SCALAR', { min: [0], max: [dur] });
    const samplers = [], channels = [];
    for (const c of an.channels) {
      const node = c.target.node;
      if (!outIndex.has(node)) continue;
      const path = c.target.path;
      if (path === 'scale') continue;
      const samp = an.samplers[c.sampler];
      const T = read(samp.input), V = read(samp.output), n = path === 'rotation' ? 4 : 3;
      const vals = [];
      for (const t of times) vals.push(...sampleTrack(T, V, n, t));
      if (path === 'translation') {
        // Bones that only ever sit at their bind offset need no track at all.
        const bind = nodes[outIndex.get(node)].translation;
        let moved = 0;
        for (let k = 0; k < N; k++) for (let a = 0; a < 3; a++) moved = Math.max(moved, Math.abs(vals[k * 3 + a] - bind[a]));
        if (moved < 0.002) continue;
        // A walk stays on the spot: the actor moves the person, so nothing but the hips' bob and sway may drift the root forward.
        if (nodeName(node) === 'Root') continue;
        const b = Buffer.alloc(N * 12); vals.forEach((x, i) => b.writeFloatLE(x, i * 4));
        samplers.push({ input: aInput, output: acc(g.add(b), 5126, N, 'VEC3'), interpolation: 'LINEAR' });
      } else {
        const b = Buffer.alloc(N * 8);
        for (let k = 0; k < N; k++) {
          const q = new THREE.Quaternion().fromArray(vals, k * 4).normalize();
          q.toArray().forEach((x, a) => b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x * 32767))), k * 8 + a * 2));
        }
        samplers.push({ input: aInput, output: acc(g.add(b), 5122, N, 'VEC4', { normalized: true }), interpolation: 'LINEAR' });
      }
      channels.push({ sampler: samplers.length - 1, target: { node: outIndex.get(node), path } });
    }
    animations.push({ name, samplers, channels });
  }
  const json = {
    asset: { version: '2.0', generator: 'pack-people.mjs' }, scene: 0, scenes: [{ nodes: [order.findIndex((n) => !outIndex.has(parent[n]))] }], nodes,
    animations, accessors, bufferViews: g.views, buffers: [{ byteLength: g.len }],
  };
  writeGlb(join(OUT, 'clips.glb'), json, g.bin());
}

let total = 0;
for (const [name, def] of Object.entries(BODIES)) {
  const { vc, tris, farTris } = packBody(name, def);
  const bytes = readFileSync(join(OUT, `${name}.glb`)).length;
  total += bytes; console.log(name.padEnd(10), 'verts', vc, 'tris', tris, 'far', farTris, 'bytes', bytes);
}
packClips();
console.log('clips bytes', readFileSync(join(OUT, 'clips.glb')).length, 'total', total);
