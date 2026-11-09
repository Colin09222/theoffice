// The static app, ready to serve: read once at start-up, every internal reference stamped with a content version, and compressed.
// A URL that carries the file's current version can be cached for good, so a returning visitor fetches nothing but the page shell.
// There is no build step: the stamping happens here, on the bytes in public/, and the files on disk stay as they are.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, posix, relative } from 'node:path';
import { brotliCompress, constants as Z, gzipSync } from 'node:zlib';

// .glb and .png are the CC0 Kenney models under public/models (see public/models/NOTICE.txt). The binary models compress to about a fifth.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const version = (data) => createHash('sha256').update(data).digest('hex').slice(0, 12);
const IMPORTS = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+?\.js)\2/g;
const PLACEHOLDER = '__MODELS_V__';

export function buildStatics(pub, base) {
  const raw = new Map();
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (TYPES[extname(n)]) raw.set(`/${relative(pub, p).split('\\').join('/')}`, readFileSync(p));
    }
  };
  walk(pub);
  const versions = new Map(), bodies = new Map();
  const isApp = (p) => p.startsWith('/js/') && p.endsWith('.js');
  // Anything that points at nothing else versions by its own bytes.
  for (const [p, body] of raw) if (!isApp(p) && !/\.(css|html)$/.test(p) && !p.endsWith('/addons.module.min.js')) { versions.set(p, version(body)); bodies.set(p, body); }
  const stampImports = (p, text, appVersion) => text.replace(IMPORTS, (whole, head, quote, spec) => {
    const target = posix.join(posix.dirname(p), spec);
    const v = isApp(target) ? appVersion : versions.get(target);
    return v ? `${head}${quote}${spec}?v=${v}${quote}` : whole;
  });
  // The addons bundle imports three by relative path; both must resolve to one URL, or the page would hold two copies of three.
  for (const [p, body] of raw) if (p.endsWith('/addons.module.min.js')) { const b = Buffer.from(stampImports(p, body.toString('utf8'))); versions.set(p, version(b)); bodies.set(p, b); }
  // The models' version covers the whole folder, since a model file names its own textures.
  const modelFiles = [...raw.keys()].filter((p) => p.startsWith('/models/')).sort();
  const models = version(modelFiles.map((p) => versions.get(p)).join());
  for (const p of modelFiles) versions.set(p, models);
  // App modules can import each other in cycles, so they share one version, of all of them together.
  const appFiles = [...raw.keys()].filter(isApp).sort();
  const appVersion = version(appFiles.map((p) => raw.get(p).toString('utf8')).join('\0') + models + [...versions.entries()].filter(([p]) => p.startsWith('/vendor/')).map(([p, v]) => p + v).join());
  for (const p of appFiles) { versions.set(p, appVersion); bodies.set(p, Buffer.from(stampImports(p, raw.get(p).toString('utf8'), appVersion).replaceAll(PLACEHOLDER, models))); }
  // Stylesheets name fonts by absolute path, the page names everything by absolute path.
  const stampPaths = (text) => text.replace(new RegExp(`${base}(/[A-Za-z0-9_./-]+\\.[a-z0-9]+)`, 'g'), (whole, path) => (versions.has(path) ? `${whole}?v=${versions.get(path)}` : whole));
  for (const [p, body] of raw) if (p.endsWith('.css')) { const b = Buffer.from(stampPaths(body.toString('utf8'))); versions.set(p, version(b)); bodies.set(p, b); }
  // The page's stylesheets go out as one file, in their own order so the cascade is the same: a slow phone waits on each request before it can paint.
  const page = raw.get('/index.html')?.toString('utf8');
  if (page) {
    const tags = [...page.matchAll(new RegExp(`<link rel="stylesheet" href="${base}/css/([a-z0-9-]+)\\.css">\\n?`, 'g'))];
    if (tags.length > 1 && tags.every((m) => bodies.has(`/css/${m[1]}.css`))) {
      const all = Buffer.from(tags.map((m) => bodies.get(`/css/${m[1]}.css`).toString('utf8')).join('\n'));
      versions.set('/css/all.css', version(all)); bodies.set('/css/all.css', all);
      let rewritten = page.replace(tags[0][0], `<link rel="stylesheet" href="${base}/css/all.css">\n`);
      for (const m of tags.slice(1)) rewritten = rewritten.replace(m[0], '');
      raw.set('/index.html', Buffer.from(rewritten));
    }
  }
  for (const [p, body] of raw) if (p.endsWith('.html')) { const b = Buffer.from(stampPaths(body.toString('utf8'))); versions.set(p, version(b)); bodies.set(p, b); }

  const map = new Map();
  for (const [p, body] of bodies) {
    const ext = extname(p); const compressible = ext !== '.woff2' && ext !== '.png';
    map.set(p, { body, gz: compressible ? gzipSync(body, { level: 9 }) : null, br: null, type: TYPES[ext], version: versions.get(p) });
  }
  return map;
}

/** Brotli at full strength takes a moment per file, so it runs on the thread pool: gzip answers until it lands. */
export function wantBrotli(file) {
  if (file.br || file.brPending || !file.gz) return Promise.resolve();
  file.brPending = new Promise((done) => {
    brotliCompress(file.body, { params: { [Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_SIZE_HINT]: file.body.length } }, (e, out) => { file.brPending = null; if (!e) file.br = out; done(); });
  });
  return file.brPending;
}

/** Compresses everything once at start-up, one file at a time, so a real visitor never waits and the thread pool stays free for other work. */
export async function warmBrotli(map) {
  for (const file of map.values()) await wantBrotli(file);
}

/** The header value and bytes for a request's Accept-Encoding: brotli if it has landed and is wanted, then gzip, then as is. */
export function pickEncoding(file, acceptEncoding) {
  const accepts = String(acceptEncoding || '');
  if (file.gz && /\bbr\b/.test(accepts)) { if (file.br) return { encoding: 'br', body: file.br }; wantBrotli(file); }
  if (file.gz && /\bgzip\b/.test(accepts)) return { encoding: 'gzip', body: file.gz };
  return { encoding: null, body: file.body };
}
