// Multiplayer rooms: WebSocket connections grouped by project and room name, with presence and a small shared state.
// Rooms live in memory and are forgotten when the last player leaves. Every count that could grow has a cap.
import { randomBytes } from 'node:crypto';
import { Reader, frame, closeFrame } from './ws.js';
import { KEY, cleanName } from './store.js';

export const ROOM_LIMITS = {
  members: 16, roomsPerProject: 50, rooms: 1000, conns: 600, connsPerProject: 200, connsPerIp: 32,
  msgBytes: 8 * 1024, msgRate: 20, msgBurst: 40, byteRate: 32 * 1024, byteBurst: 128 * 1024,
  stateKeys: 100, stateBytes: 32 * 1024, presenceBytes: 1024, helloMs: 10000, pingMs: 25000, backlog: 256 * 1024,
};
export const ROOM_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;

class Bucket {
  constructor(rate, burst, now) { this.rate = rate; this.burst = burst; this.tokens = burst; this.at = now; }
  take(n, now) {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate); this.at = now;
    if (this.tokens < n) return false;
    this.tokens -= n; return true;
  }
}
const bump = (map, k, d) => { const n = (map.get(k) || 0) + d; if (n > 0) map.set(k, n); else map.delete(k); };

export class Rooms {
  constructor({ limits = {}, identify, now = Date.now, log = () => {} }) {
    this.L = { ...ROOM_LIMITS, ...limits }; this.identify = identify; this.now = now; this.log = log;
    this.rooms = new Map(); this.conns = new Set(); this.perProject = new Map(); this.perIp = new Map(); this.roomsPer = new Map();
    this.timer = setInterval(() => this.heartbeat(), this.L.pingMs); this.timer.unref?.();
  }
  /** Checked before the handshake, so a refused player costs nothing. Returns why not, or null. */
  admit(projectKey, ip) {
    if (this.conns.size >= this.L.conns) return 'busy';
    if ((this.perProject.get(projectKey) || 0) >= this.L.connsPerProject) return 'project_busy';
    if ((this.perIp.get(ip) || 0) >= this.L.connsPerIp) return 'too_many';
    return null;
  }
  accept(socket, head, { projectKey, f, p, room, ip }) {
    const c = new Conn(this, socket, { projectKey, f, p, roomName: room, ip });
    this.conns.add(c); bump(this.perProject, projectKey, 1); bump(this.perIp, ip, 1);
    if (head?.length) c.reader.push(head);
    return c;
  }
  heartbeat() {
    for (const c of this.conns) {
      if (!c.alive) { c.destroy(); continue; }
      c.alive = false; c.write(frame(0x9));
    }
  }
  /** Live numbers for one project: how many rooms are open and how many people are in them. */
  live(projectKey) { return { rooms: this.roomsPer.get(projectKey) || 0, players: this.perProject.get(projectKey) || 0 }; }
  list(projectKey, max = 50) {
    const out = [];
    for (const r of this.rooms.values()) if (r.projectKey === projectKey && out.length < max) out.push({ name: r.name, players: r.members.size, full: r.members.size >= this.L.members });
    return out;
  }
  /** Everyone in a project leaves at once: the admin wiped it, or it went offline. */
  closeProject(projectKey, code = 4004, why = 'closed') { for (const c of [...this.conns]) if (c.projectKey === projectKey) c.close(code, why); }
  close() { clearInterval(this.timer); for (const c of [...this.conns]) c.destroy(); }

  join(c, who, name, presence) {
    const key = `${c.projectKey}\n${c.roomName}`;
    let r = this.rooms.get(key);
    if (!r) {
      if (this.rooms.size >= this.L.rooms || (this.roomsPer.get(c.projectKey) || 0) >= this.L.roomsPerProject) return 'no_rooms';
      r = { key, name: c.roomName, projectKey: c.projectKey, members: new Map(), state: new Map(), stateBytes: 0 };
      this.rooms.set(key, r); bump(this.roomsPer, c.projectKey, 1);
    }
    if (r.members.size >= this.L.members) return 'room_full';
    c.room = r;
    c.member = { id: randomBytes(6).toString('base64url'), name: who.kind === 'user' ? who.name : cleanName(name, 24) || who.name || 'Guest', user: who.uid || null, guest: who.kind !== 'user', presence };
    r.members.set(c.member.id, c);
    return null;
  }
  leave(c) {
    const r = c.room; if (!r) return;
    c.room = null;
    r.members.delete(c.member.id);
    if (!r.members.size) { this.rooms.delete(r.key); bump(this.roomsPer, r.projectKey, -1); return; }
    broadcast(r, { t: 'leave', id: c.member.id });
  }
  gone(c) {
    if (!this.conns.delete(c)) return;
    this.leave(c);
    bump(this.perProject, c.projectKey, -1); bump(this.perIp, c.ip, -1);
  }
}

const memberView = (m) => ({ id: m.id, name: m.name, user: m.user, guest: m.guest, presence: m.presence });
function broadcast(r, msg, except = null) {
  const out = frame(0x1, Buffer.from(JSON.stringify(msg)));
  for (const c of r.members.values()) if (c !== except) c.write(out);
}
const jsonSize = (v) => { try { const s = JSON.stringify(v); return s === undefined ? -1 : Buffer.byteLength(s); } catch { return -1; } };

class Conn {
  constructor(rooms, socket, { projectKey, f, p, roomName, ip }) {
    Object.assign(this, { rooms, socket, projectKey, f, p, roomName, ip });
    const L = rooms.L, t = rooms.now();
    this.alive = true; this.closed = false; this.room = null; this.member = null; this.strikes = 0; this.warned = 0;
    this.msgs = new Bucket(L.msgRate, L.msgBurst, t); this.bytes = new Bucket(L.byteRate, L.byteBurst, t);
    this.reader = new Reader({
      max: L.msgBytes,
      on: {
        text: (s) => this.onText(s),
        ping: (b) => this.write(frame(0xa, b)),
        pong: () => { this.alive = true; },
        close: () => this.close(1000, ''),
        fail: (code) => this.close(code, code === 1009 ? 'message too big' : 'protocol error'),
      },
    });
    socket.setNoDelay?.(true);
    socket.on('data', (d) => { this.alive = true; this.reader.push(d); });
    socket.on('error', () => this.destroy());
    socket.on('close', () => { this.closed = true; this.rooms.gone(this); });
    this.helloTimer = setTimeout(() => { if (!this.member) this.close(4008, 'say hello first'); }, L.helloMs);
    this.helloTimer.unref?.();
  }
  write(buf) {
    if (this.closed || this.socket.destroyed) return;
    // Someone who stops reading doesn't get to pile messages up here.
    if (this.socket.writableLength > this.rooms.L.backlog) { this.destroy(); return; }
    this.socket.write(buf);
  }
  send(msg) { this.write(frame(0x1, Buffer.from(JSON.stringify(msg)))); }
  error(code, message) { this.send({ t: 'error', code, message }); }
  close(code, why) {
    if (this.closed) return;
    this.closed = true; this.reader.done = true; clearTimeout(this.helloTimer);
    try { this.socket.write(closeFrame(code, why)); this.socket.end(); } catch { /* already gone */ }
    const s = this.socket; setTimeout(() => s.destroy(), 1000).unref?.();
    this.rooms.gone(this);
  }
  destroy() { this.closed = true; this.reader.done = true; clearTimeout(this.helloTimer); this.socket.destroy(); this.rooms.gone(this); }

  onText(text) {
    const L = this.rooms.L, t = this.rooms.now();
    if (!this.msgs.take(1, t) || !this.bytes.take(Buffer.byteLength(text), t)) {
      if (++this.strikes > 200) return this.close(1008, 'too many messages');
      if (t - this.warned > 1000) { this.warned = t; this.error('rate_limited', 'Too many messages. Slow down a little.'); }
      return undefined;
    }
    let m;
    try { m = JSON.parse(text); } catch { return this.error('bad_json', 'Messages are JSON.'); }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return this.error('bad_message', 'A message is an object with a type in t.');
    if (!this.member) {
      if (m.t !== 'hello') return this.close(4008, 'say hello first');
      return this.hello(m);
    }
    const r = this.room; const me = this.member;
    if (m.t === 'send') {
      if (m.data === undefined) return this.error('no_data', 'Send some data.');
      return broadcast(r, { t: 'msg', from: me.id, data: m.data }, m.echo ? null : this);
    }
    if (m.t === 'to') {
      const to = r.members.get(String(m.to));
      if (!to) return this.error('no_member', 'That player is not in the room.');
      return to.send({ t: 'msg', from: me.id, data: m.data, direct: true });
    }
    if (m.t === 'set') {
      if (typeof m.key !== 'string' || !KEY.test(m.key)) return this.error('bad_key', 'A key is 1 to 64 letters, digits or _ . : -');
      const prev = r.state.get(m.key);
      if (m.value === null || m.value === undefined) {
        if (prev) { r.state.delete(m.key); r.stateBytes -= prev.size; }
      } else {
        const size = jsonSize(m.value) + m.key.length;
        if (size < 0) return this.error('bad_value', 'That value can\'t be shared.');
        if (!prev && r.state.size >= L.stateKeys) return this.error('state_full', `A room keeps at most ${L.stateKeys} keys.`);
        if (r.stateBytes - (prev?.size || 0) + size > L.stateBytes) return this.error('state_full', 'This room\'s shared state is full.');
        r.state.set(m.key, { value: m.value, size }); r.stateBytes += size - (prev?.size || 0);
      }
      return broadcast(r, { t: 'state', key: m.key, value: m.value ?? null, by: me.id });
    }
    if (m.t === 'presence') {
      const size = jsonSize(m.data ?? null);
      if (size < 0 || size > L.presenceBytes) return this.error('too_large', `Presence is at most ${L.presenceBytes} bytes.`);
      me.presence = m.data ?? null;
      return broadcast(r, { t: 'presence', id: me.id, data: me.presence }, this);
    }
    if (m.t === 'ping') return this.send({ t: 'pong', at: t });
    if (m.t === 'leave') return this.close(1000, 'bye');
    return this.error('bad_type', 'Unknown message type.');
  }
  hello(m) {
    let who;
    try { who = this.rooms.identify(this.f, this.p, m); } catch (e) { this.error(e.code || 'signed_out', e.message); return this.close(4401, 'signed out'); }
    const presence = m.presence === undefined ? null : m.presence;
    const ps = jsonSize(presence);
    if (ps < 0 || ps > this.rooms.L.presenceBytes) { this.error('too_large', 'That presence is too big.'); return this.close(4400, 'bad hello'); }
    const why = this.rooms.join(this, who, m.name, presence);
    if (why) { this.error(why, why === 'room_full' ? 'This room is full.' : 'There are no free rooms right now.'); return this.close(4003, why); }
    clearTimeout(this.helloTimer);
    const r = this.room;
    const others = [...r.members.values()].filter((c) => c !== this).map((c) => memberView(c.member));
    this.send({ t: 'welcome', room: r.name, you: memberView(this.member), members: others, state: Object.fromEntries([...r.state].map(([k, v]) => [k, v.value])), max: this.rooms.L.members });
    broadcast(r, { t: 'join', member: memberView(this.member) }, this);
    return undefined;
  }
}

export const roomNameOk = (s) => typeof s === 'string' && ROOM_NAME.test(s);
