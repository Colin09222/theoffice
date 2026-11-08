// A stand-in for office-runner: the real HTTP API on a real unix socket, with the runner's own rules (runner/src/apps.mjs) for files, manifests, capacity and secrets.
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as A from '../runner/src/apps.mjs';
import { DEFAULTS } from '../runner/src/config.mjs';
import { HttpError } from '../runner/src/util.mjs';

export const FAKE_TOKEN = 'fake-runner-token-0123456789';

export async function fakeRunner({ buildMs = 5, ...limits } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'runner-fake-'));
  const socketPath = join(dir, 'runner.sock'), tokenFile = join(dir, 'api.token');
  writeFileSync(tokenFile, `${FAKE_TOKEN}\n`);
  const cfg = { ...DEFAULTS, ...limits };
  const apps = {};
  const calls = [];
  const state = { killed: false, logs: 'hello from the app\n', failNext: null };
  const status = (a) => {
    if (state.killed) return 'killed';
    if (['queued', 'building'].includes(a.build?.status)) return 'building';
    if (a.build?.status === 'failed' && !a.image) return 'build_failed';
    if (!a.enabled) return 'stopped';
    return a.awake ? 'running' : 'sleeping';
  };
  const describe = (a) => ({
    label: a.label, host: `api--${a.label}.example`, tier: a.tier, status: status(a), enabled: a.enabled, image: a.image, createdAt: a.createdAt, deployedAt: a.deployedAt ?? null, lastTraffic: null,
    lastExit: null, jobsRunning: [], cron: a.cron ?? [], secrets: Object.keys(a.secrets).sort(), limits: {}, build: a.build ? { id: a.build.id, status: a.build.status, startedAt: 1, finishedAt: a.build.finishedAt ?? null, error: a.build.error ?? null } : null,
  });
  const read = (req) => new Promise((resolve, reject) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { const t = Buffer.concat(chunks).toString(); try { resolve(t ? JSON.parse(t) : {}); } catch (e) { reject(e); } }); });
  const send = (res, code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  const need = (label) => { A.assertLabel(label); const a = apps[label]; if (!a) throw new HttpError(404, 'no_app', `No app called ${label}.`); return a; };
  function deploy(label, body) {
    A.assertLabel(label);
    const files = A.checkFiles(body.files, cfg);
    const man = A.readManifest(files, body.tier, cfg);
    const existing = apps[label];
    if (['queued', 'building'].includes(existing?.build?.status)) throw new HttpError(409, 'busy', 'A build for this app is already running.');
    A.checkCapacity(apps, label, man.tier, cfg);
    const a = existing ?? { label, ip: A.allocateIp(apps, cfg), tier: man.tier, image: null, cron: [], enabled: true, createdAt: Date.now(), secrets: {}, files: null };
    a.tier = man.tier; a.files = files;
    a.build = { id: String(Math.random()).slice(2, 10), status: 'queued' };
    apps[label] = a;
    const fail = state.failNext || (files.some((f) => /BUILD_FAIL/.test(String(f.data))) ? { error: 'the build failed (exit 1)', log: 'npm ERR! code E404\nnpm ERR! 404 Not Found: no-such-package@1.0.0\n' } : null);
    state.failNext = null;
    setTimeout(() => {
      if (!apps[label] || apps[label].build?.id !== a.build.id) return;
      if (fail) a.build = { ...a.build, status: 'failed', error: fail.error, log: fail.log, finishedAt: Date.now() };
      else { a.build = { ...a.build, status: 'ok', log: 'added 0 packages\nBUILD-OK\n', finishedAt: Date.now() }; a.image = `office-app/${label}:b1`; a.cron = man.cron; a.deployedAt = Date.now(); }
    }, buildMs);
    return a;
  }
  const server = http.createServer(async (req, res) => {
    calls.push({ method: req.method, path: req.url });
    try {
      if (req.headers.authorization !== `Bearer ${FAKE_TOKEN}`) throw new HttpError(401, 'unauthorized', 'Bad token.');
      const url = new URL(req.url, 'http://runner');
      const parts = url.pathname.split('/').filter(Boolean);
      const [, a, label, action, extra] = parts;
      const m = req.method;
      if (a === 'health') return send(res, 200, { ok: true, apps: Object.keys(apps).length, maxApps: cfg.MAX_APPS, browserApps: Object.values(apps).filter((x) => x.tier === 'browser').length, maxBrowserApps: cfg.MAX_BROWSER_APPS, killed: state.killed });
      if (a === 'kill-all' && m === 'POST' && !label) { state.killed = true; return send(res, 200, { ok: true, killed: Object.keys(apps).length }); }
      if (a === 'kill-all' && m === 'POST' && label === 'release') { state.killed = false; return send(res, 200, { ok: true }); }
      if (a !== 'apps') throw new HttpError(404, 'not_found', 'Not found.');
      if (!label && m === 'GET') return send(res, 200, { apps: Object.values(apps).map(describe), maxApps: cfg.MAX_APPS, maxBrowserApps: cfg.MAX_BROWSER_APPS });
      if (action === 'deploy' && m === 'POST') { const b = await read(req); return send(res, 202, describe(deploy(label, b))); }
      if (!action && m === 'GET') return send(res, 200, describe(need(label)));
      if (!action && m === 'DELETE') { need(label); delete apps[label]; return send(res, 200, { ok: true }); }
      if (action === 'start' && m === 'POST') { const x = need(label); x.enabled = true; x.awake = true; return send(res, 200, describe(x)); }
      if ((action === 'stop' || action === 'sleep') && m === 'POST') { const x = need(label); if (action === 'stop') x.enabled = false; x.awake = false; return send(res, 200, describe(x)); }
      if (action === 'logs' && m === 'GET') { const x = need(label); return send(res, 200, { label, logs: state.logs, jobs: 'job output\n', build: x.build?.log ?? '' }); }
      if (action === 'secrets') {
        const x = need(label);
        if (m === 'GET') return send(res, 200, { names: Object.keys(x.secrets).sort() });
        const b = await read(req);
        const env = m === 'PUT' ? (b.env ?? {}) : { ...x.secrets, ...(b.set ?? {}) };
        if (m === 'PATCH') for (const k of b.unset ?? []) delete env[k];
        A.checkSecrets(env, state.forbidden ?? new Set());
        x.secrets = env; x.awake = false;
        return send(res, 200, { names: Object.keys(env).sort() });
      }
      if (action === 'jobs' && extra && m === 'POST') { need(label); return send(res, 200, { exitCode: 0, timedOut: false, ms: 1 }); }
      throw new HttpError(404, 'not_found', 'Not found.');
    } catch (e) {
      send(res, e.status || 500, { error: e.code || 'internal', message: e.message });
    }
  });
  await new Promise((r) => server.listen(socketPath, r));
  return {
    socketPath, tokenFile, apps, calls, state, cfg, describe,
    /** Fill the building with other people's apps. */
    occupy(n, tier = 'standard') { for (let i = 0; i < n; i++) { const label = `other-${tier}-${Object.keys(apps).length}`; apps[label] = { label, ip: A.allocateIp(apps, cfg), tier, image: 'x', cron: [], enabled: true, createdAt: 1, secrets: {}, build: { id: 'x', status: 'ok' } }; } },
    close: () => new Promise((r) => { server.close(() => { rmSync(dir, { recursive: true, force: true }); r(); }); server.closeAllConnections?.(); }),
  };
}
