// Building life: hidden floors stay out of the lobby but open by their own link.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, claim, Client, waitDone } from './helpers.js';
import { openDb, run, get } from '../server/db.js';

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
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
