// A real computer for the Builder and Tester. Each task gets one Anthropic-hosted container through Claude Managed Agents, so untrusted code
// never runs on this server or the owner's Mac. This file boxes up the project, drives the session, shows its activity on the floor,
// charges what it really costs, and brings the finished files back into the floor's workspace, where publishing already lives.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { get, all, run } from './db.js';
import { ROOT } from './config.js';
import { Limiter } from './limiter.js';
import { ProviderError, scrub } from './llm.js';
import { costOf } from './anthropic.js';
import { packTgz, unpackTgz, TarError } from './tarball.js';
import { applySync, baselineOf, projectFiles, publishSnapshot, WorkspaceError } from './workspace.js';
import { COMPUTER_TOOL_DEFS, computerToolName, publicUrl, toolsForRole } from './tools.js';
import { runCheck, saveCheck, gateProblem } from './launch.js';
import { IOS_HOSTS } from './ios.js';
import { computerPrompt, computerBriefing } from './prompts.js';

const PACKAGE_HOSTS = ['registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org'];
const OUTPUT_WAIT_MS = 30000;
const MIN_ROOM_USD = 0.1;
const STALL_MS = 90_000;
const STOP_GRACE_MS = 120_000;
const MAX_FIX_TURNS = 2, MAX_LOST = 2, MAX_STREAM_FAILURES = 5;
const WARN_STEPS_LEFT = 5;
const MAX_ARCHIVE_BYTES = 40 * 1024 * 1024, MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

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
const THREE_JS = readFileSync(join(ROOT, 'public/vendor/three/three.module.min.js'));

/** The model settings a role uses on a computer. Managed Agents runs Claude only, so a role on another provider names its Claude settings here. */
export function computerRole(role) {
  if (!role?.computer) return null;
  const over = role.computer === true ? {} : role.computer;
  return { model: over.model || role.model, effort: over.effort ?? role.effort, pricing: over.pricing || role.pricing };
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
  }
  handles(role) { return !!computerRole(this.engine.models.all[role]); }

  // ---- control-plane objects: created once, kept by id, updated only when their definition changes ----
  setting(key) { const v = get(this.engine.db, 'SELECT value FROM settings WHERE key=?', key)?.value; return v ? JSON.parse(v) : null; }
  saveSetting(key, value) { run(this.engine.db, 'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  async environmentId(hosts = PACKAGE_HOSTS, key = 'ma_environment') {
    // Deny by default: named package registries and nothing else. allow_package_managers would also open GitHub, which is a way out for a hijacked agent. Checked on a real session: npm, pip, Vite and Playwright all work on this list.
    const def = { name: key === 'ma_environment' ? 'theoffice-computer' : 'theoffice-ios', config: { type: 'cloud', networking: { type: 'limited', allow_package_managers: false, allow_mcp_servers: false, allowed_hosts: hosts } } };
    const h = hash(def);
    const have = this.setting(key);
    if (have?.hash === h) return have.id;
    const env = await this.client.createEnvironment({ ...def, name: `${def.name}-${h}` });
    this.saveSetting(key, { id: env.id, hash: h });
    return env.id;
  }
  async agentRef(roleKey) {
    const { cfg, models } = this.engine;
    const role = models.all[roleKey]; const comp = computerRole(role);
    const tools = COMPUTER_TOOL_DEFS(cfg, roleKey);
    const def = {
      name: `theoffice-${roleKey}`, model: { id: comp.model, ...(comp.effort ? { effort: comp.effort } : {}) }, system: computerPrompt(cfg, roleKey, role),
      tools: [
        { type: 'agent_toolset_20260401', default_config: { enabled: true, permission_policy: { type: 'auto' } }, configs: [{ name: 'web_fetch', enabled: false }, { name: 'web_search', enabled: false }] },
        ...tools,
      ],
    };
    const h = hash(def); const key = `ma_agent_${roleKey}`;
    const have = this.setting(key);
    if (have?.hash === h) return { type: 'agent', id: have.id, version: have.version };
    const made = have ? await this.client.updateAgent(have.id, def) : await this.client.createAgent(def);
    this.saveSetting(key, { id: made.id, version: made.version, hash: h });
    return { type: 'agent', id: made.id, version: made.version };
  }

  // ---- money ----
  /** The most this session may spend right now: the smallest of its own limit and every cap that is set. */
  room(floorId, task) {
    const { cfg } = this.engine; const e = this.engine;
    const perTask = cfg.taskMaxUsd - task.cost_usd;
    const perDay = Math.min(cfg.floorDailyUsd - e.spentToday(floorId) - (e.reserved.get(floorId) || 0), cfg.globalDailyUsd - e.spentGlobal() - e.reservedTotal);
    return { usd: Math.min(cfg.sessionMaxUsd, perTask, perDay), daily: perDay < Math.min(cfg.sessionMaxUsd, perTask) };
  }
  charge(st, model, prompt, completion, cost) {
    this.engine.charge(st.floorId, st.agent, model, prompt, completion, cost, { taskId: st.taskId });
    st.charged += cost;
    run(this.engine.db, 'UPDATE tasks SET session_charged=? WHERE id=?', st.charged, st.taskId);
    const back = Math.min(cost, st.hold);
    if (back > 0) { this.engine.unreserve(st.floorId, back); st.hold -= back; }
  }
  /** The platform's figure is the authority: running time and anything missed while disconnected is charged here. */
  async reconcile(st) {
    try {
      const s = await this.client.retrieve(st.id);
      const cents = Number(s.usage?.list_cost?.amount);
      if (!Number.isFinite(cents)) return;
      const delta = cents / 100 - st.charged;
      if (delta > 0.005) this.charge(st, 'managed-session', 0, 0, delta);
    } catch (e) { this.engine.log('warn', 'could not read session cost', { err: scrub(e?.message, this.engine.cfg) }); }
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
        run(e.db, 'UPDATE tasks SET transcript=? WHERE id=?', JSON.stringify([{ role: 'user', content: computerBriefing(floor, agent, e.models.all[agent.role], task, e.cfg) }]), task.id);
        task = get(e.db, 'SELECT * FROM tasks WHERE id=?', taskId);
      }
      st = this.newState(floor, agent, task, signal);
      await this.attach(st, task);
      await this.finish(st, await this.drive(st));
    } catch (err) {
      const why = err?.why ?? signal.reason?.why;
      // Only a shutdown leaves a session running, because the next boot picks it up. On any other way out it must not carry on spending unwatched.
      if (st?.id && why !== 'shutdown') await this.client.send(st.id, [{ type: 'user.interrupt' }]).catch(() => {});
      // A paused session stopped mid-thought, so it needs telling to carry on. A shutdown leaves it running, and the next boot simply reattaches.
      if (st?.id && why === 'pause') this.pushMessage(taskId, 'You were paused for a while. Carry on where you left off.');
      e.handleRunError(floorId, agent, task, err, () => {
        run(e.db, "UPDATE tasks SET status='todo', updated_at=? WHERE id=? AND status='doing'", e.now(), taskId);
        e.emitTask(taskId);
      });
    } finally {
      if (st?.id) await this.reconcile(st);
      if (st?.hold > 0) { e.unreserve(floorId, st.hold); st.hold = 0; }
      release?.();
    }
  }
  pushMessage(taskId, content) {
    const t = get(this.engine.db, 'SELECT transcript FROM tasks WHERE id=?', taskId);
    const msgs = t?.transcript ? JSON.parse(t.transcript) : [];
    msgs.push({ role: 'user', content });
    run(this.engine.db, 'UPDATE tasks SET transcript=? WHERE id=?', JSON.stringify(msgs), taskId);
  }

  newState(floor, agent, task, signal) {
    const e = this.engine;
    const comp = computerRole(e.models.all[agent.role]);
    return {
      id: task.session_id || '', floorId: floor.id, floor, agent, taskId: task.id, project: task.project, signal, room: null,
      charged: task.session_id ? task.session_charged : 0, hold: 0, seen: new Set(), steps: 0, warned: false, limit: '', lastText: '', lastFeed: '',
      pendingCustom: new Map(), pendingAsk: new Map(), interruptSent: false, expectRun: false, budgetRaised: false, startedAt: Date.now(),
      publish: JSON.parse(task.session_publish || '[]'), model: comp.model, pricing: comp.pricing,
      ctx: { ...e.toolCtx(floor, agent, task, ['read_file', 'list_files', 'fetch_url', 'web_search', 'ask_boss', 'file_purchase_request', ...toolsForRole(agent.role).filter((n) => n === 'generate_image' || n === 'review_design')]), signal },
    };
  }

  /** A session with nobody following it: its task was stopped, or its floor is paused. Stop it, and put what it cost on the ledger. */
  async settleOrphan(task) {
    const e = this.engine;
    try {
      await this.client.send(task.session_id, [{ type: 'user.interrupt' }]).catch(() => {});
      const s = await this.client.retrieve(task.session_id);
      const delta = Number(s.usage?.list_cost?.amount) / 100 - task.session_charged;
      if (delta > 0.005) {
        e.charge(task.floor_id, { id: task.agent_id }, 'managed-session', 0, 0, delta, { taskId: task.id });
        run(e.db, 'UPDATE tasks SET session_charged=session_charged+? WHERE id=?', delta, task.id);
      }
    } catch (err) { e.log('warn', 'could not settle a session', { err: scrub(err?.message, e.cfg) }); }
  }
  /** At boot: sessions on floors that won't reattach for now are stopped, so they don't spend off the books. */
  recoverOrphans() {
    const paused = this.engine.globalPaused();
    for (const t of all(this.engine.db, "SELECT t.id,t.session_id,t.session_charged,t.agent_id,t.floor_id FROM tasks t JOIN floors f ON f.id=t.floor_id WHERE t.session_id!='' AND t.status='todo' AND (f.paused=1 OR f.status!='active' OR ?)", paused ? 1 : 0)) this.settleOrphan(t);
  }

  /** Reattach to this task's session if it is still alive, otherwise box up the project and start a fresh one. */
  async attach(st, task) {
    const e = this.engine; const { floor, agent, signal } = st;
    let room = this.room(floor.id, task);
    // Short of room only because other sessions hold it: they give back what they don't spend, so wait for them.
    while (room.usd < MIN_ROOM_USD && room.daily && !e.spentOver(floor.id, MIN_ROOM_USD)) {
      e.setAgent(agent.id, { state: 'queued', activity: 'Waiting for the budget to free up' });
      await new Promise((res, rej) => { const t = setTimeout(res, 2000); signal.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason); }, { once: true }); });
      e.checkpoint(floor.id, signal);
      room = this.room(floor.id, task);
    }
    st.room = room;
    if (room.usd < MIN_ROOM_USD) {
      if (room.daily) throw new e.Halt('budget');
      e.finishTask(floor, agent, task.id, 'failed', 'Stopped: this task hit its spending limit.');
      throw new e.Halt('stop');
    }
    // Held from this moment, so nothing else on the floor can spend the same dollars while this one starts up.
    st.hold = room.usd; e.reserve(floor.id, st.hold);
    if (st.id) {
      let live = null;
      try { live = await this.client.retrieve(st.id); } catch (err) { if (err?.status !== 404) throw err; }
      if (live && live.status !== 'terminated') {
        this.equip(st);
        // The budget is fixed at creation, so a reattached session is re-capped to what may be spent from now on.
        const spent = Number(live.usage?.list_cost?.amount) || 0;
        await this.client.updateSession(st.id, { budget: { type: 'limit', max_list_cost: { amount: String(spent + Math.floor(room.usd * 100)), currency: 'USD' } } });
        st.budgetRaised = true; st.resumed = true;
        e.feed(floor.id, agent, `went back to the computer for "${task.title}"`, task.project);
        return;
      }
      if (task.session_tries >= MAX_LOST) {
        // The floor pauses, and resuming it is someone deciding to try again, so the count starts over.
        run(e.db, 'UPDATE tasks SET session_tries=0 WHERE id=?', task.id);
        throw new ProviderError('The computer keeps disappearing.', { retryable: false });
      }
      run(e.db, "UPDATE tasks SET session_id='', session_charged=0, session_sent=0, session_tries=session_tries+1 WHERE id=?", task.id);
      this.pushMessage(task.id, 'Your earlier computer was lost. /workspace/project now holds everything that had been saved, so check what is still missing and finish the job.');
      st.id = ''; st.charged = 0;
    }
    const agentRef = await this.agentRef(agent.role);
    const vaulted = !!task.vault && !!e.cfg.iosEnabled && !!e.cfg.iosVaultId;
    const environment = vaulted ? await this.environmentId(IOS_HOSTS, 'ma_environment_ios') : await this.environmentId();
    // Only this one project goes in. Other projects, other floors and anything of ours stay out of the box.
    const files = projectFiles(e.db, floor.id, task.project);
    const box = packTgz([
      { path: '.office/save.sh', data: Buffer.from(SAVE_SH), mode: 0o755 },
      { path: '.office/client.js', data: CLIENT_JS },
      { path: '.office/launch-check.mjs', data: Buffer.from(LAUNCH_CHECK) },
      { path: '.office/three.module.min.js', data: THREE_JS },
      ...files.map((f) => ({ path: `project/${f.path}`, data: f.data })),
    ]);
    e.checkpoint(floor.id, signal);
    const upload = await this.client.upload(box, 'bundle.tgz');
    const session = await this.client.createSession({
      agent: agentRef, environment_id: environment, title: `Floor ${floor.number}, task ${task.id}`,
      resources: [{ type: 'file', file_id: upload, mount_path: '/office/bundle.tgz' }],
      budget: { type: 'limit', max_list_cost: { amount: String(Math.floor(room.usd * 100)), currency: 'USD' } },
      metadata: { app: 'theoffice', floor: String(floor.id), task: String(task.id) },
      // Only a task made by the boss's click ever holds this. The container still only sees a placeholder.
      ...(vaulted ? { vault_ids: [e.cfg.iosVaultId] } : {}),
    });
    // The session holds its own copy of the box, so ours has no reason to outlive this call.
    await this.client.deleteFile(upload).catch(() => {});
    st.id = session.id;
    this.equip(st);
    run(e.db, 'UPDATE tasks SET session_id=?, session_baseline=?, session_sent=0, session_charged=0 WHERE id=?', session.id, JSON.stringify(baselineOf(files)), task.id);
    e.feed(floor.id, agent, `started a computer for "${task.title}"`, task.project);
    e.setAgent(agent.id, { state: 'thinking', activity: 'Starting up the computer', project: task.project, task_id: task.id });
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
        for await (const ev of this.client.listEvents(st.id)) {
          if (st.seen.has(ev.id)) continue;
          st.seen.add(ev.id);
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
          if (ev.id && st.seen.has(ev.id)) continue;
          if (ev.id) st.seen.add(ev.id);
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
          const left = e.cfg.sessionMaxSteps - st.steps;
          if (left === WARN_STEPS_LEFT && !st.warned) {
            st.warned = true;
            this.client.send(st.id, [{ type: 'system.message', content: [{ type: 'text', text: `You have ${WARN_STEPS_LEFT} steps left on this computer. Finish up now: save your work with .office/save.sh, publish if you are going to, and reply with your summary.` }] }]).catch(() => {});
          }
          if (left <= 0) this.stopFor(st, 'steps');
        }
        return null;
      case 'span.model_request_end':
        // History from before a reconnect is settled by reconcile(), which uses the platform's own total.
        if (live && ev.model_usage) {
          const u = costOf(ev.model_usage, st.pricing);
          this.charge(st, st.model, u.prompt, u.completion, u.cost);
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
        if (hit) return hit.size > MAX_ARCHIVE_BYTES ? null : this.client.download(hit.id);
        if (Date.now() > until) return null;
        await sleep(2000);
      }
    };
  }
  async custom(st, ev) {
    const e = this.engine;
    const name = computerToolName(ev.name);
    if (name === 'publish_project') { try { return this.declarePublish(st, ev.input || {}); } catch (err) { if (err instanceof WorkspaceError) return `Error: ${err.message}`; throw err; } }
    return e.tools.exec(st.ctx, name, JSON.stringify(ev.input ?? {}));
  }
  // Files in a container can't be read from here until the turn ends, so publishing is recorded now and happens then.
  declarePublish(st, a) {
    if (st.agent.role === 'tester') throw new WorkspaceError('testers report back rather than publish');
    const slug = String(a.project ?? st.project);
    if (slug !== st.project) throw new WorkspaceError(`this computer can only publish its own project, "${st.project}"`);
    const kind = ['site', 'app', 'game', 'simulation', 'doc', 'research'].includes(a.kind) ? a.kind : 'site';
    const directory = cleanDirectory(a.directory);
    const entry = { project: slug, title: String(a.title || slug).slice(0, 120), description: String(a.description || '').slice(0, 300), kind, directory, reason: String(a.claims_ok_because || '').slice(0, 300) };
    st.publish = [...st.publish.filter((p) => p.project !== slug), entry];
    run(this.engine.db, 'UPDATE tasks SET session_publish=? WHERE id=?', JSON.stringify(st.publish), st.taskId);
    return `Noted. ${directory ? `${directory}/` : 'The project folder'} goes live at ${publicUrl(st.floor.slug, slug)} once you have run .office/save.sh and ended your turn. Save first, and do it last, so the newest files are the ones published.`;
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
    if (outcome === 'retries') throw new ProviderError('The computer failed repeatedly.', { retryable: false });
    if (outcome === 'terminated') { await this.collect(st).catch(() => {}); return this.lost(st); }
    if (outcome === 'refused') { await this.reconcile(st); return e.finishTask(floor, agent, taskId, 'failed', 'The model declined this one.'); }
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
      if (result.ok || outcome !== 'done' || st.limit || turn >= MAX_FIX_TURNS) break;
      this.pushMessage(taskId, `That did not go through: ${result.problem} Fix it, run .office/save.sh again, then end your turn.`);
      e.feed(floor.id, agent, 'had to fix something before it could be saved', st.project);
      outcome = await this.drive(st);
      if (outcome === 'retries') throw new ProviderError('The computer failed repeatedly.', { retryable: false });
      if (outcome === 'terminated') return this.lost(st);
    }
    await this.reconcile(st);
    const links = result.published?.length ? `\n\nPublished: ${result.published.join(', ')}` : '';
    if (outcome === 'budget') {
      // Stopped by what was left of the day. Over for today if the money is really gone; otherwise it goes back in line for what other sessions give back.
      if (st.room.daily) throw new e.Halt(e.spentOver(floor.id, MIN_ROOM_USD) ? 'budget' : 'wait');
      return e.finishTask(floor, agent, taskId, 'failed', `Stopped: this task hit its spending limit.${links}`);
    }
    if (st.limit === 'steps') return e.finishTask(floor, agent, taskId, 'failed', `Ran out of steps before finishing.${links}`);
    if (st.limit === 'time') return e.finishTask(floor, agent, taskId, 'failed', `Ran out of time before finishing.${links}`);
    if (!result.ok) return e.finishTask(floor, agent, taskId, 'failed', `The work could not be saved: ${result.problem}`);
    return e.finishTask(floor, agent, taskId, 'review', `${(st.lastText || 'Finished.').slice(0, 1800)}${links}`);
  }
  lost(st) {
    const e = this.engine;
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
      const check = runCheck(e.db, floor, p.project, p.directory, p.kind);
      const refused = gateProblem(check, p.reason);
      saveCheck(e.db, floor.id, p.project, check, p.reason, e.now());
      if (refused) return { ok: false, problem: refused };
      try {
        const n = publishSnapshot(e.db, floor.id, p.project, e.cfg.quotaBytes, p.directory);
        e.upsertProject(floor, p.project, { title: p.title, description: p.description, kind: p.kind, sources: [], published: true });
        published.push(publicUrl(floor.slug, p.project));
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

