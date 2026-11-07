// The agent runtime: floors, manager and staff tool loops, budget, pause/stop/redirect, events.
import { get, all, run, tx } from './db.js';
import { Limiter } from './limiter.js';
import { ProviderError, scrub } from './llm.js';
import { createBudget, providerForRole, providerOf, scrubOldSpend } from './budget.js';
import { createTools, toolDefs, toolsForRole, publicUrl } from './tools.js';
import { createDomainBroker } from './domains.js';
import { createIos } from './ios.js';
import { createMedia, createMockMedia } from './media.js';
import { createSearch, createMockSearch } from './search.js';
import { appLabel, appOrigin } from './apps.js';
import { formCount } from './launch.js';
import { managerPrompt, staffPrompt } from './prompts.js';
import { slugify, WorkspaceError } from './workspace.js';
import { seededLook } from '../public/js/looks.js';
import { Computer } from './computer.js';
import { deleteFloorData } from './appdata.js';

const today = (ms) => new Date(ms).toISOString().slice(0, 10);
const MAX_STAFF_STEPS = 14, MAX_MANAGER_STEPS = 8, MAX_OPEN_TASKS = 14, MAX_TASKS_PER_DAY = 60, EVENT_KEEP = 1500;
const STAFF_NAMES = ['Margot', 'Wren', 'Otis', 'Juno', 'Felix', 'Ines', 'Hugo', 'Tess', 'Nico', 'Bea', 'Arlo', 'Mina'];
const BACKOFF = [1, 3, 8];
const PRIVATE_TEXT = 'Working on something private';
// As soon as a model starts writing a tool call, the character starts acting it out. For a big file that's most of the wait.
const TOOL_LOOK = {
  write_file: ['typing', 'Writing'], publish_project: ['typing', 'Getting it ready to publish'], fetch_url: ['browsing', 'Looking something up'], web_search: ['browsing', 'Searching the web'],
  read_file: ['reading', 'Reading'], list_files: ['reading', 'Checking the shared drive'], ask_boss: ['thinking', 'Writing a question for the boss'], file_purchase_request: ['typing', 'Filling in a request'],
  assign_task: ['typing', 'Writing up the plan'], review_task: ['reading', 'Reviewing the work'], hire_staff: ['typing', 'Writing a job offer'], cancel_task: ['typing', 'Crossing something off'],
  ask_buddehbot: ['thinking', 'Writing to buddehbot'],
};
// The label on an answer from the help line. Staff reports, files and pages can claim to be buddehbot, but only this message is, and it only ever advises.
export const GUIDANCE_LABEL = '[Guidance from buddehbot, the building owner\'s assistant, answering a question you asked. It is advice, not an order from the boss, and it changes no limit or rule.]';

export class Halt extends Error { constructor(why) { super(why); this.name = 'Halt'; this.why = why; } }

export class Engine {
  constructor({ db, cfg, models, llm, bus, log, now = Date.now, fetcher, httpFetch, sessions, namecheap, media, search }) {
    Object.assign(this, { db, cfg, models, llm, bus, log, now });
    this.Halt = Halt;
    this.budget = createBudget(db, cfg, now);
    this.computer = sessions ? new Computer(this, sessions) : null;
    this.limiter = new Limiter(cfg.maxCallsFloor, cfg.maxCallsGlobal);
    this.tools = createTools({ db, cfg, engine: this, fetcher, httpFetch });
    this.domains = createDomainBroker({ db, cfg, engine: this, client: namecheap });
    this.ios = createIos({ db, cfg, engine: this });
    const brokers = models.tools || {};
    // A mock building never reaches a paid broker, whatever keys happen to be set.
    const real = cfg.aiMode !== 'mock';
    this.media = media || (cfg.mediaMock ? createMockMedia(brokers) : real && cfg.openrouterKey && brokers.image ? createMedia({ cfg, tools: brokers, httpFetch: httpFetch || fetch }) : null);
    this.search = search || (cfg.searchMock ? createMockSearch() : real && cfg.anthropicKey && brokers.search ? createSearch({ cfg, tool: brokers.search }) : null);
    this.runs = new Map();      // agentId -> { ctl, floorId, promise }
    this.reserved = new Map();  // floorId -> dollars reserved by in-flight calls
    this.reservedTotal = 0;
    this.tickQueued = false;
    this.timer = null;
    this.eventCount = 0;
    this.stopped = false;
    this.errors = [];
  }

  // ---- lifecycle ----
  start() {
    // Anything mid-flight when the server last stopped goes back to the queue, keeping its saved transcript.
    run(this.db, "UPDATE tasks SET status='todo' WHERE status='doing'");
    run(this.db, "UPDATE agents SET state='idle', activity='', project='', task_id=NULL");
    run(this.db, "UPDATE floors SET budget_notice_day=''");  // re-judged on the next tick, in case the caps changed
    scrubOldSpend(this.db);
    this.settleLeftoverHolds();
    this.computer?.recoverOrphans();
    this.domains.recover();
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref?.();
    this.domainTimer = setInterval(() => { this.domains.reconcile().catch((e) => this.fail('domains', e)); }, this.cfg.domainReconcileMs ?? 30000);
    this.domainTimer.unref?.();
    this.kick();
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearInterval(this.domainTimer);
    for (const r of this.runs.values()) r.ctl.abort(new Halt('shutdown'));
    await Promise.allSettled([...this.runs.values()].map((r) => r.promise));
  }
  kick() {
    if (this.tickQueued || this.stopped) return;
    this.tickQueued = true;
    setImmediate(() => { this.tickQueued = false; try { this.tick(); } catch (e) { this.fail('tick', e); } });
  }
  fail(where, e) { this.errors.push(`${where}: ${e?.message}`); this.log('error', where, { err: scrub(e?.message, this.cfg) }); }

  globalPaused() { return get(this.db, "SELECT value FROM settings WHERE key='global_pause'")?.value === '1'; }
  setGlobalPause(on) {
    run(this.db, "INSERT INTO settings (key,value) VALUES ('global_pause',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", on ? '1' : '0');
    if (on) for (const r of this.runs.values()) r.ctl.abort(new Halt('pause'));
    for (const f of all(this.db, "SELECT id FROM floors WHERE status='active'")) this.emitFloor(f.id);
    this.kick();
  }

  // ---- scheduling ----
  tick() {
    if (this.stopped || this.globalPaused()) return;
    // A filler company is a scripted scene: nothing on it ever reaches a model, whatever its rows say.
    const floors = all(this.db, `SELECT f.* FROM floors f WHERE f.status='active' AND f.paused=0 AND f.filler=0
      AND (f.manager_wake=1 OR f.budget_out!='' OR EXISTS (SELECT 1 FROM tasks t WHERE t.floor_id=f.id AND t.status='todo'))`);
    for (const f of floors) this.tickFloor(f);
  }
  tickFloor(floor) {
    const day = today(this.now());
    if (floor.budget_notice_day === day) return;  // stopped for today; the date rolling over starts it again
    if (this.spentOver(floor.id, 0)) { this.budgetNotice(floor, day); return; }
    if (this.overBudget(floor.id, 0)) return;  // only held by running sessions, so not over yet: wait and see what they really spend
    const agents = all(this.db, 'SELECT * FROM agents WHERE floor_id=?', floor.id);
    const mgr = agents.find((a) => a.role === 'manager');
    // Whoever works on a provider that has reached its limit stays in the queue. Everyone else on the floor carries on.
    const stopped = new Set();
    const usedUp = (a) => { const p = this.agentProvider(a); if (!this.budget.out(p)) return false; stopped.add(p); return true; };
    if (floor.manager_wake && !this.runs.has(mgr.id) && !usedUp(mgr)) {
      run(this.db, 'UPDATE floors SET manager_wake=0 WHERE id=?', floor.id);
      this.launch(floor, mgr, (ctl) => this.runManager(floor.id, mgr.id, ctl));
    }
    const todo = all(this.db, "SELECT * FROM tasks WHERE floor_id=? AND status='todo' ORDER BY id", floor.id);
    for (const t of todo) {
      if (this.runs.has(t.agent_id)) continue;
      const deps = JSON.parse(t.depends_on || '[]');
      if (deps.length) {
        const marks = deps.map(() => '?').join(',');
        const open = get(this.db, `SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND id IN (${marks}) AND status IN ('todo','doing','blocked')`, floor.id, ...deps).n;
        if (open) continue;
      }
      const agent = agents.find((a) => a.id === t.agent_id);
      if (!agent || usedUp(agent)) continue;
      run(this.db, "UPDATE tasks SET status='doing', updated_at=? WHERE id=?", this.now(), t.id);
      this.emitTask(t.id);
      this.launch(floor, agent, (ctl) => (this.computer?.handles(agent.role) ? this.computer.run(floor.id, agent.id, t.id, ctl) : this.runStaff(floor.id, agent.id, t.id, ctl)));
    }
    this.judgeBuildingBudget(floor, stopped);
  }
  launch(floor, agent, fn) {
    const ctl = new AbortController();
    const entry = { ctl, floorId: floor.id, promise: null };
    this.runs.set(agent.id, entry);
    entry.promise = Promise.resolve().then(() => fn(ctl)).catch((e) => this.fail('run', e)).finally(() => {
      this.runs.delete(agent.id);
      this.setAgent(agent.id, { state: 'idle', activity: '', project: '', task_id: null });
      this.kick();
    });
  }
  haltFloorRuns(floorId, why) {
    for (const r of this.runs.values()) if (r.floorId === floorId) r.ctl.abort(new Halt(why));
  }

  // ---- budget ----
  // A domain is paid for from the registrar balance and has limits of its own, so buying one doesn't stop the staff working for the day.
  spentToday(floorId) { return get(this.db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND day=? AND kind!='domain'", floorId, today(this.now())).n; }
  spentGlobal() { return get(this.db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE day=? AND kind!='domain'", today(this.now())).n; }
  overBudget(floorId, extra) {
    const f = this.spentToday(floorId) + (this.reserved.get(floorId) || 0) + extra;
    const g = this.spentGlobal() + this.reservedTotal + extra;
    return f >= this.cfg.floorDailyUsd || g >= this.cfg.globalDailyUsd;
  }
  // Money actually gone, not merely held by a running session. Only this can stop a floor for the day.
  spentOver(floorId, extra) { return this.spentToday(floorId) + extra >= this.cfg.floorDailyUsd || this.spentGlobal() + extra >= this.cfg.globalDailyUsd; }
  budgetNotice(floor, day) {
    const f = get(this.db, 'SELECT budget_notice_day d FROM floors WHERE id=?', floor.id);
    if (f.d === day) return;
    run(this.db, 'UPDATE floors SET budget_notice_day=? WHERE id=?', day, floor.id);
    this.bossNotice(floor.id, 'That\'s the budget for today, boss. The staff have downed tools and everything is saved. We\'ll pick it back up tomorrow.');
    this.feed(floor.id, null, 'The staff have stopped for today. Back tomorrow.', '');
    this.emitFloor(floor.id);
  }
  // ---- the building's lifetime limits, one per provider ----
  /** Who gets paid when this person works. A computer is always Claude, whatever the role's own model is. */
  agentProvider(agent) { return this.computer?.handles(agent.role) ? 'anthropic' : providerForRole(this.models.all[agent.role] || this.models.all.researcher); }
  /** The boss hears once that the building is out of budget, and never how much. Raising a limit and restarting clears this on the next tick, and the queue simply starts again. */
  judgeBuildingBudget(floor, stopped) {
    const was = floor.budget_out ? floor.budget_out.split(',') : [];
    const out = [...stopped].sort();
    if (was.join() === out.join()) return;
    run(this.db, 'UPDATE floors SET budget_out=? WHERE id=?', out.join(','), floor.id);
    if (!was.length) this.bossNotice(floor.id, 'Boss, the building is out of budget, so work has stopped and everything is saved. Please ask the owner about it. We\'ll carry on by ourselves as soon as that is sorted.');
    else if (!out.length && was.every((p) => !this.budget.out(p))) this.bossNotice(floor.id, 'Good news, boss: the building has budget again, so we\'re back at work.');
    this.emitFloor(floor.id);
  }
  /** A call that was in flight when the process died has no ledger row and never will. It may well have cost what it held, so that is what goes down. */
  settleLeftoverHolds() {
    for (const h of this.budget.leftoverCalls()) {
      this.charge(h.floor_id, { id: h.agent_id }, 'unsettled-call', 0, 0, h.usd, { taskId: h.task_id, kind: 'unsettled', provider: h.provider });
      this.budget.release(h.id);
    }
    this.budget.dropStaleSessionHolds();
  }
  /** A paid call made by a tool. It holds its estimate while it runs and, like any model call, is charged even if it gets stopped part way. */
  async brokerCall(c, { provider, usd, model, kind }, fn) {
    const id = this.budget.hold(provider, { floorId: c.floor.id, agentId: c.agent.id, taskId: c.task?.id, usd });
    try {
      const r = await fn();
      this.charge(c.floor.id, c.agent, model, r.usage.prompt, r.usage.completion, r.usage.cost, { taskId: c.task?.id, kind, provider });
      return r;
    } catch (e) {
      if (c.signal?.aborted) this.charge(c.floor.id, c.agent, model, 0, 0, usd, { taskId: c.task?.id, kind, provider });
      throw e;
    } finally { this.budget.release(id); }
  }
  reserve(floorId, n) { this.reserved.set(floorId, (this.reserved.get(floorId) || 0) + n); this.reservedTotal += n; }
  unreserve(floorId, n) {
    const v = (this.reserved.get(floorId) || 0) - n;
    if (v <= 1e-12) this.reserved.delete(floorId); else this.reserved.set(floorId, v);
    this.reservedTotal = Math.max(0, this.reservedTotal - n);
  }

  // ---- one LLM call: budget check, concurrency slot, retries, ledger ----
  async callLLM(ctx, { messages, tools, onToken, onToolCall, onReset, meta }) {
    const { floorId, agent, signal } = ctx;
    const role = this.models.all[agent.role] || this.models.all.researcher;
    const provider = providerForRole(role);
    const paid = { ...ctx, provider };
    const pricing = { prompt: role.pricing?.prompt || 0, completion: role.pricing?.completion || 0, cacheRead: role.pricing?.cacheRead };
    let attempt = 0;
    for (;;) {
      this.setAgent(agent.id, { state: 'queued' });
      const release = await this.limiter.acquire(floorId, signal);
      let reservation = 0, holdId = 0;
      try {
        const est = (JSON.stringify(messages).length / 4 * pricing.prompt + (role.maxTokens || 2000) * pricing.completion) / 1e6;
        if (this.budget.out(provider)) throw new Halt('building_budget');
        if (this.overBudget(floorId, est) || this.budget.room(provider) <= 0) {
          if (this.spentOver(floorId, est)) throw new Halt('budget');  // est assumes maxTokens, so the cap holds
          // Blocked only by a session's hold, which comes back when that session ends. Wait without keeping the slot.
          release();
          await new Promise((res, rej) => {
            const t = setTimeout(res, 2000);
            signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason); }, { once: true });
          });
          continue;
        }
        reservation = Math.min(est, 0.25);
        this.reserve(floorId, reservation);
        // The whole estimate: once what is left is spoken for, nothing else starts until this has settled. So only a call already under way can go over the limit.
        holdId = this.budget.hold(provider, { floorId, agentId: agent.id, taskId: ctx.taskId, usd: est });
        this.setAgent(agent.id, { state: 'thinking' });
        const chars = { n: 0 };
        const res = await this.llm.chat({
          model: role.model, provider: role.provider, effort: role.effort, messages, tools, maxTokens: role.maxTokens || 2000, signal, pricing, meta,
          onToken: (t) => { chars.n += t.length; onToken?.(t); },
          onToolCall: (name) => {
            const show = TOOL_LOOK[name];
            if (show) this.setAgent(agent.id, { state: show[0], activity: show[1] });
            onToolCall?.(name);
          },
        }).catch((e) => {
          // An aborted or broken stream still cost something. Charge an estimate so the ledger cannot be dodged.
          const sent = Math.max(chars.n, e?.streamedChars || 0);
          // That includes a call aborted before its first token: the provider has already started on it.
          if (sent > 0 || signal?.aborted) this.charge(floorId, agent, role.model, Math.ceil(JSON.stringify(messages).length / 4), Math.ceil(sent / 4), (JSON.stringify(messages).length / 4 * pricing.prompt + sent / 4 * pricing.completion) / 1e6, paid);
          throw e;
        });
        this.charge(floorId, agent, role.model, res.usage.prompt, res.usage.completion, res.usage.cost, paid);
        return res;
      } catch (e) {
        if (e instanceof Halt || signal?.aborted) throw signal?.reason instanceof Halt ? signal.reason : e;
        if (!(e instanceof ProviderError)) throw e;
        if (!e.retryable || attempt >= BACKOFF.length) throw e;
        onReset?.();
        const wait = Math.max(BACKOFF[attempt] * this.cfg.retryBaseMs, Math.min(e.retryAfterMs || 0, 30000));
        attempt++;
        this.feed(floorId, agent, `hit a provider hiccup, retrying (${attempt}/${BACKOFF.length})`, ctx.project);
        release(); // give the slot back while waiting
        await new Promise((res, rej) => {
          const t = setTimeout(res, wait + Math.random() * 100);
          signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason); }, { once: true });
        });
        continue;
      } finally {
        if (reservation) this.unreserve(floorId, reservation);
        if (holdId) this.budget.release(holdId);
        release();
      }
    }
  }
  charge(floorId, agent, model, prompt, completion, cost, ctx) {
    run(this.db, 'INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at,kind,provider) VALUES (?,?,?,?,?,?,?,?,?,?)', floorId, today(this.now()), agent.id, model, prompt, completion, cost, this.now(), ctx?.kind || 'model', ctx?.provider || providerOf(model, ctx?.kind));
    if (ctx?.taskId) run(this.db, 'UPDATE tasks SET cost_usd=cost_usd+? WHERE id=?', cost, ctx.taskId);
  }

  // ---- manager ----
  managerContext(floor, mgr) {
    const boss = JSON.parse(floor.boss);
    const staff = all(this.db, 'SELECT id,name,role,title FROM agents WHERE floor_id=? AND role!=? ORDER BY id', floor.id, 'manager');
    const tasks = all(this.db, "SELECT id,title,status,agent_id,project,result,brief,revisions FROM tasks WHERE floor_id=? AND status IN ('todo','doing','blocked','review') ORDER BY id", floor.id);
    const recent = all(this.db, "SELECT id,title,status,result FROM tasks WHERE floor_id=? AND status IN ('done','failed','cancelled') ORDER BY updated_at DESC LIMIT 12", floor.id);
    // Only counts and yes/no: what visitors typed into a form is theirs and the boss's, and it could be an attempt to steer the manager.
    const published = all(this.db, 'SELECT slug,title,kind,private,payment_link,launch_check,design_review,launch_report FROM projects WHERE floor_id=? AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 20', floor.id).map((p) => {
      const check = p.launch_check ? JSON.parse(p.launch_check) : null;
      return { slug: p.slug, title: p.title, kind: p.kind, private: p.private, url: this.liveUrl(floor, p.slug), payment: !!p.payment_link, reviewed: !!p.design_review, reported: !!p.launch_report, signups: formCount(this.db, floor.id, p.slug), checklist: check ? `${check.errors.length + check.claims.length} problems, ${check.warnings.length} rough edges` : 'not run' };
    });
    const domainLines = this.domains.forFloor(floor.id).filter((d) => ['awaiting_boss', 'buying', 'sent', 'bought', 'live', 'failed'].includes(d.status)).slice(0, 8).map((d) => `${d.domain} (${d.status}, for ${d.project})`);
    const name = (id) => staff.find((s) => s.id === id)?.name || 'unassigned';
    const state = [
      `STATE at ${new Date(this.now()).toISOString()}.`,
      `Roster: ${staff.map((s) => `${s.name} (${s.role})`).join(', ')}. Staff limit ${this.cfg.maxStaff}. Hireable: ${Object.keys(this.models.hireable).join(', ')}.`,
      `Open tasks: ${tasks.length ? tasks.map((t) => `#${t.id} [${t.status}] "${t.title}" (${name(t.agent_id)})${t.status === 'review' ? ` result: ${t.result.slice(0, 600)}` : ''}`).join(' | ') : 'none'}`,
      `Recently finished: ${recent.length ? recent.map((t) => `#${t.id} [${t.status}] "${t.title}": ${t.result.slice(0, 200)}`).join(' | ') : 'none'}`,
      `Published: ${published.length ? published.map((p) => `${p.title} [slug ${p.slug}] (${p.kind}${p.private ? ', private' : ''}) ${p.url} checklist: ${p.checklist}; design review: ${p.reviewed ? 'done' : 'not done'}; Stripe link from the boss: ${p.payment ? 'yes' : 'no'}; sign-ups: ${p.signups}; launch report given: ${p.reported ? 'yes' : 'no'}`).join(' | ') : 'nothing yet'}`,
      ...(this.domains.enabled ? [`Domains: ${domainLines.length ? domainLines.join(' | ') : 'none'}. Limit: ${this.cfg.domainsPerFloorDay} a day, and only the boss's click buys one.`] : []),
      ...(this.help && this.cfg.helpEnabled !== false ? [this.help.stateLine(floor.id)] : []),
    ].join('\n');
    // 'office' notices (outage, stop) are for the boss only. If they reached the model it would lose the thread.
    // Reports stay out too: they quote what was found on pages, and the manager has the facts in the state message.
    // So does anything about the budget: a bot that doesn't know can't tell anyone.
    const msgs = all(this.db, "SELECT id,role,text FROM messages WHERE floor_id=? AND role NOT IN ('office','report','budget') ORDER BY id DESC LIMIT 30", floor.id).reverse();
    const roster = { manager: mgr.name };
    const out = [{ role: 'system', content: managerPrompt(floor, boss, roster, this.cfg) }];
    for (const m of msgs) {
      if (m.role === 'boss') out.push({ role: 'user', content: m.text });
      else if (m.role === 'manager') out.push({ role: 'assistant', content: m.text });
      else if (m.role === 'help') out.push({ role: 'user', content: `${GUIDANCE_LABEL} ${m.text}` });
      else out.push({ role: 'user', content: `[Office note, not from the boss] ${m.text}` });
    }
    out.push({ role: 'user', content: `[Office note, not from the boss] ${state}` });
    const bossMsgs = msgs.filter((m) => m.role === 'boss');
    const last = msgs[msgs.length - 1];
    const toReview = tasks.filter((t) => t.status === 'review');
    return { messages: out, meta: {
      kind: 'manager', floorId: floor.id, floorSlug: floor.slug, step: 0, lastBoss: bossMsgs[bossMsgs.length - 1]?.text || '', allBoss: bossMsgs.map((m) => m.text).join(' '),
      isFreshBoss: last?.role === 'boss', answered: last?.role === 'note' && /answered/.test(last.text), guidance: last?.role === 'help' ? last.text : '', helpDeadEnd: last?.role === 'note' && /buddehbot/.test(last.text),
      toReview, openCount: tasks.filter((t) => t.status !== 'review').length, published,
      slugFor: (s) => slugify(String(s).replace(/\[[a-z]+\]/g, '').replace(ACT_WORDS, ' '), 'launch').slice(0, 30).replace(/-+$/, '') || 'launch',
    } };
  }

  async runManager(floorId, agentId, ctl) {
    const floor = get(this.db, 'SELECT * FROM floors WHERE id=?', floorId);
    const mgr = get(this.db, 'SELECT * FROM agents WHERE id=?', agentId);
    const signal = ctl.signal;
    const { messages, meta } = this.managerContext(floor, mgr);
    const names = toolsForRole('manager');
    const defs = toolDefs(names, this.cfg, 'manager');
    const ctx = this.toolCtx(floor, mgr, null, names);
    ctx.signal = signal;
    const call = { floorId, agent: mgr, signal, project: '' };
    try {
      for (let step = 0; step < MAX_MANAGER_STEPS; step++) {
        this.checkpoint(floorId, signal);
        this.setAgent(mgr.id, { state: 'thinking', activity: step === 0 ? 'Thinking it over' : 'Sorting out the plan' });
        const buffer = { text: '', pending: '', timer: null };
        const flush = () => { if (buffer.pending) { this.emit(floorId, 'token', { text: buffer.pending }, { persist: false, chat: true }); buffer.pending = ''; } clearTimeout(buffer.timer); buffer.timer = null; };
        const res = await this.callLLM(call, {
          messages: compact(messages), tools: defs, meta: { ...meta, step },
          onToken: (t) => { buffer.text += t; buffer.pending += t; this.setAgent(mgr.id, { state: 'talking' }); buffer.timer ??= setTimeout(flush, 70); },
          onReset: () => { buffer.text = ''; buffer.pending = ''; this.emit(floorId, 'token_reset', {}, { persist: false, chat: true }); },
        }).finally(flush);
        const text = res.content.trim();
        const assistant = { role: 'assistant', content: res.content || null };
        if (res.toolCalls.length) assistant.tool_calls = res.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } }));
        if (res.rawContent) assistant.anthropic_content = res.rawContent;
        messages.push(assistant);
        if (text) this.managerSays(floorId, text);
        if (!res.toolCalls.length) break;
        const assignedBefore = ctx.assigned.length;
        for (const c of res.toolCalls) {
          this.checkpoint(floorId, signal);
          const out = await this.tools.exec(ctx, c.name, c.args);
          messages.push({ role: 'tool', tool_call_id: c.id, content: out });
        }
        if (ctx.assigned.length > assignedBefore) {
          // The whole batch gathers at the whiteboard: the visual cue that a plan was made.
          const ids = [...new Set(ctx.assigned.slice(assignedBefore))];
          this.emit(floorId, 'meeting', { manager: mgr.id, staff: ids });
          this.kick();
        }
        if (ctx.suspend) break;
      }
      this.settleReviews(floorId, meta.toReview);
    } catch (e) { this.handleRunError(floorId, mgr, null, e, () => { run(this.db, 'UPDATE floors SET manager_wake=1 WHERE id=?', floorId); }); }
  }
  // Work the manager was shown but neither approved nor sent back is accepted, so nothing sits in review forever.
  // A revision that came back mid-turn has a new revision count, and is left for the next wake.
  settleReviews(floorId, seen) {
    const open = get(this.db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status IN ('todo','doing','blocked')", floorId).n;
    if (open) return;
    for (const t of seen) {
      const r = run(this.db, "UPDATE tasks SET status='done', updated_at=? WHERE id=? AND status='review' AND revisions=?", this.now(), t.id, t.revisions);
      if (r.changes) this.emitTask(t.id);
    }
  }

  // ---- staff ----
  async runStaff(floorId, agentId, taskId, ctl) {
    const floor = get(this.db, 'SELECT * FROM floors WHERE id=?', floorId);
    const agent = get(this.db, 'SELECT * FROM agents WHERE id=?', agentId);
    let task = get(this.db, 'SELECT * FROM tasks WHERE id=?', taskId);
    const signal = ctl.signal;
    const roleCfg = this.models.all[agent.role];
    const names = toolsForRole(agent.role);
    const defs = toolDefs(names, this.cfg, agent.role);
    const ctx = this.toolCtx(floor, agent, task, names);
    ctx.signal = signal;
    let messages = task.transcript ? JSON.parse(task.transcript) : null;
    if (!messages) {
      messages = [
        { role: 'system', content: staffPrompt(floor, agent, roleCfg, task, this.cfg) },
        { role: 'user', content: `Task #${task.id}: ${task.title}\n${task.project ? `Project slug: ${task.project}\n` : ''}\nBrief from the Office Manager:\n${task.brief}` },
      ];
    }
    // A task that started on a computer has no system prompt of its own here. It never runs without the safety rules.
    if (messages[0]?.role !== 'system') messages.unshift({ role: 'system', content: staffPrompt(floor, agent, roleCfg, task, this.cfg) });
    this.setAgent(agent.id, { state: 'thinking', activity: task.title, project: task.project, task_id: task.id });
    this.feed(floorId, agent, `started "${task.title}"`, task.project);
    const call = { floorId, agent, signal, project: task.project, taskId: task.id };
    const allBoss = all(this.db, "SELECT text FROM messages WHERE floor_id=? AND role='boss' ORDER BY id DESC LIMIT 12", floorId).map((m) => m.text).join(' ');
    const answers = () => all(this.db, 'SELECT answer FROM questions WHERE task_id=? AND answer IS NOT NULL', task.id).map((q) => q.answer);
    try {
      // Step index for scripted mocks counts assistant turns already in the saved transcript.
      let step = messages.filter((m) => m.role === 'assistant').length;
      for (let n = 0; ; n++) {
        if (n >= MAX_STAFF_STEPS) { this.finishTask(floor, agent, task.id, 'failed', 'Ran out of steps before finishing.'); return; }
        this.checkpoint(floorId, signal);
        task = get(this.db, 'SELECT * FROM tasks WHERE id=?', taskId);
        if (task.cost_usd >= this.cfg.taskMaxUsd) { this.finishTask(floor, agent, task.id, 'failed', 'Stopped: this task reached its limit.'); return; }
        this.setAgent(agent.id, { state: 'thinking', activity: task.title, project: task.project, task_id: task.id });
        const res = await this.callLLM(call, { messages: compact(messages), tools: defs, meta: { kind: 'staff', role: agent.role, floorId, floorSlug: floor.slug, step, task, allBoss, answers: answers() } });
        step++;
        const assistant = { role: 'assistant', content: res.content || null };
        if (res.toolCalls.length) assistant.tool_calls = res.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } }));
        if (res.rawContent) assistant.anthropic_content = res.rawContent;
        messages.push(assistant);
        if (!res.toolCalls.length) {
          this.saveTranscript(task.id, messages);
          this.finishTask(floor, agent, task.id, 'review', res.content.trim().slice(0, 2000) || 'Finished.');
          return;
        }
        for (const c of res.toolCalls) {
          this.checkpoint(floorId, signal);
          const out = await this.tools.exec(ctx, c.name, c.args);
          messages.push({ role: 'tool', tool_call_id: c.id, content: out });
        }
        this.saveTranscript(task.id, messages);
        if (ctx.suspend) {
          run(this.db, "UPDATE tasks SET status='blocked', updated_at=? WHERE id=?", this.now(), task.id);
          this.emitTask(task.id);
          return;
        }
      }
    } catch (e) {
      this.handleRunError(floorId, agent, task, e, () => {
        run(this.db, "UPDATE tasks SET status='todo', updated_at=? WHERE id=? AND status='doing'", this.now(), task.id);
        this.emitTask(task.id);
      });
    }
  }
  saveTranscript(taskId, messages) { run(this.db, 'UPDATE tasks SET transcript=? WHERE id=?', JSON.stringify(compact(messages)), taskId); }
  finishTask(floor, agent, taskId, status, result) {
    const t = get(this.db, 'SELECT * FROM tasks WHERE id=?', taskId);
    if (t.status === 'cancelled') return;
    run(this.db, 'UPDATE tasks SET status=?, result=?, updated_at=? WHERE id=?', status, result, this.now(), taskId);
    this.emitTask(taskId);
    this.feed(floor.id, agent, status === 'failed' ? `could not finish "${t.title}"` : `finished "${t.title}"`, t.project);
    const mgr = get(this.db, "SELECT id FROM agents WHERE floor_id=? AND role='manager'", floor.id);
    this.emit(floor.id, 'handoff', { from: agent.id, to: mgr.id, kind: 'paper' }, { persist: true });
    const open = get(this.db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status IN ('todo','doing')", floor.id).n;
    // Only wake the (more expensive) manager when the batch is finished. Failures always wake it.
    if (status === 'failed' || open === 0) run(this.db, 'UPDATE floors SET manager_wake=1 WHERE id=?', floor.id);
    this.kick();
  }

  /** Common exit for a run that did not finish normally. The floor never loops: provider failure means a visible pause. */
  handleRunError(floorId, agent, task, e, requeue) {
    if (e instanceof Halt) {
      if (e.why === 'stop') return;       // the stop call already cancelled everything
      if (e.why === 'budget') {
        requeue();
        const floor = get(this.db, 'SELECT * FROM floors WHERE id=?', floorId);
        if (floor) this.budgetNotice(floor, today(this.now()));
        return;
      }
      requeue();                          // the building's limit, pause, shutdown or suspend: retry once it is allowed again. For a limit, the next tick tells the boss.
      return;
    }
    if (e instanceof ProviderError) {
      requeue();
      if (get(this.db, 'SELECT paused FROM floors WHERE id=?', floorId)?.paused) return;  // a sibling run already reported it
      // What the provider said stays in the log: it can carry account details such as how much credit is left.
      this.log('warn', 'provider failed', { floorId, status: e.status, err: scrub(e.message, this.cfg) });
      this.pauseFloor(floorId, `The model provider is having trouble${e.status ? ` (${e.status})` : ''}.`);
      this.officeNotice(floorId, 'Boss, the model provider is failing, so I\'ve paused the floor rather than burn money retrying. Nothing is lost. Press **Resume** when you want us to try again.');
      return;
    }
    requeue();
    this.fail('agent', e);
    this.pauseFloor(floorId, 'Something went wrong inside the office. The floor is paused.');
  }
  checkpoint(floorId, signal) {
    if (signal?.aborted) throw signal.reason instanceof Halt ? signal.reason : new Halt('pause');
    if (this.stopped) throw new Halt('shutdown');
    const f = get(this.db, 'SELECT status,paused FROM floors WHERE id=?', floorId);
    if (!f || f.status !== 'active') throw new Halt('stop');
    if (f.paused || this.globalPaused()) throw new Halt('pause');
  }
  toolCtx(floor, agent, task, allowed) {
    const self = this;
    return {
      floor, agent, task, allowed, assigned: [], suspend: false, project: task?.project || '',
      say(state, activity, feedText, opt = {}) {
        const project = opt.project ?? this.project ?? '';
        self.setAgent(agent.id, { state, activity, project });
        if (feedText) self.feed(floor.id, agent, feedText, project);
      },
    };
  }

  /** The address a project is really at: its own domain, its own origin, or the sandbox link. */
  liveUrl(floor, slug) {
    const domain = this.domains.liveFor(floor.id, slug);
    if (domain) return `https://${domain}/`;
    if (this.cfg.appsBaseDomain) return `${appOrigin(this.cfg, appLabel(this.db, floor, slug))}/`;
    return publicUrl(floor.slug, slug);
  }

  // ---- called by tools ----
  upsertProject(floor, slug, { title, description, kind, sources, published, makePrivate }) {
    const had = get(this.db, 'SELECT slug FROM projects WHERE floor_id=? AND slug=?', floor.id, slug);
    if (!had) run(this.db, 'INSERT INTO projects (floor_id,slug,title,created_at,private) VALUES (?,?,?,?,?)', floor.id, slug, title || slug, this.now(), floor.default_private || makePrivate ? 1 : 0);
    if (makePrivate) run(this.db, 'UPDATE projects SET private=1 WHERE floor_id=? AND slug=?', floor.id, slug);
    if (published) run(this.db, 'UPDATE projects SET title=?,description=?,kind=?,sources=?,published_at=? WHERE floor_id=? AND slug=?', title || slug, description || '', kind, JSON.stringify(sources || []), this.now(), floor.id, slug);
  }
  assignTask(floor, mgr, { to, title, brief, plan, project: wanted, private: priv, dependsOn, afterPrevious, lane = '' }) {
    const q = to.toLowerCase();
    const staff = all(this.db, "SELECT * FROM agents WHERE floor_id=? AND role!='manager'", floor.id);
    const target = staff.find((s) => s.role === q || s.name.toLowerCase() === q || s.title.toLowerCase() === q);
    if (!target) throw new ToolError(`nobody called ${to.slice(0, 40)} works here. Staff: ${staff.map((s) => s.role).join(', ')}`);
    const open = get(this.db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status IN ('todo','doing','blocked')", floor.id).n;
    if (open >= MAX_OPEN_TASKS) throw new ToolError('too many open tasks; let some finish first');
    if (get(this.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND created_at>=?', floor.id, this.now() - 86400000).n >= MAX_TASKS_PER_DAY) throw new ToolError('this floor has hit its task limit for today');
    const project = wanted || (priv || floor.default_private ? 'private-work' : '');
    if (project) this.upsertProject(floor, project, { title: project, makePrivate: priv });
    const deps = dependsOn.map(Number).filter((n) => Number.isInteger(n)).slice(0, 10);
    if (afterPrevious) {
      const prev = get(this.db, "SELECT id FROM tasks WHERE floor_id=? AND status IN ('todo','doing','blocked') ORDER BY id DESC LIMIT 1", floor.id);
      if (prev) deps.push(prev.id);
    }
    const t = this.now();
    const r = run(this.db, 'INSERT INTO tasks (floor_id,plan,title,brief,agent_id,project,depends_on,created_at,updated_at,lane) VALUES (?,?,?,?,?,?,?,?,?,?)', floor.id, plan, title, brief, target.id, project, JSON.stringify(deps), t, t, lane);
    const id = Number(r.lastInsertRowid);
    this.emitTask(id);
    this.feed(floor.id, mgr, `gave ${target.name} a task: "${title}"`, project);
    return { id, assignee: target.name, agentId: target.id };
  }
  reviewTask(floor, mgr, taskId, verdict, notes) {
    const t = get(this.db, 'SELECT * FROM tasks WHERE id=? AND floor_id=?', taskId, floor.id);
    if (!t) throw new ToolError('no such task on this floor');
    if (t.status !== 'review') throw new ToolError(`task #${taskId} is ${t.status}, not waiting for review`);
    const staff = get(this.db, 'SELECT * FROM agents WHERE id=?', t.agent_id);
    // A task holding the Expo vault ran on the boss's click. Going round again would take another click.
    if (verdict === 'revise' && t.revisions < 2 && !t.vault) {
      const msgs = t.transcript ? JSON.parse(t.transcript) : null;
      if (msgs) msgs.push({ role: 'user', content: `The Office Manager sent this back with notes:\n${notes || 'Please improve it.'}` });
      run(this.db, "UPDATE tasks SET status='todo', revisions=revisions+1, transcript=?, updated_at=? WHERE id=?", msgs ? JSON.stringify(msgs) : '', this.now(), t.id);
      this.feed(floor.id, mgr, `sent "${t.title}" back to ${staff?.name} with notes`, t.project);
      this.emitTask(t.id); this.kick();
      return `Sent #${t.id} back.`;
    }
    run(this.db, "UPDATE tasks SET status='done', updated_at=? WHERE id=?", this.now(), t.id);
    this.feed(floor.id, mgr, `approved "${t.title}"`, t.project);
    this.emitTask(t.id);
    return `Approved #${t.id}.`;
  }
  cancelTask(floor, taskId) {
    const t = get(this.db, 'SELECT * FROM tasks WHERE id=? AND floor_id=?', taskId, floor.id);
    if (!t) throw new ToolError('no such task on this floor');
    if (['done', 'failed', 'cancelled'].includes(t.status)) return `Task #${taskId} was already ${t.status}.`;
    run(this.db, "UPDATE tasks SET status='cancelled', updated_at=? WHERE id=?", this.now(), t.id);
    const r = this.runs.get(t.agent_id);
    if (r && t.status === 'doing') r.ctl.abort(new Halt('stop'));
    else if (t.session_id) this.computer?.settleOrphan(t);
    this.emitTask(t.id);
    return `Cancelled #${t.id}.`;
  }
  hireStaff(floor, role, name) {
    const cfg = this.models.hireable[role] || this.models.roles[role];
    if (!cfg || role === 'manager') throw new ToolError(`can't hire "${role.slice(0, 30)}". Hireable: ${Object.keys(this.models.hireable).join(', ')}`);
    if (get(this.db, 'SELECT 1 x FROM agents WHERE floor_id=? AND role=?', floor.id, role)) return `You already have a ${cfg.title}.`;
    const n = get(this.db, "SELECT COUNT(*) n FROM agents WHERE floor_id=? AND role!='manager'", floor.id).n;
    if (n >= this.cfg.maxStaff) throw new ToolError(`this floor is at its staff limit of ${this.cfg.maxStaff}`);
    // Nobody shares a name with someone already on the floor, the manager included.
    const taken = new Set(all(this.db, 'SELECT name FROM agents WHERE floor_id=?', floor.id).map((a) => a.name.toLowerCase()));
    const start = (floor.id * 3 + n) % STAFF_NAMES.length;
    const free = STAFF_NAMES.map((_, i) => STAFF_NAMES[(start + i) % STAFF_NAMES.length]).find((x) => !taken.has(x.toLowerCase()));
    const wanted = cleanName(name);
    const nm = wanted && !taken.has(wanted.toLowerCase()) ? wanted : free || wanted || STAFF_NAMES[start];
    const r = run(this.db, 'INSERT INTO agents (floor_id,role,title,name,look,hired,created_at) VALUES (?,?,?,?,?,1,?)', floor.id, role, cfg.title, nm, JSON.stringify(seededLook(floor.id * 17 + n * 5 + 3)), this.now());
    const a = get(this.db, 'SELECT * FROM agents WHERE id=?', Number(r.lastInsertRowid));
    this.emit(floor.id, 'hired', { agent: agentView(a) });
    this.feed(floor.id, null, `${nm} joined as ${cfg.title}`, '');
    return `Hired ${nm} as ${cfg.title}. Use "${role}" as the assign_task target.`;
  }
  fileQuestion(floor, agent, task, text) {
    const r = run(this.db, 'INSERT INTO questions (floor_id,agent_id,task_id,text,created_at) VALUES (?,?,?,?,?)', floor.id, agent.id, task?.id ?? null, text, this.now());
    this.emit(floor.id, 'question', { id: Number(r.lastInsertRowid), agent: agent.id, agentName: agent.name, text }, { ownerOnly: true });
    this.feed(floor.id, agent, 'asked the boss a question', task?.project || '');
  }
  answerQuestion(floor, id, text) {
    const q = get(this.db, 'SELECT * FROM questions WHERE id=? AND floor_id=? AND answer IS NULL', id, floor.id);
    if (!q) return false;
    run(this.db, 'UPDATE questions SET answer=?, answered_at=? WHERE id=?', text, this.now(), id);
    if (q.task_id) {
      const t = get(this.db, 'SELECT * FROM tasks WHERE id=?', q.task_id);
      // A computer task may still be finishing its turn. The answer waits in line and goes in as its next message.
      if (t?.session_id && (t.status === 'doing' || t.status === 'todo')) {
        const msgs = t.transcript ? JSON.parse(t.transcript) : [];
        msgs.push({ role: 'user', content: `The boss answered your question ("${q.text.slice(0, 200)}"):\n${text}` });
        run(this.db, 'UPDATE tasks SET transcript=?, updated_at=? WHERE id=?', JSON.stringify(msgs), this.now(), t.id);
      } else if (t?.status === 'blocked') {
        const msgs = t.transcript ? JSON.parse(t.transcript) : [];
        msgs.push({ role: 'user', content: `The boss answered your question ("${q.text.slice(0, 200)}"):\n${text}` });
        run(this.db, "UPDATE tasks SET status='todo', transcript=?, updated_at=? WHERE id=?", JSON.stringify(msgs), this.now(), t.id);
        this.emitTask(t.id);
      }
    } else {
      this.addMessage(floor.id, 'note', null, `The boss answered your question ("${q.text.slice(0, 200)}"): ${text}`);
      run(this.db, 'UPDATE floors SET manager_wake=1 WHERE id=?', floor.id);
    }
    this.emit(floor.id, 'question_answered', { id }, { ownerOnly: true });
    this.kick();
    return true;
  }
  filePurchase(floor, agent, { item, price, why, link }) {
    const r = run(this.db, 'INSERT INTO purchases (floor_id,agent_id,item,price,why,link,created_at) VALUES (?,?,?,?,?,?,?)', floor.id, agent.id, item, price, why, link, this.now());
    this.emit(floor.id, 'purchase', get(this.db, 'SELECT * FROM purchases WHERE id=?', Number(r.lastInsertRowid)), { ownerOnly: true });
  }

  // ---- boss controls ----
  bossMessage(floor, text) {
    this.addMessage(floor.id, 'boss', null, text);
    run(this.db, 'UPDATE floors SET manager_wake=1 WHERE id=?', floor.id);
    const state = this.floorState(floor.id);
    if (state.budgetStopped) this.bossNotice(floor.id, 'Noted, boss. Today\'s budget is used up, so I\'ll pick this up first thing tomorrow.');
    else if (state.outOfBudget && this.budget.out(this.agentProvider({ role: 'manager' }))) this.bossNotice(floor.id, 'Noted, boss. The building is still out of budget, so I\'ll pick this up once the owner has sorted that out.');
    this.kick();
  }
  pauseFloor(floorId, reason = 'Paused by the boss') {
    run(this.db, 'UPDATE floors SET paused=1, pause_reason=? WHERE id=?', reason, floorId);
    this.haltFloorRuns(floorId, 'pause');
    this.feed(floorId, null, `Floor paused. ${reason}`, '');
    this.emitFloor(floorId);
  }
  resumeFloor(floorId) {
    run(this.db, "UPDATE floors SET paused=0, pause_reason='' WHERE id=?", floorId);
    this.feed(floorId, null, 'Floor back at work.', '');
    this.emitFloor(floorId);
    this.kick();
  }
  cancelOpen(floorId) {
    const open = all(this.db, "SELECT id,status,session_id,session_charged,agent_id,floor_id FROM tasks WHERE floor_id=? AND status IN ('todo','doing','blocked','review')", floorId);
    const ids = open.map((t) => t.id);
    for (const t of open) if (t.session_id && t.status !== 'doing') this.computer?.settleOrphan(t);
    run(this.db, "UPDATE tasks SET status='cancelled', updated_at=? WHERE floor_id=? AND status IN ('todo','doing','blocked','review')", this.now(), floorId);
    run(this.db, 'UPDATE floors SET manager_wake=0 WHERE id=?', floorId);
    this.haltFloorRuns(floorId, 'stop');
    for (const id of ids) this.emitTask(id);
    for (const q of all(this.db, 'SELECT id FROM questions WHERE floor_id=? AND answer IS NULL', floorId)) {
      run(this.db, "UPDATE questions SET answer='(work was stopped)', answered_at=? WHERE id=?", this.now(), q.id);
      this.emit(floorId, 'question_answered', { id: q.id }, { ownerOnly: true });
    }
    this.help?.stopAsking(floorId);
  }
  stopFloor(floorId) {
    this.cancelOpen(floorId);
    this.officeNotice(floorId, 'Everyone has stopped, boss. All open tasks are cancelled and finished files are still on the drive.');
  }
  redirectFloor(floor, text) {
    this.cancelOpen(floor.id);
    this.addMessage(floor.id, 'note', null, 'The boss has redirected the team: all earlier open tasks were cancelled. Follow the next instruction.');
    this.addMessage(floor.id, 'boss', null, text);
    run(this.db, 'UPDATE floors SET manager_wake=1 WHERE id=?', floor.id);
    this.kick();
  }

  // ---- events ----
  addMessage(floorId, role, agentId, text) {
    const r = run(this.db, 'INSERT INTO messages (floor_id,role,agent_id,text,created_at) VALUES (?,?,?,?,?)', floorId, role, agentId, text, this.now());
    if (role !== 'note') this.emit(floorId, 'message', { id: Number(r.lastInsertRowid), role, agentId, text, createdAt: this.now() }, { chat: true, ownerOnly: role === 'budget' });
  }
  managerSays(floorId, text) {
    const mgr = get(this.db, "SELECT id FROM agents WHERE floor_id=? AND role='manager'", floorId);
    this.addMessage(floorId, 'manager', mgr?.id ?? null, text);
  }
  /** The launch report: for the boss alone. It holds sign-up counts and checklist findings, so even a public-chat floor doesn't show it. */
  reportToBoss(floorId, text) {
    const mgr = get(this.db, "SELECT id FROM agents WHERE floor_id=? AND role='manager'", floorId);
    const r = run(this.db, 'INSERT INTO messages (floor_id,role,agent_id,text,created_at) VALUES (?,?,?,?,?)', floorId, 'report', mgr?.id ?? null, text, this.now());
    this.emit(floorId, 'message', { id: Number(r.lastInsertRowid), role: 'report', agentId: mgr?.id ?? null, text, createdAt: this.now() }, { chat: true, ownerOnly: true });
  }
  officeNotice(floorId, text) {
    const mgr = get(this.db, "SELECT id FROM agents WHERE floor_id=? AND role='manager'", floorId);
    this.addMessage(floorId, 'office', mgr?.id ?? null, text);
  }
  /** Anything about the budget: the boss's alone, even on a floor with public chat, and it never reaches the model. */
  bossNotice(floorId, text) {
    const mgr = get(this.db, "SELECT id FROM agents WHERE floor_id=? AND role='manager'", floorId);
    this.addMessage(floorId, 'budget', mgr?.id ?? null, text);
  }
  feed(floorId, agent, text, project) { this.emit(floorId, 'feed', { agent: agent?.id ?? null, name: agent?.name ?? 'Office', text, ts: this.now() }, { project }); }
  emit(floorId, type, data, { persist = true, project = '', chat = false, ownerOnly = false } = {}) {
    const ev = { floorId, type, data, project, chat, ownerOnly, id: 0, ts: this.now() };
    if (persist) {
      const r = run(this.db, 'INSERT INTO events (floor_id,type,project,data,created_at) VALUES (?,?,?,?,?)', floorId, type, project || '', JSON.stringify(data), ev.ts);
      ev.id = Number(r.lastInsertRowid);
      if (++this.eventCount % 200 === 0) this.trimEvents();
    }
    this.bus.publish(floorId, ev);
  }
  trimEvents() {
    for (const f of all(this.db, 'SELECT floor_id, COUNT(*) n FROM events GROUP BY floor_id HAVING n > ?', EVENT_KEEP)) {
      run(this.db, 'DELETE FROM events WHERE floor_id=? AND id <= (SELECT id FROM events WHERE floor_id=? ORDER BY id DESC LIMIT 1 OFFSET ?)', f.floor_id, f.floor_id, EVENT_KEEP);
    }
  }
  setAgent(agentId, patch) {
    const a = get(this.db, 'SELECT * FROM agents WHERE id=?', agentId);
    if (!a) return;
    const next = { ...a, ...patch };
    if (next.state === a.state && next.activity === a.activity && next.project === a.project && next.task_id === a.task_id) return;
    run(this.db, 'UPDATE agents SET state=?, activity=?, project=?, task_id=? WHERE id=?', next.state, next.activity, next.project, next.task_id ?? null, agentId);
    this.emit(a.floor_id, 'agent', { id: agentId, state: next.state, activity: next.activity, taskId: next.task_id ?? null }, { persist: false, project: next.project });
  }
  emitTask(id) {
    const t = get(this.db, 'SELECT * FROM tasks WHERE id=?', id);
    if (t) this.emit(t.floor_id, 'task', taskView(t), { persist: false, project: t.project });
  }
  emitProject(floorId, slug) { this.emit(floorId, 'project', { slug }, { project: slug }); }
  emitFloor(floorId) { this.emit(floorId, 'floor', this.floorState(floorId), { persist: false }); }
  floorState(floorId) {
    const f = get(this.db, 'SELECT paused,pause_reason,status,budget_notice_day,budget_out FROM floors WHERE id=?', floorId);
    if (!f) return { status: 'gone', paused: false, pauseReason: '', globalPause: false, budgetStopped: false, outOfBudget: false };
    return { status: f.status, paused: !!f.paused, pauseReason: f.pause_reason, globalPause: this.globalPaused(), budgetStopped: f.budget_notice_day === today(this.now()) || this.spentOver(floorId, 0), outOfBudget: !!f.budget_out };
  }

  // ---- creating and destroying floors ----
  seedStaff(floorId) {
    const t = this.now();
    const add = (role, title, name, look) => run(this.db, 'INSERT INTO agents (floor_id,role,title,name,look,created_at) VALUES (?,?,?,?,?,?)', floorId, role, title, name, JSON.stringify(look), t);
    let i = floorId * 7;
    for (const [role, cfg] of Object.entries(this.models.roles)) { add(role, cfg.title, STAFF_NAMES[i % STAFF_NAMES.length], seededLook(i * 13 + 2)); i++; }
  }
  resetFloor(floorId) {
    this.cancelOpen(floorId);
    this.domains.dropRequests(floorId);
    deleteFloorData(this.db, floorId);
    tx(this.db, () => {
      for (const table of ['tasks', 'messages', 'events', 'files', 'projects', 'published_files', 'purchases', 'questions', 'ios_requests', 'help_requests']) run(this.db, `DELETE FROM ${table} WHERE floor_id=?`, floorId);
      run(this.db, "DELETE FROM agents WHERE floor_id=? AND hired=1", floorId);
      run(this.db, "UPDATE floors SET manager_wake=0, paused=0, pause_reason='', budget_notice_day='', budget_out='' WHERE id=?", floorId);
    });
    this.emit(floorId, 'reload', {});
  }
  killFloor(floorId) {
    this.cancelOpen(floorId);
    this.domains.dropRequests(floorId);
    this.emit(floorId, 'reload', {}, { persist: false });
    deleteFloorData(this.db, floorId);
    tx(this.db, () => {
      for (const table of ['tasks', 'messages', 'events', 'files', 'projects', 'published_files', 'purchases', 'questions', 'agents', 'sessions', 'ios_requests', 'help_requests']) run(this.db, `DELETE FROM ${table} WHERE floor_id=?`, floorId);
      run(this.db, 'DELETE FROM floors WHERE id=?', floorId);
    });
    this.bus.closeFloor(floorId);
  }
  setSuspended(floorId, on) {
    run(this.db, 'UPDATE floors SET status=? WHERE id=?', on ? 'suspended' : 'active', floorId);
    if (on) this.haltFloorRuns(floorId, 'pause');
    this.emitFloor(floorId);
    this.kick();
  }
  publicView(ev, viewer) { return viewEvent(this.db, ev, viewer); }
}

class ToolError extends WorkspaceError {}
const ACT_WORDS = /\b(go|build|make|do it|start|create|launch|ship|act|please|a|an|the|me|us|site|website|page|about|for|and|now)\b/gi;
const cleanName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 24);

// Tool calls echo whole file bodies. Old ones are shrunk so a long task doesn't pay for them again on every step.
export function compact(messages) {
  const lastAssistant = messages.findLastIndex((m) => m.role === 'assistant');
  return messages.map((m, i) => {
    if (m.role !== 'assistant' || !m.tool_calls || i === lastAssistant) return m;
    return { ...m, tool_calls: m.tool_calls.map((c) => {
      if (c.function.name !== 'write_file' || c.function.arguments.length < 400) return c;
      let args; try { args = JSON.parse(c.function.arguments); } catch { return c; }
      return { ...c, function: { ...c.function, arguments: JSON.stringify({ path: args.path, content: `[${String(args.content).length} characters, saved to the workspace; use read_file to see it]` }) } };
    }) };
  });
}

export const agentView = (a) => ({ id: a.id, role: a.role, title: a.title, name: a.name, look: JSON.parse(a.look), state: a.state, activity: a.activity, taskId: a.task_id, hired: !!a.hired });
export const taskView = (t) => ({ id: t.id, plan: t.plan, title: t.title, brief: t.brief, agentId: t.agent_id, project: t.project, status: t.status, result: t.result, updatedAt: t.updated_at, dependsOn: JSON.parse(t.depends_on || '[]') });

/** What a viewer may see of an event. Visitors get no chat (unless the floor opts in), no owner-only events and nothing from private projects. */
export function viewEvent(db, ev, viewer) {
  if (viewer.owner) return ev;
  if (ev.ownerOnly) return null;
  if (ev.type === 'question' || ev.type === 'question_answered' || ev.type === 'purchase') return null;
  // A replayed event has lost its ownerOnly flag, so these are judged by what they are: a report, an answer from the help line or a word about the budget is the boss's alone, even with public chat on.
  if (ev.type === 'message' && ['report', 'help', 'budget'].includes(ev.data?.role)) return null;
  if (ev.type === 'floor') { const { budgetStopped: _s, outOfBudget: _o, ...pub } = ev.data; return { ...ev, data: pub }; }
  if (ev.type === 'help_state' && viewer.defaultPrivate) return null;
  // Visitors on a public-chat floor get whole messages only. A private name split across two tokens could not be redacted.
  if (ev.type === 'token' || ev.type === 'token_reset') return null;
  if (ev.chat || ev.type === 'message') return viewer.publicChat ? { ...ev, data: { ...ev.data, text: redactChat(db, ev.floorId, ev.data.text) } } : null;
  // On a default-private floor, anything not tied to a public project counts as private. Office notices carry no agent.
  const isPrivate = ev.project
    ? get(db, 'SELECT private FROM projects WHERE floor_id=? AND slug=?', ev.floorId, ev.project)?.private
    : viewer.defaultPrivate && (ev.type === 'task' || ev.type === 'agent' || (ev.type === 'feed' && ev.data.agent !== null));
  if (ev.type === 'task') {
    const { brief: _b, result: _r, ...pub } = ev.data;
    return { ...ev, project: isPrivate ? '' : ev.project, data: isPrivate ? { ...pub, title: 'Private task', plan: '', project: '' } : pub };
  }
  if (!isPrivate) return ev;
  if (ev.type === 'feed') return { ...ev, project: '', data: { ...ev.data, text: PRIVATE_TEXT.toLowerCase() } };
  if (ev.type === 'agent') return { ...ev, project: '', data: { ...ev.data, activity: PRIVATE_TEXT, taskId: null } };
  if (ev.type === 'project') return null;
  return { ...ev, project: '' };
}

/** Takes private project names and task titles out of chat that visitors can read. It can't catch a paraphrase, and the setting says so. */
export function redactChat(db, floorId, text) {
  const terms = new Set();
  const priv = all(db, 'SELECT slug,title FROM projects WHERE floor_id=? AND private=1', floorId);
  for (const p of priv) { terms.add(p.slug); terms.add(p.title); }
  if (priv.length) for (const t of all(db, 'SELECT title,project FROM tasks WHERE floor_id=? ORDER BY id DESC LIMIT 200', floorId)) if (priv.some((p) => p.slug === t.project)) terms.add(t.title);
  const list = [...terms].filter((x) => x && x.length >= 3).sort((a, b) => b.length - a.length);
  if (!list.length) return text;
  const re = new RegExp(list.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
  return String(text).replace(re, 'private');
}
export { PRIVATE_TEXT };
