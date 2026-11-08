// office.ai and office.scrape in real Chrome: a small starter page on a project's own origin asks the mock AI and reads a page from a local server,
// and shows both. A different origin is refused. Then the boss sees the counts and switches one off. OS-assigned ports, its own Chrome profile, no spend.
import http from 'node:http';
import { launch, sleep } from './cdp.mjs';
import { get, all } from '../../server/db.js';
import { writeFile, publishSnapshot } from '../../server/workspace.js';
import { appLabel } from '../../server/apps.js';
import { isBlockedIp } from '../../server/safefetch.js';
import { boot, claim } from '../helpers.js';

const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(ok); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 200)})` : ''}`); };

// A public site, played by a server on this machine.
const hits = [];
const site = http.createServer((req, res) => {
  hits.push({ url: req.url, ua: req.headers['user-agent'] });
  if (req.url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /members'); }
  if (req.url === '/news') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>Local &amp; News</title><meta name="description" content="Today in town"><script>fetch('/ran')</script><nav><a href="/">Home</a></nav><main><h1>Bridge reopens</h1><p>${'The old bridge is open again. '.repeat(12)}</p><a href="/more">Read more</a></main>`);
  }
  if (req.url === '/data.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"bridge":"open"}'); }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('none');
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${site.address().port}`;

const net = { isBlocked: (ip) => ip !== '127.0.0.1' && ip !== '::ffff:127.0.0.1' && isBlockedIp(ip), allowAnyPort: true };
const t = await boot({ appsBaseDomain: 'apps.localhost:1', appsScheme: 'http', cloudFetchLimits: { hostDelayMs: 0 }, cloudAiLimits: { dayFast: 100000 } }, { cloudNet: net });
t.cfg.appsBaseDomain = `apps.localhost:${t.port}`;
const main = `http://localhost:${t.port}`;
t.cfg.publicOrigin = main;
t.base = `${main}/theoffice`; t.host = `localhost:${t.port}`;
const a = await claim(t, 'Ask Co');
const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', a.slug);

const PAGE = `<!doctype html><meta charset="utf-8"><title>Ask</title><script src="_office/office.js"></script><h1>Ask</h1><p id="reply"></p><h2 id="title"></h2><p id="words"></p><ul id="links"></ul><p id="note"></p><script src="app.js"></script>`;
const APP = `const office = Office.connect();
const $ = (id) => document.getElementById(id);
window.ask = async (prompt) => { try { $('reply').textContent = await office.ai.chat({ prompt }); } catch (e) { $('note').textContent = e.message; } };
window.read = async (url) => {
  try {
    const page = await office.scrape(url);
    $('title').textContent = page.title; $('words').textContent = page.text.slice(0, 300);
    $('links').replaceChildren(...page.links.map((l) => { const li = document.createElement('li'); li.textContent = l.url; return li; }));
  } catch (e) { $('note').textContent = e.code + ': ' + e.message; }
};
window.getJson = async (url) => { const r = await office.fetch(url); $('words').textContent = r.status + ' ' + r.json().bridge; };
window.ready = true;`;
for (const [project, files] of [['ask', { 'index.html': PAGE, 'app.js': APP }], ['other', { 'index.html': PAGE, 'app.js': 'window.ready = true;' }]]) {
  for (const [p, c] of Object.entries(files)) writeFile(t.db, floor.id, `projects/${project}/${p}`, c, null, 1e8);
  publishSnapshot(t.db, floor.id, project, 1e8);
  t.app.engine.upsertProject(floor, project, { title: project, kind: 'site', published: true });
}
const origin = (slug) => `http://${appLabel(t.db, floor, slug)}.apps.localhost:${t.port}`;
const ledgerRows = () => all(t.db, "SELECT * FROM ledger WHERE floor_id=? AND kind='app_ai'", floor.id);

const b = await launch();
try {
  const p = await b.newPage({ width: 1000, height: 800 });
  await p.goto(`${origin('ask')}/`);
  await p.until('window.ready && Office.connect().mode === "live"', 'the page and a live backend', 15000);
  await p.ev('ask("Say hi to the visitor")');
  await p.until('document.getElementById("reply").textContent || document.getElementById("note").textContent', 'the AI to answer', 15000);
  const shown = await p.ev('document.getElementById("reply").textContent');
  check('the page shows the AI\'s reply', /Mock AI reply to: Say hi to the visitor/.test(shown), shown);
  const rows = ledgerRows();
  check('the call is on the floor\'s ledger', rows.length === 1 && rows[0].provider === 'anthropic', JSON.stringify(rows.map((r) => [r.kind, r.provider])));

  await p.ev(`read(${JSON.stringify(`${SITE}/news`)})`);
  await p.until('document.getElementById("title").textContent || document.getElementById("note").textContent', 'the page to be read', 15000);
  check('the page shows the title it scraped', (await p.ev('document.getElementById("title").textContent')) === 'Local & News');
  check('and the cleaned words', /The old bridge is open again/.test(await p.ev('document.getElementById("words").textContent')));
  const links = await p.ev('[...document.querySelectorAll("#links li")].map((l) => l.textContent)');
  check('and its links', links.includes(`${SITE}/more`), links);
  await p.ev(`getJson(${JSON.stringify(`${SITE}/data.json`)})`);
  await p.until('document.getElementById("words").textContent === "200 open"', 'office.fetch and json()', 15000);
  check('office.fetch brings back JSON the page can read', true);
  check('the site saw an honest User-Agent', hits.filter((h) => h.url === '/news').every((h) => /TheOfficeBot.*iscolinfree\.com\/theoffice/.test(h.ua)));
  check('the scraped page\'s own script never ran', !hits.some((h) => h.url === '/ran'));

  await p.ev(`read(${JSON.stringify(`${SITE}/members`)})`);
  await p.until('document.getElementById("note").textContent', 'robots.txt to say no', 15000);
  check('a page robots.txt forbids shows a friendly message', /^robots_denied: /.test(await p.ev('document.getElementById("note").textContent')));
  await p.ev('document.getElementById("note").textContent = ""; read("http://169.254.169.254/latest/meta-data/")');
  await p.until('document.getElementById("note").textContent', 'the metadata address to be refused', 15000);
  check('the cloud metadata address is refused in plain words', /^fetch_blocked: .*can't be fetched/.test(await p.ev('document.getElementById("note").textContent')));

  // Another project's page tries the same address. Sibling or not, it's a different origin.
  const q = await b.newPage({ width: 900, height: 700 });
  await q.goto(`${origin('other')}/`);
  await q.until('window.ready', 'the other project\'s page', 15000);
  const before = ledgerRows().length;
  const cross = await q.ev(`fetch(${JSON.stringify(`${origin('ask')}/_office/cloud/ai/chat`)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'steal' }) }).then((r) => 'answered ' + r.status, () => 'refused')`);
  check('a different origin is refused by the browser and the server', cross === 'refused', cross);
  check('and it spent nothing', ledgerRows().length === before);
  q.close();
  // The browser logs a line for every refused request and for the missing favicon; those refusals are what this test is checking for.
  const pageErrors = p.errors.filter((e) => !/Failed to load resource/.test(e));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  // The boss sees counts and what's left, and can switch it off.
  const o = await b.newPage({ width: 1440, height: 900 });
  await o.send('Network.setCookie', { name: 'office_s', value: a.cookies.office_s, url: `${main}/theoffice/`, path: '/theoffice', httpOnly: true, sameSite: 'Lax' });
  await o.goto(`${main}/theoffice/floor/${a.slug}`);
  await o.until('window.__office && window.__office.state', 'the floor page', 20000);
  await o.ev('window.__office.setTab("projects")');
  await o.until('!!document.querySelector(\'[data-cloud="ask"]\')', 'the Backend button', 15000);
  await o.click('[data-cloud="ask"]');
  await o.until('!!document.querySelector(".modal") && document.querySelector(".modal").innerText.includes("AI requests today")', 'the Backend view', 10000);
  const text = await o.ev('document.querySelector(".modal").innerText');
  check('the boss sees AI and web counts and what is left today', /AI requests today\s*1/.test(text) && /Quick AI left today\s*[\d,]+ of 100,000 tokens/.test(text) && /Pages read today\s*2/.test(text) && /Pages left today\s*498 of 500/.test(text), text.replace(/\s+/g, ' ').slice(0, 300));
  check('and no money or model names', !/\$\d|usd|claude|haiku|sonnet/i.test(text));
  await sleep(500);
  await o.shot('/tmp/cloudai-boss.jpg');
  await o.click('input[data-power="ai"]');
  await sleep(600);
  await p.ev('document.getElementById("note").textContent = ""; document.getElementById("reply").textContent = ""; ask("Are you there?")');
  await p.until('document.getElementById("reply").textContent || document.getElementById("note").textContent', 'the AI to answer', 15000);
  check('with AI switched off, the page says so kindly', /isn't switched on/.test(await p.ev('document.getElementById("note").textContent')), await p.ev('document.getElementById("note").textContent'));
  const bossErrors = o.errors.filter((e) => !/Evaluating a string as JavaScript violates/.test(e));
  check('no errors on the boss\'s page', bossErrors.length === 0, bossErrors.join(' | '));
} catch (e) {
  check(`ran to the end: ${e.message}`, false);
} finally { b.close(); }
console.log(`${results.length - failures} of ${results.length} passed`);
await t.close();
site.close();
process.exit(failures ? 1 : 0);
