// AI_MODE=mock stand-in for Claude Managed Agents: same surface as sessions.js, no container, no key and no spend.
// A turn is a small script, so tests can play any session, including a hostile one. The default script is an honest little build.
import { packTgz, unpackTgz } from './tarball.js';

class EndTurn extends Error {}

const GAME_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mock game</title><script src="_office/client.js"></script></head>
<body><h1>Mock game</h1><canvas id="c" width="320" height="200"></canvas><p>High score: <output id="o">0</output></p><script type="module" src="app.js"></script></body></html>`;
const GAME_JS = `const o = document.getElementById('o'); Office.load('high', 0).then((h) => { o.textContent = h; });`;

export async function defaultTurn(api, text) {
  const slug = text.match(/Project slug: ([a-z0-9-]+)/)?.[1];
  if (!slug) { await api.step(); await api.message('Done.'); return; }
  await api.step(); await api.tool('bash', { command: 'mkdir -p /workspace && tar xzf /mnt/session/uploads/office/bundle.tgz -C /workspace' });
  await api.step(); await api.tool('bash', { command: 'cd /workspace/project && npm install vite' });
  await api.step(); await api.tool('write', { file_path: '/workspace/project/src/main.js', content: GAME_JS });
  await api.step(); await api.tool('bash', { command: 'cd /workspace/project && npm run build' });
  await api.step(); await api.tool('bash', { command: 'node /workspace/project/check-with-playwright.cjs' });
  await api.step();
  if (api.role !== 'tester') await api.custom('publish_project', { project: slug, title: slug, description: 'Built on a computer.', kind: 'game', directory: 'dist' });
  await api.step(); await api.tool('bash', { command: 'bash /workspace/.office/save.sh' });
  await api.save([
    ...api.bundleFiles.filter((f) => f.path.startsWith('project/')).map((f) => ({ path: f.path.slice('project/'.length), data: f.data })),
    { path: 'package.json', data: Buffer.from('{"name":"mock"}') }, { path: 'src/main.js', data: Buffer.from(GAME_JS) },
    { path: 'dist/index.html', data: Buffer.from(GAME_HTML) }, { path: 'dist/app.js', data: Buffer.from(GAME_JS) },
    { path: 'dist/logo.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 254, 253]) },
  ]);
  await api.message(`Built it, ran the build and checked it in a browser. Tests pass.`);
}

export function createMockSessions(cfg, { onTurn = defaultTurn, usage = { input_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 500, output_tokens: 300 }, stepUsd = 0.02 } = {}) {
  const sessions = new Map(); const files = new Map(); const agentRoles = new Map();
  const calls = { environments: [], agents: [], agentUpdates: [], uploads: [], deleted: [], sessions: [], sends: [], updates: [], streams: 0 };
  let n = 0;
  const id = (p) => `${p}_mock_${++n}`;
  const emit = (s, ev) => {
    const full = { id: id('sevt'), processed_at: new Date().toISOString(), ...ev };
    s.events.push(full);
    for (const q of s.subs) q.push(full);
    return full;
  };
  const idle = (s, type) => { s.status = 'idle'; emit(s, { type: 'session.status_idle', stop_reason: { type } }); };
  const stepCost = (s) => { s.spentUsd += stepUsd; };
  const apiFor = (s) => ({
    get session() { return s; }, role: s.role, bundleFiles: s.bundle,
    async step(u = usage) {
      if (s.interrupted) throw new EndTurn('interrupted');
      // As the real platform does: pause at the cap, and wake by itself when the cap is raised.
      while (s.budgetCents !== null && s.spentUsd * 100 >= s.budgetCents) {
        emit(s, { type: 'session.usage' });
        s.pausedAtBudget = true;
        idle(s, 'budget_reached');
        await new Promise((res) => { s.resumeAfterBudget = res; });
        s.status = 'running'; emit(s, { type: 'session.status_running' });
        if (s.interrupted) throw new EndTurn('interrupted');
      }
      emit(s, { type: 'span.model_request_start' });
      await new Promise((r) => setImmediate(r));
      stepCost(s);
      emit(s, { type: 'span.model_request_end', is_error: false, model_usage: u });
      if (s.interrupted) throw new EndTurn('interrupted');
    },
    tool(name, input) { return emit(s, { type: 'agent.tool_use', name, input, evaluated_permission: 'allow', evaluation: { type: 'auto' } }); },
    async ask(name, input) {
      const ev = emit(s, { type: 'agent.tool_use', name, input, evaluated_permission: 'ask' });
      idle(s, 'requires_action');
      const r = await new Promise((res) => { s.waiters.set(ev.id, res); });
      s.status = 'running'; emit(s, { type: 'session.status_running' });
      return r;
    },
    async custom(name, input) {
      const ev = emit(s, { type: 'agent.custom_tool_use', name, input });
      idle(s, 'requires_action');
      const r = await new Promise((res) => { s.waiters.set(ev.id, res); });
      s.status = 'running'; emit(s, { type: 'session.status_running' });
      return r;
    },
    message(text) { emit(s, { type: 'agent.message', content: [{ type: 'text', text }] }); },
    save(entries) { s.outputs = [{ id: id('file'), filename: 'project.tgz', size: 0, createdAt: new Date().toISOString(), data: packTgz(entries) }]; s.outputs[0].size = s.outputs[0].data.length; },
    saveRaw(buffer, size) { s.outputs = [{ id: id('file'), filename: 'project.tgz', size: size ?? buffer.length, createdAt: new Date().toISOString(), data: buffer }]; },
    terminate() { s.status = 'terminated'; emit(s, { type: 'session.status_terminated' }); throw new EndTurn('terminated'); },
    fail() { throw new EndTurn('retries'); },
    refuse() { throw new EndTurn('refusal'); },
    error(type = 'model_overloaded_error') { emit(s, { type: 'session.error', error: { type, message: 'mock' } }); },
    dropStreams() { for (const q of [...s.subs]) q.end(); },
  });
  async function runTurn(s, text) {
    s.status = 'running'; s.interrupted = false;
    emit(s, { type: 'session.status_running' });
    try {
      await onTurn(apiFor(s), text, calls);
      if (s.status !== 'terminated') idle(s, 'end_turn');
    } catch (e) {
      if (!(e instanceof EndTurn)) throw e;
      if (e.message === 'terminated') return;
      if (e.message === 'interrupted') idle(s, 'end_turn');
      else idle(s, e.message === 'retries' ? 'retries_exhausted' : e.message);
    }
    if (s.queue.length && s.status === 'idle') { const next = s.queue.shift(); runTurn(s, next); }
  }
  return {
    calls, sessions,
    async createEnvironment(def) { calls.environments.push(def); return { id: id('env') }; },
    async createAgent(def) { const aid = id('agent'); agentRoles.set(aid, def.name.replace('theoffice-', '')); calls.agents.push(def); return { id: aid, version: 1 }; },
    async updateAgent(aid, def) { calls.agentUpdates.push({ id: aid, def }); return { id: aid, version: calls.agentUpdates.length + 1 }; },
    async upload(buffer, name) { const fid = id('file'); files.set(fid, buffer); calls.uploads.push({ id: fid, name, buffer }); return fid; },
    async deleteFile(fid) { files.delete(fid); calls.deleted.push(fid); },
    async createSession(params) {
      const sid = id('sesn');
      const file = params.resources?.[0]?.file_id;
      const s = { id: sid, params, status: 'idle', events: [], subs: new Set(), waiters: new Map(), queue: [], outputs: [], spentUsd: 0, interrupted: false, bundle: file ? unpackTgz(files.get(file)).files : [], budgetCents: params.budget ? Number(params.budget.max_list_cost.amount) : null, role: agentRoles.get(params.agent?.id) || '' };
      sessions.set(sid, s); calls.sessions.push(params);
      return { id: sid, status: 'idle' };
    },
    async retrieve(sid) {
      const s = sessions.get(sid);
      if (!s) throw Object.assign(new Error('not found'), { status: 404 });
      return { id: sid, status: s.status, usage: { list_cost: { amount: String(Math.round(s.spentUsd * 100)), currency: 'USD' }, active_seconds: 10 } };
    },
    async updateSession(sid, params) {
      const s = sessions.get(sid); calls.updates.push({ id: sid, params });
      if (params.budget) {
        s.budgetCents = Number(params.budget.max_list_cost.amount);
        if (s.pausedAtBudget && s.resumeAfterBudget) { s.pausedAtBudget = false; const go = s.resumeAfterBudget; s.resumeAfterBudget = null; go(); }
      }
      return { id: sid };
    },
    async send(sid, events) {
      const s = sessions.get(sid);
      for (const ev of events) {
        calls.sends.push({ id: sid, ev });
        if (ev.type === 'user.message') {
          if (s.status === 'idle' && s.pausedAtBudget) throw Object.assign(new Error('at budget'), { status: 400 });
          const text = ev.content.map((c) => c.text).join('\n');
          emit(s, { ...ev });
          if (s.status === 'idle') runTurn(s, text); else s.queue.push(text);
        } else if (ev.type === 'user.custom_tool_result') {
          emit(s, { ...ev });
          const w = s.waiters.get(ev.custom_tool_use_id); s.waiters.delete(ev.custom_tool_use_id);
          w?.(ev.content.map((c) => c.text).join('\n'));
        } else if (ev.type === 'user.tool_confirmation') {
          emit(s, { ...ev });
          const w = s.waiters.get(ev.tool_use_id); s.waiters.delete(ev.tool_use_id);
          w?.(ev.result);
        } else if (ev.type === 'user.interrupt') {
          s.interrupted = true; emit(s, { ...ev });
          for (const [k, w] of [...s.waiters]) { s.waiters.delete(k); w('interrupted'); }
        } else emit(s, { ...ev });
      }
    },
    async stream(sid, signal) {
      calls.streams++;
      const s = sessions.get(sid);
      const buf = []; let wake = null; let done = false;
      const q = { push(ev) { buf.push(ev); wake?.(); }, end() { done = true; wake?.(); } };
      s.subs.add(q);
      signal?.addEventListener('abort', () => q.end(), { once: true });
      return (async function* () {
        try {
          for (;;) {
            while (buf.length) yield buf.shift();
            if (done) return;
            await new Promise((r) => { wake = r; });
            wake = null;
          }
        } finally { s.subs.delete(q); }
      })();
    },
    async *listEvents(sid) { for (const ev of [...sessions.get(sid).events]) yield ev; },
    async listOutputs(sid) { return sessions.get(sid).outputs.map(({ id: fid, filename, size, createdAt }) => ({ id: fid, filename, size, createdAt })); },
    async download(fid) { for (const s of sessions.values()) { const f = s.outputs.find((o) => o.id === fid); if (f) return f.data; } throw new Error('no such file'); },
  };
}
