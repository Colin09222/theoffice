// A camera for launch cards (docs/redesign, Q3 and Q6): a headless Chromium driven over the DevTools protocol, with no npm package and no model.
// It opens a public page at 1280x800, waits for it to settle, and keeps a 640x400 JPEG: 16:10, card sized, a small file.
// The server never starts a process (test/security.test.js): it only talks to a Chromium that is already running with remote debugging on,
// at SHOTS_CDP_URL (a browser container next to the office, say). scripts/chrome.mjs starts one for the command-line script and the tests.
// No browser at all is not an error: there is simply no camera.
import { lookup } from 'node:dns/promises';

export const SHOT = { width: 1280, height: 800, scale: 0.5, quality: 72 };
/** A phone-sized picture (r2-j59's fresh-eyes review): 390 by 844, as a phone sees it. */
export const PHONE_SHOT = { width: 390, height: 844, scale: 1, quality: 72, mobile: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A shooter: { shoot(url) -> Buffer (JPEG), close() }, or null when there is no browser to drive at `cdpUrl` (http://host:9222).
 * Chromium refuses a DevTools request whose Host is a name, so a name is looked up first. `onClose` runs when the shooter is closed.
 */
export async function makeShooter({ cdpUrl = '', timeoutMs = 20000, settleMs = 1500, onClose = null } = {}) {
  if (!cdpUrl) return null;
  let base;
  try {
    const u = new URL(cdpUrl);
    const ip = /^[\d.]+$|^\[/.test(u.hostname) ? u.hostname : (await lookup(u.hostname, { family: 4 })).address;
    base = `http://${ip}:${u.port || 9222}`;
  } catch { return null; }
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { try { up = (await fetch(`${base}/json/version`)).ok; } catch { await sleep(100); } }
  if (!up) { onClose?.(); return null; }

  async function shoot(url, size = SHOT) {
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
        await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: !!size.mobile });
        // Sound off and no prompts: a page is looked at, never interacted with.
        await send('Page.navigate', { url });
        await Promise.race([loadedP, sleep(timeoutMs - settleMs - 500)]);
        await sleep(settleMs);
        const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: size.quality, clip: { x: 0, y: 0, width: size.width, height: size.height, scale: size.scale } });
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
    close() { onClose?.(); },
  };
}
