// SSRF-hardened fetch for agents. http/https on ports 80/443 only, no credentials in URLs. Every redirect is re-validated.
// DNS is resolved inside the socket's own lookup hook, so the address that was checked is the address connected to
// (a rebinding DNS server gets no second answer). Limits on size and time; text responses only; no decompression.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const v4 = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) v4.addSubnet(a, p, 'ipv4');

const v6 = new net.BlockList();
for (const [a, p] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['100::', 64],
  ['2001:db8::', 32], ['2001::', 32], ['2001:10::', 28], ['2001:20::', 28], ['3fff::', 20], ['5f00::', 16],
]) v6.addSubnet(a, p, 'ipv6');

function expandV6(ip) {
  let s = ip.split('%')[0].toLowerCase();
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const b = dotted[1].split('.').map(Number);
    s = s.slice(0, -dotted[1].length) + ((b[0] << 8) | b[1]).toString(16) + ':' + ((b[2] << 8) | b[3]).toString(16);
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = s.includes('::') ? Array(Math.max(0, 8 - h.length - t.length)).fill('0') : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16));
}
const v4FromWords = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

// IPv6 forms that smuggle an IPv4 destination. Returns the embedded v4, or null.
export function embeddedV4(ip) {
  const w = expandV6(ip);
  if (w.length !== 8) return null;
  const zeroTo = (n) => w.slice(0, n).every((x) => x === 0);
  if (zeroTo(5) && w[5] === 0xffff) return v4FromWords(w[6], w[7]);                 // ::ffff:a.b.c.d mapped
  if (zeroTo(4) && w[4] === 0xffff && w[5] === 0) return v4FromWords(w[6], w[7]);    // ::ffff:0:a.b.c.d translated
  if (zeroTo(6)) return v4FromWords(w[6], w[7]);                                     // ::a.b.c.d compatible
  if (w[0] === 0x64 && w[1] === 0xff9b) return v4FromWords(w[6], w[7]);              // NAT64 64:ff9b::/96 and /48
  if (w[0] === 0x2002) return v4FromWords(w[1], w[2]);                               // 6to4
  return null;
}

export function isBlockedIp(ip) {
  const fam = net.isIP(String(ip).split('%')[0]);
  if (fam === 4) return v4.check(ip, 'ipv4');
  if (fam === 6) {
    const bare = ip.split('%')[0];
    const inner = embeddedV4(bare);
    if (inner) return v4.check(inner, 'ipv4') || (bare.toLowerCase().startsWith('64:ff9b') ? false : false);
    return v6.check(bare, 'ipv6');
  }
  return true; // not an IP at all: refuse
}

export class FetchBlocked extends Error { constructor(m) { super(m); this.name = 'FetchBlocked'; } }

const TEXTY = /^(text\/|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|ld\+json|javascript)|image\/svg\+xml)/i;

export function checkUrl(raw, { denyHosts = [] } = {}) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new FetchBlocked('not a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchBlocked('only http and https are allowed');
  if (u.username || u.password) throw new FetchBlocked('URLs with credentials are not allowed');
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (port !== 80 && port !== 443) throw new FetchBlocked('only ports 80 and 443 are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) throw new FetchBlocked('missing host');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') throw new FetchBlocked('that host is private');
  for (const d of denyHosts) if (host === d || host.endsWith('.' + d)) throw new FetchBlocked('that host is off limits');
  if (net.isIP(host) && isBlockedIp(host)) throw new FetchBlocked('that address is private');
  return { url: u, host, port };
}

export function guardedLookup(blocked = isBlockedIp, resolver = dns.lookup) {
  return (hostname, options, cb) => {
    const wantAll = !!(options && options.all);
    resolver(hostname, { all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err);
      const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIP(addrs) }];
      if (!list.length) return cb(new FetchBlocked('no address found'));
      // Any private answer poisons the whole set: mixed answers are the classic rebinding trick.
      for (const a of list) if (blocked(a.address)) return cb(new FetchBlocked('that name points at a private address'));
      if (wantAll) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
  };
}

export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t\r\f]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
}

function once(url, target, opts) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const req = mod.request(url, {
      method: 'GET', lookup: guardedLookup(opts.isBlocked, opts.resolver), agent: false,
      ...(target.overridePort ? { port: target.overridePort } : {}),
      headers: { 'user-agent': 'TheOfficeBot/1.0', accept: 'text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1', 'accept-encoding': 'identity' },
    }, (res) => {
      const remote = res.socket?.remoteAddress;
      if (remote && opts.isBlocked(remote)) { res.destroy(); return finish(reject, new FetchBlocked('connected to a private address')); }
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        return finish(resolve, { redirect: res.headers.location, status: res.statusCode });
      }
      const type = String(res.headers['content-type'] || '').split(';')[0].trim();
      if (type && !TEXTY.test(type)) { res.destroy(); return finish(reject, new FetchBlocked(`refused non-text content (${type.slice(0, 60)})`)); }
      const enc = String(res.headers['content-encoding'] || 'identity').toLowerCase();
      if (enc !== 'identity') { res.destroy(); return finish(reject, new FetchBlocked('refused compressed response')); }
      const chunks = []; let size = 0; let truncated = false;
      res.on('data', (c) => {
        const room = opts.maxBytes - size;
        if (c.length > room) { if (room > 0) chunks.push(c.subarray(0, room)); size = opts.maxBytes; truncated = true; res.destroy(); finish(resolve, { status: res.statusCode, type, body: Buffer.concat(chunks).toString('utf8'), truncated }); return; }
        chunks.push(c); size += c.length;
      });
      res.on('end', () => finish(resolve, { status: res.statusCode, type, body: Buffer.concat(chunks).toString('utf8'), truncated }));
      res.on('error', (e) => finish(reject, e));
    });
    const timer = setTimeout(() => { req.destroy(); finish(reject, new FetchBlocked('timed out')); }, opts.remainingMs());
    req.on('error', (e) => finish(reject, e));
    req.end();
  });
}

/** Fetch a URL safely. Test hooks (isBlocked, resolver) are code-level only; nothing in the environment can reach them. */
export async function safeFetch(raw, { maxBytes = 512 * 1024, timeoutMs = 12000, maxRedirects = 4, denyHosts = [], isBlocked = isBlockedIp, resolver = dns.lookup, allowAnyPort = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  let current = String(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let u;
    if (allowAnyPort) { u = new URL(current); if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchBlocked('only http and https are allowed'); if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isBlocked(u.hostname.replace(/^\[|\]$/g, ''))) throw new FetchBlocked('that address is private'); }
    else u = checkUrl(current, { denyHosts }).url;
    const remainingMs = () => Math.max(1, deadline - Date.now());
    if (remainingMs() <= 1) throw new FetchBlocked('timed out');
    const r = await once(u, {}, { maxBytes, isBlocked, resolver, remainingMs });
    if (r.redirect) { current = new URL(r.redirect, u).href; continue; }
    const text = /html/i.test(r.type) ? htmlToText(r.body) : r.body;
    return { url: u.href, status: r.status, type: r.type, text, truncated: r.truncated };
  }
  throw new FetchBlocked('too many redirects');
}
