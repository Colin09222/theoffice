// Email for app accounts (server/cloud/auth-mail.js): the welcome email, forgot and reset password, and the caps around them.
// Everything sends through server/mail-mock.js, a stand-in for Resend on 127.0.0.1, so nothing leaves the machine.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { get, all, run } from '../server/db.js';
import { boot, claim, until } from './helpers.js';
import { startMockResend } from '../server/mail-mock.js';
import { BASE, P1, P2, hit, publish, cloud } from './cloud-helpers.js';
import { FORGOT_SENT, MAIL_OFF, MAIL_FULL } from '../server/cloud/auth-mail.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });

async function start(over = {}, { key = true } = {}) {
  const mock = await startMockResend();
  const t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', ...(key ? { resendApiKey: mock.apiKey, resendWebhookSecret: mock.webhookSecret } : {}), resendApiBase: mock.base, mailTickMs: 30, ...over });
  const close = t.close; t.close = async () => { await close(); await mock.close(); };
  open.push(t);
  t.mock = mock;
  t.app.engine.runManager = async () => {};
  const c = await claim(t, 'Gamma Works');
  t.floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  t.host = publish(t, t.floor, 'todo');
  t.address = t.app.engine.mail.addressOf ? t.app.engine.mail.addressOf(t.floor.id) : null;
  return t;
}
const signUp = async (t, body, player = P1) => {
  const r = await cloud(t, t.host, 'POST', 'auth/signup', { body: { password: 'correct horse', ...body }, player });
  assert.equal(r.status, 201, r.text);
  return r.json;
};
const forgot = (t, email, headers = {}) => cloud(t, t.host, 'POST', 'auth/forgot', { body: { email }, headers });
const sentTo = (t, to) => t.mock.state.sent.filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(to));
const tokenIn = (m) => /\/_office\/reset#t=([A-Za-z0-9_-]+)/.exec(m.text)?.[1];
async function linkFor(t, email, n = 1) {
  const mails = await until(() => (sentTo(t, email).filter(tokenIn).length >= n ? sentTo(t, email).filter(tokenIn) : null), { what: 'the reset email' });
  return tokenIn(mails[n - 1]);
}

describe('account email, with email on', () => {
  let t;
  test('sign-up with an email sends a welcome from the company\'s own address; without one it just works', async () => {
    t = await start();
    const r = await signUp(t, { username: 'ann', email: 'Ann@Example.com', name: 'Ann' });
    assert.equal(r.user.email, 'ann@example.com');
    assert.equal(r.email.welcome, 'sending');
    const [m] = await until(() => (sentTo(t, 'ann@example.com').length ? sentTo(t, 'ann@example.com') : null), { what: 'welcome' });
    assert.match(m.subject, /^Welcome to todo/);
    // The From is whatever the company's normal mail path picks: the same address as its other mail.
    const out = get(t.db, "SELECT * FROM mail_messages WHERE floor_id=? AND direction='out' ORDER BY id DESC", t.floor.id);
    assert.match(m.from, new RegExp(`<${out.from_addr.replace(/[.]/g, '\\.')}>$`));
    assert.match(m.from, /Gamma Works/);
    assert.match(m.text, new RegExp(`https://${t.host.replace(/[.]/g, '\\.')}/`));
    const plain = await signUp(t, { username: 'bob' }, P2);
    assert.equal(plain.user.email, null);
    assert.equal(plain.email.welcome, 'none');
  });

  test('forgot password: the same answer for a known and an unknown address, and only a real account gets mail', async () => {
    const before = t.mock.state.sent.length;
    const known = await forgot(t, 'ann@example.com');
    const unknown = await forgot(t, 'nobody@example.com');
    assert.equal(known.status, 200); assert.equal(unknown.status, 200);
    assert.deepEqual(known.json, unknown.json);
    assert.equal(known.json.message, FORGOT_SENT);
    const token = await linkFor(t, 'ann@example.com');
    assert.ok(token && token.length >= 40);
    assert.equal(sentTo(t, 'nobody@example.com').length, 0);
    assert.equal(t.mock.state.sent.length, before + 1);
    // Only the token's hash is kept, and the company's own copy of the email has no working link.
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM cloud_resets WHERE hash=?', token).n, 0);
    const copy = get(t.db, "SELECT text FROM mail_messages WHERE floor_id=? AND subject LIKE 'Reset your%' ORDER BY id DESC", t.floor.id);
    assert.ok(!copy.text.includes(token));
    assert.match(copy.text, /link left out/);
    // A bad address is refused for its shape alone.
    assert.equal((await forgot(t, 'not-an-address')).status, 400);
  });

  test('a reset link sets the password once, signs everyone else out, and signs this person in', async () => {
    const old = await cloud(t, t.host, 'POST', 'auth/login', { body: { login: 'ann', password: 'correct horse' } });
    assert.equal(old.status, 200);
    await forgot(t, 'ann@example.com');
    const token = await linkFor(t, 'ann@example.com', 2);
    const r = await cloud(t, t.host, 'POST', 'auth/reset', { body: { token, password: 'battery staple' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.user.username, 'ann');
    assert.ok(r.json.session);
    assert.equal((await cloud(t, t.host, 'GET', 'auth/me', { session: old.json.session })).status, 401);
    assert.equal((await cloud(t, t.host, 'GET', 'auth/me', { session: r.json.session })).json.user.username, 'ann');
    // Single use.
    const again = await cloud(t, t.host, 'POST', 'auth/reset', { body: { token, password: 'another one' } });
    assert.equal(again.status, 400); assert.equal(again.json.error, 'bad_token');
    assert.equal((await cloud(t, t.host, 'POST', 'auth/login', { body: { login: 'ann', password: 'correct horse' } })).status, 401);
    assert.equal((await cloud(t, t.host, 'POST', 'auth/login', { body: { login: 'ann@example.com', password: 'battery staple' } })).status, 200);
  });

  test('an older link dies when a newer one is asked for, and a link expires', async () => {
    await forgot(t, 'ann@example.com');
    const first = await linkFor(t, 'ann@example.com', 3);
    await forgot(t, 'ann@example.com');
    const second = await linkFor(t, 'ann@example.com', 4);
    assert.equal((await cloud(t, t.host, 'POST', 'auth/reset', { body: { token: first, password: 'nope nope nope' } })).status, 400);
    // Push the clock past the link's life.
    run(t.db, 'UPDATE cloud_resets SET expires_at=? WHERE used_at IS NULL', Date.now() - 1);
    const late = await cloud(t, t.host, 'POST', 'auth/reset', { body: { token: second, password: 'too late now' } });
    assert.equal(late.status, 400); assert.equal(late.json.error, 'bad_token');
    assert.equal((await cloud(t, t.host, 'POST', 'auth/reset', { body: { token: 'x'.repeat(43), password: 'made up token' } })).status, 400);
  });

  test('a token from one project does nothing on another', async () => {
    const other = publish(t, t.floor, 'other');
    await forgot(t, 'ann@example.com').catch(() => {});
    const rows = all(t.db, 'SELECT * FROM cloud_resets');
    assert.ok(rows.length <= 1);
    const token = await linkFor(t, 'ann@example.com', sentTo(t, 'ann@example.com').filter(tokenIn).length);
    const r = await cloud(t, other, 'POST', 'auth/reset', { body: { token, password: 'cross project' } });
    assert.equal(r.status, 400);
  });

  test('an older account adds an email with its password, and can then reset', async () => {
    const s = (await cloud(t, t.host, 'POST', 'auth/login', { body: { login: 'bob', password: 'correct horse' } })).json.session;
    assert.equal((await cloud(t, t.host, 'POST', 'auth/email', { session: s, body: { email: 'bob@example.com', password: 'wrong one' } })).status, 401);
    assert.equal((await cloud(t, t.host, 'POST', 'auth/email', { session: s, body: { email: 'ann@example.com', password: 'correct horse' } })).status, 409);
    const r = await cloud(t, t.host, 'POST', 'auth/email', { session: s, body: { email: 'bob@example.com', password: 'correct horse' } });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.user.email, 'bob@example.com');
    assert.equal((await cloud(t, t.host, 'GET', 'auth/email')).json.available, true);
  });

  test('the reset page is served on the project\'s own origin, with the page CSP and no referrer', async () => {
    const r = await hit(t, t.host, '/_office/reset');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.match(r.headers['content-security-policy'], /script-src 'self'/);
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.match(r.text, /src="reset\.js"/); assert.match(r.text, /src="office\.js"/);
    assert.match((await hit(t, t.host, '/_office/reset.js')).headers['content-type'], /^text\/javascript/);
    assert.match((await hit(t, t.host, '/_office/office.js')).text, /resetPassword/);
  });
});

describe('account email limits', () => {
  test('forgot password is rate-limited per address and per project', async () => {
    const t = await start({ trustProxy: true, cloudRateScale: 1, cloudRates: { forgotIp: [3, 3600000], forgotProject: [5, 3600000] } });
    const from = (ip) => ({ 'x-forwarded-for': ip });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await forgot(t, `x${i}@example.com`, from('203.0.113.1'))).status);
    assert.deepEqual(codes, [200, 200, 200, 429]);
    // Another address still has its own allowance, until the project's runs out (5 an hour here, 3 already taken).
    const more = [];
    for (let i = 0; i < 3; i++) more.push((await forgot(t, `y${i}@example.com`, from('203.0.113.2'))).status);
    assert.deepEqual(more, [200, 200, 429]);
    assert.equal((await forgot(t, 'z@example.com', from('203.0.113.3'))).status, 429);
  });

  test('one account gets a few links an hour at most, quietly, with the same answer', async () => {
    const t = await start({ cloudRates: { forgotAccount: [2, 3600000] }, cloudRateScale: 1 });
    await signUp(t, { email: 'cap@example.com' });
    for (let i = 0; i < 3; i++) assert.equal((await forgot(t, 'cap@example.com')).json.message, FORGOT_SENT);
    await until(() => sentTo(t, 'cap@example.com').filter(tokenIn).length >= 2, { what: 'two links' });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(sentTo(t, 'cap@example.com').filter(tokenIn).length, 2);
  });

  test('the per-project daily allowance stops account email, with a friendly answer, and sign-up still works', async () => {
    const t = await start({ appMailDaily: 1 });
    const a = await signUp(t, { email: 'one@example.com' });
    assert.equal(a.email.welcome, 'sending');
    await until(() => sentTo(t, 'one@example.com').length >= 1, { what: 'welcome' });
    const b = await signUp(t, { email: 'two@example.com' }, P2);
    assert.equal(b.email.welcome, 'full');
    const f = await forgot(t, 'one@example.com');
    assert.equal(f.status, 200); assert.equal(f.json.ok, false); assert.equal(f.json.message, MAIL_FULL);
    assert.equal(get(t.db, 'SELECT sent FROM cloud_mail_days').sent, 1);
    assert.equal((await cloud(t, t.host, 'GET', 'auth/email')).json.available, false);
  });

  test('account email counts against the floor\'s daily mail cap', async () => {
    const t = await start({ mailFloorDaily: 1 });
    await signUp(t, { email: 'first@example.com' });
    await until(() => sentTo(t, 'first@example.com').length >= 1, { what: 'welcome' });
    const r = await signUp(t, { email: 'second@example.com' }, P2);
    assert.equal(r.user.email, 'second@example.com');
    await until(() => get(t.db, "SELECT 1 x FROM mail_messages WHERE status='failed' AND to_addrs LIKE '%second@%'"), { what: 'the capped welcome to fail' });
    assert.equal(sentTo(t, 'second@example.com').length, 0);
    // What the cap stopped is handed back to the project's own allowance.
    assert.equal(get(t.db, 'SELECT sent FROM cloud_mail_days').sent, 1);
  });

  test('with no email in the building, sign-up works and forgot password answers kindly', async () => {
    const t = await start({}, { key: false });
    const r = await signUp(t, { username: 'zed', email: 'zed@example.com' });
    assert.equal(r.email.welcome, 'off');
    const f = await forgot(t, 'zed@example.com');
    assert.equal(f.status, 200); assert.equal(f.json.ok, false); assert.equal(f.json.message, MAIL_OFF);
    assert.deepEqual(f.json, (await forgot(t, 'unknown@example.com')).json);
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM cloud_resets').n, 0);
  });
});
