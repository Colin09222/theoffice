// Selling: a shop's basket through Stripe's hosted checkout (mock Stripe over real HTTP), a guest buyer, an address for things that are posted,
// the buyer's confirmation, and the sale reaching the boss alone. No key, no real Stripe, no real money, no real email.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { get, all } from '../server/db.js';
import { boot, claim, until } from './helpers.js';
import { BASE, P1, P2, P3, publish, cloud, hit } from './cloud-helpers.js';
import { signStripe } from '../server/cloud/pay-provider.js';
import { startMockStripe } from '../server/cloud/pay-mock.js';
import { startMockResend } from '../server/mail-mock.js';
import { orderNumber, salesSummary } from '../server/cloud/pay.js';
import { checkCatalogue } from '../server/shop.js';

const pay = (t, host, path, { session, body, player = P1 } = {}) => cloud(t, host, body ? 'POST' : 'GET', `pay/${path}`, { session, body, player });
const CATALOGUE = { products: [
  { key: 'lavender', name: 'Lavender candle', description: 'Soy wax, 40 hours.', price: 12, priceFrom: 'boss', ships: true, image: 'images/lavender.jpg' },
  { key: 'cedar', name: 'Cedar candle', description: 'Soy wax, 40 hours.', price: 14.5, priceFrom: 'proposed', ships: true, image: 'images/cedar.jpg' },
] };

describe('a shop: basket, guest buyer, address, confirmation, and the sale reaching the boss', () => {
  let t, mock, mail, boss, floor, shop, acct;
  before(async () => {
    mock = await startMockStripe(); mail = await startMockResend();
    t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', publicOrigin: 'https://main.test.example', stripeSecretKey: mock.apiKey, stripeWebhookSecret: mock.secret, stripeApiBase: mock.base, cloudRateScale: 1000,
      resendApiKey: mail.apiKey, resendWebhookSecret: mail.webhookSecret, resendApiBase: mail.base, mailTickMs: 30 }, { paySleep: async () => {} });
    t.cfg.publicOrigin = '';
    t.app.engine.runManager = async () => {};
    mock.connect(`${t.base}/api/pay/webhook`);
    boss = await claim(t, 'Wick & Co');
    floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
    shop = publish(t, floor, 'candles');
  });
  after(async () => { await t.close(); await mock.close(); await mail.close(); });

  test('the catalogue is the proposal: publishing a shop puts every product in front of the boss, and nothing is on sale yet', async () => {
    const r = t.app.engine.pay.proposeCatalogue(floor, 'candles', CATALOGUE, 'Bea');
    assert.deepEqual(r.proposed, ['lavender', 'cedar']); assert.deepEqual(r.problems, []);
    const again = t.app.engine.pay.proposeCatalogue(floor, 'candles', CATALOGUE, 'Bea');
    assert.deepEqual(again.proposed, []); assert.deepEqual(again.already, ['lavender', 'cedar'], 'publishing again asks nothing twice');
    const rows = all(t.db, "SELECT key, amount_cents, ships, status, why FROM pay_products WHERE floor_id=? ORDER BY id", floor.id);
    assert.deepEqual(rows.map((x) => [x.key, x.amount_cents, x.ships, x.status]), [['lavender', 1200, 1, 'proposed'], ['cedar', 1450, 1, 'proposed']]);
    assert.match(rows[0].why, /price you gave/i); assert.match(rows[1].why, /proposed price/i);
    assert.equal(mock.state.requests.filter((x) => x.path === '/v1/products').length, 0, 'nothing reaches Stripe before the boss taps');
    const st = (await pay(t, shop, 'status')).json;
    assert.equal(st.ready, false); assert.deepEqual(st.products, []);
    const c = await pay(t, shop, 'checkout', { body: { items: [{ product: 'lavender', quantity: 1 }] } });
    assert.equal(c.json.ok, false); assert.equal(c.json.code, 'not_ready'); assert.match(c.json.message, /isn't ready to take payments yet/);
  });
  test('a changed price replaces the waiting proposal instead of stacking a second one', () => {
    const r = t.app.engine.pay.proposeCatalogue(floor, 'candles', { products: [{ ...CATALOGUE.products[1], price: 15 }] }, 'Bea');
    assert.deepEqual(r.proposed, ['cedar']);
    assert.deepEqual(all(t.db, "SELECT amount_cents FROM pay_products WHERE floor_id=? AND key='cedar' AND status='proposed'", floor.id).map((x) => x.amount_cents), [1500]);
    t.app.engine.pay.proposeCatalogue(floor, 'candles', CATALOGUE, 'Bea');
  });
  test('a bad line in the catalogue is reported in words and stops nothing else', () => {
    const r = t.app.engine.pay.proposeCatalogue(floor, 'candles', { products: [{ key: 'Bad Key!', name: 'X', price: 5 }, { key: 'free', name: 'Free', price: 0 }] }, 'Bea');
    assert.equal(r.proposed.length, 0); assert.equal(r.problems.length, 2);
  });
  test('the boss connects Stripe and approves everything waiting with one tap of their own', async () => {
    const before = await boss.get(`/api/floors/${boss.slug}`);
    assert.equal(before.data.pay.connected, false); assert.equal(before.data.pay.waiting.length, 2);
    const c = await boss.post(`/api/floors/${boss.slug}/pay/connect`, {});
    assert.equal(c.status, 200);
    acct = get(t.db, 'SELECT account FROM pay_accounts WHERE floor_id=?', floor.id).account;
    await mock.finishOnboarding(acct);
    const stranger = await claim(t, 'Nosy Co');
    assert.equal((await stranger.post(`/api/floors/${boss.slug}/pay/products/approve-all`, {})).status, 403, 'only this floor\'s boss');
    const r = await boss.post(`/api/floors/${boss.slug}/pay/products/approve-all`, {});
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.approved, 2);
    const st = (await pay(t, shop, 'status')).json;
    assert.equal(st.ready, true);
    assert.deepEqual(st.products.map((p) => [p.key, p.amountCents, p.ships]), [['lavender', 1200, true], ['cedar', 1450, true]]);
  });
  test('a guest buys a basket: one Stripe session with every line, the address asked on Stripe\'s page, no application fee', async () => {
    const r = await pay(t, shop, 'checkout', { player: P2, body: { items: [{ product: 'lavender', quantity: 2 }, { product: 'cedar', quantity: 1 }], returnPath: '/' } });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.ok, true, r.text);
    const b = decodeURIComponent(mock.state.requests.filter((x) => x.path === '/v1/checkout/sessions').at(-1).body);
    assert.match(b, /line_items\[0\]\[quantity\]=2/); assert.match(b, /line_items\[1\]\[quantity\]=1/);
    assert.match(b, /shipping_address_collection\[allowed_countries\]\[0\]=US/);
    assert.ok(!b.includes('application_fee'), b);
    assert.match(b, /office_pay=success&office_order=ord_/);
    const u = new URL(r.json.url);
    const pending = (await pay(t, shop, `order?token=${r.json.order}`, { player: P3 })).json;
    assert.equal(pending.paid, false); assert.equal(pending.status, 'pending');
    await mock.payCheckout(u.searchParams.get('a'), u.pathname.split('/').pop(), { email: 'sam@example.com' });
    const o = get(t.db, 'SELECT * FROM pay_orders WHERE token=?', r.json.order);
    assert.equal(o.status, 'active'); assert.equal(o.amount_cents, 3850); assert.equal(o.email, 'sam@example.com');
    assert.match(o.ship_to, /12 Test Lane/);
    assert.equal(salesSummary(t.db, floor.id).grossCents, 3850);
  });
  test('the buyer sees their order on the site and gets a confirmation email from the company', async () => {
    const o = get(t.db, "SELECT * FROM pay_orders WHERE floor_id=? AND status='active' ORDER BY id DESC", floor.id);
    const v = (await pay(t, shop, `order?token=${o.token}`, { player: P3 })).json;
    assert.equal(v.ok, true); assert.equal(v.paid, true); assert.equal(v.number, orderNumber(o.token)); assert.equal(v.totalCents, 3850); assert.equal(v.testMode, true);
    assert.deepEqual(v.items.map((i) => [i.name, i.quantity]), [['Lavender candle', 2], ['Cedar candle', 1]]);
    assert.equal(JSON.stringify(v).includes('Test Lane'), false, 'the address is never sent back to a browser');
    assert.equal((await pay(t, shop, 'order?token=ord_not_a_real_token_x', { player: P3 })).json.ok, false);
    const mine = (await pay(t, shop, 'order', { player: P2 })).json;
    assert.equal(mine.number, v.number, 'without a token, the buyer\'s own browser still finds it');
    assert.equal((await pay(t, shop, 'order', { player: P3 })).json.ok, false, 'and nobody else\'s does');
    await until(() => mail.state.sent.some((m) => String(m.to).includes('sam@example.com')));
    const m = mail.state.sent.find((x) => String(x.to).includes('sam@example.com'));
    assert.match(m.subject, new RegExp(`Your order from .* \\(${v.number}\\)`));
    assert.match(m.text, /2 x Lavender candle/); assert.match(m.text, /\$38\.50/); assert.match(m.text, /12 Test Lane/); assert.match(m.text, /test payment/i);
    await until(() => get(t.db, 'SELECT told_buyer FROM pay_orders WHERE id=?', o.id).told_buyer === 1);
  });
  test('the sale reaches the boss: Payments shows what to send and where, the company inbox has it, and a replayed webhook tells nobody twice', async () => {
    const v = (await boss.get(`/api/floors/${boss.slug}/pay`)).data;
    const o = v.orders[0];
    assert.equal(o.email, 'sam@example.com'); assert.deepEqual(o.items, [{ name: 'Lavender candle', quantity: 2 }, { name: 'Cedar candle', quantity: 1 }]);
    assert.ok(o.shipTo.includes('12 Test Lane')); assert.match(o.number, /^[0-9A-F]{4}-[0-9A-F]{4}$/); assert.equal(o.sentAt, null);
    const inbox = all(t.db, "SELECT subject, text, from_addr FROM mail_messages WHERE floor_id=? AND direction='in'", floor.id);
    assert.equal(inbox.length, 1); assert.match(inbox[0].subject, new RegExp(`New order ${o.number}`)); assert.match(inbox[0].text, /12 Test Lane/); assert.equal(inbox[0].from_addr, 'sam@example.com');
    const payload = JSON.stringify(mock.state.delivered.find((d) => d.event.type === 'checkout.session.completed').event);
    const replay = await hit(t, t.host, '/theoffice/api/pay/webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': signStripe({ secret: mock.secret, timestamp: Math.floor(Date.now() / 1000), body: payload }), 'content-type': 'application/json' } });
    assert.equal(replay.status, 200); assert.equal(replay.json.duplicate, true);
    assert.equal(all(t.db, "SELECT 1 x FROM mail_messages WHERE floor_id=? AND direction='in'", floor.id).length, 1);
    assert.equal(mail.state.sent.filter((m) => String(m.to).includes('sam@example.com')).length, 1);
    const sent = await boss.post(`/api/floors/${boss.slug}/pay/orders/${o.token}/sent`, {});
    assert.equal(sent.data.sent, true);
    assert.ok((await boss.get(`/api/floors/${boss.slug}/pay`)).data.orders[0].sentAt);
  });
  test('the manager hears there was a sale, with no amount in it; a visitor to the floor sees nothing of it', async () => {
    const notes = all(t.db, "SELECT text FROM messages WHERE floor_id=? AND role='note'", floor.id).map((m) => m.text).filter((x) => /just bought/.test(x));
    assert.equal(notes.length, 1); assert.ok(!/\$|38|usd/i.test(notes[0]), notes[0]);
    const visitor = await claim(t, 'Passer By');
    const seen = JSON.stringify((await visitor.get(`/api/floors/${boss.slug}`)).data);
    assert.ok(!seen.includes('sam@example.com') && !seen.includes('Test Lane') && !seen.includes('3850') && !/just bought/.test(seen));
  });
  test('posted things can be bought again, a basket is refused when a line is not on sale, and quantities are bounded', async () => {
    const again = await pay(t, shop, 'checkout', { player: P2, body: { items: [{ product: 'lavender' }] } });
    assert.equal(again.json.ok, true, again.text);
    const single = await pay(t, shop, 'checkout', { player: P2, body: { product: 'lavender' } });
    assert.equal(single.json.ok, true, 'one posted product, bought by a guest with the single-product call');
    const none = await pay(t, shop, 'checkout', { player: P2, body: { items: [{ product: 'lavender' }, { product: 'ghost' }] } });
    assert.equal(none.json.code, 'no_product'); assert.equal(none.json.product, 'ghost');
    for (const items of [[], [{ product: 'lavender', quantity: 0 }], [{ product: 'lavender', quantity: 21 }], [{ product: 'lavender', quantity: 1.5 }], 'x']) assert.equal((await pay(t, shop, 'checkout', { player: P2, body: { items } })).status, 400);
  });
  test('anything that unlocks or renews still needs an account, and never rides in a basket with other things', async () => {
    const out = t.app.engine.pay.propose(floor, 'Max', { project: 'candles', key: 'club', name: 'Candle club', priceCents: 900, billing: 'monthly' });
    await boss.post(`/api/floors/${boss.slug}/pay/products/${out.id}/approve`, {});
    assert.equal((await pay(t, shop, 'checkout', { player: P2, body: { items: [{ product: 'club' }] } })).status, 401);
    assert.equal((await pay(t, shop, 'checkout', { player: P2, body: { items: [{ product: 'club' }, { product: 'lavender' }] } })).status, 400);
    assert.throws(() => t.app.engine.pay.propose(floor, 'Max', { project: 'candles', key: 'box', name: 'Box', priceCents: 900, billing: 'monthly', ships: true }), /one-off/);
  });
});

describe('a shop\'s catalogue file', () => {
  const files = new Set(['images/a.jpg']);
  const ok = { currency: 'usd', products: [{ key: 'a', name: 'A', description: 'Thing', price: 5, priceFrom: 'boss', image: 'images/a.jpg', ships: true }] };
  test('a good one passes, with cents worked out', () => {
    const r = checkCatalogue(JSON.stringify(ok), (p) => files.has(p));
    assert.deepEqual(r.problems, []); assert.equal(r.catalogue.products[0].priceCents, 500);
  });
  test('missing prices, missing pictures, placeholder words and unlabelled guesses are all named', () => {
    const bad = { products: [{ key: 'a', name: 'A', price: null, image: 'images/a.jpg' }, { key: 'b', name: 'B', price: 4, image: 'images/missing.jpg', priceFrom: 'boss' }, { key: 'b', name: 'Coming soon', price: 3, priceFrom: 'guess' }] };
    const r = checkCatalogue(JSON.stringify(bad), (p) => files.has(p));
    assert.ok(r.problems.some((x) => /a: .*price/i.test(x))); assert.ok(r.problems.some((x) => /missing\.jpg/.test(x))); assert.ok(r.problems.some((x) => /twice/.test(x)));
    assert.ok(r.problems.some((x) => /priceFrom/.test(x))); assert.ok(r.problems.some((x) => /coming soon/i.test(x)));
    assert.equal(checkCatalogue('{nope', () => true).problems.length, 1);
    assert.equal(checkCatalogue(JSON.stringify({ products: [] }), () => true).problems.length, 1);
  });
});

// ---- the shop as a kind of job: the starter, the lane, and the Business journey ending in a checkout ----
import { starterFiles } from '../server/makers.js';
import { checkSite } from '../server/launch-check.js';
import { managerPrompt, laneBrief, LANES } from '../server/prompts.js';
import { floorState } from './helpers.js';

describe('the shop starter and the shop lane', () => {
  const files = () => starterFiles('shop').map((f) => ({ path: f.path, data: f.data.replaceAll('{{TITLE}}', 'Wick & Co').replaceAll('{{PITCH}}', 'Soy candles poured in a garden shed, posted anywhere in the country.') }));
  test('the starter, as it arrives, will not publish: its example products have to go', () => {
    const r = checkSite({ files: files(), kind: 'site' });
    assert.equal(r.errors.length, 2); assert.ok(r.errors.every((e) => /still the starter's example product/.test(e)), r.errors.join('; '));
    assert.deepEqual(r.claims, []);
  });
  test('with a real catalogue it passes, and a missing price, a missing picture or "coming soon" each stop it', () => {
    const real = (products) => files().map((f) => (f.path === 'shop.json' ? { ...f, data: JSON.stringify({ currency: 'usd', products }) } : f));
    const ok = [{ key: 'lavender', name: 'Lavender candle', description: 'Soy wax.', price: 12, priceFrom: 'boss', image: 'images/example-one.svg', imageKind: 'illustration', ships: true }];
    const good = checkSite({ files: real(ok), kind: 'site' });
    assert.deepEqual(good.errors, [], good.errors.join('; ')); assert.ok(good.passed.some((p) => /shop catalogue \(1 products/.test(p)));
    assert.ok(checkSite({ files: real([{ ...ok[0], price: undefined }]), kind: 'site' }).errors.some((e) => /has no price/.test(e)));
    assert.ok(checkSite({ files: real([{ ...ok[0], image: 'images/nope.jpg' }]), kind: 'site' }).errors.some((e) => /isn't in what's being published/.test(e)));
    assert.ok(checkSite({ files: real([{ ...ok[0], name: 'Price coming soon' }]), kind: 'site' }).errors.some((e) => /coming soon/i.test(e)));
    const soon = real(ok).map((f) => (f.path === 'index.html' ? { ...f, data: f.data.replace('<h2>Shop</h2>', '<h2>Shop</h2><p>Price coming soon</p>') } : f));
    assert.ok(checkSite({ files: soon, kind: 'site' }).errors.some((e) => /index\.html: says "Price coming soon"/.test(e)));
    const noBuy = real(ok).map((f) => (f.path === 'shop.js' ? { ...f, data: 'console.log("no checkout here")' } : f));
    assert.ok(checkSite({ files: noBuy, kind: 'site' }).errors.some((e) => /nobody can buy/.test(e)));
  });
  test('the manager has a SHOP playbook that ends with the boss connecting Stripe and approving, and each person has their part', () => {
    const cfg = { appsBaseDomain: 'apps.example', computerEnabled: true, openrouterKey: 'k', anthropicKey: 'k', stripeSecretKey: 'sk_test_x', stripeWebhookSecret: 'whsec_x' };
    const p = managerPrompt({ name: 'A', number: 1, tagline: '' }, { name: 'B' }, { manager: 'M' }, cfg);
    assert.ok(LANES.includes('shop'));
    const shop = p.slice(p.indexOf('\nSHOP\n'), p.indexOf('\nAPP\n'));
    assert.match(shop, /sell my candles/); assert.match(shop, /never "coming soon"/); assert.match(shop, /connect Stripe on the Payments tab/); assert.match(shop, /approve the products waiting under Requests/);
    assert.match(shop, /Publishing a shop asks the boss to approve every product/); assert.match(shop, /nobody here ever pays with a real card/);
    assert.match(p, /never a page that says "coming soon" or a price nobody can pay/);
    for (const role of ['writer', 'designer', 'builder', 'tester']) assert.match(laneBrief('shop', role, cfg), /^Your part of the shop playbook: /, role);
    assert.match(laneBrief('shop', 'writer', cfg), /Every product has a price/); assert.match(laneBrief('shop', 'builder', cfg), /shop\.json/);
    assert.match(laneBrief('shop', 'designer', cfg), /never something that could pass for a photo/); assert.match(laneBrief('shop', 'tester', cfg), /Never enter a card number/);
    for (const role of ['writer', 'designer', 'builder', 'tester']) assert.doesNotMatch(laneBrief('shop', role, cfg), /hurry|quick|budget|tokens|\bcosts? (money|us)\b|steps left/i);
  });
});

describe('Business mode ends in a shop a customer can buy from', () => {
  let t, mock, boss, floor;
  const biz = async () => (await floorState(boss)).business;
  const untilBiz = (pred, what) => until(async () => { const b = await biz(); return pred(b) ? b : null; }, { what, timeout: 30000 });
  const item = (b, track, label) => b.tracks.find((x) => x.id === track).items.find((i) => i.label === label);
  before(async () => {
    mock = await startMockStripe();
    t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', stripeSecretKey: mock.apiKey, stripeWebhookSecret: mock.secret, stripeApiBase: mock.base, cloudRateScale: 1000, mediaMock: true, searchMock: true, businessTickMs: 40, modesTickMs: 60000 }, { paySleep: async () => {} });
    mock.connect(`${t.base}/api/pay/webhook`);
    boss = await claim(t, 'Doorstep Co');
    floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
  });
  after(async () => { await t.close(); await mock.close(); });

  test('the build makes a real shop, tested before it goes live, and publishing it asks the boss to approve the products', async () => {
    assert.equal((await boss.post(`/api/floors/${boss.slug}/business/start`, {})).status, 200);
    await untilBiz((b) => b.phase === 'pick', 'idea cards');
    const pick = await boss.post(`/api/floors/${boss.slug}/business/pick`, { idea: 0 });
    assert.equal(pick.status, 200, JSON.stringify(pick.data));
    const start = pick.data.business;
    assert.match(start.tracks.find((x) => x.id === 'payments').note, /your own Stripe account, straight to you/);
    assert.deepEqual(start.tracks.find((x) => x.id === 'website').items.map((i) => i.label).slice(0, 5), ['The look', 'The shop', 'Tested as a customer', 'Fixes, then live', 'Live on the web']);
    assert.ok(get(t.db, "SELECT 1 x FROM agents WHERE floor_id=? AND role='tester'", floor.id), 'a Tester is hired for it');
    const tasks = all(t.db, "SELECT title, lane FROM tasks WHERE floor_id=? AND plan LIKE 'Business mode: build%' ORDER BY id", floor.id);
    assert.deepEqual(tasks.map((x) => x.title), ['Check what rivals charge', 'Write the offer and the products', 'Pick the look', 'Build the shop', 'Test the shop as a customer', 'Fix what the test found and put it live']);
    assert.ok(tasks.every((x) => x.lane === 'shop'));
    const b = await untilBiz((x) => x.step !== 'build', 'the build to finish');
    const slug = b.project;
    assert.ok(get(t.db, "SELECT 1 x FROM published_files WHERE floor_id=? AND project=? AND path='shop.json'", floor.id, slug), 'the catalogue is live');
    assert.equal(item(b, 'payments', 'Checkout on the shop').state, 'done');
    assert.equal(item(b, 'payments', 'Connect your Stripe').state, 'yours'); assert.equal(item(b, 'payments', 'Connect your Stripe').yours, true);
    assert.equal(item(b, 'payments', 'Approve the products').state, 'yours');
    assert.equal(b.tracks.find((x) => x.id === 'payments').lamp, 'attention', 'the boss can see something is theirs to do');
    const waiting = (await floorState(boss)).pay.waiting;
    assert.deepEqual(waiting.map((w) => [w.key, w.amountCents, w.ships]), [['first-visit', 4500, false], ['care-kit', 1850, true]]);
    const notes = all(t.db, "SELECT text FROM messages WHERE floor_id=? AND role='note'", floor.id).map((m) => m.text).join('\n');
    assert.match(notes, /is a shop, and publishing it asked the boss to put 2 products on sale/);
    assert.match(notes, /connect it on the Payments tab/);
  });
  test('the boss connects Stripe and approves, the lamps turn, and a stranger buys from the live shop', async () => {
    const before = await biz();
    await boss.post(`/api/floors/${boss.slug}/pay/connect`, {});
    await mock.finishOnboarding(get(t.db, 'SELECT account FROM pay_accounts WHERE floor_id=?', floor.id).account);
    assert.equal((await boss.post(`/api/floors/${boss.slug}/pay/products/approve-all`, {})).data.approved, 2);
    const b = await untilBiz((x) => item(x, 'payments', 'Approve the products').state === 'done', 'the payments lamps');
    assert.equal(item(b, 'payments', 'Connect your Stripe').state, 'done'); assert.equal(b.tracks.find((x) => x.id === 'payments').lamp, 'done');
    const host = new URL(`https://${t.app.engine.liveUrl(floor, before.project).replace(/^https?:\/\//, '')}`).host;
    const r = await cloud(t, host, 'POST', 'pay/checkout', { player: P2, body: { items: [{ product: 'care-kit', quantity: 2 }] } });
    assert.equal(r.json.ok, true, r.text);
    const u = new URL(r.json.url);
    await mock.payCheckout(u.searchParams.get('a'), u.pathname.split('/').pop(), { email: 'kit@example.com' });
    assert.equal((await boss.get(`/api/floors/${boss.slug}/pay`)).data.orders[0].email, 'kit@example.com');
  });
  test('launching says what is still the boss\'s to do, and nothing in the journey buys a domain or approves a product for them', async () => {
    const line = t.app.engine.business.stateLine(floor.id);
    assert.match(line, /The shop is taking card payments/);
    assert.equal(get(t.db, "SELECT COUNT(*) n FROM pay_products WHERE floor_id=? AND status='live'", floor.id).n, 2);
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM domain_orders WHERE floor_id=?', floor.id).n, 0);
  });
});
