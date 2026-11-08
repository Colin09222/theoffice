import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { createControl } from '../src/control.mjs';
import { setLogSink } from '../src/util.mjs';

http.globalAgent = new http.Agent({ keepAlive: false });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-ctl-'));
const cfg = loadConfig({ file: '/nonexistent', env: {}, overrides: { ROOT: root, WAKE_TIMEOUT_S: 2 } });
for (const d of [cfg.paths.state, cfg.paths.appSecrets, cfg.paths.logs]) fs.mkdirSync(d, { recursive: true });
const API = 'a'.repeat(40);
const EDGE = 'e'.repeat(40);
let clock = Date.parse('2026-11-08T12:00:00Z');
const logs = [];

class FakeDocker {
  constructor() {
    this.c = new Map();
    this.images = new Set([cfg.BASE_STANDARD, cfg.BASE_BROWSER]);
    this.calls = [];
  }
  async inspect(n) {
    return this.c.has(n) ? structuredClone(this.c.get(n)) : null;
  }
  async list() {
    return [...this.c.values()].map((x) => ({ Id: x.Name }));
  }
  async create(n, spec) {
    this.calls.push(['create', n]);
    this.c.set(n, { Name: n, Config: { Labels: spec.Labels, Env: spec.Env ?? [] }, Spec: spec, State: { Running: false, ExitCode: 0 } });
  }
  async start(n) {
    this.calls.push(['start', n]);
    this.c.get(n).State.Running = true;
  }
  async stop(n) {
    this.calls.push(['stop', n]);
    if (this.c.has(n)) this.c.get(n).State.Running = false;
  }
  async kill(n) {
    this.calls.push(['kill', n]);
    if (this.c.has(n)) this.c.get(n).State.Running = false;
  }
  async remove(n) {
    this.c.delete(n);
  }
  async wait(n) {
    this.c.get(n).State.Running = false;
    return { StatusCode: 0 };
  }
  async putArchive(n, dir, tar) {
    this.calls.push(['archive', n, dir, tar.length]);
  }
  async commit(n, repo, tag, config) {
    this.calls.push(['commit', n, `${repo}:${tag}`, config]);
    this.images.add(`${repo}:${tag}`);
  }
  async removeImage(ref) {
    this.images.delete(ref);
  }
  async imageExists(ref) {
    return this.images.has(ref);
  }
  async logs(n) {
    return n.startsWith('office-build-') ? 'added 1 package\nBUILD-OK\n' : 'listening on 8080\n';
  }
  async exec(n, cmd) {
    this.calls.push(['exec', n, cmd]);
    return { exitCode: 0, timedOut: false, output: 'scraped 3 pages\n' };
  }
}
const docker = new FakeDocker();
const volumes = [];
let firewall = true;
const sys = { ensureVolume: async (l) => volumes.push(['ensure', l]), dropVolume: async (l) => volumes.push(['drop', l]), firewallReady: async () => firewall };
const ctl = createControl({ cfg, docker, sys, tokens: { api: API, edge: EDGE }, now: () => clock, probe: async () => true });
let srv, port;

before(async () => {
  setLogSink((line) => logs.push(line));
  srv = ctl.server();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});
after(() => {
  srv.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function call(method, p, body, token = API) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { authorization: `Bearer ${token}`, ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
      let t = '';
      res.on('data', (c) => (t += c));
      res.on('end', () => resolve({ status: res.statusCode, body: t ? JSON.parse(t) : null, raw: t }));
    });
    r.on('error', reject);
    r.end(data);
  });
}
const files = (o) => Object.entries(o).map(([p, v]) => ({ path: p, data: typeof v === 'string' ? v : JSON.stringify(v), encoding: 'utf8' }));
const deploy = (label, extra = {}, f = { 'server.js': 'require("http").createServer().listen(8080)' }) => call('POST', `/v1/apps/${label}/deploy`, { files: files(f), wait: true, ...extra });

test('needs the right token for each side', async () => {
  assert.equal((await call('GET', '/v1/health', undefined, 'wrong')).status, 401);
  assert.equal((await call('GET', '/v1/health', undefined, EDGE)).status, 401); // the edge token can't drive the API
  assert.equal((await call('POST', '/internal/wake/x', undefined, API)).status, 401); // nor the API token the internals
  assert.equal((await call('GET', '/v1/health')).body.maxApps, 4);
});

test('deploy builds under runsc on the build network, then runs with every lock-down flag', async () => {
  const r = await deploy('alpha', {}, { 'package.json': { dependencies: { ws: '8.22.1' }, scripts: { start: 'node server.js' } }, 'server.js': 'x' });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.build.status, 'ok');
  assert.equal(r.body.image, 'office-app/alpha:b1');
  const build = docker.calls.find(([k, n]) => k === 'create' && n === 'office-build-alpha');
  assert.ok(build);
  const archive = docker.calls.find(([k, n]) => k === 'archive' && n === 'office-build-alpha');
  assert.equal(archive[2], '/');
  const wake = await call('POST', '/internal/wake/alpha', undefined, EDGE);
  assert.equal(wake.status, 200);
  assert.deepEqual(wake.body, { ip: '172.30.0.10', port: 8080 });
  const spec = docker.c.get('office-app-alpha').Spec;
  const h = spec.HostConfig;
  assert.equal(h.Runtime, 'runsc');
  assert.equal(spec.User, '10001:10001');
  assert.deepEqual(h.CapDrop, ['ALL']);
  assert.deepEqual(h.SecurityOpt, ['no-new-privileges']);
  assert.equal(h.ReadonlyRootfs, true);
  assert.match(h.Tmpfs['/tmp'], /size=64m/);
  assert.equal(h.PidsLimit, 128);
  assert.equal(h.Memory, 512 * 1048576);
  assert.equal(h.MemorySwap, h.Memory);
  assert.equal(h.NanoCpus, 1e9);
  assert.equal(h.NetworkMode, 'office-apps');
  assert.equal(h.Privileged, undefined);
  assert.equal(h.Binds, undefined);
  assert.deepEqual(h.Mounts.map((m) => [m.Source, m.Target]), [[`${root}/mnt/alpha`, '/data']]);
  assert.ok(!JSON.stringify(spec).includes('docker.sock'));
  assert.equal(spec.NetworkingConfig.EndpointsConfig['office-apps'].IPAMConfig.IPv4Address, '172.30.0.10');
});

test('capacity: 4 apps fit, the 5th is refused with a clear error, browser tier capped at 2', async () => {
  assert.equal((await deploy('beta', { tier: 'browser' })).status, 200);
  assert.equal((await deploy('gamma', { tier: 'browser' })).status, 200);
  const third = await deploy('delta', { tier: 'browser' });
  assert.equal(third.status, 409);
  assert.equal(third.body.error, 'browser_capacity');
  assert.equal((await deploy('delta')).status, 200);
  const fifth = await deploy('epsilon');
  assert.equal(fifth.status, 409);
  assert.equal(fifth.body.error, 'capacity');
  assert.match(fifth.body.message, /4 of 4 apps/);
  assert.equal((await call('GET', '/v1/apps')).body.apps.length, 4);
  const b = docker.c.get('office-build-beta');
  assert.equal(b, undefined); // build containers are removed afterwards
  const bw = await call('POST', '/internal/wake/beta', undefined, EDGE);
  assert.equal(bw.status, 200);
  const spec = docker.c.get('office-app-beta').Spec;
  assert.equal(spec.HostConfig.Memory, 1024 * 1048576);
  assert.equal(spec.HostConfig.PidsLimit, 128);
  assert.ok(spec.Env.includes('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright'));
});

test('secrets reach the app env but never a response, a label or the log', async () => {
  const value = 'sk-test-SECRET-value-123456';
  const r = await call('PUT', '/v1/apps/alpha/secrets', { env: { SCRAPER_KEY: value } });
  assert.deepEqual(r.body, { names: ['SCRAPER_KEY'] });
  assert.equal((await call('PUT', '/v1/apps/alpha/secrets', { env: { PORT: '1' } })).status, 400);
  await call('POST', '/internal/wake/alpha', undefined, EDGE);
  const c = docker.c.get('office-app-alpha');
  assert.ok(c.Config.Env.includes(`SCRAPER_KEY=${value}`));
  assert.ok(!JSON.stringify(c.Config.Labels).includes(value));
  const seen = [JSON.stringify((await call('GET', '/v1/apps/alpha')).body), JSON.stringify((await call('GET', '/v1/apps')).body), (await call('GET', '/v1/apps/alpha/secrets')).raw, logs.join('')];
  for (const s of seen) assert.ok(!s.includes(value));
  const stat = fs.statSync(`${root}/secrets/apps/alpha.json`);
  assert.equal(stat.mode & 0o777, 0o600);
});

test('idle apps sleep; a request wakes them', async () => {
  await call('POST', '/internal/wake/delta', undefined, EDGE);
  assert.equal(docker.c.get('office-app-delta').State.Running, true);
  clock += (cfg.IDLE_MINUTES + 1) * 60000;
  await ctl.idleTick();
  assert.equal(docker.c.get('office-app-delta').State.Running, false);
  assert.equal((await call('GET', '/v1/apps/delta')).body.status, 'sleeping');
  assert.equal((await call('POST', '/internal/wake/delta', undefined, EDGE)).status, 200);
  assert.equal(docker.c.get('office-app-delta').State.Running, true);
});

test('a scheduled job wakes a sleeping app and lets it sleep again when done', async () => {
  const r = await deploy('delta', {}, { 'server.js': 'x', 'office.json': { cron: [{ name: 'scrape', schedule: '*/30 * * * *', run: 'node job.js' }] } });
  assert.equal(r.status, 200, r.raw);
  assert.equal(docker.c.get('office-app-delta'), undefined); // redeploy replaced the container
  clock = Date.parse('2026-11-08T14:30:00Z');
  ctl.cronTick(new Date(clock));
  await new Promise((res) => setTimeout(res, 100));
  const ex = docker.calls.filter(([k, n]) => k === 'exec' && n === 'office-app-delta').pop();
  assert.deepEqual(ex[2].slice(0, 4), ['timeout', '-s', 'KILL', String(cfg.JOB_TIMEOUT_MIN * 60)]);
  assert.equal(docker.c.get('office-app-delta').State.Running, false);
  const l = await call('GET', '/v1/apps/delta/logs');
  assert.match(l.body.jobs, /job scrape \(schedule\) exit=0/);
  assert.match(l.body.jobs, /scraped 3 pages/);
  assert.match(l.body.logs, /listening on 8080/);
  assert.match(l.body.build, /BUILD-OK/);
});

test('stop keeps an app down until started; kill-all stops everything and blocks wakes', async () => {
  await call('POST', '/v1/apps/gamma/stop');
  const w = await call('POST', '/internal/wake/gamma', undefined, EDGE);
  assert.equal(w.status, 503);
  assert.equal(w.body.error, 'stopped');
  assert.equal((await call('POST', '/v1/apps/gamma/start')).body.status, 'running');
  const k = await call('POST', '/v1/kill-all');
  assert.equal(k.status, 200);
  assert.ok(k.body.killed >= 1);
  for (const c of docker.c.values()) assert.equal(c.State.Running, false);
  assert.equal((await call('POST', '/internal/wake/alpha', undefined, EDGE)).body.error, 'killed');
  assert.equal((await call('GET', '/v1/health')).body.killed, true);
  await call('POST', '/v1/kill-all/release');
  assert.equal((await call('POST', '/internal/wake/alpha', undefined, EDGE)).status, 200);
});

test('TLS ask knows deployed labels only; delete frees the slot', async () => {
  assert.equal((await call('GET', '/internal/known/alpha', undefined, EDGE)).status, 200);
  assert.equal((await call('GET', '/internal/known/zzz', undefined, EDGE)).status, 404);
  assert.equal((await call('DELETE', '/v1/apps/gamma')).status, 200);
  assert.ok(volumes.some(([k, l]) => k === 'drop' && l === 'gamma'));
  assert.equal((await call('GET', '/internal/known/gamma', undefined, EDGE)).status, 404);
  assert.equal((await deploy('epsilon')).status, 200);
});

test('fails closed: no firewall, no app start', async () => {
  firewall = false;
  await call('POST', '/v1/apps/alpha/sleep');
  const r = await call('POST', '/internal/wake/alpha', undefined, EDGE);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'no_firewall');
  firewall = true;
  assert.equal((await call('POST', '/internal/wake/alpha', undefined, EDGE)).status, 200);
});

test('bad input is refused before anything runs', async () => {
  assert.equal((await call('POST', '/v1/apps/Bad_Name/deploy', { files: files({ 'server.js': 'x' }) })).status, 400);
  assert.equal((await call('POST', '/v1/apps/zeta/deploy', { files: files({ '../evil.js': 'x' }) })).status, 400);
  assert.equal((await call('POST', '/v1/apps/zeta/deploy', { files: [] })).status, 400);
});
