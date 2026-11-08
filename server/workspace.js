// Per-floor virtual workspace stored in SQLite. Paths here are only ever database keys; no agent path touches the real filesystem.
import { createHash, randomBytes } from 'node:crypto';
import { get, all, run, tx } from './db.js';

export const MAX_FILE_BYTES = 400 * 1024;
export const MAX_FILES = 2000;
// Source files are served as plain text: nosniff means a browser will never run one as anything else.
const PLAIN = 'text/plain; charset=utf-8';
export const TEXT_EXT = { html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json; charset=utf-8', txt: PLAIN, md: PLAIN, svg: 'image/svg+xml; charset=utf-8', xml: 'application/xml; charset=utf-8', csv: 'text/csv; charset=utf-8', vtt: 'text/vtt; charset=utf-8',
  ts: PLAIN, tsx: PLAIN, jsx: PLAIN, vue: PLAIN, svelte: PLAIN, scss: PLAIN, less: PLAIN, yml: PLAIN, yaml: PLAIN, toml: PLAIN, lock: PLAIN, sh: PLAIN, glsl: PLAIN, wgsl: PLAIN, vert: PLAIN, frag: PLAIN, gltf: 'model/gltf+json', obj: PLAIN };
// Only a build from a real computer can bring these in. Agents' write_file stays text-only.
export const BINARY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', wasm: 'application/wasm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', glb: 'model/gltf-binary', bin: 'application/octet-stream', data: 'application/octet-stream', pdf: 'application/pdf' };
export const mimeOf = (path) => { const ext = String(path).split('.').pop().toLowerCase(); return TEXT_EXT[ext] || BINARY_EXT[ext] || 'application/octet-stream'; };
export const MAX_SYNC_FILE_BYTES = 8 * 1024 * 1024;

export class WorkspaceError extends Error {}

export function cleanPath(p, { binary = false } = {}) {
  if (typeof p !== 'string') throw new WorkspaceError('path must be a string');
  if (p.length === 0 || p.length > 200) throw new WorkspaceError('path length must be 1 to 200 characters');
  if (/[\\\u0000-\u001f\u007f]/.test(p)) throw new WorkspaceError('path has illegal characters');
  if (p.startsWith('/') || p.startsWith('~')) throw new WorkspaceError('paths are relative to the workspace');
  const parts = p.split('/');
  // Real builds nest deeper than anything an agent writes by hand.
  if (parts.length > (binary ? 12 : 6)) throw new WorkspaceError('path is too deep');
  for (const seg of parts) {
    if (!seg || seg === '.' || seg === '..') throw new WorkspaceError('path may not contain empty, . or .. segments');
    if (!/^[A-Za-z0-9._ -]{1,80}$/.test(seg) || seg.startsWith('.')) throw new WorkspaceError(`bad path segment "${seg.slice(0, 40)}"`);
  }
  const ext = p.includes('.') ? p.split('.').pop().toLowerCase() : '';
  // A zip only ever comes from the boss, so it only lives among the uploads.
  if (!TEXT_EXT[ext] && !(binary && (BINARY_EXT[ext] || (ext === 'zip' && parts[0] === 'uploads')))) throw new WorkspaceError(`only text files are allowed (${Object.keys(TEXT_EXT).join(', ')})`);
  return p;
}

export const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export function slugify(s, fallback = 'project') {
  const out = String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return out || fallback;
}

export const floorBytes = (db, floorId) => {
  const a = get(db, 'SELECT COALESCE(SUM(size),0) n FROM files WHERE floor_id=?', floorId).n;
  const b = get(db, 'SELECT COALESCE(SUM(size),0) n FROM published_files WHERE floor_id=?', floorId).n;
  return a + b;
};

// The boss's own files. Nobody on the staff can change one, only copy it into a project.
const readOnly = (p) => { if (p.split('/')[0] === 'uploads') throw new WorkspaceError('uploads/ holds the boss\'s files and nobody can change them. Copy one into a project with copy_file to use it.'); };

export function writeFile(db, floorId, path, content, agentId, quotaBytes) {
  const p = cleanPath(path);
  readOnly(p);
  if (typeof content !== 'string') throw new WorkspaceError('content must be text');
  const size = Buffer.byteLength(content);
  if (size > MAX_FILE_BYTES) throw new WorkspaceError(`file too big (limit ${MAX_FILE_BYTES} bytes)`);
  return tx(db, () => {
    const prev = get(db, 'SELECT size FROM files WHERE floor_id=? AND path=?', floorId, p);
    if (!prev && get(db, 'SELECT COUNT(*) n FROM files WHERE floor_id=?', floorId).n >= MAX_FILES) throw new WorkspaceError('too many files in this workspace');
    if (floorBytes(db, floorId) - (prev?.size || 0) + size > quotaBytes) throw new WorkspaceError('this floor has used all of its storage quota');
    run(db, `INSERT INTO files (floor_id,path,content,size,agent_id,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(floor_id,path) DO UPDATE SET content=excluded.content,size=excluded.size,agent_id=excluded.agent_id,updated_at=excluded.updated_at`, floorId, p, content, size, agentId ?? null, Date.now());
    return { path: p, size };
  });
}

export const readFile = (db, floorId, path) => get(db, 'SELECT path,content,size,updated_at FROM files WHERE floor_id=? AND path=?', floorId, cleanPath(path, { binary: true }));
export const listFiles = (db, floorId, prefix = '') => all(db, 'SELECT path,size,updated_at,agent_id FROM files WHERE floor_id=? ORDER BY path', floorId).filter((f) => f.path.startsWith(prefix));

// Working papers stay on the shared drive. They were written for the staff, so they never go live with the project.
export const goesLive = (relPath) => !/^notes\//.test(relPath) && relPath !== 'TEST-REPORT.md';

/** Snapshot projects/<slug>/ (or one directory inside it, such as a build's dist/) into the published set. Quota is re-checked and the swap is atomic. */
export function publishSnapshot(db, floorId, slug, quotaBytes, directory = '') {
  const prefix = `projects/${slug}/${directory ? `${directory}/` : ''}`;
  const rows = all(db, 'SELECT path,content,size FROM files WHERE floor_id=? ORDER BY path', floorId).filter((f) => f.path.startsWith(prefix) && goesLive(f.path.slice(prefix.length)));
  return tx(db, () => {
    const old = get(db, 'SELECT COALESCE(SUM(size),0) n FROM published_files WHERE floor_id=? AND project=?', floorId, slug).n;
    const total = rows.reduce((n, r) => n + r.size, 0);
    if (floorBytes(db, floorId) - old + total > quotaBytes) throw new WorkspaceError('publishing would exceed this floor\'s storage quota');
    run(db, 'DELETE FROM published_files WHERE floor_id=? AND project=?', floorId, slug);
    for (const r of rows) run(db, 'INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?,?,?,?,?)', floorId, slug, r.path.slice(prefix.length), r.content, r.size);
    return rows.length;
  });
}

/** A picture made by a broker on the server. Binary, so only a server path can write one: an agent's own write_file stays text-only. */
export function writeBinaryFile(db, floorId, path, bytes, agentId, quotaBytes) {
  const p = cleanPath(path, { binary: true });
  readOnly(p);
  if (bytes.length > MAX_SYNC_FILE_BYTES) throw new WorkspaceError('file too big');
  return tx(db, () => {
    const prev = get(db, 'SELECT size FROM files WHERE floor_id=? AND path=?', floorId, p);
    if (!prev && get(db, 'SELECT COUNT(*) n FROM files WHERE floor_id=?', floorId).n >= MAX_FILES) throw new WorkspaceError('too many files in this workspace');
    if (floorBytes(db, floorId) - (prev?.size || 0) + bytes.length > quotaBytes) throw new WorkspaceError('this floor has used all of its storage quota');
    run(db, `INSERT INTO files (floor_id,path,content,size,agent_id,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(floor_id,path) DO UPDATE SET content=excluded.content,size=excluded.size,agent_id=excluded.agent_id,updated_at=excluded.updated_at`, floorId, p, new Uint8Array(bytes), bytes.length, agentId ?? null, Date.now());
    return { path: p, size: bytes.length };
  });
}

const hashOf = (c) => createHash('sha256').update(c).digest('hex');

/** Every file in one project, for the box a computer starts from. */
export function projectFiles(db, floorId, slug) {
  const prefix = `projects/${slug}/`;
  return all(db, 'SELECT path,content FROM files WHERE floor_id=? ORDER BY path', floorId).filter((f) => f.path.startsWith(prefix))
    .map((f) => ({ path: f.path.slice(prefix.length), data: Buffer.from(f.content) }));
}
export const baselineOf = (files) => Object.fromEntries(files.map((f) => [f.path, hashOf(f.data)]));

/** A build's files back into the workspace, as a three-way merge against what the computer started from, so someone else's edit made meanwhile survives. All or nothing. */
export function applySync(db, floorId, slug, entries, baseline, agentId, quotaBytes) {
  const prefix = `projects/${slug}/`;
  const incoming = new Map(); const skipped = []; const kept = new Set();
  for (const e of entries) {
    // Too big to take back, but still there: what was already saved stays rather than being taken for deleted.
    if (e.data.length > MAX_SYNC_FILE_BYTES) { skipped.push(`${e.path.slice(0, 120)} (over ${MAX_SYNC_FILE_BYTES / 1048576} MB)`); kept.add(e.path); continue; }
    try { cleanPath(prefix + e.path, { binary: true }); incoming.set(e.path, e.data); } catch { skipped.push(e.path.slice(0, 120)); }
  }
  const t = Date.now();
  return tx(db, () => {
    let written = 0, removed = 0;
    for (const [path, data] of incoming) {
      const hash = hashOf(data);
      if (baseline[path] === hash) continue;                     // the computer did not change this one
      const ext = path.split('.').pop().toLowerCase();
      const text = TEXT_EXT[ext] ? data.toString('utf8') : null;
      const content = text !== null && Buffer.byteLength(text) === data.length && Buffer.from(text).equals(data) ? text : new Uint8Array(data);
      run(db, `INSERT INTO files (floor_id,path,content,size,agent_id,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(floor_id,path) DO UPDATE SET content=excluded.content,size=excluded.size,agent_id=excluded.agent_id,updated_at=excluded.updated_at`, floorId, prefix + path, content, data.length, agentId ?? null, t);
      written++;
    }
    for (const path of Object.keys(baseline)) {
      if (incoming.has(path) || kept.has(path)) continue;
      const cur = get(db, 'SELECT content FROM files WHERE floor_id=? AND path=?', floorId, prefix + path);
      if (cur && hashOf(cur.content) === baseline[path]) { run(db, 'DELETE FROM files WHERE floor_id=? AND path=?', floorId, prefix + path); removed++; }
    }
    if (get(db, 'SELECT COUNT(*) n FROM files WHERE floor_id=?', floorId).n > MAX_FILES) throw new WorkspaceError(`that is more than ${MAX_FILES} files; leave build leftovers out`);
    if (floorBytes(db, floorId) > quotaBytes) throw new WorkspaceError(`that does not fit this floor's ${Math.round(quotaBytes / 1048576)} MB storage quota; leave out large files or leftovers`);
    return { written, removed, skipped, accepted: [...incoming].map(([path, data]) => ({ path, data })) };
  });
}

// ---- the boss's uploads ----
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
// What each kind is allowed to be, judged by its bytes. The name's extension has to agree with them.
export const UPLOAD_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', zip: 'application/zip' };
const TEXT_UPLOADS = new Set(['txt', 'md', 'csv', 'json']);
export const isImageType = (type) => /^image\/(png|jpeg|webp|gif)$/.test(type);
const starts = (b, ...sig) => sig.every((v, i) => b[i] === v);
const ascii = (b, at, str) => b.length >= at + str.length && b.toString('latin1', at, at + str.length) === str;
/** The kind these bytes really are, or '' when they are none of the kinds taken. */
export function sniff(bytes) {
  const b = Buffer.from(bytes);
  if (starts(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (starts(b, 0xff, 0xd8, 0xff)) return 'jpg';
  if (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')) return 'gif';
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp';
  if (ascii(b, 0, '%PDF-')) return 'pdf';
  if (starts(b, 0x50, 0x4b, 0x03, 0x04) || starts(b, 0x50, 0x4b, 0x05, 0x06)) return 'zip';
  if (b.includes(0)) return '';
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return ''; }
  return 'text';
}
/** A name that is safe as one path segment, keeping the extension. */
export function uploadName(raw) {
  let n = String(raw ?? '');
  try { n = decodeURIComponent(n); } catch { /* left as sent */ }
  n = n.split(/[/\\]/).pop().normalize('NFKC').replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[.\s-]+/, '').trim();
  const dot = n.lastIndexOf('.');
  const ext = dot > 0 ? n.slice(dot + 1).toLowerCase() : '';
  const base = (dot > 0 ? n.slice(0, dot) : n).replace(/[.\s-]+$/, '').slice(0, 60) || 'file';
  return { base, ext: ext === 'jpeg' ? 'jpg' : ext, display: n.slice(0, 120) || 'file' };
}
/** Checks an upload against its name and stores it among the floor's files, counted in its quota. Text kinds are kept as text so read_file can read them. */
export function saveUpload(db, floorId, rawName, bytes, quotaBytes, t = Date.now()) {
  const { base, ext, display } = uploadName(rawName);
  if (!UPLOAD_TYPES[ext]) throw new WorkspaceError(`That kind of file can't be sent. Send ${Object.keys(UPLOAD_TYPES).join(', ')}.`);
  if (!bytes.length) throw new WorkspaceError('That file is empty.');
  if (bytes.length > MAX_UPLOAD_BYTES) throw new WorkspaceError(`That file is over ${MAX_UPLOAD_BYTES / 1048576} MB.`);
  const real = sniff(bytes);
  const fits = TEXT_UPLOADS.has(ext) ? real === 'text' : real === ext;
  if (!fits) throw new WorkspaceError(`That file isn't really a .${ext} file.`);
  let content = new Uint8Array(bytes);
  if (TEXT_UPLOADS.has(ext)) {
    content = Buffer.from(bytes).toString('utf8');
    if (ext === 'json') { try { JSON.parse(content); } catch { throw new WorkspaceError('That .json file is not valid JSON.'); } }
  }
  const id = `u${randomBytes(9).toString('base64url')}`;
  const path = cleanPath(`uploads/${id}-${base}.${ext}`, { binary: true });
  return tx(db, () => {
    if (get(db, 'SELECT COUNT(*) n FROM files WHERE floor_id=?', floorId).n >= MAX_FILES) throw new WorkspaceError('too many files in this workspace');
    if (floorBytes(db, floorId) + bytes.length > quotaBytes) throw new WorkspaceError('This floor has used all of its storage quota.');
    run(db, 'INSERT INTO files (floor_id,path,content,size,agent_id,updated_at) VALUES (?,?,?,?,?,?)', floorId, path, content, bytes.length, null, t);
    run(db, 'INSERT INTO attachments (id,floor_id,name,type,size,path,created_at) VALUES (?,?,?,?,?,?,?)', id, floorId, display, UPLOAD_TYPES[ext], bytes.length, path, t);
    return { id, name: display, type: UPLOAD_TYPES[ext], size: bytes.length, path };
  });
}
export const attachmentsOf = (db, floorId, ids) => {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string' && /^u[A-Za-z0-9_-]{12}$/.test(x)))];
  return list.map((id) => get(db, 'SELECT id,name,type,size,path FROM attachments WHERE id=? AND floor_id=?', id, floorId)).filter(Boolean);
};
