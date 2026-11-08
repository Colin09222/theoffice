// The automatic check on the live link right after Launch: saves and the leaderboard through Office Cloud, and what happens when they fail.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { boot, claim, floorState, until } from './helpers.js';
import { get, all } from '../server/db.js';
import { writeFile, publishSnapshot } from '../server/workspace.js';
import { appLabel } from '../server/apps.js';
import { checkLive } from '../server/live-check.js';
import { starterFiles } from '../server/makers.js';

const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

describe('checkLive against a real project origin', () => {
  let t, c, port, floor;
  before(async () => {
    port = await freePort();
    t = await boot({ appsBaseDomain: `apps.localhost:${port}`, appsScheme: 'http' });
    await new Promise((r) => t.app.server.close(r));
    await new Promise((r) => t.app.server.listen(port, '127.0.0.1', r));
    t.base = `http://localhost:${port}/theoffice`; t.host = `localhost:${port}`; t.cfg.publicOrigin = `http://localhost:${port}`;
    c = await claim(t, 'Live Co');
    floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  });
  after(() => t.close());
  const publish = (slug, files) => {
    t.db.prepare('INSERT OR IGNORE INTO projects (floor_id,slug,title,created_at) VALUES (?,?,?,?)').run(floor.id, slug, slug, Date.now());
    for (const f of files) writeFile(t.db, floor.id, `projects/${slug}/${f.path}`, f.data, null, t.cfg.quotaBytes);
    publishSnapshot(t.db, floor.id, slug, t.cfg.quotaBytes);
    t.db.prepare('UPDATE projects SET published_at=? WHERE floor_id=? AND slug=?').run(Date.now(), floor.id, slug);
    return { url: `http://${appLabel(t.db, floor, slug)}.apps.localhost:${port}/`, files: files.map((f) => ({ path: f.path, data: f.data })) };
  };
  test('a starter game passes: the page, a save written and read back, and a score on the board', async () => {
    const g = publish('real-game', starterFiles('game-2d').map((f) => ({ path: f.path, data: f.data.replaceAll('{{TITLE}}', 'T').replaceAll('{{PITCH}}', 'P') })));
    const r = await checkLive({ url: g.url, type: 'game', files: g.files });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.checked, ['page', 'saves', 'leaderboard']);
    const row = get(t.db, "SELECT COUNT(*) n FROM cloud_scores WHERE floor_id=? AND project='real-game' AND board='_office-check'", floor.id);
    assert.equal(row.n, 1, 'the score went on the check board, nowhere a player sees');
    assert.equal(get(t.db, "SELECT COUNT(*) n FROM cloud_scores WHERE floor_id=? AND project='real-game' AND board='main'", floor.id).n, 0);
    assert.equal(get(t.db, "SELECT COUNT(*) n FROM cloud_saves WHERE floor_id=? AND project='real-game' AND key='_office_check'", floor.id).n, 0, 'the save was cleaned up');
  });
  test('a game that never calls saves or the leaderboard fails', async () => {
    const page = '<!doctype html><html lang="en"><title>x</title><meta name="description" content="d"><script src="/_office/office.js"></script></html>';
    const g = publish('no-saves', [{ path: 'index.html', data: page }, { path: 'game.js', data: 'console.log(1)' }]);
    const r = await checkLive({ url: g.url, type: 'game', files: g.files });
    assert.equal(r.ok, false); assert.match(r.problem, /never saves/);
  });
  test('a missing page and an unreachable link read differently', async () => {
    const r = await checkLive({ url: `http://nobody--here.apps.localhost:${port}/`, type: 'game', files: [], tries: 1 });
    assert.equal(r.ok, false, JSON.stringify(r)); assert.match(r.problem, /404/);
    const gone = await checkLive({ url: 'http://127.0.0.1:1/', type: 'game', files: [], tries: 1 });
    assert.equal(gone.ok, null); assert.match(gone.why, /couldn't be reached/);
  });
  test('a website only needs its page', async () => {
    const g = publish('plain-site', [{ path: 'index.html', data: '<!doctype html><html lang="en"><title>x</title><meta name="description" content="d"></html>' }]);
    assert.deepEqual(await checkLive({ url: g.url, type: 'website', files: g.files }), { ok: true, checked: ['page'] });
  });
});

describe('after Launch', () => {
  const job = (c) => floorState(c).then((s) => s.makers?.job);
  const until_ = (c, fn, what) => until(async () => { const j = await job(c); return j && fn(j) ? j : null; }, { what, timeout: 25000 });
  const fixTasks = (t, c) => get(t.db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=(SELECT id FROM floors WHERE slug=?) AND title LIKE 'Fix the serious bugs%'", c.slug).n;
  const go = async (c) => { assert.equal((await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'website', name: 'Cloud Site', pitch: 'A good site [full]' })).status, 200); await until_(c, (j) => j.stage === 'ready', 'ready'); };

  test('a failed check goes to the team as a major bug, and the fix is re-checked', async () => {
    const calls = [];
    const t = await boot({ appsBaseDomain: 'apps.localhost:1', appsScheme: 'http', liveCheckDelayMs: 5, liveCheckFn: async (a) => { calls.push(a); return calls.length === 1 ? { ok: false, problem: 'saving progress failed on the live link (403)' } : { ok: true, checked: ['page'] }; } });
    try {
      const c = await claim(t, 'Check Co'); await go(c);
      const launched = await c.post(`/api/floors/${c.slug}/makers/launch`, {});
      assert.equal(launched.status, 200, JSON.stringify(launched.data));
      await until_(c, (j) => j.liveCheck?.ok === false || fixTasks(t, c) > 0 || j.stage !== 'ready', 'the check');
      await until_(c, (j) => j.liveCheck?.ok === true, 'the re-check after the fix');
      assert.equal(calls.length, 2); assert.equal(fixTasks(t, c), 1);
      const s = await floorState(c);
      assert.ok(s.messages.some((m) => /live check on Cloud Site found a problem/.test(m.text)));
      const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
      const brief = get(t.db, "SELECT brief FROM tasks WHERE floor_id=? AND title LIKE 'Fix the serious bugs%'", fid).brief;
      assert.match(brief, /\[major\] The live link check failed: saving progress failed/);
    } finally { await t.close(); }
  });

  test('a check that keeps failing stops after two fixes and tells the boss, and live stays up', async () => {
    const t = await boot({ appsBaseDomain: 'apps.localhost:1', appsScheme: 'http', liveCheckDelayMs: 5, liveCheckFn: async () => ({ ok: false, problem: 'no leaderboard' }) });
    try {
      const c = await claim(t, 'Stuck Co'); await go(c);
      assert.equal((await c.post(`/api/floors/${c.slug}/makers/launch`, {})).status, 200);
      await until(async () => { const s = await floorState(c); return s.messages.some((m) => /still has a problem after two fixes/.test(m.text)) ? s : null; }, { what: 'the boss being told', timeout: 25000 });
      assert.equal(fixTasks(t, c), 2);
      assert.equal(get(t.db, 'SELECT launched_at a FROM maker_jobs').a > 0, true);
    } finally { await t.close(); }
  });

  test('a server with no project addresses, or a link it can\'t reach, makes no bug', async () => {
    const t = await boot({ liveCheckDelayMs: 5 });
    try {
      const c = await claim(t, 'Plain Co'); await go(c);
      assert.equal((await c.post(`/api/floors/${c.slug}/makers/launch`, {})).status, 200);
      await new Promise((r) => setTimeout(r, 400));
      const st = JSON.parse(get(t.db, 'SELECT state FROM maker_jobs').state);
      assert.equal(st.liveCheck.ok, null); assert.ok(!st.liveBugs?.length); assert.equal(fixTasks(t, c), 0);
    } finally { await t.close(); }
  });
});
