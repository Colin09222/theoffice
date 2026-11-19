// The smoke check and the Tester skip (server/smoke.js; redesign job 11). After a publish a script opens the live page: it loads, no console errors, and a
// screenshot is saved to the job. An edit to a live site ships on that check alone, with no Tester call; an edit touching checkout, forms or sign-in gets
// one Tester pass; the Tester gets a computer only for games and shops.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, until } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { toolsForRole } from '../server/tools.js';
import { readFile } from '../server/workspace.js';
import { smokeCheck, loadPlaywright, touchesSensitive, testerNeedsComputer } from '../server/smoke.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });
const LINES = ['The new opening days show in the footer', 'Nothing else on the page changed', 'It fits a phone'];
const PAGE = (body, script = '') => `<!doctype html><html><head><title>Lens</title></head><body><h1>${body}</h1>${script}</body></html>`;

/** A Builder that writes the page and publishes it; a Tester that is counted. */
function scripted(page = PAGE('Open Tuesday to Sunday')) {
  const calls = [];
  return { calls, chat: async (a) => {
    calls.push(a);
    if (a.meta.kind === 'staff' && a.meta.role === 'builder' && a.meta.step === 0) return { content: '', toolCalls: [{ id: 'w', name: 'write_file', args: JSON.stringify({ path: 'projects/site/index.html', content: page }) }, { id: 'p', name: 'publish_project', args: JSON.stringify({ project: 'site', title: 'Lens Studio' }) }], finish: 'stop', usage: { prompt: 1, completion: 1, cost: 0.001, real: true } };
    a.onToken?.('Done.');
    return { content: 'Done.', toolCalls: [], finish: 'stop', usage: { prompt: 1, completion: 1, cost: 0.001, real: true } };
  } };
}
async function floor(llm, overrides = {}) {
  const t = await boot({ peopleTalk: false, staffSelfCheck: false, shipCheck: false, ...overrides }, { llm });
  open.push(t);
  const c = await claim(t, `Smoke ${open.length}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  const e = t.app.engine;
  e.runManager = async () => {};
  if (!get(t.db, "SELECT 1 x FROM agents WHERE floor_id=? AND role='tester'", f.id)) e.hireStaff(f, 'tester');
  // The site is already live: this is an edit to it.
  run(t.db, "INSERT INTO projects (floor_id,slug,title,created_at,published_at) VALUES (?, 'site', 'Lens Studio', ?, ?)", f.id, Date.now(), Date.now());
  run(t.db, "INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?, 'site', 'index.html', ?, 40)", f.id, PAGE('Open Monday to Friday'));
  const tool = (name, args) => e.tools.exec(e.toolCtx(f, mgr, null, toolsForRole('manager')), name, JSON.stringify(args));
  const task = (id) => get(t.db, 'SELECT * FROM tasks WHERE id=?', id);
  const testerCalls = () => llm.calls.filter((x) => x.meta.kind === 'staff' && x.meta.role === 'tester').length;
  return { t, f, e, tool, task, testerCalls, db: t.db };
}
const idOf = (out) => Number(/#(\d+)/.exec(out)?.[1]);

describe('the smoke check', () => {
  test('an edit to a live site ships with a script check and no Tester call', async () => {
    const h = await floor(scripted(), { smokeBrowser: false });
    const id = idOf(await h.tool('assign_task', { to: 'builder', title: 'Change the opening days', brief: 'Change the footer to say Open Tuesday to Sunday and publish it again.', plan: 'Number', project: 'site', size: 'small', checks: LINES, intent: 'new number' }));
    assert.ok(id);
    assert.match(await h.tool('assign_task', { to: 'tester', title: 'Check the number', brief: 'Check it.', plan: 'Number', project: 'site', depends_on: [id], intent: 'new number' }), /no Tester follows it/);
    await until(() => h.task(id).status === 'review', { what: 'the edit' });
    await h.e.smoking;
    const s = get(h.db, 'SELECT * FROM smoke_checks WHERE task_id=?', id);
    assert.ok(s, `a smoke check ran after the publish: ${JSON.stringify(JSON.parse(h.task(id).transcript || '[]').filter((m) => m.role === 'tool').map((m) => String(m.content).slice(0, 200)))} ${JSON.stringify(all(h.db, 'SELECT task_id FROM smoke_checks'))}`);
    assert.equal(s.ok, 1); assert.equal(s.how, 'http'); assert.equal(s.status, 200); assert.deepEqual(JSON.parse(s.errors), []);
    assert.equal(h.task(id).smoke_id, s.id, 'the job can find it');
    assert.equal(h.testerCalls(), 0, 'no Tester call');
    assert.equal(get(h.db, "SELECT COUNT(*) n FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND a.role='tester'", h.f.id).n, 0);
  });

  test('in a real browser it catches a console error and saves a 16:10 screenshot to the job', async (t) => {
    if (!(await loadPlaywright())) { t.skip('no Playwright on this machine'); return; }
    const h = await floor(scripted(PAGE('Broken', '<script>window.notAThing.go()</script>')));
    const id = idOf(await h.tool('assign_task', { to: 'builder', title: 'Swap the photo', brief: 'Swap the hero photo and publish it again.', plan: 'Photo', project: 'site', size: 'small', checks: LINES, intent: 'new photo' }));
    await until(() => get(h.db, 'SELECT 1 x FROM smoke_checks WHERE task_id=?', id), { what: 'the smoke check', timeout: 60000 });
    const s = get(h.db, 'SELECT * FROM smoke_checks WHERE task_id=?', id);
    assert.equal(s.how, 'browser'); assert.equal(s.ok, 0); assert.match(JSON.parse(s.errors)[0], /reading 'go'|notAThing/);
    assert.equal(s.shot_path, `projects/site/notes/shots/smoke-${id}.jpg`);
    const shot = readFile(h.db, h.f.id, s.shot_path);
    assert.ok(shot, 'the screenshot is on the floor\'s drive');
    await until(() => all(h.db, "SELECT text FROM messages WHERE floor_id=? AND role='note'", h.f.id).some((m) => /smoke check on site after it went live found a problem/.test(m.text)), { what: 'the manager to be told' });
  });

  test('without a browser: a missing script fails, a fine page passes', async () => {
    const pages = {
      '/ok/': PAGE('fine', '<script>var a = 1;</script>'),
      '/missing/': PAGE('x', '<script src="app.js"></script>'),
      '/bad/': PAGE('x', '<script>function (</script>'),
    };
    const fake = async (url) => { const u = new URL(url); const body = pages[u.pathname]; return new Response(body ?? 'nope', { status: body ? 200 : 404, headers: { 'content-type': 'text/html' } }); };
    const ok = await smokeCheck('http://x/ok/', { useBrowser: false, httpFetch: fake });
    assert.equal(ok.ok, true);
    const missing = await smokeCheck('http://x/missing/', { useBrowser: false, httpFetch: fake });
    assert.equal(missing.ok, false); assert.match(missing.errors[0], /app\.js answered 404/);
    const gone = await smokeCheck('http://x/nothing/', { useBrowser: false, httpFetch: fake });
    assert.equal(gone.ok, false); assert.match(gone.errors[0], /answered 404/);
  });

  test('an edit that touches a form gets one Tester pass, and only one', async () => {
    const h = await floor(scripted(), { smokeBrowser: false });
    run(h.db, 'UPDATE floors SET paused=1 WHERE id=?', h.f.id);
    const id = idOf(await h.tool('assign_task', { to: 'builder', title: 'Add a field to the booking form', brief: 'Add a date field to the booking form.', plan: 'Form', project: 'site', size: 'small', checks: LINES, intent: 'date field' }));
    assert.match(await h.tool('assign_task', { to: 'tester', title: 'Test the form', brief: 'Test it.', plan: 'Form', project: 'site', depends_on: [id], intent: 'date field' }), /assigned/);
    assert.match(await h.tool('assign_task', { to: 'tester', title: 'Test the form again', brief: 'Test it.', plan: 'Form', project: 'site', depends_on: [id], intent: 'date field' }), /no Tester follows it/);
    assert.equal(touchesSensitive({ title: 'Swap the logo' }), false);
    assert.equal(touchesSensitive({ brief: 'fix the checkout button' }), true);
  });

  test('the Tester gets a computer only for games and shops', async () => {
    const h = await floor(scripted());
    const mk = (lane, project) => ({ floor_id: h.f.id, lane, project });
    assert.equal(testerNeedsComputer(h.db, mk('game', 'g')), true);
    assert.equal(testerNeedsComputer(h.db, mk('shop', 's')), true);
    assert.equal(testerNeedsComputer(h.db, mk('website', 'site')), false);
    run(h.db, "INSERT INTO projects (floor_id,slug,title,kind,created_at) VALUES (?, 'loop', 'Loopling', 'game', 1)", h.f.id);
    assert.equal(testerNeedsComputer(h.db, mk('', 'loop')), true, 'a project that is a game');
    h.e.computer = { handles: () => true };
    const tester = get(h.db, "SELECT * FROM agents WHERE floor_id=? AND role='tester'", h.f.id), builder = get(h.db, "SELECT * FROM agents WHERE floor_id=? AND role='builder'", h.f.id);
    assert.equal(h.e.onComputer(tester, h.f.id, mk('website', 'site')), false);
    assert.equal(h.e.onComputer(tester, h.f.id, mk('game', 'g')), true);
    assert.equal(h.e.onComputer(builder, h.f.id, mk('website', 'site')), true, 'the Builder keeps its computer');
    h.t.cfg.testerComputerGamesShops = false;
    assert.equal(h.e.onComputer(tester, h.f.id, mk('website', 'site')), true, 'switched off: as before');
    h.e.computer = null;
  });
});
