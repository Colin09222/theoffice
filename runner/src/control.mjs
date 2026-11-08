// office-runner control daemon. Runs as root under systemd: it owns Docker, the per-app data
// volumes, secrets and schedules. Listens on loopback (and a unix socket) only; every call needs a
// bearer token. The internet-facing proxy is a separate, unprivileged process (edge.mjs).
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { promisify } from 'node:util';
import * as A from './apps.mjs';
import { cronMatches, parseCron } from './cron.mjs';
import { makeTar } from './tar.mjs';
import { HttpError, bearer, keyedLock, log, readJson, readSecretFile, sendJson, sleep, tail, tokenMatches, writeFileAtomic } from './util.mjs';

const execFileP = promisify(execFile);

export function tcpProbe(host, port, ms = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => (s.destroy(), resolve(ok));
    s.setTimeout(ms, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

export function createControl({ cfg, docker, sys, tokens, now = Date.now, probe = tcpProbe }) {
  const P = cfg.paths;
  const withLock = keyedLock();
  const uid = cfg.APP_UID;
  const user = `${uid}:${uid}`;
  const rts = new Map(); // in-memory per-app runtime facts
  let state = loadState();
  let buildChain = Promise.resolve(); // builds run one at a time

  function loadState() {
    try {
      const s = JSON.parse(fs.readFileSync(P.apps, 'utf8'));
      return { apps: s.apps ?? {} };
    } catch (e) {
      if (e.code === 'ENOENT') return { apps: {} };
      throw e;
    }
  }
  const save = () => writeFileAtomic(P.apps, JSON.stringify(state, null, 1));
  const rt = (label) => {
    if (!rts.has(label)) rts.set(label, { lastTraffic: 0, startedAt: 0, jobs: new Set(), fails: [], backoffUntil: 0 });
    return rts.get(label);
  };
  const killed = () => fs.existsSync(P.killed);
  const cname = (label) => `office-app-${label}`;
  const bname = (label) => `office-build-${label}`;
  const getApp = (label) => {
    A.assertLabel(label);
    const app = state.apps[label];
    if (!app) throw new HttpError(404, 'no_app', `No app called ${label}.`);
    return app;
  };

  // ---- secrets (root-only files; values never logged or returned) ----
  const secretsFile = (label) => `${P.appSecrets}/${label}.json`;
  function loadSecrets(label) {
    try {
      return JSON.parse(fs.readFileSync(secretsFile(label), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return {};
      throw e;
    }
  }
  function forbiddenHashes() {
    try {
      return new Set(fs.readFileSync(P.forbiddenHashes, 'utf8').split(/\s+/).filter((x) => /^[0-9a-f]{64}$/.test(x)));
    } catch {
      return new Set();
    }
  }
  function saveSecrets(app, env) {
    A.checkSecrets(env, forbiddenHashes());
    fs.mkdirSync(P.appSecrets, { recursive: true, mode: 0o700 });
    writeFileAtomic(secretsFile(app.label), JSON.stringify(env), 0o600);
    app.secretsVersion = (app.secretsVersion ?? 0) + 1;
    save();
    return Object.keys(env).sort();
  }

  // ---- container spec ----
  function appEnv(app) {
    const env = [`PORT=${cfg.APP_PORT}`, 'HOME=/tmp', 'TMPDIR=/tmp', 'NODE_ENV=production', `OFFICE_APP=${app.label}`, 'OFFICE_DATA_DIR=/data', `OFFICE_HOST=${A.appHost(app.label, cfg)}`];
    if (app.tier === 'browser') env.push('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
    return env;
  }
  function appSpec(app) {
    const t = cfg.TIERS[app.tier];
    const secretEnv = Object.entries(loadSecrets(app.label)).map(([k, v]) => `${k}=${v}`);
    const spec = {
      Image: app.image,
      User: user,
      WorkingDir: '/app',
      Cmd: ['sh', '-c', `exec ${app.start}`],
      Env: [...appEnv(app), ...secretEnv],
      Hostname: app.label,
      StopTimeout: 5,
      Labels: { 'office.runner': 'app', 'office.app': app.label, 'office.tier': app.tier },
      HostConfig: {
        Runtime: cfg.RUNTIME,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': `rw,nosuid,nodev,noexec,size=${t.tmpMb}m,mode=1777` },
        ShmSize: t.shmMb * 1048576,
        PidsLimit: cfg.PIDS_LIMIT,
        Memory: t.memoryMb * 1048576,
        MemorySwap: t.memoryMb * 1048576,
        NanoCpus: Math.round(t.cpus * 1e9),
        Ulimits: [
          { Name: 'nofile', Soft: 4096, Hard: 8192 },
          { Name: 'core', Soft: 0, Hard: 0 },
        ],
        Mounts: [{ Type: 'bind', Source: `${P.mnt}/${app.label}`, Target: '/data', BindOptions: { Propagation: 'rprivate' } }],
        NetworkMode: cfg.APPS_NETWORK,
        RestartPolicy: { Name: 'no' },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '2m', 'max-file': '2' } },
      },
      NetworkingConfig: { EndpointsConfig: { [cfg.APPS_NETWORK]: { IPAMConfig: { IPv4Address: app.ip } } } },
    };
    // The label holds a hash of the spec with the secret values swapped for a version number, so a
    // changed secret or setting re-creates the container without the values ending up in a label.
    const fingerprint = JSON.stringify({ ...spec, Env: appEnv(app), secrets: app.secretsVersion ?? 0, names: secretEnv.map((e) => e.split('=')[0]) });
    spec.Labels['office.spec'] = crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32);
    return spec;
  }

  async function ensureContainer(app) {
    const spec = appSpec(app);
    const c = await docker.inspect(cname(app.label));
    if (c && c.Config?.Labels?.['office.spec'] === spec.Labels['office.spec']) return c;
    if (c) await docker.remove(cname(app.label));
    await docker.create(cname(app.label), spec);
    return docker.inspect(cname(app.label));
  }

  async function waitReady(app) {
    const deadline = now() + cfg.WAKE_TIMEOUT_S * 1000;
    let checks = 0;
    while (now() < deadline) {
      if (await probe(app.ip, cfg.APP_PORT)) return;
      if (++checks % 8 === 0) {
        const c = await docker.inspect(cname(app.label));
        if (!c?.State?.Running) throw new HttpError(502, 'app_exited', `The app exited during start (code ${c?.State?.ExitCode ?? '?'}${c?.State?.OOMKilled ? ', out of memory' : ''}). See its logs.`);
      }
      await sleep(250);
    }
    throw new HttpError(504, 'not_listening', `The app did not listen on port ${cfg.APP_PORT} within ${cfg.WAKE_TIMEOUT_S}s.`);
  }

  function refuseIfDown(app) {
    if (killed()) throw new HttpError(503, 'killed', 'All apps were stopped by the building (kill switch).');
    if (!app.enabled) throw new HttpError(503, 'stopped', 'This app is switched off.');
    if (!app.image) throw new HttpError(503, app.build?.status === 'failed' ? 'build_failed' : 'building', app.build?.status === 'failed' ? 'The last build failed.' : 'The app is still being built.');
  }

  // Starts the app if needed and resolves once it accepts connections.
  async function wake(label, reason) {
    const app = getApp(label);
    refuseIfDown(app);
    return withLock(label, async () => {
      refuseIfDown(app);
      const r = rt(label);
      if (r.backoffUntil > now()) throw new HttpError(503, 'crashing', 'The app keeps crashing; it will be retried in a few minutes. See its logs.');
      await sys.ensureVolume(label);
      const c = await ensureContainer(app);
      if (!c.State.Running) {
        await docker.start(cname(label));
        r.startedAt = now();
        log('app.start', { app: label, reason });
      }
      try {
        await waitReady(app);
      } catch (e) {
        r.fails = r.fails.filter((t) => t > now() - 600000).concat(now());
        if (r.fails.length >= 3) r.backoffUntil = now() + 300000;
        log('app.start_failed', { app: label, code: e.code });
        throw e;
      }
      return { ip: app.ip, port: cfg.APP_PORT };
    });
  }

  async function isRunning(label) {
    const c = await docker.inspect(cname(label));
    return Boolean(c?.State?.Running);
  }

  async function sleepApp(label, reason) {
    return withLock(label, async () => {
      if (rt(label).jobs.size > 0 && reason === 'idle') return false;
      if (!(await isRunning(label))) return false;
      await docker.stop(cname(label), 5);
      log('app.sleep', { app: label, reason });
      return true;
    });
  }

  // ---- idle sleeper ----
  async function idleTick() {
    for (const app of Object.values(state.apps)) {
      const r = rt(app.label);
      try {
        if (!(await isRunning(app.label))) continue;
        if (killed() || !app.enabled) {
          await sleepApp(app.label, killed() ? 'killed' : 'disabled');
          continue;
        }
        if (r.jobs.size > 0) continue;
        const last = Math.max(r.lastTraffic, r.startedAt);
        if (now() - last > cfg.IDLE_MINUTES * 60000) await sleepApp(app.label, 'idle');
      } catch (e) {
        log('idle.error', { app: app.label, err: e.message });
      }
    }
  }

  // ---- scheduled jobs ----
  const jobLogFile = (label) => `${P.logs}/${label}.jobs.log`;
  function appendJobLog(label, text) {
    const f = jobLogFile(label);
    let old = '';
    try {
      old = fs.readFileSync(f, 'utf8');
    } catch {}
    writeFileAtomic(f, tail(old + text, 128 * 1024), 0o600);
  }

  async function runJob(label, name, why) {
    const app = getApp(label);
    const job = app.cron.find((j) => j.name === name);
    if (!job) throw new HttpError(404, 'no_job', `No job called ${name}.`);
    refuseIfDown(app);
    const r = rt(label);
    if (r.jobs.has(name)) return { skipped: 'still running' };
    r.jobs.add(name);
    const startedAt = now();
    let wasRunning = true;
    let result;
    try {
      wasRunning = await isRunning(label);
      await wake(label, `job:${name}`);
      const secs = job.timeoutMinutes * 60;
      log('job.start', { app: label, job: name, why });
      const res = await docker.exec(cname(label), ['timeout', '-s', 'KILL', String(secs), 'sh', '-c', job.run], { user, timeoutMs: (secs + 30) * 1000 });
      result = { exitCode: res.exitCode, timedOut: res.timedOut || res.exitCode === 137, ms: now() - startedAt };
      appendJobLog(label, `\n[${new Date(startedAt).toISOString()}] job ${name} (${why}) exit=${res.exitCode}${result.timedOut ? ' (killed: time limit)' : ''} ${result.ms}ms\n${tail(res.output, 16384)}`);
      log('job.end', { app: label, job: name, exit: res.exitCode, ms: result.ms });
    } catch (e) {
      result = { error: e.message };
      appendJobLog(label, `\n[${new Date(startedAt).toISOString()}] job ${name} (${why}) could not run: ${e.message}\n`);
      log('job.error', { app: label, job: name, err: e.code ?? 'error' });
    } finally {
      r.jobs.delete(name);
      // A job only keeps the app awake while it runs: if it was asleep and nobody visited meanwhile,
      // it goes straight back to sleep.
      if (!wasRunning && r.jobs.size === 0 && r.lastTraffic < startedAt) await sleepApp(label, 'job-done').catch(() => {});
    }
    return result;
  }

  function cronTick(date) {
    if (killed()) return;
    for (const app of Object.values(state.apps)) {
      if (!app.enabled || !app.image) continue;
      for (const job of app.cron ?? []) {
        let c;
        try {
          c = parseCron(job.schedule);
        } catch {
          continue;
        }
        if (cronMatches(c, date)) runJob(app.label, job.name, 'schedule').catch((e) => log('job.error', { app: app.label, job: job.name, err: e.code ?? e.message }));
      }
    }
  }

  // ---- builds ----
  function buildScript(man) {
    const proxy = `http://${cfg.EGRESS_HOST}:${cfg.EGRESS_PORT}`;
    const lines = [
      'set -e',
      `export HOME=/tmp/build-home npm_config_cache=/tmp/npm-cache CI=1`,
      `export HTTPS_PROXY=${proxy} HTTP_PROXY=${proxy} https_proxy=${proxy} http_proxy=${proxy} npm_config_proxy=${proxy} npm_config_https_proxy=${proxy}`,
      'export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false npm_config_loglevel=warn',
      'mkdir -p "$HOME" && cd /app',
      'if [ -f package.json ]; then',
      '  if [ -f package-lock.json ]; then npm ci; else npm install --no-package-lock; fi',
      `  if node -e "process.exit((require('./package.json').scripts||{}).build?0:1)"; then npm run build; fi`,
      '  npm prune --omit=dev',
      'fi',
    ];
    if (man.tier === 'browser') {
      lines.push(
        'export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
        'if [ -f node_modules/playwright-core/package.json ]; then',
        `  v=$(node -p "require('./node_modules/playwright-core/package.json').version")`,
        `  if [ "$v" != "${cfg.PLAYWRIGHT_VERSION}" ]; then echo "playwright $v differs from the base (${cfg.PLAYWRIGHT_VERSION}), downloading its browser"; node node_modules/playwright-core/cli.js install chromium; fi`,
        'fi',
      );
    }
    lines.push('rm -rf /tmp/build-home /tmp/npm-cache', 'echo BUILD-OK');
    return lines.join('\n');
  }

  function appTar(files) {
    const dirs = new Set();
    for (const f of files) for (let d = f.path.split('/').slice(0, -1); d.length; d.pop()) dirs.add(d.join('/'));
    const entries = [{ path: 'app', type: 'dir', uid, gid: uid, mode: 0o755 }];
    for (const d of [...dirs].sort()) entries.push({ path: `app/${d}`, type: 'dir', uid, gid: uid, mode: 0o755 });
    for (const f of files) entries.push({ path: `app/${f.path}`, type: 'file', data: f.data, uid, gid: uid, mode: f.mode });
    return makeTar(entries);
  }

  async function doBuild(label, buildId, files, man) {
    const app = state.apps[label];
    if (!app || app.build?.id !== buildId) return;
    app.build = { ...app.build, status: 'building', startedAt: now() };
    save();
    const base = man.tier === 'browser' ? cfg.BASE_BROWSER : cfg.BASE_STANDARD;
    const b = bname(label);
    let logText = '';
    try {
      if (!(await docker.imageExists(base))) throw new Error(`base image ${base} is missing; run deploy/install.sh`);
      await docker.remove(b);
      const t = cfg.BUILD_MEMORY_MB * 1048576;
      await docker.create(b, {
        Image: base,
        User: user,
        WorkingDir: '/',
        Cmd: ['sh', '-c', buildScript(man)],
        Labels: { 'office.runner': 'build', 'office.app': label },
        HostConfig: {
          Runtime: cfg.RUNTIME,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          PidsLimit: cfg.BUILD_PIDS_LIMIT,
          Memory: t,
          MemorySwap: t,
          NanoCpus: Math.round(cfg.BUILD_CPUS * 1e9),
          NetworkMode: cfg.BUILD_NETWORK,
          RestartPolicy: { Name: 'no' },
          LogConfig: { Type: 'json-file', Config: { 'max-size': '5m', 'max-file': '1' } },
        },
      });
      await docker.putArchive(b, '/', appTar(files));
      await docker.start(b);
      const limit = cfg.BUILD_TIMEOUT_MIN * 60000;
      let timer;
      const res = await Promise.race([docker.wait(b, limit + 30000), new Promise((r) => (timer = setTimeout(() => r(null), limit)))]);
      clearTimeout(timer);
      if (!res) await docker.kill(b);
      logText = await docker.logs(b, 400).catch(() => '');
      if (!res) throw new Error(`the build took longer than ${cfg.BUILD_TIMEOUT_MIN} minutes`);
      if (res.StatusCode !== 0 || !logText.includes('BUILD-OK')) throw new Error(`the build failed (exit ${res.StatusCode})`);
      const seq = (app.buildSeq ?? 0) + 1;
      const image = `office-app/${label}:b${seq}`;
      await docker.commit(b, `office-app/${label}`, `b${seq}`, {
        User: user,
        WorkingDir: '/app',
        Cmd: ['sh', '-c', `exec ${man.start}`],
        Labels: { 'office.runner': 'image', 'office.app': label },
      });
      await withLock(label, async () => {
        if (state.apps[label] !== app) return;
        const prev = app.image;
        const wasUp = await isRunning(label);
        Object.assign(app, { image, buildSeq: seq, tier: man.tier, start: man.start, cron: man.cron, deployedAt: now() });
        app.build = { ...app.build, status: 'ok', finishedAt: now(), error: null, log: tail(logText, 16384) };
        save();
        await docker.remove(cname(label));
        if (prev && prev !== image) await docker.removeImage(prev);
        log('build.ok', { app: label, image, ms: app.build.finishedAt - app.build.startedAt });
        if (wasUp) rt(label).lastTraffic = now();
      });
    } catch (e) {
      app.build = { ...app.build, status: 'failed', finishedAt: now(), error: e.message, log: tail(logText, 16384) };
      save();
      log('build.failed', { app: label, err: e.message });
    } finally {
      await docker.remove(b).catch(() => {});
    }
  }

  async function deploy(label, body) {
    A.assertLabel(label);
    const files = A.checkFiles(body.files, cfg);
    const man = A.readManifest(files, body.tier, cfg);
    const result = await withLock(label, async () => {
      const existing = state.apps[label];
      if (existing && ['queued', 'building'].includes(existing.build?.status)) throw new HttpError(409, 'busy', 'A build for this app is already running.');
      A.checkCapacity(state.apps, label, man.tier, cfg);
      const app = existing ?? { label, ip: A.allocateIp(state.apps, cfg), tier: man.tier, image: null, buildSeq: 0, start: man.start, cron: [], enabled: true, createdAt: now() };
      const buildId = crypto.randomBytes(6).toString('hex');
      app.build = { id: buildId, status: 'queued', queuedAt: now(), tier: man.tier };
      state.apps[label] = app;
      save();
      await sys.ensureVolume(label);
      log('deploy.queued', { app: label, build: buildId, tier: man.tier, files: files.length });
      return { app, buildId };
    });
    const done = (buildChain = buildChain.then(() => doBuild(label, result.buildId, files, man)).catch((e) => log('build.error', { app: label, err: e.message })));
    if (body.wait) await done;
    return result.app;
  }

  async function removeApp(label, keepData) {
    const app = getApp(label);
    return withLock(label, async () => {
      await docker.remove(cname(label));
      await docker.remove(bname(label));
      if (app.image) await docker.removeImage(app.image);
      if (!keepData) await sys.dropVolume(label);
      fs.rmSync(secretsFile(label), { force: true });
      fs.rmSync(jobLogFile(label), { force: true });
      delete state.apps[label];
      rts.delete(label);
      save();
      log('app.deleted', { app: label, keepData: Boolean(keepData) });
    });
  }

  async function killAll() {
    fs.writeFileSync(P.killed, new Date(now()).toISOString() + '\n', { mode: 0o600 });
    const list = await docker.list('office.runner');
    await Promise.all(list.map((c) => docker.kill(c.Id)));
    log('kill-all', { containers: list.length });
    return list.length;
  }

  async function describe(app, withContainer = true) {
    const c = withContainer ? await docker.inspect(cname(app.label)) : null;
    const running = Boolean(c?.State?.Running);
    let status = running ? 'running' : 'sleeping';
    if (!app.image) status = app.build?.status === 'failed' ? 'build_failed' : 'building';
    else if (!app.enabled) status = 'stopped';
    if (killed()) status = 'killed';
    const r = rt(app.label);
    const t = cfg.TIERS[app.tier];
    return {
      label: app.label,
      host: A.appHost(app.label, cfg),
      tier: app.tier,
      status,
      enabled: app.enabled,
      image: app.image,
      createdAt: app.createdAt,
      deployedAt: app.deployedAt ?? null,
      lastTraffic: r.lastTraffic || null,
      lastExit: !running && c?.State ? { code: c.State.ExitCode, oomKilled: c.State.OOMKilled, at: c.State.FinishedAt } : null,
      jobsRunning: [...r.jobs],
      cron: app.cron ?? [],
      secrets: Object.keys(loadSecrets(app.label)).sort(),
      limits: { memoryMb: t.memoryMb, cpus: t.cpus, pids: cfg.PIDS_LIMIT, tmpMb: t.tmpMb, dataMb: cfg.DATA_MB },
      build: app.build ? { id: app.build.id, status: app.build.status, startedAt: app.build.startedAt ?? null, finishedAt: app.build.finishedAt ?? null, error: app.build.error ?? null } : null,
    };
  }

  // ---- HTTP API ----
  async function handle(req, res) {
    const url = new URL(req.url, 'http://runner');
    const parts = url.pathname.split('/').filter(Boolean);
    const m = req.method;
    const tok = bearer(req);
    if (parts[0] === 'internal') {
      if (!tokenMatches(tok, tokens.edge)) throw new HttpError(401, 'unauthorized', 'Bad token.');
      if (m === 'POST' && parts[1] === 'wake' && parts.length === 3) {
        rt(parts[2]).lastTraffic = now();
        return sendJson(res, 200, await wake(parts[2], 'request'));
      }
      if (m === 'GET' && parts[1] === 'known' && parts.length === 3) {
        return sendJson(res, A.validLabel(parts[2]) && state.apps[parts[2]] ? 200 : 404, { ok: Boolean(state.apps[parts[2]]) });
      }
      if (m === 'POST' && parts[1] === 'activity' && parts.length === 2) {
        const b = await readJson(req, 16384);
        for (const [label, ts] of Object.entries(b.labels ?? {})) {
          if (state.apps[label] && Number.isFinite(ts)) rt(label).lastTraffic = Math.max(rt(label).lastTraffic, Math.min(ts, now()));
        }
        return sendJson(res, 200, { ok: true });
      }
      throw new HttpError(404, 'not_found', 'Not found.');
    }
    if (parts[0] !== 'v1') throw new HttpError(404, 'not_found', 'Not found.');
    if (!tokenMatches(tok, tokens.api)) throw new HttpError(401, 'unauthorized', 'Bad token.');
    const [, a, label, action, extra] = parts;
    if (a === 'health' && m === 'GET') {
      const apps = Object.values(state.apps);
      return sendJson(res, 200, { ok: true, apps: apps.length, maxApps: cfg.MAX_APPS, browserApps: apps.filter((x) => x.tier === 'browser').length, maxBrowserApps: cfg.MAX_BROWSER_APPS, killed: killed() });
    }
    if (a === 'kill-all' && m === 'POST' && !label) return sendJson(res, 200, { ok: true, killed: await killAll() });
    if (a === 'kill-all' && m === 'POST' && label === 'release') {
      fs.rmSync(P.killed, { force: true });
      log('kill-all.released');
      return sendJson(res, 200, { ok: true });
    }
    if (a !== 'apps') throw new HttpError(404, 'not_found', 'Not found.');
    if (!label && m === 'GET') return sendJson(res, 200, { apps: await Promise.all(Object.values(state.apps).map((x) => describe(x))), maxApps: cfg.MAX_APPS, maxBrowserApps: cfg.MAX_BROWSER_APPS });
    if (!label) throw new HttpError(405, 'method', 'Method not allowed.');
    if (action === 'deploy' && m === 'POST') {
      const body = await readJson(req, Math.ceil(cfg.MAX_UPLOAD_MB * 1.4 * 1048576) + 65536);
      const app = await deploy(label, body);
      return sendJson(res, body.wait ? 200 : 202, await describe(app));
    }
    if (!action && m === 'GET') return sendJson(res, 200, await describe(getApp(label)));
    if (!action && m === 'DELETE') {
      await removeApp(label, url.searchParams.get('keepData') === '1');
      return sendJson(res, 200, { ok: true });
    }
    if (action === 'start' && m === 'POST') {
      const app = getApp(label);
      app.enabled = true;
      rt(label).backoffUntil = 0;
      save();
      await wake(label, 'api');
      return sendJson(res, 200, await describe(app));
    }
    if ((action === 'stop' || action === 'sleep') && m === 'POST') {
      const app = getApp(label);
      if (action === 'stop') {
        app.enabled = false;
        save();
      }
      await sleepApp(label, action);
      return sendJson(res, 200, await describe(app));
    }
    if (action === 'logs' && m === 'GET') {
      const app = getApp(label);
      const n = Math.min(1000, Math.max(1, Number(url.searchParams.get('tail') ?? 200) || 200));
      let jobs = '';
      try {
        jobs = tail(fs.readFileSync(jobLogFile(label), 'utf8'), 32768);
      } catch {}
      return sendJson(res, 200, { label, logs: tail(await docker.logs(cname(label), n), 256 * 1024), jobs, build: app.build?.log ?? '' });
    }
    if (action === 'secrets') {
      const app = getApp(label);
      if (m === 'GET') return sendJson(res, 200, { names: Object.keys(loadSecrets(label)).sort() });
      const b = await readJson(req, 262144);
      let env;
      if (m === 'PUT') env = b.env ?? {};
      else if (m === 'PATCH') {
        env = { ...loadSecrets(label), ...(b.set ?? {}) };
        for (const k of b.unset ?? []) delete env[k];
      } else throw new HttpError(405, 'method', 'Method not allowed.');
      const names = await withLock(label, async () => saveSecrets(app, env));
      log('secrets.set', { app: label, count: names.length });
      if (await isRunning(label)) {
        await sleepApp(label, 'secrets-changed'); // the next request starts it with the new env
      }
      return sendJson(res, 200, { names });
    }
    if (action === 'jobs' && extra && m === 'POST') return sendJson(res, 200, await runJob(label, extra, 'manual'));
    throw new HttpError(404, 'not_found', 'Not found.');
  }

  function server() {
    return http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) log('api.error', { path: req.url?.split('?')[0], err: e.message });
        if (!res.headersSent) sendJson(res, status, { error: e instanceof HttpError ? e.code : 'internal', message: e instanceof HttpError ? e.message : 'Something went wrong in the runner.' });
        else res.destroy();
      });
    });
  }

  async function boot() {
    for (const app of Object.values(state.apps)) {
      await sys.ensureVolume(app.label).catch((e) => log('volume.error', { app: app.label, err: e.message }));
      if (['queued', 'building'].includes(app.build?.status)) {
        app.build = { ...app.build, status: 'failed', error: 'the runner restarted during the build', finishedAt: now() };
        await docker.remove(bname(app.label)).catch(() => {});
      }
    }
    save();
  }

  return { handle, server, boot, idleTick, cronTick, wake, deploy, runJob, killAll, state: () => state, rt };
}

// Loop-mounted ext4 images give each app a /data with a hard size limit.
export function realSys(cfg) {
  const P = cfg.paths;
  const mounted = (dir) => fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some((l) => l.split(' ')[4] === dir);
  return {
    async ensureVolume(label) {
      const img = `${P.volumes}/${label}.img`;
      const mnt = `${P.mnt}/${label}`;
      if (mounted(mnt)) return;
      fs.mkdirSync(mnt, { recursive: true, mode: 0o755 });
      if (!fs.existsSync(img)) {
        const fd = fs.openSync(img, 'wx', 0o600);
        fs.ftruncateSync(fd, cfg.DATA_MB * 1048576);
        fs.closeSync(fd);
        await execFileP('mkfs.ext4', ['-q', '-F', '-m', '0', '-E', `root_owner=${cfg.APP_UID}:${cfg.APP_UID}`, img]);
      }
      await execFileP('mount', ['-o', 'loop,nosuid,nodev,noexec', img, mnt]);
    },
    async dropVolume(label) {
      const mnt = `${P.mnt}/${label}`;
      if (mounted(mnt)) await execFileP('umount', [mnt]);
      fs.rmSync(`${P.volumes}/${label}.img`, { force: true });
      fs.rmSync(mnt, { recursive: true, force: true });
    },
  };
}

async function main() {
  const { loadConfig } = await import('./config.mjs');
  const { Docker } = await import('./docker.mjs');
  const cfg = loadConfig();
  const P = cfg.paths;
  for (const d of [P.state, P.secrets, P.appSecrets, P.volumes, P.logs]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.mkdirSync(P.mnt, { recursive: true, mode: 0o711 });
  const tokens = { api: readSecretFile(P.apiToken), edge: readSecretFile(P.edgeToken) };
  const ctl = createControl({ cfg, docker: new Docker(), sys: realSys(cfg), tokens });
  await ctl.boot();
  ctl.server().listen(cfg.CONTROL_PORT, cfg.CONTROL_HOST, () => log('control.listening', { port: cfg.CONTROL_PORT }));
  if (cfg.CONTROL_SOCKET) {
    const dir = cfg.CONTROL_SOCKET.slice(0, cfg.CONTROL_SOCKET.lastIndexOf('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o750);
    fs.chownSync(dir, 0, cfg.CONTROL_SOCKET_GID);
    fs.rmSync(cfg.CONTROL_SOCKET, { force: true });
    ctl.server().listen(cfg.CONTROL_SOCKET, () => {
      fs.chmodSync(cfg.CONTROL_SOCKET, 0o660);
      fs.chownSync(cfg.CONTROL_SOCKET, 0, cfg.CONTROL_SOCKET_GID);
      log('control.socket', { path: cfg.CONTROL_SOCKET });
    });
  }
  setInterval(() => ctl.idleTick().catch((e) => log('idle.error', { err: e.message })), 20000).unref();
  const tick = () => setTimeout(() => (ctl.cronTick(new Date()), tick()), 60000 - (Date.now() % 60000) + 300);
  tick();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    log('control.fatal', { err: e.message });
    process.exit(1);
  });
}
