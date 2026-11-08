import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { after, before, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { createEdge } from '../src/edge.mjs';

const cfg = loadConfig({ file: '/nonexistent', env: {} });
http.globalAgent = new http.Agent({ keepAlive: false }); // no pooled sockets left open after the tests
let app, edge, edgePort, appPort;
const calls = [];

before(async () => {
  app = http.createServer((req, res) => {
    if (req.url === '/cookie') {
      res.writeHead(200, { 'set-cookie': ['a=1; Domain=middistance.com; Path=/; Secure', 'b=2; Path=/'] });
      return res.end('ok');
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, url: req.url, host: req.headers.host, xfh: req.headers['x-forwarded-host'], app: req.headers['x-office-app'], body }));
    });
  });
  app.on('upgrade', (req, sock) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sock.on('data', (d) => sock.write(d)); // echo
    sock.on('end', () => sock.end());
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  appPort = app.address().port;
  const control = async (method, path, json) => {
    calls.push([method, path, json]);
    if (path === '/internal/wake/good') return { status: 200, body: { ip: '127.0.0.1', port: appPort } };
    if (path === '/internal/wake/off') return { status: 503, body: { error: 'stopped', message: 'This app is switched off.' } };
    if (path === '/internal/known/good') return { status: 200, body: { ok: true } };
    if (path === '/internal/activity') return { status: 200, body: { ok: true } };
    return { status: 404, body: { error: 'no_app', message: 'No app.' } };
  };
  edge = createEdge({ cfg, control });
  await new Promise((r) => edge.appServer.listen(0, '127.0.0.1', r));
  edgePort = edge.appServer.address().port;
});
after(() => {
  edge.appServer.close();
  app.close();
  edge.appServer.closeAllConnections?.();
  app.closeAllConnections?.();
});

function req(host, path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: edgePort, method, path, headers: { host } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

test('proxies HTTP to the woken app with the original host', async () => {
  const r = await req('api--good.middistance.com', '/hello?x=1', { method: 'POST', body: 'payload' });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.deepEqual([j.method, j.url, j.host, j.app, j.body], ['POST', '/hello?x=1', 'api--good.middistance.com', 'good', 'payload']);
  assert.ok(calls.some(([m, p]) => m === 'POST' && p === '/internal/wake/good'));
});

test('apps can only set host-only cookies', async () => {
  const r = await req('api--good.middistance.com', '/cookie');
  assert.deepEqual(r.headers['set-cookie'], ['a=1; Path=/; Secure', 'b=2; Path=/']);
});

test('unknown hosts get 404 and stopped apps 503, without reaching any app', async () => {
  assert.equal((await req('api--nope.middistance.com', '/')).status, 404);
  assert.equal((await req('other.middistance.com', '/')).status, 404);
  const off = await req('api--off.middistance.com', '/');
  assert.equal(off.status, 503);
  assert.match(off.body, /switched off/);
});

test('TLS ask only says yes to labels the runner knows, and only on the loopback host', async () => {
  assert.equal((await req('127.0.0.1:8090', '/__office_runner/tls-ask?domain=api--good.middistance.com')).status, 200);
  assert.equal((await req('127.0.0.1:8090', '/__office_runner/tls-ask?domain=api--nope.middistance.com')).status, 404);
  assert.equal((await req('127.0.0.1:8090', '/__office_runner/tls-ask?domain=good.middistance.com')).status, 404);
  assert.equal((await req('127.0.0.1:8090', '/__office_runner/tls-ask?domain=api--good.evil.com')).status, 404);
  // From a public host name the path goes to the app like any other path.
  const viaApp = await req('api--good.middistance.com', '/__office_runner/tls-ask?domain=api--good.middistance.com');
  assert.equal(JSON.parse(viaApp.body).url, '/__office_runner/tls-ask?domain=api--good.middistance.com');
});

test('WebSockets are proxied both ways', async () => {
  const key = crypto.randomBytes(16).toString('base64');
  const sock = await new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: edgePort, path: '/ws', headers: { host: 'api--good.middistance.com', connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': key, 'sec-websocket-version': '13' } });
    r.on('upgrade', (res, s) => {
      assert.equal(res.statusCode, 101);
      resolve(s);
    });
    r.on('response', (res) => reject(new Error(`no upgrade: ${res.statusCode}`)));
    r.on('error', reject);
    r.end();
  });
  const echoed = await new Promise((resolve) => {
    sock.once('data', (d) => resolve(d.toString()));
    sock.write('ping-123');
  });
  assert.equal(echoed, 'ping-123');
  sock.destroy();
});

test('malformed requests are refused without taking the edge down', async () => {
  const raw = (text) =>
    new Promise((resolve) => {
      const s = net.connect(edgePort, '127.0.0.1', () => s.write(text));
      let d = '';
      s.on('data', (c) => (d += c));
      s.on('close', () => resolve(d.split('\r\n')[0]));
      s.on('error', () => resolve('error'));
      setTimeout(() => s.destroy(), 2000);
    });
  await raw('GET http://[::1 HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
  await raw('GET /a b HTTP/1.1\r\nHost: api--good.middistance.com\r\nConnection: close\r\n\r\n');
  assert.equal((await req('api--good.middistance.com', '/still-up')).status, 200);
});

test('activity is reported to the control daemon', async () => {
  await req('api--good.middistance.com', '/');
  await edge.flushActivity();
  const act = calls.filter(([, p]) => p === '/internal/activity').pop();
  assert.ok(act && act[2].labels.good > 0);
});

test('egress proxy: CONNECT only to allowlisted hosts on 443', async () => {
  await new Promise((r) => edge.egressServer.listen(0, '127.0.0.1', r));
  const port = edge.egressServer.address().port;
  const connect = (target) =>
    new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
      s.once('data', (d) => (resolve(d.toString().split('\r\n')[0]), s.destroy()));
      s.on('error', () => resolve('error'));
    });
  assert.match(await connect('example.com:443'), /403/);
  assert.match(await connect('registry.npmjs.org:80'), /403/);
  assert.match(await connect('169.254.169.254:443'), /403/);
  assert.match(await connect('registry.npmjs.org.evil.com:443'), /403/);
  const plain = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: 'http://registry.npmjs.org/' }, (res) => (res.resume(), resolve(res.statusCode))));
  assert.equal(plain, 405);
  edge.egressServer.close();
  edge.egressServer.closeAllConnections();
});
