// ---- The command line on a computer, appended to server/playtest.js as .office/playtest.mjs. Not imported by the server. ----
// node .office/playtest.mjs project --type game|app|website --out .office/playtest [--seconds 60]
// Serves the folder (with _office/ mapped to .office/), runs the browser half at desktop and phone size under Playwright, and writes
// playtest.json with a result for each browser rule, plus screenshots for the Tester to judge against the design doc.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const root = resolve(argv[0] && !argv[0].startsWith('--') ? argv[0] : 'project');
const kind = opt('type', 'game'), outDir = resolve(opt('out', '.office/playtest')), secs = Number(opt('seconds', 60));
const OFFICE_DIR = dirname(fileURLToPath(import.meta.url));
const SHARED = { 'office.js': 'office.js', 'client.js': 'client.js', 'three.module.min.js': 'three.module.min.js', 'phaser.min.js': 'phaser.min.js' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const shared = path.match(/\/_office\/([^/]+)$/);
  let file = shared && SHARED[shared[1]] ? join(OFFICE_DIR, SHARED[shared[1]]) : join(root, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(root) && !file.startsWith(OFFICE_DIR)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) { if (extname(path)) { res.writeHead(404); res.end('not found'); return; } file = join(root, 'index.html'); }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' }); res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const siteUrl = `http://127.0.0.1:${server.address().port}/`;
let chromium;
try { ({ chromium } = await import('playwright')); } catch { console.error('Playwright is missing. Run: npm i -D playwright && npx playwright install chromium'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const runs = [];
try {
  for (const phone of [false, true]) {
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(INIT_SCRIPT);
    const page = await ctx.newPage(); const errs = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/Office Cloud: no Office server/.test(m.text())) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e.message)));
    const cdp = phone ? await ctx.newCDPSession(page) : null;
    const tag = phone ? 'phone' : 'desktop';
    const d = {
      phone, size: phone ? { w: 390, h: 844 } : { w: 1280, h: 800 },
      goto: (u) => page.goto(u, { waitUntil: 'load' }),
      eval: (x) => page.evaluate(x),
      key: (code, down) => (down ? page.keyboard.down(code) : page.keyboard.up(code)),
      drag: async (x1, y1, x2, y2, ms = 300) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
        for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + ((x2 - x1) * i) / 6, y: y1 + ((y2 - y1) * i) / 6 }] }); await new Promise((r) => setTimeout(r, ms / 6)); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
      shot: async (n) => { const f = join(outDir, `${tag}-${n}.png`); await page.screenshot({ path: f }); return f; },
      errors: () => errs,
    };
    if (kind === 'game') { await d.goto(siteUrl); runs.push({ tag, ...(await playGame(d, { seconds: secs })) }); }
    else if (kind === 'app') runs.push({ tag, ...(await useApp(d, { url: siteUrl })) });
    else runs.push({ tag, ...(await walkSite(d, { url: siteUrl })) });
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
const all = combine(runs);
const report = { type: kind, rules: all.rules, notes: all.notes, errors: all.errors, shots: all.shots, runs: runs.map(({ tag, rules, notes, fps, scenes, input }) => ({ tag, rules, notes, fps, scenes, input })) };
writeFileSync(join(outDir, 'playtest.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ rules: report.rules, notes: report.notes.slice(0, 10), errors: report.errors.slice(0, 5), shots: report.shots }, null, 1));
