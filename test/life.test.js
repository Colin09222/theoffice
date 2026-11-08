// Building life: hidden floors stay out of the lobby but open by their own link, launch parties, and the leaderboard.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, claim, Client, waitDone } from './helpers.js';
import { openDb, run, get, all } from '../server/db.js';
import { loadSession } from '../server/auth.js';
import { pickParties, PARTY } from '../server/life.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('hidden floors', () => {
  let t, visitor, shown, secret;
  before(async () => {
    t = await boot();
    visitor = new Client(t, { origin: null });
    shown = await claim(t, 'Open House');
    secret = await claim(t, 'Back Room');
    await shown.post(`/api/floors/${shown.slug}/chat`, { text: 'go build midnight rolls' });
    await secret.post(`/api/floors/${secret.slug}/chat`, { text: 'go build quiet rolls' });
    await waitDone(shown); await waitDone(secret);
    run(t.db, 'UPDATE floors SET hidden=1 WHERE slug=?', secret.slug);
    await new Promise((r) => setTimeout(r, 5100));  // past the ticker's short cache
  });
  after(async () => { await t.close(); });

  test('a hidden floor drops out of the directory, lift, ticker and launched wall, and its number is not offered', async () => {
    const floors = (await visitor.get('/api/floors')).data;
    assert.deepEqual(floors.floors.map((f) => f.slug), [shown.slug]);
    assert.notEqual(floors.vacant, secret.number, 'the hidden floor is still taken');
    const lobby = JSON.stringify([(await visitor.get('/api/building/ticker?limit=60')).data, (await visitor.get('/api/building/launched')).data]);
    assert.ok(lobby.includes(shown.slug));
    assert.ok(!lobby.includes(secret.slug) && !lobby.includes('Back Room'), 'the hidden floor is not even named');
  });

  test('it still works by direct link, and only its own boss is told it is hidden', async () => {
    const page = await visitor.get(`/api/floors/${secret.slug}`);
    assert.equal(page.status, 200);
    assert.equal(page.data.floor.hidden, undefined, 'a visitor is not told');
    assert.equal((await secret.get(`/api/floors/${secret.slug}`)).data.floor.hidden, true);
    assert.equal((await shown.get(`/api/floors/${shown.slug}`)).data.floor.hidden, undefined);
  });

  test('a launch party is the open floor\'s launch, never the hidden floor\'s, and only while it is news', async () => {
    const { party } = (await visitor.get('/api/building/party')).data;
    assert.ok(party, 'a fresh launch is a party');
    assert.equal(party.floor.slug, shown.slug);
    assert.deepEqual(Object.keys(party).sort(), ['floor', 'id', 'text', 'ts', 'url']);
    assert.match(party.text, /^launched "/);
    assert.ok(party.url.startsWith('/theoffice/f/'), 'a plain public url');
    run(t.db, 'UPDATE projects SET private=1 WHERE floor_id=(SELECT id FROM floors WHERE slug=?)', shown.slug);
    const gone = (await visitor.get('/api/building/party')).data.party;
    assert.ok(!gone || gone.floor.slug !== shown.slug, 'a project made private is no party');
    run(t.db, 'UPDATE projects SET private=0 WHERE floor_id=(SELECT id FROM floors WHERE slug=?)', shown.slug);
  });

  test('the leaderboard ranks public projects from their visitor stats, and leaves out private ones and hidden floors', async () => {
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', shown.slug).id;
    const projects = all(t.db, 'SELECT slug, kind FROM projects WHERE floor_id=? AND published_at IS NOT NULL', fid);
    assert.ok(projects.length >= 1);
    const today = new Date().toISOString().slice(0, 10);
    for (const [i, p] of projects.entries()) run(t.db, 'INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,?,?,?,?,?)', fid, p.slug, today, '/', 10 + i, 3 + i);
    const sid = get(t.db, 'SELECT id FROM floors WHERE slug=?', secret.slug).id;
    for (const p of all(t.db, 'SELECT slug FROM projects WHERE floor_id=?', sid)) run(t.db, 'INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,?,?,?,?,?)', sid, p.slug, today, '/', 999, 999);
    const r = await visitor.get('/api/building/leaderboard');
    assert.equal(r.status, 200);
    const b = r.data;
    const text = JSON.stringify(b);
    assert.ok(!text.includes(secret.slug) && !text.includes('Back Room'), 'nothing from the hidden floor');
    assert.ok(b.newest.length >= 1 && b.newest.every((c) => c.floor.slug === shown.slug));
    for (const c of [...b.games, ...b.sites]) assert.equal(typeof c.count, 'number');
    for (const list of [b.games, b.sites]) for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].count >= list[i].count, 'ranked');
    const site = projects.find((p) => p.kind === 'site' || p.kind === 'app');
    if (site) assert.ok(b.sites.some((c) => c.slug === site.slug), 'the visited site is on the board');
    assert.ok(!/\$|usd|cost|budget/i.test(text), 'no money on the board');
    run(t.db, 'UPDATE projects SET private=1 WHERE floor_id=? AND slug=?', fid, b.newest[0].slug);
    const after = (await visitor.get('/api/building/leaderboard')).data;
    assert.ok(![...after.games, ...after.sites, ...after.newest].some((c) => c.slug === b.newest[0].slug), 'made private, gone at once');
    run(t.db, 'UPDATE projects SET private=0 WHERE floor_id=? AND slug=?', fid, b.newest[0].slug);
  });

  test('the admin CLI hides and shows a floor by number', () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-life-'));
    try {
      const db = openDb(dir);
      run(db, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at) VALUES ('floor-7',7,'Seven Co','{}','{}','{}','x',1)");
      const cli = (...args) => spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/admin.mjs'), ...args], { env: { PATH: process.env.PATH, DATA_DIR: dir, ADMIN_PASSWORD: 'x' }, encoding: 'utf8', timeout: 30000 });
      let r = cli('floors', 'hide', '--floor', '7');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(get(db, 'SELECT hidden FROM floors WHERE number=7').hidden, 1);
      assert.match(cli('floors').stdout, /\[hidden\]/);
      r = cli('floors', 'show', '--floor', '7');
      assert.equal(r.status, 0, r.stderr);
      assert.equal(get(db, 'SELECT hidden FROM floors WHERE number=7').hidden, 0);
      assert.notEqual(cli('floors', 'hide', '--floor', '8').status, 0, 'an empty floor is refused');
      // A short boss login for checking a floor by hand, and its end.
      r = cli('login', '--floor', '7', '--minutes', '5');
      assert.equal(r.status, 0, r.stderr);
      const token = r.stdout.trim();
      const s = loadSession(db, token, 'owner');
      assert.equal(s.floor_id, get(db, 'SELECT id FROM floors WHERE number=7').id);
      assert.ok(s.expires_at - s.created_at === 5 * 60 * 1000, 'as short as asked');
      assert.notEqual(cli('login', '--floor', '8').status, 0, 'an empty floor is refused');
      assert.notEqual(cli('login', '--floor', '7', '--minutes', '999').status, 0, 'no long logins');
      r = spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/admin.mjs'), 'login', 'revoke'], { input: `${token}\n`, env: { PATH: process.env.PATH, DATA_DIR: dir, ADMIN_PASSWORD: 'x' }, encoding: 'utf8', timeout: 30000 });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /ended/);
      assert.equal(loadSession(db, token, 'owner'), null, 'revoked');
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test('parties are rare: one at a time in the building, one per floor, one per project', () => {
  const at = (id, ts, floor, url = `/f/${floor}/${id}/`) => ({ id, ts, floor: { slug: floor }, url });
  const m = 60_000;
  const picked = pickParties([
    at(1, 0, 'a'), at(2, 10_000, 'b'),            // b is too soon after a
    at(3, 2 * m, 'b'), at(4, 3 * m, 'a'),         // a again within ten minutes: no
    at(5, 12 * m, 'a', '/f/a/1/'),                // a's first project again within six hours: no
    at(6, 13 * m, 'a'),
  ]).map((p) => p.id);
  assert.deepEqual(picked, [1, 3, 6]);
  assert.ok(PARTY.GAP_MS >= 60_000 && PARTY.FLOOR_MS >= 10 * m);
});
