// Real Chrome against app-origin mode, in mock mode with no spend: the browser's own rules are what is being tested, so a mock server won't do.
// Runs on *.apps.localhost, a real secure context, so service workers and localStorage behave as on the live site.
import { launch, sleep } from './cdp.mjs';
import { get, all } from '../../server/db.js';
import { writeFile, publishSnapshot } from '../../server/workspace.js';
import { appLabel } from '../../server/apps.js';
import { boot, claim } from '../helpers.js';

const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(ok); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };

const PORT = 28700 + Math.floor(Math.random() * 900);
const t = await boot({ appsBaseDomain: `apps.localhost:${PORT}`, appsScheme: 'http' }, {});
await new Promise((r) => t.app.server.close(r));
await new Promise((r) => t.app.server.listen(PORT, '127.0.0.1', r));
const main = `http://localhost:${PORT}`;
t.cfg.publicOrigin = main;
t.base = `${main}/theoffice`; t.host = `localhost:${PORT}`;
const a = await claim(t, 'Browser Co');
const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', a.slug);
const pub = (slug, files, priv = false) => {
  for (const [p, c] of Object.entries(files)) writeFile(t.db, floor.id, `projects/${slug}/${p}`, c, null, 1e8);
  publishSnapshot(t.db, floor.id, slug, 1e8);
  t.app.engine.upsertProject(floor, slug, { title: slug, kind: 'game', published: true, makePrivate: priv });
  return `http://${appLabel(t.db, floor, slug)}.apps.localhost:${PORT}`;
};
const HTML = '<!doctype html><title>t</title><link rel="manifest" href="app.webmanifest"><script src="_office/client.js"></script><h1 id="h">game</h1>';
const originA = pub('game', { 'index.html': HTML, 'app.webmanifest': '{"name":"Game","start_url":".","display":"standalone","icons":[]}', 'sw.js': 'self.addEventListener("fetch",()=>{});self.addEventListener("install",()=>self.skipWaiting());' });
const originB = pub('other', { 'index.html': HTML });
const originPriv = pub('secret', { 'index.html': '<h1>private</h1>' }, true);

const seen = [];
const inner = t.app.server.listeners('request')[0];
t.app.server.removeAllListeners('request');
t.app.server.on('request', (req, res) => { seen.push({ host: req.headers.host, url: req.url, cookie: req.headers.cookie || '' }); inner(req, res); });

const b = await launch();
try {
  const p = await b.newPage({ width: 1000, height: 700 });
  await p.goto(`${main}/theoffice/robots.txt`);
  // The real session, plus a stand-in for the private site's cookie, both set the way their servers set them: host-only.
  await p.send('Network.setCookie', { name: 'office_s', value: a.cookies.office_s, url: `${main}/theoffice/`, path: '/theoffice', httpOnly: true, sameSite: 'Lax' });
  await p.send('Network.setCookie', { name: 'bhq_auth', value: 'private-site-token', url: `${main}/`, path: '/', httpOnly: true, sameSite: 'Lax' });
  await p.goto(`${main}/theoffice/f/${a.slug}/game/`);
  check('the friendly link lands on the project origin', (await p.ev('location.origin')) === originA, await p.ev('location.href'));
  check('the origin is real', (await p.ev('self.origin')) === originA);
  check('localStorage works', await p.ev('(()=>{localStorage.setItem("k","v");return localStorage.getItem("k")==="v"})()'));
  check('IndexedDB works', await p.ev('new Promise(r=>{const q=indexedDB.open("t");q.onsuccess=()=>r(true);q.onerror=()=>r(false)})'));
  check('document.cookie is empty', (await p.ev('document.cookie')) === '');
  const reg = await p.ev('navigator.serviceWorker.register("sw.js").then(()=>navigator.serviceWorker.ready).then(r=>r.scope)');
  check('a service worker registers for the whole origin', reg === `${originA}/`, reg);
  check('the manifest is served as a manifest', /manifest/.test(await p.ev('fetch("app.webmanifest").then(r=>r.headers.get("content-type"))')));

  await p.ev('Office.save("high", 77)');
  check('Office.save reaches the backend', await p.ev('Office.connected') && get(t.db, "SELECT value FROM app_kv WHERE floor_id=? AND project='game' AND key='high'", floor.id)?.value === '77');
  await p.ev('Office.submitScore("top", "<b>Ann</b>", 77)');
  check('the leaderboard takes a score with markup stripped', (await p.ev('Office.leaderboard("top").then(e=>e[0].name)')) === 'bAnn/b');
  check('the shared counter works', (await p.ev('Office.shared.incr("visits").then(()=>Office.shared.incr("visits"))')) === 2);
  await p.goto(originA + '/');
  check('the save survives a reload', (await p.ev('Office.load("high",0)')) === 77);

  // Everything a hostile published page would try.
  const f = async (url, opts = '{}') => p.ev(`fetch(${JSON.stringify(url)},${opts}).then(r=>"status "+r.status).catch(e=>"blocked: "+e.name)`);
  check('fetch to The Office API is blocked', /blocked/.test(await f(`${main}/theoffice/api/me`, '{"credentials":"include"}')));
  check('fetch to the main domain is blocked', /blocked/.test(await f(`${main}/`, '{"credentials":"include","mode":"no-cors"}')));
  check('fetch to another project is blocked', /blocked/.test(await f(`${originB}/_data/v1/shared/visits`)));
  check('an image probe of the main site is blocked', await p.ev(`new Promise(r=>{const i=new Image();i.onload=()=>r(false);i.onerror=()=>r(true);i.src=${JSON.stringify(`${main}/theoffice/api/me`)}})`));
  check('a framed main site is blocked', await p.ev(`new Promise(r=>{const i=document.createElement("iframe");i.src=${JSON.stringify(`${main}/theoffice/`)};let ok=true;try{i.onload=()=>{try{r(!i.contentWindow.document.body.innerText.includes("office"))}catch{r(true)}}}catch{};document.body.append(i);setTimeout(()=>r(ok),1500)})`));
  check('a form post to the main site is blocked', await p.ev(`new Promise(r=>{const n=document.createElement("iframe");n.name="sink";document.body.append(n);const fm=document.createElement("form");fm.method="POST";fm.action=${JSON.stringify(`${main}/theoffice/api/logout`)};fm.target="sink";document.body.append(fm);document.addEventListener("securitypolicyviolation",()=>r(true),{once:true});fm.submit();setTimeout(()=>r(false),1500)})`));
  const forged = seen.filter((r) => r.url.includes('/theoffice/api/logout') && r.host === `localhost:${PORT}`);
  check('that form post never reached the server', forged.length === 0);
  await p.ev(`document.cookie="office_s=planted; Domain=apps.localhost; Path=/"`);
  await p.ev(`document.cookie="bhq_auth=planted; Domain=localhost; Path=/"`);
  await sleep(50);
  // A page with no CSP at all, as a service worker could synthesise, must still be stopped by the server.
  const direct = await fetch(`${main}/theoffice/api/floors/${a.slug}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', origin: originA, cookie: `office_s=${a.cookies.office_s}`, 'x-office-csrf': a.csrf }, body: '{"text":"spend"}' });
  check('even with no CSP in the way, the API refuses a project origin', direct.status === 403, `status ${direct.status}`);

  await p.goto(originPriv + '/');
  check('a private project is a plain 404, even for the owner\'s browser, without a pass', !(await p.ev('document.body.innerText')).includes('private'));
  await p.goto(`${main}/theoffice/f/${a.slug}/secret/`);
  check('the owner\'s friendly link opens a private project on its origin', (await p.ev('document.body.innerText')).includes('private') && (await p.ev('location.origin')) === originPriv);
  check('the private pass is out of reach of the page', !/office_preview/.test(await p.ev('document.cookie')));
  await p.goto(`${main}/theoffice/robots.txt`);
  const before = p.errors.length;
  await p.ev(`new Promise(r=>{const i=document.createElement("iframe");i.sandbox="allow-scripts allow-same-origin";i.src=${JSON.stringify(`${originA}/`)};i.onload=()=>r(true);document.body.append(i);setTimeout(()=>r(false),2000)})`);
  await sleep(300);
  check('the main site can frame a project, as the project preview does', !p.errors.slice(before).some((e) => /frame/i.test(e)), p.errors.slice(before).join(' | ').slice(0, 200));

  const appHits = seen.filter((r) => r.host?.includes('.apps.localhost'));
  check('no project origin ever received office_s or bhq_auth from the browser', appHits.length > 5 && appHits.every((r) => !/office_s=(?!planted)|bhq_auth=(?!planted)/.test(r.cookie)), `${appHits.length} requests`);
  const mains = seen.filter((r) => r.host === `localhost:${PORT}`);
  check('the main origin did receive them, so that check means something', mains.some((r) => /office_s=/.test(r.cookie)) && mains.some((r) => /bhq_auth=/.test(r.cookie)));
  check('no page errors that were not deliberate', p.errors.filter((e) => !/Content Security Policy|violates|blocked|Failed to load|ERR_|404|Refused/i.test(e)).length === 0, p.errors.filter((e) => !/Content Security Policy|violates|blocked|Failed to load|ERR_|404|Refused/i.test(e)).slice(0, 2).join(' | ').slice(0, 200));
} finally { b.close(); }
console.log(`${results.length - failures} of ${results.length} passed`);
await t.close();
process.exit(failures ? 1 : 0);
