// "Not allowed", logged (server/denied.js; redesign job 8): every 403 or 423 a signed-in boss or the admin gets is kept with who, which floor, what and
// when, and the admin lists them. A tab holding an old session's token (the likely cause of floor 7's "not allowed") is shown and logged too.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, claim, adminClient, Client } from './helpers.js';
import { get, all, openDb } from '../server/db.js';
import { logDenied } from '../server/denied.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const open = [];
after(async () => { for (const t of open) await t.close(); });

describe('"not allowed" is logged', () => {
  test('a boss refused on another floor, or with a stale token, is logged with user, floor, action and time; a visitor is not', async () => {
    const t = await boot({ peopleTalk: false });
    open.push(t);
    const a = await claim(t, 'Alpha Co'), b = await claim(t, 'Beta Co');
    const fa = get(t.db, 'SELECT * FROM floors WHERE slug=?', a.slug), fb = get(t.db, 'SELECT * FROM floors WHERE slug=?', b.slug);
    const before = Date.now();
    let r = await a.post(`/api/floors/${b.slug}/chat`, { text: 'hello' });
    assert.equal(r.status, 403);
    // The same browser signs in again (another tab): the old tab still holds the first session's token.
    const stale = a.csrf;
    const again = await a.post('/api/login', { slug: a.slug, recoveryCode: a.recovery });
    assert.equal(again.status, 200);
    a.csrf = stale;
    r = await a.post(`/api/floors/${a.slug}/chat`, { text: 'still me' });
    assert.equal(r.status, 403); assert.equal(r.data.error, 'bad_csrf');
    const visitor = new Client(t);
    assert.equal((await visitor.post(`/api/floors/${a.slug}/chat`, { text: 'hi' })).status, 401);
    const rows = all(t.db, 'SELECT * FROM denied_requests ORDER BY id');
    assert.equal(rows.length, 2, 'two refusals, the visitor not logged');
    assert.match(rows[0].user, new RegExp(`^boss of floor ${fa.number} \\(session [0-9a-f]{8}\\)$`));
    assert.equal(rows[0].floor_id, fb.id); assert.equal(rows[0].action, 'POST /api/floors/:slug/chat'); assert.equal(rows[0].code, 'not_your_floor');
    assert.ok(rows[0].created_at >= before);
    assert.equal(rows[1].floor_id, fa.id); assert.equal(rows[1].code, 'bad_csrf');
    assert.ok(t.logs.some((l) => /"msg":"not allowed"/.test(l) && /bad_csrf/.test(l)), 'and in the server log');
    assert.ok(!JSON.stringify(rows).includes(stale), 'no token is kept');
    const admin = await adminClient(t);
    const list = await admin.get('/api/admin/denied');
    assert.equal(list.status, 200); assert.equal(list.data.denied.length, 2);
    assert.equal(list.data.denied[0].floorNumber, fa.number);
  });

  test('the admin lists them with admin.mjs denied --since', () => {
    const dir = mkdtempSync(join(tmpdir(), 'denied-'));
    try {
      const db = openDb(dir);
      logDenied(db, { user: 'boss of floor 7 (session abcd1234)', floorId: null, action: 'POST /api/floors/:slug/chat', status: 403, code: 'bad_csrf' });
      logDenied(db, { user: 'admin', action: 'POST /api/admin/pause', status: 403, code: 'bad_csrf', at: Date.now() - 10 * 86400000 });
      db.close();
      const cli = (...a) => spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/admin.mjs'), ...a], { env: { PATH: process.env.PATH, DATA_DIR: dir, ADMIN_PASSWORD: 'x' }, encoding: 'utf8', timeout: 30000 });
      let r = cli('denied', '--since', '24h', '--json');
      assert.equal(r.status, 0, r.stderr);
      const rows = JSON.parse(r.stdout);
      assert.equal(rows.length, 1); assert.equal(rows[0].user, 'boss of floor 7 (session abcd1234)'); assert.equal(rows[0].code, 'bad_csrf');
      r = cli('denied', '--since', '30d');
      assert.match(r.stdout, /403 bad_csrf {2}boss of floor 7/); assert.match(r.stdout, /admin {2}floor - {2}POST \/api\/admin\/pause/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
