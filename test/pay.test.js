// Payments: Stripe Connect through the real provider code against a mock Stripe over real HTTP. No key, no real Stripe, no real money.
// The adversaries are a forged or replayed webhook, a page flipping its own flag, another project, and a hijacked bot.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { get, all, run } from '../server/db.js';
import { boot, claim, Client, until, sleep } from './helpers.js';
import { BASE, P1, P2, hit, publish, cloud } from './cloud-helpers.js';
import { startMockStripe } from '../server/cloud/pay-mock.js';
import { signStripe, verifyStripeSignature, keyMode, formEncode, hideKeys } from '../server/cloud/pay-provider.js';
import { salesSummary, payHas, payMode } from '../server/cloud/pay.js';
import { toolsForRole, toolDefs } from '../server/tools.js';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { openDb } from '../server/db.js';

const signUp = async (t, host, name, player = P1) => {
  const r = await cloud(t, host, 'POST', 'auth/signup', { body: { username: name, password: 'correct horse', email: `${name}@example.com` }, player });
  assert.equal(r.status, 201, r.text);
  return r.json;
};
const pay = (t, host, path, session, body) => cloud(t, host, body ? 'POST' : 'GET', `pay/${path}`, { session, body });
const has = async (t, host, session, product) => (await pay(t, host, `has?product=${product}`, session)).json.has;
async function connectBoss(t, mock, boss) {
  const r = await boss.post(`/api/floors/${boss.slug}/pay/connect`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const acct = get(t.db, "SELECT account FROM pay_accounts WHERE floor_id=(SELECT id FROM floors WHERE slug=?)", boss.slug).account;
  await mock.finishOnboarding(acct);
  return acct;
}
async function liveProduct(t, boss, floor, project, key, cents, billing, unlocks) {
  const out = t.app.engine.pay.propose(floor, 'Max', { project, key, name: key.toUpperCase(), priceCents: cents, billing, unlocks, why: 'Test' });
  const r = await boss.post(`/api/floors/${boss.slug}/pay/products/${out.id}/approve`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return out.id;
}
const buy = async (t, mock, host, session, product) => {
  const r = await pay(t, host, 'checkout', session, { product });
  assert.equal(r.json.ok, true, r.text);
  const u = new URL(r.json.url);
  const id = u.pathname.split('/').pop();
  await mock.payCheckout(u.searchParams.get('a'), id);
  return { id, acct: u.searchParams.get('a') };
};

describe('Stripe signatures', () => {
  const secret = 'whsec_test_secret', body = '{"id":"evt_1"}', now = 1700000000000, t = 1700000000;
  test('a good signature passes, and other schemes in the header are ignored', () => {
    const h = signStripe({ secret, timestamp: t, body });
    assert.deepEqual(verifyStripeSignature({ secret, header: h, body, now }), { ok: true, timestamp: t });
    assert.equal(verifyStripeSignature({ secret, header: `t=${t},v0=${'a'.repeat(64)},${h.split(',')[1]}`, body, now }).ok, true);
    assert.equal(verifyStripeSignature({ secret, header: h, body: Buffer.from(body), now }).ok, true);
  });
  test('wrong body, wrong secret, missing parts and non-hex are refused', () => {
    const h = signStripe({ secret, timestamp: t, body });
    for (const v of [
      verifyStripeSignature({ secret, header: h, body: '{"id":"evt_2"}', now }), verifyStripeSignature({ secret: 'whsec_other', header: h, body, now }),
      verifyStripeSignature({ secret, header: '', body, now }), verifyStripeSignature({ secret, header: `t=${t}`, body, now }), verifyStripeSignature({ secret, header: 'v1=abc', body, now }),
      verifyStripeSignature({ secret, header: `t=${t},v1=nothex`, body, now }), verifyStripeSignature({ secret: '', header: h, body, now }),
    ]) assert.equal(v.ok, false);
  });
  test('a timestamp too old or too far ahead is refused even with a good signature', () => {
    assert.equal(verifyStripeSignature({ secret, header: signStripe({ secret, timestamp: t - 301, body }), body, now }).reason, 'stale');
    assert.equal(verifyStripeSignature({ secret, header: signStripe({ secret, timestamp: t + 301, body }), body, now }).reason, 'stale');
    assert.equal(verifyStripeSignature({ secret, header: signStripe({ secret, timestamp: t - 299, body }), body, now }).ok, true);
  });
  test('keys are told apart, and form-encoding is Stripe\'s shape', () => {
    assert.equal(keyMode('sk_test_abc'), 'test'); assert.equal(keyMode('sk_live_abc'), 'live'); assert.equal(keyMode('rk_live_abc'), 'live'); assert.equal(keyMode('nope'), ''); assert.equal(keyMode(''), '');
    assert.equal(decodeURIComponent(formEncode({ a: { b: [{ c: 1 }, 'x'] }, skip: null })), 'a[b][0][c]=1&a[b][1]=x');
    assert.equal(hideKeys('oops sk_test_abcd1234 and whsec_xyz789 Bearer foo'), 'oops sk_test_[redacted] and whsec_[redacted] Bearer [redacted]');
  });
});

describe('with no Stripe key', () => {
  let t, boss, floor, host, session;
  before(async () => {
    t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', publicOrigin: 'https://main.test.example', cloudRateScale: 1000 });
    t.cfg.publicOrigin = '';
    boss = await claim(t, 'No Key Co'); floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
    host = publish(t, floor, 'shop');
    session = (await signUp(t, host, 'nokey_user')).session;
  });
  after(() => t.close());
  test('the boss is told payments are being set up, and connect is refused', async () => {
    const v = await boss.get(`/api/floors/${boss.slug}/pay`);
    assert.equal(v.status, 200); assert.equal(v.data.ready, false); assert.match(v.data.message, /being set up/i);
    const c = await boss.post(`/api/floors/${boss.slug}/pay/connect`, {});
    assert.equal(c.status, 503); assert.match(c.data.message, /being set up/i);
    const s = await boss.get(`/api/floors/${boss.slug}`);
    assert.equal(s.data.pay.ready, false);
  });
  test('office.pay answers with a friendly not-ready, not an error', async () => {
    const st = (await pay(t, host, 'status')).json;
    assert.equal(st.ready, false); assert.match(st.message, /being set up/i); assert.deepEqual(st.products, []);
    const c = await pay(t, host, 'checkout', session, { product: 'pro' });
    assert.equal(c.status, 200); assert.equal(c.json.ok, false); assert.equal(c.json.ready, false); assert.equal(c.json.code, 'not_ready'); assert.match(c.json.message, /being set up/i);
    assert.equal(await has(t, host, session, 'pro'), false);
    const m = await pay(t, host, 'manage', session, {});
    assert.equal(m.json.ok, false); assert.equal(m.json.code, 'not_ready');
  });
  test('the bot has no product tool and the webhook is switched off', async () => {
    assert.equal(toolDefs(toolsForRole('manager'), t.cfg, 'manager').some((d) => d.function.name === 'propose_product'), false);
    const r = await hit(t, t.host, '/theoffice/api/pay/webhook', { method: 'POST', body: '{}', headers: {} });
    assert.equal(r.status, 503);
    assert.equal(salesSummary(t.db, floor.id).grossCents, 0);
  });
});

describe('with Stripe connected (mock)', () => {
  let t, mock, boss, other, floor, otherFloor, shop, shop2, otherShop, acct, n = 0;
  const user = () => `buyer_${++n}`;
  const events = (type) => mock.state.delivered.filter((d) => d.event.type === type);
  const bodies = [];
  const look = (r) => { if (r?.text) bodies.push(r.text); else if (r?.data) bodies.push(JSON.stringify(r.data)); return r; };
  before(async () => {
    mock = await startMockStripe();
    t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', publicOrigin: 'https://main.test.example', stripeSecretKey: mock.apiKey, stripeWebhookSecret: mock.secret, stripeApiBase: mock.base, cloudRateScale: 1000 }, { paySleep: async () => {} });
    t.cfg.publicOrigin = '';
    mock.connect(`${t.base}/api/pay/webhook`);
    boss = await claim(t, 'Shop Co'); other = await claim(t, 'Other Co');
    floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug); otherFloor = get(t.db, 'SELECT * FROM floors WHERE slug=?', other.slug);
    shop = publish(t, floor, 'shop'); shop2 = publish(t, floor, 'shop2'); otherShop = publish(t, otherFloor, 'shop');
  });
  after(async () => { await t.close(); await mock.close(); });

  test('the Stripe key is in the mode the building expects, and test mode is marked', async () => {
    assert.equal(payMode(t.db), 'test');
    assert.equal((await pay(t, shop, 'status')).json.ready, false);
    assert.equal(t.app.engine.pay.ready, true);
    const v = await boss.get(`/api/floors/${boss.slug}/pay`);
    assert.equal(v.data.ready, true); assert.equal(v.data.testMode, true); assert.equal(v.data.account.state, 'none');
  });

  describe('connecting a boss', () => {
    test('nothing is on sale before the boss has a connected account', async () => {
      const u = await signUp(t, shop, user());
      const r = await pay(t, shop, 'checkout', u.session, { product: 'pro' });
      assert.equal(r.status, 200); assert.equal(r.json.ok, false); assert.equal(r.json.code, 'not_ready');
    });
    test('connecting creates the account with controller properties, the boss as seller, and a hosted onboarding link', async () => {
      const r = await boss.post(`/api/floors/${boss.slug}/pay/connect`, {});
      assert.equal(r.status, 200, JSON.stringify(r.data)); assert.match(r.data.url, /\/hosted\/onboard\//);
      const create = mock.state.requests.find((x) => x.path === '/v1/accounts');
      assert.ok(create.auth); assert.equal(create.version, '2026-10-28.endive');
      const b = decodeURIComponent(create.body);
      assert.match(b, /controller\[fees\]\[payer\]=account/); assert.match(b, /controller\[losses\]\[payments\]=stripe/); assert.match(b, /controller\[requirement_collection\]=stripe/); assert.match(b, /controller\[stripe_dashboard\]\[type\]=full/);
      assert.equal(create.idem.startsWith('office-account-'), true);
      const link = mock.state.requests.find((x) => x.path === '/v1/account_links');
      assert.match(decodeURIComponent(link.body), /type=account_onboarding/);
      assert.match(decodeURIComponent(link.body), /refresh_url=http:\/\/[^&]*\/theoffice\/floor\/shop-co\?pay=refresh/);
      assert.match(decodeURIComponent(link.body), /return_url=http:\/\/[^&]*\/theoffice\/floor\/shop-co\?pay=return/);
      const row = get(t.db, 'SELECT * FROM pay_accounts WHERE floor_id=?', floor.id);
      acct = row.account;
      assert.equal(row.charges_enabled, 0);
      const v = await boss.get(`/api/floors/${boss.slug}/pay`);
      assert.equal(v.data.account.state, 'incomplete');
      assert.ok(v.data.account.missing.includes('A bank account for your payouts'), JSON.stringify(v.data.account.missing));
      assert.ok(!JSON.stringify(v.data).includes('external_account'));
    });
    test('connecting again reuses the account and only makes a fresh link', async () => {
      const r = await boss.post(`/api/floors/${boss.slug}/pay/connect`, {});
      assert.equal(r.status, 200);
      assert.equal(mock.state.requests.filter((x) => x.path === '/v1/accounts').length, 1);
      assert.equal(mock.state.requests.filter((x) => x.path === '/v1/account_links').length, 2);
      assert.equal(all(t.db, 'SELECT * FROM pay_accounts WHERE floor_id=?', floor.id).length, 1);
    });
    test('an account.updated webhook moves it to ready, without a page reload', async () => {
      await mock.finishOnboarding(acct);
      const row = get(t.db, 'SELECT * FROM pay_accounts WHERE floor_id=?', floor.id);
      assert.equal(row.charges_enabled, 1); assert.equal(row.currency, 'usd');
      const v = await boss.get(`/api/floors/${boss.slug}/pay`);
      assert.equal(v.data.account.state, 'ready'); assert.deepEqual(v.data.account.missing, []);
      assert.equal((await pay(t, shop, 'status')).json.ready, true);
    });
    test('a hold Stripe puts on the account shows what is missing and stops new sales', async () => {
      await mock.setAccount(acct, { charges_enabled: false, requirements: { currently_due: ['individual.id_number'], past_due: [], disabled_reason: 'requirements.past_due', eventually_due: [], errors: [], pending_verification: [] } });
      const v = await boss.get(`/api/floors/${boss.slug}/pay`);
      assert.equal(v.data.account.state, 'review'); assert.ok(v.data.account.missing.includes('Your ID details'));
      assert.equal((await pay(t, shop, 'status')).json.ready, false);
      await mock.finishOnboarding(acct);
    });
  });

  describe('products, proposed by the team and approved by the boss', () => {
    const toolCtx = () => { const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id); return t.app.engine.toolCtx(floor, mgr, null, toolsForRole('manager')); };
    test('the manager proposes; nothing reaches Stripe and nothing goes on sale until the boss taps', async () => {
      const before = mock.state.requests.filter((x) => x.path === '/v1/products').length;
      const out = await t.app.engine.tools.exec(toolCtx(), 'propose_product', JSON.stringify({ project: 'shop', key: 'pro', name: 'Pro', description: 'All of it', price_cents: 900, billing: 'one_off', why: 'A fair first price' }));
      assert.match(String(out), /Nothing is on sale or changes unless they approve/);
      assert.equal(mock.state.requests.filter((x) => x.path === '/v1/products').length, before);
      assert.deepEqual((await pay(t, shop, 'status')).json.products, []);
      const s = await boss.get(`/api/floors/${boss.slug}`);
      assert.equal(s.data.pay.waiting.length, 1);
      assert.equal(s.data.pay.waiting[0].amountCents, 900); assert.equal(s.data.pay.waiting[0].key, 'pro');
      const u = await signUp(t, shop, user());
      assert.equal((await pay(t, shop, 'checkout', u.session, { product: 'pro' })).json.code, 'no_product');
    });
    test('a visitor\'s view of the floor carries no payment data at all', async () => {
      const anon = new Client(t);
      const s = await anon.get(`/api/floors/${boss.slug}`);
      assert.equal(s.status, 200); assert.equal(s.data.pay, undefined);
    });
    test('one tap makes it real on the boss\'s own account, and its price cannot change without another', async () => {
      const row = get(t.db, "SELECT * FROM pay_products WHERE floor_id=? AND key='pro' AND status='proposed'", floor.id);
      const r = await boss.post(`/api/floors/${boss.slug}/pay/products/${row.id}/approve`, {});
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const live = (await pay(t, shop, 'status')).json;
      assert.deepEqual(live.products, [{ key: 'pro', name: 'Pro', description: 'All of it', amountCents: 900, currency: 'usd', interval: null }]);
      const created = mock.state.requests.filter((x) => x.path === '/v1/products');
      assert.equal(created.length, 1); assert.equal(created[0].account, acct); assert.equal(created[0].idem, `office-product-${row.id}`);
      assert.equal(mock.state.requests.filter((x) => x.path === '/v1/prices').at(-1).account, acct);
      const again = await boss.post(`/api/floors/${boss.slug}/pay/products/${row.id}/approve`, {});
      assert.equal(again.status, 200);
      assert.equal(mock.state.requests.filter((x) => x.path === '/v1/products').length, 1);
    });
    test('a re-proposal is a price change: one approval, the old price retired, existing product kept', async () => {
      const out = t.app.engine.pay.propose(floor, 'Max', { project: 'shop', key: 'pro', name: 'Pro', priceCents: 1200, billing: 'one_off' });
      const before = (await pay(t, shop, 'status')).json.products[0].amountCents;
      assert.equal(before, 900);
      const oldPrice = get(t.db, "SELECT stripe_price FROM pay_products WHERE floor_id=? AND key='pro' AND status='live'", floor.id).stripe_price;
      const r = await boss.post(`/api/floors/${boss.slug}/pay/products/${out.id}/approve`, {});
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal((await pay(t, shop, 'status')).json.products[0].amountCents, 1200);
      assert.equal(mock.get(acct, 'prices', oldPrice).active, false);
      assert.equal(mock.state.requests.filter((x) => x.path === '/v1/products').length, 1);
    });
    test('a bad proposal is turned away with a reason, and nothing is stored', async () => {
      const bad = [
        { project: 'shop', key: 'x', name: 'X', price_cents: 10, billing: 'one_off' }, { project: 'shop', key: 'x', name: 'X', price_cents: 99999999, billing: 'one_off' },
        { project: 'shop', key: 'x', name: 'X', price_cents: 9.5, billing: 'one_off' }, { project: 'shop', key: 'x', name: 'X', price_cents: 500, billing: 'weekly' },
        { project: 'shop', key: 'x', name: 'X', price_cents: 500, billing: 'one_off', unlocks: ['../etc'] },
      ];
      const count = get(t.db, 'SELECT COUNT(*) n FROM pay_products').n;
      for (const a of bad) assert.match(String(await t.app.engine.tools.exec(toolCtx(), 'propose_product', JSON.stringify(a))), /^Error: /, JSON.stringify(a));
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM pay_products').n, count);
    });
    test('declining closes it', async () => {
      const out = t.app.engine.pay.propose(floor, 'Max', { project: 'shop', key: 'nope', name: 'Nope', priceCents: 500, billing: 'one_off' });
      const r = await boss.post(`/api/floors/${boss.slug}/pay/products/${out.id}/decline`, {});
      assert.equal(r.status, 200);
      assert.equal(get(t.db, 'SELECT status FROM pay_products WHERE id=?', out.id).status, 'declined');
      assert.equal((await boss.post(`/api/floors/${boss.slug}/pay/products/${out.id}/approve`, {})).status, 409);
    });
  });

  describe('buying and unlocking', () => {
    test('checkout makes a direct charge on the boss\'s account with no application fee, and a receipt', async () => {
      const u = await signUp(t, shop, user());
      assert.equal(await has(t, shop, u.session, 'pro'), false);
      const r = look(await pay(t, shop, 'checkout', u.session, { product: 'pro', returnPath: '/app?tab=plan' }));
      assert.equal(r.json.ok, true, r.text); assert.match(r.json.url, /\/hosted\/checkout\//);
      const req = mock.state.requests.filter((x) => x.path === '/v1/checkout/sessions').at(-1);
      assert.equal(req.account, acct); assert.ok(req.idem.startsWith('office-checkout-ord_'));
      const b = decodeURIComponent(req.body);
      assert.ok(!b.includes('application_fee'), b);
      assert.match(b, /mode=payment/); assert.match(b, /customer_creation=always/);
      assert.match(b, new RegExp(`success_url=https://${shop.replace(/\./g, '\\.')}/app\\?tab=plan&office_pay=success`));
      assert.match(b, /payment_intent_data\[receipt_email\]=buyer_\d+@example\.com/);
      assert.match(b, /metadata\[office_project\]=shop/);
      const id = new URL(r.json.url).pathname.split('/').pop();
      const again = await pay(t, shop, 'checkout', u.session, { product: 'pro' });
      assert.equal(again.json.url, r.json.url, 'an unfinished checkout is resumed, not made twice');
      assert.equal(await has(t, shop, u.session, 'pro'), false, 'not before the payment');
      await mock.payCheckout(acct, id);
      assert.equal(await has(t, shop, u.session, 'pro'), true);
      const sale = get(t.db, 'SELECT * FROM pay_sales WHERE floor_id=? ORDER BY id DESC', floor.id);
      assert.equal(sale.amount_cents, 1200); assert.ok(sale.payment_intent.startsWith('pi_'));
      const already = await pay(t, shop, 'checkout', u.session, { product: 'pro' });
      assert.equal(already.json.code, 'already_owned');
    });
    test('a guest has to log in first, and a guest\'s has is false', async () => {
      const r = await pay(t, shop, 'checkout', undefined, { product: 'pro' });
      assert.equal(r.status, 401); assert.equal(r.json.error, 'signed_out');
      assert.equal(await has(t, shop, undefined, 'pro'), false);
    });
    test('a return before the webhook still unlocks: the server asks Stripe', async () => {
      const u = await signUp(t, shop, user());
      const saved = mock.state.endpoints.splice(0);
      const { id } = await buy(t, mock, shop, u.session, 'pro');
      mock.state.endpoints.push(...saved);
      assert.equal(await has(t, shop, u.session, 'pro'), true, 'the session was looked up directly');
      const order = get(t.db, 'SELECT * FROM pay_orders WHERE session_id=?', id);
      assert.equal(order.status, 'active');
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM pay_sales WHERE order_id=?', order.id).n, 1);
    });
    test('an asynchronous payment unlocks when it clears, and not before, and a failure closes the order', async () => {
      const u1 = await signUp(t, shop, user()), u2 = await signUp(t, shop, user());
      const r1 = await pay(t, shop, 'checkout', u1.session, { product: 'pro' });
      const id1 = new URL(r1.json.url).pathname.split('/').pop();
      await mock.payCheckout(acct, id1, { asyncPayment: true });
      assert.equal(await has(t, shop, u1.session, 'pro'), false);
      await mock.finishAsync(acct, id1, true);
      assert.equal(await has(t, shop, u1.session, 'pro'), true);
      const r2 = await pay(t, shop, 'checkout', u2.session, { product: 'pro' });
      const id2 = new URL(r2.json.url).pathname.split('/').pop();
      await mock.payCheckout(acct, id2, { asyncPayment: true });
      await mock.finishAsync(acct, id2, false);
      assert.equal(await has(t, shop, u2.session, 'pro'), false);
      assert.equal(get(t.db, 'SELECT status FROM pay_orders WHERE session_id=?', id2).status, 'failed');
    });
    test('an expired checkout closes the order and doesn\'t block a new one', async () => {
      const u = await signUp(t, shop, user());
      const r = await pay(t, shop, 'checkout', u.session, { product: 'pro' });
      const id = new URL(r.json.url).pathname.split('/').pop();
      await mock.expireSession(acct, id);
      assert.equal(get(t.db, 'SELECT status FROM pay_orders WHERE session_id=?', id).status, 'expired');
      const r2 = await pay(t, shop, 'checkout', u.session, { product: 'pro' });
      assert.equal(r2.json.ok, true); assert.notEqual(r2.json.url, r.json.url);
    });
  });

  describe('subscriptions', () => {
    let sub, session, order;
    before(async () => { await liveProduct(t, boss, floor, 'shop', 'plus', 500, 'monthly'); });
    test('a subscription unlocks, shows as an active subscriber, and counts one sale', async () => {
      const u = await signUp(t, shop, user()); session = u.session;
      const { id } = await buy(t, mock, shop, session, 'plus');
      order = get(t.db, 'SELECT * FROM pay_orders WHERE session_id=?', id);
      assert.equal(order.status, 'active'); assert.equal(order.kind, 'subscription'); assert.ok(order.subscription.startsWith('sub_')); assert.equal(order.sub_status, 'active');
      assert.equal(await has(t, shop, session, 'plus'), true);
      const req = mock.state.requests.filter((x) => x.path === '/v1/checkout/sessions').at(-1);
      assert.match(decodeURIComponent(req.body), /mode=subscription/);
      assert.match(decodeURIComponent(req.body), /subscription_data\[metadata\]\[office_order\]/);
      assert.ok(!decodeURIComponent(req.body).includes('application_fee'));
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM pay_sales WHERE order_id=?', order.id).n, 1);
      sub = order.subscription;
    });
    test('each renewal is a sale and the subscriber keeps access', async () => {
      await mock.renew(acct, sub);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM pay_sales WHERE order_id=?', order.id).n, 2);
      assert.equal(await has(t, shop, session, 'plus'), true);
    });
    test('past_due keeps access while Stripe retries, as Stripe recommends', async () => {
      await mock.setSubscriptionStatus(acct, sub, 'past_due');
      assert.equal(await has(t, shop, session, 'plus'), true);
    });
    test('unpaid loses access, paying again restores it', async () => {
      await mock.setSubscriptionStatus(acct, sub, 'unpaid');
      assert.equal(await has(t, shop, session, 'plus'), false);
      assert.equal(get(t.db, 'SELECT status FROM pay_orders WHERE id=?', order.id).status, 'lapsed');
      await mock.setSubscriptionStatus(acct, sub, 'active');
      assert.equal(await has(t, shop, session, 'plus'), true);
    });
    test('cancelling ends access, and it reads as canceled for Stripe\'s truth even if events land out of order', async () => {
      await mock.setSubscriptionStatus(acct, sub, 'canceled');
      assert.equal(await has(t, shop, session, 'plus'), false);
      // An old "active" event delivered late must not bring it back: the handler reads the subscription fresh.
      mock.get(acct, 'subscriptions', sub).status = 'canceled';
      await mock.deliver('customer.subscription.updated', { ...mock.get(acct, 'subscriptions', sub), status: 'active' }, acct);
      assert.equal(await has(t, shop, session, 'plus'), false);
    });
    test('the customer portal is Stripe\'s, created on the boss\'s account, for the signed-in buyer only', async () => {
      const u = await signUp(t, shop, user());
      await buy(t, mock, shop, u.session, 'plus');
      const none = await signUp(t, shop, user());
      assert.equal((await pay(t, shop, 'manage', none.session, {})).json.code, 'nothing_to_manage');
      const r = look(await pay(t, shop, 'manage', u.session, { returnPath: '/account' }));
      assert.equal(r.json.ok, true, r.text);
      const reqCfg = mock.state.requests.filter((x) => x.path === '/v1/billing_portal/configurations');
      assert.equal(reqCfg.length, 1); assert.equal(reqCfg[0].account, acct);
      const reqS = mock.state.requests.filter((x) => x.path === '/v1/billing_portal/sessions').at(-1);
      assert.equal(reqS.account, acct); assert.match(decodeURIComponent(reqS.body), /return_url=https:\/\/.*\/account/);
      const r2 = await pay(t, shop, 'manage', u.session, {});
      assert.equal(r2.json.ok, true);
      assert.equal(mock.state.requests.filter((x) => x.path === '/v1/billing_portal/configurations').length, 1, 'one configuration per account');
      const ps = new URL(r.json.url); const res = await fetch(`${ps.origin}${ps.pathname}/cancel?a=${acct}`, { method: 'POST', redirect: 'manual' });
      assert.equal(res.status, 303);
      assert.equal(await has(t, shop, u.session, 'plus'), false);
    });
    test('an account with an active subscription can\'t be deleted out from under it', async () => {
      const u = await signUp(t, shop, user());
      await buy(t, mock, shop, u.session, 'plus');
      const r = await cloud(t, shop, 'POST', 'auth/delete', { session: u.session, body: { password: 'correct horse' } });
      assert.equal(r.status, 409); assert.equal(r.json.error, 'active_subscription');
    });
  });

  describe('refunds and disputes', () => {
    test('only the boss can refund; it refunds on Stripe, ends access, and a second tap doesn\'t refund twice', async () => {
      const u = await signUp(t, shop, user());
      const { id } = await buy(t, mock, shop, u.session, 'pro');
      const order = get(t.db, 'SELECT * FROM pay_orders WHERE session_id=?', id);
      assert.equal(await has(t, shop, u.session, 'pro'), true);
      const anon = new Client(t);
      assert.notEqual((await anon.post(`/api/floors/${boss.slug}/pay/orders/${order.token}/refund`, {})).status, 200);
      assert.notEqual((await other.post(`/api/floors/${boss.slug}/pay/orders/${order.token}/refund`, {})).status, 200);
      assert.equal(mock.list(acct, 'refunds').filter((re) => re.payment_intent === order.payment_intent).length, 0);
      const r = await boss.post(`/api/floors/${boss.slug}/pay/orders/${order.token}/refund`, {});
      assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.refundedCents, 1200);
      assert.equal(await has(t, shop, u.session, 'pro'), false);
      assert.equal(get(t.db, 'SELECT status FROM pay_orders WHERE id=?', order.id).status, 'refunded');
      const again = await boss.post(`/api/floors/${boss.slug}/pay/orders/${order.token}/refund`, {});
      assert.equal(again.status, 409);
      assert.equal(mock.list(acct, 'refunds').filter((re) => re.payment_intent === order.payment_intent).length, 1);
      const sale = get(t.db, 'SELECT * FROM pay_sales WHERE order_id=?', order.id);
      assert.equal(sale.refunded_cents, 1200);
      // Stripe's own charge.refunded arrives too. It must not change anything further or double it.
      assert.equal(events('charge.refunded').at(-1).status, 200);
      assert.equal(get(t.db, 'SELECT refunded_cents FROM pay_sales WHERE order_id=?', order.id).refunded_cents, 1200);
    });
    test('a refund started on Stripe\'s Dashboard also ends access; a partial one doesn\'t', async () => {
      const u = await signUp(t, shop, user());
      const { id } = await buy(t, mock, shop, u.session, 'pro');
      const order = get(t.db, 'SELECT * FROM pay_orders WHERE session_id=?', id);
      await mock.refundDirect(acct, { payment_intent: order.payment_intent, amount: 200 });
      assert.equal(await has(t, shop, u.session, 'pro'), true, 'a partial refund keeps it');
      assert.equal(get(t.db, 'SELECT refunded_cents FROM pay_sales WHERE order_id=?', order.id).refunded_cents, 200);
      await mock.refundDirect(acct, { payment_intent: order.payment_intent });
      assert.equal(await has(t, shop, u.session, 'pro'), false);
    });
    test('a subscription refund cancels it first and ends access at once', async () => {
      const u = await signUp(t, shop, user());
      const { id } = await buy(t, mock, shop, u.session, 'plus');
      const order = get(t.db, 'SELECT * FROM pay_orders WHERE session_id=?', id);
      const r = await boss.post(`/api/floors/${boss.slug}/pay/orders/${order.token}/refund`, {});
      assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.refundedCents, 500);
      assert.equal(mock.get(acct, 'subscriptions', order.subscription).status, 'canceled');
      assert.equal(await has(t, shop, u.session, 'plus'), false);
      assert.equal(get(t.db, 'SELECT status FROM pay_orders WHERE id=?', order.id).status, 'refunded');
    });
    test('a dispute ends access while it runs; winning brings it back', async () => {
      const u = await signUp(t, shop, user());
      const { id } = await buy(t, mock, shop, u.session, 'pro');
      const order = get(t.db, 'SELECT * FROM pay_orders WHERE session_id=?', id);
      const ch = mock.list(acct, 'charges').find((c) => c.payment_intent === order.payment_intent);
      await mock.dispute(acct, ch.id);
      assert.equal(await has(t, shop, u.session, 'pro'), false);
      await mock.dispute(acct, ch.id, { status: 'won' });
      assert.equal(await has(t, shop, u.session, 'pro'), true);
      await mock.dispute(acct, ch.id);
      await mock.dispute(acct, ch.id, { status: 'lost' });
      assert.equal(await has(t, shop, u.session, 'pro'), false);
      assert.equal(get(t.db, 'SELECT refunded_cents FROM pay_sales WHERE order_id=?', order.id).refunded_cents, 1200);
    });
  });

  describe('paid data is enforced by the server', () => {
    let buyer, free;
    before(async () => {
      await liveProduct(t, boss, floor, 'shop', 'vault', 700, 'one_off', ['vault', 'pro-notes']);
      buyer = await signUp(t, shop, user()); free = await signUp(t, shop, user());
      await buy(t, mock, shop, buyer.session, 'vault');
    });
    test('without the purchase every way into the collection answers 402, however the page dresses it up', async () => {
      const docPath = 'db/vault/secret-1';
      for (const [method, path, opts] of [
        ['POST', 'db/vault', { body: { data: { title: 'x' } } }],
        ['GET', 'db/vault', {}], ['GET', 'db/vault?count=1', {}], ['GET', docPath, {}],
        ['PUT', docPath, { body: { data: { title: 'y' } } }], ['PATCH', docPath, { body: { data: { title: 'z' } } }], ['DELETE', docPath, {}],
      ]) {
        const asGuest = await cloud(t, shop, method, path, { ...opts });
        const asFree = await cloud(t, shop, method, path, { ...opts, session: free.session, headers: { 'x-office-paid': '1' } });
        assert.equal(asGuest.status, 402, `${method} ${path} as guest ${asGuest.text}`);
        assert.equal(asFree.status, 402, `${method} ${path} as a free account ${asFree.text}`);
        assert.equal(asFree.json.error, 'payment_required');
      }
    });
    test('the buyer reads and writes as normal, and it isn\'t only one collection', async () => {
      const add = await cloud(t, shop, 'POST', 'db/vault', { session: buyer.session, body: { id: 'secret-1', data: { title: 'for payers' } } });
      assert.equal(add.status, 201, add.text);
      assert.equal((await cloud(t, shop, 'GET', 'db/vault', { session: buyer.session })).json.docs.length, 1);
      assert.equal((await cloud(t, shop, 'POST', 'db/pro-notes', { session: buyer.session, body: { data: { n: 1 } } })).status, 201);
      assert.equal((await cloud(t, shop, 'GET', 'db/pro-notes', { session: free.session })).status, 402);
    });
    test('an unrelated collection stays open, and a sibling or another floor\'s same-named collection isn\'t gated', async () => {
      assert.equal((await cloud(t, shop, 'POST', 'db/open', { session: free.session, body: { data: { a: 1 } } })).status, 201);
      assert.equal((await cloud(t, shop, 'GET', 'db/open')).status, 200);
      const other2 = await signUp(t, shop2, user());
      assert.equal((await cloud(t, shop2, 'POST', 'db/vault', { session: other2.session, body: { data: { a: 1 } } })).status, 201);
      const third = await signUp(t, otherShop, user());
      assert.equal((await cloud(t, otherShop, 'POST', 'db/vault', { session: third.session, body: { data: { a: 1 } } })).status, 201);
    });
    test('a refund shuts the door again, server-side', async () => {
      const order = get(t.db, "SELECT * FROM pay_orders WHERE owner=? AND product_key='vault'", `u:${buyer.user.id}`);
      assert.ok(order, 'the order is under the buyer\'s account');
      assert.equal((await cloud(t, shop, 'GET', 'db/vault', { session: buyer.session })).status, 200);
      const r = await boss.post(`/api/floors/${boss.slug}/pay/orders/${order.token}/refund`, {});
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal((await cloud(t, shop, 'GET', 'db/vault', { session: buyer.session })).status, 402);
    });
    test('payHas is the same answer for server code, scoped to the project', async () => {
      const u = await signUp(t, shop, user());
      await buy(t, mock, shop, u.session, 'pro');
      const key = `u:${u.user.id}`;
      assert.equal(payHas(t.db, floor.id, 'shop', key, 'pro'), true);
      assert.equal(payHas(t.db, floor.id, 'shop2', key, 'pro'), false);
      assert.equal(payHas(t.db, otherFloor.id, 'shop', key, 'pro'), false);
      assert.equal(payHas(t.db, floor.id, 'shop', key, 'plus'), false);
      assert.equal(t.app.engine.pay.has(floor.id, 'shop', key, 'pro'), true);
      assert.equal(payHas(t.db, floor.id, 'shop', 'g:guest', 'pro'), false);
      const row = get(t.db, "SELECT * FROM pay_orders WHERE owner=?", key);
      run(t.db, 'UPDATE pay_orders SET livemode=1 WHERE id=?', row.id);
      assert.equal(payHas(t.db, floor.id, 'shop', key, 'pro'), false, 'a live-mode row is nothing to a test key');
      run(t.db, 'UPDATE pay_orders SET livemode=0 WHERE id=?', row.id);
    });
    test('taking a product off sale keeps the door shut, and buyers keep what they paid for', async () => {
      const u = await signUp(t, shop, user());
      const id = await liveProduct(t, boss, floor, 'shop', 'closed', 700, 'one_off', ['closed-coll']);
      await buy(t, mock, shop, u.session, 'closed');
      const row = get(t.db, 'SELECT * FROM pay_products WHERE id=?', id);
      const r = await boss.post(`/api/floors/${boss.slug}/pay/products/${id}/archive`, {});
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(mock.get(acct, 'prices', row.stripe_price).active, false);
      assert.equal((await pay(t, shop, 'status')).json.products.some((p) => p.key === 'closed'), false);
      assert.equal(await has(t, shop, u.session, 'closed'), true);
      assert.equal((await cloud(t, shop, 'POST', 'db/closed-coll', { session: u.session, body: { data: { a: 1 } } })).status, 201);
      const free2 = await signUp(t, shop, user());
      assert.equal((await cloud(t, shop, 'GET', 'db/closed-coll', { session: free2.session })).status, 402);
      assert.equal((await pay(t, shop, 'checkout', free2.session, { product: 'closed' })).json.code, 'no_product');
    });
  });

  describe('project isolation', () => {
    test('a purchase in one project buys nothing in another, and products don\'t cross', async () => {
      const u = await signUp(t, shop, user());
      await buy(t, mock, shop, u.session, 'pro');
      const elsewhere = await signUp(t, shop2, user());
      assert.equal(await has(t, shop2, elsewhere.session, 'pro'), false);
      assert.equal((await pay(t, shop2, 'status')).json.products.length, 0);
      assert.equal((await pay(t, shop2, 'checkout', elsewhere.session, { product: 'pro' })).json.code, 'no_product');
      const third = await signUp(t, otherShop, user());
      assert.equal(await has(t, otherShop, third.session, 'pro'), false);
    });
    test('another project\'s page can\'t reach this one\'s payments', async () => {
      const u = await signUp(t, shop, user());
      const crossed = await cloud(t, shop, 'POST', 'pay/checkout', { session: u.session, body: { product: 'pro' }, origin: `https://${shop2}` });
      assert.equal(crossed.status, 403); assert.equal(crossed.json.error, 'bad_origin');
      const noOrigin = await cloud(t, shop, 'POST', 'pay/checkout', { session: u.session, body: { product: 'pro' }, origin: null });
      assert.equal(noOrigin.status, 403);
    });
    test('the success URL can only be on this site\'s own origin', async () => {
      const u = await signUp(t, shop, user());
      for (const returnPath of ['//evil.example/x', 'https://evil.example/', '/\\evil.example', 'javascript:alert(1)']) {
        const r = await pay(t, shop, 'checkout', u.session, { product: 'plus', returnPath });
        assert.equal(r.json.ok, true, r.text);
        const req = mock.state.requests.filter((x) => x.path === '/v1/checkout/sessions').at(-1);
        assert.match(decodeURIComponent(req.body), new RegExp(`success_url=https://${shop.replace(/\./g, '\\.')}/\\?office_pay=success`), `${returnPath} -> ${decodeURIComponent(req.body).slice(0, 300)}`);
        await mock.expireSession(acct, new URL(r.json.url).pathname.split('/').pop());
      }
    });
  });

  describe('webhooks', () => {
    const post = (payload, header) => hit(t, t.host, '/theoffice/api/pay/webhook', { method: 'POST', raw: Buffer.from(payload), type: 'application/json', headers: header ? { 'stripe-signature': header } : {} });
    const signed = (payload, secret = mock.secret, ts = Math.floor(Date.now() / 1000)) => signStripe({ secret, timestamp: ts, body: payload });
    const evt = (over = {}) => JSON.stringify({ id: `evt_test${Math.random().toString(36).slice(2)}abc`, object: 'event', api_version: '2026-10-28.endive', created: 1, livemode: false, type: 'invoice.created', account: acct, data: { object: { id: 'in_x', object: 'invoice' } }, ...over });
    test('no signature, a wrong secret and a tampered body are refused, and the raw bytes are what count', async () => {
      const p = evt();
      assert.equal((await post(p)).status, 400);
      assert.equal((await post(p, signed(p, 'whsec_wrong'))).status, 400);
      assert.equal((await post(`${p} `, signed(p))).status, 400);
      const ok = evt();
      assert.equal((await post(ok, signed(ok))).status, 200);
      assert.equal((await post(ok.replace('"object":"event"', '"object": "event"'), signed(ok))).status, 400, 'a JSON re-serialisation is a different body');
    });
    test('a stale delivery is refused, even with the right secret', async () => {
      const p = evt();
      assert.equal((await post(p, signed(p, mock.secret, Math.floor(Date.now() / 1000) - 400))).status, 400);
      assert.equal((await post(p, signed(p, mock.secret, Math.floor(Date.now() / 1000) + 400))).status, 400);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM pay_events WHERE id=?', JSON.parse(p).id).n, 0);
    });
    test('the same event twice is processed once: replays change nothing and don\'t double the books', async () => {
      const u = await signUp(t, shop, user());
      const { id } = await buy(t, mock, shop, u.session, 'pro');
      const order = get(t.db, 'SELECT * FROM pay_orders WHERE session_id=?', id);
      const ev = mock.state.delivered.filter((d) => d.event.type === 'checkout.session.completed').at(-1).event;
      const payload = JSON.stringify(ev);
      const first = await post(payload, signed(payload));
      assert.equal(first.status, 200); assert.equal(first.json.duplicate, true);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM pay_sales WHERE order_id=?', order.id).n, 1);
      // A second Stripe event object about the same thing, as Stripe warns can happen.
      const twin = JSON.stringify({ ...ev, id: 'evt_twinabcdefgh' });
      assert.equal((await post(twin, signed(twin))).status, 200);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM pay_sales WHERE order_id=?', order.id).n, 1);
      assert.equal(get(t.db, 'SELECT status FROM pay_orders WHERE id=?', order.id).status, 'active');
      // A replayed completion can't reopen an order that has since been refunded.
      await boss.post(`/api/floors/${boss.slug}/pay/orders/${order.token}/refund`, {});
      const late = JSON.stringify({ ...ev, id: 'evt_lateabcdefgh' });
      await post(late, signed(late));
      assert.equal(get(t.db, 'SELECT status FROM pay_orders WHERE id=?', order.id).status, 'refunded');
      assert.equal(await has(t, shop, u.session, 'pro'), false);
    });
    test('events for an unknown account or the other mode are acknowledged and ignored', async () => {
      const a = evt({ account: 'acct_nobodyatall', type: 'charge.refunded' });
      const r = await post(a, signed(a)); assert.equal(r.status, 200); assert.equal(r.json.ignored, 'account');
      const b = evt({ livemode: true });
      const r2 = await post(b, signed(b)); assert.equal(r2.status, 200); assert.equal(r2.json.ignored, 'mode');
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM pay_events WHERE account=?', 'acct_nobodyatall').n, 0);
    });
    test('the boss\'s other Stripe business is left alone and costs no API calls', async () => {
      const calls = () => mock.state.requests.length;
      const before = calls();
      for (const [type, object] of [
        ['customer.subscription.updated', { id: 'sub_theirs', object: 'subscription', status: 'canceled', metadata: {} }],
        ['invoice.paid', { id: 'in_theirs', object: 'invoice', amount_paid: 99, parent: { subscription_details: { subscription: 'sub_theirs', metadata: {} } } }],
        ['checkout.session.completed', { id: 'cs_theirs', object: 'checkout.session', status: 'complete', payment_status: 'paid', mode: 'subscription', subscription: 'sub_theirs', metadata: {} }],
        ['charge.refunded', { id: 'ch_theirs', object: 'charge', refunded: true, amount_refunded: 500, amount: 500, payment_intent: 'pi_theirs', metadata: {} }],
      ]) {
        const p = evt({ type, data: { object } });
        const r = await post(p, signed(p));
        assert.equal(r.status, 200, `${type} ${r.text}`);
      }
      assert.equal(calls(), before, 'no Stripe call for anything that is not ours');
    });
    test('malformed JSON and non-events are refused; a retryable failure asks Stripe to try again', async () => {
      const bad = 'not json';
      assert.equal((await post(bad, signed(bad))).status, 400);
      const noId = JSON.stringify({ type: 'x', data: {} });
      assert.equal((await post(noId, signed(noId))).status, 400);
      const payload = evt({ type: 'customer.subscription.updated', data: { object: { id: 'sub_nonexistent', object: 'subscription', metadata: { office_order: 'ord_x' } } } });
      mock.state.failNext.push({ status: 500 }, { status: 500 });
      const r = await post(payload, signed(payload));
      assert.equal(r.status, 500, r.text);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM pay_events WHERE id=?', JSON.parse(payload).id).n, 0, 'not marked done, so Stripe\'s retry still counts');
    });
    test('a platform deauthorization is recorded and stops sales', async () => {
      const row = get(t.db, 'SELECT disconnected_at FROM pay_accounts WHERE floor_id=?', floor.id);
      assert.equal(row.disconnected_at, null);
      await mock.deauthorize(acct);
      assert.ok(get(t.db, 'SELECT disconnected_at FROM pay_accounts WHERE floor_id=?', floor.id).disconnected_at);
      assert.equal((await pay(t, shop, 'status')).json.ready, false);
      run(t.db, 'UPDATE pay_accounts SET disconnected_at=NULL WHERE floor_id=?', floor.id);
    });
  });

  describe('boss-only and bots', () => {
    test('the panel, approvals and refunds answer only the floor\'s own boss', async () => {
      const anon = new Client(t);
      const row = get(t.db, "SELECT id FROM pay_products WHERE floor_id=? AND status='live' LIMIT 1", floor.id);
      for (const [method, path, body] of [
        ['GET', `/api/floors/${boss.slug}/pay`], ['POST', `/api/floors/${boss.slug}/pay/connect`, {}],
        ['POST', `/api/floors/${boss.slug}/pay/products/${row.id}/approve`, {}], ['POST', `/api/floors/${boss.slug}/pay/products/${row.id}/decline`, {}], ['POST', `/api/floors/${boss.slug}/pay/products/${row.id}/archive`, {}],
      ]) {
        for (const c of [anon, other]) {
          const r = method === 'GET' ? await c.get(path) : await c.post(path, body);
          assert.notEqual(r.status, 200, `${method} ${path}`);
        }
      }
    });
    test('a bot has no way to charge, change a price, refund or approve; only the manager can propose', async () => {
      const every = ['manager', 'builder', 'designer', 'illustrator', 'tester', 'marketer', 'researcher', 'writer'];
      for (const role of every) {
        const names = toolsForRole(role);
        assert.ok(!names.some((n) => /refund|charge|price|approve|checkout|stripe|payout/i.test(n)), `${role}: ${names}`);
      }
      assert.ok(toolDefs(toolsForRole('manager'), t.cfg, 'manager').some((d) => d.function.name === 'propose_product'));
      assert.ok(!toolDefs(toolsForRole('builder'), t.cfg, 'builder').some((d) => d.function.name === 'propose_product'));
      const defs = JSON.stringify(toolDefs(toolsForRole('manager'), t.cfg, 'manager'));
      assert.ok(!/\$\d/.test(JSON.stringify(toolDefs(['propose_product'], t.cfg, 'manager'))), 'no dollar figures in the tool');
      assert.ok(defs.includes('propose_product'));
    });
    test('the team\'s state line is about products, not sales', async () => {
      const line = t.app.engine.pay.stateLine(floor);
      assert.match(line, /Payments: Stripe connected/);
      assert.ok(!/\$\d|gross|\d+\.\d\d/.test(line), line);
    });
  });

  describe('sales summary, and no key anywhere', () => {
    test('salesSummary totals, refunds, active subscribers and days, for this floor only', async () => {
      const s = salesSummary(t.db, floor.id, { days: 30 });
      assert.equal(s.currency, 'usd');
      assert.ok(s.grossCents > 0); assert.ok(s.refundsCents > 0); assert.ok(s.orders > 3); assert.ok(s.activeSubs >= 1);
      assert.equal(s.byDay.length, 1);
      assert.equal(s.byDay[0].day, new Date().toISOString().slice(0, 10));
      assert.equal(s.byDay[0].grossCents, s.grossCents); assert.equal(s.byDay[0].orders, s.orders);
      assert.deepEqual(Object.keys(s).sort(), ['activeSubs', 'byDay', 'currency', 'grossCents', 'orders', 'refundsCents']);
      assert.deepEqual(salesSummary(t.db, otherFloor.id), { currency: 'usd', grossCents: 0, refundsCents: 0, orders: 0, activeSubs: 0, byDay: [] });
    });
    test('a boss sees sales on the panel, and a visitor sees nothing of them anywhere', async () => {
      const v = await boss.get(`/api/floors/${boss.slug}/pay`);
      assert.equal(v.data.sales.currency, 'usd'); assert.ok(v.data.orders.length > 0);
      const o = v.data.orders.find((x) => x.status === 'refunded');
      assert.equal(o.refundable, false);
      const active = v.data.orders.find((x) => x.status === 'active' && x.kind === 'one_off');
      assert.equal(active.refundable, true);
      const anon = new Client(t);
      const s = await anon.get(`/api/floors/${boss.slug}`);
      for (const needle of ['grossCents', 'activeSubs', 'office_order', 'stripe']) assert.ok(!JSON.stringify(s.data).toLowerCase().includes(needle.toLowerCase()), needle);
    });
    test('no response and no log holds the key or the webhook secret', async () => {
      const u = await signUp(t, shop, user());
      for (const r of [await pay(t, shop, 'status'), await pay(t, shop, 'checkout', u.session, { product: 'pro' }), await boss.get(`/api/floors/${boss.slug}/pay`), await boss.get(`/api/floors/${boss.slug}`)]) look(r);
      const hay = [...bodies, ...t.logs].join('\n');
      assert.ok(bodies.length > 3);
      assert.ok(!hay.includes(mock.apiKey), 'key in a response or log');
      assert.ok(!hay.includes(mock.secret), 'secret in a response or log');
      assert.ok(!hay.includes('whsec_'));
    });
    test('a failure talking to Stripe gives the page a friendly message and logs without the key', async () => {
      const u = await signUp(t, shop, user());
      mock.state.failNext.push({ status: 500, message: `boom ${mock.apiKey}` }, { status: 500, message: `boom ${mock.apiKey}` });
      const r = await pay(t, shop, 'checkout', u.session, { product: 'pro' });
      assert.equal(r.status, 200); assert.equal(r.json.ok, false); assert.equal(r.json.code, 'unavailable');
      assert.ok(!r.text.includes(mock.apiKey));
      assert.ok(!t.logs.join('\n').includes(mock.apiKey));
      assert.ok(t.logs.join('\n').includes('pay_checkout_failed'));
    });
  });
});

describe('checkout creation is rate limited', () => {
  let t, mock, boss, floor, shop;
  before(async () => {
    mock = await startMockStripe();
    t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', publicOrigin: 'https://main.test.example', stripeSecretKey: mock.apiKey, stripeWebhookSecret: mock.secret, stripeApiBase: mock.base, cloudRateScale: 1, cloudRates: { payCheckoutIp: [2, 60000], payCheckoutAccount: [100, 60000], payCheckoutProject: [100, 60000] } });
    t.cfg.publicOrigin = '';
    mock.connect(`${t.base}/api/pay/webhook`);
    boss = await claim(t, 'Rate Co');
    floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
    shop = publish(t, floor, 'shop');
    await connectBoss(t, mock, boss);
    await liveProduct(t, boss, floor, 'shop', 'pro', 900, 'one_off');
  });
  after(async () => { await t.close(); await mock.close(); });
  test('a burst from one address is held back', async () => {
    const u = await signUp(t, shop, 'buyer_x');
    const codes = [];
    for (let i = 0; i < 4; i++) { const r = await pay(t, shop, 'checkout', u.session, { product: 'pro' }); codes.push(r.status); }
    assert.deepEqual(codes.slice(0, 2), [200, 200]);
    assert.ok(codes.slice(2).every((c) => c === 429), String(codes));
  });
});

// The child process needs the mock's event loop free, so it runs through a worker-free async spawn.
const spawnAsync = (fn, ...args) => new Promise((resolve) => { import('node:child_process').then(({ spawn }) => {
  const c = spawn(process.execPath, [join(fileURLToPath(new URL('..', import.meta.url)), 'scripts/pay-setup.mjs'), ...args], { env: fn.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  c.on('close', (status) => resolve({ status, stdout, stderr }));
}); });

describe('the admin and setup scripts', () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const scriptEnv = (extra) => ({ ...process.env, AI_MODE: 'mock', ...extra });
  const cli = (dir, ...args) => { try { return { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'scripts/admin.mjs'), ...args], { env: scriptEnv({ DATA_DIR: dir }), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; } };
  test('pay status and pay disconnect work on the database, without a key and without sales figures', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pay-admin-'));
    const db = openDb(dir);
    run(db, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at) VALUES ('gadget-co',7,'Gadget Co','{}','{}','{}','x',1)");
    const F = get(db, "SELECT id FROM floors WHERE slug='gadget-co'").id;
    run(db, "INSERT INTO pay_accounts (floor_id,livemode,account,charges_enabled,payouts_enabled,details_submitted,missing,created_at,updated_at) VALUES (?,1,'acct_live',1,1,1,'[\"external_account\"]',1,1)", F);
    run(db, "INSERT INTO pay_products (floor_id,project,livemode,key,name,amount_cents,currency,status,created_at,updated_at) VALUES (?,'x',1,'pro','Pro',900,'usd','live',1,1)", F);
    run(db, "INSERT INTO pay_sales (order_id,floor_id,livemode,ref,amount_cents,currency,day,created_at) VALUES (1,?,1,'cs_x',12345,'usd','2026-01-01',1)", F);
    db.close();
    const st = cli(dir, 'pay', 'status', '7');
    assert.equal(st.code, 0, st.out);
    assert.match(st.out, /Floor 7/); assert.match(st.out, /LIVE acct_live: taking payments/); assert.match(st.out, /external_account/); assert.match(st.out, /1 on sale/);
    assert.ok(!/12345|123\.45/.test(st.out), 'no sales figures');
    assert.match(cli(dir, 'pay', 'status', 'gadget-co').out, /LIVE acct_live/);
    assert.notEqual(cli(dir, 'pay', 'status', '99').code, 0);
    const d = cli(dir, 'pay', 'disconnect', '7');
    assert.equal(d.code, 0, d.out); assert.match(d.out, /can no longer start new sales/);
    assert.match(cli(dir, 'pay', 'status', '7').out, /disconnected/);
    rmSync(dir, { recursive: true, force: true });
  });
  test('pay-setup makes a Connect endpoint, writes the signing secret mode 600, and prints neither secret nor key', async () => {
    const mock = await startMockStripe();
    const dir = mkdtempSync(join(tmpdir(), 'pay-setup-'));
    const file = join(dir, 'whsec.txt');
    const run1 = { env: scriptEnv({ STRIPE_SECRET_KEY: mock.apiKey, STRIPE_API_BASE: mock.base }) };
    const done = await spawnAsync(run1, file, '--endpoint', 'https://iscolinfree.com/theoffice/api/pay/webhook');
    assert.equal(done.status, 0, done.stderr);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(readFileSync(file, 'utf8').trim(), mock.secret);
    assert.ok(!done.stdout.includes(mock.secret) && !done.stdout.includes(mock.apiKey) && !done.stderr.includes(mock.secret) && !done.stderr.includes(mock.apiKey));
    assert.match(done.stdout, /Connect webhook endpoint/);
    assert.equal(mock.state.endpoints.length, 1);
    const ep = mock.state.endpoints[0];
    assert.equal(ep.application, 'ca_mock'); assert.equal(ep.api_version, '2026-10-28.endive'); assert.equal(ep.url, 'https://iscolinfree.com/theoffice/api/pay/webhook');
    assert.ok(ep.enabled_events.includes('checkout.session.completed') && ep.enabled_events.includes('customer.subscription.deleted') && ep.enabled_events.includes('account.updated'));
    assert.equal(mock.state.requests.filter((r) => r.path === '/v1/webhook_endpoints' && r.method === 'POST').length, 1);
    const twice = await spawnAsync(run1, file);
    assert.equal(twice.status, 0, twice.stderr); assert.match(twice.stdout, /already exists/);
    assert.equal(mock.state.endpoints.length, 1);
    const noFile = await spawnAsync(run1, join(dir, 'other.txt'));
    assert.notEqual(noFile.status, 0); assert.match(noFile.stderr, /--rotate/);
    const rotated = await spawnAsync(run1, join(dir, 'other.txt'), '--rotate');
    assert.equal(rotated.status, 0, rotated.stderr);
    assert.equal(mock.state.endpoints.length, 1, 'the old endpoint is gone');
    const noKey = spawnSync(process.execPath, [join(ROOT, 'scripts/pay-setup.mjs'), file], { env: scriptEnv({ STRIPE_SECRET_KEY: '' }), encoding: 'utf8' });
    assert.notEqual(noKey.status, 0); assert.match(noKey.stderr, /STRIPE_SECRET_KEY/);
    rmSync(dir, { recursive: true, force: true });
    await mock.close();
  });
});
