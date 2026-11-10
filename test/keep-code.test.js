// A floor opened with a named code, or given one with floor-code, signs in with that same code every time. OFFICE- floors keep their rotating recovery code.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, Client, claim } from './helpers.js';
import { openDb, get, run } from '../server/db.js';
import { sha256, normalizeCode, hashSecret, verifySecret } from '../server/auth.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('floors that keep their code', () => {
  let t; before(async () => { t = await boot(); }); after(() => t.close());
  const floor = (slug) => get(t.db, 'SELECT keep_code,recovery_hash FROM floors WHERE slug=?', slug);
  const signedIn = async (c) => (await c.get('/api/me')).data.floor?.slug ?? null;
  async function claimNamed(code, name) {
    run(t.db, 'INSERT INTO codes (hash,floor_number,created_at) VALUES (?,?,?)', sha256(normalizeCode(code)), null, Date.now());
    const c = new Client(t);
    const r = await c.post('/api/claim', { code, name, bossName: 'Ann' });
    assert.equal(r.status, 201);
    c.csrf = r.data.csrf; c.slug = r.data.slug; c.recovery = r.data.recoveryCode;
    return c;
  }
  const login = async (slug, recoveryCode, c = new Client(t)) => { const r = await c.post('/api/login', { slug, recoveryCode }); c.csrf = r.data.csrf; return { c, r }; };

  test('a named claim makes that code the floor\'s own, punctuation and all', async () => {
    const a = await claimNamed('Ann Lab!*$', 'Ann Labs');
    assert.equal(a.recovery, 'ANN-LAB!*$');
    const row = floor(a.slug);
    assert.equal(row.keep_code, 1);
    assert.ok(verifySecret('ANN-LAB!*$', row.recovery_hash));
    assert.equal((await new Client(t).post('/api/claim', { code: 'Ann Lab!*$', name: 'Again', bossName: 'B' })).status, 404, 'it still opens only one floor');
    assert.equal((await login(a.slug, 'ann lab!*$')).r.status, 200, 'typed loosely, it still signs in');
  });

  test('repeat sign-ins take the same code, hand over nothing new, and leave other devices signed in', async () => {
    const a = await claimNamed('TPR-REPEAT-1', 'Repeat Co');
    const hash = floor(a.slug).recovery_hash;
    const devices = [];
    for (const typed of ['TPR-REPEAT-1', ' tpr-repeat-1 ', 'TPR-REPEAT-1']) {
      const { c, r } = await login(a.slug, typed);
      assert.equal(r.status, 200);
      assert.equal(r.data.slug, a.slug);
      assert.ok(r.data.csrf);
      assert.ok(!('recoveryCode' in r.data), 'no new code to show');
      devices.push(c);
    }
    assert.equal(floor(a.slug).recovery_hash, hash, 'the code did not change');
    for (const c of [a, ...devices]) assert.equal(await signedIn(c), a.slug, 'every device is still signed in');
  });

  test('a wrong code and a wrong floor are still refused', async () => {
    const a = await claimNamed('ARC-WRONG-1', 'Wrong Co');
    assert.equal((await login(a.slug, 'ARC-WRONG-2')).r.status, 401);
    assert.equal((await login('no-such-floor', 'ARC-WRONG-1')).r.status, 401);
    assert.equal(await signedIn(new Client(t)), null);
  });

  test('an OFFICE- floor still rotates its RECOVER- code and signs other devices out', async () => {
    const a = await claim(t, 'Rotating Co');
    assert.match(a.recovery, /^RECOVER-/);
    assert.equal(floor(a.slug).keep_code, 0);
    const { c: d, r: ok } = await login(a.slug, a.recovery);
    assert.equal(ok.status, 200);
    assert.match(ok.data.recoveryCode, /^RECOVER-/);
    assert.notEqual(ok.data.recoveryCode, a.recovery);
    assert.equal((await login(a.slug, a.recovery)).r.status, 401, 'the old code has stopped working');
    assert.equal(await signedIn(a), null, 'the other device is signed out');
    assert.equal(await signedIn(d), a.slug);
    const { c: e, r: again } = await login(a.slug, ok.data.recoveryCode);
    assert.equal(again.status, 200);
    assert.notEqual(again.data.recoveryCode, ok.data.recoveryCode, 'it rotates every time');
    assert.equal(await signedIn(d), null);
    assert.equal(await signedIn(e), a.slug);
  });

  test('an OFFICE- floor given a code with floor-code stops rotating', async () => {
    const a = await claim(t, 'Converted Co');
    run(t.db, 'UPDATE floors SET recovery_hash=?, keep_code=1 WHERE slug=?', hashSecret(normalizeCode('LAB-AAAA-BBBB')), a.slug);
    for (let i = 0; i < 2; i++) {
      const { r } = await login(a.slug, 'lab-aaaa-bbbb');
      assert.equal(r.status, 200);
      assert.ok(!('recoveryCode' in r.data));
    }
    assert.equal((await login(a.slug, a.recovery)).r.status, 401, 'the old recovery code has gone');
    assert.equal(await signedIn(a), a.slug, 'the boss stays signed in');
  });

  test('floor-code reads the code from stdin, hashes it and never prints it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-keepcode-'));
    try {
      const seed = openDb(dir);
      run(seed, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at) VALUES ('acme',3,'Acme','{}','{}','{}','x',?)", Date.now());
      seed.close();
      const cli = (floor, input) => spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/admin.mjs'), 'floor-code', '--floor', floor], { input, encoding: 'utf8', env: { ...process.env, DATA_DIR: dir, AI_MODE: 'mock' } });
      const row = () => { const db = openDb(dir); const f = get(db, 'SELECT keep_code,recovery_hash FROM floors WHERE number=3'); db.close(); return f; };
      assert.notEqual(cli('9', 'whatever\n').status, 0, 'no such floor');
      assert.notEqual(cli('3', ' \n').status, 0, 'an empty code is refused');
      assert.deepEqual({ ...row() }, { keep_code: 0, recovery_hash: 'x' });
      const done = cli('3', ' my Code!*$\n');
      assert.equal(done.status, 0, done.stderr);
      for (const text of [done.stdout, done.stderr]) assert.ok(!/my.code/i.test(text), 'the code is not printed');
      const f = row();
      assert.equal(f.keep_code, 1);
      assert.ok(verifySecret('MY-CODE!*$', f.recovery_hash));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
