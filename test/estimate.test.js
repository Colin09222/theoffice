// Estimates, shown only (server/estimate.js; docs/redesign/ROUND1-REST.md, job 21). A job's estimate is the median of the last 10 finished jobs of its
// kind on the building, else the spec's Q7 starting price. The boss reads "This will cost about $X." on the job; a visitor sees no money; no bot ever
// reads it; and a job that costs far more than its estimate still runs to the end, because nothing waits on the estimate or stops at a multiple of it.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, until, Client, floorState } from './helpers.js';
import { get, all, run, openDb } from '../server/db.js';
import { toolsForRole } from '../server/tools.js';
import { kindOf, estimateFor, estimateLine, STARTING, SAMPLE } from '../server/estimate.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });
const LINES = ['The page loads', 'The words are right', 'It fits a phone'];

function scripted({ usd = 0.001, steps = 1 } = {}) {
  const calls = [];
  return { calls, chat: async (a) => {
    calls.push(a);
    if (a.meta.kind === 'staff' && a.meta.step < steps - 1) return { content: '', toolCalls: [{ id: `l${a.meta.step}`, name: 'list_files', args: '{}' }], finish: 'stop', usage: { prompt: 1, completion: 1, cost: usd, real: true } };
    a.onToken?.('Done.');
    return { content: 'Done.', toolCalls: [], finish: 'stop', usage: { prompt: 1, completion: 1, cost: usd, real: true } };
  } };
}
async function floor(llm, overrides = {}) {
  const t = await boot({ peopleTalk: false, staffSelfCheck: false, ...overrides }, { llm });
  open.push(t);
  const c = await claim(t, `Estimate ${open.length}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  const e = t.app.engine;
  e.runManager = async () => {};
  const task = (id) => get(t.db, 'SELECT * FROM tasks WHERE id=?', id);
  return { t, c, f, mgr, e, task, db: t.db, llm };
}
/** Ten finished jobs of one kind, each costing `usd`, as the building's history. */
function history(db, floorId, agentId, { lane = '', size = 'standard', usd, n = SAMPLE, title = 'A page' }) {
  for (let i = 0; i < n; i++) {
    const id = Number(run(db, "INSERT INTO tasks (floor_id,title,brief,agent_id,project,status,lane,size,cost_usd,created_at,updated_at) VALUES (?,?,'b',?,?,'done',?,?,?,1,1)", floorId, title, agentId, `old${i}${lane}${size}`, lane, size, usd).lastInsertRowid);
    run(db, "INSERT INTO job_cards (floor_id,key,project,title,state,step,steps,line,task_ids,created_at,updated_at,done_at) VALUES (?,?,?,?,'done',1,1,'Done',?,1,1,?)", floorId, `t:${id}`, `old${i}`, title, JSON.stringify([id]), 1000 + i);
  }
}

describe('estimates, shown only', () => {
  test('the starting prices until a kind has 10 finished jobs, then the median of the last 10', async () => {
    const h = await floor(scripted());
    const w = get(h.db, "SELECT id FROM agents WHERE floor_id=? AND role='writer'", h.f.id).id;
    assert.equal(kindOf([{ size: 'small' }, { size: 'small' }]), 'edit');
    assert.equal(kindOf([{ lane: 'game', size: 'big' }]), 'game');
    assert.equal(kindOf([{ lane: 'shop' }]), 'business');
    assert.equal(kindOf([{ lane: 'website', title: 'Booking form for the salon' }]), 'service');
    assert.equal(kindOf([{ lane: 'website', title: 'A page about us' }]), 'website');
    assert.deepEqual(estimateFor(h.db, 'game'), { usd: STARTING.game.usd, basis: 'starting', n: 0 });
    history(h.db, h.f.id, w, { lane: 'game', usd: 1, n: 9 });
    assert.equal(estimateFor(h.db, 'game').basis, 'starting', 'nine is not enough');
    history(h.db, h.f.id, w, { lane: 'game', usd: 5, n: 1 });
    run(h.db, "UPDATE job_cards SET done_at=done_at+5000 WHERE floor_id=? AND title='A page' AND id=(SELECT MAX(id) FROM job_cards)", h.f.id);
    assert.deepEqual(estimateFor(h.db, 'game'), { usd: 1, basis: 'median', n: 10 });
    assert.deepEqual([estimateLine(0.4), estimateLine(2.6), estimateLine(0.004), estimateLine(0)], ['This will cost about $0.40.', 'This will cost about $3.', 'This will cost about $0.00.', '']);
  });

  test('the boss sees "This will cost about $X." on a new job and under Now; a visitor sees no money; no bot reads it', async () => {
    const h = await floor(scripted());
    run(h.db, 'UPDATE floors SET paused=1 WHERE id=?', h.f.id);  // the job waits, so Now shows it
    const ctx = h.e.toolCtx(h.f, h.mgr, null, toolsForRole('manager'));
    const said = await h.e.tools.exec(ctx, 'assign_task', JSON.stringify({ to: 'builder', title: 'Build the salon site', brief: 'A site with a booking form.', plan: 'Salon', project: 'salon', lane: 'website', checks: LINES, intent: 'a salon site' }));
    assert.match(said, /assigned/);
    assert.doesNotMatch(said, /\$|cost|estimate/i, 'the manager\'s tool result carries no figure');
    const id = Number(/#(\d+)/.exec(said)[1]);
    assert.equal(h.task(id).job_est_usd, STARTING.service.usd); assert.equal(h.task(id).job_est_kind, 'service'); assert.equal(h.task(id).job_est_basis, 'starting');
    const boss = await floorState(h.c);
    const card = boss.jobs.find((j) => j.project === 'salon');
    assert.deepEqual(card.estimate, { usd: 2, kind: 'service', line: 'This will cost about $2.' });
    assert.equal(boss.status.now.estimate.line, 'This will cost about $2.');
    const visitor = (await new Client(h.t).get(`/api/floors/${h.c.slug}`)).data;
    const text = JSON.stringify(visitor);
    assert.ok(visitor.jobs.length, 'the visitor sees the job'); assert.doesNotMatch(text, /cost about|"estimate"|job_est|\$\d/);
    const state = h.e.managerContext(get(h.db, 'SELECT * FROM floors WHERE id=?', h.f.id), h.mgr).messages.map((m) => JSON.stringify(m.content)).join(' ');
    assert.doesNotMatch(state, /cost about|job_est/, 'not in the manager\'s state');
    run(h.db, 'UPDATE floors SET paused=0 WHERE id=?', h.f.id);
    await until(() => h.task(id).status === 'review', { what: 'the job' });
    const staff = h.llm.calls.filter((x) => x.meta.kind === 'staff').map((x) => JSON.stringify(x.messages)).join(' ');
    assert.doesNotMatch(staff, /cost about|job_est/, 'not in what the Builder reads');
  });

  test('a job estimated far below what it really costs still runs to the end; nothing stops at any multiple', async () => {
    const h = await floor(scripted({ usd: 2, steps: 4 }));
    const w = get(h.db, "SELECT id FROM agents WHERE floor_id=? AND role='writer'", h.f.id).id;
    history(h.db, h.f.id, w, { size: 'small', usd: 0.01 });
    const job = h.e.assignTask(h.f, h.mgr, { to: 'writer', title: 'Change a word', brief: 'b', plan: '', project: 'words', dependsOn: [], afterPrevious: false, size: 'small' });
    assert.equal(h.task(job.id).job_est_usd, 0.01); assert.equal(h.task(job.id).job_est_basis, 'median');
    await until(() => ['review', 'done', 'failed'].includes(h.task(job.id).status), { what: 'the job to end' });
    const row = h.task(job.id);
    assert.equal(row.status, 'review', 'it finished its work'); assert.equal(row.cost_usd, 8, '800 times its estimate'); assert.equal(row.capped_at, null);
    assert.equal(h.llm.calls.filter((x) => x.meta.kind === 'staff').length, 4);
    assert.equal(row.job_est_usd, 0.01, 'the estimate stays as it was, to compare with what it cost');
  });

  test('a job\'s estimate is worked out again as steps are added before it starts, then kept; JOB_ESTIMATES=0 hides the line', async () => {
    const h = await floor(scripted(), { jobEstimates: false });
    run(h.db, 'UPDATE floors SET paused=1 WHERE id=?', h.f.id);
    const a = h.e.assignTask(h.f, h.mgr, { to: 'writer', title: 'Fix a typo', brief: 'b', plan: 'Fixes', project: 'site', dependsOn: [], afterPrevious: false, size: 'small' });
    assert.equal(h.task(a.id).job_est_kind, 'edit');
    const b = h.e.assignTask(h.f, h.mgr, { to: 'builder', title: 'Build the shop', brief: 'b', plan: 'Fixes', project: 'site', dependsOn: [], afterPrevious: false, size: 'big', lane: 'shop' });
    assert.deepEqual([h.task(a.id).job_est_kind, h.task(b.id).job_est_kind, h.task(a.id).job_est_usd], ['business', 'business', STARTING.business.usd]);
    const boss = await floorState(h.c);
    assert.ok(boss.jobs.length && boss.jobs.every((j) => !j.estimate), 'switched off: no line');
  });
});
