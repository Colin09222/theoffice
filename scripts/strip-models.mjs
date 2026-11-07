// Slims the kits for the wire. Each character file carries 32 animation clips, of which the office plays three, and the index of
// that clip data alone is half the file. This keeps idle, walk and sit, drops UVs no material samples, re-packs the binary chunk
// with only what is still referenced, and stores normals, UVs and skin weights in small integers (KHR_mesh_quantization and
// core glTF, read natively by three's loader, no decoder involved). Positions, bones and the look of the model are untouched.
//
// Usage: node scripts/strip-models.mjs public/models/characters/character-*.glb public/models/furniture/*.glb
// Safe to run twice: a stripped file is simply re-packed to the same bytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const KEEP = new Set(['idle', 'walk', 'sit']);
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const SIZES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function readGlb(file) {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen;
  const binLen = binStart < b.length ? b.readUInt32LE(binStart) : 0;
  const bin = binLen ? b.subarray(binStart + 8, binStart + 8 + binLen) : Buffer.alloc(0);
  return { json, bin, size: b.length };
}

function writeGlb(file, json, bin) {
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  const pad = bin.length % 4 ? Buffer.alloc(4 - (bin.length % 4)) : Buffer.alloc(0);
  const body = Buffer.concat([bin, pad]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + text.length + 8 + body.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(text.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(body.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(file, Buffer.concat([head, jh, text, bh, body]));
}

/** Reads an accessor into plain numbers, whatever its component type. */
function readAccessor(json, bin, index) {
  const a = json.accessors[index]; const v = json.bufferViews[a.bufferView];
  const n = COMPONENTS[a.type]; const size = SIZES[a.componentType];
  const stride = v.byteStride || n * size; const start = (v.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Array(a.count * n);
  const read = { 5120: (o) => bin.readInt8(o), 5121: (o) => bin.readUInt8(o), 5122: (o) => bin.readInt16LE(o), 5123: (o) => bin.readUInt16LE(o), 5125: (o) => bin.readUInt32LE(o), 5126: (o) => bin.readFloatLE(o) }[a.componentType];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = read(start + i * stride + c * size);
  return out;
}

function strip(file) {
  const { json, bin, size } = readGlb(file);
  json.animations = (json.animations || []).filter((a) => KEEP.has(a.name));
  if (!json.animations.length) delete json.animations;
  // A material with no texture has no use for UVs. The furniture kit is flat colours throughout.
  for (const m of json.meshes || []) for (const p of m.primitives) if (!json.materials?.[p.material]?.pbrMetallicRoughness?.baseColorTexture) for (const name of Object.keys(p.attributes)) if (name.startsWith('TEXCOORD')) delete p.attributes[name];
  // Everything still referenced: mesh attributes, indices, skins, the three clips.
  const usedAcc = new Set();
  for (const m of json.meshes || []) for (const p of m.primitives) { for (const k of Object.values(p.attributes)) usedAcc.add(k); if (p.indices != null) usedAcc.add(p.indices); }
  for (const s of json.skins || []) if (s.inverseBindMatrices != null) usedAcc.add(s.inverseBindMatrices);
  for (const a of json.animations || []) for (const s of a.samplers) { usedAcc.add(s.input); usedAcc.add(s.output); }
  // Small integers for the attributes that don't need floats. Each becomes its own tightly packed run of bytes.
  const quant = new Map();
  const words = (n, bytes, comp, normalized, type, values, extra = {}) => ({ n, bytes, comp, normalized, type, values, ...extra });
  for (const m of json.meshes || []) for (const p of m.primitives) {
    for (const [name, k] of Object.entries(p.attributes)) {
      const a = json.accessors[k]; if (a.componentType !== 5126 || quant.has(k)) continue;
      const vals = readAccessor(json, bin, k);
      if (name === 'NORMAL') quant.set(k, words(a.count, 4, 5120, true, 'VEC3', vals.map((v) => clamp(Math.round(v * 127), -127, 127))));
      else if (name.startsWith('TEXCOORD')) quant.set(k, words(a.count, 4, 5123, true, 'VEC2', vals.map((v) => clamp(Math.round(v * 65535), 0, 65535))));
      else if (name.startsWith('WEIGHTS')) {
        // Rounded weights must still sum to exactly 255 per vertex, so the largest takes up the slack.
        const ints = [];
        for (let i = 0; i < a.count; i++) { const w = vals.slice(i * 4, i * 4 + 4).map((v) => Math.round(v * 255)); const big = w.indexOf(Math.max(...w)); w[big] += 255 - w.reduce((s, x) => s + x, 0); ints.push(...w); }
        quant.set(k, words(a.count, 4, 5121, true, 'VEC4', ints));
      }
    }
  }
  // Rewrite the binary chunk: one bufferView per accessor, in use order, so gzip sees like next to like.
  const views = []; const chunks = []; let at = 0;
  const pushView = (buf, target, stride) => {
    const pad = at % 4 ? 4 - (at % 4) : 0;
    if (pad) { chunks.push(Buffer.alloc(pad)); at += pad; }
    const view = { buffer: 0, byteOffset: at, byteLength: buf.length }; if (target) view.target = target; if (stride) view.byteStride = stride;
    views.push(view); chunks.push(buf); at += buf.length;
    return views.length - 1;
  };
  const newAcc = []; const remap = new Map();
  const isIndex = new Set(); const isVertex = new Set();
  for (const m of json.meshes || []) for (const p of m.primitives) { if (p.indices != null) isIndex.add(p.indices); for (const k of Object.values(p.attributes)) isVertex.add(k); }
  for (const k of [...usedAcc].sort((a, b) => a - b)) {
    const a = json.accessors[k]; const q = quant.get(k); let buf; const next = { ...a }; delete next.byteOffset;
    // A vertex attribute must start every element on four bytes, so a three-byte normal has a stride of four. The loader must be told.
    let keepStride;
    if (q) {
      const stride = q.bytes; buf = Buffer.alloc(q.n * stride);
      const comps = COMPONENTS[q.type];
      if (comps * SIZES[q.comp] !== stride) keepStride = stride;
      for (let i = 0; i < q.n; i++) for (let c = 0; c < comps; c++) {
        const v = q.values[i * comps + c]; const o = i * stride + c * SIZES[q.comp];
        if (q.comp === 5120) buf.writeInt8(v, o); else if (q.comp === 5121) buf.writeUInt8(v, o); else buf.writeUInt16LE(v, o);
      }
      next.componentType = q.comp; next.normalized = q.normalized; delete next.min; delete next.max;
    } else {
      const v = json.bufferViews[a.bufferView]; const n = COMPONENTS[a.type]; const s = SIZES[a.componentType];
      const start = (v.byteOffset || 0) + (a.byteOffset || 0); const stride = v.byteStride || n * s;
      const out = isVertex.has(k) ? Math.ceil((n * s) / 4) * 4 : n * s;
      buf = Buffer.alloc(a.count * out);
      for (let i = 0; i < a.count; i++) bin.copy(buf, i * out, start + i * stride, start + i * stride + n * s);
      if (out !== n * s) keepStride = out;
    }
    next.bufferView = pushView(buf, isIndex.has(k) ? 34963 : isVertex.has(k) ? 34962 : undefined, keepStride);
    remap.set(k, newAcc.length); newAcc.push(next);
  }
  // Bytes of the embedded images, if a file has any, keep their own views.
  for (const img of json.images || []) if (img.bufferView != null) { const v = json.bufferViews[img.bufferView]; img.bufferView = pushView(bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)); }
  for (const m of json.meshes || []) for (const p of m.primitives) { for (const name of Object.keys(p.attributes)) p.attributes[name] = remap.get(p.attributes[name]); if (p.indices != null) p.indices = remap.get(p.indices); }
  for (const s of json.skins || []) if (s.inverseBindMatrices != null) s.inverseBindMatrices = remap.get(s.inverseBindMatrices);
  for (const a of json.animations || []) for (const s of a.samplers) { s.input = remap.get(s.input); s.output = remap.get(s.output); }
  json.accessors = newAcc; json.bufferViews = views;
  const outBin = Buffer.concat(chunks);
  json.buffers = [{ byteLength: outBin.length + (outBin.length % 4 ? 4 - (outBin.length % 4) : 0) }];
  if (quant.size) {
    json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'KHR_mesh_quantization'])];
    json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), 'KHR_mesh_quantization'])];
  }
  writeGlb(file, json, outBin);
  const after = readFileSync(file);
  console.log(`${file.split('/').pop()}: ${size} -> ${after.length} bytes, gzip ${gzipSync(after, { level: 9 }).length}`);
}

for (const f of process.argv.slice(2)) strip(f);
