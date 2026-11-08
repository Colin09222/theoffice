// Office Cloud, the backend every published project gets. The adversary is anyone on the web: another project's page, a script with
// a forged header, a player trying to read someone else's data. Every project is its own island.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { get, all, run } from '../server/db.js';
import { platformDocs } from '../server/prompts.js';
import { boot, claim, adminClient, Client } from './helpers.js';
import { BASE, P1, P2, P3, hit, publish, cloud, png } from './cloud-helpers.js';

const signUp = async (t, host, body, player = P1) => {
  const r = await cloud(t, host, 'POST', 'auth/signup', { body: { password: 'correct horse', ...body }, player });
  assert.equal(r.status, 201, r.text);
  return r.json;
};

describe('Office Cloud', () => {
  let t, a, b, floorA, floorB, hostA, hostB, hostA2;
  before(async () => {
    t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', publicOrigin: 'https://main.test.example' });
    t.cfg.publicOrigin = '';
    a = await claim(t, 'Alpha Co'); b = await claim(t, 'Beta Co');
    floorA = get(t.db, 'SELECT * FROM floors WHERE slug=?', a.slug); floorB = get(t.db, 'SELECT * FROM floors WHERE slug=?', b.slug);
    hostA = publish(t, floorA, 'game'); hostB = publish(t, floorB, 'game'); hostA2 = publish(t, floorA, 'other');
  });
  after(() => t.close());

  describe('the SDK and the front door', () => {
    test('the browser library is served on every project origin, at any depth, and at a stable address on the main site', async () => {
      for (const path of ['/_office/office.js', '/levels/_office/office.js']) {
        const r = await hit(t, hostA, path);
        assert.equal(r.status, 200, path);
        assert.match(r.headers['content-type'], /^text\/javascript/);
        assert.equal(r.headers['x-content-type-options'], 'nosniff');
        assert.match(r.text, /Office\.connect = connect/);
      }
      const main = await fetch(`${t.base}/sdk/office.js`);
      assert.equal(main.status, 200);
      assert.match(main.headers.get('content-type'), /^text\/javascript/);
      assert.match(await main.text(), /_office\/cloud\//);
    });
    test('a ping answers JSON with no cache, and a project origin is still locked to itself by its CSP', async () => {
      const r = await cloud(t, hostA, 'GET', 'ping');
      assert.equal(r.status, 200); assert.equal(r.json.ok, true);
      assert.equal(r.headers['cache-control'], 'no-store');
      assert.match(r.headers['content-security-policy'], /connect-src 'self'/);
    });
    test('an unknown path under the API is a JSON 404, not the site', async () => {
      for (const p of ['nope', 'db', 'auth/whatever', 'db/posts/x/y/z']) {
        const r = await cloud(t, hostA, 'GET', p);
        assert.equal(r.status, 404, p); assert.equal(r.json.error, 'not_found');
      }
    });
  });

  describe('CORS: only the project\'s own origins', () => {
    test('a preflight from the project\'s own origin is allowed; from another project or another site it is refused', async () => {
      const ok = await hit(t, hostA, '/_office/cloud/db/posts', { method: 'OPTIONS', headers: { origin: `https://${hostA}`, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-office-session' } });
      assert.equal(ok.status, 204);
      assert.equal(ok.headers['access-control-allow-origin'], `https://${hostA}`);
      assert.match(ok.headers['access-control-allow-headers'], /x-office-session/);
      assert.match(ok.headers.vary, /Origin/);
      for (const origin of [`https://${hostB}`, `https://${hostA2}`, 'https://evil.example', 'null', `http://${hostA}`]) {
        const r = await hit(t, hostA, '/_office/cloud/db/posts', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } });
        assert.equal(r.status, 403, origin);
        assert.equal(r.headers['access-control-allow-origin'], undefined, origin);
      }
    });
    test('reads and writes from a foreign origin are refused, and a write with no Origin at all is refused', async () => {
      for (const origin of [`https://${hostB}`, 'https://evil.example']) {
        assert.equal((await cloud(t, hostA, 'GET', 'db/posts', { origin })).status, 403);
        assert.equal((await cloud(t, hostA, 'POST', 'db/posts', { origin, body: { data: { x: 1 } } })).status, 403);
      }
      assert.equal((await cloud(t, hostA, 'POST', 'db/posts', { origin: null, body: { data: { x: 1 } } })).status, 403);
    });
    test('a no-cors request from a sibling project (same site) or a stranger is refused even with no Origin header', async () => {
      for (const site of ['same-site', 'cross-site']) {
        const r = await cloud(t, hostA, 'GET', 'db/posts', { origin: null, headers: { 'sec-fetch-site': site } });
        assert.equal(r.status, 403, site);
      }
      assert.equal((await cloud(t, hostA, 'GET', 'db/posts', { origin: null, headers: { 'sec-fetch-site': 'same-origin' } })).status, 200);
    });
    test('a domain the floor bought for the project is one of its own origins, and shares the same data', async () => {
      const at = Date.now();
      run(t.db, "INSERT INTO domain_orders (floor_id,domain,project,status,quoted_usd,created_at,updated_at) VALUES (?,?,?,'live',0,?,?)", floorA.id, 'alphagame.example', 'game', at, at);
      const fromDomain = await cloud(t, hostA, 'POST', 'db/notes', { origin: 'https://alphagame.example', body: { data: { via: 'domain' } } });
      assert.equal(fromDomain.status, 201, fromDomain.text);
      assert.equal(fromDomain.headers['access-control-allow-origin'], 'https://alphagame.example');
      const onDomain = await cloud(t, 'alphagame.example', 'GET', 'db/notes', { origin: 'https://alphagame.example' });
      assert.equal(onDomain.status, 200, onDomain.text);
      assert.deepEqual(onDomain.json.docs.map((d) => d.data.via), ['domain']);
      // The bought domain is no key to anyone else's data.
      assert.equal((await cloud(t, hostB, 'GET', 'db/notes', { origin: 'https://alphagame.example' })).status, 403);
    });
  });

  describe('projects never see each other\'s data', () => {
    test('the same username can exist on two projects, and a session from one is worthless on any other', async () => {
      const onA = await signUp(t, hostA, { username: 'samuel' });
      const onB = await signUp(t, hostB, { username: 'samuel' });
      assert.notEqual(onA.user.id, onB.user.id);
      assert.equal((await cloud(t, hostA, 'GET', 'auth/me', { session: onA.session })).json.user.username, 'samuel');
      for (const host of [hostB, hostA2]) {
        const r = await cloud(t, host, 'GET', 'auth/me', { session: onA.session });
        assert.equal(r.status, 401, host); assert.equal(r.json.error, 'signed_out');
      }
      // A login on project B with A's password and name finds B's account, never A's.
      const login = await cloud(t, hostB, 'POST', 'auth/login', { body: { login: 'samuel', password: 'correct horse' } });
      assert.equal(login.json.user.id, onB.user.id);
    });
    test('documents, saves, scores and files stay with their project even under identical names and tokens', async () => {
      const doc = await cloud(t, hostA, 'POST', 'db/posts', { body: { data: { text: 'alpha only' } } });
      assert.equal(doc.status, 201);
      await cloud(t, hostA, 'PUT', 'saves/slot1', { body: { value: { level: 7 } } });
      await cloud(t, hostA, 'POST', 'boards/high', { body: { score: 900, name: 'Ada' } });
      const file = await cloud(t, hostA, 'POST', 'files?name=a.png', { raw: png(), type: 'image/png' });
      assert.equal(file.status, 201, file.text);
      for (const host of [hostB, hostA2]) {
        assert.deepEqual((await cloud(t, host, 'GET', 'db/posts')).json.docs, [], host);
        assert.equal((await cloud(t, host, 'GET', `db/posts/${doc.json.id}`)).status, 404, host);
        assert.equal((await cloud(t, host, 'GET', 'saves/slot1')).json.found, false, host);
        assert.deepEqual((await cloud(t, host, 'GET', 'boards/high')).json.entries, [], host);
        assert.equal((await cloud(t, host, 'GET', `files/${file.json.id}`)).status, 404, host);
        assert.equal((await cloud(t, host, 'DELETE', `db/posts/${doc.json.id}`)).status, 404, host);
      }
      assert.equal((await cloud(t, hostA, 'GET', 'saves/slot1')).json.value.level, 7);
    });
    test('every stored row names its floor and project, and project B\'s rows hold none of A\'s content', () => {
      for (const table of ['cloud_docs', 'cloud_saves', 'cloud_scores', 'cloud_files', 'cloud_users', 'cloud_sessions']) {
        assert.equal(get(t.db, `SELECT COUNT(*) n FROM ${table} WHERE floor_id IS NULL OR project IS NULL OR project=''`).n, 0, table);
      }
      const bRows = all(t.db, 'SELECT data FROM cloud_docs WHERE floor_id=?', floorB.id).map((r) => r.data).join('');
      assert.doesNotMatch(bRows, /alpha only/);
    });
  });

  describe('accounts', () => {
    test('sign-up checks its fields before any hashing, and refuses a taken username or email in any case', async () => {
      for (const [body, code] of [[{ password: 'long enough' }, 'need_login'], [{ username: 'ab', password: 'long enough' }, 'bad_username'], [{ username: 'has space', password: 'long enough' }, 'bad_username'],
        [{ username: 'okname', password: 'short' }, 'bad_password'], [{ email: 'not-an-email', password: 'long enough' }, 'bad_email']]) {
        const r = await cloud(t, hostA, 'POST', 'auth/signup', { body });
        assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.json.error, code);
      }
      await signUp(t, hostA, { username: 'Dana', email: 'Dana@Example.com' }, P2);
      const again = await cloud(t, hostA, 'POST', 'auth/signup', { body: { username: 'DANA', password: 'whatever123' } });
      assert.equal(again.status, 409); assert.equal(again.json.error, 'username_taken');
      const email = await cloud(t, hostA, 'POST', 'auth/signup', { body: { username: 'dana2', email: 'dana@example.COM', password: 'whatever123' } });
      assert.equal(email.status, 409); assert.equal(email.json.error, 'email_taken');
    });
    test('passwords are stored only as scrypt hashes, and nothing anyone can fetch carries one', async () => {
      const r = await signUp(t, hostA, { username: 'pwcheck', email: 'h@example.com' });
      const row = get(t.db, 'SELECT hash FROM cloud_users WHERE uid=?', r.user.id);
      assert.match(row.hash, /^s1\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
      assert.doesNotMatch(row.hash, /correct horse/);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM cloud_sessions WHERE hash=?', r.session).n, 0, 'sessions are stored hashed');
      const me = await cloud(t, hostA, 'GET', 'auth/me', { session: r.session });
      assert.equal(me.json.user.email, 'h@example.com');
      assert.doesNotMatch(JSON.stringify([r, me.json]), /s1\$|"hash"|correct horse/);
    });
    test('log in by username or email; a wrong password and an unknown name get the same answer', async () => {
      await signUp(t, hostA, { username: 'logan', email: 'logan@example.com' });
      for (const login of ['logan', 'LOGAN', 'logan@example.com']) assert.equal((await cloud(t, hostA, 'POST', 'auth/login', { body: { login, password: 'correct horse' } })).status, 200, login);
      const wrong = await cloud(t, hostA, 'POST', 'auth/login', { body: { login: 'logan', password: 'wrong horse' } });
      const nobody = await cloud(t, hostA, 'POST', 'auth/login', { body: { login: 'nobody-here', password: 'wrong horse' } });
      assert.equal(wrong.status, 401); assert.equal(nobody.status, 401);
      assert.deepEqual(wrong.json, nobody.json);
    });
    test('log-out ends that session only; a password change signs out every other device', async () => {
      const first = await signUp(t, hostA, { username: 'multi' });
      const second = (await cloud(t, hostA, 'POST', 'auth/login', { body: { login: 'multi', password: 'correct horse' } })).json.session;
      const third = (await cloud(t, hostA, 'POST', 'auth/login', { body: { login: 'multi', password: 'correct horse' } })).json.session;
      assert.equal((await cloud(t, hostA, 'POST', 'auth/logout', { session: third, body: {} })).status, 200);
      assert.equal((await cloud(t, hostA, 'GET', 'auth/me', { session: third })).status, 401);
      assert.equal((await cloud(t, hostA, 'POST', 'auth/password', { session: first.session, body: { password: 'wrong', newPassword: 'new password 1' } })).status, 401);
      assert.equal((await cloud(t, hostA, 'POST', 'auth/password', { session: first.session, body: { password: 'correct horse', newPassword: 'new password 1' } })).status, 200);
      assert.equal((await cloud(t, hostA, 'GET', 'auth/me', { session: first.session })).status, 200);
      assert.equal((await cloud(t, hostA, 'GET', 'auth/me', { session: second })).status, 401);
      assert.equal((await cloud(t, hostA, 'POST', 'auth/login', { body: { login: 'multi', password: 'correct horse' } })).status, 401);
      assert.equal((await cloud(t, hostA, 'POST', 'auth/login', { body: { login: 'multi', password: 'new password 1' } })).status, 200);
    });
    test('a guest who signs up keeps their saves and scores; a renamed account renames its scores; a deleted account takes its data', async () => {
      await cloud(t, hostA, 'PUT', 'saves/progress', { player: P3, body: { value: { coins: 12 } } });
      await cloud(t, hostA, 'POST', 'boards/guestboard', { player: P3, body: { score: 50, name: 'Guesty' } });
      const u = await signUp(t, hostA, { username: 'convert', name: 'Con <b>Vert</b>' }, P3);
      assert.equal(u.user.name, 'Con bVert/b');
      assert.equal((await cloud(t, hostA, 'GET', 'saves/progress', { session: u.session, player: P2 })).json.value.coins, 12);
      assert.equal((await cloud(t, hostA, 'PATCH', 'auth/me', { session: u.session, body: { name: 'Connie' } })).json.user.name, 'Connie');
      const board = (await cloud(t, hostA, 'GET', 'boards/guestboard', { session: u.session })).json;
      assert.deepEqual(board.entries.map((e) => [e.name, e.score, e.you]), [['Connie', 50, true]]);
      const post = await cloud(t, hostA, 'POST', 'db/posts', { session: u.session, body: { data: { text: 'mine' } } });
      assert.equal((await cloud(t, hostA, 'POST', 'auth/delete', { session: u.session, body: { password: 'nope' } })).status, 401);
      assert.equal((await cloud(t, hostA, 'POST', 'auth/delete', { session: u.session, body: { password: 'correct horse' } })).status, 200);
      assert.equal((await cloud(t, hostA, 'GET', `db/posts/${post.json.id}`)).status, 404);
      assert.deepEqual((await cloud(t, hostA, 'GET', 'boards/guestboard')).json.entries, []);
      assert.equal((await cloud(t, hostA, 'POST', 'auth/login', { body: { login: 'convert', password: 'correct horse' } })).status, 401);
    });
  });

  describe('the database', () => {
    let sam, kim;
    before(async () => {
      sam = (await signUp(t, hostA2, { username: 'sam_db' })).session;
      kim = (await signUp(t, hostA2, { username: 'kim_db' }, P2)).session;
    });
    test('create, read, update, replace and delete, with versions and owner names', async () => {
      const made = await cloud(t, hostA2, 'POST', 'db/notes', { session: sam, body: { data: { title: 'one', n: 1 } } });
      assert.equal(made.status, 201);
      assert.equal(made.json.owner.name, 'sam_db'); assert.equal(made.json.mine, true); assert.equal(made.json.version, 1);
      const id = made.json.id;
      const patched = await cloud(t, hostA2, 'PATCH', `db/notes/${id}`, { session: sam, body: { data: { n: 2, extra: true } } });
      assert.deepEqual(patched.json.data, { title: 'one', n: 2, extra: true }); assert.equal(patched.json.version, 2);
      const removedField = await cloud(t, hostA2, 'PATCH', `db/notes/${id}`, { session: sam, body: { data: { extra: null } } });
      assert.deepEqual(removedField.json.data, { title: 'one', n: 2 });
      const stale = await cloud(t, hostA2, 'PUT', `db/notes/${id}`, { session: sam, body: { data: { title: 'x' }, ifVersion: 1 } });
      assert.equal(stale.status, 409); assert.equal(stale.json.error, 'version_conflict');
      const replaced = await cloud(t, hostA2, 'PUT', `db/notes/${id}`, { session: sam, body: { data: { title: 'replaced' }, ifVersion: 3 } });
      assert.deepEqual(replaced.json.data, { title: 'replaced' });
      const seen = await cloud(t, hostA2, 'GET', `db/notes/${id}`, { session: kim });
      assert.equal(seen.json.mine, false); assert.equal(seen.json.owner.name, 'sam_db');
      const named = await cloud(t, hostA2, 'PUT', 'db/notes/my-id', { session: sam, body: { data: { at: 'chosen id' } } });
      assert.equal(named.json.id, 'my-id');
      assert.equal((await cloud(t, hostA2, 'POST', 'db/notes', { session: sam, body: { id: 'my-id', data: {} } })).status, 409);
      assert.equal((await cloud(t, hostA2, 'DELETE', `db/notes/${id}`, { session: sam })).status, 200);
      assert.equal((await cloud(t, hostA2, 'GET', `db/notes/${id}`, { session: sam })).status, 404);
    });
    test('only whoever made a document can change or delete it; private documents are invisible to everyone else', async () => {
      const pub = (await cloud(t, hostA2, 'POST', 'db/wall', { session: sam, body: { data: { text: 'hello' } } })).json;
      const secret = (await cloud(t, hostA2, 'POST', 'db/wall', { session: sam, body: { data: { text: 'my phone 555' }, private: true } })).json;
      for (const [m, body] of [['PATCH', { data: { text: 'defaced' } }], ['PUT', { data: { text: 'defaced' } }], ['DELETE', undefined]]) {
        const r = await cloud(t, hostA2, m, `db/wall/${pub.id}`, { session: kim, body });
        assert.equal(r.status, 403, m); assert.equal(r.json.error, 'not_yours');
        assert.equal((await cloud(t, hostA2, m, `db/wall/${pub.id}`, { player: P3, body })).status, 403, `guest ${m}`);
      }
      assert.equal((await cloud(t, hostA2, 'GET', `db/wall/${secret.id}`, { session: kim })).status, 404);
      assert.equal((await cloud(t, hostA2, 'GET', `db/wall/${secret.id}`, { session: null, player: null })).status, 404);
      const kimSees = (await cloud(t, hostA2, 'GET', 'db/wall', { session: kim })).json.docs.map((d) => d.data.text);
      assert.deepEqual(kimSees, ['hello']);
      const samSees = (await cloud(t, hostA2, 'GET', 'db/wall?sort=text', { session: sam })).json.docs.map((d) => d.data.text);
      assert.deepEqual(samSees, ['hello', 'my phone 555']);
      assert.equal((await cloud(t, hostA2, 'GET', 'db/wall?count=1', { session: kim })).json.count, 1);
    });
    test('queries: equality filters by type, nested fields, sort either way, limit, offset and mine', async () => {
      const rows = [{ name: 'ant', team: 'red', score: 5, alive: true, meta: { level: 2 } }, { name: 'bee', team: 'blue', score: 9, alive: false, meta: { level: 1 } },
        { name: 'cat', team: 'red', score: 7, alive: true, meta: { level: 2 } }, { name: 'dog', team: 'red', score: '7', alive: null, meta: { level: 3 } }];
      for (const [i, data] of rows.entries()) await cloud(t, hostA2, 'POST', 'db/players', { session: i % 2 ? kim : sam, body: { data } });
      const q = async (query, session = sam) => (await cloud(t, hostA2, 'GET', `db/players?${query}`, { session })).json;
      const names = async (query) => (await q(query.includes('sort=') ? query : `sort=name&${query}`)).docs.map((d) => d.data.name);
      const w = (o) => `where=${encodeURIComponent(JSON.stringify(o))}`;
      assert.deepEqual(await names(w({ team: 'red' })), ['ant', 'cat', 'dog']);
      assert.deepEqual(await names(w({ score: 7 })), ['cat'], 'a number never matches the string "7"');
      assert.deepEqual(await names(w({ score: '7' })), ['dog']);
      assert.deepEqual(await names(w({ alive: true })), ['ant', 'cat']);
      assert.deepEqual(await names(w({ alive: null })), ['dog']);
      assert.deepEqual(await names(w({ 'meta.level': 2, team: 'red' })), ['ant', 'cat']);
      assert.deepEqual(await names('sort=score&order=desc&' + w({ team: 'red' })), ['dog', 'cat', 'ant'], 'text sorts after numbers in SQLite');
      assert.deepEqual(await names('sort=name&order=desc&limit=2'), ['dog', 'cat']);
      assert.deepEqual(await names('sort=name&limit=2&offset=1'), ['bee', 'cat']);
      assert.deepEqual(await names('mine=1&sort=name'), ['ant', 'cat']);
      const more = await q('sort=name&limit=3');
      assert.equal(more.more, true);
      for (const bad of ['where=nope', w({ 'bad field': 1 }), w({ team: ['red'] }), w({ team: { $ne: 1 } }), 'sort=a;b', 'sort=x)--']) {
        const r = await cloud(t, hostA2, 'GET', `db/players?${bad}`, { session: sam });
        assert.equal(r.status, 400, bad);
      }
    });
    test('names, ids and sizes are checked', async () => {
      const c = (path, body) => cloud(t, hostA2, 'POST', path, { session: sam, body });
      assert.equal((await c('db/has%20space', { data: {} })).status, 400);
      assert.equal((await c('db/ok', { data: [1, 2] })).status, 400);
      assert.equal((await c('db/ok', { data: 'text' })).status, 400);
      assert.equal((await c('db/ok', { id: '../x', data: {} })).status, 400);
      assert.equal((await c('db/ok', { data: { big: 'x'.repeat(40 * 1024) } })).status, 413);
      assert.equal((await c('db/ok', { data: { big: 'x'.repeat(200 * 1024) } })).status, 413, 'the body cap catches it first');
      assert.equal((await cloud(t, hostA2, 'POST', 'db/ok', { session: sam, raw: Buffer.from('{"data":{}}'), type: 'text/plain' })).status, 415);
      assert.equal((await cloud(t, hostA2, 'POST', 'db/ok', { session: null, player: null, body: { data: {} } })).status, 401, 'someone has to own it');
    });
  });

  describe('saves', () => {
    test('each player has their own; a guest and an account are different players', async () => {
      const acct = (await signUp(t, hostA2, { username: 'saver' })).session;
      assert.equal((await cloud(t, hostA2, 'PUT', 'saves/slot', { player: P1, body: { value: 'guest one' } })).status, 200);
      assert.equal((await cloud(t, hostA2, 'PUT', 'saves/slot', { player: P2, body: { value: 'guest two' } })).status, 200);
      assert.equal((await cloud(t, hostA2, 'PUT', 'saves/slot', { session: acct, body: { value: { deep: [1, 2] } } })).status, 200);
      assert.equal((await cloud(t, hostA2, 'GET', 'saves/slot', { player: P1 })).json.value, 'guest one');
      assert.equal((await cloud(t, hostA2, 'GET', 'saves/slot', { player: P2 })).json.value, 'guest two');
      assert.deepEqual((await cloud(t, hostA2, 'GET', 'saves/slot', { session: acct, player: P2 })).json.value, { deep: [1, 2] });
      assert.deepEqual((await cloud(t, hostA2, 'GET', 'saves', { session: acct })).json.saves.map((s) => s.key), ['slot']);
      const v = (await cloud(t, hostA2, 'GET', 'saves/slot', { session: acct })).json.version;
      assert.equal((await cloud(t, hostA2, 'PUT', 'saves/slot', { session: acct, body: { value: 1, ifVersion: v - 1 } })).status, 409);
      assert.equal((await cloud(t, hostA2, 'DELETE', 'saves/slot', { session: acct })).status, 200);
      assert.deepEqual((await cloud(t, hostA2, 'GET', 'saves/slot', { session: acct })).json, { key: 'slot', value: null, version: 0, found: false });
      assert.equal((await cloud(t, hostA2, 'GET', 'saves/slot', { player: 'short' })).status, 401, 'a malformed token is no identity');
      assert.equal((await cloud(t, hostA2, 'PUT', 'saves/bad%20key', { body: { value: 1 } })).status, 400);
      assert.equal((await cloud(t, hostA2, 'PUT', 'saves/big', { body: { value: 'x'.repeat(70 * 1024) } })).status, 413);
    });
  });

  describe('leaderboards', () => {
    test('one entry per player with their best kept, ranked, with the asker\'s own rank even off the page', async () => {
      const players = Array.from({ length: 6 }, (_, i) => String(i).repeat(40));
      for (const [i, p] of players.entries()) await cloud(t, hostA2, 'POST', 'boards/arcade', { player: p, body: { score: (i + 1) * 10, name: `P${i}` } });
      const worse = await cloud(t, hostA2, 'POST', 'boards/arcade', { player: players[5], body: { score: 1, name: 'P5' } });
      assert.equal(worse.json.improved, false); assert.equal(worse.json.best, 60); assert.equal(worse.json.rank, 1);
      const better = await cloud(t, hostA2, 'POST', 'boards/arcade', { player: players[0], body: { score: 55 } });
      assert.equal(better.json.improved, true); assert.equal(better.json.rank, 2);
      const top = (await cloud(t, hostA2, 'GET', 'boards/arcade?limit=3', { player: players[1] })).json;
      assert.deepEqual(top.entries.map((e) => [e.rank, e.name, e.score]), [[1, 'P5', 60], [2, 'Guest', 55], [3, 'P4', 50]]);
      assert.deepEqual(top.me, { rank: 6, score: 20, name: 'P1' });
      assert.ok(top.entries.every((e) => /^guest-[0-9a-f]{10}$/.test(e.player) && !e.player.includes(players[5])));
    });
    test('a board where lower wins is settled by its first score and can\'t be flipped later', async () => {
      await cloud(t, hostA2, 'POST', 'boards/speedrun', { player: P1, body: { score: 31.5, lower: true, name: 'Quick' } });
      await cloud(t, hostA2, 'POST', 'boards/speedrun', { player: P2, body: { score: 99, lower: false, name: 'Slow' } });
      const r = (await cloud(t, hostA2, 'GET', 'boards/speedrun')).json;
      assert.equal(r.lower, true);
      assert.deepEqual(r.entries.map((e) => e.name), ['Quick', 'Slow']);
    });
    test('scores must be sane numbers and names are cleaned', async () => {
      for (const score of ['12', null, 1e13, -1e13, true]) {
        const r = await cloud(t, hostA2, 'POST', 'boards/sane', { body: { score, name: 'x' } });
        assert.equal(r.status, 400, String(score)); assert.equal(r.json.error, 'bad_score');
      }
      assert.equal((await cloud(t, hostA2, 'POST', 'boards/sane', { raw: Buffer.from('{"score": NaN}') })).status, 400);
      await cloud(t, hostA2, 'POST', 'boards/sane', { body: { score: 5, name: '<img src=x onerror=alert(1)>‮evil' } });
      const name = (await cloud(t, hostA2, 'GET', 'boards/sane')).json.entries[0].name;
      assert.doesNotMatch(name, /[<>"'`‮]/);
      assert.ok(name.length <= 24);
    });
  });

  describe('files', () => {
    test('uploads are typed from their bytes and served back with nosniff, a sandbox and ranges', async () => {
      const body = png(600 * 1024);
      const up = await cloud(t, hostA2, 'POST', 'files?name=../../etc/pic.png', { raw: body, type: 'text/html' });
      assert.equal(up.status, 201, up.text);
      assert.equal(up.json.type, 'image/png'); assert.equal(up.json.name, 'pic.png'); assert.equal(up.json.size, body.length);
      assert.match(up.json.url, /^\/_office\/cloud\/files\/[A-Za-z0-9_-]{22}$/);
      const got = await hit(t, hostA2, up.json.url);
      assert.equal(got.status, 200);
      assert.equal(got.headers['content-type'], 'image/png');
      assert.equal(got.headers['x-content-type-options'], 'nosniff');
      assert.match(got.headers['content-security-policy'], /sandbox/);
      assert.ok(got.buf.equals(body), 'the bytes come back whole, across stored pieces');
      const part = await hit(t, hostA2, up.json.url, { headers: { range: 'bytes=262140-262150' } });
      assert.equal(part.status, 206);
      assert.equal(part.headers['content-range'], `bytes 262140-262150/${body.length}`);
      assert.ok(part.buf.equals(body.subarray(262140, 262151)));
      const tail = await hit(t, hostA2, up.json.url, { headers: { range: 'bytes=-5' } });
      assert.ok(tail.buf.equals(body.subarray(body.length - 5)));
      assert.equal((await hit(t, hostA2, up.json.url, { headers: { range: `bytes=${body.length}-` } })).status, 416);
    });
    test('anything that is not an image, sound or video is refused, whatever it claims to be', async () => {
      const pngHead = png(16).subarray(0, 8);
      for (const [what, bytes] of [['html', Buffer.from('<!doctype html><script>alert(1)</script>')], ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
        ['js', Buffer.from('alert(document.cookie)//xxxxxxxx')], ['png magic cut short', pngHead], ['empty', Buffer.alloc(0)]]) {
        const r = await cloud(t, hostA2, 'POST', 'files?name=x.png', { raw: bytes, type: 'image/png' });
        assert.ok([400, 415].includes(r.status), `${what}: ${r.status}`);
      }
    });
    test('your own uploads are listed for you alone, and only you can delete them', async () => {
      const mine = (await cloud(t, hostA2, 'POST', 'files?name=m.png', { player: P3, raw: png(), type: 'image/png' })).json;
      assert.ok((await cloud(t, hostA2, 'GET', 'files', { player: P3 })).json.files.some((f) => f.id === mine.id));
      assert.ok(!(await cloud(t, hostA2, 'GET', 'files', { player: P2 })).json.files.some((f) => f.id === mine.id));
      assert.equal((await cloud(t, hostA2, 'DELETE', `files/${mine.id}`, { player: P2 })).status, 403);
      assert.equal((await cloud(t, hostA2, 'DELETE', `files/${mine.id}`, { player: P3 })).status, 200);
      assert.equal((await hit(t, hostA2, `/_office/cloud/files/${mine.id}`)).status, 404);
    });
  });

  describe('the boss, the admin, and the running totals', () => {
    test('the owner sees counts for each project and nothing else; another floor sees nothing', async () => {
      const r = await a.get(`/api/floors/${a.slug}/cloud`);
      assert.equal(r.status, 200);
      const game = r.data.projects.find((p) => p.slug === 'game');
      assert.ok(game.usage.users >= 1 && game.usage.docs >= 1 && game.usage.files >= 1, JSON.stringify(game.usage));
      assert.ok(game.usage.limits.bytes > 0);
      const text = JSON.stringify(r.data);
      assert.doesNotMatch(text, /s1\$|"hash"|correct horse|samuel|alpha only/);
      assert.doesNotMatch(text, /\$\d|USD|dollar/i);
      assert.equal((await b.get(`/api/floors/${a.slug}/cloud`)).status, 403);
      assert.equal((await new Client(t).get(`/api/floors/${a.slug}/cloud`)).status, 401);
    });
    test('running totals match a recount from the rows', () => {
      for (const p of all(t.db, 'SELECT floor_id, project FROM cloud_usage')) {
        const u = t.app.cloud.store.usage(p.floor_id, p.project);
        const real = t.app.cloud.store.recount(p.floor_id, p.project);
        for (const k of Object.keys(real)) assert.equal(u[k], real[k], `${p.project} ${k}`);
      }
    });
    test('requests are counted for the boss without a write per request', async () => {
      t.app.cloud.flush();
      assert.ok(t.app.cloud.store.summary(floorA.id, 'game').requestsToday > 5);
    });
    test('the admin sees every project; a wipe removes one project\'s data and leaves the others', async () => {
      const ad = await adminClient(t);
      const list = await ad.get('/api/admin/cloud');
      assert.equal(list.status, 200);
      assert.ok(list.data.projects.some((p) => p.project === 'other' && p.floorId === floorA.id));
      assert.doesNotMatch(JSON.stringify(list.data), /s1\$|"hash"/);
      const exported = t.app.cloud.store.exportProject(floorA.id, 'other');
      assert.ok(exported.users.length >= 2 && exported.docs.length >= 1);
      assert.ok(exported.users.every((u) => !('hash' in u)));
      const before = t.app.cloud.store.usage(floorA.id, 'game').docs;
      assert.equal((await ad.post('/api/admin/cloud/wipe', { floor: a.slug, project: 'other' })).status, 200);
      assert.equal(t.app.cloud.store.usage(floorA.id, 'other').docs, 0);
      assert.equal(get(t.db, "SELECT COUNT(*) n FROM cloud_users WHERE floor_id=? AND project='other'", floorA.id).n, 0);
      assert.equal(t.app.cloud.store.usage(floorA.id, 'game').docs, before);
      assert.equal((await a.post('/api/admin/cloud/wipe', { floor: a.slug, project: 'game' })).status, 401, 'the boss is not the admin');
    });
    test('the boss\'s Clear saved data clears the backend too', async () => {
      await cloud(t, hostB, 'POST', 'db/posts', { body: { data: { a: 1 } } });
      const r = await b.post(`/api/floors/${b.slug}/projects/game/clear-data`, {});
      assert.equal(r.status, 200); assert.ok(r.data.removed >= 2);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM cloud_docs WHERE floor_id=?', floorB.id).n, 0);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM cloud_users WHERE floor_id=?', floorB.id).n, 0);
    });
    test('the staff are told to use it, from the same relative path the site serves', () => {
      const docs = platformDocs(t.cfg);
      assert.match(docs, /_office\/office\.js/);
      assert.match(docs, /Office\.connect\(\)/);
      for (const word of ['saves', 'leaderboard', 'rooms', 'auth', 'db', 'files']) assert.match(docs, new RegExp(`office\\.${word}`));
      assert.doesNotMatch(docs, /\$\d/);
    });
  });
});
