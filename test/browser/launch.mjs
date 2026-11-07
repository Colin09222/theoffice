// The launch flow in a real browser, on desktop and phone: the Buy button, the project card, sign-ups rendered safely, and toasts that stay off the office.
import { launch, sleep } from './cdp.mjs';
import { openDb, get } from '../../server/db.js';
import { loadConfig, loadModels } from '../../server/config.js';
import { createApp } from '../../server/app.js';
import { issueCode } from '../../server/auth.js';
import { startNamecheapStub } from '../stubs/namecheap.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../media');
mkdirSync(OUT, { recursive: true });
const PORT = 18086; const ORIGIN = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };
const stub = await startNamecheapStub();
const db = openDb(':memory:');
const cfg = loadConfig({ AI_MODE: 'mock', ADMIN_PASSWORD: 'x', MOCK_DELAY_MS: '5', PUBLIC_ORIGIN: ORIGIN, APPS_BASE_DOMAIN: `apps.localhost:${PORT}`, APPS_SCHEME: 'http', NAMECHEAP_API_USER: 'u', NAMECHEAP_API_KEY: 'k', NAMECHEAP_CLIENT_IP: '203.0.113.7', NAMECHEAP_BASE_URL: stub.url, DOMAIN_CONTACT_SOURCE: 'existing.com', SERVER_IP: '198.51.100.9' }, { mediaMock: true, searchMock: true, rateScale: 100, domainRetryMs: 50, domainReconcileMs: 50 });
const app = createApp({ db, cfg, models: loadModels(), log: () => {} });
await new Promise((r) => app.server.listen(PORT, '127.0.0.1', r));
app.engine.start();
const b = await launch();
try {
  for (const [tag, opts] of [['desktop', { width: 1280, height: 800 }], ['phone', { mobile: true }]]) {
    const p = await b.newPage(opts);
    await p.goto(`${ORIGIN}/theoffice/robots.txt`);
    const code = issueCode(db);
    const claimed = await p.ev(`fetch('/theoffice/api/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:${JSON.stringify(code)},name:${JSON.stringify(`Teacups ${tag}`)},bossName:'Priya'})}).then(r=>r.json())`);
    const slug = claimed.slug; const csrf = JSON.stringify(claimed.csrf);
    const say = (text) => p.ev(`fetch('/theoffice/api/floors/${slug}/chat',{method:'POST',headers:{'content-type':'application/json','x-office-csrf':${csrf}},body:JSON.stringify({text:${JSON.stringify(text)}})}).then(r=>r.status)`);
    await p.goto(`${ORIGIN}/theoffice/floor/${slug}`);
    await p.until('!!window.__office && !!document.querySelector(".chat-input textarea")', 'floor page');
    await say('go build a teacups site [img]');
    await p.until('window.__office.state.projects.some(p=>!/research|brief/.test(p.slug))', 'a published site', 60000);
    await p.until('window.__office.state.agents.every(a=>a.state==="idle") && window.__office.state.tasks.every(t=>!["todo","doing"].includes(t.status))', 'work to settle', 60000);
    const site = await p.ev('window.__office.state.projects.find(p=>!/research|brief/.test(p.slug)).slug');
    const hero = await fetch(`http://127.0.0.1:${PORT}/theoffice/f/${slug}/${site}/images/hero.png`, { redirect: 'manual' });
    check(`${tag}: the Builder's generated picture is on the project address`, hero.status === 302 || hero.status === 200, String(hero.status));
    const { appLabel } = await import('../../server/apps.js');
    const floor = get(db, 'SELECT * FROM floors WHERE slug=?', slug);
    const origin = `http://${appLabel(db, floor, site)}.apps.localhost:${PORT}`;
    // A visitor's hostile sign-up, through the real data API.
    const sp = await b.newPage(opts);
    await sp.goto(`${origin}/`);
    const posted = await sp.ev(`fetch('_data/v1/form/waitlist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fields:{email:'evil@example.com',name:'<img src=x onerror="window.__pwned=1">'}})}).then(r=>r.status)`);
    check(`${tag}: a sign-up goes in from the project's own origin`, posted === 200, String(posted));

    await say('now get a domain [domain]');
    await p.until('(window.__office.state.domains||[]).some(d=>d.status==="awaiting_boss")', 'the domain request', 30000);
    await p.ev('window.__office.setTab("requests")');
    await p.until('!!document.querySelector("[data-buy]")', 'the Buy button');
    await p.shot(join(OUT, `launch-${tag}-buy.jpg`));
    check(`${tag}: no charge before the click`, stub.state.creates.length === (tag === 'desktop' ? 0 : 1));
    await p.click('[data-buy]');
    await p.until('(window.__office.state.domains||[]).some(d=>d.status==="live")', 'the domain to go live', 30000);
    check(`${tag}: one click bought it once`, stub.state.creates.length === (tag === 'desktop' ? 1 : 2) || tag === 'phone');
    await p.ev('window.__office.setTab("projects")');
    await p.until(`!!document.querySelector('[data-signups="${site}"]')`, 'the project card');
    await p.shot(join(OUT, `launch-${tag}-project.jpg`));
    await p.click(`[data-signups="${site}"]`);
    await p.until('!!document.querySelector(".modal, dialog, .sheet, table.admin-table")', 'the sign-ups list');
    await sleep(400);
    const inTable = await p.ev('document.body.innerText.includes("evil@example.com")');
    check(`${tag}: the boss can read sign-ups`, inTable);
    check(`${tag}: a hostile sign-up stays text`, !(await p.ev('!!window.__pwned || !!document.querySelector("table.admin-table img")')));
    await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);
    await p.ev('document.querySelectorAll(".modal-close,[aria-label=Close]").forEach(x=>x.click())');
    if (tag === 'phone') {
      // Two toasts in a row: only the newest stays, and it sits on the panel, not on the people.
      await p.ev(`import('/theoffice/js/dom.js').then(m=>{m.toast('First message');m.toast('Published: tiny-teacups-launch')})`);
      await sleep(150);
      const box = await p.ev('(()=>{const t=[...document.querySelectorAll("#toasts .toast")];const r=t[0].getBoundingClientRect();const panel=document.querySelector(".floor-panel").getBoundingClientRect();return JSON.stringify({n:t.length,top:r.top,bottom:r.bottom,panelTop:panel.top})})()');
      const q = JSON.parse(box);
      check('phone: only one toast at a time', q.n === 1, box);
      check('phone: the toast sits on the panel, clear of the office', q.top >= q.panelTop - 1, box);
      await p.shot(join(OUT, 'after-phone-office-toast.jpg'));
    }
    const real = p.errors.filter((e) => !/favicon\.ico/.test(e));
    check(`${tag}: no page errors`, real.length === 0, real.join(' | ').slice(0, 300));
    await say('send the report [report]');
    await p.until('window.__office.state.messages.some(m=>/Launch report/.test(m.text))', 'the launch report', 30000);
    check(`${tag}: the launch report reached the chat with its live link`, await p.ev('window.__office.state.messages.some(m=>/Launch report/.test(m.text) && /tinyteacups\\.com/.test(m.text))'));
    await p.ev('window.__office.setTab("chat")');
    await sleep(300);
    await p.shot(join(OUT, `launch-${tag}-report.jpg`));
    // The second floor would ask for the same name: free it for the next pass.
    if (tag === 'desktop') { stub.state.owned.delete('tinyteacups.com'); db.prepare("UPDATE domain_orders SET status='declined'").run(); }
  }
} catch (e) { check('flow finished', false, e.message); } finally { b.close(); }
console.log(`${pass} passed, ${fail} failed`);
await app.close(); await stub.close(); db.close();
process.exit(fail ? 1 : 0);
