// The website chat in real Chrome: the bubble on a launched site on desktop and phone, asking a question, getting an answer, handing off to the boss,
// the boss replying from the floor, and a game with no bubble. OS-assigned ports, its own Chrome profile, a stand-in model.
import { launch, sleep } from './cdp.mjs';
import { get } from '../../server/db.js';
import { writeFile, publishSnapshot } from '../../server/workspace.js';
import { appLabel } from '../../server/apps.js';
import { createMockClient } from '../../server/mock.js';
import { boot, claim } from '../helpers.js';

const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(ok); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 240)})` : ''}`); };

const mock = createMockClient({ mockDelayMs: 2 });
const llm = { chat(a) {
  if (a.meta?.kind !== 'app_ai') return mock.chat(a);
  const q = a.messages.at(-1).content;
  return Promise.resolve({ content: /ship/i.test(q) ? 'We ship to the UK and Ireland only.' : '[[PASS]]', toolCalls: [], finish: 'stop', usage: { prompt: 30, completion: 12, cost: 0.0005, real: true } });
} };
const t = await boot({ appsBaseDomain: 'apps.localhost:1', appsScheme: 'http', cloudAiLimits: { dayFast: 100000 }, rateScale: 1000, cloudRateScale: 1000 }, { llm });
t.cfg.appsBaseDomain = `apps.localhost:${t.port}`;
const main = `http://localhost:${t.port}`;
t.cfg.publicOrigin = main;
t.base = `${main}/theoffice`; t.host = `localhost:${t.port}`;
t.app.engine.runManager = async () => {};
const boss = await claim(t, 'Cosy Mugs');
const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
const SITE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cosy Mugs</title></head><body style="margin:0;font:18px sans-serif"><main style="padding:24px"><h1>Cosy Mugs</h1><p>Hand-thrown stoneware mugs from a small studio in Leeds.</p><p>We ship to the UK and Ireland only.</p></main><button id="buy" style="position:fixed;right:16px;bottom:16px;width:130px;height:48px">Buy now</button></body></html>`;
const GAME = '<!doctype html><html><head><title>Arcade</title></head><body><canvas id="c" width="400" height="300"></canvas><script>window.gameReady=true</script></body></html>';
for (const [slug, kind, html] of [['mugs', 'site', SITE], ['arcade', 'game', GAME]]) {
  writeFile(t.db, floor.id, `projects/${slug}/index.html`, html, null, 1e8);
  publishSnapshot(t.db, floor.id, slug, 1e8);
  t.app.engine.upsertProject(floor, slug, { title: slug === 'mugs' ? 'Cosy Mugs' : 'Arcade', kind, published: true });
}
const origin = (slug) => `http://${appLabel(t.db, floor, slug)}.apps.localhost:${t.port}`;
const realErrors = (p) => p.errors.filter((e) => !/favicon/.test(e));
const shadow = (expr) => `(() => { const h = document.querySelector('[data-office-chat-host]'); if (!h) return null; const r = h.shadowRoot; ${expr} })()`;
const panelText = shadow('const l = r.querySelector(".l"); return l ? l.textContent : "";');

async function askIn(p, text) {
  await p.ev(shadow(`const f = r.querySelector('form.f'); f.querySelector('input').value = ${JSON.stringify(text)}; f.requestSubmit(); return true;`));
}
async function openBubble(p) {
  await p.until(shadow('const b = r.querySelector(".b.in"); return !!b;'), 'the bubble', 20000);
  const box = await p.ev(shadow('const b = r.querySelector(".b"); const x = b.getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 };'));
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await p.until(shadow('return !!r.querySelector(".p.open");'), 'the chat to open', 15000);
}

const b = await launch();
try {
  const desk = await b.newPage({ width: 1100, height: 800 });
  await desk.goto(`${origin('mugs')}/`);
  await desk.until(shadow('return !!r.querySelector(".b");'), 'the bubble on the site', 20000);
  check('the script is on the page once', (await desk.ev("document.querySelectorAll('script[src$=\"_office/chat.js\"]').length")) === 1);
  check('the panel\'s code is not fetched until someone opens it', !(await desk.ev("performance.getEntriesByType('resource').some((e) => e.name.includes('chat-panel'))")));
  await sleep(350);
  const overlap = await desk.ev(`(() => { const h = document.querySelector('[data-office-chat-host]').getBoundingClientRect(); const b = document.getElementById('buy').getBoundingClientRect(); return !(h.right <= b.left || h.left >= b.right || h.bottom <= b.top || h.top >= b.bottom); })()`);
  check('it doesn\'t sit on the site\'s own button', overlap === false);
  check('the bubble says it is an AI', /AI/.test(await desk.ev(shadow('return r.querySelector(".b").textContent + r.querySelector(".b").getAttribute("aria-label");'))));
  await openBubble(desk);
  await desk.until(shadow('const n = r.querySelector(".n"); return n && /read by an AI/.test(n.textContent);'), 'the notice', 10000);
  const head = await desk.ev(shadow('return r.querySelector(".h").textContent + " | " + r.querySelector(".n").textContent;'));
  check('the panel is labelled an AI assistant and says messages may be read', /AI assistant/.test(head) && /read by an AI/.test(head) && /may be read by the company/.test(head), head);
  check('it now has the panel\'s code', await desk.ev("performance.getEntriesByType('resource').some((e) => e.name.includes('chat-panel'))"));
  await askIn(desk, 'Do you ship abroad?');
  await desk.until(`(${panelText} || '').includes('We ship to the UK and Ireland only.')`, 'an answer', 20000);
  check('a question gets an answer from the site\'s words', true);
  await desk.shot('/tmp/chatwork/desk.jpg');
  await askIn(desk, 'Can you make a mug shaped like a duck?');
  await desk.until(`(${panelText} || '').includes('passed your question')`, 'the hand-off', 20000);
  check('what it can\'t answer goes to the boss', true);
  check('the email box appears', await desk.ev(shadow('return !!r.querySelector("form.xtra.on input[type=email]");')));
  await desk.ev(shadow('const f = r.querySelector("form.xtra.on"); f.querySelector("input").value = "visitor@example.com"; f.requestSubmit(); return true;'));
  await desk.until(`(${panelText} || '').includes('reply to that address')`, 'the email to be taken', 15000);
  check('an email address is taken for the reply', true);
  check('no cookie is set by the chat', (await desk.cookies()).length === 0);
  const before = await boss.get(`/api/floors/${boss.slug}/sitechat`);
  check('the question is waiting for the boss, with the address', before.status === 200 && before.data.waiting.length === 1 && before.data.waiting[0].email === 'visitor@example.com', JSON.stringify(before.data).slice(0, 200));
  await boss.post(`/api/floors/${boss.slug}/sitechat/conversations/${before.data.waiting[0].conversation}/reply`, { text: 'Yes! We can make a duck mug for you.' });
  await desk.until(`(${panelText} || '').includes('Yes! We can make a duck mug for you.')`, 'the boss\'s reply in the chat', 25000);
  check('the boss\'s reply appears in the chat while the visitor is still there', true);
  check('the desktop page had no errors', realErrors(desk).length === 0, realErrors(desk).slice(0, 3).join(' | '));

  const phone = await b.newPage({ mobile: true });
  await phone.goto(`${origin('mugs')}/`);
  await phone.until(shadow('return !!r.querySelector(".b");'), 'the bubble on the phone', 20000);
  await sleep(350);
  check('on a phone it still keeps off the site\'s button', (await phone.ev(`(() => { const h = document.querySelector('[data-office-chat-host]').getBoundingClientRect(); const b = document.getElementById('buy').getBoundingClientRect(); return !(h.right <= b.left || h.left >= b.right || h.bottom <= b.top || h.top >= b.bottom); })()`)) === false);
  await openBubble(phone);
  const fits = await phone.ev(shadow('const p = r.querySelector(".p").getBoundingClientRect(); return { l: p.left, r: p.right, t: p.top, b: p.bottom, w: innerWidth, h: innerHeight, font: getComputedStyle(r.querySelector(".f input")).fontSize };'));
  check('the panel fits a phone screen', fits.l >= 0 && fits.r <= fits.w && fits.t >= 0 && fits.b <= fits.h && fits.w - (fits.r - fits.l) <= 40, JSON.stringify(fits));
  check('and its input won\'t zoom the page', parseFloat(fits.font) >= 16, fits.font);
  await askIn(phone, 'Do you ship to Ireland?');
  await phone.until(`(${panelText} || '').includes('We ship to the UK and Ireland only.')`, 'an answer on the phone', 20000);
  check('a question gets an answer on a phone', true);
  await phone.ev(shadow('r.querySelector(".foot .link").click(); return true;'));
  await phone.until(`(${panelText} || '').includes('passed your question')`, 'the phone hand-off', 15000);
  check('talking to a person hands off on a phone', true);
  await phone.shot('/tmp/chatwork/phone.jpg');
  check('the phone page had no errors', realErrors(phone).length === 0, realErrors(phone).slice(0, 3).join(' | '));

  const game = await b.newPage({ width: 900, height: 700 });
  await game.goto(`${origin('arcade')}/`);
  await game.until('window.gameReady === true', 'the game', 15000);
  await sleep(1800);
  check('a game has no bubble', !(await game.ev('!!document.querySelector("[data-office-chat-host]")')));
  check('and no chat script', !(await game.ev("document.documentElement.outerHTML.includes('_office/chat.js')")));
  check('the game page had no errors', realErrors(game).length === 0, realErrors(game).slice(0, 3).join(' | '));

  // The boss, on the floor, in the Inbox.
  const floorPage = await b.newPage({ width: 1200, height: 860 });
  await floorPage.goto(t.base);
  await floorPage.send('Network.setCookie', { name: 'office_s', value: boss.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, sameSite: 'Lax' });
  await floorPage.goto(`${t.base}/floor/${boss.slug}?q=low`);
  await floorPage.until('!!document.querySelector(\'[data-tab="inbox"]\')', 'the inbox tab', 40000);
  await floorPage.click('[data-tab="inbox"]');
  await floorPage.until('!!document.querySelector("[data-chat-box]")', 'the website chat block', 15000);
  await floorPage.ev("(() => { const b = document.querySelector('[data-chat-box]'); if (b.dataset.open !== 'yes') b.querySelector('[data-chat-head]').click(); })()");
  await floorPage.until('!!document.querySelector("[data-chat-question]")', 'the question on the floor', 15000);
  const shown = await floorPage.ev('document.querySelector("[data-chat-box]").textContent');
  check('the boss sees it in the Inbox', /Talk|person|duck|passed/i.test(shown) || shown.includes('Do you'), shown.slice(0, 160));
  await floorPage.ev(`(() => { const q = document.querySelector('[data-chat-question]'); const t = q.querySelector('textarea'); t.value = 'Thanks for asking!'; q.querySelector('[data-chat-reply]').click(); })()`);
  await floorPage.until('!document.querySelector("[data-chat-question]")', 'the reply to clear the question', 15000);
  check('the boss can reply from there', true);
  await floorPage.shot('/tmp/chatwork/inbox.jpg');
  check('the floor page had no chat errors', !floorPage.errors.some((e) => /chat/i.test(e)), floorPage.errors.slice(0, 3).join(' | '));
} catch (e) {
  check('the run finished', false, e.message);
} finally {
  b.close();
  await t.close();
}
console.log(`${failures ? 'FAILED' : 'OK'} ${results.length - failures}/${results.length}`);
process.exit(failures ? 1 : 0);
