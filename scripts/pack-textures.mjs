// Packs CC0 PBR texture sets for the floors. The static server only serves a short list of types and the page's CSP forbids blob: images,
// so each set's JPEGs travel in a small valid .glb and public/js/textures.js reads them straight out with createImageBitmap.
// <name>.glb holds the colour map; <name>-pbr.glb holds the normal and roughness maps, which the lowest quality tier never fetches.
//
// Usage: node scripts/pack-textures.mjs <dir with diff.jpg, nor_gl.jpg, rough.jpg> <name> <out dir>
//        node scripts/pack-textures.mjs --env <equirect.jpg> <name> <out dir>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'packtex-'));
function jpeg(src, size, quality, tag) {
  const out = join(tmp, `${tag}.jpg`);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), '-Z', String(size), src, '--out', out], { stdio: 'ignore' });
  return readFileSync(out);
}
function glb(images) {
  const chunks = []; const views = []; let at = 0;
  for (const { bytes } of images) { views.push({ buffer: 0, byteOffset: at, byteLength: bytes.length }); const pad = (4 - (bytes.length % 4)) % 4; chunks.push(bytes, Buffer.alloc(pad)); at += bytes.length + pad; }
  const json = { asset: { version: '2.0', generator: 'pack-textures' }, buffers: [{ byteLength: at }], bufferViews: views, images: images.map(({ name }, i) => ({ name, bufferView: i, mimeType: 'image/jpeg' })) };
  let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + text.length + 8 + at, 8);
  const c0 = Buffer.alloc(8); c0.writeUInt32LE(text.length, 0); c0.writeUInt32LE(0x4e4f534a, 4);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(at, 0); c1.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, c0, text, c1, ...chunks]);
}
const args = process.argv.slice(2);
if (args[0] === '--env') {
  const [, src, name, out] = args;
  writeFileSync(join(out, `${name}.glb`), glb([{ name: 'env', bytes: jpeg(src, 512, 70, 'env') }]));
} else {
  const [dir, name, out] = args;
  writeFileSync(join(out, `${name}.glb`), glb([{ name: 'map', bytes: jpeg(join(dir, 'diff.jpg'), 512, 66, 'd') }]));
  writeFileSync(join(out, `${name}-pbr.glb`), glb([{ name: 'normal', bytes: jpeg(join(dir, 'nor_gl.jpg'), 384, 60, 'n') }, { name: 'rough', bytes: jpeg(join(dir, 'rough.jpg'), 256, 50, 'r') }]));
}
