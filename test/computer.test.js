// The Builder and Tester on a real computer, against a mock session client. Every hostile thing a container could send back is tried here.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { get, all, run } from '../server/db.js';
import { createMockSessions, defaultTurn } from '../server/mock-sessions.js';
import { packTgz } from '../server/tarball.js';
import { boot, claim, until, sleep, floorState, sse, Client } from './helpers.js';

const open = [];
async function start(script = {}, overrides = {}) {
  const sessions = createMockSessions({}, script);
  const t = await boot({ computerEnabled: true, outputLagMs: 0, ...overrides }, { sessions });
  open.push(t);
  // The manager would approve finished work straight away. These tests look at the staff's side of it.
  t.app.engine.runManager = async () => {};
  const c = await claim(t, `Floor ${open.length} Co`);
  const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id);
  const assign = (brief = 'Build it', { project = 'game', to = 'builder', priv = false } = {}) => t.app.engine.assignTask(floor, mgr, { to, title: 'Build the game', brief, plan: '', project, private: priv, dependsOn: [] });
  const taskRow = (id) => get(t.db, 'SELECT * FROM tasks WHERE id=?', id);
  const settle = (id, statuses = ['review', 'failed', 'blocked', 'done', 'cancelled']) => until(() => { const r = taskRow(id); return statuses.includes(r.status) && !t.app.engine.runs.size ? r : null; }, { what: `task ${id} to settle`, timeout: 8000 });
  t.app.engine.kick();
  return { t, c, floor, mgr, sessions, assign, taskRow, settle };
}
after(async () => { for (const t of open) await t.close(); });

const go = async (h, ...a) => { const r = h.assign(...a); h.t.app.engine.kick(); return r; };

describe('a task on a computer', () => {
  test('runs a session, syncs the build back and publishes it, including binary files', async () => {
    const h = await start();
    const { id } = await go(h);
    const row = await h.settle(id);
    assert.equal(row.status, 'review');
    assert.match(row.result, /Tests pass/);
    assert.match(row.result, /\/theoffice\/f\/.*\/game\//);
    const pub = all(h.t.db, 'SELECT path,size FROM published_files WHERE floor_id=? AND project=? ORDER BY path', h.floor.id, 'game').map((r) => r.path);
    assert.deepEqual(pub, ['app.js', 'index.html', 'logo.png']);
    const png = get(h.t.db, "SELECT content FROM files WHERE floor_id=? AND path='projects/game/dist/logo.png'", h.floor.id).content;
    assert.ok(png instanceof Uint8Array); assert.equal(png[5], 255);
    const site = await fetch(`${h.t.base}/f/${h.c.slug}/game/logo.png`);
    assert.equal(site.status, 200); assert.equal(site.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await site.arrayBuffer())[6], 254);
  });
  test('shows activity on the floor: feed, animations and project tags', async () => {
    const h = await start();
    const s = sse(h.c, h.c.slug);
    await sleep(30);
    const { id } = await go(h);
    await h.settle(id);
    await sleep(30);
    await s.close();
    const lines = s.events.filter((e) => e.type === 'feed').map((e) => e.data.text);
    for (const want of ['started a computer', 'installed packages', 'wrote src/main.js', 'ran the build', 'checked it in a real browser', 'packed up the work', 'published game']) assert.ok(lines.some((l) => l.includes(want)), `feed has "${want}": ${lines.join(' | ')}`);
    const states = new Set(s.events.filter((e) => e.type === 'agent').map((e) => e.data.state));
    for (const st of ['queued', 'thinking', 'typing', 'browsing']) assert.ok(states.has(st), `state ${st}: ${[...states]}`);
  });
  test('charges the ledger per model request, then reconciles to the platform total', async () => {
    const h = await start();
    const { id } = await go(h);
    await h.settle(id);
    const rows = all(h.t.db, 'SELECT model,prompt_tokens,completion_tokens,cost_usd FROM ledger WHERE floor_id=?', h.floor.id).filter((r) => r.prompt_tokens > 0);
    assert.ok(rows.length >= 6, `model rows ${rows.length}`);
    assert.equal(rows[0].model, 'claude-opus-5-5');
    const each = (100 * 4 + 500 * 5 + 2000 * 0.2 + 300 * 20) / 1e6;
    assert.ok(Math.abs(rows[0].cost_usd - each) < 1e-9, `cost ${rows[0].cost_usd}`);
    const row = h.taskRow(id);
    const total = get(h.t.db, 'SELECT SUM(cost_usd) n FROM ledger WHERE floor_id=?', h.floor.id).n;
    assert.ok(Math.abs(row.cost_usd - total) < 1e-9);
    assert.ok(row.cost_usd >= 0.14 - 0.006, `reconciled up to the platform figure, got ${row.cost_usd}`);
  });
  test('the environment is deny-by-default, with no MCP, vaults, repos or web tools', async () => {
    const h = await start();
    await h.settle((await go(h)).id);
    const env = h.sessions.calls.environments[0];
    assert.deepEqual(env.config.networking, { type: 'limited', allow_package_managers: true, allow_mcp_servers: false, allowed_hosts: [] });
    assert.equal(env.config.type, 'cloud');
    const def = h.sessions.calls.agents[0];
    const toolset = def.tools.find((x) => x.type === 'agent_toolset_20260401');
    assert.deepEqual(toolset.configs.filter((c) => c.enabled === false).map((c) => c.name).sort(), ['web_fetch', 'web_search']);
    assert.ok(!def.mcp_servers && !def.skills && !def.multiagent);
    const params = h.sessions.calls.sessions[0];
    assert.ok(!params.vault_ids);
    assert.deepEqual(params.resources.map((r) => r.type), ['file']);
    assert.equal(params.metadata.floor, String(h.floor.id));
  });
  test('holds no secrets: prompts and boxes never contain a key, a cookie secret or the admin password', async () => {
    const secret = 'sk-ant-TESTKEY-should-never-appear';
    const h = await start({}, { anthropicKey: secret, openrouterKey: `or-${secret}`, webSearchKey: `brave-${secret}` });
    const { id } = await go(h);
    await h.settle(id);
    const box = h.sessions.calls.uploads[0].buffer;
    const { unpackTgz } = await import('../server/tarball.js');
    const hay = [JSON.stringify(h.sessions.calls.agents), JSON.stringify(h.sessions.calls.sessions), JSON.stringify(h.sessions.calls.sends), ...unpackTgz(box).files.map((f) => f.data.toString('latin1'))].join('\n');
    assert.ok(!hay.includes(secret));
    assert.ok(!hay.includes('correct horse battery'));
    assert.ok(!hay.includes(get(h.t.db, "SELECT value FROM settings WHERE key='hmac_secret'").value));
    assert.ok(!/ANTHROPIC_API_KEY|OPENROUTER/.test(hay));
  });
  test('uploads the box once and deletes our copy, and reuses the same environment and agent', async () => {
    const h = await start();
    await h.settle((await go(h)).id);
    await h.settle((await go(h, 'Build another', { project: 'second' })).id);
    assert.equal(h.sessions.calls.environments.length, 1);
    assert.equal(h.sessions.calls.agents.length, 1);
    assert.equal(h.sessions.calls.sessions.length, 2);
    assert.deepEqual(h.sessions.calls.deleted, h.sessions.calls.uploads.map((u) => u.id));
  });
});

describe('isolation between floors and projects', () => {
  test('the box holds only this project: never another project, another floor or a private one', async () => {
    const h = await start();
    const other = await claim(h.t, 'Other Floor Co');
    const otherFloor = get(h.t.db, 'SELECT * FROM floors WHERE slug=?', other.slug);
    const { writeFile } = await import('../server/workspace.js');
    writeFile(h.t.db, otherFloor.id, 'projects/game/secret.txt', 'OTHER-FLOOR-SECRET', null, 1e7);
    writeFile(h.t.db, h.floor.id, 'projects/game/keep.txt', 'mine', null, 1e7);
    writeFile(h.t.db, h.floor.id, 'projects/privy/plan.txt', 'PRIVATE-PLAN', null, 1e7);
    h.t.app.engine.upsertProject(h.floor, 'privy', { title: 'privy', makePrivate: true });
    await h.settle((await go(h)).id);
    const { unpackTgz } = await import('../server/tarball.js');
    const box = unpackTgz(h.sessions.calls.uploads[0].buffer).files;
    assert.deepEqual(box.filter((f) => f.path.startsWith('project/')).map((f) => f.path), ['project/keep.txt']);
    const text = box.map((f) => f.data.toString('latin1')).join('');
    assert.ok(!text.includes('OTHER-FLOOR-SECRET')); assert.ok(!text.includes('PRIVATE-PLAN'));
  });
  test('each task gets its own session and container, and floors share none', async () => {
    const h = await start();
    const c2 = await claim(h.t, 'Second Floor Co');
    const f2 = get(h.t.db, 'SELECT * FROM floors WHERE slug=?', c2.slug);
    const m2 = get(h.t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f2.id);
    const a = (await go(h)).id;
    const b = h.t.app.engine.assignTask(f2, m2, { to: 'builder', title: 'x', brief: 'y', plan: '', project: 'game', private: false, dependsOn: [] }).id;
    h.t.app.engine.kick();
    await h.settle(a); await h.settle(b);
    assert.notEqual(h.taskRow(a).session_id, h.taskRow(b).session_id);
    assert.equal(all(h.t.db, "SELECT DISTINCT path FROM published_files WHERE floor_id=? AND project='game'", f2.id).length, 3);
    assert.ok(!get(h.t.db, "SELECT 1 x FROM files WHERE floor_id=? AND path LIKE 'projects/%' AND agent_id NOT IN (SELECT id FROM agents WHERE floor_id=?)", h.floor.id, h.floor.id));
  });
  test('a session cannot publish a different project, or use a shared-drive tool to reach private work', async () => {
    const seen = {};
    const h = await start({ async onTurn(api) {
      await api.step();
      seen.publish = await api.custom('publish_project', { project: 'someone-elses', title: 'x', kind: 'site' });
      seen.read = await api.custom('read_shared_file', { path: 'projects/privy/plan.txt' });
      seen.list = await api.custom('list_shared_files', {});
      seen.travers = await api.custom('read_shared_file', { path: '../../etc/passwd' });
      seen.ghost = await api.custom('run_on_server', { cmd: 'id' });
      seen.ssrf = await api.custom('fetch_url', { url: 'http://169.254.169.254/latest/meta-data/' });
      api.save([{ path: 'index.html', data: Buffer.from('<h1>x</h1>') }]);
      await api.message('done');
    } });
    const { writeFile } = await import('../server/workspace.js');
    writeFile(h.t.db, h.floor.id, 'projects/privy/plan.txt', 'PRIVATE-PLAN', null, 1e7);
    h.t.app.engine.upsertProject(h.floor, 'privy', { title: 'privy', makePrivate: true });
    await h.settle((await go(h)).id);
    assert.match(seen.publish, /only publish its own project/);
    assert.match(seen.read, /no such file/);
    assert.ok(!seen.list.includes('privy'));
    assert.match(seen.travers, /Error/);
    assert.match(seen.ghost, /no tool called/);
    assert.match(seen.ssrf, /Blocked|Could not/);
  });
  test('work on a private project stays private: redacted feed, no public site', async () => {
    const h = await start();
    const visitor = new Client(h.t);
    const s = sse(visitor, h.c.slug);
    await sleep(30);
    const { id } = await go(h, 'Secret thing', { project: 'hush', priv: true });
    await h.settle(id);
    await s.close();
    const lines = s.events.filter((e) => e.type === 'feed').map((e) => e.data.text).join('|');
    assert.ok(!/hush|wrote src|published/.test(lines), lines);
    assert.equal((await fetch(`${h.t.base}/f/${h.c.slug}/hush/`)).status, 404);
    assert.ok(!(await floorState(visitor, h.c.slug)).projects.some((p) => p.slug === 'hush'));
  });
  test('reset and kill remove session records with the floor', async () => {
    const h = await start();
    await h.settle((await go(h)).id);
    const admin = (await import('./helpers.js')).adminClient;
    const a = await admin(h.t);
    assert.equal((await a.post(`/api/admin/floors/${h.floor.id}/kill`, {})).status, 200);
    assert.equal(all(h.t.db, 'SELECT id FROM tasks WHERE floor_id=?', h.floor.id).length, 0);
  });
});

describe('what comes back from a container is hostile', () => {
  const saveThen = (make, seen = {}) => ({ async onTurn(api, text) {
    await api.step();
    if (/did not go through/.test(text)) { seen.problem = text; api.save([{ path: 'index.html', data: Buffer.from('fixed') }]); return; }
    await api.custom('publish_project', { title: 'x', kind: 'site' });
    make(api);
    await api.message('done');
  } });
  const file = (path, data = 'x') => ({ path, data: Buffer.from(data) });

  test('traversal, absolute paths, dotfiles and scripts outside the allow-list never land', async () => {
    const h = await start(saveThen((api) => api.save([
      file('../../../etc/passwd.txt'), file('/etc/shadow.txt'), file('a/../../b.txt'), file('.env'), file('.git/config.txt'), file('x\\y.txt'), file('evil.exe'), file('evil.php'), file('node_modules/left/index.js'), file('index.html', '<h1>ok</h1>'),
    ])));
    const row = await h.settle((await go(h)).id);
    assert.equal(row.status, 'review');
    const paths = all(h.t.db, 'SELECT path FROM files WHERE floor_id=?', h.floor.id).map((r) => r.path);
    assert.deepEqual(paths, ['projects/game/index.html']);
  });
  test('symlinks and hard links are never stored or followed', async () => {
    const tarOf = (entries) => {
      const blocks = [];
      for (const [name, type, link, body] of entries) {
        const h = Buffer.alloc(512);
        h.write(name, 0); h.write('0000644', 100); h.write('0000000', 108); h.write('0000000', 116);
        h.write((body?.length || 0).toString(8).padStart(11, '0'), 124); h.write('00000000000', 136); h.write(type, 156); if (link) h.write(link, 157);
        h.write('ustar\0', 257, 'latin1'); h.write('00', 263); h.fill(' ', 148, 156);
        let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
        blocks.push(h);
        if (body) { blocks.push(body); blocks.push(Buffer.alloc((512 - (body.length % 512)) % 512)); }
      }
      blocks.push(Buffer.alloc(1024));
      return gzipSync(Buffer.concat(blocks));
    };
    const h = await start(saveThen((api) => api.saveRaw(tarOf([['steal.txt', '2', '/etc/passwd'], ['hard.txt', '1', 'steal.txt'], ['dev.txt', '3'], ['index.html', '0', '', Buffer.from('ok')]]))));
    const row = await h.settle((await go(h)).id);
    assert.equal(row.status, 'review');
    assert.deepEqual(all(h.t.db, 'SELECT path FROM files WHERE floor_id=?', h.floor.id).map((r) => r.path), ['projects/game/index.html']);
  });
  test('a gzip bomb is refused and the agent is asked to fix it, without running out of memory', async () => {
    const seen = {};
    const before = process.memoryUsage().rss;
    const h = await start(saveThen((api) => api.saveRaw(gzipSync(Buffer.alloc(300 * 1024 * 1024))), seen));
    const row = await h.settle((await go(h)).id);
    assert.match(seen.problem, /unpacks to more than is allowed|did not go through/);
    assert.equal(row.status, 'review', row.result);
    assert.ok(process.memoryUsage().rss - before < 500 * 1024 * 1024);
  });
  test('garbage and an oversized archive are refused before anything is believed', async () => {
    const seen = {};
    const h = await start(saveThen((api) => api.saveRaw(Buffer.from('not a tarball at all')), seen));
    await h.settle((await go(h)).id);
    assert.match(seen.problem, /not a readable/);
    const seen2 = {};
    const h2 = await start(saveThen((api) => api.saveRaw(Buffer.from('x'), 200 * 1024 * 1024), seen2));
    await h2.settle((await go(h2)).id);
    assert.match(seen2.problem, /over 40 MB/);
  });
  test('the storage quota holds, and a failed sync changes nothing', async () => {
    const seen = {};
    const h = await start(saveThen((api) => api.save([file('index.html', 'first'), { path: 'big.bin', data: Buffer.alloc(3 * 1024 * 1024, 1) }]), seen), { quotaBytes: 1024 * 1024 });
    await h.settle((await go(h)).id);
    assert.match(seen.problem, /quota/);
    assert.ok(!get(h.t.db, "SELECT 1 x FROM files WHERE path='projects/game/big.bin' AND floor_id=?", h.floor.id));
  });
  test('giving up after the fix turns fails the task visibly instead of looping', async () => {
    let turns = 0;
    const h = await start({ async onTurn(api) { turns++; await api.step(); api.saveRaw(Buffer.from('junk')); await api.message('tried'); } });
    const row = await h.settle((await go(h)).id);
    assert.equal(row.status, 'failed');
    assert.match(row.result, /could not be saved/);
    assert.equal(turns, 3);
  });
  test('a directory that escapes the project is refused', async () => {
    const seen = {};
    const h = await start({ async onTurn(api) {
      await api.step();
      for (const d of ['../other', '/etc', 'a/../../b', '.git', 'a/b/c/d/e']) (seen.r ||= []).push(await api.custom('publish_project', { title: 'x', kind: 'site', directory: d }));
      api.save([file('index.html')]);
      await api.message('done');
    } });
    await h.settle((await go(h)).id);
    assert.equal(seen.r.length, 5);
    for (const r of seen.r) assert.match(r, /simple relative folder/);
  });
  test('a merge keeps edits made elsewhere while the computer ran, and removes what the computer deleted', async () => {
    const { writeFile } = await import('../server/workspace.js');
    let h;
    h = await start({ async onTurn(api) {
      await api.step();
      writeFile(h.t.db, h.floor.id, 'projects/game/style.css', 'designer changed this', null, 1e7);
      api.save([file('style.css', 'old css'), file('new.txt', 'new')]);  // old.txt deleted by the computer; style.css untouched by it
      await api.message('done');
    } });
    writeFile(h.t.db, h.floor.id, 'projects/game/style.css', 'old css', null, 1e7);
    writeFile(h.t.db, h.floor.id, 'projects/game/old.txt', 'old', null, 1e7);
    await h.settle((await go(h)).id);
    assert.equal(get(h.t.db, "SELECT content FROM files WHERE floor_id=? AND path='projects/game/style.css'", h.floor.id).content, 'designer changed this');
    assert.ok(!get(h.t.db, "SELECT 1 x FROM files WHERE floor_id=? AND path='projects/game/old.txt'", h.floor.id));
    assert.ok(get(h.t.db, "SELECT 1 x FROM files WHERE floor_id=? AND path='projects/game/new.txt'", h.floor.id));
  });
});

describe('limits and caps', () => {
  test('the step limit warns, interrupts, salvages the work and fails the task', async () => {
    let extra = 0;
    const h = await start({ async onTurn(api) {
      await api.custom('publish_project', { title: 'x', kind: 'site' });
      api.save([{ path: 'index.html', data: Buffer.from('partial') }]);
      for (;;) { await api.step(); extra++; api.tool('bash', { command: 'sleep 1' }); await sleep(1); if (extra > 500) break; }
    } }, { sessionMaxSteps: 8 });
    const row = await h.settle((await go(h)).id);
    assert.equal(row.status, 'failed');
    assert.match(row.result, /Ran out of steps/);
    assert.ok(extra <= 9, `ran ${extra} steps`);
    assert.ok(h.sessions.calls.sends.some((s) => s.ev.type === 'system.message' && /5 steps left/.test(s.ev.content[0].text)));
    assert.ok(h.sessions.calls.sends.some((s) => s.ev.type === 'user.interrupt'));
    assert.ok(get(h.t.db, "SELECT 1 x FROM published_files WHERE floor_id=? AND project='game'", h.floor.id), 'what was saved still went up');
  });
  test('every session has a hard budget, even with every cap off', async () => {
    const h = await start({}, { floorDailyUsd: Infinity, globalDailyUsd: Infinity, taskMaxUsd: Infinity, sessionMaxUsd: 5 });
    await h.settle((await go(h)).id);
    assert.deepEqual(h.sessions.calls.sessions[0].budget, { type: 'limit', max_list_cost: { amount: '500', currency: 'USD' } });
  });
  test('the budget is the smallest of the session limit, the task cap and what is left of the day', async () => {
    const h = await start({}, { floorDailyUsd: 1.5, globalDailyUsd: 9, taskMaxUsd: 3, sessionMaxUsd: 5 });
    run(h.t.db, 'INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at) VALUES (?,?,?,?,?,?,?,?)', h.floor.id, new Date().toISOString().slice(0, 10), null, 'x', 0, 0, 1, Date.now());
    await h.settle((await go(h)).id);
    assert.equal(h.sessions.calls.sessions[0].budget.max_list_cost.amount, '50');
  });
  test('reaching the session budget stops the agent and fails the task', async () => {
    let steps = 0;
    const h = await start({ stepUsd: 0.06, async onTurn(api) { for (;;) { await api.step(); steps++; if (steps > 100) break; } } }, { sessionMaxUsd: 0.3 });
    const row = await h.settle((await go(h)).id);
    assert.equal(row.status, 'failed');
    assert.match(row.result, /spending limit/);
    assert.ok(steps <= 6, `took ${steps}`);
  });
  test('reaching the daily cap sends the task back to wait and tells the boss, instead of failing it', async () => {
    const h = await start({ stepUsd: 0.06, async onTurn(api) { for (let i = 0; i < 100; i++) await api.step(); } }, { floorDailyUsd: 0.2, sessionMaxUsd: 5, globalDailyUsd: 25 });
    const { id } = await go(h);
    await until(() => h.taskRow(id).status === 'todo' && h.taskRow(id).session_id, { what: 'requeue' });
    assert.ok(all(h.t.db, "SELECT text FROM messages WHERE floor_id=? AND role='office'", h.floor.id).some((m) => /budget/i.test(m.text)));
    assert.equal(h.sessions.calls.sessions.length, 1);
  });
  test('no session starts when nothing is left of the task cap or the day', async () => {
    const h = await start({}, { taskMaxUsd: 0.05 });
    const row = await h.settle((await go(h)).id);
    assert.equal(row.status, 'failed'); assert.match(row.result, /spending limit/);
    assert.equal(h.sessions.calls.sessions.length, 0);
    const h2 = await start({}, { floorDailyUsd: 0.05 });
    const task2 = (await go(h2)).id;
    await sleep(100);
    assert.equal(h2.sessions.calls.sessions.length, 0);
    assert.equal(h2.taskRow(task2).status, 'todo');
  });
  test('running sessions hold their budget against the floor cap, so siblings cannot overspend it', async () => {
    const h = await start({ async onTurn(api) { await api.step(); await sleep(150); api.save([{ path: 'index.html', data: Buffer.from('x') }]); await api.message('d'); } }, { floorDailyUsd: 3, sessionMaxUsd: 2, maxSessionsFloor: 2 });
    h.t.app.engine.hireStaff(h.floor, 'tester', 'Tess');
    await go(h, 'one', { project: 'a' });
    await go(h, 'two', { project: 'b', to: 'tester' });
    await until(() => h.sessions.calls.sessions.length === 2, { what: 'two sessions' });
    const budgets = h.sessions.calls.sessions.map((s) => Number(s.budget.max_list_cost.amount));
    assert.ok(budgets[0] + budgets[1] <= 300, `budgets ${budgets}`);
  });
  test('sessions queue behind the per-floor and global limits', async () => {
    let live = 0, peak = 0;
    const h = await start({ async onTurn(api) { live++; peak = Math.max(peak, live); await api.step(); await sleep(60); live--; api.save([{ path: 'index.html', data: Buffer.from('x') }]); await api.message('d'); } }, { maxSessionsFloor: 1, taskMaxUsd: 3 });
    h.t.app.engine.hireStaff(h.floor, 'tester', 'Tess');
    const a = (await go(h, 'one', { project: 'a' })).id;
    const b = (await go(h, 'two', { project: 'b', to: 'tester' })).id;
    await h.settle(a); await h.settle(b);
    assert.equal(peak, 1);
  });
  test('the per-floor task limit still applies to computer tasks', async () => {
    const h = await start();
    const now = Date.now();
    for (let i = 0; i < 60; i++) run(h.t.db, "INSERT INTO tasks (floor_id,title,status,created_at,updated_at) VALUES (?,?,'done',?,?)", h.floor.id, `t${i}`, now, now);
    assert.throws(() => h.assign(), /task limit/);
  });
  test('a visitor can never start a session', async () => {
    const h = await start();
    const v = new Client(h.t);
    assert.equal((await v.post(`/api/floors/${h.c.slug}/chat`, { text: 'build a game' })).status, 401);
    await sleep(30);
    assert.equal(h.sessions.calls.sessions.length, 0);
  });
});

describe('control and recovery', () => {
  test('pause interrupts, resume reattaches to the same session and carries on', async () => {
    let turns = 0; const texts = [];
    const h = await start({ async onTurn(api, text) {
      turns++; texts.push(text);
      if (turns === 1) { for (let i = 0; i < 400; i++) { await api.step(); await sleep(5); } }
      await api.step();
      api.save([{ path: 'index.html', data: Buffer.from('x') }]);
      await api.message('finished');
    } });
    const { id } = await go(h);
    await until(() => h.sessions.calls.sends.some((s) => s.ev.type === 'user.message'), { what: 'start' });
    await sleep(40);
    h.t.app.engine.pauseFloor(h.floor.id);
    await until(() => h.taskRow(id).status === 'todo' && !h.t.app.engine.runs.size, { what: 'requeue on pause' });
    assert.ok(h.sessions.calls.sends.some((s) => s.ev.type === 'user.interrupt'));
    h.t.app.engine.resumeFloor(h.floor.id);
    const row = await h.settle(id);
    assert.equal(row.status, 'review', row.result);
    assert.equal(h.sessions.calls.sessions.length, 1, 'same session');
    assert.match(texts[1], /Carry on/);
  });
  test('stop cancels the task and interrupts the computer', async () => {
    const h = await start({ async onTurn(api) { for (let i = 0; i < 400; i++) { await api.step(); await sleep(5); } } });
    const { id } = await go(h);
    await until(() => h.sessions.calls.sends.some((s) => s.ev.type === 'user.message'), { what: 'start' });
    h.t.app.engine.stopFloor(h.floor.id);
    await until(() => !h.t.app.engine.runs.size, { what: 'run gone' });
    assert.equal(h.taskRow(id).status, 'cancelled');
    assert.ok(h.sessions.calls.sends.some((s) => s.ev.type === 'user.interrupt'));
  });
  test('ask_boss blocks the task; the answer resumes the same session', async () => {
    const texts = [];
    const h = await start({ async onTurn(api, text) {
      texts.push(text);
      await api.step();
      if (texts.length === 1) { await api.custom('ask_boss', { question: 'Silly or serious?' }); await api.message('waiting'); return; }
      api.save([{ path: 'index.html', data: Buffer.from('x') }]);
      await api.message('finished');
    } });
    const { id } = await go(h);
    await until(() => h.taskRow(id).status === 'blocked', { what: 'blocked' });
    const q = get(h.t.db, 'SELECT id FROM questions WHERE floor_id=?', h.floor.id);
    assert.equal((await h.c.post(`/api/floors/${h.c.slug}/questions/${q.id}/answer`, { text: 'Silly' })).status, 200);
    const row = await h.settle(id);
    assert.equal(row.status, 'review');
    assert.match(texts[1], /Silly/);
    assert.equal(h.sessions.calls.sessions.length, 1);
  });
  test('a review sent back with notes goes to the same session', async () => {
    const texts = [];
    const h = await start({ async onTurn(api, text) { texts.push(text); await api.step(); api.save([{ path: 'index.html', data: Buffer.from('x') }]); await api.message('finished'); } });
    const { id } = await go(h);
    await h.settle(id);
    h.t.app.engine.reviewTask(h.floor, h.mgr, id, 'revise', 'Make the ball bigger');
    await until(() => texts.length === 2 && h.taskRow(id).status === 'review' && !h.t.app.engine.runs.size, { what: 'revision' });
    assert.match(texts[1], /ball bigger/);
    assert.equal(h.sessions.calls.sessions.length, 1);
  });
  test('a dropped stream reconnects with no lost or repeated events, and never double-charges', async () => {
    let dropped = false;
    const h = await start({ async onTurn(api) {
      for (let i = 0; i < 6; i++) { await api.step(); api.tool('bash', { command: 'npm run build' }); if (i === 2 && !dropped) { dropped = true; api.dropStreams(); await sleep(400); } }
      api.save([{ path: 'index.html', data: Buffer.from('x') }]);
      await api.message('finished');
    } });
    const row = await h.settle((await go(h)).id);
    assert.equal(row.status, 'review');
    assert.ok(h.sessions.calls.streams >= 2, `streams ${h.sessions.calls.streams}`);
    const modelRows = all(h.t.db, 'SELECT cost_usd FROM ledger WHERE floor_id=? AND prompt_tokens>0', h.floor.id).length;
    assert.ok(modelRows <= 6, `charged ${modelRows} of 6 model requests`);
    const total = get(h.t.db, 'SELECT SUM(cost_usd) n FROM ledger WHERE floor_id=?', h.floor.id).n;
    assert.ok(Math.abs(total - 0.12) < 0.07 || total >= 0.115, `total ${total}`);
  });
  test('a restart reattaches, answers a pending tool call, and does not start a second session', async () => {
    const { openDb } = await import('../server/db.js');
    assert.ok(openDb);
    const h = await start({ async onTurn(api) {
      await api.step();
      await api.custom('list_shared_files', {});
      await api.step();
      api.save([{ path: 'index.html', data: Buffer.from('x') }]);
      await api.message('finished');
    } });
    // Simulate the crash point directly: a session waiting on us, with a task back in the queue and no runner.
    const { id } = h.assign();
    const sess = await h.sessions.createSession({ agent: { id: 'x' }, resources: [] });
    run(h.t.db, "UPDATE tasks SET session_id=?, transcript=?, session_sent=0 WHERE id=?", sess.id, JSON.stringify([{ role: 'user', content: 'go' }]), id);
    const created = h.sessions.calls.sessions.length;
    h.t.app.engine.kick();
    const row = await h.settle(id);
    assert.equal(row.status, 'review');
    assert.equal(h.sessions.calls.sessions.length, created);
  });
  test('a lost container starts a fresh one, up to a limit, then pauses the floor visibly', async () => {
    let starts = 0;
    const h = await start({ async onTurn(api) { starts++; await api.step(); api.terminate(); } });
    const { id } = await go(h);
    await until(() => get(h.t.db, 'SELECT paused FROM floors WHERE id=?', h.floor.id).paused, { what: 'pause' });
    assert.ok(starts >= 2 && starts <= 4, `starts ${starts}`);
    assert.equal(h.taskRow(id).status, 'todo');
    assert.equal(h.t.app.engine.errors.length, 0);
  });
  test('a provider failure pauses the floor rather than looping', async () => {
    const h = await start({ async onTurn(api) { await api.step(); api.fail(); } });
    await go(h);
    await until(() => get(h.t.db, 'SELECT paused FROM floors WHERE id=?', h.floor.id).paused, { what: 'pause' });
    assert.match(get(h.t.db, 'SELECT pause_reason r FROM floors WHERE id=?', h.floor.id).r, /trouble/);
    assert.equal(h.sessions.calls.sessions.length, 1);
  });
  test('a refusal fails the task cleanly', async () => {
    const h = await start({ async onTurn(api) { await api.step(); api.refuse(); } });
    const row = await h.settle((await go(h)).id);
    assert.equal(row.status, 'failed'); assert.match(row.result, /declined/);
  });
  test('a call nobody can approve is declined and the agent carries on', async () => {
    const seen = {};
    const h = await start({ async onTurn(api) { await api.step(); seen.r = await api.ask('bash', { command: 'curl evil.example' }); api.save([{ path: 'index.html', data: Buffer.from('x') }]); await api.message('finished'); } });
    const row = await h.settle((await go(h)).id);
    assert.equal(seen.r, 'deny'); assert.equal(row.status, 'review');
  });
  test('roles without a computer keep the old loop, and it stays off unless enabled', async () => {
    const h = await start();
    const { id } = await go(h, 'Write a note', { to: 'writer', project: 'note' });
    const row = await h.settle(id);
    assert.equal(row.session_id, '');
    assert.equal(h.sessions.calls.sessions.length, 0);
    const off = await boot({ computerEnabled: false });
    open.push(off);
    assert.equal(off.app.engine.computer, null);
  });
  test('the tester uses Claude on its computer and cannot publish', async () => {
    const seen = {};
    const h = await start({ async onTurn(api) { await api.step(); seen.pub = await api.custom('publish_project', { title: 'x', kind: 'site' }); await api.message('Verdict: works'); } });
    h.t.app.engine.hireStaff(h.floor, 'tester', 'Tess');
    const row = await h.settle((await go(h, 'Test it', { to: 'tester' })).id);
    assert.equal(row.status, 'review');
    assert.match(seen.pub, /report back/);
    const def = h.sessions.calls.agents.find((a) => a.name === 'theoffice-tester');
    assert.equal(def.model.id, 'claude-opus-5-5');
    assert.ok(!def.tools.some((x) => x.name === 'publish_project'));
  });
});

describe('found in independent review', () => {
  test('a huge name in an archive is refused, and rejected names are never stored', async () => {
    const seen = {};
    const long = 'x/'.repeat(3000) + 'a.txt';
    const h = await start({ async onTurn(api, text) {
      await api.step();
      if (/did not go through/.test(text)) { seen.problem = text; api.save([{ path: 'index.html', data: Buffer.from('ok') }, { path: `bad${'y'.repeat(300)}.txt`, data: Buffer.from('n') }]); await api.message('d'); return; }
      api.save([{ path: long, data: Buffer.from('z') }]);
      await api.message('d');
    } });
    const row = await h.settle((await go(h)).id);
    assert.match(seen.problem, /name that is far too long/);
    assert.equal(row.status, 'review');
    assert.ok(row.session_baseline.length < 300, `baseline ${row.session_baseline.length}`);
    assert.ok(!row.session_baseline.includes('yyy'));
  });
  test('a visitor view never loads transcripts', async () => {
    const h = await start();
    const { id } = await go(h);
    await h.settle(id);
    run(h.t.db, 'UPDATE tasks SET transcript=? WHERE id=?', JSON.stringify([{ role: 'user', content: 'SECRET-TRANSCRIPT' }]), id);
    const v = new Client(h.t);
    assert.ok(!JSON.stringify((await v.get(`/api/floors/${h.c.slug}`)).data).includes('SECRET-TRANSCRIPT'));
  });
  test('a budget hold never stops a floor for the day; only spent money does', async () => {
    const h = await start({ async onTurn(api) { await api.step(); await sleep(120); api.save([{ path: 'index.html', data: Buffer.from('x') }]); await api.message('d'); } }, { floorDailyUsd: 2, globalDailyUsd: 25, sessionMaxUsd: 5, taskMaxUsd: 3 });
    h.t.app.engine.hireStaff(h.floor, 'tester', 'Tess');
    const a = (await go(h, 'one', { project: 'a' })).id;
    const b = (await go(h, 'two', { project: 'b', to: 'tester' })).id;
    const ra = await h.settle(a); const rb = await until(() => { const r = h.taskRow(b); return r.status === 'review' ? r : null; }, { what: 'second task', timeout: 12000 });
    assert.equal(ra.status, 'review'); assert.equal(rb.status, 'review');
    assert.equal(get(h.t.db, 'SELECT budget_notice_day d FROM floors WHERE id=?', h.floor.id).d, '');
    assert.ok(!all(h.t.db, "SELECT text FROM messages WHERE floor_id=? AND role='office'", h.floor.id).some((m) => /budget/i.test(m.text)));
    assert.equal((await floorState(h.c)).floor.budgetStopped, false);
  });
  test('a failed interrupt is retried, and the step limit still ends the run', async () => {
    let steps = 0;
    const sessions = createMockSessions({}, { async onTurn(api) { for (let i = 0; i < 2000; i++) { await api.step(); steps++; await sleep(2); } } });
    const realSend = sessions.send; let refused = 0;
    sessions.send = async (id, events) => { if (events[0].type === 'user.interrupt' && refused < 3) { refused++; throw new Error('flaky'); } return realSend(id, events); };
    const t = await boot({ computerEnabled: true, outputLagMs: 0, sessionMaxSteps: 10 }, { sessions });
    open.push(t); t.app.engine.runManager = async () => {};
    const c = await claim(t, 'Flaky Co');
    const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id);
    const { id } = t.app.engine.assignTask(floor, mgr, { to: 'builder', title: 'x', brief: 'y', plan: '', project: 'g', private: false, dependsOn: [] });
    t.app.engine.kick();
    const row = await until(() => { const r = get(t.db, 'SELECT * FROM tasks WHERE id=?', id); return r.status === 'failed' ? r : null; }, { what: 'fail', timeout: 8000 });
    assert.match(row.result, /Ran out of steps/);
    assert.ok(steps < 40, `steps ${steps}`);
  });
  test('an interrupt that is never honoured still ends the run after the grace period', async () => {
    const sessions = createMockSessions({}, { async onTurn(api) { for (let i = 0; i < 5000; i++) { api.session.interrupted = false; await api.step(); await sleep(2); } } });
    const t = await boot({ computerEnabled: true, outputLagMs: 0, sessionMaxSteps: 6 }, { sessions });
    open.push(t); t.app.engine.runManager = async () => {};
    t.app.engine.computer.stopGraceMs = 100;
    const c = await claim(t, 'Stubborn Co');
    const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id);
    const { id } = t.app.engine.assignTask(floor, mgr, { to: 'builder', title: 'x', brief: 'y', plan: '', project: 'g', private: false, dependsOn: [] });
    t.app.engine.kick();
    const row = await until(() => { const r = get(t.db, 'SELECT * FROM tasks WHERE id=?', id); return r.status === 'failed' && !t.app.engine.runs.size ? r : null; }, { what: 'give up', timeout: 12000 });
    assert.match(row.result, /Ran out of steps/);
  });
  test('a provider failure interrupts the session rather than leaving it spending', async () => {
    const h = await start({ async onTurn(api) { await api.step(); api.fail(); } });
    await go(h);
    await until(() => get(h.t.db, 'SELECT paused FROM floors WHERE id=?', h.floor.id).paused, { what: 'pause' });
    await until(() => h.sessions.calls.sends.some((s) => s.ev.type === 'user.interrupt'), { what: 'interrupt' });
  });
  test('a boot stops sessions on paused floors and bills them; stopping a queued task does too', async () => {
    const h = await start({ stepUsd: 0.5, async onTurn(api) { await api.step(); await sleep(5000); } });
    const { id } = await go(h);
    await until(() => h.sessions.calls.sends.some((s) => s.ev.type === 'user.message'), { what: 'start' });
    await sleep(30);
    h.t.app.engine.pauseFloor(h.floor.id);
    await until(() => h.taskRow(id).status === 'todo' && !h.t.app.engine.runs.size, { what: 'requeue' });
    const interrupts = () => h.sessions.calls.sends.filter((s) => s.ev.type === 'user.interrupt').length;
    const before = interrupts();
    h.t.app.engine.computer.recoverOrphans();
    await until(() => interrupts() > before, { what: 'orphan interrupt' });
    h.sessions.sessions.get(h.taskRow(id).session_id).spentUsd = 1.5;
    h.t.app.engine.stopFloor(h.floor.id);
    await until(() => h.taskRow(id).cost_usd >= 1.49, { what: 'orphan billed' });
    assert.equal(h.taskRow(id).status, 'cancelled');
  });
  test('reaching a daily cap, then the day rolling over, resumes the paused session by raising its cap', async () => {
    let finished = false;
    const h = await start({ stepUsd: 0.06, async onTurn(api) { for (let i = 0; i < 8; i++) await api.step(); api.save([{ path: 'index.html', data: Buffer.from('x') }]); finished = true; await api.message('done at last'); } }, { floorDailyUsd: 0.2, globalDailyUsd: 25 });
    const { id } = await go(h);
    await until(() => h.taskRow(id).status === 'todo' && h.taskRow(id).session_id && !h.t.app.engine.runs.size, { what: 'waiting for tomorrow' });
    assert.equal(finished, false);
    h.t.cfg.floorDailyUsd = 5;
    run(h.t.db, "UPDATE floors SET budget_notice_day='' WHERE id=?", h.floor.id);
    h.t.app.engine.kick();
    const row = await h.settle(id);
    assert.equal(row.status, 'review', row.result);
    assert.ok(finished);
    assert.equal(h.sessions.calls.sessions.length, 1);
    assert.ok(h.sessions.calls.updates.some((u) => u.params.budget));
  });
  test('a boss who answers while the turn is still wrapping up is not lost', async () => {
    const texts = []; let h;
    h = await start({ async onTurn(api, text) {
      texts.push(text);
      await api.step();
      if (texts.length === 1) {
        await api.custom('ask_boss', { question: 'Silly or serious?' });
        const q = get(h.t.db, 'SELECT id FROM questions WHERE floor_id=?', h.floor.id);
        assert.equal((await h.c.post(`/api/floors/${h.c.slug}/questions/${q.id}/answer`, { text: 'Silly please' })).status, 200);
        await api.message('waiting');
        return;
      }
      api.save([{ path: 'index.html', data: Buffer.from('x') }]);
      await api.message('finished');
    } });
    const row = await h.settle((await go(h)).id);
    assert.equal(row.status, 'review', row.result);
    assert.match(texts[1], /Silly please/);
  });
  test('Resume after repeated failures tries again instead of pausing forever', async () => {
    let turns = 0;
    const h = await start({ async onTurn(api) { turns++; await api.step(); if (turns === 1) api.fail(); api.save([{ path: 'index.html', data: Buffer.from('x') }]); await api.message('finished'); } });
    const { id } = await go(h);
    await until(() => get(h.t.db, 'SELECT paused FROM floors WHERE id=?', h.floor.id).paused && !h.t.app.engine.runs.size, { what: 'pause' });
    h.t.app.engine.resumeFloor(h.floor.id);
    const row = await h.settle(id);
    assert.equal(row.status, 'review', row.result);
    assert.equal(turns, 2);
  });
  test('a task that falls back to the old loop keeps its safety rules', async () => {
    const h = await start();
    const { id } = h.assign('Write', { to: 'writer', project: 'n' });
    run(h.t.db, 'UPDATE tasks SET transcript=? WHERE id=?', JSON.stringify([{ role: 'user', content: 'briefing' }]), id);
    let sys = null;
    const chat = h.t.app.engine.llm.chat;
    h.t.app.engine.llm.chat = (a) => { sys ??= a.messages[0]; return chat(a); };
    h.t.app.engine.kick();
    await h.settle(id);
    assert.equal(sys.role, 'system');
    assert.match(sys.content, /Security rules that always apply/);
  });
  test('files dropped from what is going live are reported to the agent', async () => {
    const seen = {};
    const h = await start({ async onTurn(api, text) {
      await api.step();
      if (/did not go through/.test(text)) { seen.problem = text; return; }
      await api.custom('publish_project', { title: 'x', kind: 'game', directory: 'dist' });
      api.save([{ path: 'dist/index.html', data: Buffer.from('x') }, { path: 'dist/level.unknownext', data: Buffer.from('x') }, { path: 'dist/a/b/c/d/e/f/deep.glb', data: Buffer.from('x') }]);
      await api.message('d');
    } });
    await h.settle((await go(h)).id);
    assert.match(seen.problem, /level\.unknownext/);
    assert.ok(!seen.problem.includes('deep.glb'), 'deep real-build paths are fine');
    assert.ok(get(h.t.db, "SELECT 1 x FROM published_files WHERE floor_id=? AND path='a/b/c/d/e/f/deep.glb'", h.floor.id));
  });
});
