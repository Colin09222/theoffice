// Real-browser end-to-end at 1440x900 and 390x844, against the real server in mock mode: lobby, claim, customise, chat,
// watching agents work, opening a published site, visitor view and admin. Every step is asserted, and screenshots go to media/.
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';
import { boot, Client, claim } from '../helpers.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../media');
mkdirSync(OUT, { recursive: true });
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; console.log(results.at(-1)); };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, e.message); } };
const q = (s) => JSON.stringify(s);

async function run(label, opts, t, adminCode) {
  const base = `http://localhost:${t.port}/theoffice`;
  const b = await launch();
  const p = await b.newPage(opts);
  const shot = (n) => p.shot(join(OUT, `${label}-${n}.jpg`));
  const companyName = label === 'desktop' ? 'Night Bakery' : 'Pocket Circus';
  const tag = (s) => `${label}: ${s}`;
  const phone = !!opts.mobile;

  await step(tag('lobby renders the 3D tower, directory and pill'), async () => {
    await p.goto(base);
    await p.until('document.documentElement.classList.contains("ready")', 'app ready');
    await sleep(3500);
    if (!await p.ev('document.body.dataset.page === "lobby" && !!document.querySelector(".directory") && !!document.querySelector(".open-pill")')) throw new Error('lobby UI missing');
    const canvasOk = await p.ev('!document.body.classList.contains("no-webgl")');
    if (!canvasOk) throw new Error('WebGL failed');
    await shot('01-lobby');
  });
  await step(tag('search filters the directory'), async () => {
    if (phone) { await p.click('.sheet-grip'); await sleep(450); }
    await p.type('.dir-search input', 'hat');
    await p.until('document.querySelectorAll(".dir-row").length === 1 && document.querySelector(".dir-row b").textContent === "Hat Museum"', 'search filter');
    await p.type('.dir-search input', 'zzzz');
    await p.until('document.querySelector(".dir-empty") !== null', 'empty state');
    await p.type('.dir-search input', '');
    await p.ev('(() => { const i = document.querySelector(".dir-search input"); i.value = ""; i.dispatchEvent(new Event("input")); })()');
    await p.until('document.querySelectorAll(".lift-btn").length === 40', 'lift buttons');
    if (phone) { await shot('02-directory'); await p.click('.sheet-grip'); await sleep(450); }
  });
  await step(tag('dragging turns and scrolling rides the tower'), async () => {
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 150, y: 700, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 110, y: 690, button: 'left' });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 110, y: 690, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 150, y: 700, deltaX: 0, deltaY: -200 });
    await sleep(700);
    const moved = await p.ev('(() => { const c = window.__lobbyDebug; return c ? { t: Math.abs(c.targetTheta - c.startTheta), r: c.targetRide } : null; })()');
    if (!moved || moved.t < 0.1) throw new Error('drag did not turn the tower');
    if (Math.abs(moved.r - 26) < 1) throw new Error('scroll did not ride');
  });
  await step(tag('a bad code is refused kindly'), async () => {
    await p.click('.open-pill');
    await p.until('document.querySelector(".code-input") !== null', 'code dialog');
    await p.type('.code-input', 'OFFICE-NOPE-NOPE');
    await p.click('.modal button[type=submit]');
    await p.until('(() => { const e = document.querySelector(".form-error"); return e && !e.hidden && /isn.t valid/.test(e.textContent); })()', 'error message');
  });
  await step(tag('claim: code, company, boss builder, recovery code, secure cookie'), async () => {
    const code = await adminCode(); // from the real admin CLI path
    await p.type('.code-input', code);
    await p.click('.modal button[type=submit]');
    await p.until('document.querySelector("input[name=company]") !== null', 'company step');
    await p.type('input[name=company]', companyName);
    await p.type('input[name=tagline]', phone ? 'The smallest show on earth' : 'Warm ideas, baked overnight');
    await p.click('.modal [aria-label="Main colour #7a4bb5"]');
    await p.click('.modal button[type=submit]');
    await p.until('document.querySelector("input[name=boss]") !== null', 'boss step');
    await p.type('input[name=boss]', phone ? 'Ringmaster' : 'Chef');
    await sleep(600);
    await p.click('.modal [aria-label="Hat"] [data-v="crown"]');
    await p.click('.modal [aria-label="Hair"] [data-v="curly"]');
    await sleep(500);
    await shot('03-boss-builder');
    await p.click('.modal button[type=submit]');
    await p.until('document.querySelector("[data-recovery]") !== null', 'recovery code');
    const rec = await p.ev('document.querySelector("[data-recovery]").textContent');
    if (!/^RECOVER-/.test(rec)) throw new Error('no recovery code');
    const ck = (await p.cookies()).find((c) => c.name === 'office_s');
    if (!ck || !ck.httpOnly || !ck.secure || ck.sameSite !== 'Lax' || ck.path !== '/theoffice') throw new Error(`cookie flags: ${JSON.stringify(ck && { h: ck.httpOnly, s: ck.secure, l: ck.sameSite, p: ck.path })}`);
    if (await p.ev('document.cookie.includes("office_s")')) throw new Error('script can read the session cookie');
    await p.click('.modal .btn.primary');
    await p.until('document.body.dataset.page === "floor" && !!window.__office', 'floor page');
    await sleep(2200);
    await shot('04-floor-new');
  });
  const slug = await p.ev('window.__office?.slug');
  await step(tag('customise: staff name and decor change the real floor'), async () => {
    await p.click('.controls .btn:nth-of-type(4)');
    await p.until('document.querySelector("[data-custom=decor]") !== null', 'customise dialog');
    await p.click('[data-custom=decor]');
    await p.until('document.querySelector(".modal [aria-label=Pet]") !== null', 'decor pane');
    await p.click('.modal [aria-label=Floor] [data-v=terrazzo]');
    await p.click('.modal [aria-label=Pet] [data-v=dog]');
    await p.ev('[...document.querySelectorAll(".toggle")].find((l) => l.textContent.includes("Arcade")).querySelector("input").click()');
    await sleep(200);
    await shot('05-customise');
    await p.click('.modal form button[type=submit]');
    await p.until('window.__office.state.floor.decor.floor === "terrazzo" && window.__office.state.floor.decor.pet === "dog" && window.__office.state.floor.decor.arcade === true', 'decor saved');
    await p.until('document.querySelector(".modal") === null', 'dialog closed');
    await p.click('.staff-chip[data-agent]:nth-child(2)');
    await p.until('document.querySelector(".modal .staff-pick") !== null', 'staff editor');
    await p.type('.modal form input', 'Sir Crumb');
    await sleep(300);
    await p.click('.modal form button[type=submit]');
    await p.until('window.__office.state.agents[1].name === "Sir Crumb"', 'staff renamed');
    await p.until('[...document.querySelectorAll(".char-name")].some((e) => e.textContent === "Sir Crumb")', 'renamed above the character');
    await p.until('document.querySelector(".modal") === null', 'dialog closed');
  });
  await step(tag('chat: brainstorm streams back from the manager'), async () => {
    await p.click('[data-tab=chat]');
    await p.type('.chat-input textarea', 'I have been thinking about tiny things');
    await p.click('.send');
    await p.until('[...document.querySelectorAll(".msg.boss")].some((m) => /tiny things/.test(m.textContent))', 'boss message shown');
    await p.until('[...document.querySelectorAll(".msg.manager")].some((m) => /Three angles/.test(m.textContent))', 'manager reply');
    await p.until('window.__office.state.agents.every((a) => a.state === "idle")', 'manager idle');
    if (await p.ev('window.__office.state.tasks.length !== 0')) throw new Error('brainstorm should not create tasks');
    await sleep(400);
    await shot('06-chat');
  });
  await step(tag('watching: real events drive characters, feed, board and spend'), async () => {
    await p.ev('window.__seen = { typing: 0, meeting: 0, carry: 0, walk: 0, bubbles: 0 }; window.__samp = setInterval(() => { const v = window.__office?.view; if (!v) return; for (const a of v.actors.values()) { if (a.state === "typing") window.__seen.typing++; if (a.path.length) window.__seen.walk++; if (a.char.paper.visible) window.__seen.carry++; if (!a.bubble.hidden) window.__seen.bubbles++; } }, 100); void 0');
    await p.type('.chat-input textarea', `Great, go build ${phone ? 'clown college' : 'midnight rolls'} [buy] [ask]`);
    await p.click('.send');
    await p.until('window.__office.state.tasks.length === 4', 'plan with four tasks');
    await p.until('(() => { const v = window.__office.view; const m = v.manager; return !!m.action || m.path.length > 0; })()', 'manager goes to the whiteboard', 8000);
    await sleep(2500);
    await shot('07-meeting');
    await p.click('[data-tab=work]');
    await p.until('document.querySelectorAll(".feed li").length >= 3', 'work feed');
    await sleep(1500);
    await shot('08-working');
    await p.click('[data-tab=tasks]');
    await p.until('document.querySelector(".board .card") !== null', 'task board');
    await sleep(600);
    await shot('09-tasks');
    await p.click('[data-tab=chat]');
    await p.until('document.querySelector(".question") !== null', 'question from staff', 60000);
    await shot('10-question');
    await p.type('.question input', 'Serious, but with buns');
    await p.click('.question button');
    await p.until('window.__office.state.tasks.every((t) => t.status === "done")', 'all tasks done', 90000);
    await p.until('[...document.querySelectorAll(".msg.manager")].some((m) => /All done/.test(m.textContent))', 'manager reports back', 30000);
    const seen = await p.ev('(clearInterval(window.__samp), window.__seen)');
    if (!seen.walk) throw new Error('nobody walked');
    if (!seen.typing) throw new Error('nobody typed');
    if (!seen.carry) throw new Error('no papers carried');
    if (!seen.bubbles) throw new Error('no speech bubbles');
    const spend = await p.ev('window.__office.state.spend.today');
    if (!(spend > 0)) throw new Error('no spend recorded');
    if (!/\$0\.\d+ of \$2\.00 today/.test(await p.ev('document.querySelector(".spend").textContent'))) throw new Error('spend label');
  });
  await step(tag('purchase requests show as pending, with no way to pay'), async () => {
    await p.click('[data-tab=requests]');
    await p.until('document.querySelector(".request") !== null', 'request card');
    await sleep(300);
    await shot('11-requests');
    const text = await p.ev('document.querySelector(".requests").textContent');
    if (!/Pending/.test(text) || !/can pay for anything/.test(text)) throw new Error('wording');
    await p.click('.request .btn:last-child');
    await p.until('/Declined/.test(document.querySelector(".request").textContent)', 'declined');
  });
  let siteUrl = '';
  await step(tag('gallery opens a working published site inside the sandbox'), async () => {
    await p.click('[data-tab=projects]');
    await p.until('document.querySelectorAll(".project").length === 3', 'three projects');
    await sleep(300);
    await shot('12-projects');
    siteUrl = await p.ev('window.__office.state.projects.find((x) => x.kind === "site").url');
    await p.click('.project.kind-site .btn.primary');
    await p.until('document.querySelector("iframe.site-frame") !== null', 'preview frame');
    await sleep(1500);
    await shot('13-site-preview');
    const sb = await p.ev('document.querySelector("iframe.site-frame").getAttribute("sandbox")');
    if (sb !== 'allow-scripts allow-forms allow-popups') throw new Error(`sandbox attr: ${sb}`);
    await p.ev('document.querySelector(".modal .icon-btn").click()');
  });
  await step(tag('the published site really works, on an opaque origin with no cookie access'), async () => {
    const s = await b.newPage(opts);
    await s.goto(`http://localhost:${t.port}${siteUrl}`);
    await s.until('document.querySelector("#b") !== null', 'site button');
    await s.click('#b');
    await s.until('document.querySelector("#o").textContent === "1 clap"', 'site JS works');
    await sleep(200);
    await s.shot(join(OUT, `${label}-14-published-site.jpg`));
    const origin = await s.ev('self.origin');
    if (origin !== 'null') throw new Error(`origin is ${origin}, not opaque`);
    const blocked = await s.ev('(() => { try { return document.cookie.length >= 0 ? "readable" : ""; } catch (e) { return e.name; } })()');
    if (blocked !== 'SecurityError') throw new Error(`document.cookie gave ${blocked}`);
    const ls = await s.ev('(() => { try { localStorage.setItem("a", "1"); return "open"; } catch (e) { return e.name; } })()');
    if (ls !== 'SecurityError') throw new Error(`localStorage gave ${ls}`);
    const api = await s.ev('fetch("/theoffice/api/me", { credentials: "include" }).then((r) => r.text()).catch((e) => "blocked")');
    if (api !== 'blocked') throw new Error('published site could read the API');
    const post = await s.ev(`fetch("/theoffice/api/floors/${slug}/chat", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{\\"text\\":\\"pwned\\"}" }).then((r) => String(r.status)).catch(() => "blocked")`);
    if (post !== 'blocked' && post !== '403') throw new Error(`POST from a site gave ${post}`);
    const live = await s.ev('fetch("/live", { credentials: "include" }).then(() => "read").catch(() => "blocked")');
    if (live !== 'blocked') throw new Error('site could read /live');
    s.close();
    await p.front();
  });
  await step(tag('private toggle hides a project from visitors right away'), async () => {
    await p.click('[data-tab=projects]');
    await p.until('document.querySelector(".project.kind-doc") !== null', 'doc card');
    await p.ev('document.querySelector(".project.kind-doc .toggle input").click()');
    await p.until('window.__office.state.projects.find((x) => x.kind === "doc").private === true', 'private set');
  });
  let docUrl = '';
  await step(tag('visitor: another person watches read-only, with no chat and no private work'), async () => {
    docUrl = await p.ev('window.__office.state.projects.find((x) => x.kind === "doc").url');
    const b2 = await launch();
    const v = await b2.newPage(opts);
    await v.goto(`${base}/floor/${slug}`);
    await v.until('document.body.dataset.page === "floor" && !!window.__office', 'visitor floor');
    await sleep(2200);
    await v.shot(join(OUT, `${label}-15-visitor.jpg`));
    const st = await v.ev('({ owner: window.__office.state.viewer.owner, chat: !!document.querySelector(".chat-input"), tabs: [...document.querySelectorAll(".tab")].map((t) => t.textContent), msgs: window.__office.state.messages === undefined, projects: window.__office.state.projects.length, controls: document.querySelector(".controls").textContent })');
    if (st.owner) throw new Error('visitor treated as owner');
    if (st.chat) throw new Error('visitor has a chat input');
    if (st.tabs.includes('Requests') || st.tabs.includes('Manager') || st.tabs.includes('Chat')) throw new Error(`visitor tabs ${st.tabs}`);
    if (!st.msgs) throw new Error('visitor can read messages');
    if (st.projects !== 2) throw new Error(`visitor sees ${st.projects} projects`);
    if (/Pause|Stop|Redirect|Customise/.test(st.controls)) throw new Error('visitor has controls');
    await v.goto(`http://localhost:${t.port}${docUrl}`);
    await sleep(300);
    if (!/Not found/.test(await v.ev('document.body.textContent'))) throw new Error('visitor reached a private doc');
    v.close(); b2.close();
    await p.front();
  });
  await step(tag('owner: pause, resume, redirect and stop controls work from the UI'), async () => {
    await p.click('[data-tab=chat]');
    await p.type('.chat-input textarea', 'go build long job [slow]');
    await p.click('.send');
    await p.until('window.__office.state.tasks.some((x) => x.status === "doing")', 'long job running', 20000);
    await p.click('.controls .btn:nth-of-type(1)');
    await p.until('window.__office.state.floor.paused === true && /Paused/.test(document.querySelector(".status-pill").textContent)', 'paused');
    await sleep(300); await shot('16-paused');
    await p.click('.controls .resume');
    await p.until('window.__office.state.floor.paused === false', 'resumed');
    await p.click('.controls .btn:nth-of-type(3)');
    await p.until('document.querySelector(".modal textarea") !== null', 'redirect dialog');
    await p.type('.modal textarea', 'Actually go build something else');
    await p.click('.modal button[type=submit]');
    await p.until('window.__office.state.tasks.some((x) => x.status === "cancelled")', 'old tasks cancelled');
    await p.until('window.__office.state.tasks.some((x) => x.status === "doing")', 'new tasks running', 20000);
    await p.click('.controls .btn:nth-of-type(2)');
    await p.until('document.querySelector(".modal .btn.danger") !== null', 'stop dialog');
    await p.click('.modal .btn.danger');
    await p.until('window.__office.state.tasks.every((x) => ["done", "cancelled", "failed"].includes(x.status))', 'all stopped', 15000);
    await p.until('[...document.querySelectorAll(".msg.notice")].some((m) => /stopped/.test(m.textContent))', 'stop notice');
  });
  await step(tag('walking out and back in shows it as it was, with no duplicates'), async () => {
    await p.click('.back');
    await p.until('document.body.dataset.page === "lobby"', 'lobby');
    await sleep(800);
    await p.goto(`${base}/floor/${slug}`);
    await p.until('!!window.__office', 'floor again');
    await p.until('document.querySelectorAll(".msg").length > 3', 'chat restored');
    const ids = await p.ev('[...document.querySelectorAll(".msg")].map((m) => m.dataset.id)');
    if (new Set(ids).size !== ids.length) throw new Error('duplicate messages');
  });
  await step(tag('a lift button rides up and walks into a floor'), async () => {
    await p.goto(base);
    await p.until('document.documentElement.classList.contains("ready")', 'ready');
    await sleep(1500);
    if (phone) await p.click('.sheet-grip'), await sleep(450);
    const n = await p.ev('[...document.querySelectorAll(".lift-btn.lit")].at(-1).dataset.lift');
    await p.click(`.lift-btn[data-lift="${n}"]`);
    await p.until('document.body.dataset.page === "floor" && !!window.__office', 'flew in', 8000);
  });
  await step(tag('no console errors, CSP violations or failed requests'), async () => {
    const errs = p.errors.filter((e) => !/status of 40[0-9]|status of 429/.test(e));
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ').slice(0, 800));
  });
  await step(tag('no overlaps: controls, panel and title all stay on screen and uncovered'), async () => {
    await sleep(500);
    const bad = await p.ev(`(() => {
      const out = []; const vw = innerWidth, vh = innerHeight;
      for (const s of ['.floor-top .back', '.floor-name', '.status-pill', '.spend', '.floor-panel', '.tabs', '.controls']) {
        const el = document.querySelector(s); if (!el) { out.push('missing ' + s); continue; }
        const r = el.getBoundingClientRect();
        if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) out.push('off screen ' + s);
      }
      const rect = (s) => document.querySelector(s).getBoundingClientRect();
      const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      if (hit(rect('.controls'), rect('.floor-panel'))) out.push('controls over panel');
      if (hit(rect('.floor-name'), rect('.status-pill'))) out.push('title over status');
      if (innerWidth > 760 && hit(rect('.spend'), rect('.floor-panel'))) out.push('spend over panel');
      if (document.documentElement.scrollWidth > vw + 1) out.push('page scrolls sideways');
      return out;
    })()`);
    if (bad.length) throw new Error(bad.join(', '));
  });
  p.close(); b.close();
}

async function runAdmin(t) {
  const base = `http://localhost:${t.port}/theoffice`;
  for (const [label, opts] of [['desktop', { width: 1440, height: 900 }], ['phone', { mobile: true }]]) {
    const b = await launch(); const p = await b.newPage(opts);
    const tag = (s) => `${label}: admin ${s}`;
    await step(tag('login refuses a wrong password, then accepts the right one'), async () => {
      await p.goto(`${base}/admin`);
      await p.until('document.querySelector(".admin-login input") !== null', 'admin login');
      await p.type('.admin-login input', 'wrong password');
      await p.click('.admin-login button');
      await p.until('(() => { const e = document.querySelector(".form-error"); return e && !e.hidden; })()', 'error');
      await p.type('.admin-login input', 'correct horse battery');
      await p.click('.admin-login button');
      await p.until('document.querySelector(".admin-table") !== null', 'dashboard');
      await sleep(400);
      await p.shot(join(OUT, `${label}-17-admin.jpg`));
    });
    await step(tag('sees floors, spend and pending purchase requests'), async () => {
      const txt = await p.ev('document.querySelector(".admin").textContent');
      if (!/Night Bakery|Pocket Circus/.test(txt)) throw new Error('floor missing');
      if (!/A domain name/.test(txt)) throw new Error('pending purchase missing');
    });
    await step(tag('issues a code that really opens a floor'), async () => {
      await p.click('.admin-actions .btn.primary');
      await p.until('document.querySelector(".modal input[type=number]") !== null', 'code dialog');
      await p.click('.modal button[type=submit]');
      await p.until('document.querySelector("[data-recovery]") !== null', 'code shown');
      const code = await p.ev('document.querySelector("[data-recovery]").textContent');
      const c = new Client(t);
      const r = await c.post('/api/claim/check', { code });
      if (r.status !== 200) throw new Error(`code check gave ${r.status}`);
      await p.ev('document.querySelector(".modal .icon-btn").click()');
    });
    await step(tag('suspend, unsuspend and global pause work'), async () => {
      const victim = 'hat-museum';
      await p.until(`document.querySelector('tr[data-floor="${victim}"]') !== null`, 'row');
      await p.click(`tr[data-floor="${victim}"] .acts .btn:first-child`);
      await p.until(`/Suspended/.test(document.querySelector('tr[data-floor="${victim}"]').textContent)`, 'suspended');
      await p.click(`tr[data-floor="${victim}"] .acts .btn:first-child`);
      await p.until(`/Open/.test(document.querySelector('tr[data-floor="${victim}"]').textContent)`, 'restored');
      await p.click('.admin-actions .btn.danger');
      await p.until('/Paused/.test(document.querySelector(".metrics").textContent)', 'paused');
      await p.click('.admin-actions .btn.primary:nth-child(2)');
      await p.until('/Running/.test(document.querySelector(".metrics").textContent)', 'running');
    });
    await step(tag('reset and kill work on a throwaway floor'), async () => {
      const d = await claim(t, `Throwaway ${label}`);
      await sleep(8200); // the table refreshes itself
      await p.until(`document.querySelector('tr[data-floor="${d.slug}"]') !== null`, 'new row');
      await p.click(`tr[data-floor="${d.slug}"] .acts .btn:nth-child(2)`);
      await p.until('document.querySelector("[data-confirm]") !== null', 'reset dialog');
      await p.click('[data-confirm]');
      await sleep(400);
      await p.click(`tr[data-floor="${d.slug}"] .acts .btn:nth-child(3)`);
      await p.until('document.querySelector("[data-confirm]") !== null', 'kill dialog');
      await p.click('[data-confirm]');
      await p.until(`document.querySelector('tr[data-floor="${d.slug}"]') === null`, 'row gone');
    });
    await step(tag('no console errors'), async () => {
      const errs = p.errors.filter((e) => !/status of 40[0-9]|status of 429/.test(e));
      if (errs.length) throw new Error(errs.slice(0, 5).join(' | ').slice(0, 800));
    });
    p.close(); b.close();
  }
}

const t = await boot({ mockDelayMs: Number(process.env.E2E_DELAY || 260), rateScale: 50 });
await claim(t, 'Hat Museum', { body: { tagline: 'A history of hats', colors: { primary: '#2f7ec7', accent: '#a9c4ff' } } });
const seed = await claim(t, 'Soup Finder', { body: { tagline: 'Every soup, ranked', colors: { primary: '#c8455a', accent: '#f4c95d' } } });
await seed.post(`/api/floors/${seed.slug}/chat`, { text: 'go build soup finder [buy]' });
const only = process.env.E2E_ONLY;
const code = async () => { const { issueCode } = await import('../../server/auth.js'); return issueCode(t.db); };
if (!only || only === 'desktop') await run('desktop', { width: 1440, height: 900 }, t, code);
if (!only || only === 'phone') await run('phone', { mobile: true }, t, code);
await runAdmin(t);
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${failures} failed`);
const errs = t.logs.filter((l) => l.includes('"level":"error"'));
if (errs.length) { console.log('server errors:', errs.slice(0, 5)); failures++; }
await t.close();
process.exit(failures ? 1 : 0);
