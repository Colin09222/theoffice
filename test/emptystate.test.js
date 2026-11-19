// Empty states for a floor with no job cards (docs/redesign, job 32). "Just moved in. First job starts soon." is only for a floor that is
// genuinely new: never launched anything, never finished a task. A floor with a past but no job cards (its work was done before job cards
// existed) says when its last job finished; with nothing to show at all, that the timeline is empty. The Timeline (phone and desktop) and
// the status card say the same. Mock mode.
//
// The live case: LabStackr, floor 3, open for weeks, with launches, showed "Just moved in" on its phone Timeline after the deploy, because
// job cards only start with tasks changed after it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client, floorState } from './helpers.js';
import { get, run } from '../server/db.js';
import { emptyLine } from '../public/js/timeline-ui.js';

const DAY = 864e5;
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
/** A task finished `days` ago, written straight to the table the way the engine left it before job cards existed: no card. */
const oldTask = (t, f, title, days, project = '') => run(t.db, "INSERT INTO tasks (floor_id,title,plan,project,status,lane,created_at,updated_at) VALUES (?,?,'',?,'done','website',?,?)", f.id, title, project, Date.now() - (days + 1) * DAY, Date.now() - days * DAY);
const launch = (t, f, slug, days, priv = 0) => run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,?,?,'site',?,?,?)", f.id, slug, `${slug} title`, priv, Date.now() - days * DAY, Date.now() - (days + 3) * DAY);

describe('the live case: LabStackr', () => {
  test('a floor open for weeks, with launches and finished work but no job cards, is not "just moved in": it says when its last job finished', async () => {
    const t = await boot({ towerFloors: 30 });
    try {
      const c = await claim(t, 'LabStackr', { floor: 3 }); const f = floorOf(t, c);
      launch(t, f, 'lab-notes', 20); launch(t, f, 'stack-viewer', 12);
      oldTask(t, f, 'Write the release notes', 9, 'stack-viewer'); oldTask(t, f, 'Fix the chart labels', 8, 'stack-viewer');
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM job_cards WHERE floor_id=?', f.id).n, 0, 'no job cards, as on live');
      for (const v of [await floorState(new Client(t), c.slug), await floorState(c)]) {
        assert.equal(v.status.isNew, false);
        assert.ok(Math.abs(v.status.lastFinished - (Date.now() - 8 * DAY)) < 60e3, `the last finished task, 8 days ago: ${v.status.lastFinished}`);
        assert.deepEqual(v.jobs || [], []);
        assert.equal(emptyLine(v.status), 'Last job finished 8d ago.');
      }
    } finally { await t.close(); }
  });
});

describe('which empty state', () => {
  test('a genuinely new floor: just moved in', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Brand New Co');
      const v = await floorState(new Client(t), c.slug);
      assert.equal(v.status.isNew, true); assert.equal(v.status.lastFinished, null);
      assert.equal(emptyLine(v.status), 'Just moved in. First job starts soon.');
    } finally { await t.close(); }
  });
  test('a launch alone, or one finished task alone, makes a floor established', async () => {
    const t = await boot();
    try {
      const a = await claim(t, 'Launched Once'); launch(t, floorOf(t, a), 'only-thing', 5);
      const b = await claim(t, 'Did One Thing'); oldTask(t, floorOf(t, b), 'A small job', 3);
      for (const c of [a, b]) {
        const v = await floorState(new Client(t), c.slug);
        assert.equal(v.status.isNew, false, c.slug);
        assert.match(emptyLine(v.status), /^Last job finished \dd ago\.$/);
      }
    } finally { await t.close(); }
  });
  test('a visitor never learns of private work: an established floor whose only work is private says the timeline is empty', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Hush Co'); const f = floorOf(t, c);
      launch(t, f, 'hidden', 4, 1); oldTask(t, f, 'Secret task', 2, 'hidden');
      const v = await floorState(new Client(t), c.slug);
      assert.equal(v.status.isNew, false); assert.equal(v.status.lastFinished, null);
      assert.equal(emptyLine(v.status), 'Nothing on the timeline yet.');
      const boss = await floorState(c);
      assert.match(emptyLine(boss.status), /^Last job finished 2d ago\.$/, 'the boss sees their own');
    } finally { await t.close(); }
  });
  test('the empty line itself', () => {
    assert.equal(emptyLine({ isNew: true, lastFinished: null }), 'Just moved in. First job starts soon.');
    assert.equal(emptyLine({ isNew: false, lastFinished: Date.now() - 8 * DAY }), 'Last job finished 8d ago.');
    assert.equal(emptyLine({ isNew: false, lastFinished: Date.now() - 2 * 3600e3 }), 'Last job finished 2h ago.');
    assert.equal(emptyLine({ isNew: false, lastFinished: null }), 'Nothing on the timeline yet.');
    assert.equal(emptyLine(undefined), 'Nothing on the timeline yet.');
  });
});

describe('the same words everywhere', () => {
  test('the Timeline (phone page and desktop tab alike) and the status card both use the one empty line', () => {
    const tl = readFileSync(new URL('../public/js/timeline-ui.js', import.meta.url), 'utf8');
    const card = readFileSync(new URL('../public/js/status-card.js', import.meta.url), 'utf8');
    const lite = readFileSync(new URL('../public/js/floor-lite.js', import.meta.url), 'utf8');
    const ui = readFileSync(new URL('../public/js/floor-ui.js', import.meta.url), 'utf8');
    assert.match(tl, /if \(!items\.length\) list\.append\(h\('li\.empty', \{\}, emptyLine\(F\.state\.status\)\)\);/);
    assert.match(card, /nothingYet \? h\('p\.stc-empty', \{\}, emptyLine\(st\)\)/);
    assert.equal((tl + card).match(/'Just moved in\./g).length, 1, 'the words live in one place');
    assert.match(lite, /renderTimeline\(p\)/); assert.match(ui, /renderTimeline\(this\)/);
  });
  test('Happening now on the home page takes "last job finished" from the same rows', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'LabStackr'); const f = floorOf(t, c);
      launch(t, f, 'lab-notes', 20); oldTask(t, f, 'Fix the chart labels', 8, 'lab-notes');
      const d = (await new Client(t).get('/api/building/now')).data;
      assert.deepEqual(d.items, []);
      assert.equal(d.lastFinished, (await floorState(new Client(t), c.slug)).status.lastFinished);
    } finally { await t.close(); }
  });
});
