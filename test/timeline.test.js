// The Timeline's photos (docs/redesign, job 13): at most one per job step and four per job, of the project's public page, taken by the
// Tier 0 camera, never a model. The job card carries the newest as its thumbnail. Mock mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client, floorState, until } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { queueJobShot, takeJobShots, MAX_JOB_SHOTS } from '../server/shots.js';
import { findChrome, startChrome } from '../scripts/chrome.mjs';

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(800, 3), Buffer.from([0xff, 0xd9])]);
const fake = () => { const seen = []; return { seen, async shoot(u) { seen.push(u); return jpeg(); }, close() {} }; };
function setup(t, floorId, { priv = 0 } = {}) {
  const now = Date.now();
  run(t.db, 'INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,?,?,?,?,?,?)', floorId, 'game', 'The Game', 'game', priv, now, now);
  const html = '<!doctype html><title>g</title><body style="background:#17766F">game</body>';
  run(t.db, "INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?,'game','index.html',?,?)", floorId, html, html.length);
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(Number(run(t.db, "INSERT INTO tasks (floor_id,title,plan,project,status,created_at,updated_at) VALUES (?,?,'Make the game better','game','todo',?,?)", floorId, `Step ${i + 1}`, now, now).lastInsertRowid));
  return ids;
}

describe('step photos', () => {
  test('one per step, four per job, only of a public page that is up; the newest is the card\'s thumbnail', async () => {
    const t = await boot({ shotsNudgeMs: 1e9 });
    try {
      const c = await claim(t, 'Photo Steps');
      const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      const ids = setup(t, f.id);
      for (const id of ids) { run(t.db, "UPDATE tasks SET status='done' WHERE id=?", id); t.app.engine.emitTask(id); t.app.engine.emitTask(id); }
      const card = get(t.db, 'SELECT * FROM job_cards WHERE floor_id=?', f.id);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM job_cards WHERE floor_id=?', f.id).n, 1, 'one job');
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM job_shots WHERE card_id=?', card.id).n, MAX_JOB_SHOTS, 'four at most, one per step');
      assert.equal(queueJobShot(t.db, { floorId: f.id, cardId: card.id, step: 'task:999', project: 'game' }), false);
      const shooter = fake();
      const changed = await takeJobShots(t.db, t.cfg, { shooter, origin: 'http://example.test' });
      assert.equal(changed.length, 4); assert.equal(shooter.seen.length, 4);
      const after = get(t.db, 'SELECT thumb FROM job_cards WHERE id=?', card.id).thumb;
      assert.ok(after);
      // The card says where to find it, and both the boss and a visitor may have it: the work is public.
      const v = await floorState(new Client(t), c.slug);
      assert.match(v.jobs[0].thumb, new RegExp(`/theoffice/api/floors/${c.slug}/jobshot/${after}$`));
      const img = await new Client(t).raw('GET', `/api/floors/${c.slug}/jobshot/${after}`);
      assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
      // Made private later: a visitor no longer gets it, the boss does.
      run(t.db, "UPDATE projects SET private=1 WHERE floor_id=? AND slug='game'", f.id);
      assert.equal((await new Client(t).raw('GET', `/api/floors/${c.slug}/jobshot/${after}`)).status, 404);
      assert.equal((await c.raw('GET', `/api/floors/${c.slug}/jobshot/${after}`)).status, 200);
      assert.equal((await floorState(new Client(t), c.slug)).jobs[0].thumb, null);
    } finally { await t.close(); }
  });
  test('nothing is queued for private work or a page that isn\'t up', async () => {
    const t = await boot({ shotsNudgeMs: 1e9 });
    try {
      const c = await claim(t, 'Hidden Steps');
      const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      const ids = setup(t, f.id, { priv: 1 });
      run(t.db, "UPDATE tasks SET status='done' WHERE id=?", ids[0]); t.app.engine.emitTask(ids[0]);
      run(t.db, "INSERT INTO tasks (floor_id,title,project,status,created_at,updated_at) VALUES (?,'Draft','unpublished','done',?,?)", f.id, Date.now(), Date.now());
      t.app.engine.emitTask(Number(get(t.db, 'SELECT MAX(id) n FROM tasks').n));
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM job_shots').n, 0);
    } finally { await t.close(); }
  });
  test('going live gets a photo by itself, through the server\'s own camera', { skip: !findChrome() && 'no Chromium on this machine' }, async () => {
    const chrome = await startChrome();
    const t = await boot({ shotsNudgeMs: 20, shotsCdpUrl: chrome.cdpUrl });
    try {
      const c = await claim(t, 'Live Steps');
      const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      const ids = setup(t, f.id);
      run(t.db, "UPDATE tasks SET status='doing' WHERE id=?", ids[0]); t.app.engine.emitTask(ids[0]);
      t.app.engine.emitProject(f.id, 'game');
      await until(() => get(t.db, 'SELECT thumb FROM job_cards WHERE floor_id=?', f.id)?.thumb, { what: 'the photo of the live page', timeout: 30000 });
      const shot = get(t.db, 'SELECT bytes, step FROM job_shots WHERE floor_id=?', f.id);
      assert.match(shot.step, /^publish:/); assert.ok(shot.bytes > 500);
    } finally { await t.close(); chrome.stop(); }
  });
});

describe('the Timeline tab', () => {
  test('replaces Talk, reads job cards, keeps the boss\'s conversation and leaves bean-to-bean talk out; a new card slides in, respecting reduce motion', () => {
    const ui = readFileSync(new URL('../public/js/floor-ui.js', import.meta.url), 'utf8');
    const tl = readFileSync(new URL('../public/js/timeline-ui.js', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../public/css/skin.css', import.meta.url), 'utf8');
    assert.match(ui, /\['talk', this\.timelineOn \? 'Timeline' : 'Talk'\]/);
    assert.match(ui, /if \(this\.timelineOn\) return;\s+\/\/ bean-to-bean lines are not on the timeline/);
    assert.match(tl, /m\.role === 'boss' \|\| m\.role === 'manager'/);
    assert.match(tl, /Just moved in\. First job starts soon\./);
    assert.match(css, /\.tl-new \{ animation: tl-in/);
    assert.match(css, /prefers-reduced-motion: reduce\) \{ \.tl-new \{ animation: none; \}/);
  });
});
