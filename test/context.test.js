// The Builder's context diet (redesign job 18): the brief, a file list and only the files it opens. A replay of a typical Builder job on a project with
// its teammates' papers and a few big files, measured call by call (the request's JSON, in tokens at 4 characters each), with the diet off and on.
// The live measure is scripts/builder-context.mjs over 20 real tasks; this proves the mechanism and gives the before and after on the same job.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, claim, until } from './helpers.js';
import { get, run, openDb } from '../server/db.js';
import { writeFile } from '../server/workspace.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const open = [];
after(async () => { for (const t of open) await t.close(); });
export const measured = {};

const para = (word, n) => Array.from({ length: n }, (_, i) => `${word} line ${i}: ${'lorem ipsum dolor sit amet '.repeat(6)}`).join('\n');
/** A Builder that looks around, reads the big files again and again as it works, and edits: the shape of the long runs in the ledger. */
function builder() {
  const sizes = [];
  const plan = [['list_files', {}], ...Array.from({ length: 22 }, (_, i) => (i % 3 === 2 ? ['write_file', { path: 'projects/site/app.js', content: para('app', 300) }] : ['read_file', { path: i % 3 ? 'projects/site/app.js' : 'projects/site/index.html' }]))];
  return { sizes, chat: async (a) => {
    if (a.meta.kind === 'staff' && a.meta.role === 'builder') sizes.push(Math.round(JSON.stringify(a.messages).length / 4));
    const step = a.meta.step;
    const next = a.meta.role === 'builder' ? plan[step] : null;
    if (next) return { content: '', toolCalls: [{ id: `c${step}`, name: next[0], args: JSON.stringify(next[1]) }], finish: 'stop', usage: { prompt: 1, completion: 1, cost: 0.0001, real: true } };
    a.onToken?.('Done.');
    return { content: 'Done.', toolCalls: [], finish: 'stop', usage: { prompt: 1, completion: 1, cost: 0.0001, real: true } };
  } };
}
async function replay(diet) {
  const llm = builder();
  const t = await boot({ peopleTalk: false, staffSelfCheck: false, builderDiet: diet, taskMaxUsd: Infinity }, { llm });
  open.push(t);
  const c = await claim(t, `Diet ${diet ? 'on' : 'off'}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  const e = t.app.engine;
  e.runManager = async () => {};
  const q = t.cfg.quotaBytes;
  // What the team left: research, words and a style guide in notes/, and a site with a big script.
  for (const [p, body] of [['notes/research.md', para('research', 50)], ['notes/copy.md', para('copy', 40)], ['notes/style.md', para('style', 30)], ['notes/plan.md', para('plan', 25)], ['index.html', para('html', 160)], ['app.js', para('app', 300)], ['style.css', para('css', 60)]]) writeFile(t.db, f.id, `projects/site/${p}`, body, null, q);
  for (const role of ['researcher', 'writer', 'designer']) {
    const a = get(t.db, 'SELECT id FROM agents WHERE floor_id=? AND role=?', f.id, role);
    if (a) run(t.db, "INSERT INTO tasks (floor_id,plan,title,brief,agent_id,project,status,result,created_at,updated_at) VALUES (?,?,?,?,?,'site','done',?,1,1)", f.id, 'Launch', `${role} work`, 'b', a.id, para(role, 3));
  }
  const b = e.assignTask(f, mgr, { to: 'builder', title: 'Build the booking page', brief: 'Build the booking page from the notes and publish it.', plan: 'Launch', project: 'site', dependsOn: [], afterPrevious: false });
  await until(() => ['review', 'failed', 'done'].includes(get(t.db, 'SELECT status FROM tasks WHERE id=?', b.id).status), { what: 'the build', timeout: 30000 });
  const first = llm.sizes[0];
  const avg = Math.round(llm.sizes.reduce((s, x) => s + x, 0) / llm.sizes.length);
  return { calls: llm.sizes.length, first, avg, max: Math.max(...llm.sizes), firstMessage: JSON.parse(get(t.db, 'SELECT transcript FROM tasks WHERE id=?', b.id).transcript)[1].content };
}

describe('the Builder\'s context diet', () => {
  test('the same job, diet off and on: the first call carries a file list instead of the papers, and the average call shrinks', async () => {
    const before = await replay(false);
    const afterDiet = await replay(true);
    measured.before = before; measured.after = afterDiet;
    console.log(`# builder context: diet off ${before.calls} calls, first ${before.first}, average ${before.avg}, max ${before.max} tokens; diet on ${afterDiet.calls} calls, first ${afterDiet.first}, average ${afterDiet.avg}, max ${afterDiet.max} tokens`);
    assert.match(before.firstMessage, /Their working papers and documents:/, 'without the diet the papers are pasted in');
    assert.doesNotMatch(afterDiet.firstMessage, /Their working papers and documents:/);
    assert.match(afterDiet.firstMessage, /Files in projects\/site\/ now\. Open only the ones this job needs/);
    assert.match(afterDiet.firstMessage, /- projects\/site\/app\.js \(\d+ bytes\)/);
    assert.ok(afterDiet.first < before.first, `first call ${afterDiet.first} < ${before.first}`);
    assert.ok(afterDiet.avg < before.avg * 0.75, `average ${afterDiet.avg} well under ${before.avg}`);
    assert.ok(afterDiet.max <= 80000, `no call past 80,000 tokens: ${afterDiet.max}`);
  });

  test('every call is recorded with its task and whether it ran on a computer, and the script averages the last N Builder calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'));
    try {
      const db = openDb(dir);
      const fid = Number(run(db, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at) VALUES ('f',6,'F','{}','{}','{}','x',1)").lastInsertRowid);
      const b = Number(run(db, "INSERT INTO agents (floor_id,role,title,name,look,created_at) VALUES (?,'builder','Builder','Otis','{}',1)", fid).lastInsertRowid);
      const w = Number(run(db, "INSERT INTO agents (floor_id,role,title,name,look,created_at) VALUES (?,'writer','Writer','Wren','{}',1)", fid).lastInsertRowid);
      const row = (agent, n, computer = 0, model = 'claude-sonnet-5-5') => run(db, "INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at,kind,provider,task_id,computer) VALUES (?,'d',?,?,?,1,0.01,?,'model','anthropic',1,?)", fid, agent, model, n, Date.now(), computer);
      for (const n of [60000, 70000, 80000]) row(b, n);
      row(b, 120000, 1); row(w, 999999); row(b, 0, 0, 'managed-session');
      db.close();
      const r = spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/builder-context.mjs'), '--last', '20', '--json'], { env: { PATH: process.env.PATH, DATA_DIR: dir }, encoding: 'utf8', timeout: 30000 });
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.calls, 4, 'only the Builder\'s model calls'); assert.equal(out.averageTokens, 82500);
      assert.deepEqual(out.onComputer, { calls: 1, averageTokens: 120000 }); assert.deepEqual(out.withoutComputer, { calls: 3, averageTokens: 70000 });
      const text = spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/builder-context.mjs'), '--last', '2'], { env: { PATH: process.env.PATH, DATA_DIR: dir }, encoding: 'utf8', timeout: 30000 });
      assert.match(text.stdout, /Last 2 Builder calls: average 100,000 input tokens/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
