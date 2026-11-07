// Just enough tar for the boxes that go in and out of a computer. What comes out of a container is hostile:
// links are never followed or stored, sizes are checked before anything is believed, and the gunzip output is capped so a bomb only costs an error.
import { gzipSync, gunzipSync } from 'node:zlib';

export class TarError extends Error {}
const BLOCK = 512;

function header(name, size, type = '0', mode = 0o644) {
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, 'utf8');
  h.write(mode.toString(8).padStart(7, '0'), 100, 7, 'ascii');
  h.write('0000000', 108, 7, 'ascii'); h.write('0000000', 116, 7, 'ascii');
  h.write(size.toString(8).padStart(11, '0'), 124, 11, 'ascii');
  h.write('00000000000', 136, 11, 'ascii');
  h.write(type, 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'latin1'); h.write('00', 263, 2, 'ascii');
  h.fill(' ', 148, 156);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

/** entries: [{ path, data: Buffer, mode? }]. Long names use a GNU long-link record, which every tar reads. */
export function packTgz(entries) {
  const parts = [];
  const pad = (n) => Buffer.alloc((BLOCK - (n % BLOCK)) % BLOCK);
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    if (Buffer.byteLength(e.path) > 99) {
      const long = Buffer.from(`${e.path}\0`);
      parts.push(header('././@LongLink', long.length, 'L'), long, pad(long.length));
    }
    parts.push(header(Buffer.from(e.path).subarray(0, 99).toString('utf8'), data.length, '0', e.mode ?? 0o644), data, pad(data.length));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts));
}

const cstr = (b, start, len) => { const s = b.subarray(start, start + len); const z = s.indexOf(0); return s.subarray(0, z < 0 ? len : z).toString('utf8'); };
function octal(b, start, len) {
  // GNU base-256 sizes are only used past 8 GB, which is already over any limit here.
  if (b[start] & 0x80) throw new TarError('that archive has an entry that is far too big');
  const s = cstr(b, start, len).trim();
  if (!s) return 0;
  if (!/^[0-7]+$/.test(s)) throw new TarError('that archive is damaged');
  return parseInt(s, 8);
}

/** Regular files only. Returns { files: [{ path, data }], ignored: [names] }. Throws TarError on damage or over-limit input. */
export function unpackTgz(gz, { maxBytes = 64 * 1024 * 1024, maxEntries = 5000 } = {}) {
  let tar;
  try { tar = gunzipSync(gz, { maxOutputLength: maxBytes + BLOCK * (maxEntries + 2) * 2 }); } catch (e) {
    if (e?.code === 'ERR_BUFFER_TOO_LARGE') throw new TarError('that archive unpacks to more than is allowed');
    throw new TarError('that is not a readable .tgz file');
  }
  const files = []; const ignored = [];
  let off = 0, nextName = null, total = 0, seen = 0;
  while (off + BLOCK <= tar.length) {
    const h = tar.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break;
    if (++seen > maxEntries) throw new TarError(`that archive has more than ${maxEntries} entries`);
    const stored = octal(h, 148, 8);
    let sum = 0; for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== stored) throw new TarError('that archive is damaged');
    const size = octal(h, 124, 12);
    const end = off + BLOCK + size;
    if (end > tar.length) throw new TarError('that archive is cut short');
    const type = String.fromCharCode(h[156] || 48);
    const body = tar.subarray(off + BLOCK, end);
    let name = cstr(h, 0, 100);
    const prefix = cstr(h, 345, 155);
    if (cstr(h, 257, 5) === 'ustar' && prefix && !cstr(h, 263, 2).includes(' ')) name = `${prefix}/${name}`;
    off = end + ((BLOCK - (size % BLOCK)) % BLOCK);
    if (type === 'L') { nextName = cstr(body, 0, size); continue; }
    if (type === 'x') { const m = body.toString('utf8').match(/(?:^|\n)\d+ path=([^\n]*)\n/); if (m) nextName = m[1]; continue; }
    if (type === 'g' || type === 'K') continue;
    if (nextName !== null) { name = nextName; nextName = null; }
    const path = name.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    if (type === '5' || !path) continue;
    if (type !== '0' && type !== '7') { ignored.push(`${path.slice(0, 120)} (not a regular file)`); continue; }
    total += size;
    if (total > maxBytes) throw new TarError('that archive unpacks to more than is allowed');
    files.push({ path, data: Buffer.from(body) });
  }
  return { files, ignored };
}
