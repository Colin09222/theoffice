// office-runner edge: the only part that touches internet traffic. Runs unprivileged (systemd
// DynamicUser, no capabilities, read-only filesystem) and talks to the control daemon with its own
// token. It does three things:
//   1. api--<label>.middistance.com from Caddy -> wake the app if needed -> proxy (HTTP + WebSockets)
//   2. the on-demand TLS ask for those names (only labels the runner knows)
//   3. the build-time egress proxy: CONNECT to an allowlist of hosts on 443, nothing else
import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import { hostLabel } from './apps.mjs';
import { log, sendJson, sendText } from './util.mjs';

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const INTERNAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function createEdge({ cfg, control, now = Date.now }) {
  const routes = new Map(); // label -> { ip, port, until }
  const waking = new Map(); // label -> Promise
  const traffic = new Map(); // label -> last traffic ms, flushed to control
  const conns = new Map(); // label -> open connections
  const known = new Map(); // label -> until (positive TLS-ask answers)

  const touch = (label) => traffic.set(label, now());

  async function route(label, fresh = false) {
    const r = routes.get(label);
    if (!fresh && r && r.until > now()) return r;
    if (!waking.has(label)) {
      const p = control('POST', `/internal/wake/${label}`)
        .then(({ status, body }) => {
          if (status !== 200) {
            routes.delete(label);
            const e = new Error(body?.message ?? 'wake failed');
            e.status = status;
            e.code = body?.error;
            throw e;
          }
          const v = { ip: body.ip, port: body.port, until: now() + 10000 };
          routes.set(label, v);
          return v;
        })
        .finally(() => waking.delete(label));
      waking.set(label, p);
    }
    return waking.get(label);
  }

  function failPage(res, e) {
    const status = e.status === 404 ? 404 : e.status === 503 || e.status === 502 || e.status === 504 ? e.status : 502;
    const msg = status === 404 ? 'There is no app at this address.' : e.message || 'The app is not available.';
    sendText(res, status, msg + '\n', status === 503 ? { 'retry-after': '30' } : {});
  }

  function forwardHeaders(req, label) {
    const h = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) h[k] = v;
    h['x-forwarded-host'] = req.headers.host;
    h['x-forwarded-proto'] = 'https';
    h['x-office-app'] = label;
    return h;
  }

  // Apps may only set host-only cookies: a Domain=middistance.com cookie would reach every other
  // project and app on the domain.
  function cleanResponseHeaders(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
      if (HOP.has(k)) continue;
      if (k === 'set-cookie') out[k] = [].concat(v).map((c) => c.replace(/;\s*domain=[^;]*/gi, ''));
      else out[k] = v;
    }
    return out;
  }

  // Counts requests in flight and open WebSockets per app (Caddy reuses sockets across apps).
  function track(label, emitter) {
    conns.set(label, (conns.get(label) ?? 0) + 1);
    emitter.once('close', () => conns.set(label, Math.max(0, (conns.get(label) ?? 1) - 1)));
  }

  async function proxyHttp(req, res, label, retried = false) {
    let r;
    try {
      r = await route(label, retried);
    } catch (e) {
      return failPage(res, e);
    }
    touch(label);
    let bytes = 0;
    const max = cfg.MAX_BODY_MB * 1048576;
    const up = http.request({ host: r.ip, port: r.port, method: req.method, path: req.url, headers: forwardHeaders(req, label), timeout: 120000 }, (ur) => {
      res.writeHead(ur.statusCode, cleanResponseHeaders(ur.headers));
      ur.on('data', () => touch(label));
      ur.pipe(res);
    });
    up.on('timeout', () => up.destroy(new Error('upstream timeout')));
    up.on('error', (e) => {
      const bodyless = !req.headers['content-length'] && !req.headers['transfer-encoding'];
      if (!retried && !res.headersSent && bytes === 0 && bodyless && ['ECONNREFUSED', 'EHOSTUNREACH', 'ECONNRESET'].includes(e.code)) {
        routes.delete(label);
        return proxyHttp(req, res, label, true);
      }
      if (!res.headersSent) sendText(res, 502, 'The app did not answer.\n');
      else res.destroy();
    });
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > max) {
        up.destroy();
        if (!res.headersSent) sendText(res, 413, 'Request body too large.\n');
        req.destroy();
      }
    });
    req.pipe(up);
  }

  async function proxyUpgrade(req, sock, head, label) {
    sock.on('error', () => {});
    let r;
    try {
      r = await route(label);
    } catch (e) {
      return sock.end(`HTTP/1.1 ${e.status === 404 ? 404 : 503} Unavailable\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
    }
    touch(label);
    const up = net.connect({ host: r.ip, port: r.port });
    up.setTimeout(30000, () => up.destroy());
    up.on('connect', () => {
      up.setTimeout(0);
      const h = forwardHeaders(req, label);
      h.connection = 'Upgrade';
      h.upgrade = req.headers.upgrade;
      let head1 = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(h)) for (const one of [].concat(v)) head1 += `${k}: ${String(one).replace(/[\r\n]/g, '')}\r\n`;
      up.write(head1 + '\r\n');
      if (head?.length) up.write(head);
      up.on('data', () => touch(label));
      sock.on('data', () => touch(label));
      up.pipe(sock);
      sock.pipe(up);
    });
    // When either side finishes, give the other a moment to finish too, then drop both, so no
    // half-closed socket is left behind.
    const finish = () => setTimeout(() => (up.destroy(), sock.destroy()), 5000).unref();
    sock.on('end', finish);
    up.on('end', finish);
    up.on('error', () => sock.destroy());
    sock.on('close', () => up.destroy());
    up.on('close', () => sock.destroy());
  }

  async function tlsAsk(res, url) {
    const label = hostLabel(url.searchParams.get('domain') ?? '', cfg);
    if (!label) return sendText(res, 404, 'no\n');
    if ((known.get(label) ?? 0) > now()) return sendText(res, 200, 'ok\n');
    const { status } = await control('GET', `/internal/known/${label}`).catch(() => ({ status: 503 }));
    if (status === 200) known.set(label, now() + 60000);
    return sendText(res, status === 200 ? 200 : 404, status === 200 ? 'ok\n' : 'no\n');
  }

  const appServer = http.createServer((req, res) => {
    const host = (req.headers.host ?? '').toLowerCase();
    const label = hostLabel(host, cfg);
    if (label) {
      if ((conns.get(label) ?? 0) >= cfg.MAX_CONNS_PER_APP) return sendText(res, 503, 'Too many connections to this app.\n', { 'retry-after': '5' });
      track(label, res);
      return proxyHttp(req, res, label).catch(() => (res.headersSent ? res.destroy() : sendText(res, 502, 'The app did not answer.\n')));
    }
    let url;
    try {
      url = new URL(req.url, 'http://edge');
    } catch {
      return sendText(res, 400, 'Bad request.\n');
    }
    if (INTERNAL_HOSTS.has(host.replace(/:\d+$/, '')) && url.pathname === '/__office_runner/tls-ask' && req.method === 'GET') {
      return tlsAsk(res, url).catch(() => sendText(res, 503, 'no\n'));
    }
    if (INTERNAL_HOSTS.has(host.replace(/:\d+$/, '')) && url.pathname === '/__office_runner/health') return sendJson(res, 200, { ok: true });
    sendText(res, 404, 'There is no app at this address.\n');
  });
  appServer.on('connection', (sock) => sock.setNoDelay(true));
  appServer.on('upgrade', (req, sock, head) => {
    const label = hostLabel(req.headers.host ?? '', cfg);
    if (!label) return sock.end('HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n');
    if ((conns.get(label) ?? 0) >= cfg.MAX_CONNS_PER_APP) return sock.end('HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\n\r\n');
    track(label, sock);
    proxyUpgrade(req, sock, head, label).catch(() => sock.destroy());
  });
  appServer.headersTimeout = 30000;
  appServer.requestTimeout = 0; // long uploads and streams are fine; idle sockets are not
  appServer.keepAliveTimeout = 65000;

  // ---- build egress proxy ----
  const allow = new Set(cfg.EGRESS_ALLOW.map((h) => h.toLowerCase()));
  const egressServer = http.createServer((req, res) => sendText(res, 405, 'CONNECT only.\n'));
  egressServer.on('connect', async (req, sock, head) => {
    sock.on('error', () => {});
    const m = /^([a-z0-9.-]+):(\d+)$/i.exec(req.url ?? '');
    const host = m?.[1].toLowerCase();
    if (!m || m[2] !== '443' || !allow.has(host)) {
      log('egress.denied', { target: String(req.url).slice(0, 100) });
      return sock.end('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n');
    }
    let addr;
    try {
      addr = (await dns.lookup(host, { all: true, family: 4 })).map((a) => a.address).find(isPublicV4);
    } catch {}
    if (!addr) return sock.end('HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n');
    const up = net.connect({ host: addr, port: 443 });
    up.setTimeout(120000, () => up.destroy());
    sock.setTimeout(120000, () => sock.destroy());
    up.on('connect', () => {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) up.write(head);
      up.pipe(sock);
      sock.pipe(up);
    });
    up.on('error', () => sock.destroy());
    up.on('close', () => sock.destroy());
    sock.on('close', () => up.destroy());
  });

  async function flushActivity() {
    // Forget what nobody uses any more, so made-up api--<label> hosts can't grow these maps.
    const t = now();
    for (const [k, v] of conns) if (v === 0) conns.delete(k);
    for (const [k, v] of routes) if (v.until < t) routes.delete(k);
    for (const [k, v] of known) if (v < t) known.delete(k);
    if (traffic.size === 0) return;
    const labels = Object.fromEntries(traffic);
    traffic.clear();
    await control('POST', '/internal/activity', { labels }).catch(() => {});
  }

  return { appServer, egressServer, flushActivity, routes };
}

export function isPublicV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !(x >= 0 && x <= 255))) return false;
  const [a, b] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
}

// Calls the control daemon. Resolves { status, body }.
export function controlClient({ host, port, token, timeoutMs = 60000 }) {
  return (method, path, json) =>
    new Promise((resolve, reject) => {
      const payload = json === undefined ? null : Buffer.from(JSON.stringify(json));
      const req = http.request(
        { host, port, method, path, timeout: timeoutMs, headers: { authorization: `Bearer ${token}`, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            let body = null;
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {}
            resolve({ status: res.statusCode, body });
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('control timeout')));
      req.on('error', reject);
      req.end(payload);
    });
}

async function main() {
  const fs = await import('node:fs');
  const { loadConfig } = await import('./config.mjs');
  const cfg = loadConfig();
  const tokenFile = process.env.CREDENTIALS_DIRECTORY ? `${process.env.CREDENTIALS_DIRECTORY}/edge-token` : cfg.paths.edgeToken;
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const edge = createEdge({ cfg, control: controlClient({ host: cfg.CONTROL_HOST, port: cfg.CONTROL_PORT, token, timeoutMs: (cfg.WAKE_TIMEOUT_S + 15) * 1000 }) });
  edge.appServer.listen(cfg.EDGE_PORT, cfg.EDGE_HOST, () => log('edge.listening', { port: cfg.EDGE_PORT }));
  // The egress proxy binds to the office-build bridge address, which exists once Docker has the network.
  const bindEgress = () =>
    edge.egressServer
      .once('error', (e) => {
        log('egress.bind_retry', { err: e.code });
        setTimeout(bindEgress, 10000);
      })
      .listen(cfg.EGRESS_PORT, cfg.EGRESS_HOST, () => log('egress.listening', { host: cfg.EGRESS_HOST, port: cfg.EGRESS_PORT }));
  bindEgress();
  setInterval(() => edge.flushActivity(), 10000).unref();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    log('edge.fatal', { err: e.message });
    process.exit(1);
  });
}
