// Model tiers (config/models.json "tiers"; redesign job 17). Each task records its tier when it starts: Tier 1 Haiku for small text edits, Tier 2 Sonnet
// medium for the rest, Tier 3 Opus only for a first build tagged hard or a bug that failed its one fix round (2 a floor a week, $6 cap each), Fable only for
// a job the owner names. The Tester keeps its own model.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { boot, claim, until } from './helpers.js';
import { get, all, run, openDb } from '../server/db.js';
import { loadModels, routeFor } from '../server/config.js';
import { toolsForRole } from '../server/tools.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const open = [];
after(async () => { for (const t of open) await t.close(); });
const LINES = ['The page loads', 'The words are right', 'It fits a phone'];

function scripted() {
  const calls = [];
  return { calls, chat: async (a) => { calls.push(a); a.onToken?.('Done.'); return { content: 'Done.', toolCalls: [], finish: 'stop', usage: { prompt: 10, completion: 5, cost: 0.001, real: true } }; } };
}
async function floor(overrides = {}, models = { ...loadModels(), floorLimits: null }) {
  const llm = scripted();
  const t = await boot({ peopleTalk: false, staffSelfCheck: false, ...overrides }, { llm, models });
  open.push(t);
  const c = await claim(t, `Tiers ${open.length}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  const e = t.app.engine;
  e.runManager = async () => {};
  if (!get(t.db, "SELECT 1 x FROM agents WHERE floor_id=? AND role='tester'", f.id)) e.hireStaff(f, 'tester');
  const assign = (to, extra = {}) => e.assignTask(f, mgr, { to, title: `${to} job`, brief: 'Do it.', plan: '', project: `p-${to}-${Math.random().toString(36).slice(2, 6)}`, dependsOn: [], afterPrevious: false, checks: LINES, ...extra });
  const tool = (name, args) => e.tools.exec(e.toolCtx(f, mgr, null, toolsForRole('manager')), name, JSON.stringify(args));
  const task = (id) => get(t.db, 'SELECT * FROM tasks WHERE id=?', id);
  const done = (id) => until(() => ['review', 'done', 'failed'].includes(task(id).status), { what: `task ${id}` });
  const modelOf = (id) => llm.calls.find((x) => x.meta.kind === 'staff' && x.meta.task?.id === id)?.model;
  return { t, f, e, assign, tool, task, done, modelOf, db: t.db, llm };
}

describe('model tiers', () => {
  test('each task records its tier: a small text edit on Tier 1, other edits and builds on Tier 2, the Tester on its own model', async () => {
    const h = await floor();
    const words = h.assign('writer', { size: 'small' });
    const code = h.assign('builder', { size: 'small' });
    const build = h.assign('builder', { size: 'big' });
    const test = h.assign('tester', { dependsOn: [] });
    for (const x of [words, code, build, test]) await h.done(x.id);
    assert.deepEqual([h.task(words.id).tier, h.modelOf(words.id)], [1, 'claude-haiku-5-5']);
    assert.deepEqual([h.task(code.id).tier, h.modelOf(code.id)], [2, 'claude-sonnet-5-5'], 'a code edit is Tier 2');
    assert.deepEqual([h.task(build.id).tier, h.modelOf(build.id)], [2, 'claude-sonnet-5-5'], 'an untagged first build is Tier 2');
    assert.equal(h.task(test.id).tier, 2); assert.equal(h.modelOf(test.id), loadModels().all.tester.model, 'the Tester keeps its own model');
    for (const x of [words, code, build, test]) { assert.ok(h.task(x.id).tier_at); assert.ok(h.task(x.id).tier_why); }
    assert.equal(routeFor(loadModels(), 'builder', { tier: 'sonnet' }).effort, 'medium', 'Tier 2 is Sonnet at medium');
  });

  test('only a build tagged hard uses Tier 3, capped at $6, at most two a floor a week', async () => {
    const h = await floor();
    run(h.db, 'UPDATE floors SET paused=1 WHERE id=?', h.f.id);
    const ids = [];
    for (let i = 1; i <= 3; i++) ids.push(Number(/#(\d+)/.exec(await h.tool('assign_task', { to: 'builder', title: `Hard build ${i}`, brief: 'Build the shop.', plan: 'Shop', project: `shop${i}`, checks: LINES, intent: 'a shop', size: 'big', hard: true }))[1]));
    assert.ok(ids.every((id) => h.task(id).hard === 1), 'the tag is kept');
    run(h.db, 'UPDATE floors SET paused=0 WHERE id=?', h.f.id);
    for (const id of ids) await h.done(id);
    assert.deepEqual(ids.map((id) => h.task(id).tier), [3, 3, 2]);
    assert.equal(h.modelOf(ids[0]), 'claude-opus-5-5'); assert.equal(h.task(ids[0]).cap_usd, 6); assert.equal(h.e.taskCap(h.task(ids[0])), 6);
    assert.match(h.task(ids[2]).tier_why, /has had its 2 this week/); assert.equal(h.modelOf(ids[2]), 'claude-sonnet-5-5');
  });

  test('a fix task for handed-back work, and new work on a project whose fix round is used up, are Tier 3', async () => {
    const h = await floor();
    const b = h.assign('builder', { project: 'site' });
    await h.done(b.id);
    run(h.db, 'UPDATE tasks SET wip=1, revisions=1 WHERE id=?', b.id);  // shipped after its one fix round (job 10)
    const again = h.assign('builder', { project: 'site', title: 'Fix the form' });
    await h.done(again.id);
    assert.equal(h.task(again.id).tier, 3); assert.match(h.task(again.id).tier_why, /failed its one fix round/);
    const fix = h.assign('builder', { project: 'other', title: 'Fix: other' });
    run(h.db, 'UPDATE tasks SET fix_of=? WHERE id=?', b.id, fix.id);
    await h.done(fix.id);
    assert.equal(h.task(fix.id).tier, 3);
  });

  test('Fable is off for floors, even on the old allowance, and on only for a job the owner names', async () => {
    const models = { ...loadModels(), floorLimits: { ...loadModels().floorLimits, fableUntilUsd: 1000, opusUntilUsd: 2000, claudeStopUsd: 5000 } };
    const h = await floor({}, models);
    assert.equal(h.e.budget.tier(h.f.id), 'fable', 'the old allowance would have put this floor on Fable');
    assert.equal(h.e.floorTier(h.f.id), 'sonnet', 'the manager runs on Tier 2');
    run(h.db, 'UPDATE floors SET paused=1 WHERE id=?', h.f.id);
    const plain = h.assign('designer', { size: 'big' });
    const named = h.assign('designer', { size: 'big' });
    const dir = mkdtempSync(join(tmpdir(), 'fable-'));
    try {
      // The owner's switch is a database row; the CLI writes it on the live file. Here it is the same row, written the same way.
      run(h.db, 'UPDATE tasks SET fable_ok=1 WHERE id=?', named.id);
      const db = openDb(dir);
      run(db, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at) VALUES ('x',3,'X','{}','{}','{}','x',1)");
      const tid = Number(run(db, "INSERT INTO tasks (floor_id,title,status,created_at,updated_at,model_tier) VALUES (1,'Logo','todo',1,1,'sonnet')").lastInsertRowid);
      db.close();
      const r = spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/admin.mjs'), 'fable', '--task', String(tid), 'on'], { env: { PATH: process.env.PATH, DATA_DIR: dir, ADMIN_PASSWORD: 'x' }, encoding: 'utf8', timeout: 30000 });
      assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).applies, 'when it starts');
      const db2 = openDb(dir);
      assert.deepEqual({ ...get(db2, 'SELECT fable_ok, model_tier, tier FROM tasks WHERE id=?', tid) }, { fable_ok: 1, model_tier: '', tier: null });
      db2.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
    run(h.db, 'UPDATE floors SET paused=0 WHERE id=?', h.f.id);
    await h.done(plain.id); await h.done(named.id);
    assert.equal(h.modelOf(plain.id), 'claude-sonnet-5-5');
    assert.equal(h.modelOf(named.id), 'claude-fable-5-2'); assert.equal(h.task(named.id).tier, 3);
  });

  test('MODEL_TIERS=0 goes back to the floor allowance', async () => {
    const h = await floor({ modelTiers: false });
    const w = h.assign('writer', { size: 'small' });
    await h.done(w.id);
    assert.equal(h.task(w.id).tier, null);
    assert.equal(h.modelOf(w.id), loadModels().all.writer.model);
  });
});
