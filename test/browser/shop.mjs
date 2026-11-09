// A shop in real Chrome against a mock Stripe and a mock mail provider. Before the boss has connected Stripe the shop is whole and honest: every product,
// its picture and price, a basket, and an order request by email. Then the boss connects, approves everything with one tap, a stranger buys a basket on a
// phone on the mock's hosted Checkout, lands on a thank-you with their order number, gets a confirmation email, and the boss sees the order with the
// address to send it to. Uses OS-assigned ports and its own Chrome profile. Mock AI, mock Stripe, no real money, no real email.
import { mkdirSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
import { get, all } from '../../server/db.js';
import { writeFile, publishSnapshot } from '../../server/workspace.js';
import { appLabel } from '../../server/apps.js';
import { boot, claim, until } from '../helpers.js';
import { starterFiles } from '../../server/makers.js';
import { startMockStripe } from '../../server/cloud/pay-mock.js';
import { startMockResend } from '../../server/mail-mock.js';

const OUT = process.env.SHOP_SHOTS || '/tmp/shopshots';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 200)})` : ''}`); };
const CATALOGUE = { currency: 'usd', delivery: 'Posted in a padded box.', products: [
  { key: 'lavender', name: 'Lavender candle', description: 'Soy wax, about 40 hours.', price: 12, priceFrom: 'boss', image: 'images/example-one.svg', imageKind: 'illustration', ships: true },
  { key: 'cedar', name: 'Cedar candle', description: 'Soy wax, about 40 hours.', price: 14.5, priceFrom: 'proposed', image: 'images/example-two.svg', imageKind: 'illustration', ships: true },
] };

function publishShop(t, floor, slug) {
  for (const f of starterFiles('shop')) writeFile(t.db, floor.id, `projects/${slug}/${f.path}`, f.path === 'shop.json' ? JSON.stringify(CATALOGUE) : f.data.replaceAll('{{TITLE}}', 'Wick & Co').replaceAll('{{PITCH}}', 'Soy candles, poured by hand and posted to you.'), null, 1e8);
  publishSnapshot(t.db, floor.id, slug, 1e8);
  t.app.engine.upsertProject(floor, slug, { title: 'Wick & Co', kind: 'site', published: true });
  return `http://${appLabel(t.db, floor, slug)}.apps.localhost:${t.port}`;
}
const noOverflow = (p) => p.ev('document.documentElement.scrollWidth <= window.innerWidth + 1');
const tap = (p, sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); e.click(); })()`);
// The mock Stripe's own pages have no favicon; that 401 is the mock's, not the shop's.
const errorsOf = (p) => p.errors.filter((e) => !/favicon\.ico/.test(e));
const text = (p, sel) => p.ev(`document.querySelector('[data-office="${sel}"]')?.innerText || ''`);

const mock = await startMockStripe(); const mail = await startMockResend();
const t = await boot({ appsBaseDomain: 'apps.localhost:1', appsScheme: 'http', stripeSecretKey: mock.apiKey, stripeWebhookSecret: mock.secret, stripeApiBase: mock.base,
  resendApiKey: mail.apiKey, resendWebhookSecret: mail.webhookSecret, resendApiBase: mail.base, mailTickMs: 30 }, {});
t.app.engine.runManager = async () => {};
t.cfg.appsBaseDomain = `apps.localhost:${t.port}`;
const main = `http://localhost:${t.port}`;
t.cfg.publicOrigin = main; t.base = `${main}/theoffice`; t.host = `localhost:${t.port}`;
mock.connect(`http://127.0.0.1:${t.port}/theoffice/api/pay/webhook`);
const c = await claim(t, 'Wick & Co');
const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const shop = publishShop(t, floor, 'candles');

const b = await launch();
try {
  // ---- before the boss has connected Stripe: a finished shop that is honest about cards ----
  const early = await b.newPage({ mobile: true, width: 390, height: 844 });
  await early.goto(shop);
  await early.until('window.officeShop?.ready === true', 'the shop to load');
  check('every product shows with its picture and its price', (await early.ev('[...document.querySelectorAll(\'[data-office="product"]\')].map((c) => c.querySelector(\'[data-office="price"]\').innerText.replace(/\\s+/g, " ") + "|" + (c.querySelector("img").naturalWidth > 0)).join(";")')) === '$12.00|true;$14.50 proposed price|true', await early.ev('document.querySelector(\'[data-office="products"]\').innerText'));
  check('a generated picture says it is an illustration', /an illustration, not a photo/.test(await text(early, 'products')));
  check('it says plainly that cards aren\'t on yet, and never "coming soon"', /aren't switched on here yet/.test(await text(early, 'shop-status')) && !/coming soon/i.test(await early.ev('document.body.innerText')));
  await tap(early, '[data-office="product"][data-key="lavender"] [data-office="add"]');
  await early.until('!document.querySelector(\'[data-office="cart"]\').hidden', 'the basket to open');
  check('the basket counts and totals', (await text(early, 'cart-count')) === '1' && /\$12\.00/.test(await text(early, 'cart-total')));
  check('with no payments yet there is an order request instead of a dead Pay button', await early.ev('document.querySelector(\'[data-office="checkout"]\').hidden && !document.querySelector(\'[data-office="order-request"]\').hidden'));
  await early.ev('(() => { const f = document.querySelector(\'[data-office="order-request"]\'); f.querySelector("[name=name]").value = "Ada"; f.querySelector("[name=email]").value = "ada@example.com"; f.requestSubmit(); })()');
  await early.until('/order request is in/.test(document.querySelector(\'[data-office="cart-empty"]\').innerText)', 'the order request thank-you');
  check('the order request reaches the boss\'s inbox', !!get(t.db, "SELECT 1 x FROM mail_messages WHERE floor_id=? AND direction='in' AND text LIKE '%1 x Lavender candle%'", floor.id));
  check('the early shop fits a phone', await noOverflow(early));
  await early.shot(`${OUT}/shop-before-phone.jpg`);
  check('no page errors before payments', errorsOf(early).length === 0, errorsOf(early).join(' | '));

  // ---- the boss: connect, then approve everything waiting with one tap ----
  check('publishing the shop put both products in front of the boss', all(t.db, "SELECT key FROM pay_products WHERE floor_id=? AND status='proposed'", floor.id).length === 2);
  const boss = await b.newPage({ width: 1280, height: 800 });
  await boss.goto(t.base);
  await boss.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `${main}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  await boss.goto(`${t.base}/floor/${c.slug}?q=low`);
  await boss.until('document.body?.dataset.page === "floor" && !!window.__office?.view', 'floor');
  await boss.until('!!document.querySelector(\'[data-tab="pay"]\')', 'the Payments tab');
  await tap(boss, '[data-tab="pay"]');
  await boss.until('!!document.querySelector("[data-pay-connect]")', 'the connect button');
  await boss.ev('document.querySelector("[data-pay-connect]").click()');
  await boss.until('!!document.querySelector("#finish")', 'Stripe\'s hosted onboarding');
  await tap(boss, '#finish');
  await boss.until('document.body?.dataset.page === "floor" && !!window.__office?.view', 'back on the floor');
  await until(() => !!get(t.db, 'SELECT 1 x FROM pay_accounts WHERE floor_id=? AND charges_enabled=1', floor.id), { what: 'Stripe to say the account can charge' });
  await boss.goto(`${t.base}/floor/${c.slug}?q=low`);
  await boss.until('document.body?.dataset.page === "floor" && !!window.__office?.view', 'floor again');
  await boss.ev('window.__office.setTab("requests")');
  await boss.until('!!document.querySelector("[data-pay-approve-all-yes]")', 'approve all');
  check('each waiting product shows its own price to the boss', /\$12\.00/.test(await boss.ev('document.body.innerText')) && /\$14\.50/.test(await boss.ev('document.body.innerText')));
  await tap(boss, '[data-pay-approve-all-yes]');
  await until(() => all(t.db, "SELECT 1 x FROM pay_products WHERE floor_id=? AND status='live'", floor.id).length === 2, { what: 'both products to go on sale' });
  check('one tap of the boss\'s own put both on sale', true);

  // ---- a stranger buys a basket, on a phone and on a desktop ----
  for (const [label, opts] of [['phone', { mobile: true, width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
    const email = `${label}@example.com`;
    const p = await b.newPage(opts);
    await p.goto(shop);
    await p.until('window.officeShop?.ready === true', 'the shop to load');
    check(`${label}: the proposed-price label is gone once the boss has approved, and the test-mode line shows`, !/proposed price/.test(await text(p, 'products')) && /Test mode/.test(await text(p, 'shop-status')));
    await tap(p, '[data-office="product"][data-key="lavender"] [data-office="add"]');
    await p.ev('document.querySelector(\'[data-office="cart-close"]\').click()');
    await tap(p, '[data-office="product"][data-key="lavender"] [data-office="add"]');
    await p.ev('document.querySelector(\'[data-office="cart-close"]\').click()');
    await tap(p, '[data-office="product"][data-key="cedar"] [data-office="add"]');
    await p.until('!document.querySelector(\'[data-office="cart"]\').hidden', 'the basket');
    check(`${label}: three things in the basket, totalled`, (await text(p, 'cart-count')) === '3' && /\$38\.50/.test(await text(p, 'cart-total')), await text(p, 'cart-total'));
    check(`${label}: Pay by card is there, the order request is not`, await p.ev('!document.querySelector(\'[data-office="checkout"]\').hidden && document.querySelector(\'[data-office="order-request"]\').hidden'));
    await p.shot(`${OUT}/shop-basket-${label}.jpg`);
    await tap(p, '[data-office="checkout"]');
    await p.until('!!document.querySelector("#pay")', 'Stripe\'s hosted checkout');
    check(`${label}: checkout is Stripe's own page, with every line and the address asked there`, (await p.ev('location.origin')) === mock.base && /2 x Lavender candle/.test(await p.ev('document.querySelector("#what").innerText')) && /Cedar candle/.test(await p.ev('document.querySelector("#what").innerText')) && !!(await p.ev('!!document.querySelector("#ship")')) && /38\.50/.test(await p.ev('document.querySelector("#amount").innerText')));
    await p.ev(`document.querySelector('input[name=email]').value = ${JSON.stringify(email)}`);
    await tap(p, '#pay');
    await p.until('location.origin !== ' + JSON.stringify(mock.base) + ' && !document.querySelector(\'[data-office="order-confirmation"]\')?.hidden && !!document.querySelector(\'[data-office="order-number"]\')?.innerText', 'the thank-you');
    const number = await text(p, 'order-number');
    const conf = await text(p, 'order-confirmation');
    check(`${label}: the buyer lands on a thank-you with an order number, the lines and the total`, /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(number) && /2 x Lavender candle/.test(conf) && /\$38\.50/.test(conf) && /Your order is in/.test(conf), conf);
    check(`${label}: the basket is emptied after paying`, (await text(p, 'cart-count')) === '0');
    check(`${label}: the thank-you fits the screen`, await noOverflow(p));
    await p.shot(`${OUT}/shop-thanks-${label}.jpg`);
    await until(() => mail.state.sent.some((m) => String(m.to).includes(email)), { what: 'the confirmation email' });
    const m = mail.state.sent.find((x) => String(x.to).includes(email));
    check(`${label}: the buyer gets a confirmation email with the same order number`, m.subject.includes(number) && /2 x Lavender candle/.test(m.text) && /12 Test Lane/.test(m.text), m.subject);
    check(`${label}: no page errors`, errorsOf(p).length === 0, errorsOf(p).join(' | '));
  }

  // ---- the boss sees the sale ----
  await boss.goto(`${t.base}/floor/${c.slug}?q=low`);
  await boss.until('document.body?.dataset.page === "floor" && !!window.__office?.view', 'floor');
  await tap(boss, '[data-tab="pay"]');
  await boss.until('document.querySelectorAll("[data-pay-order]").length === 2', 'the orders');
  const panel = await boss.ev('document.querySelector("[data-pay-panel]").innerText');
  check('the boss sees each order: what was bought, who by, where to send it', /2 x Lavender candle, 1 x Cedar candle/.test(panel) && /phone@example\.com/.test(panel) && /Send to: Test Buyer, 12 Test Lane/.test(panel) && /\$38\.50/.test(panel), panel.slice(0, 400));
  await boss.ev('document.querySelector("[data-pay-sent]").click()');
  await boss.until('/· sent/.test(document.querySelector("[data-pay-panel]")?.innerText || "")', 'marked as sent');
  check('the boss can mark an order as sent', true);
  check('each order is also in the company inbox', all(t.db, "SELECT 1 x FROM mail_messages WHERE floor_id=? AND direction='in' AND subject LIKE 'New order %'", floor.id).length === 2);
  await boss.shot(`${OUT}/shop-boss-orders.jpg`);
  check('no page errors on the floor', errorsOf(boss).length === 0, errorsOf(boss).join(' | '));
} catch (e) { failures++; console.log(`FAIL crashed: ${e.stack || e}`); } finally {
  b.close(); await t.close(); await mock.close(); await mail.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
await sleep(600);
process.exit(failures ? 1 : 0);
