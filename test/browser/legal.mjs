// The Lawyer in a real browser: the boss fills in the three facts, sees the drafts with the honesty line, taps Approve, and the pages go live with footer links.
import { launch } from './cdp.mjs';
import { openDb, get, run } from '../../server/db.js';
import { loadConfig, loadModels } from '../../server/config.js';
import { createApp } from '../../server/app.js';
import { issueCode } from '../../server/auth.js';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../media');
mkdirSync(OUT, { recursive: true });
const PORT = 18093; const ORIGIN = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };
const db = openDb(':memory:');
const cfg = loadConfig({ AI_MODE: 'mock', ADMIN_PASSWORD: 'x', MOCK_DELAY_MS: '5', PUBLIC_ORIGIN: ORIGIN }, { rateScale: 1000 });
const app = createApp({ db, cfg, models: loadModels(), log: () => {} });
await new Promise((r) => app.server.listen(PORT, '127.0.0.1', r));
app.engine.start();
const b = await launch();
try {
  const p = await b.newPage({ width: 1280, height: 860 });
  await p.goto(`${ORIGIN}/theoffice/robots.txt`);
  const code = issueCode(db);
  const claimed = await p.ev(`fetch('/theoffice/api/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:${JSON.stringify(code)},name:'Paper Boats',bossName:'Colon',colors:{primary:'#225588',accent:'#ffcc00'},look:{}})}).then(r=>r.json())`);
  const slug = claimed.slug;
  const floor = get(db, 'SELECT * FROM floors WHERE slug=?', slug);
  const html = '<!doctype html><html><body><h1>Paper Boats</h1><form><input type="email" name="e"><button>Join</button></form></body></html>';
  run(db, 'INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?,?,?,?,?)', floor.id, 'boats', 'index.html', html, html.length);
  app.engine.upsertProject(floor, 'boats', { title: 'Paper Boats', description: 'Folded boats.', kind: 'site', sources: [], published: true });
  await p.goto(`${ORIGIN}/theoffice/floor/${slug}`);
  await p.until('!!window.__office && (window.__office.state.agents||[]).some(a=>a.role==="lawyer")', 'the floor with its Lawyer');
  await p.until('(window.__office.state.legal?.docs||[]).length > 0 || (window.__office.reload(), false)', 'the draft', 15000);
  await p.ev('window.__office.setTab("requests")');
  await p.until('!!document.querySelector("[data-legal-facts]")', 'the facts card');
  check('no Approve button before the facts', !(await p.ev('!!document.querySelector("[data-legal-approve]")')));
  for (const [k, v] of [['legalName', 'Paper Boats Ltd'], ['region', 'Ontario, Canada'], ['contact', 'ahoy@boats.test']]) {
    await p.ev(`(() => { const i = document.querySelector('input[name="legal-${k}"]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input')); })()`);
  }
  await p.click('[data-legal-facts-save]');
  await p.until('!!document.querySelector("[data-legal-approve]")', 'the Approve button');
  const card = await p.ev('document.querySelector("[data-legal-doc]").innerText');
  check('the draft says it is drafted by AI, once', (card.match(/Drafted by AI, not legal advice/g) || []).length === 1);
  check('the draft is written for what is true (forms, emails), not payments', /collects emails/.test(card) && !/takes payments/.test(card));
  await p.shot(join(OUT, 'legal-requests.jpg'));
  const before = await fetch(`${ORIGIN}/theoffice/f/${slug}/boats/terms`);
  check('nothing is live before the tap', before.status === 404, String(before.status));
  await p.click('[data-legal-approve]');
  await p.until('(window.__office.state.legal?.docs||[]).some(d=>d.status==="approved")', 'approval');
  const terms = await fetch(`${ORIGIN}/theoffice/f/${slug}/boats/terms`);
  const body = await terms.text();
  check('the Terms are live after the tap', terms.status === 200 && /Paper Boats Ltd/.test(body), String(terms.status));
  check('the published page never claims a lawyer wrote it', !/lawyer|attorney/i.test(body));
  const home = await (await fetch(`${ORIGIN}/theoffice/f/${slug}/boats/`)).text();
  check('the footer links are on the site', /data-office-legal/.test(home) && /terms">Terms/.test(home));
  await p.goto(`${ORIGIN}/theoffice/terms`);
  check('The Office has its own Terms page', /you are the seller/i.test(await p.ev('document.body.innerText')));
  await p.shot(join(OUT, 'legal-office-terms.jpg'));
} catch (e) { fail++; console.log(`FAIL ${e.message}`); } finally {
  await b.close?.();
  await app.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
