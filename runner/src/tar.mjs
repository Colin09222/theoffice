// Minimal ustar writer, enough to hand a project's files to Docker's archive API.
export function makeTar(entries) {
  const blocks = [];
  for (const e of entries) {
    const data = e.type === 'dir' ? Buffer.alloc(0) : e.data;
    blocks.push(header(e, data.length));
    if (data.length) {
      blocks.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) blocks.push(Buffer.alloc(pad));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function splitPath(p) {
  if (Buffer.byteLength(p) <= 100) return ['', p];
  for (let i = p.lastIndexOf('/'); i > 0; i = p.lastIndexOf('/', i - 1)) {
    const prefix = p.slice(0, i);
    const name = p.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return [prefix, name];
  }
  throw new Error(`path too long for tar: ${p.slice(0, 80)}`);
}

function header(e, size) {
  const h = Buffer.alloc(512);
  const path = e.type === 'dir' && !e.path.endsWith('/') ? e.path + '/' : e.path;
  const [prefix, name] = splitPath(path);
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  h.write(name, 0, 100, 'utf8');
  h.write(oct(e.mode ?? (e.type === 'dir' ? 0o755 : 0o644), 8), 100, 8, 'ascii');
  h.write(oct(e.uid ?? 0, 8), 108, 8, 'ascii');
  h.write(oct(e.gid ?? 0, 8), 116, 8, 'ascii');
  h.write(oct(size, 12), 124, 12, 'ascii');
  h.write(oct(Math.floor((e.mtime ?? Date.now()) / 1000), 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write(e.type === 'dir' ? '5' : '0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}
