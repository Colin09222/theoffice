// The WebSocket wire format (RFC 6455), just enough of it for game rooms: text messages, ping, pong and close.
// No extensions and no compression, so a message costs exactly what it weighs. Every limit is checked before a byte is buffered.
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const acceptKey = (key) => createHash('sha1').update(key + GUID).digest('base64');

/** Is this a WebSocket upgrade we can accept? Returns the key, or null. */
export function upgradeKey(req) {
  const key = String(req.headers['sec-websocket-key'] || '');
  if (req.method !== 'GET' || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return null;
  if (req.headers['sec-websocket-version'] !== '13' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return null;
  return key;
}

export const handshake = (key) => `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`;

/** One frame. Servers never mask; clients always do, so `mask` is only for test clients. */
export function frame(opcode, payload = Buffer.alloc(0), mask = false) {
  const len = payload.length;
  const ext = len < 126 ? 0 : len < 65536 ? 2 : 8;
  const head = Buffer.alloc(2 + ext + (mask ? 4 : 0));
  head[0] = 0x80 | opcode;
  head[1] = (mask ? 0x80 : 0) | (ext === 0 ? len : ext === 2 ? 126 : 127);
  if (ext === 2) head.writeUInt16BE(len, 2); else if (ext === 8) head.writeBigUInt64BE(BigInt(len), 2);
  if (!mask) return Buffer.concat([head, payload]);
  const key = head.subarray(2 + ext);
  for (let i = 0; i < 4; i++) key[i] = (Math.random() * 256) | 0;
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= key[i & 3];
  return Buffer.concat([head, body]);
}
export const closeFrame = (code, reason = '', mask = false) => {
  const r = Buffer.from(String(reason).slice(0, 100));
  const p = Buffer.alloc(2 + r.length); p.writeUInt16BE(code, 0); r.copy(p, 2);
  return frame(0x8, p, mask);
};

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Turns bytes into messages. `max` caps one message, fragments included; anything larger is refused before it is kept.
 * Calls on.text(string), on.ping(buf), on.pong(), on.close(code), and on.fail(code, why) for a broken peer.
 */
export class Reader {
  constructor({ max, masked = true, on }) { this.max = max; this.masked = masked; this.on = on; this.buf = null; this.parts = null; this.partBytes = 0; this.done = false; }
  push(chunk) {
    if (this.done) return;
    this.buf = this.buf ? Buffer.concat([this.buf, chunk]) : chunk;
    while (!this.done && this.buf && this.buf.length >= 2) {
      const b = this.buf;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, hasMask = (b[1] & 0x80) !== 0;
      if (b[0] & 0x70) return this.fail(1002, 'reserved bits');
      if (hasMask !== this.masked) return this.fail(1002, 'masking');
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.max)) return this.fail(1009, 'too big');
        len = Number(big); off = 10;
      }
      const control = op >= 0x8;
      if (control && (len > 125 || !fin)) return this.fail(1002, 'bad control frame');
      if (!control && len + this.partBytes > this.max) return this.fail(1009, 'too big');
      const keyAt = off;
      if (hasMask) off += 4;
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      if (hasMask) { payload = Buffer.from(payload); for (let i = 0; i < len; i++) payload[i] ^= b[keyAt + (i & 3)]; }
      this.buf = b.length === off + len ? null : b.subarray(off + len);
      if (op === 0x8) { this.done = true; return this.on.close(len >= 2 ? payload.readUInt16BE(0) : 1005); }
      if (op === 0x9) { this.on.ping(payload); continue; }
      if (op === 0xa) { this.on.pong(); continue; }
      if (op === 0x1 || op === 0x2) {
        if (this.parts) return this.fail(1002, 'interleaved message');
        if (fin) { this.deliver(op, payload); continue; }
        this.parts = [payload]; this.partOp = op; this.partBytes = len; continue;
      }
      if (op === 0x0) {
        if (!this.parts) return this.fail(1002, 'stray continuation');
        this.parts.push(payload); this.partBytes += len;
        if (fin) { const all = Buffer.concat(this.parts); const pop = this.partOp; this.parts = null; this.partBytes = 0; this.deliver(pop, all); }
        continue;
      }
      return this.fail(1002, 'unknown opcode');
    }
  }
  deliver(op, payload) {
    if (op === 0x2) return this.fail(1003, 'text only');
    let text;
    try { text = utf8.decode(payload); } catch { return this.fail(1007, 'not utf-8'); }
    this.on.text(text);
  }
  fail(code, why) { this.done = true; this.buf = null; this.parts = null; this.on.fail(code, why); }
}
