// A real computer for the Builder and Tester. Each task gets one Anthropic-hosted container through Claude Managed Agents, so untrusted code
// never runs on this server or the owner's Mac. This file boxes up the project, drives the session, shows its activity on the floor,
// charges what it really costs, and brings the finished files back into the floor's workspace, where publishing already lives.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { get, all, run } from './db.js';
import { ROOT, routeFor } from './config.js';
import { Limiter, pause } from './limiter.js';
import { ProviderError, scrub } from './llm.js';
import { MIN_ROOM_USD } from './budget.js';
import { costOf } from './anthropic.js';
import { packTgz, unpackTgz, TarError } from './tarball.js';
import { applySync, baselineOf, projectFiles, publishSnapshot, WorkspaceError, readFile, MAX_SYNC_FILE_BYTES } from './workspace.js';
import { appLabel } from './apps.js';
import { COMPUTER_TOOL_DEFS, computerToolName, toolsForRole, wrapUntrusted } from './tools.js';
import { runCheck, saveCheck, gateProblem } from './launch.js';
import { IOS_HOSTS } from './ios.js';
import { computerPrompt, computerBriefing, ON_OUR_OWN } from './prompts.js';
import { SOUNDS } from '../public/js/sfx-data.js';

const PACKAGE_HOSTS = ['registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org'];
const OUTPUT_WAIT_MS = 30000;
const STALL_MS = 90_000;
const STOP_GRACE_MS = 120_000;
const MAX_LOST = 2, MAX_STREAM_FAILURES = 5;
const WARN_STEPS_LEFT = 5, SPEND_WARN = 0.8;
// All a bot is ever told when it really is about to stop. How much is left, in money or steps, is none of its business.
const SAVE_NOW = 'Save your work now: run bash /workspace/.office/save.sh.';
// A job stopped at the ceiling gets this much more, once, so the save it needs can't be what the ceiling cost it. Enough for one command and the end of a turn.
const LAST_SAVE_USD = 0.75;
// A session asks for the next slice of money once this share of the last one is left.
const TOP_UP_AT = 0.5;
// A computer lost after this many steps had been getting somewhere, so it doesn't count towards giving up. A job that runs for days can lose a few along the way.
const LOST_NEEDS_STEPS = 10;
// How long an event id is remembered: the platform won't be asked for anything older again. A long session has no end of events, and this keeps the memory for them flat.
const SEEN_WINDOW_MS = 15 * 60000, SEEN_PRUNE_AT = 2000;
// Boxing up or bringing back a project holds all of it in memory, and this container has 700 MB. Computers keep working whatever this is, and just take turns with their files.
const FILE_WORK_AT_ONCE = 2;
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024, MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
// The platform takes whole cents as a plain integer string. BigInt refuses Infinity and NaN outright, and writes a huge number out in full.
const budgetOf = (cents) => ({ type: 'limit', max_list_cost: { amount: BigInt(Math.floor(cents)).toString(), currency: 'USD' } });

const SAVE_SH = `#!/bin/sh
# Packs /workspace/project for The Office. Outputs are collected when your turn ends, so run this last, and after any milestone worth keeping.
set -e
mkdir -p /mnt/session/outputs
cd /workspace/project
tar czf /mnt/session/outputs/project.tgz --no-wildcards-match-slash --exclude=node_modules --exclude='.[!.]*' --exclude=__pycache__ --exclude=coverage --exclude=test-results --exclude=playwright-report .
echo "Saved $(tar tzf /mnt/session/outputs/project.tgz | grep -vc '/$') files, $(du -h /mnt/session/outputs/project.tgz | cut -f1) compressed."
`;
const LAUNCH_CHECK = `${readFileSync(join(ROOT, 'server/launch-check.js'), 'utf8')}
import { readdirSync, readFileSync as read$, statSync } from 'node:fs';
import { join as join$, relative } from 'node:path';
const root = process.argv[2] || '.';
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n.startsWith('.')) continue; const p = join$(d, n); if (statSync(p).isDirectory()) walk(p); else files.push({ path: relative(root, p), data: read$(p) }); } };
walk(root);
const r = checkSite({ files, bossText: process.env.BOSS_TEXT || '', paymentLink: process.env.HAS_PAYMENT === '1', kind: process.argv[3] || 'site' });
console.log(formatReport(r));
process.exitCode = r.errors.length || r.claims.length ? 1 : 0;
`;
const CLIENT_JS = readFileSync(join(ROOT, 'server/app-client/office.js'));
// Office Cloud: the browser library, its guide, and a starter game that uses it (saves, an account, a leaderboard, a shared room).
const CLOUD_FILES = [['office.js', 'sdk.js'], ['OFFICE-CLOUD.md', 'OFFICE-CLOUD.md'], ['examples/cloud-game/index.html', 'examples/cloud-game.html']]
  .map(([to, from]) => ({ path: `.office/${to}`, data: readFileSync(join(ROOT, 'server/app-client', from)) }));
const THREE_JS = readFileSync(join(ROOT, 'public/vendor/three/three.module.min.js'));
// The maker flow (server/makers.js): Phaser for 2D games, served as _office/phaser.min.js once published, and the Tester's browser half as one file.
const PHASER_JS = readFileSync(join(ROOT, 'public/vendor/phaser/phaser.min.js'));
export const PLAYTEST = `${readFileSync(join(ROOT, 'server/playtest.js'), 'utf8')}\n${readFileSync(join(ROOT, 'server/playtest-box.mjs'), 'utf8')}`;
// Real sound and art for a game, so it has more than beeps and shapes: the CC0 Kenney packs the office itself uses (public/models/NOTICE.txt). Games only, to keep every other box small.
export const GAME_ASSETS = (() => {
  const out = Object.entries(SOUNDS).map(([name, b64]) => ({ path: `.office/assets/sounds/${name}.mp3`, data: Buffer.from(b64, 'base64') }));
  const dir = join(ROOT, 'public/models/characters');
  for (const n of readdirSync(dir)) if (n.endsWith('.glb')) out.push({ path: `.office/assets/models/${n}`, data: readFileSync(join(dir, n)) });
  out.push({ path: '.office/assets/models/Textures/colormap.png', data: readFileSync(join(dir, 'Textures/colormap.png')) });
  out.push({ path: '.office/assets/README.txt', data: Buffer.from(`CC0 sound and art for games, from Kenney (www.kenney.nl). Free to use in anything published. Credit "Sound and art: Kenney (kenney.nl), CC0" on the title or credits screen.
sounds/  short mono mp3s: ${Object.keys(SOUNDS).join(', ')}. For example ding for a pickup, ring for a win, bad for a hit, stamp for a door, press for a button, tab for a step, send for a dash.
models/  low-poly 3D people as .glb (${readdirSync(dir).filter((n) => n.startsWith('character-')).length} characters, plus glasses), sharing Textures/colormap.png. Load them in Three.js with GLTFLoader from the three package on npm (three/examples/jsm/loaders/GLTFLoader.js), keeping Textures/ beside them.
Copy what you use into the project (such as sounds/ding.mp3) and load it with a relative path.
`) });
  return out;
})();

/** The model settings a role uses on a computer. Managed Agents runs Claude only, so a role on another provider names its Claude settings here. A job the team picked for itself runs on the autonomous model. */
export function computerRole(models, roleKey, { autonomous = false, tier = '' } = {}) {
  return routeFor(models, roleKey, { computer: true, autonomous, tier });
}

function describeTool(ev) {
  const input = ev.input || {};
  if (ev.name === 'bash') {
    const c = String(input.command || '');
    // Only what it actually runs counts: looking at a tool or a script is not using it.
    if (/\b(bash|sh) +\S*save\.sh/.test(c)) return ['typing', 'Packing up the work', 'packed up the work'];
    if (/^\s*(ls|cat|which|head|grep|echo)\b/.test(c)) return ['reading', 'Looking around the computer', null];
    if (/playwright|chromium|puppeteer|screenshot|\.cjs\b/i.test(c)) return ['browsing', 'Checking it in a real browser', 'checked it in a real browser'];
    if (/\b(npm (run )?test|vitest|jest|node --test|pytest)\b/.test(c)) return ['typing', 'Running the tests', 'ran the tests'];
    if (/\b(vite build|npm run build|tsc\b|webpack|esbuild|rollup)/.test(c)) return ['typing', 'Running the build', 'ran the build'];
    if (/\b(npm|pnpm|yarn|bun) +(i|install|ci|add)\b|pip3? +install/.test(c)) return ['typing', 'Installing packages', 'installed packages'];
    return ['typing', 'Working at the computer', null];
  }
  if (ev.name === 'write' || ev.name === 'edit') {
    const raw = String(input.file_path || input.path || '').replace(/^\/workspace\/project\//, '').replace(/^\/workspace\//, '');
    const name = raw.replace(/[^A-Za-z0-9._/-]+/g, '').slice(-60) || 'a file';
    return ['typing', `Writing ${name}`, `wrote ${name}`];
  }
  if (ev.name === 'read' || ev.name === 'glob' || ev.name === 'grep') return ['reading', 'Reading the code', null];
  return ['typing', 'Working at the computer', null];
}

export class Computer {
  constructor(engine, client) {
    this.engine = engine; this.client = client;
    this.limiter = new Limiter(engine.cfg.maxSessionsFloor, engine.cfg.maxSessionsGlobal);
    this.fileWork = new Limiter(Infinity, FILE_WORK_AT_ONCE);
  }
  /** Whether this role works on a computer, on this floor when one is given. A floor moved onto OpenRouter has none: Managed Agents is the Claude API only. */
  handles(role, floorId) { return !!this.engine.models.all[role]?.computer && !(floorId != null && this.engine.budget.floorRoute(floorId)); }

  // ---- control-plane objects: created once, kept by id, updated only when their definition changes ----
  setting(key) { const v = get(this.engine.db, 'SELECT value FROM settings WHERE key=?', key)?.value; return v ? JSON.parse(v) : null; }
  saveSetting(key, value) { run(this.engine.db, 'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  async environmentId(hosts = PACKAGE_HOSTS, name = 'theoffice-computer') {
    // Deny by default: named package registries, plus whatever own-floor hosts the caller added, and nothing else. allow_package_managers would also open GitHub, which is a way out for a hijacked agent. Checked on a real session: npm, pip, Vite and Playwright all work on this list.
    // The cache is keyed BY the hash of this host set: a floor with its own site gets its own environment, a floor never reuses another's, and floors that share a host set (package-only testers) share one. This is how environments stay scoped per floor without leaking. Dedup keeps insertion order (package hosts first) so the hash is stable.
    const allowed = [...new Set(hosts)];
    const def = { name, config: { type: 'cloud', networking: { type: 'limited', allow_package_managers: false, allow_mcp_servers: false, allowed_hosts: allowed } } };
    const h = hash(def);
    const key = `ma_env_${h}`;
    const have = this.setting(key);
    if (have?.id) return have.id;
    const env = await this.client.createEnvironment({ ...def, name: `${name}-${h}` });
    this.saveSetting(key, { id: env.id, hash: h });
    return env.id;
  }
  /**
   * The public hosts this one floor's own published work lives on: its project app-origins and any custom domain it has bought and taken live.
   * Only this floor's rows are read, and only "<label>.<apps base>" or a bought domain is ever returned, so the set can never contain the main app's
   * host, another floor's host, or an internal address. A session gets these added to the package registries so its Tester and Builder can open the real site.
   */
  ownFloorHosts(floor, task) {
    const e = this.engine;
    if (!e.cfg.appsBaseDomain) return [];
    const base = String(e.cfg.appsBaseDomain).split(':')[0].toLowerCase();
    const mainHost = (() => { try { return new URL(e.cfg.publicOrigin).hostname.toLowerCase(); } catch { return ''; } })();
    const hosts = new Set();
    // A live custom domain for this floor (apex and its www), exact strings from this floor's own orders.
    for (const r of all(e.db, "SELECT domain FROM domain_orders WHERE floor_id=? AND status='live'", floor.id)) {
      const d = String(r.domain || '').toLowerCase().replace(/^\.+|\.+$/g, '');
      if (d && d !== mainHost) { hosts.add(d); hosts.add(`www.${d}`); }
    }
    // Every published project's own app-origin on this floor, plus the project this task is for (its label is allocated now, so it is reachable the moment it goes live in this same session).
    const slugs = new Set(all(e.db, 'SELECT slug FROM projects WHERE floor_id=? AND published_at IS NOT NULL', floor.id).map((p) => p.slug));
    if (task?.project) slugs.add(task.project);
    for (const slug of slugs) {
      const host = `${appLabel(e.db, floor, slug)}.${base}`.toLowerCase();
      // Never the main app's own host, whatever a label works out to.
      if (host !== mainHost) hosts.add(host);
    }
    // Sorted so this floor always produces the same ordering, and so its environment is reused rather than re-created each session.
    return [...hosts].sort();
  }
  /**
   * One agent per role and model. A role's autonomous variant (Sonnet, say) is a separate agent from the one the boss's jobs use, so switching
   * between them never rewrites either one, and each keeps its own stable prompt for the cache. When both settle on the same model they share one.
   */
  async agentRef(roleKey, { autonomous = false, tier = '' } = {}) {
    const { cfg, models } = this.engine;
    const role = models.all[roleKey]; const comp = computerRole(models, roleKey, { autonomous, tier });
    const own = computerRole(models, roleKey);
    const variant = comp.model === own.model && comp.effort === own.effort ? '' : autonomous ? '-auto' : `-${tier}`;
    const tools = COMPUTER_TOOL_DEFS(cfg, roleKey);
    const def = {
      name: `theoffice-${roleKey}${variant}`, model: { id: comp.model, ...(comp.effort ? { effort: comp.effort } : {}) }, system: computerPrompt(cfg, roleKey, role),
      tools: [
        { type: 'agent_toolset_20260401', default_config: { enabled: true, permission_policy: { type: 'auto' } }, configs: [{ name: 'web_fetch', enabled: false }, { name: 'web_search', enabled: false }] },
        ...tools,
      ],
    };
    const h = hash(def); const key = `ma_agent_${roleKey}${variant}`;
    const have = this.setting(key);
    if (have?.hash === h) return { type: 'agent', id: have.id, version: have.version };
    const made = have ? await this.client.updateAgent(have.id, def) : await this.client.createAgent(def);
    this.saveSetting(key, { id: made.id, version: made.version, hash: h });
    return { type: 'agent', id: made.id, version: made.version };
  }

  // ---- money ----
  /**
   * The most this session may be promised right now: the smallest of what is left of its own limit, every cap that is set, and what is left of the building's Anthropic total.
   * What it already holds is counted as not held, since that isn't being taken from anyone. If its own limit is more than a slice, or it has none, it is promised a slice at a time
   * (see topUp): otherwise the first session would hold everything that is left and the rest of the building would wait for it, and the platform has to be given a number either way.
   */
  room(floorId, task, st) {
    const { cfg } = this.engine; const e = this.engine;
    const perTask = cfg.taskMaxUsd - task.cost_usd;
    const perDay = Math.min(cfg.floorDailyUsd - e.spentToday(floorId) - (e.reserved.get(floorId) || 0), cfg.globalDailyUsd - e.spentGlobal() - e.reservedTotal) + st.hold;
    // Over the session's whole life: going back in line for the next slice can't start its limit again.
    const own = Math.min(cfg.sessionMaxUsd - st.charged, perTask);
    const perBuilding = e.budget.room('anthropic', floorId) + st.hold;
    const most = Math.min(own, perDay, perBuilding);
    const slices = own > cfg.sessionSliceUsd;
    return { usd: slices ? Math.min(most, cfg.sessionSliceUsd) : most, daily: perDay < own, building: perBuilding < Math.min(own, perDay), slices, slice: slices && cfg.sessionSliceUsd < most, ceiling: perTask <= most };
  }
  /**
   * Near the end of its slice a session gets the next one, for as long as there is money and nothing else says stop. Should it get there first, it pauses at its cap,
   * goes back in line and carries on when its turn comes round, so this is a smoother way of doing what that does anyway.
   */
  async topUp(st) {
    const e = this.engine;
    if (!st.room?.slices || st.limit || st.hold > e.cfg.sessionSliceUsd * TOP_UP_AT) return;
    // Running time isn't on the model usage, so this is also what keeps the ledger honest during a very long session.
    const cents = await this.reconcile(st);
    if (cents === null) return;
    const room = this.room(st.floorId, get(e.db, 'SELECT cost_usd FROM tasks WHERE id=?', st.taskId), st);
    st.room = room;
    const more = room.usd - st.hold;
    if (more < 0.01) return;
    // Held first, so nothing else in the building can be promised the same dollars while this goes out.
    e.reserve(st.floorId, more); st.hold += more; e.budget.setHold(st.holdId, st.hold);
    try { await this.client.updateSession(st.id, { budget: budgetOf(cents + st.hold * 100) }); } catch (err) {
      const back = Math.min(more, st.hold);
      e.unreserve(st.floorId, back); st.hold -= back; e.budget.setHold(st.holdId, st.hold);
      e.log('warn', 'could not raise a session budget', { err: scrub(err?.message, e.cfg) });
    }
  }
  charge(st, model, prompt, completion, cost) {
    this.engine.charge(st.floorId, st.agent, model, prompt, completion, cost, { taskId: st.taskId, provider: 'anthropic' });
    st.charged += cost;
    run(this.engine.db, 'UPDATE tasks SET session_charged=? WHERE id=?', st.charged, st.taskId);
    const back = Math.min(cost, st.hold);
    if (back > 0) {
      this.engine.unreserve(st.floorId, back); st.hold -= back;
      if (st.holdId) this.engine.budget.setHold(st.holdId, st.hold);
    }
  }
  /** The platform's figure is the authority: running time and anything missed while disconnected is charged here. */
  async reconcile(st) {
    try {
      const s = await this.client.retrieve(st.id);
      const cents = Number(s.usage?.list_cost?.amount);
      if (!Number.isFinite(cents)) return null;
      const delta = cents / 100 - st.charged;
      if (delta > 0.005) this.charge(st, 'managed-session', 0, 0, delta);
      return cents;
    } catch (e) { this.engine.log('warn', 'could not read session cost', { err: scrub(e?.message, this.engine.cfg) }); return null; }
  }

  // ---- one task ----
  async run(floorId, agentId, taskId, ctl) {
    const e = this.engine; const signal = ctl.signal;
    const floor = get(e.db, 'SELECT * FROM floors WHERE id=?', floorId);
    const agent = get(e.db, 'SELECT * FROM agents WHERE id=?', agentId);
    let task = get(e.db, 'SELECT * FROM tasks WHERE id=?', taskId);
    let release = null, st = null;
    try {
      e.setAgent(agent.id, { state: 'queued', activity: task.title, project: task.project, task_id: task.id });
      release = await this.limiter.acquire(floorId, signal);
      e.checkpoint(floorId, signal);
      if (!task.project) {
        const slug = `task-${task.id}`;
        e.upsertProject(floor, slug, { title: task.title, makePrivate: !!floor.default_private });
        run(e.db, 'UPDATE tasks SET project=? WHERE id=?', slug, task.id);
      }
      task = get(e.db, 'SELECT * FROM tasks WHERE id=?', taskId);
      if (!task.transcript) {
        run(e.db, 'UPDATE tasks SET transcript=? WHERE id=?', JSON.stringify([{ role: 'user', content: computerBriefing(floor, agent, e.models.all[agent.role], { ...task, person: e.people.personBlock(agent, task), live: e.isLive(floor.id, task.project), handoff: e.handoffFor(floor, task, { onComputer: true }), uploads: e.taskFiles(task), bossAsk: this.bossAsk(floor.id, agent.role) }, e.cfg) + (task.auto ? `\n\n${ON_OUR_OWN}` : '') }]), task.id);
        task = get(e.db, 'SELECT * FROM tasks WHERE id=?', taskId);
      }
      st = this.newState(floor, agent, task, signal);
      await this.attach(st, task);
      await this.finish(st, st.atCeiling ? 'budget' : await this.drive(st));
    } catch (err) {
      const why = err?.why ?? signal.reason?.why;
      // Only a shutdown leaves a session running, because the next boot picks it up. On any other way out it must not carry on spending unwatched.
      // A session waiting for more room is already stopped at its cap. An interrupt would end its turn for good, and it would come back looking finished.
      if (st?.id && why !== 'shutdown' && why !== 'wait') await this.client.send(st.id, [{ type: 'user.interrupt' }]).catch(() => {});
      // A paused session stopped mid-thought, so it needs telling to carry on. A shutdown leaves it running, and the next boot simply reattaches.
      if (st?.id && why === 'pause') this.pushMessage(taskId, 'You were paused for a while. Carry on where you left off.');
      e.handleRunError(floorId, agent, task, err, () => {
        run(e.db, "UPDATE tasks SET status='todo', updated_at=? WHERE id=? AND status='doing'", e.now(), taskId);
        e.emitTask(taskId);
      });
    } finally {
      if (st?.id) await this.reconcile(st);
      if (st?.hold > 0) { e.unreserve(floorId, st.hold); st.hold = 0; }
      // A session left running through a restart may still spend what it was promised, so that hold stays until it is picked up again.
      if (st?.holdId && !(st.id && signal.reason?.why === 'shutdown')) e.budget.release(st.holdId);
      release?.();
    }
  }
  /** The boss's own recent words, for a Tester to check the work against. Wrapped as data; it is the boss's, but may still carry something they pasted. Testers only, to keep every other prompt the same for the cache. */
  bossAsk(floorId, role) {
    if (role !== 'tester') return '';
    const rows = all(this.engine.db, "SELECT text FROM messages WHERE floor_id=? AND role='boss' ORDER BY id DESC LIMIT 20", floorId).map((m) => m.text).reverse();
    const joined = rows.join('\n').trim();
    return joined ? wrapUntrusted('boss request', joined.slice(-4000)) : '';
  }
  pushMessage(taskId, content) {
    const t = get(this.engine.db, 'SELECT transcript FROM tasks WHERE id=?', taskId);
    const msgs = t?.transcript ? JSON.parse(t.transcript) : [];
    msgs.push({ role: 'user', content });
    run(this.engine.db, 'UPDATE tasks SET transcript=? WHERE id=?', JSON.stringify(msgs), taskId);
  }

  newState(floor, agent, task, signal) {
    const e = this.engine;
    const comp = computerRole(e.models, agent.role, { autonomous: !!task.auto, tier: e.taskTier(task) });
    return {
      id: task.session_id || '', floorId: floor.id, floor, agent, taskId: task.id, project: task.project, signal, room: null,
      // History counts towards the steps, so a restart can't reset them. A round of fixes the manager asked for gets its own, or the fix never fits; the dollar caps still hold.
      charged: task.session_id ? task.session_charged : 0, hold: 0, seen: new Map(), newestEvent: 0, listFrom: 0, steps: 0, maxSteps: e.cfg.sessionMaxSteps * (1 + (task.revisions || 0)), warned: false, limit: '', lastText: '', lastFeed: '',
      pendingCustom: new Map(), pendingAsk: new Map(), interruptSent: false, expectRun: false, budgetRaised: false, startedAt: Date.now(),
      publish: JSON.parse(task.session_publish || '[]'), model: comp.model, pricing: comp.pricing,
      ctx: { ...e.toolCtx(floor, agent, task, ['read_file', 'list_files', 'fetch_url', 'web_search', 'ask_boss', 'ask_colleague', 'file_purchase_request', ...toolsForRole(agent.role).filter((n) => n === 'generate_image' || n === 'review_design' || n === 'deploy_server' || n.startsWith('server_'))]), signal, autonomous: !!task.auto },
    };
  }

  /** A session with nobody following it: its task was stopped, or its floor is paused. Stop it, and put what it cost on the ledger. */
  async settleOrphan(task, { resume = false } = {}) {
    const e = this.engine;
    try {
      await this.client.send(task.session_id, [{ type: 'user.interrupt' }]).catch(() => {});
      const s = await this.client.retrieve(task.session_id);
      const delta = Number(s.usage?.list_cost?.amount) / 100 - task.session_charged;
      if (delta > 0.005) {
        e.charge(task.floor_id, { id: task.agent_id }, 'managed-session', 0, 0, delta, { taskId: task.id, provider: 'anthropic' });
        run(e.db, 'UPDATE tasks SET session_charged=session_charged+? WHERE id=?', delta, task.id);
      }
      if (resume) this.pushMessage(task.id, 'You were paused for a while. Carry on where you left off.');
    } catch (err) { e.log('warn', 'could not settle a session', { err: scrub(err?.message, e.cfg) }); } finally { e.budget.releaseTask(task.id); }
  }
  /** At boot: sessions on floors that won't reattach for now are stopped, so they don't spend off the books. */
  recoverOrphans() {
    const paused = this.engine.globalPaused();
    for (const t of all(this.engine.db, "SELECT t.id,t.session_id,t.session_charged,t.agent_id,t.floor_id,f.paused,f.status floor_status FROM tasks t JOIN floors f ON f.id=t.floor_id WHERE t.session_id!='' AND t.status='todo'")) {
      const out = this.engine.budget.out('anthropic', t.floor_id);
      if (t.paused || t.floor_status !== 'active' || paused || out) this.settleOrphan(t, { resume: out && !paused && !t.paused && t.floor_status === 'active' });
    }
  }

  /** Reattach to this task's session if it is still alive, otherwise box up the project and start a fresh one. */
  async attach(st, task) {
    const e = this.engine; const { floor, agent, signal } = st;
    // What this task held before a restart is replaced below, and what its session spent meanwhile goes on the ledger first, so the room is the real room.
    e.budget.releaseTask(task.id);
    if (st.id) await this.reconcile(st);
    let room = this.room(floor.id, task, st);
    const heldUp = (r) => r.usd < MIN_ROOM_USD && ((r.daily && !e.spentOver(floor.id, MIN_ROOM_USD)) || (r.building && !e.budget.out('anthropic', floor.id)));
    // Short of room only because other sessions hold it: they give back what they don't spend, so wait for them.
    while (heldUp(room)) {
      e.setAgent(agent.id, { state: 'queued', activity: 'Waiting for a turn' });
      await pause(2000, signal);
      e.checkpoint(floor.id, signal);
      room = this.room(floor.id, task, st);
    }
    st.room = room;
    if (room.usd < MIN_ROOM_USD) {
      if (room.building) throw new e.Halt('building_budget');
      if (room.daily) throw new e.Halt('budget');
      // The ceiling came up while this one waited in line. A computer that still exists gets to save and hand back what it has, the same as one stopped while working.
      if (st.id && await this.client.retrieve(st.id).then((s) => s.status !== 'terminated', () => false)) { this.equip(st); st.atCeiling = true; return; }
      e.stopAtCeiling(floor, agent, task.id, e.savedSoFar(floor.id, task));
      throw new e.Halt('stop');
    }
    // Held from this moment, so nothing else in the building can spend the same dollars while this one starts up.
    st.hold = room.usd; e.reserve(floor.id, st.hold);
    st.holdId = e.budget.hold('anthropic', { kind: 'session', floorId: floor.id, agentId: agent.id, taskId: task.id, usd: room.usd });
    if (st.id) {
      let live = null;
      try { live = await this.client.retrieve(st.id); } catch (err) { if (err?.status !== 404) throw err; }
      // Only a send-back sets this, and only this start may act on it: a pause or a wait for room later in the round goes back to the computer it was on.
      const sentBack = !!task.session_fresh;
      if (sentBack) run(e.db, 'UPDATE tasks SET session_fresh=0 WHERE id=?', task.id);
      if (sentBack && live?.status === 'idle' && task.session_ctx >= e.cfg.sessionFreshOverTokens && this.freshStart(task)) {
        e.log('info', 'fix round on a fresh computer', { floorId: floor.id, taskId: task.id, tokens: task.session_ctx });
        st.id = ''; st.charged = 0; live = null;
        task = get(e.db, 'SELECT * FROM tasks WHERE id=?', task.id);
      } else if (live && live.status !== 'terminated') {
        this.equip(st);
        // The budget is fixed at creation, so a reattached session is re-capped to what may be spent from now on.
        const spent = Number(live.usage?.list_cost?.amount) || 0;
        await this.client.updateSession(st.id, { budget: budgetOf(spent + Math.floor(room.usd * 100)) });
        st.budgetRaised = true; st.resumed = true;
        e.feed(floor.id, agent, `went back to the computer for "${task.title}"`, task.project);
        return;
      }
      if (st.id) {
        if (task.session_tries >= MAX_LOST) {
          // The floor pauses, and resuming it is someone deciding to try again, so the count starts over.
          run(e.db, 'UPDATE tasks SET session_tries=0 WHERE id=?', task.id);
          throw new ProviderError('The computer keeps disappearing.', { retryable: false });
        }
        run(e.db, "UPDATE tasks SET session_id='', session_charged=0, session_sent=0, session_ctx=0, session_tries=session_tries+1 WHERE id=?", task.id);
        this.pushMessage(task.id, 'Your earlier computer was lost. /workspace/project now holds everything that had been saved, so check what is still missing and finish the job.');
        st.id = ''; st.charged = 0;
      }
    }
    const agentRef = await this.agentRef(agent.role, { autonomous: !!task.auto, tier: e.taskTier(task) });
    const vaulted = !!task.vault && !!e.cfg.iosEnabled && !!e.cfg.iosVaultId;
    // The floor's own published hosts, so the Tester and Builder can open the real site, added to the package registries (or the iOS host set). Scoped to this floor alone.
    const ownHosts = this.ownFloorHosts(floor, task);
    const environment = vaulted
      ? await this.environmentId([...IOS_HOSTS, ...ownHosts], 'theoffice-ios')
      : await this.environmentId([...PACKAGE_HOSTS, ...ownHosts], 'theoffice-computer');
    let upload, baseline;
    const free = await this.fileWork.acquire(floor.id, signal);
    try {
      // Only this one project goes in. Other projects, other floors and anything of ours stay out of the box.
      const files = projectFiles(e.db, floor.id, task.project);
      const box = packTgz([
        { path: '.office/save.sh', data: Buffer.from(SAVE_SH), mode: 0o755 },
        { path: '.office/client.js', data: CLIENT_JS },
        ...CLOUD_FILES,
        { path: '.office/launch-check.mjs', data: Buffer.from(LAUNCH_CHECK) },
        { path: '.office/three.module.min.js', data: THREE_JS },
        ...(task.lane === 'game' ? GAME_ASSETS : []),
        ...(task.lane === 'game' ? [{ path: '.office/phaser.min.js', data: PHASER_JS }] : []),
        // The Tester's browser half. A game's Builder gets it too, to run the same check before handing over, so a failing browser rule is caught without a fix pass.
        ...(agent.role === 'tester' || (agent.role === 'builder' && task.lane === 'game') ? [{ path: '.office/playtest.mjs', data: Buffer.from(PLAYTEST) }] : []),
        ...files.map((f) => ({ path: `project/${f.path}`, data: f.data })),
        // The boss's files for this task, beside the project rather than in it: only what the agent copies in is saved back.
        ...e.taskFiles(task).map((a) => ({ path: a.path, data: Buffer.from(get(e.db, 'SELECT content FROM files WHERE floor_id=? AND path=?', floor.id, a.path)?.content ?? '') })),
      ]);
      baseline = baselineOf(files);
      e.checkpoint(floor.id, signal);
      upload = await this.client.upload(box, 'bundle.tgz');
    } finally { free(); }
    let session;
    try {
      session = await this.whenAllowed(st, () => this.client.createSession({
        agent: agentRef, environment_id: environment, title: `Floor ${floor.number}, task ${task.id}`,
        resources: [{ type: 'file', file_id: upload, mount_path: '/office/bundle.tgz' }],
        budget: budgetOf(room.usd * 100),
        metadata: { app: 'theoffice', floor: String(floor.id), task: String(task.id) },
        // Only a task made by the boss's click ever holds this. The container still only sees a placeholder.
        ...(vaulted ? { vault_ids: [e.cfg.iosVaultId] } : {}),
      }));
    } finally {
      // The session holds its own copy of the box, so ours has no reason to outlive this call.
      await this.client.deleteFile(upload).catch(() => {});
    }
    st.id = session.id;
    this.equip(st);
    run(e.db, 'UPDATE tasks SET session_id=?, session_baseline=?, session_sent=0, session_charged=0, session_ctx=0 WHERE id=?', session.id, JSON.stringify(baseline), task.id);
    e.feed(floor.id, agent, `started a computer for "${task.title}"`, task.project);
    e.setAgent(agent.id, { state: 'thinking', activity: 'Starting up the computer', project: task.project, task_id: task.id });
  }

  /**
   * A fix round on a fresh computer. A computer's conversation only grows, and every step re-reads all of it: one build measured on 11-10 went back for its
   * fixes at half a million tokens, paid to have the lot written to the cache again, and then paid for it on each of sixty more steps. The work itself is on the
   * drive (a send-back only follows a finished, collected turn), so the new computer gets those files, the original brief, the report the last round ended
   * with, and the notes it was sent back with. The old one is left idle, as every finished task's is. Returns false when there is nothing to carry over.
   */
  freshStart(task) {
    const e = this.engine;
    let msgs = []; try { msgs = JSON.parse(task.transcript || '[]'); } catch { return false; }
    const unsent = msgs.slice(task.session_sent);
    if (!msgs.length || !unsent.length) return false;
    const note = `[Office note, not from the boss] You did the first round of this job on another computer, and this is a fresh one. Everything you saved then is in /workspace/project, your notes included: set up again, and look at what is there before you change anything. Don't redo what already works. Your own report at the end of that round:\n${wrapUntrusted('your earlier report', String(task.result || '').slice(0, 1800))}`;
    run(e.db, "UPDATE tasks SET transcript=?, session_id='', session_charged=0, session_sent=0, session_ctx=0 WHERE id=?", JSON.stringify([msgs[0], { role: 'user', content: note }, ...unsent]), task.id);
    return true;
  }
  /** With no limit of ours on sessions, the platform's own limit on starting them can be the first one anybody meets. That is a queue to wait in, not an outage to pause the floor for. */
  async whenAllowed(st, fn) {
    for (let wait = this.rateLimitWaitMs ?? 5000; ; wait = Math.min(wait * 2, 60000)) {
      try { return await fn(); } catch (err) {
        if (err?.status !== 429 || st.signal.aborted) throw err;
        this.engine.setAgent(st.agent.id, { state: 'queued', activity: 'Waiting for a turn' });
        await pause(wait, st.signal);
        this.engine.checkpoint(st.floorId, st.signal);
      }
    }
  }
  /** Whether this event has been dealt with. Ids are let go once they are too old to come round again, and the listing stops asking for anything that old. */
  seenBefore(st, ev) {
    if (!ev.id) return false;
    if (st.seen.has(ev.id)) return true;
    const at = Date.parse(ev.processed_at) || st.newestEvent;
    if (at > st.newestEvent) st.newestEvent = at;
    st.seen.set(ev.id, at);
    if (st.seen.size >= SEEN_PRUNE_AT) {
      const before = st.newestEvent - (this.seenWindowMs ?? SEEN_WINDOW_MS);
      for (const [id, when] of st.seen) { if (when >= before) break; st.seen.delete(id); }
      st.listFrom = before;
    }
    return false;
  }

  /** Follow a session until its turn ends, surviving dropped streams without missing or repeating anything. Returns how the turn ended. */
  async drive(st) {
    const e = this.engine; let failures = 0;
    for (;;) {
      e.checkpoint(st.floorId, st.signal);
      this.checkClock(st);
      if (this.pastGrace(st)) return 'done';
      const conn = new AbortController();
      const onAbort = () => conn.abort();
      st.signal.addEventListener('abort', onAbort, { once: true });
      let stall;
      const bump = () => { clearTimeout(stall); stall = setTimeout(() => conn.abort(), this.stallMs ?? STALL_MS); };
      try {
        bump();
        // Stream first, then history: anything between the two shows up in both and is deduplicated by id.
        const stream = await this.client.stream(st.id, conn.signal);
        let outcome = null;
        for await (const ev of this.client.listEvents(st.id, st.listFrom)) {
          // Checked here as well as asked for, because a repeat of something already forgotten would count as new.
          if (st.listFrom && Date.parse(ev.processed_at) < st.listFrom) continue;
          if (this.seenBefore(st, ev)) continue;
          const o = await this.onEvent(st, ev, false);
          if (o === 'running') outcome = null; else if (o) outcome = o;
        }
        // A session paused at its old cap wakes by itself when the cap is raised, so that old pause is not an ending. (Checked against the real API.)
        if (outcome === 'budget' && st.budgetRaised) { outcome = null; st.expectRun = true; }
        st.budgetRaised = false;
        // Pressing Resume after repeated failures is someone asking it to try again.
        if (outcome === 'retries' && st.resumed) this.pushMessage(st.taskId, 'Something went wrong on the platform earlier. Carry on where you left off.');
        st.resumed = false;
        // A long silence: if the session has in fact stopped, its last status is the answer, even if that event was already seen or ignored.
        if (st.stalled && !outcome && st.lastIdle) {
          const live = await this.client.retrieve(st.id);
          if (live.status === 'idle' && !st.pendingCustom.size && !st.pendingAsk.size) { outcome = st.lastIdle; st.expectRun = false; }
        }
        st.stalled = false;
        await this.answerPending(st);
        if (await this.sendPending(st)) { outcome = null; st.expectRun = true; }
        if (outcome && !st.expectRun) return outcome;
        this.checkClock(st);
        for await (const ev of stream) {
          bump(); failures = 0;
          if (this.seenBefore(st, ev)) continue;
          this.checkClock(st);
          if (this.pastGrace(st)) return 'done';
          const o = await this.onEvent(st, ev, true);
          if (o && o !== 'running' && !st.expectRun) return o;
        }
      } catch (err) {
        if (st.signal.aborted) throw st.signal.reason;
        if (conn.signal.aborted) st.stalled = true;
        if (err instanceof ProviderError && !err.retryable) throw err;
        if (!conn.signal.aborted && ++failures >= MAX_STREAM_FAILURES) throw err instanceof ProviderError ? err : new ProviderError('The computer stopped answering.', { retryable: false });
        if (!conn.signal.aborted) e.log('warn', 'session stream dropped', { err: scrub(err?.message, e.cfg) });
      } finally {
        if (conn.signal.aborted) st.stalled = true;
        clearTimeout(stall);
        st.signal.removeEventListener('abort', onAbort);
        conn.abort();
      }
      if (st.signal.aborted) throw st.signal.reason;
      await sleep(Math.min(250 * 2 ** failures, 8000));
    }
  }
  checkClock(st) {
    if (!st.limit && Date.now() - st.startedAt > this.engine.cfg.sessionMaxMinutes * 60000) this.stopFor(st, 'time');
  }
  stopFor(st, why) {
    st.limit ||= why;
    st.limitAt ??= Date.now();
    if (st.interruptDone || st.interruptBusy) return;
    st.interruptBusy = true;
    // Retried from the next event if it fails. Past the grace period the runner stops following the session regardless.
    this.client.send(st.id, [{ type: 'user.interrupt' }])
      .then(() => { st.interruptDone = true; })
      .catch((err) => this.engine.log('warn', 'interrupt failed', { err: scrub(err?.message, this.engine.cfg) }))
      .finally(() => { st.interruptBusy = false; });
  }
  pastGrace(st) { return !!st.limitAt && Date.now() - st.limitAt > (this.stopGraceMs ?? STOP_GRACE_MS); }

  async onEvent(st, ev, live) {
    const e = this.engine; const { agent, floorId } = st;
    switch (ev.type) {
      case 'session.status_running': st.expectRun = false; return 'running';
      case 'user.message': if (ev.processed_at) st.expectRun = false; return null;
      case 'span.model_request_start':
        st.steps++;
        if (live) {
          e.setAgent(agent.id, { state: 'thinking', activity: 'Thinking it through', project: st.project, task_id: st.taskId });
          const left = st.maxSteps - st.steps;
          if (left === WARN_STEPS_LEFT && !st.warned) {
            st.warned = true;
            this.client.send(st.id, [{ type: 'system.message', content: [{ type: 'text', text: SAVE_NOW }] }]).catch(() => {});
          }
          if (left <= 0) this.stopFor(st, 'steps');
        }
        return null;
      case 'span.model_request_end':
        // History from before a reconnect is settled by reconcile(), which uses the platform's own total.
        if (live && ev.model_usage) {
          const u = costOf(ev.model_usage, st.pricing);
          this.charge(st, st.model, u.prompt, u.completion, u.cost);
          // How much this computer now reads on every step.
          run(e.db, 'UPDATE tasks SET session_ctx=? WHERE id=?', u.prompt, st.taskId);
          await this.topUp(st);
          // A session stopped by its budget keeps only what was saved, and the platform gives no warning. It isn't told why, because a bot has no business knowing there is a limit.
          // While more slices are coming there is nothing to warn about, and that is nearly always.
          if (!st.warnedSpend && st.room && !st.room.slice && st.hold <= (st.room.slices ? e.cfg.sessionSliceUsd : st.room.usd) * (1 - SPEND_WARN)) {
            st.warnedSpend = true;
            this.client.send(st.id, [{ type: 'system.message', content: [{ type: 'text', text: SAVE_NOW }] }]).catch(() => {});
          }
        }
        return null;
      case 'agent.thinking':
        if (live) e.setAgent(agent.id, { state: 'thinking', project: st.project, task_id: st.taskId });
        return null;
      case 'agent.message': {
        const text = (ev.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (text) st.lastText = text;
        return null;
      }
      case 'agent.tool_use': {
        if (ev.evaluated_permission === 'ask') st.pendingAsk.set(ev.id, ev);
        if (live) {
          const [state, activity, line] = describeTool(ev);
          e.setAgent(agent.id, { state, activity, project: st.project, task_id: st.taskId });
          if (line && line !== st.lastFeed) { st.lastFeed = line; e.feed(floorId, agent, line, st.project); }
          await this.answerPending(st);
        }
        return null;
      }
      case 'user.tool_confirmation': st.pendingAsk.delete(ev.tool_use_id); return null;
      case 'agent.custom_tool_use':
        st.pendingCustom.set(ev.id, ev);
        if (live) await this.answerPending(st);
        return null;
      case 'user.custom_tool_result': st.pendingCustom.delete(ev.custom_tool_use_id); return null;
      case 'session.error':
        e.log('warn', 'session error', { type: ev.error?.type });
        return null;
      case 'session.status_idle': {
        const r = ev.stop_reason?.type;
        if (r === 'requires_action') { if (live) await this.answerPending(st); return null; }
        st.lastIdle = { end_turn: 'done', budget_reached: 'budget', retries_exhausted: 'retries', refusal: 'refused' }[r] || 'done';
        return st.lastIdle;
      }
      case 'session.status_terminated': return 'terminated';
      default: return null;
    }
  }
  /** Nobody is at the keyboard, so a call the platform could not judge is declined and the agent finds another way. */
  async answerPending(st) {
    for (const [id] of [...st.pendingAsk]) {
      st.pendingAsk.delete(id);
      await this.client.send(st.id, [{ type: 'user.tool_confirmation', tool_use_id: id, result: 'deny', deny_message: 'Nobody is available to approve this. Find another way that stays inside /workspace.' }]);
    }
    for (const [id, ev] of [...st.pendingCustom]) {
      st.pendingCustom.delete(id);
      const out = await this.custom(st, ev);
      await this.client.send(st.id, [{ type: 'user.custom_tool_result', custom_tool_use_id: id, content: [{ type: 'text', text: out }] }]);
    }
  }
  /** Ways for the office's own tools to reach this one container: a mount for pictures, and its outputs folder for screenshots. */
  equip(st) {
    st.ctx.mountFile = async (bytes, name) => {
      const id = await this.client.upload(bytes, name);
      const stamp = (st.mounts = (st.mounts || 0) + 1);
      const path = `/generated/${stamp}-${name}`;
      await this.client.addFile(st.id, id, path);
      return `/mnt/session/uploads${path}`;
    };
    st.ctx.readOutput = async (name) => {
      const file = String(name).split('/').pop();
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(file) || file === 'project.tgz') return null;
      // It takes a few seconds for a file to show up here after it is written.
      const until = Date.now() + (this.outputWaitMs ?? OUTPUT_WAIT_MS);
      for (;;) {
        const hit = (await this.client.listOutputs(st.id)).filter((f) => f.filename === file).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
        if (hit) {
          if (hit.size > MAX_ARCHIVE_BYTES) return null;
          // Saved again a moment ago, the listing can still name the copy that replaced: that one is gone, and the new one shows up shortly. Never a reason to stop the floor.
          try { return await this.client.download(hit.id); } catch (err) { if (err?.status !== 404) throw err; }
        }
        if (Date.now() > until) return null;
        await sleep(2000);
      }
    };
  }
  async custom(st, ev) {
    const e = this.engine;
    const name = computerToolName(ev.name);
    if (name === 'publish_project') { try { return this.declarePublish(st, ev.input || {}); } catch (err) { if (err instanceof WorkspaceError) return `Error: ${err.message}`; throw err; } }
    if (name === 'pull_shared_file') return this.pullShared(st, ev.input || {});
    if (name === 'deploy_server') { const problem = await this.bringBackSaved(st); if (problem) return `Error: ${problem}`; }
    const out = await e.tools.exec(st.ctx, name, JSON.stringify(ev.input ?? {}));
    return out && typeof out === 'object' ? out.text : out;
  }
  /**
   * Put any one shared-drive file onto the computer in full, byte-for-byte, so nobody ever retypes a file or works from the shortened chat copy.
   * Text or binary, up to the sync limit. Uses the same mount the picture tools use, so it lands under /mnt/session/uploads for the agent to copy in.
   */
  async pullShared(st, a) {
    const e = this.engine;
    const path = String(a?.path ?? '').trim();
    if (!path) return 'Error: path is required (a shared-drive path such as projects/other/engine.js).';
    let f;
    try { f = readFile(e.db, st.floor.id, path); } catch (err) { if (err instanceof WorkspaceError) return `Error: ${err.message}`; throw err; }
    if (!f) return 'Error: no such file on the shared drive.';
    // A public task can't pull another project's private file, exactly as read_shared_file refuses it.
    const slug = String(f.path).match(/^projects\/([^/]+)\//)?.[1];
    if (slug && slug !== st.project) {
      const priv = get(e.db, 'SELECT private FROM projects WHERE floor_id=? AND slug=?', st.floor.id, slug)?.private;
      const mine = st.project ? get(e.db, 'SELECT private FROM projects WHERE floor_id=? AND slug=?', st.floor.id, st.project)?.private : 0;
      if (priv && !mine) return 'Error: that project is private, and this task can\'t read it.';
    }
    const bytes = typeof f.content === 'string' ? Buffer.from(f.content, 'utf8') : Buffer.from(f.content);
    if (bytes.length > MAX_SYNC_FILE_BYTES) return `Error: that file is over ${MAX_SYNC_FILE_BYTES / 1048576} MB, too big to pull in one piece.`;
    const name = (f.path.split('/').pop() || 'file').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'file';
    let at;
    try { at = await st.ctx.mountFile(bytes, name); } catch (err) { e.log('warn', 'could not mount a shared file', { err: scrub(err?.message, e.cfg) }); return 'Error: could not put that file on your computer; try again.'; }
    e.feed(st.floor.id, st.agent, `pulled ${f.path} onto the computer in full`, st.project);
    return `The whole file (${bytes.length} bytes) is on your computer at ${at}, byte-for-byte. Copy it where you need it, for example: cp ${at} /workspace/project/${name}. This is the complete file, not the shortened copy read_shared_file returns.`;
  }
  // deploy_server reads the floor's drive, and a computer's files only get there when saved, so the newest save comes back first. Nothing is published.
  async bringBackSaved(st) {
    const e = this.engine;
    const task = get(e.db, 'SELECT session_baseline FROM tasks WHERE id=?', st.taskId);
    await sleep(e.cfg.outputLagMs);
    const file = (await this.client.listOutputs(st.id)).filter((f) => f.filename === 'project.tgz').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (!file) return 'nothing has been saved yet. Put the code in /workspace/project/server/, run bash /workspace/.office/save.sh, then call deploy_server again.';
    if (file.size > MAX_ARCHIVE_BYTES) return `the saved project is over ${MAX_ARCHIVE_BYTES / 1048576} MB. Leave out large or generated files.`;
    const free = await this.fileWork.acquire(st.floor.id, st.signal);
    try { const r = await this.bringBack({ ...st, publish: [] }, file, task); return r.ok ? '' : r.problem; } finally { free(); }
  }
  // Files in a container can't be read from here until the turn ends, so publishing is recorded now and happens then.
  declarePublish(st, a) {
    if (st.agent.role === 'tester') throw new WorkspaceError('testers report back rather than publish');
    const slug = String(a.project ?? st.project);
    if (slug !== st.project) throw new WorkspaceError(`this computer can only publish its own project, "${st.project}"`);
    const held = this.engine.daily?.publishHold(st.floor.id, slug, `${a.title ?? ''} ${a.description ?? ''}`);
    if (held) throw new WorkspaceError(held);
    const kind = ['site', 'app', 'game', 'simulation', 'doc', 'research'].includes(a.kind) ? a.kind : 'site';
    const directory = cleanDirectory(a.directory);
    const entry = { project: slug, title: String(a.title || slug).slice(0, 120), description: String(a.description || '').slice(0, 300), kind, directory, reason: String(a.claims_ok_because || '').slice(0, 300) };
    st.publish = [...st.publish.filter((p) => p.project !== slug), entry];
    run(this.engine.db, 'UPDATE tasks SET session_publish=? WHERE id=?', JSON.stringify(st.publish), st.taskId);
    return `Noted. ${directory ? `${directory}/` : 'The project folder'} goes live at ${this.engine.liveUrl(st.floor, slug)} once you have run .office/save.sh and ended your turn. Save first, and do it last, so the newest files are the ones published.`;
  }
  /** Sends user messages the session hasn't had yet: the first briefing, the manager's notes, the boss's answers, or a fix request. */
  async sendPending(st) {
    const e = this.engine;
    const t = get(e.db, 'SELECT transcript,session_sent FROM tasks WHERE id=?', st.taskId);
    const msgs = JSON.parse(t.transcript || '[]').slice(t.session_sent);
    if (!msgs.length) return false;
    await this.client.send(st.id, [{ type: 'user.message', content: [{ type: 'text', text: msgs.map((m) => m.content).join('\n\n') }] }]);
    run(e.db, 'UPDATE tasks SET session_sent=session_sent+? WHERE id=?', msgs.length, st.taskId);
    return true;
  }

  // ---- when a turn ends ----
  async finish(st, outcome) {
    const e = this.engine; const { floor, agent, taskId } = st;
    // Only its slice ran out, before the next could reach it. Nothing is finished, so nothing is collected: it goes back in line, and the next slice wakes it.
    if (outcome === 'budget' && st.room?.slice) throw new e.Halt('wait');
    if (outcome === 'retries') throw new ProviderError('The computer failed repeatedly.', { retryable: false });
    if (outcome === 'terminated') { await this.collect(st).catch(() => {}); return this.lost(st); }
    if (outcome === 'refused') { await this.reconcile(st); return e.finishTask(floor, agent, taskId, 'failed', 'The model declined this one.'); }
    // The ceiling on one task, the one limit nobody is told about. It stops the work, but it must not cost the work: the computer gets one last save first.
    const ceiling = outcome === 'budget' && !!st.room?.ceiling;
    if (ceiling) await this.lastSave(st);
    while (outcome === 'done' && st.ctx.suspend) {
      if (get(e.db, 'SELECT 1 x FROM questions WHERE task_id=? AND answer IS NULL', taskId)) {
        await this.reconcile(st);
        run(e.db, "UPDATE tasks SET status='blocked', updated_at=? WHERE id=?", e.now(), taskId);
        e.emitTask(taskId);
        return undefined;
      }
      // The boss already answered, while this turn was wrapping up. Carry straight on.
      st.ctx.suspend = false;
      outcome = await this.drive(st);
    }
    let result = { ok: false, problem: '' };
    for (let turn = 0; ; turn++) {
      result = await this.collect(st);
      if (result.ok || outcome !== 'done' || st.limit || turn >= e.cfg.maxFixTurns) break;
      this.pushMessage(taskId, `That did not go through: ${result.problem} Fix it, run .office/save.sh again, then end your turn.`);
      e.feed(floor.id, agent, 'had to fix something before it could be saved', st.project);
      outcome = await this.drive(st);
      if (outcome === 'retries') throw new ProviderError('The computer failed repeatedly.', { retryable: false });
      if (outcome === 'terminated') return this.lost(st);
    }
    await this.reconcile(st);
    const links = result.published?.length ? `\n\nPublished: ${result.published.join(', ')}` : '';
    // The manager decides what to do about a stopped task, and can't without this: what was being said when it stopped, and whether the work survived.
    const soFar = `${st.lastText ? `\n\nLast thing it said: ${st.lastText.slice(0, 800)}` : ''}${result.ok ? e.savedSoFar(floor.id, { project: st.project }) : ' Its last save could not be read, so anything since the task began may be lost.'}`;
    if (outcome === 'budget') {
      // Stopped by what was left of the building's total or of the day. Over if the money is really gone; otherwise it goes back in line for what other sessions give back.
      if (st.room.building) throw new e.Halt(e.budget.out('anthropic', floor.id) ? 'building_budget' : 'wait');
      if (st.room.daily) throw new e.Halt(e.spentOver(floor.id, MIN_ROOM_USD) ? 'budget' : 'wait');
      if (ceiling) return e.stopAtCeiling(floor, agent, taskId, `${links}${soFar}`, result.ok);
      return e.finishTask(floor, agent, taskId, 'failed', `Stopped: this task reached its limit.${links}${soFar}`);
    }
    if (st.limit === 'steps') return e.finishTask(floor, agent, taskId, 'failed', `Ran out of steps before finishing.${links}${soFar}`);
    if (st.limit === 'time') return e.finishTask(floor, agent, taskId, 'failed', `Ran out of time before finishing.${links}${soFar}`);
    if (!result.ok) return e.finishTask(floor, agent, taskId, 'failed', `The work could not be saved: ${result.problem}`);
    return e.finishTask(floor, agent, taskId, 'review', `${(st.lastText || 'Finished.').slice(0, 1800)}${links}`);
  }
  /** One command's worth more, asked for by name, so what a job did before the ceiling is what comes back. If this can't be done, the last save it made anyway is what's collected. */
  async lastSave(st) {
    const e = this.engine;
    try {
      const cents = await this.reconcile(st);
      if (cents === null) return;
      await this.client.updateSession(st.id, { budget: budgetOf(cents + LAST_SAVE_USD * 100) });
      st.budgetRaised = true;
      this.pushMessage(st.taskId, `${SAVE_NOW} Then end your turn.`);
      await this.drive(st);
    } catch (err) {
      if (err instanceof e.Halt) throw err;
      e.log('warn', 'the last save before a stop failed', { err: scrub(err?.message, e.cfg) });
    }
  }
  lost(st) {
    const e = this.engine;
    if (st.steps >= LOST_NEEDS_STEPS) run(e.db, 'UPDATE tasks SET session_tries=0 WHERE id=?', st.taskId);
    run(e.db, "UPDATE tasks SET status='todo', updated_at=? WHERE id=? AND status='doing'", e.now(), st.taskId);
    e.emitTask(st.taskId);
    return undefined;
  }

  /** Bring project.tgz back and publish whatever was declared. Everything in that archive is treated as hostile. */
  async collect(st) {
    const e = this.engine; const { floor, agent, taskId, project } = st;
    const task = get(e.db, 'SELECT session_baseline FROM tasks WHERE id=?', taskId);
    let file = null;
    for (let i = 0; i < 4 && !file; i++) {
      await sleep(e.cfg.outputLagMs * (i ? 2 : 1));
      e.checkpoint(floor.id, st.signal);
      const list = await this.client.listOutputs(st.id);
      file = list.filter((f) => f.filename === 'project.tgz').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
    }
    if (!file) {
      if (!st.publish.length && agent.role === 'tester') return { ok: true };
      return { ok: false, problem: 'there is no saved project. Run bash /workspace/.office/save.sh.' };
    }
    if (file.size > MAX_ARCHIVE_BYTES) return { ok: false, problem: `the saved project is over ${MAX_ARCHIVE_BYTES / 1048576} MB. Leave out large or generated files.` };
    const free = await this.fileWork.acquire(floor.id, st.signal);
    try { return await this.bringBack(st, file, task); } finally { free(); }
  }
  async bringBack(st, file, task) {
    const e = this.engine; const { floor, agent, taskId, project } = st;
    let unpacked;
    try { unpacked = unpackTgz(await this.client.download(file.id), { maxBytes: MAX_UNPACKED_BYTES }); } catch (err) {
      if (err instanceof TarError) return { ok: false, problem: err.message };
      throw err;
    }
    const baseline = JSON.parse(task.session_baseline || '{}');
    const keep = unpacked.files.filter((f) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(f.path));
    let sync;
    try { sync = applySync(e.db, floor.id, project, keep, baseline, agent.id, e.cfg.quotaBytes); } catch (err) {
      if (err instanceof WorkspaceError) return { ok: false, problem: err.message };
      throw err;
    }
    // Only what was accepted: a name that was refused has no business being stored at all.
    run(e.db, 'UPDATE tasks SET session_baseline=? WHERE id=?', JSON.stringify(baselineOf(sync.accepted)), taskId);
    if (sync.written || sync.removed) e.feed(floor.id, agent, `brought ${sync.written + sync.removed} files back from the computer`, project);
    e.emitProject(floor.id, project);
    // A file that was left out of something about to go live means a broken site, so the agent hears about it rather than the visitor.
    const dropped = [...sync.skipped, ...unpacked.ignored];
    const inPublished = dropped.filter((d) => st.publish.some((p) => !p.directory || d.startsWith(`${p.directory}/`)));
    if (inPublished.length && !st.droppedTold) {
      st.droppedTold = true;
      return { ok: false, problem: `these files were left out, because of their path or type: ${inPublished.slice(0, 12).join(', ')}. Paths may use letters, digits and . _ - only, at most 10 folders deep, and files need a common web extension.` };
    }
    const published = [];
    for (const p of st.publish) {
      const dir = p.directory ? `${p.directory}/` : '';
      const prefix = `projects/${p.project}/${dir}`;
      const has = (n) => get(e.db, 'SELECT 1 x FROM files WHERE floor_id=? AND path=?', floor.id, prefix + n);
      const isDoc = p.kind === 'doc' || p.kind === 'research';
      if (!has('index.html') && !(isDoc && has('index.md'))) return { ok: false, problem: `${prefix}${isDoc ? 'index.md' : 'index.html'} is missing from what you saved.` };
      const check = await runCheck(e.db, floor, p.project, p.directory, p.kind);
      const refused = gateProblem(check, p.reason);
      saveCheck(e.db, floor.id, p.project, check, p.reason, e.now());
      if (refused) return { ok: false, problem: refused };
      const held = await e.shipCheck?.(floor, p.project, { kind: p.kind, directory: p.directory, agent, task: { id: taskId } });
      if (held) return { ok: false, problem: held };
      try {
        const n = publishSnapshot(e.db, floor.id, p.project, e.cfg.quotaBytes, p.directory);
        e.upsertProject(floor, p.project, { title: p.title, description: p.description, kind: p.kind, sources: [], published: true });
        published.push(e.liveUrl(floor, p.project));
        e.feed(floor.id, agent, `published ${p.project} (${n} files)`, p.project);
        e.emitProject(floor.id, p.project);
      } catch (err) {
        if (err instanceof WorkspaceError) return { ok: false, problem: err.message };
        throw err;
      }
    }
    return { ok: true, published, skipped: [...sync.skipped, ...unpacked.ignored] };
  }
}

function cleanDirectory(v) {
  if (v === undefined || v === null || v === '' || v === '.') return '';
  const d = String(v).replace(/^\.\//, '').replace(/\/+$/, '');
  if (d.length > 80 || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*){0,2}$/.test(d)) throw new WorkspaceError('directory must be a simple relative folder such as dist');
  return d;
}

