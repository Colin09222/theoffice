// Payments in real Chrome against a mock Stripe: a boss connects through the hosted pages, approves a product with one tap, a visitor signs up on the App starter,
// buys on the mock's Checkout page and the paid feature unlocks, on a desktop and on a phone. Then a refund shuts it again, and a floor with no key says "being set up".
// Uses OS-assigned ports and its own Chrome profile. Mock AI, mock Stripe, no real money.
import { mkdirSync } from 'node:fs';
import { launch, sleep } from './cdp.mjs';
import { get } from '../../server/db.js';
import { writeFile, publishSnapshot } from '../../server/workspace.js';
import { appLabel } from '../../server/apps.js';
import { boot, claim } from '../helpers.js';
import { starterFiles } from '../../server/makers.js';
import { startMockStripe } from '../../server/cloud/pay-mock.js';

const OUT = process.env.PAY_SHOTS || '/tmp/payshots';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 200)})` : ''}`); };

function publishApp(t, floor, slug) {
  for (const f of starterFiles('app')) writeFile(t.db, floor.id, `projects/${slug}/${f.path}`, f.data.replaceAll('{{TITLE}}', 'Pocket Notes').replaceAll('{{PITCH}}', 'Notes that stay with you.'), null, 1e8);
  publishSnapshot(t.db, floor.id, slug, 1e8);
  t.app.engine.upsertProject(floor, slug, { title: 'Pocket Notes', kind: 'game', published: true });
  return `http://${appLabel(t.db, floor, slug)}.apps.localhost:${t.port}`;
}
async function world(extra) {
  const t = await boot({ appsBaseDomain: 'apps.localhost:1', appsScheme: 'http', ...extra }, {});
  t.app.engine.runManager = async () => {};
  t.cfg.appsBaseDomain = `apps.localhost:${t.port}`;
  const main = `http://localhost:${t.port}`;
  t.cfg.publicOrigin = main; t.base = `${main}/theoffice`; t.host = `localhost:${t.port}`;
  return { t, main };
}
const noOverflow = (p) => p.ev('document.documentElement.scrollWidth <= window.innerWidth + 1');

const mock = await startMockStripe();
const { t, main } = await world({ stripeSecretKey: mock.apiKey, stripeWebhookSecret: mock.secret, stripeApiBase: mock.base });
mock.connect(`http://127.0.0.1:${t.port}/theoffice/api/pay/webhook`);
const c = await claim(t, 'Paper Co');
const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const app = publishApp(t, floor, 'notes');

const b = await launch();
try {
  const enter = async (p, who) => {
    await p.goto(t.base);
    await p.send('Network.setCookie', { name: 'office_s', value: who.cookies.office_s, url: `${main}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
    await p.goto(`${t.base}/floor/${who.slug}?q=low`);
    await p.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor');
  };
  const boss = await b.newPage({ width: 1280, height: 800 });
  await enter(boss, c);
  await boss.until('!!document.querySelector(\'[data-tab="pay"]\')', 'the Payments tab');
  await boss.click('[data-tab="pay"]');
  await boss.until('!!document.querySelector(\'[data-pay-state="none"]\')', 'the connect card');
  check('the boss is told plainly they are the seller and the money is theirs', /seller/.test(await boss.ev('document.querySelector("[data-pay-panel]").innerText')) && /no cut/.test(await boss.ev('document.querySelector("[data-pay-panel]").innerText')));
  check('test mode is marked', await boss.ev('!!document.querySelector("[data-pay-test]")'));

  // Hosted onboarding: out to Stripe's page and straight back.
  await boss.ev('document.querySelector("[data-pay-connect]").click()');
  await boss.until('!!document.querySelector("#finish")', 'Stripe\'s hosted onboarding');
  check('connecting leaves for Stripe\'s own page', (await boss.ev('location.origin')) === mock.base, await boss.ev('location.href'));
  await boss.ev('document.querySelector("#finish").click()');
  await boss.until('location.pathname.endsWith("/floor/paper-co") && !!document.querySelector("[data-pay-state]")', 'back on the floor', 30000);
  await boss.until('!!document.querySelector(\'[data-pay-state="ready"]\')', 'connected', 10000);
  const landedOn = await boss.ev('!!document.querySelector("[data-pay-panel]") && location.search');
  check('it comes back to the Payments tab and the address is clean', landedOn === '', landedOn);

  // The team proposes; the boss taps.
  const proposed = t.app.engine.pay.propose(floor, 'Max', { project: 'notes', key: 'pro', name: 'Pocket Notes Pro', description: 'Everything, on every device.', priceCents: 900, billing: 'one_off', why: 'Fair for a small app.', unlocks: ['pro-notes'] });
  await boss.ev('window.__office.setTab("requests")');
  await boss.until('!!document.querySelector("[data-pay-approve]")', 'the approval card');
  const card = await boss.ev('document.querySelector("[data-pay-approve]").innerText');
  check('the approval card shows the product and its price', /Pocket Notes Pro/.test(card) && /9\.00/.test(card), card.replace(/\s+/g, ' '));
  await boss.ev('document.querySelector("[data-pay-approve-yes]").click()');
  await boss.until('!document.querySelector("[data-pay-approve]")', 'approval done');
  check('one tap puts it on sale', get(t.db, 'SELECT status FROM pay_products WHERE id=?', proposed.id).status === 'live');
  await boss.ev('window.__office.setTab("pay")');
  await boss.until('!!document.querySelector(\'[data-pay-product="pro"]\')', 'the live product');
  await sleep(300); await boss.shot(`${OUT}/boss-desktop.jpg`);

  // A visitor on a desktop, signed out: the pricing shows, and getting it needs an account.
  const v = await b.newPage({ width: 1280, height: 800 });
  await v.goto(`${app}/`);
  await v.until('Office.connect().mode === "live" && !!document.querySelector(\'[data-office="buy"]\')', 'the pricing section', 15000);
  check('the App starter lists the product from office.pay, price and all', /Pocket Notes Pro/.test(await v.ev('document.querySelector(\'[data-office="plans"]\').innerText')) && /9\.00/.test(await v.ev('document.querySelector(\'[data-office="plans"]\').innerText')));
  check('test mode shows on the site', /Test mode/.test(await v.ev('document.querySelector(\'[data-office="pricing-status"]\').textContent')));
  await v.click('[data-office="buy"]');
  await v.until('location.hash === "#/signup"', 'sign up first');
  const signup = async (page, name) => {
    await page.until('!!document.querySelector(\'[data-office="username"]\')', 'the sign-up form');
    await page.type('[data-office="username"]', name);
    await page.type('[data-office="auth-form"] input[type="password"]', 'correct horse');
    await page.click('[data-office="auth-submit"]');
    await page.until('location.hash === "#/app"', 'signed up', 15000);
  };
  await signup(v, 'desk_buyer');

  const before = await v.ev('(async () => { const c = Office.connect(); return { has: await c.pay.has("pro"), read: await c.db.collection("pro-notes").find().then(() => "ok", (e) => e.code) }; })()');
  check('before paying, the server refuses the paid data', before.has === false && before.read === 'payment_required', JSON.stringify(before));

  // Buy it, on the mock's hosted Checkout, with Stripe doing the card.
  await v.ev('location.hash = "#/settings"');
  await v.until('!document.querySelector(\'[data-office="upgrade"]\').hidden', 'the upgrade button');
  await v.ev('document.querySelector(\'[data-office="upgrade"]\').click()');
  await v.until('!!document.querySelector("#pay")', 'Stripe\'s hosted Checkout', 15000);
  check('checkout is Stripe\'s own page, not the app', (await v.ev('location.origin')) === mock.base);
  await v.ev('document.querySelector("#pay").click()');
  await v.until(`location.origin === ${JSON.stringify(app)} && !location.search.includes("office_pay")`, 'back on the site', 15000);
  await v.until('/You have Pocket Notes Pro/.test(document.querySelector(\'[data-office="plan-status"]\').textContent)', 'the plan unlocked', 15000);
  check('the paid plan is live the moment they land back', true);
  check('the thank-you shows once', /Thanks/.test(await v.ev('document.querySelector(\'[data-office="plan-note"]\').textContent')));
  const after = await v.ev('(async () => { const c = Office.connect(); return { has: await c.pay.has("pro"), write: await c.db.collection("pro-notes").add({ text: "mine" }).then(() => "ok", (e) => e.code), read: await c.db.collection("pro-notes").find().then((r) => r.length, (e) => e.code) }; })()');
  check('after paying, the paid collection opens', after.has === true && after.write === 'ok' && after.read === 1, JSON.stringify(after));
  check('the site logs no errors', v.errors.filter((e) => !/favicon|status of 402/.test(e)).length === 0, v.errors.join(' | '));

  // The same on a phone, with a fresh account.
  const ph = await b.newPage({ mobile: true, width: 390, height: 844 });
  await ph.goto(`${app}/`);
  await ph.until('Office.connect().mode === "live"', 'the app on a phone', 15000);
  await ph.ev('localStorage.clear()');
  await ph.goto(`${app}/?fresh=1#/signup`);
  await signup(ph, 'phone_buyer');
  await ph.ev('location.hash = "#/settings"');
  await ph.until('!document.querySelector(\'[data-office="upgrade"]\').hidden', 'the upgrade button on a phone');
  check('the plan box fits the phone', await noOverflow(ph));
  await ph.ev('document.querySelector(\'[data-office="upgrade"]\').click()');
  await ph.until('!!document.querySelector("#pay")', 'Checkout on a phone', 15000);
  await ph.ev('document.querySelector("#pay").click()');
  await ph.until('/You have Pocket Notes Pro/.test(document.querySelector(\'[data-office="plan-status"]\')?.textContent || "")', 'unlocked on a phone', 15000);
  check('it unlocks on a phone too', await ph.ev('Office.connect().pay.has("pro")'));
  await sleep(200); await ph.shot(`${OUT}/phone-plan.jpg`);

  // The boss, on a phone: the panel fits, and the refund is one deliberate tap away.
  const bossPhone = await b.newPage({ mobile: true, width: 390, height: 844 });
  await enter(bossPhone, c);
  await bossPhone.ev('window.__office.setTab("pay")');
  await bossPhone.until('!!document.querySelector("[data-pay-refund]")', 'orders on a phone');
  check('the sales are the boss\'s and show on the phone panel', /Sales, last 30 days/.test(await bossPhone.ev('document.querySelector("[data-pay-panel]").innerText')));
  check('the panel fits a phone', await noOverflow(bossPhone));
  await sleep(200); await bossPhone.shot(`${OUT}/boss-phone.jpg`);
  const orderToken = await bossPhone.ev('[...document.querySelectorAll("[data-pay-order]")].find((o) => /desk_buyer/.test(o.innerText)).dataset.payOrder');
  await bossPhone.ev(`document.querySelector('[data-pay-refund="${orderToken}"]').click()`);
  await bossPhone.until(`!!document.querySelector('[data-pay-refund-yes="${orderToken}"]')`, 'the confirm box');
  await bossPhone.ev(`document.querySelector('[data-pay-refund-yes="${orderToken}"]').click()`);
  for (let i = 0; i < 100; i++) { if (get(t.db, 'SELECT status FROM pay_orders WHERE token=?', orderToken)?.status === 'refunded') break; await sleep(100); }
  check('the boss refunds from the phone', get(t.db, 'SELECT status FROM pay_orders WHERE token=?', orderToken)?.status === 'refunded');
  const refunded = await v.ev('(async () => { const c = Office.connect(); return { has: await c.pay.has("pro"), read: await c.db.collection("pro-notes").find().then((r) => r.length, (e) => e.code) }; })()');
  check('a refund takes the feature and the data away', refunded.has === false && refunded.read === 'payment_required', JSON.stringify(refunded));

  // A visitor never sees sales, and a floor with no key says so plainly.
  const anon = await b.newPage({ width: 1000, height: 700 });
  await anon.send('Network.clearBrowserCookies');  // the same browser as the boss, so the boss's cookie goes first
  await anon.goto(`${t.base}/floor/${c.slug}?q=low`);
  await anon.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'the floor as a visitor');
  check('a visitor has no Payments tab', await anon.ev('!document.querySelector(\'[data-tab="pay"]\')'));
  const leaked = await anon.ev('JSON.stringify(window.__office.state)');
  check('and no sales in what the page holds', !/grossCents|office_order|activeSubs/.test(leaked));
} finally { await b.close?.(); }

// No key: the same starter, a friendly line instead of a broken page.
{
  const { t: t2 } = await world({});
  const c2 = await claim(t2, 'Quiet Co');
  const floor2 = get(t2.db, 'SELECT * FROM floors WHERE slug=?', c2.slug);
  const app2 = publishApp(t2, floor2, 'notes');
  const b2 = await launch();
  try {
    const v2 = await b2.newPage({ width: 900, height: 700 });
    await v2.goto(`${app2}/`);
    await v2.until('Office.connect().mode === "live" && !document.querySelector(\'[data-office="payments"]\').hidden', 'the pricing line', 15000);
    const text = await v2.ev('document.querySelector(\'[data-office="pricing-status"]\').textContent');
    check('with no key the site says payments are being set up', /being set up/.test(text), text);
    const answer = await v2.ev('Office.connect().pay.checkout({ product: "pro" })');
    check('and office.pay answers kindly, never an error', answer.ok === false && answer.code === 'not_ready' && /being set up/.test(answer.message), JSON.stringify(answer));
    check('no buy button is shown', await v2.ev('!document.querySelector(\'[data-office="buy"]\')'));
    const bossNoKey = await b2.newPage({ width: 1100, height: 760 });
    await bossNoKey.goto(t2.base);
    await bossNoKey.send('Network.setCookie', { name: 'office_s', value: c2.cookies.office_s, url: `${t2.cfg.publicOrigin}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
    await bossNoKey.goto(`${t2.base}/floor/${c2.slug}?q=low`);
    await bossNoKey.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'the floor');
    await bossNoKey.ev('window.__office.setTab("pay")');
    await bossNoKey.until('!!document.querySelector(\'[data-pay-state="not-ready"]\')', 'the set-up notice');
    check('the boss sees "Payments are being set up"', /Payments are being set up/.test(await bossNoKey.ev('document.querySelector("[data-pay-panel]").innerText')));
  } finally { await b2.close?.(); await t2.close(); }
}
await t.close(); await mock.close();
console.log(`${failures ? 'FAILED' : 'OK'} ${failures} failed`);
process.exit(failures ? 1 : 0);
