// A camera for launch cards (docs/redesign, Q3 and Q6): a headless Chromium driven over the DevTools protocol, with no npm package and no model.
// It opens a public page at 1280x800, waits for it to settle, and keeps a 640x400 JPEG: 16:10, card sized, a small file.
// Either it starts a Chromium of its own (SHOTS_CHROME, or the first one found where Playwright images keep it), or it uses one already running
// with remote debugging on (SHOTS_CDP_URL, e.g. a browser container next to the office). No browser at all is not an error: it says so.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { lookup } from 'node:dns/promises';

export const SHOT = { width: 1280, height: 800, scale: 0.5, quality: 72 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where a Chromium might be: the setting, then the places the Playwright images and this repo's test machines keep one. */
export function findChrome(setting = '') {
  if (setting) return existsSync(setting) ? setting : null;
  const fixed = ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const p of fixed) if (existsSync(p)) return p;
  // Playwright's own layout: /ms-playwright/chromium_headless_shell-NNNN/chrome-linux/headless_shell (the office-runner/browser image), or chromium-NNNN/chrome-linux/chrome.
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright', '/opt/pw-browsers'].filter(Boolean)) {
    let dirs = []; try { dirs = readdirSync(root); } catch { continue; }
    for (const d of dirs.sort().reverse()) {
      for (const rel of ['chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux/chrome', 'chrome-linux64/chrome']) {
        const p = join(root, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

/**
 * A shooter: { shoot(url) -> Buffer (JPEG), close() }, or null when there is no browser to drive.
 * `cdpUrl` (http://host:9222) wins over `chrome`. Chromium refuses a DevTools request whose Host is a name, so a name is looked up first.
 */
export async function makeShooter({ chrome = '', cdpUrl = '', timeoutMs = 20000, settleMs = 1500 } = {}) {
  let base, proc = null, dir = null;
  if (cdpUrl) {
    const u = new URL(cdpUrl);
    const ip = /^[\d.]+$|^\[/.test(u.hostname) ? u.hostname : (await lookup(u.hostname, { family: 4 })).address;
    base = `http://${ip}:${u.port || 9222}`;
  } else {
    const exe = findChrome(chrome);
    if (!exe) return null;
    const port = await freePort();
    dir = mkdtempSync(join(tmpdir(), 'office-shots-'));
    proc = spawn(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--disable-extensions', '--disable-background-networking',
      `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
    proc.on('error', () => {});
    base = `http://127.0.0.1:${port}`;
  }
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(`${base}/json/version`)).ok; } catch { await sleep(100); } }
  if (!up) { proc?.kill('SIGKILL'); if (dir) rmSync(dir, { recursive: true, force: true }); return null; }

  async function shoot(url) {
    const made = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(made.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, base.replace(/^http/, 'ws')));
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    let id = 0; const pending = new Map(); let loaded = null; const loadedP = new Promise((r) => { loaded = r; });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
      if (m.method === 'Page.loadEventFired') loaded();
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
    let tm; const timer = new Promise((_, reject) => { tm = setTimeout(() => reject(new Error('the page took too long')), timeoutMs); });
    try {
      const work = (async () => {
        await send('Page.enable');
        await send('Emulation.setDeviceMetricsOverride', { width: SHOT.width, height: SHOT.height, deviceScaleFactor: 1, mobile: false });
        // Sound off and no prompts: a page is looked at, never interacted with.
        await send('Page.navigate', { url });
        await Promise.race([loadedP, sleep(timeoutMs - settleMs - 500)]);
        await sleep(settleMs);
        const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: SHOT.quality, clip: { x: 0, y: 0, width: SHOT.width, height: SHOT.height, scale: SHOT.scale } });
        return Buffer.from(r.data, 'base64');
      })();
      work.catch(() => {});  // a page that loses the race may still fail later, quietly
      timer.catch(() => {});
      return await Promise.race([timer, work]);
    } finally {
      clearTimeout(tm);
      try { ws.close(); } catch { /* gone */ }
      fetch(`${base}/json/close/${made.id}`).catch(() => {});
    }
  }
  return {
    shoot,
    close() { if (proc) { proc.kill('SIGKILL'); setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }, 500); } },
  };
}
