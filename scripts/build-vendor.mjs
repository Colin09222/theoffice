// Rebuilds public/vendor/three/addons.module.min.js: the three.js addons we use (post-processing chain, GLTFLoader,
// SkeletonUtils, RoomEnvironment) and the N8AO ambient-occlusion pass, bundled into one module that imports the
// vendored three build by relative path. Nothing in the bundle is fetched at runtime; the CSP stays script-src 'self'.
//
// Usage (from a scratch directory holding the npm tarballs, never from inside the repo's node_modules):
//   THREE_PKG=/tmp/three-dl/package N8AO_PKG=/tmp/n8ao-dl/package ESBUILD=/tmp/esbuild-dl/node_modules/esbuild/lib/main.js \
//     node scripts/build-vendor.mjs
// three must be the same version as public/vendor/three/three.module.min.js (see README.txt there), so the addons and the
// core share one module instance and one set of class identities.
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/vendor/three/addons.module.min.js');
const threePkg = process.env.THREE_PKG, n8aoPkg = process.env.N8AO_PKG, esbuildPath = process.env.ESBUILD;
if (!threePkg || !n8aoPkg || !esbuildPath) { console.error('Set THREE_PKG, N8AO_PKG and ESBUILD (see the comment at the top of this file).'); process.exit(2); }
const threeVersion = JSON.parse(readFileSync(join(threePkg, 'package.json'), 'utf8')).version;
const n8aoVersion = JSON.parse(readFileSync(join(n8aoPkg, 'package.json'), 'utf8')).version;
const vendored = readFileSync(join(root, 'public/vendor/three/README.txt'), 'utf8').match(/three@([\d.]+)/)?.[1];
if (vendored && vendored !== threeVersion) { console.error(`three ${threeVersion} does not match the vendored three@${vendored}`); process.exit(2); }

const work = mkdtempSync(join(tmpdir(), 'vendor-build-'));
mkdirSync(join(work, 'node_modules/postprocessing'), { recursive: true });
symlinkSync(threePkg, join(work, 'node_modules/three'));
symlinkSync(n8aoPkg, join(work, 'node_modules/n8ao'));
// N8AO also ships a pass for the pmndrs "postprocessing" library. We only use the three EffectComposer variant, so that peer is a stub.
writeFileSync(join(work, 'node_modules/postprocessing/package.json'), JSON.stringify({ name: 'postprocessing', version: '0.0.0-stub', type: 'module', main: 'index.js' }));
writeFileSync(join(work, 'node_modules/postprocessing/index.js'), 'export class Pass { constructor() { throw new Error("N8AOPostPass needs the postprocessing library, which is not bundled"); } }\n');
writeFileSync(join(work, 'entry.js'), `
export { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
export { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
export { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
export { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
export { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
export { N8AOPass } from 'n8ao';
`);

const esbuild = await import(pathToFileURL(esbuildPath).href);
const banner = `/* three.js addons r${threeVersion.split('.')[1]} (MIT, https://github.com/mrdoob/three.js) and n8ao ${n8aoVersion} (ISC, https://github.com/N8python/n8ao), bundled by scripts/build-vendor.mjs */`;
await esbuild.build({
  entryPoints: [join(work, 'entry.js')],
  bundle: true, format: 'esm', minify: true, legalComments: 'none', outfile: out,
  absWorkingDir: work, preserveSymlinks: true,
  banner: { js: banner },
  plugins: [{
    name: 'vendored-three',
    setup(b) {
      // The bare "three" import is the vendored build next to the output file; every "three/examples/..." path is bundled.
      b.onResolve({ filter: /^three$/ }, () => ({ path: './three.module.min.js', external: true }));
    },
  }],
});
const bytes = statSync(out).size, gz = gzipSync(readFileSync(out), { level: 9 }).length;
console.log(`wrote ${out}: ${bytes} bytes (${gz} gzipped), three ${threeVersion}, n8ao ${n8aoVersion}`);
