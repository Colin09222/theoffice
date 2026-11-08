// The boss's email-domain card in a real browser, on a desktop and on a phone: a bought domain going live by itself, the records for a domain held
// elsewhere with a re-check, and the kind word when the building is out of places. Resend is server/mail-mock.js; Namecheap is test/stubs/namecheap.mjs.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';
import { get, run } from '../../server/db.js';
import { startMockResend } from '../../server/mail-mock.js';
import { startNamecheapStub } from '../stubs/namecheap.mjs';

const OUT = process.env.MAIL_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
let failures = 0; const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; console.log(results.at(-1)); };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, String(e.message).slice(0, 300)); } };

const mock = await startMockResend();
const stub = await startNamecheapStub();
const t = await boot({ mockDelayMs: 40, rateScale: 50, resendApiKey: mock.apiKey, resendWebhookSecret: mock.webhookSecret, resendApiBase: mock.base, mailTickMs: 60, peopleTalk: false,
  namecheapUser: 'colin', namecheapKey: 'NCSECRETKEY123', namecheapClientIp: '203.0.113.7', namecheapBase: stub.url, domainContactSource: 'owned-already.com', serverIp: '198.51.100.9', appsBaseDomain: 'apps.localhost', appsScheme: 'http', domainReconcileMs: 1e9, publicOrigin: '' });
t.app.engine.runManager = async () => {};
const base = `http://localhost:${t.port}/theoffice`;
const enter = async (p, who) => {
  await p.goto(base);
  await p.send('Network.setCookie', { name: 'office_s', value: who.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  await p.goto(`${base}/floor/${who.slug}?q=low`);
  await p.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor');
};
const openInbox = async (p) => { await p.ev('window.__office.setTab("inbox")'); await p.until('!!document.querySelector("[data-mail-address]")', 'inbox'); };
const live = (who, domain) => {
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', who.slug);
  stub.state.owned.add(domain); stub.state.hosts.set(domain, [{ host: '@', type: 'A', address: '198.51.100.9', ttl: '1800' }, { host: 'www', type: 'A', address: '198.51.100.9', ttl: '1800' }]);
  const n = Date.now();
  run(t.db, "INSERT INTO domain_orders (floor_id,domain,project,why,status,quoted_usd,created_at,updated_at) VALUES (?,?,?,?,'live',?,?,?)", f.id, domain, 'launch', 'x', 11.28, n, n);
};
const nudge = () => run(t.db, 'UPDATE mail_domains SET next_at=0 WHERE next_at>0');
const statusOf = (d) => get(t.db, 'SELECT status FROM mail_domains WHERE domain=?', d)?.status;
const waitDb = async (fn, what) => { for (let i = 0; i < 200; i++) { if (fn()) return; await sleep(25); } throw new Error(`timed out: ${what}`); };
/** Nothing on the card wider than the screen, and the page itself doesn't scroll sideways. */
const fits = (selector) => `(() => { const w = document.documentElement.clientWidth; const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; return els.length > 0 && els.every((x) => { const r = x.getBoundingClientRect(); return r.left >= -1 && r.right <= w + 1 && x.scrollWidth <= x.clientWidth + 1; }) && document.documentElement.scrollWidth <= w + 1; })()`;
const noMoney = (p) => p.ev('!/\\$\\s?\\d|\\bUSD\\b|dollars/.test(document.querySelector("[data-mail-domains]")?.textContent || "")');

const c1 = await claim(t, 'Sunday Soup', { body: { colors: { primary: '#2f6f62', accent: '#f4c95d' } } });
const c2 = await claim(t, 'Tiny Teacups', { body: { colors: { primary: '#6f2f62', accent: '#5dc9f4' } } });
const c3 = await claim(t, 'Third Floor Co', { body: { colors: { primary: '#2f4f6f', accent: '#f49d5d' } } });
live(c1, 'sundaysoup.com');
await waitDb(() => statusOf('sundaysoup.com') === 'verifying', 'domain set up');

const b = await launch();
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await enter(p, c1);
  await openInbox(p);

  await step('desktop: a bought domain shows its status, and email stays on the building\'s address until it is verified', async () => {
    await p.until('!!document.querySelector("[data-mail-domain=\'sundaysoup.com\']")', 'domain card');
    if (await p.ev('document.querySelector("[data-mail-domain]").dataset.status') !== 'verifying') throw new Error('status');
    const line = await p.ev('document.querySelector("[data-mail-domain-line]").textContent');
    if (!/Almost there/.test(line)) throw new Error(line);
    if (await p.ev('document.querySelector("[data-mail-address]").textContent') !== 'sunday-soup@middistance.com') throw new Error('address changed too soon');
    if (await p.ev('!!document.querySelector("[data-mail-dns]")')) throw new Error('records shown for a domain the building manages');
    if (!await noMoney(p)) throw new Error('a price on the floor');
  });

  await step('desktop: once verified it says Live by itself, and the address moves over; the old address is named', async () => {
    mock.verify('sundaysoup.com'); nudge();
    await p.until('document.querySelector("[data-mail-domain]")?.dataset.status === "verified"', 'live');
    await p.until('document.querySelector("[data-mail-address]")?.textContent === "hello@sundaysoup.com"', 'new address');
    if (!await p.ev('/sunday-soup@middistance.com/.test(document.querySelector("[data-mail-domain]").textContent)')) throw new Error('old address not named');
    if (!await p.ev('/Live/.test(document.querySelector(".mail-domain-pill").textContent)')) throw new Error('pill');
  });

  await step('desktop: the boss can pick a different name', async () => {
    await p.ev('(() => { const s = document.querySelector("[data-mail-domain-local]"); s.value = "team"; s.dispatchEvent(new Event("change", { bubbles: true })); })()');
    await p.until('document.querySelector("[data-mail-address]")?.textContent === "team@sundaysoup.com"', 'team address');
    if (OUT) { await sleep(300); await p.shot(join(OUT, 'domain-1-desktop.jpg')); }
  });

  const m = await b.newPage({ mobile: true });
  await enter(m, c2);
  await openInbox(m);

  await step('phone: a domain held elsewhere shows its records and a re-check, and it all fits', async () => {
    await m.click('[data-mail-domain-open]');
    await m.until('!!document.querySelector("input[name=\'mail-domain\']")', 'dialog');
    await m.type('input[name="mail-domain"]', 'tinyteacups.shop');
    await m.click('[data-mail-domain-add]');
    await m.until('document.querySelector("[data-mail-domain]")?.dataset.status === "records"', 'records');
    await m.until('document.querySelectorAll("[data-mail-dns]").length >= 4', 'records list');
    if (!await m.ev('/Check again/.test(document.querySelector("[data-mail-domain-check]").textContent)')) throw new Error('no re-check');
    if (!await m.ev(fits('.mail-domain, .mail-dns, .mail-dns-value, .mail-address'))) throw new Error('does not fit');
    if (await m.ev('document.querySelector("[data-mail-address]").textContent') !== 'tiny-teacups@middistance.com') throw new Error('address changed too soon');
    if (OUT) { await sleep(300); await m.shot(join(OUT, 'domain-2-phone.jpg')); }
  });

  await step('phone: Check again goes live once the records are found', async () => {
    mock.verify('tinyteacups.shop');
    await m.click('[data-mail-domain-check]');
    await m.until('document.querySelector("[data-mail-domain]")?.dataset.status === "verified"', 'live on phone');
    await m.until('document.querySelector("[data-mail-address]")?.textContent === "hello@tinyteacups.shop"', 'phone address');
    if (!await m.ev(fits('.mail-domain, .mail-domain-from, .mail-address'))) throw new Error('does not fit');
  });

  await step('when every place is taken the boss gets a kind word, no price, and email stays put', async () => {
    live(c3, 'thirdfloor.com');
    await waitDb(() => statusOf('thirdfloor.com') === 'full', 'full');
    const g = await b.newPage({ width: 1440, height: 900 });
    await g.send('Network.clearBrowserCookies');
    await enter(g, c3);
    await openInbox(g);
    await g.until('document.querySelector("[data-mail-domain]")?.dataset.status === "full"', 'full card');
    const line = await g.ev('document.querySelector("[data-mail-domain-line]").textContent');
    if (!/taken right now/.test(line) || !/moves over by itself/.test(line)) throw new Error(line);
    if (await g.ev('document.querySelector("[data-mail-address]").textContent') !== 'third-floor-co@middistance.com') throw new Error('address');
    if (!await noMoney(g)) throw new Error('a price on the floor');
    if (get(t.db, "SELECT COUNT(*) n FROM mail_alerts WHERE kind='domains_full'").n !== 1) throw new Error('no admin alert');
    g.close();
  });

  await step('a visitor sees no domain card', async () => {
    const v = await b.newPage({ width: 1280, height: 800 });
    await v.send('Network.clearBrowserCookies');
    await v.goto(`${base}/floor/${c1.slug}?q=low`);
    await v.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor');
    await sleep(300);
    if (await v.ev('!!document.querySelector("[data-mail-domains]") || document.body.textContent.includes("sundaysoup.com")')) throw new Error('visitor sees it');
    v.close();
  });

  const errs = [...(p.errors || []), ...(m.errors || [])].filter((e) => !/favicon|ERR_ABORTED/.test(e));
  check('no page errors', !errs.length, errs.slice(0, 2).join(' | ').slice(0, 200));
} finally {
  b.close();
  await t.close();
  await mock.close();
  await stub.close();
}
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
