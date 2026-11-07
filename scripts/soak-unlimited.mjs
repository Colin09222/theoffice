// Measures what a very long run leaves in this process with every work cap off. No model and no spend: a scripted LLM and the mock computer.
// node --expose-gc scripts/soak-unlimited.mjs [staffSteps] [sessionSteps]
import { get } from '../server/db.js';
import { createMockSessions } from '../server/mock-sessions.js';
import { boot, claim, until } from '../test/helpers.js';

const STAFF_STEPS = Number(process.argv[2] || 3000), SESSION_STEPS = Number(process.argv[3] || 100000);
const heap = () => { globalThis.gc?.(); return Math.round(process.memoryUsage().heapUsed / 1e6); };
const body = 'y'.repeat(30000);
const line = (what, marks) => console.log(`${what}: heap ${marks.join(' -> ')} MB`);

async function staffRun() {
  const marks = []; let most = 0;
  const llm = { chat: async (a) => {
    most = Math.max(most, JSON.stringify(a.messages).length);
    const n = a.meta.step;
    if (n % Math.ceil(STAFF_STEPS / 5) === 0) marks.push(heap());
    const call = n === 0 ? ['write_file', { path: 'projects/p/big.md', content: body }] : n < STAFF_STEPS ? ['read_file', { path: 'projects/p/big.md' }] : null;
    return { content: call ? '' : 'All done.', toolCalls: call ? [{ id: `t${n}`, name: call[0], args: JSON.stringify(call[1]) }] : [], finish: 'stop', usage: { prompt: 10, completion: 5, cost: 0.00001, real: true } };
  } };
  const t = await boot({}, { llm });
  t.app.engine.runManager = async () => {};
  const c = await claim(t, 'Long Staff');
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  const { id } = t.app.engine.assignTask(f, mgr, { to: 'writer', title: 'Long', brief: 'b', plan: '', project: 'p', dependsOn: [], afterPrevious: false });
  t.app.engine.kick();
  const row = await until(() => { const r = get(t.db, 'SELECT status,LENGTH(transcript) n FROM tasks WHERE id=?', id); return ['review', 'failed'].includes(r.status) ? r : null; }, { timeout: 1800000, what: 'the staff run' });
  line(`staff run, ${STAFF_STEPS} steps of 30 KB, ${row.status}, largest request ${Math.round(most / 1000)} KB, stored ${Math.round(row.n / 1000)} KB`, [...marks, heap()]);
  await t.close();
}

async function sessionRun() {
  const marks = []; let seenMost = 0;
  const sessions = createMockSessions({}, { stepUsd: 0, usage: { input_tokens: 10, output_tokens: 0 }, async onTurn(api) {
    const s = api.session;
    for (let i = 0; i < SESSION_STEPS; i++) {
      await api.step();
      if (i % Math.ceil(SESSION_STEPS / 5) === 0) { marks.push(heap()); await new Promise((r) => setTimeout(r, 20)); }
      // The mock's own history stands in for the platform's, and isn't this server's memory.
      if (s.events.length > 4000) s.events.splice(0, s.events.length - 4000);
    }
    api.save([{ path: 'index.html', data: Buffer.from('<!doctype html><title>x</title>') }]); api.message('Done.');
  } });
  const t = await boot({ computerEnabled: true, outputLagMs: 0 }, { sessions });
  t.app.engine.runManager = async () => {};
  const comp = t.app.engine.computer;
  comp.seenWindowMs = 1000;
  const real = comp.seenBefore.bind(comp);
  comp.seenBefore = (st, ev) => { const r = real(st, ev); seenMost = Math.max(seenMost, st.seen.size); return r; };
  const c = await claim(t, 'Long Session');
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  const { id } = t.app.engine.assignTask(f, mgr, { to: 'builder', title: 'Long', brief: 'b', plan: '', project: 'g', dependsOn: [], afterPrevious: false });
  t.app.engine.kick();
  const row = await until(() => { const r = get(t.db, 'SELECT status FROM tasks WHERE id=?', id); return ['review', 'failed'].includes(r.status) ? r : null; }, { timeout: 1800000, what: 'the session' });
  line(`computer session, ${SESSION_STEPS} steps (${SESSION_STEPS * 2} events), ${row.status}, most event ids held ${seenMost}`, [...marks, heap()]);
  await t.close();
}

await staffRun();
await sessionRun();
console.log(`rss ${Math.round(process.memoryUsage().rss / 1e6)} MB`);
process.exit(0);
