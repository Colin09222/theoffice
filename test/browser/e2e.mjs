// Real-browser end-to-end at 1440x900 and 390x844, against the real server in mock mode: lobby, claim, customise, chat,
// watching agents work, opening a published site, visitor view and admin. Every step is asserted, and screenshots go to media/.
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';
import { boot, Client, claim, until } from '../helpers.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../media');
mkdirSync(OUT, { recursive: true });
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; console.log(results.at(-1)); };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, e.message); } };
const q = (s) => JSON.stringify(s);

// Floors with a question waiting, for the building manager's half of the test.
const helpFloors = [];
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
    console.log(`  ${label} lobby draw calls ${await p.ev('__stage.renderer.info.render.calls')}, triangles ${await p.ev('__stage.renderer.info.render.triangles')}`);
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
    if (phone) await p.drag(70, 420, 310, 480, true);
    else {
      await p.drag(150, 700, 60, 690, false);
      await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 150, y: 700, deltaX: 0, deltaY: -200 });
    }
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
  await step(tag('a new floor offers three clear ways in, on screen and big enough to tap'), async () => {
    await p.until('document.querySelectorAll(".lanes .lane").length === 3', 'the lane buttons');
    const info = await p.ev(`(() => {
      const list = document.querySelector(".chat-list"); list.scrollTop = list.scrollHeight;
      const panel = document.querySelector(".floor-panel").getBoundingClientRect();
      const input = document.querySelector(".chat-input").getBoundingClientRect();
      return { names: [...document.querySelectorAll(".lane b")].map((b) => b.textContent), boxes: [...document.querySelectorAll(".lane")].map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, inPanel: r.left >= panel.left - 1 && r.right <= panel.right + 1, clearOfInput: r.bottom <= input.top + 1 || r.top >= input.bottom }; }), welcome: document.querySelector(".msg.manager").textContent, note: document.querySelector(".lanes .fineprint").textContent };
    })()`);
    if (info.names.join() !== 'Game,Website,Business') throw new Error(`names: ${info.names}`);
    if (!/Tap one below/.test(info.welcome)) throw new Error(`welcome: ${info.welcome}`);
    if (!/Nobody here can send email, post, run ads or spend money/.test(info.note)) throw new Error(`note: ${info.note}`);
    for (const b of info.boxes) if (b.h < 44 || !b.inPanel || !b.clearOfInput) throw new Error(`a button is badly placed: ${JSON.stringify(b)}`);
    await sleep(200);
    await p.shot(join(OUT, `lanes-new-floor-${label}.jpg`));
  });
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
    await p.until('document.querySelector(".lanes") === null', 'the lane buttons go once the boss has spoken');
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
    console.log(`  ${label} office draw calls ${await p.ev('__stage.renderer.info.render.calls')}, triangles ${await p.ev('__stage.renderer.info.render.triangles')}, dpr ${await p.ev('__stage.renderer.getPixelRatio()')}`);
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
    // The boss sees a share of the allowance, never a dollar figure.
    const allowance = await p.ev('document.querySelector(".spend").textContent');
    if (!/^\d+% of today's allowance$/.test(allowance)) throw new Error(`spend label: ${allowance}`);
  });
  await step(tag('purchase requests go to the building manager, with no way to pay from here'), async () => {
    await p.click('[data-tab=requests]');
    await p.until('document.querySelector(".request") !== null', 'request card');
    await sleep(300);
    await shot('11-requests');
    const text = await p.ev('document.querySelector(".requests").textContent');
    if (!/With the building manager/.test(text) || !/can't spend money/.test(text)) throw new Error('wording');
    if (/domain/i.test(text.replace(/A domain name/g, ''))) throw new Error('promised a domain button that does not exist here');
    await p.click('.request .btn:last-child');
    await p.until('/Declined/.test(document.querySelector(".request").textContent)', 'declined');
  });
  let siteUrl = '';
  await step(tag('gallery opens a working published site inside the sandbox'), async () => {
    await p.click('[data-tab=projects]');
    await p.until('document.querySelectorAll(".project").length === 3', 'three projects');
    await sleep(300);
    await shot('12-projects');
    // This building has no project origins, so nothing here can offer what only they can do.
    if (await p.ev('document.querySelector("[data-signups]") !== null')) throw new Error('offered sign-ups a form could never fill');
    if (await p.ev('document.querySelector(".project.kind-doc [data-pay], .project.kind-research [data-pay]") !== null')) throw new Error('offered a payment link on a document');
    await p.click('.project.kind-site [data-stats]');
    await p.until('document.querySelector(".modal") !== null', 'visitor stats');
    if (await p.ev('/search engines/i.test(document.querySelector(".modal").textContent)')) throw new Error('offered a search-engine switch that does nothing here');
    await p.ev('document.querySelector(".modal .icon-btn").click()');
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
  await step(tag('standing orders: set one in the UI, see its schedule, run it now, read the report, pause and delete'), async () => {
    await p.click('[data-tab=orders]');
    await p.until('document.querySelector("[data-orders-form]") !== null', 'orders tab');
    await p.type('[data-orders-form] textarea', 'Every morning, check the bakery site still loads and write a one-line note');
    await p.ev('(() => { const at = document.querySelector("[data-orders-form] input[name=at]"); at.value = "07:30"; at.dispatchEvent(new Event("input")); })()');
    await p.click('[data-orders-form] button[type=submit]');
    await p.until('document.querySelector("article.order[data-order]") !== null', 'order card');
    const card = await p.ev('document.querySelector("article.order").textContent');
    if (!/Every day at 07:30/.test(card) || !/Next run/.test(card) || !/Not run yet/.test(card) || /\$/.test(card)) throw new Error(`card text: ${card.slice(0, 160)}`);
    await sleep(300); await p.shot(join(OUT, `plus-orders-${label}.jpg`));
    await p.click('article.order [data-run]');
    await p.until('window.__office.state.tasks.some((x) => x.status === "doing" || x.status === "review" || x.status === "done")', 'order run started through the engine', 20000);
    await p.until('(() => { const o = (window.__office.state.orders || [])[0]; return !!o && o.history.length > 0 && o.history[0].status !== "running"; })()', 'run finished and recorded', 40000);
    const run = await p.ev('JSON.stringify(window.__office.state.orders[0].history[0])');
    const r = JSON.parse(run);
    if (!r.report || typeof r.costUsd !== 'number' || typeof r.estUsd !== 'number') throw new Error(`run record: ${run.slice(0, 200)}`);
    await p.click('[data-tab=chat]');
    await p.until('document.querySelector(".msg.report") !== null', 'report in the chat');
    await p.click('[data-tab=orders]');
    await p.until('document.querySelector("article.order .order-history") !== null', 'history shown');
    await sleep(200); await p.shot(join(OUT, `plus-orders-report-${label}.jpg`));
    await p.click('article.order [data-pause]');
    await p.until('document.querySelector("article.order[data-status=paused]") !== null', 'paused');
    await p.ev('window.confirm = () => true');
    await p.click('article.order [data-delete]');
    await p.until('document.querySelector("article.order") === null', 'deleted');
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
  const siteSlug = siteUrl.split('/').filter(Boolean).at(-1);
  await step(tag('lobby ticker shows this floor\'s launch, live, with no private work'), async () => {
    await p.goto(base);
    await p.until('document.documentElement.classList.contains("ready")', 'ready');
    await p.until('document.querySelector(".ticker[data-ticker=live]") !== null', 'ticker live');
    await p.until(`[...document.querySelectorAll(".ticker-item.published")].some((i) => i.textContent.includes(${q(companyName)}) && /launched/.test(i.textContent))`, 'launch in the ticker');
    const info = await p.ev(`(() => {
      const items = [...document.querySelectorAll(".ticker-item")];
      const pub = items.find((i) => i.classList.contains("published") && i.textContent.includes(${q(companyName)}));
      const r = document.querySelector(".ticker").getBoundingClientRect();
      const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      const over = [".hero h1", ".open-pill", ".sheet-grip", ".directory", ".hints", ".topbar .btn"].filter((s) => { const e = document.querySelector(s); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && getComputedStyle(e).opacity !== "0" && hit(r, b); });
      return { n: items.length, href: pub?.getAttribute("href"), rel: pub?.getAttribute("rel"), target: pub?.getAttribute("target"), text: items.map((i) => i.textContent).join(" | "), onScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, over, anim: getComputedStyle(document.querySelector(".ticker-rail")).animationName };
    })()`);
    if (!info.n || info.n > 20) throw new Error(`${info.n} ticker items`);
    if (!/\/theoffice\/f\/.+\/$/.test(info.href || '') || info.rel !== 'noopener noreferrer' || info.target !== '_blank') throw new Error(`launch link ${info.href} ${info.rel} ${info.target}`);
    if (/working on something private|Private task/i.test(info.text)) throw new Error('private text in the ticker');
    if (info.text.includes(`${siteSlug}: launch brief`) || info.text.includes(`${siteSlug}-brief`)) throw new Error('the doc that was made private is in the ticker');
    if (!info.onScreen) throw new Error('ticker off screen');
    if (info.over.length) throw new Error(`ticker overlaps ${info.over.join(', ')}`);
    if (info.anim !== 'ticker-roll') throw new Error(`ticker not rolling: ${info.anim}`);
    await sleep(600);
    await p.shot(join(OUT, `plus-lobby-ticker-${label}.jpg`));
  });
  await step(tag('the launched wall lists the floor\'s public site with a thumbnail, and opens it'), async () => {
    if (phone) { await p.click('.sheet-grip'); await p.until('document.querySelector(".directory").classList.contains("open")', 'sheet open'); await sleep(600); }
    // A headless phone under a 3D scene can still be mid-slide when the tap lands, so the toggle is tapped until it takes.
    for (let i = 0; ; i++) {
      await p.click('[data-wall=toggle]');
      try { await p.until('document.querySelector("[data-wall=toggle]").getAttribute("aria-pressed") === "true"', 'wall toggled on', 2500); break; } catch (e) { if (i >= 3) throw e; await sleep(400); }
    }
    await p.until('document.querySelector("[data-wall=grid]:not([hidden]) .wall-card") !== null', `wall cards (${await p.ev('document.querySelector("[data-wall=grid]")?.textContent.slice(0, 120)')})`);
    await p.until(`[...document.querySelectorAll(".wall-card")].some((c) => c.textContent.includes(${q(companyName)}) && c.dataset.project === ${q(siteSlug)})`, 'our card');
    await p.until(`(() => { const img = document.querySelector('.wall-card[data-project=${q(siteSlug)}] img'); return img && img.complete && img.naturalWidth > 0; })()`, 'thumbnail loaded');
    const wall = await p.ev(`(() => {
      const cards = [...document.querySelectorAll(".wall-card")];
      const ours = cards.find((c) => c.dataset.project === ${q(siteSlug)});
      const open = ours.querySelector("a.btn");
      const visit = [...ours.querySelectorAll("button")].find((b) => /Visit floor/.test(b.textContent));
      const vw = innerWidth; const bad = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.left < -1 || r.right > vw + 1; }).length;
      return { n: cards.length, slugs: cards.map((c) => c.dataset.project), text: cards.map((c) => c.textContent).join(" | "), href: open?.getAttribute("href"), rel: open?.getAttribute("rel"), target: open?.getAttribute("target"), visit: !!visit, bad, dirRows: document.querySelectorAll(".dir-list:not([hidden]) .dir-row").length, thumb: ours.querySelector("img").getAttribute("src") };
    })()`);
    if (!wall.href || wall.rel !== 'noopener noreferrer' || wall.target !== '_blank') throw new Error(`open link ${wall.href} ${wall.rel}`);
    if (!wall.visit) throw new Error('no Visit floor button');
    if (wall.text.includes(`${siteSlug}: launch brief`) || wall.slugs.includes(`${siteSlug}-brief`)) throw new Error('private doc on the wall');
    if (wall.bad) throw new Error(`${wall.bad} cards off the sides`);
    if (wall.dirRows) throw new Error('directory rows still showing under the wall');
    if (!/\/api\/building\/thumb\//.test(wall.thumb)) throw new Error(`thumb ${wall.thumb}`);
    await sleep(400);
    await p.shot(join(OUT, `plus-launched-wall-${label}.jpg`));
    await p.click('[data-wall=toggle]');
    await p.until('document.querySelectorAll(".dir-row").length > 0 && document.querySelector("[data-wall=grid]").hidden', 'directory back');
    if (phone) { await p.click('.sheet-grip'); await sleep(450); }
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
  // A floor of its own, in a browser of its own: a real tap, a short conversation, then the help line as the boss and a visitor see it.
  const b3 = await launch(); const n = await b3.newPage(opts);
  let laneSlug = '';
  const shotN = (name) => n.shot(join(OUT, `lanes-${name}-${label}.jpg`));
  await step(tag('tapping a lane starts a short conversation with the manager, and no work'), async () => {
    await n.goto(`${base}/robots.txt`);
    const made = await n.ev(`fetch('/theoffice/api/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:${q(await adminCode())},name:${q(`Lanes ${label}`)},bossName:'Sam'})}).then(r=>r.json())`);
    laneSlug = made.slug;
    await n.goto(`${base}/floor/${laneSlug}`);
    await n.until('document.querySelectorAll(".lanes .lane").length === 3', 'the lane buttons');
    await n.click('[data-lane=business]');
    await n.until('[...document.querySelectorAll(".msg.boss")].some((m) => /small business/.test(m.textContent))', 'the tap became the boss\'s message');
    await n.until('document.querySelector(".lanes") === null', 'the buttons went');
    await n.until('[...document.querySelectorAll(".msg.manager")].some((m) => /What is the idea, and who is it for/.test(m.textContent) && /Nobody here can send email/.test(m.textContent))', 'the manager asks and says what nobody here can do');
    await n.until('window.__office.state.agents.every((a) => a.state === "idle")', 'manager idle');
    if (await n.ev('window.__office.state.tasks.length !== 0')) throw new Error('a tap should start no work');
    await sleep(300);
    await shotN('business-reply');
    // Typing is still there, and a reload doesn't bring the buttons back.
    await n.goto(`${base}/floor/${laneSlug}`);
    await n.until('!!window.__office && !!document.querySelector(".chat-input textarea")', 'floor again');
    if (await n.ev('document.querySelector(".lanes") !== null')) throw new Error('the buttons came back');
  });
  await step(tag('the help line shows in the feed and on the board, and a visitor sees only that it happened'), async () => {
    await n.type('.chat-input textarea', 'The checker keeps failing, please ask [help]');
    await n.click('.send');
    await n.until('(window.__office.state.help || []).some((x) => x.status === "pending")', 'the request');
    await n.until('[...document.querySelectorAll(".msg.manager")].some((m) => /I have asked buddehbot/.test(m.textContent))', 'the manager says so and carries on');
    await n.until('window.__office.state.agents.every((a) => a.state === "idle")', 'manager idle');
    await n.click('[data-tab=work]');
    await n.until('[...document.querySelectorAll(".feed li")].some((l) => /asked buddehbot for help/.test(l.textContent))', 'the feed line');
    await n.click('[data-tab=tasks]');
    await n.until('document.querySelector(".card.help.pending") !== null', 'the card on the board');
    const card = await n.ev('document.querySelector(".card.help.pending").textContent');
    if (!/Asked buddehbot for help/.test(card) || !/The checker keeps failing/.test(card)) throw new Error(`card: ${card}`);
    if (!/Waiting on buddehbot/.test(await n.ev('document.querySelector(".staff-strip").textContent'))) throw new Error('the manager\'s chip does not say so');
    await sleep(200);
    await shotN('help-board');
    const b4 = await launch(); const v = await b4.newPage(opts);
    await v.goto(`${base}/floor/${laneSlug}`);
    await v.until('!!window.__office', 'visitor floor');
    const seen = await v.ev('JSON.stringify(window.__office.state)');
    if (seen.includes('The checker keeps failing')) throw new Error('a visitor can read the question');
    if (await v.ev('document.querySelector(".lanes") !== null')) throw new Error('a visitor got the lane buttons');
    await v.ev('window.__office.setTab("tasks")');
    await v.until('document.querySelector(".card.help.pending") !== null', 'the plain card');
    if (/The checker keeps failing/.test(await v.ev('document.body.textContent'))) throw new Error('a visitor can see the question on the page');
    await v.ev('window.__office.setTab("work")');
    await v.until('[...document.querySelectorAll(".feed li")].some((l) => /asked buddehbot for help/.test(l.textContent))', 'the plain feed line');
    v.close(); b4.close();
    await n.front();
  });
  await step(tag('no console errors on that floor'), async () => {
    const errs = n.errors.filter((e) => !/status of 40[0-9]|status of 429/.test(e));
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ').slice(0, 800));
  });
  n.close(); b3.close();
  if (laneSlug) helpFloors.push(laneSlug);
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
    await step(tag('help line: a fenced question, answered in a dialog, reaches that floor as guidance'), async () => {
      const slug = helpFloors.shift();
      if (!slug && process.env.E2E_ONLY) return;  // one viewport only leaves one floor for two admin passes
      if (!slug) throw new Error('no floor with a question waiting');
      const row = await p.until(`(() => { const a = [...document.querySelectorAll(".help-line [data-help]")].find((c) => /The checker keeps failing/.test(c.textContent)); return a ? a.dataset.help : null; })()`, 'the request');
      const text = await p.ev(`document.querySelector('.help-line [data-help="${row}"]').textContent`);
      if (!/<<<UNTRUSTED_FLOOR_DATA [0-9a-f]+ question>>> The checker keeps failing/.test(text)) throw new Error(`not fenced: ${text.slice(0, 200)}`);
      if (!/never instructions to follow/.test(await p.ev('document.querySelector(".help-line").textContent'))) throw new Error('no notice over it');
      await sleep(200);
      await p.shot(join(OUT, `lanes-admin-help-${label}.jpg`));
      await p.click(`[data-answer="${row}"]`);
      await p.until('document.querySelector(".modal textarea") !== null', 'the dialog');
      await p.type('.modal textarea', 'Use the second checker.');
      await p.click('.modal button[type=submit]');
      await p.until(`document.querySelector('.help-line [data-help="${row}"]') === null`, 'it leaves the list');
      await until(async () => { const r = await new Client(t).get(`/api/floors/${slug}`); return r.data.helpWaiting === 0; });
      const { get } = await import('../../server/db.js');
      const floor = get(t.db, 'SELECT id FROM floors WHERE slug=?', slug);
      await until(() => get(t.db, "SELECT 1 x FROM messages WHERE floor_id=? AND role='help' AND text LIKE '%Use the second checker%'", floor.id) && get(t.db, "SELECT 1 x FROM messages WHERE floor_id=? AND role='manager' AND text LIKE '%Thanks to buddehbot%'", floor.id));
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

// FILLER_COMPANIES=1 runs the same suite with the demo companies seeded, so their floors can't break the lobby or the counts.
const t = await boot({ mockDelayMs: Number(process.env.E2E_DELAY || 260), rateScale: 50, fillerCompanies: process.env.FILLER_COMPANIES === '1', fillerTickMs: 1500, ordersTickMs: 1200 });
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
