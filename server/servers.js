// Server slots: real server code for a project, in the sandboxed containers on this host (office-runner). The building has very few, so the first deploy
// needs the boss's tap and a redeploy of a project that has been allowed one does not. Most projects should stay on Office Cloud. See docs/OFFICE-RUNNER.md.
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { get, all, run, tx } from './db.js';
import { WorkspaceError, writeFile } from './workspace.js';
import { appLabel, appOrigin } from './apps.js';
import { createRunnerClient, serversOn, RunnerError } from './runner.js';
import { wrapUntrusted } from './tools.js';
import { STARTERS_DIR } from './makers.js';

export const CLOUD_PATH = '/api/app-cloud';  // under the Office's base path: where server code reaches its own project's Office Cloud
const TOKEN_RE = /^ofs_[A-Za-z0-9_-]{43}$/;
const SERVER_FOLDER = 'server';
const NOT_SENT = /(^|\/)(node_modules|\.git|\.office)(\/|$)/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const RUNNER_ENV = new Set(['PORT', 'HOME', 'PATH', 'TMPDIR', 'HOSTNAME', 'NODE_ENV', 'PLAYWRIGHT_BROWSERS_PATH']);
// The runner allows 32 per app, and four are the Office's own.
export const MAX_BOSS_ENV = 28;
const MAX_ENV_BYTES = 4096;
const MAX_FILES = 3000;
const MAX_BYTES = 20 * 1048576;
const CHECK_BYTES = 64 * 1024;
const LOG_BYTES = 64 * 1024;
const REASK_MS = 10 * 60000;
const MAX_WAITING = 3;

export const managedEnv = (name) => name.startsWith('OFFICE_');
export const serverUrlFor = (cfg, label) => `${cfg.appsScheme}://api--${label}.${cfg.appsBaseDomain}`;
const tokenHash = (t) => createHash('sha256').update(t).digest('hex');

export class ServerError extends Error { constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; } }

export function ensureServerSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS server_apps (
    floor_id INTEGER NOT NULL, project TEXT NOT NULL, label TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'awaiting_boss',
    tier TEXT NOT NULL DEFAULT 'standard', why TEXT NOT NULL DEFAULT '', agent_id INTEGER, token_hash TEXT,
    building INTEGER NOT NULL DEFAULT 0, env_ok INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (floor_id, project)
  );
  CREATE INDEX IF NOT EXISTS server_apps_token ON server_apps(token_hash);`);
}

/** Every value a building key could be: anything secret in the Office's settings or its environment. A boss's own key for their own app is fine; these never are. */
export function buildingSecrets(cfg, env = process.env) {
  const out = new Set();
  const take = (v) => { if (typeof v === 'string' && v.length >= 12) out.add(v); };
  for (const [k, v] of Object.entries(env)) if (/(^|_)(KEY|SECRET|TOKEN|PASSWORD|PASS)(_|$)/i.test(k)) take(v);
  for (const [k, v] of Object.entries(cfg)) if (/(key|secret|token|password)$/i.test(k)) take(v);
  return out;
}

/** What a boss may put in an app's environment. Throws in plain words, and never with the value in the message. */
export function checkBossEnv(change, cfg, env = process.env) {
  const set = change?.set ?? {}, unset = change?.unset ?? [];
  const bad = (msg) => new ServerError(400, 'bad_env', msg);
  if (typeof set !== 'object' || Array.isArray(set) || !Array.isArray(unset)) throw bad('Send names and values.');
  const names = Object.keys(set);
  if (names.length > MAX_BOSS_ENV || unset.length > MAX_BOSS_ENV) throw bad(`At most ${MAX_BOSS_ENV} settings per server.`);
  const keys = buildingSecrets(cfg, env);
  for (const n of [...names, ...unset]) {
    if (typeof n !== 'string' || !ENV_NAME.test(n)) throw bad('Names are capital letters, digits and underscores, like MY_API_KEY.');
    if (managedEnv(n) || RUNNER_ENV.has(n)) throw bad(`${n} is set by the building.`);
  }
  for (const n of names) {
    const v = set[n];
    if (typeof v !== 'string' || !v || Buffer.byteLength(v) > MAX_ENV_BYTES || v.includes('\0')) throw bad(`${n} needs a value, up to 4 KB of text.`);
    for (const k of keys) if (v.includes(k)) throw new ServerError(400, 'building_key', `${n} holds one of the building's own keys, and apps never get those. Use your own key, or office.ai through Office Cloud.`);
  }
  return { set, unset };
}

/** A server's own request, as a token holder: only ever the project the token was made for. */
export const bearerToken = (req) => {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S{1,200})$/i);
  return m && TOKEN_RE.test(m[1]) ? m[1] : null;
};

export function findByToken(db, token) {
  return get(db, "SELECT s.floor_id, s.project, s.label FROM server_apps s JOIN floors f ON f.id=s.floor_id WHERE s.token_hash=? AND s.status='approved' AND f.status='active'", tokenHash(token)) || null;
}

const redact = (s) => String(s ?? '').replace(/ofs_[A-Za-z0-9_-]{20,}/g, 'ofs_[hidden]');
const clip = (s, max) => (s.length > max ? `…\n${s.slice(-max)}` : s);

export function createServers({ db, cfg, engine, httpFetch = fetch }) {
  ensureServerSchema(db);
  const client = createRunnerClient(cfg);
  const on = () => serversOn(cfg);
  const url = (label) => serverUrlFor(cfg, label);
  const rowFor = (floorId, project) => get(db, 'SELECT * FROM server_apps WHERE floor_id=? AND project=?', floorId, project);
  const set = (r, cols) => {
    const keys = Object.keys(cols);
    run(db, `UPDATE server_apps SET ${keys.map((k) => `${k}=?`).join(',')},updated_at=? WHERE floor_id=? AND project=?`, ...keys.map((k) => cols[k]), engine.now(), r.floor_id, r.project);
    Object.assign(r, cols);
  };
  // A private project's name doesn't go in anything a visitor could read.
  const nameOf = (r) => (get(db, 'SELECT private FROM projects WHERE floor_id=? AND slug=?', r.floor_id, r.project)?.private ? 'your private server' : `the server for ${r.project}`);
  let health = null;
  async function slots() {
    const h = await client.health();
    health = { used: h.apps, max: h.maxApps, browserUsed: h.browserApps, browserMax: h.maxBrowserApps, killed: !!h.killed };
    return health;
  }

  /** Spelled out once so the Builder and the boss hear the same thing. */
  const words = (e) => ({
    capacity: 'Every server slot in the building is in use right now.', browser_capacity: 'Every place for a server with a real browser is in use right now.',
    busy: 'A build for this server is already running. Wait for it, then check server_status.', runner_down: 'The server room isn\'t answering right now. Try again in a few minutes.',
    no_app: 'That server isn\'t on the runner any more.', killed: 'The building has switched off all servers for now.',
  }[e.code] || String(e.message).slice(0, 600));
  const forTool = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { if (e instanceof RunnerError) throw new WorkspaceError(words(e)); throw e; } };
  function asBoss(e) {
    if (e instanceof RunnerError) return new ServerError(e.status >= 500 ? 503 : 409, e.code, words(e));
    return e;
  }

  // ---- the server folder ----
  function collect(floorId, project) {
    const prefix = `projects/${project}/${SERVER_FOLDER}/`;
    const rows = all(db, 'SELECT path,content,size FROM files WHERE floor_id=? AND path LIKE ? ORDER BY path', floorId, `${prefix}%`).filter((f) => !NOT_SENT.test(f.path.slice(prefix.length)));
    if (!rows.length) throw new WorkspaceError(`there is no server code yet. Put it in projects/${project}/${SERVER_FOLDER}/ (server_starter makes a working one) and save it first.`);
    if (rows.length > MAX_FILES) throw new WorkspaceError(`the server folder has too many files (at most ${MAX_FILES})`);
    if (rows.reduce((n, r) => n + r.size, 0) > MAX_BYTES) throw new WorkspaceError('the server folder is over 20 MB. Leave node_modules out, the build installs them.');
    const text = (rel) => { const r = rows.find((x) => x.path === prefix + rel); return r ? String(typeof r.content === 'string' ? r.content : Buffer.from(r.content)) : null; };
    const parse = (rel) => {
      const t = text(rel);
      if (t === null) return null;
      let v; try { v = JSON.parse(t); } catch (e) { throw new WorkspaceError(`${rel} is not valid JSON: ${String(e.message).slice(0, 140)}`); }
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new WorkspaceError(`${rel} must be a JSON object`);
      return v;
    };
    const office = parse('office.json'), pkg = parse('package.json');
    if (!office?.start && !pkg?.scripts?.start && !pkg?.main && !['server.js', 'index.js', 'app.js'].some((n) => text(n) !== null)) throw new WorkspaceError('nothing to start: add "start" to office.json, a start script to package.json, or a server.js');
    const files = rows.map((r) => {
      const path = r.path.slice(prefix.length), bin = typeof r.content !== 'string';
      return { path, data: bin ? Buffer.from(r.content).toString('base64') : r.content, encoding: bin ? 'base64' : 'utf8', ...(path.endsWith('.sh') ? { executable: true } : {}) };
    });
    return { files, tier: office?.tier === 'browser' ? 'browser' : 'standard' };
  }

  // ---- labels and the environment the Office gives an app ----
  /** Fixed the first time, so launching the project later (a short address) can't move a running server. Runner names stop at 58 characters. */
  function allocateLabel(floor, project) {
    const base = appLabel(db, floor, project);
    for (let i = 0; i < 6; i++) {
      const tag = createHash('sha256').update(`${floor.id}:${project}:${i}`).digest('hex').slice(0, 8);
      const label = !i && base.length <= 58 ? base : `${base.slice(0, 49).replace(/-+$/, '')}-${tag}`;
      if (!get(db, 'SELECT 1 x FROM server_apps WHERE label=?', label)) return label;
    }
    throw new WorkspaceError('could not find a free name for this server');
  }
  /** Every address the project's pages can be on: what its server should allow in CORS. */
  function siteOrigins(floorId, project) {
    const labels = all(db, 'SELECT label FROM app_labels WHERE floor_id=? AND project=? UNION SELECT label FROM app_short_labels WHERE floor_id=? AND project=?', floorId, project, floorId, project);
    return [...labels.map((l) => appOrigin(cfg, l.label)), ...all(db, "SELECT domain FROM domain_orders WHERE floor_id=? AND project=? AND status='live'", floorId, project).map((d) => `${cfg.appsScheme}://${d.domain}`)];
  }
  const cloudUrl = () => `${cfg.publicOrigin || `http://127.0.0.1:${cfg.port}`}/theoffice${CLOUD_PATH}`;
  async function pushEnv(r) {
    let names = [];
    try { names = (await client.secretNames(r.label)).names || []; } catch (e) { if (!(e instanceof RunnerError) || e.status !== 404) throw e; }
    const env = { OFFICE_CLOUD_URL: cloudUrl(), OFFICE_SERVER_URL: url(r.label), OFFICE_SITE_ORIGINS: siteOrigins(r.floor_id, r.project).join(',') };
    let minted = null;
    if (!r.token_hash || !names.includes('OFFICE_TOKEN')) { minted = `ofs_${randomBytes(32).toString('base64url')}`; env.OFFICE_TOKEN = minted; }
    await client.patchSecrets(r.label, { set: env });
    set(r, minted ? { token_hash: tokenHash(minted), env_ok: 1 } : { env_ok: 1 });
  }

  // ---- building ----
  /** The app exists on the runner once this returns, so the slot is held. A failed build keeps it, and a fix is one more deploy. */
  async function startBuild(r, built) {
    await client.deploy(r.label, { files: built.files });
    set(r, { building: 1, tier: built.tier, note: '' });
    try { await pushEnv(r); } catch (e) { set(r, { env_ok: 0 }); engine.log?.('error', 'servers env', { err: String(e?.message).slice(0, 200) }); }
  }
  const claim = (r) => !!run(db, 'UPDATE server_apps SET building=0, updated_at=? WHERE floor_id=? AND project=? AND building=1', engine.now(), r.floor_id, r.project).changes;
  const done = (a) => ['ok', 'failed'].includes(a?.build?.status);
  async function failure(r, a) {
    let log = '';
    try { log = String((await client.logs(r.label, 1)).build || ''); } catch { /* the reason alone will do */ }
    return `The build failed: ${redact(a.build?.error || 'no reason given')}\n\nLast lines of the build log:\n${clip(redact(log), 6000) || '(empty)'}`;
  }
  const wrap = (r, text) => wrapUntrusted(`server: ${r.project}`, text);
  /** A build nobody is waiting on. The manager hears it the way it hears anything from outside the floor: fenced, and woken for it. */
  async function tell(r, a) {
    const ok = a.build.status === 'ok';
    engine.bossNotice(r.floor_id, ok ? `${nameOf(r)[0].toUpperCase()}${nameOf(r).slice(1)} is built and ready. It wakes on its first visit.` : `${nameOf(r)[0].toUpperCase()}${nameOf(r).slice(1)} didn't build. The team has the error.`);
    const said = ok ? `The server for ${r.project} built and is at ${url(r.label)}. Have the Tester check its health endpoint and one real flow with server_check.` : `The server for ${r.project} did not build. Have the Builder read this, fix projects/${r.project}/${SERVER_FOLDER}/ and call deploy_server again: ${wrap(r, await failure(r, a))}`;
    tx(db, () => { engine.addMessage(r.floor_id, 'note', null, said); run(db, 'UPDATE floors SET manager_wake=1 WHERE id=?', r.floor_id); });
    engine.emit(r.floor_id, 'reload', {}, { persist: false });
    engine.kick();
  }
  let ticking = false;
  // A Builder waiting on its own deploy hears the result from the tool; the tick only tells the floor about builds nobody is waiting on.
  const waiting = new Set();
  const key = (r) => `${r.floor_id}:${r.project}`;
  async function tick() {
    if (ticking || !on()) return;
    ticking = true;
    try {
      await slots().catch(() => {});
      for (const r of all(db, 'SELECT * FROM server_apps WHERE building=1 LIMIT 20')) {
        if (waiting.has(key(r))) continue;
        try {
          const a = await client.get(r.label);
          if (done(a) && claim(r)) await tell(r, a);
        } catch (e) {
          if (e instanceof RunnerError && e.status === 404) { claim(r); set(r, { status: 'removed', token_hash: null }); } else engine.log?.('error', 'servers tick', { err: String(e?.message).slice(0, 200) });
        }
      }
      for (const r of all(db, "SELECT * FROM server_apps WHERE status='approved' AND building=0 AND env_ok=0 LIMIT 20")) await pushEnv(r).catch(() => {});
      // A floor that was wiped or closed: its server goes too, and its row stays until the runner has really let go of it.
      for (const r of all(db, "SELECT * FROM server_apps WHERE status='removing' LIMIT 20")) {
        try { await client.remove(r.label); } catch (e) { if (!(e instanceof RunnerError) || e.status !== 404) continue; }
        run(db, "DELETE FROM server_apps WHERE floor_id=? AND project=? AND status='removing'", r.floor_id, r.project);
      }
    } finally { ticking = false; }
  }

  // ---- what the staff can do ----
  function ask(c, project, why, built, prev) {
    if (prev?.status === 'declined' && engine.now() - prev.updated_at < REASK_MS) throw new WorkspaceError('the boss said no to this server a moment ago. Stay on Office Cloud, or ask them in chat first.');
    if (get(db, "SELECT COUNT(*) n FROM server_apps WHERE floor_id=? AND status='awaiting_boss'", c.floor.id).n >= MAX_WAITING) throw new WorkspaceError('the boss already has server requests waiting');
    const t = engine.now(), label = prev?.label ?? allocateLabel(c.floor, project);
    run(db, `INSERT INTO server_apps (floor_id,project,label,status,tier,why,agent_id,building,env_ok,note,created_at,updated_at) VALUES (?,?,?,'awaiting_boss',?,?,?,0,0,'',?,?)
      ON CONFLICT(floor_id,project) DO UPDATE SET status='awaiting_boss', tier=excluded.tier, why=excluded.why, agent_id=excluded.agent_id, note='', updated_at=excluded.updated_at`, c.floor.id, project, label, built.tier, why, c.agent?.id ?? null, t, t);
    engine.emit(c.floor.id, 'domain', {}, { ownerOnly: true, persist: false });
    c.say('typing', 'Asking for a server', `asked the boss for a server slot for ${project}`, { project });
    const room = health && health.used >= health.max ? ' Right now the building is full, so they may need to free a slot first.' : '';
    return `Asked. A server uses one of the building's few slots, so nothing is deployed until the boss taps yes under Requests.${room} Tell them it is waiting, and carry on with anything else.`;
  }
  async function waitFor(r, ms) {
    const end = engine.now() + ms;
    for (;;) {
      const a = await client.get(r.label);
      if (done(a)) return a;
      if (engine.now() >= end) return null;
      await new Promise((go) => { setTimeout(go, Math.min(cfg.runnerPollMs, Math.max(1, end - engine.now()))); });
    }
  }
  const mustHave = (c, project) => {
    const r = rowFor(c.floor.id, project);
    if (!r || r.status !== 'approved') throw new WorkspaceError(r?.status === 'awaiting_boss' ? 'that server is still waiting on the boss\'s yes' : `${project} has no server. deploy_server asks the boss for one.`);
    return r;
  };
  const statusText = (r, a) => {
    const lines = [`Server for ${r.project}: ${a.status}, ${a.tier} tier.`, `Address: ${url(r.label)}`];
    if (a.cron?.length) lines.push(`Scheduled jobs: ${a.cron.map((j) => `${j.name} (${j.schedule})`).join(', ')}${a.jobsRunning?.length ? `; running now: ${a.jobsRunning.join(', ')}` : ''}.`);
    if (a.lastExit) lines.push(`It last stopped with code ${a.lastExit.code}${a.lastExit.oomKilled ? ', out of memory' : ''}.`);
    if (a.build?.status === 'failed') lines.push(`The last build failed: ${redact(a.build.error || '')}. Read server_logs.`);
    if (a.build && !done(a)) lines.push('A build is running.');
    return wrap(r, lines.join('\n'));
  };
  const tools = {
    starter(c, project) {
      const dir = join(STARTERS_DIR, 'node-server');
      const walk = (d, base = '') => readdirSync(d).sort().flatMap((n) => { const p = join(d, n), rel = base ? `${base}/${n}` : n; return statSync(p).isDirectory() ? walk(p, rel) : [{ rel, data: readFileSync(p, 'utf8') }]; });
      const prefix = `projects/${project}/${SERVER_FOLDER}/`;
      let wrote = 0;
      for (const f of walk(dir)) {
        if (get(db, 'SELECT 1 x FROM files WHERE floor_id=? AND path=?', c.floor.id, prefix + f.rel)) continue;
        writeFile(db, c.floor.id, prefix + f.rel, f.data, c.agent?.id ?? null, cfg.quotaBytes);
        wrote++;
      }
      c.say('typing', 'Setting up a server', `set up server code for ${project}`, { project });
      return `The Node server starter is in ${prefix} (${wrote} new files). Read STARTER.md there first. Change it to do the real job, then call deploy_server.`;
    },
    deploy: forTool(async (c, project, why) => {
      const r = rowFor(c.floor.id, project);
      if (r?.status === 'removing') throw new WorkspaceError('the old server is still being cleared away. Try again in a minute.');
      if (r?.status === 'awaiting_boss') return 'Still waiting on the boss\'s yes for this server.';
      const built = collect(c.floor.id, project);
      if (!r || r.status !== 'approved') { await slots().catch(() => {}); return ask(c, project, why, built, r); }
      c.say('typing', 'Deploying the server', `deployed the server for ${project}`, { project });
      waiting.add(key(r));
      try {
        await startBuild(r, built);
        const a = await waitFor(r, cfg.runnerBuildWaitMs);
        // Past the wait, the tick picks it up and tells the floor when it finishes.
        if (!a) return `Building. It can take a few minutes: check server_status. The address will be ${url(r.label)}.`;
        claim(r);
        if (a.build.status === 'failed') return `The server was not deployed.\n${wrap(r, await failure(r, a))}\nFix it and call deploy_server again.`;
        return `Built. The server is at ${url(r.label)} and wakes on its first request. Check /health and one real flow with server_check.`;
      } finally { waiting.delete(key(r)); }
    }),
    status: forTool(async (c, project) => { const r = mustHave(c, project); return statusText(r, await client.get(r.label)); }),
    logs: forTool(async (c, project) => {
      const r = mustHave(c, project), l = await client.logs(r.label, 200);
      return wrap(r, `Server output:\n${clip(redact(l.logs), LOG_BYTES / 2) || '(nothing yet)'}\n\nScheduled jobs:\n${clip(redact(l.jobs), LOG_BYTES / 4) || '(nothing yet)'}\n\nLast build:\n${clip(redact(l.build), LOG_BYTES / 4) || '(nothing yet)'}`);
    }),
    restart: forTool(async (c, project) => {
      const r = mustHave(c, project);
      c.say('typing', 'Restarting the server', `restarted the server for ${project}`, { project });
      await restart(r);
      return `Restarted. ${url(r.label)} is listening.`;
    }),
    /** One real request to the project's own server, for the Tester. The address is built here, and a redirect is reported rather than followed. */
    check: forTool(async (c, project, path, method, body) => {
      const r = mustHave(c, project);
      if (!/^\/(?!\/)[^\s\\]*$/.test(path)) throw new WorkspaceError('path must start with a single / and have no spaces');
      const target = `${url(r.label)}${path}`;
      c.say('browsing', 'Checking the server', `checked ${path.slice(0, 60)} on the server for ${project}`, { project });
      let res;
      try {
        res = await httpFetch(target, { method, redirect: 'manual', signal: AbortSignal.timeout(cfg.runnerCheckTimeoutMs), ...(body ? { body, headers: { 'content-type': 'application/json' } } : {}) });
      } catch { return `The server did not answer ${method} ${path} in time. Read server_logs.`; }
      let text = '';
      try { text = redact(new TextDecoder().decode((await readSome(res, CHECK_BYTES)))); } catch { /* status alone */ }
      const where = res.headers.get?.('location');
      return wrap(r, `HTTP ${res.status}${where ? ` redirect to ${String(where).slice(0, 200)}` : ''}\n${text}`);
    }),
  };
  async function restart(r) {
    await pushEnv(r).catch((e) => { if (!(e instanceof RunnerError)) throw e; });
    await client.sleep(r.label).catch((e) => { if (e.code !== 'no_app') throw e; });
    await client.start(r.label);
  }
  async function readSome(res, max) {
    if (!res.body?.getReader) return new TextEncoder().encode(await res.text());
    const reader = res.body.getReader(); const out = []; let size = 0;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      out.push(value); size += value.length;
      if (size >= max) { await reader.cancel().catch(() => {}); break; }
    }
    return Buffer.concat(out).subarray(0, max);
  }

  // ---- what the boss can do ----
  const yours = (floorId) => all(db, "SELECT project FROM server_apps WHERE floor_id=? AND status='approved' ORDER BY project", floorId).map((x) => x.project);
  /** The full building: kind words, and only ever the boss's own servers to choose from. */
  function fullError(floorId, kind, what) {
    const mine = yours(floorId);
    const msg = mine.length
      ? `${what} To make room, delete one of your own servers from the Servers tab: deleting frees its slot, stopping keeps it.`
      : `${what} None of them is yours to free, so try again a little later.`;
    return new ServerError(409, 'building_full', msg, { full: kind, yours: mine });
  }
  async function approve(floor, project) {
    const r = rowFor(floor.id, project);
    if (!r || r.status !== 'awaiting_boss') throw new ServerError(404, 'not_found', 'That request is no longer waiting.');
    let built;
    try { built = collect(floor.id, project); } catch (e) { if (e instanceof WorkspaceError) throw new ServerError(409, 'no_code', `The team needs to fix this first: ${e.message}.`); throw e; }
    let s; try { s = await slots(); } catch (e) { throw asBoss(e); }
    if (s.killed) throw new ServerError(409, 'killed', words({ code: 'killed' }));
    if (s.used >= s.max) throw fullError(floor.id, 'all', `All ${s.max} server slots in the building are in use right now.`);
    if (built.tier === 'browser' && s.browserUsed >= s.browserMax) throw fullError(floor.id, 'browser', `Both of the building's places for a server with a real browser are in use right now.`);
    // The yes is recorded first, so a second tap during a slow call can't deploy twice.
    if (!run(db, "UPDATE server_apps SET status='approved', updated_at=? WHERE floor_id=? AND project=? AND status='awaiting_boss'", engine.now(), floor.id, project).changes) throw new ServerError(409, 'already', 'That one is already decided.');
    r.status = 'approved';
    try { await startBuild(r, built); } catch (e) {
      if (e instanceof RunnerError && (e.code === 'capacity' || e.code === 'browser_capacity')) {
        set(r, { status: 'awaiting_boss' });
        throw fullError(floor.id, e.code === 'capacity' ? 'all' : 'browser', words(e));
      }
      if (e instanceof RunnerError && e.status < 500) {
        // The boss has said yes and the code is what's wrong, so the Builder fixes it and deploys again without asking twice.
        set(r, { note: words(e) });
        tx(db, () => { engine.addMessage(r.floor_id, 'note', null, `The boss allowed a server for ${r.project} but it could not be built. Have the Builder fix projects/${r.project}/${SERVER_FOLDER}/ and call deploy_server again: ${wrap(r, words(e))}`); run(db, 'UPDATE floors SET manager_wake=1 WHERE id=?', r.floor_id); });
        engine.kick();
        throw new ServerError(409, 'not_built', 'The server code needs a fix first. The team has the error and will deploy again.');
      }
      throw asBoss(e);
    }
    engine.emit(floor.id, 'reload', {}, { persist: false });
    return r;
  }
  function decline(floor, project) {
    if (!run(db, "UPDATE server_apps SET status='declined', updated_at=? WHERE floor_id=? AND project=? AND status='awaiting_boss'", engine.now(), floor.id, project).changes) throw new ServerError(404, 'not_found', 'That request is no longer waiting.');
    tx(db, () => { engine.addMessage(floor.id, 'note', null, `The boss said no to a server for ${project}. Build it on Office Cloud instead.`); run(db, 'UPDATE floors SET manager_wake=1 WHERE id=?', floor.id); });
    engine.emit(floor.id, 'reload', {}, { persist: false });
    engine.kick();
  }
  const owned = (floor, project) => {
    const r = rowFor(floor.id, project);
    if (!r || r.status !== 'approved') throw new ServerError(404, 'not_found', 'That project has no server.');
    return r;
  };
  const viewOf = (r, a) => ({
    project: r.project, url: url(r.label), status: a.status, tier: a.tier, cron: (a.cron || []).map((j) => ({ name: j.name, schedule: j.schedule, timeoutMinutes: j.timeoutMinutes })),
    jobsRunning: a.jobsRunning || [], env: (a.secrets || []).filter((n) => !managedEnv(n)), deployedAt: a.deployedAt ?? null, lastTraffic: a.lastTraffic ?? null, lastExit: a.lastExit ?? null,
    build: a.build ? { status: a.build.status, error: a.build.error ? redact(a.build.error).slice(0, 800) : null, finishedAt: a.build.finishedAt ?? null } : null, note: r.note,
  });
  async function listFor(floor) {
    if (!on()) return { on: false };
    let s = health;
    try { s = await slots(); } catch { /* the last reading, if any */ }
    const out = { on: true, slots: s, servers: [], requests: requestsFor(floor.id) };
    for (const r of all(db, "SELECT * FROM server_apps WHERE floor_id=? AND status='approved' ORDER BY project", floor.id)) {
      try { out.servers.push(viewOf(r, await client.get(r.label))); } catch (e) {
        if (e instanceof RunnerError && e.status === 404) { set(r, { status: 'removed', building: 0, token_hash: null }); continue; }
        out.servers.push({ project: r.project, url: url(r.label), status: 'unknown', tier: r.tier, cron: [], jobsRunning: [], env: [], build: null, note: r.note });
      }
    }
    return out;
  }
  const requestsFor = (floorId) => all(db, "SELECT project, tier, why, updated_at askedAt FROM server_apps WHERE floor_id=? AND status='awaiting_boss' ORDER BY updated_at", floorId);
  async function logsFor(floor, project, tail) {
    const l = await client.logs(owned(floor, project).label, tail);
    return { logs: clip(redact(l.logs), LOG_BYTES), jobs: clip(redact(l.jobs), LOG_BYTES / 2), build: clip(redact(l.build), LOG_BYTES / 2) };
  }
  /** Names go back; values never do, and never reach a log. */
  async function setEnv(floor, project, change) {
    const clean = checkBossEnv(change, cfg);
    const r = owned(floor, project);
    let names;
    try { names = (await client.patchSecrets(r.label, clean)).names; } catch (e) {
      if (e instanceof RunnerError && e.code === 'forbidden_secret') throw new ServerError(400, 'building_key', 'That value is one of the building\'s own keys, and apps never get those.');
      throw asBoss(e);
    }
    return names.filter((n) => !managedEnv(n));
  }
  async function act(floor, project, action) {
    const r = owned(floor, project);
    try {
      if (action === 'restart') await restart(r);
      else if (action === 'stop') await client.stop(r.label);
      else if (action === 'start') await client.start(r.label);
    } catch (e) { throw asBoss(e); }
    return viewOf(r, await client.get(r.label));
  }
  async function runJob(floor, project, name) {
    const r = owned(floor, project);
    // Started, not awaited: a job may take many minutes, and its output shows up in the logs.
    client.runJob(r.label, name).catch((e) => engine.log?.('error', 'servers job', { err: String(e?.message).slice(0, 200) }));
  }
  /** Frees the slot. The data on /data goes with it. */
  async function remove(floor, project) {
    const r = owned(floor, project);
    try { await client.remove(r.label); } catch (e) { if (!(e instanceof RunnerError) || e.status !== 404) throw asBoss(e); }
    run(db, "UPDATE server_apps SET status='removed', building=0, token_hash=NULL, env_ok=0, updated_at=? WHERE floor_id=? AND project=?", engine.now(), floor.id, project);
    engine.emit(floor.id, 'reload', {}, { persist: false });
  }
  /** A floor being wiped or closed. Its tokens stop now; the tick clears the runner, even if that has to wait for the runner to come back. */
  function dropFloor(floorId) {
    run(db, "DELETE FROM server_apps WHERE floor_id=? AND status IN ('awaiting_boss','declined','removed')", floorId);
    run(db, "UPDATE server_apps SET status='removing', token_hash=NULL, building=0, updated_at=? WHERE floor_id=? AND status='approved'", engine.now(), floorId);
  }
  /** The address a project's pages use, or null without a server. */
  const originOf = (floorId, project) => { const r = get(db, "SELECT label FROM server_apps WHERE floor_id=? AND project=? AND status='approved'", floorId, project); return r ? url(r.label) : null; };
  return { client, on, tick, tools, approve, decline, listFor, requestsFor, logsFor, setEnv, act, runJob, remove, dropFloor, originOf, rowFor, cachedSlots: () => health, siteOrigins };
}

export function installServers(ext) {
  const { db, cfg, engine, hooks, GET, POST, json, readJson, limit, requireOwner, HttpError, log } = ext;
  const S = engine.servers;
  let timer = null, stopped = false;
  hooks.snapshot.push((f, viewer, out) => {
    if (!viewer.owner || !S.on()) return;
    out.servers = { on: true, requests: S.requestsFor(f.id), slots: S.cachedSlots(), count: get(db, "SELECT COUNT(*) n FROM server_apps WHERE floor_id=? AND status='approved'", f.id).n };
  });
  const guard = async (fn) => {
    try { return await fn(); } catch (e) {
      if (e instanceof ServerError) throw Object.assign(new HttpError(e.status, e.code, e.message), { extra: e.extra });
      if (e instanceof RunnerError) throw new HttpError(e.status >= 500 ? 503 : 409, e.code, 'The server room isn\'t answering right now. Try again in a few minutes.');
      throw e;
    }
  };
  const off = () => { if (!S.on()) throw new HttpError(404, 'not_found'); };
  const reply = (res, e) => json(res, e.status, { error: e.code, message: e.message, ...(e.extra || {}) });
  GET('/api/floors/:slug/servers', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    json(res, 200, await guard(() => S.listFor(f)));
  });
  POST('/api/floors/:slug/servers/:project/:action', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    off();
    limit('mutate', ip);
    const a = p.action;
    try {
      if (a === 'env') { const b = await readJson(req, 64 * 1024); return json(res, 200, { names: await guard(() => S.setEnv(f, p.project, b)) }); }
      await readJson(req, 2048);
      if (a === 'approve') { await guard(() => S.approve(f, p.project)); return json(res, 200, { ok: true }); }
      if (a === 'decline') { await guard(() => S.decline(f, p.project)); return json(res, 200, { ok: true }); }
      if (a === 'delete') { await guard(() => S.remove(f, p.project)); return json(res, 200, { ok: true }); }
      if (a === 'restart' || a === 'stop' || a === 'start') return json(res, 200, await guard(() => S.act(f, p.project, a)));
    } catch (e) { if (e instanceof HttpError && e.extra) return reply(res, e); throw e; }
    throw new HttpError(404, 'not_found');
  });
  POST('/api/floors/:slug/servers/:project/jobs/:name', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    off();
    limit('mutate', ip);
    await readJson(req, 64);
    await guard(() => S.runJob(f, p.project, p.name));
    json(res, 202, { ok: true });
  });
  GET('/api/floors/:slug/servers/:project/logs', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    off();
    json(res, 200, await guard(() => S.logsFor(f, p.project, 200)));
  });
  const loop = () => { if (!stopped) S.tick().catch((e) => log('error', 'servers', { err: String(e?.message).slice(0, 200) })); };
  return {
    start() { stopped = false; loop(); timer = setInterval(loop, cfg.runnerTickMs); timer.unref?.(); },
    stop() { stopped = true; clearInterval(timer); timer = null; },
  };
}
