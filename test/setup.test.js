// The full-screen Setup's one server-side need: the company's name, typed by the boss, saved through the manager's own set_company before any work starts. Mock models throughout.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, floorState, Client } from './helpers.js';
import { get, all } from '../server/db.js';

const fresh = async (t) => {
  const c = new Client(t);
  const r = await c.post('/api/claim', { code: t.code() });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.csrf = r.data.csrf; c.slug = r.data.slug;
  assert.equal((await floorState(c)).floor.setup, true, 'a code alone gives a floor with no name');
  return c;
};
const go = { type: 'game', idea: '', name: 'Moth Patrol', pitch: 'Moths guard the porch light.', goal: 'Win the night', plan: ['One', 'Two', 'Three'] };
const row = (t, id) => get(t.db, 'SELECT * FROM floors WHERE id=?', id);
const idOf = (t, slug) => get(t.db, 'SELECT id FROM floors WHERE slug=?', slug).id;
const jobs = (t, id) => all(t.db, 'SELECT * FROM maker_jobs WHERE floor_id=?', id);

describe('the company name from Setup', () => {
  let t;
  before(async () => { t = await boot({ peopleTalk: false }); });
  after(async () => { await t.close(); });

  test('/makers/start names a nameless floor first, and the feed says it opened', async () => {
    const c = await fresh(t); const id = idOf(t, c.slug);
    const r = await c.post(`/api/floors/${c.slug}/makers/start`, { ...go, company: 'Porch Light Games' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(row(t, id).name, 'Porch Light Games');
    assert.equal(jobs(t, id)[0].title, 'Moth Patrol', 'the name it makes stays separate from the company');
    assert.ok(all(t.db, 'SELECT * FROM events WHERE floor_id=?', id).some((x) => /Porch Light Games opened its doors/.test(JSON.stringify(x))), 'the same route the manager uses: the feed line');
    const after = await floorState(c);
    assert.equal(after.floor.setup, false);
    assert.equal(after.floor.name, 'Porch Light Games');
  });

  test('a one-letter company starts nothing and leaves the floor as it was', async () => {
    const c = await fresh(t); const id = idOf(t, c.slug);
    const r = await c.post(`/api/floors/${c.slug}/makers/start`, { ...go, company: 'A' });
    assert.equal(r.status, 400);
    assert.match(r.data.message || r.data.error, /2 characters/);
    assert.equal(row(t, id).name, '');
    assert.equal(jobs(t, id).length, 0);
    assert.equal((await floorState(c)).floor.setup, true);
  });

  test('without a company name the floor is named after what it makes, as before', async () => {
    const c = await fresh(t); const id = idOf(t, c.slug);
    const r = await c.post(`/api/floors/${c.slug}/makers/start`, { ...go, name: 'Frog Post' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(row(t, id).name, 'Frog Post');
  });

  test('a floor that has a name keeps it, whatever comes with the start', async () => {
    const c = await claim(t, 'Already Named Ltd'); const id = idOf(t, c.slug);
    const r = await c.post(`/api/floors/${c.slug}/makers/start`, { ...go, company: 'Something Else' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(row(t, id).name, 'Already Named Ltd');
  });

  test('/business/start names a nameless floor first, and a bad name starts nothing', async () => {
    const c = await fresh(t); const id = idOf(t, c.slug);
    const bad = await c.post(`/api/floors/${c.slug}/business/start`, { wish: 'Dog walks: walks, for dogs', company: 'X' });
    assert.equal(bad.status, 400);
    assert.equal(row(t, id).name, '');
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM business_journeys WHERE floor_id=?', id).n, 0);
    const r = await c.post(`/api/floors/${c.slug}/business/start`, { wish: 'Dog walks: walks, for dogs', company: 'Good Dog Co' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(row(t, id).name, 'Good Dog Co');
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM business_journeys WHERE floor_id=?', id).n, 1);
  });

  test('/business/start without a company leaves the naming to the manager, as before', async () => {
    const c = await fresh(t); const id = idOf(t, c.slug);
    const r = await c.post(`/api/floors/${c.slug}/business/start`, { wish: 'Dog walks' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(row(t, id).name, '');
  });
});
