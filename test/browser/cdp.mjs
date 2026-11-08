// Headless Chrome driver over the DevTools protocol, no npm deps. Modelled on the helper in the hollowmere repo, plus cookies, clicks and page-error tracking.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Asked of the system, not guessed: with several browsers up at once, a guessed port can land on a running one, and a "new" browser then quietly shares its cookies.
const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

export async function launch({ args = [], noAngle = false } = {}) {
  const exe = process.env.CHROME || (existsSync(MAC) ? MAC : '/opt/pw-browsers/chromium');
  const port = await freePort();
  // CDP_PROFILE_PREFIX keeps one worker's browsers apart from another's cleanup when two share a machine.
  const dir = mkdtempSync(join(tmpdir(), process.env.CDP_PROFILE_PREFIX || 'officecdp-'));
  const gfx = noAngle ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const proc = spawn(exe, ['--headless=new', '--no-sandbox', ...gfx, ...args, '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 300; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.find((x) => x.type === 'page')) break; } catch { /* still starting */ } await sleep(200); }
  return {
    port,
    async newPage(opts) { return openPage(port, opts); },
    close() { proc.kill('SIGKILL'); setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }, 500); },
  };
}

async function openPage(port, { mobile = false, width = 1440, height = 900, phone = null } = {}) {
  const made = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(made.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let closing = false;
  let id = 0; const pending = new Map(); const errors = []; const failed = []; const listeners = new Map(); const urls = new Map(); const transfer = { total: 0, byUrl: new Map() };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
    if (m.method && listeners.has(m.method)) for (const fn of listeners.get(m.method)) fn(m.params);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`console: ${m.params.args.map((a) => a.value || a.description).join(' ')}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) failed.push(m.params.errorText);
    // Bytes on the wire, per URL, so a run can report what a first load really costs.
    if (m.method === 'Network.responseReceived') urls.set(m.params.requestId, m.params.response.url);
    if (m.method === 'Network.loadingFinished') { const u = urls.get(m.params.requestId) || '?'; transfer.byUrl.set(u, (transfer.byUrl.get(u) || 0) + m.params.encodedDataLength); transfer.total += m.params.encodedDataLength; }
  });
  // A browser that dies mid-run fails the step that was waiting on it, rather than hanging the whole suite for good.
  let gone = false;
  ws.addEventListener('close', () => {
    if (closing) return;
    gone = true;
    for (const { reject } of pending.values()) reject(new Error('the browser went away'));
    pending.clear();
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (gone) { reject(new Error('the browser went away')); return; }
    const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`eval failed: ${expression.slice(0, 90)} :: ${r.result.exceptionDetails.exception?.description}`);
    return r.result?.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  // `phone` is a real-phone profile for the mobile suite: its own size, a phone's user agent and a touch screen.
  await send('Emulation.setDeviceMetricsOverride', phone ? { width: phone.width, height: phone.height, deviceScaleFactor: 2, mobile: true } : mobile ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width, height, deviceScaleFactor: 1, mobile: false });
  if (mobile || phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (phone) await send('Emulation.setUserAgentOverride', { userAgent: phone.ua || 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
  const page = {
    send, ev, errors, failed, transfer,
    /** Any other DevTools event, for a test that needs one (a screencast, say). */
    on(method, fn) { if (!listeners.has(method)) listeners.set(method, new Set()); listeners.get(method).add(fn); return () => listeners.get(method).delete(fn); },
    front() { return send('Page.bringToFront'); },
    async goto(url) { await send('Page.bringToFront'); await send('Page.navigate', { url }); await page.until('document.readyState === "complete"', 'page load'); },
    async until(expr, what = expr, timeout = 30000) {
      const end = Date.now() + timeout;
      for (;;) {
        let v; try { v = await ev(expr); } catch (e) { if (!/Execution context|Cannot find context/.test(e.message)) throw e; }
        if (v) return v;
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await sleep(100);
      }
    },
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86 }); writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
    // A real click through the input pipeline, so overlapping elements fail the test as they would fail a person.
    async click(selector) {
      // On a slow machine a sheet or dialog can still be sliding into place, and the click would land on whatever is there by then. Wait for it to come to rest first.
      await page.until(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return true; return !document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming?.().iterations !== Infinity && a.effect?.target?.contains?.(el)); })()`, `${selector} to come to rest`, 6000).catch(() => {});
      // A phone folds some controls away: a tab behind More, the staff under Team, the room's buttons behind a full sheet. Get to them the way a person would.
      await ev(`(() => { const o = window.__office; if (!o) return; const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return; const hidden = !el.getBoundingClientRect().width; if (el.matches('.tab.overflow, [data-more-action]') && !o.moreOpen) o.setMore(true); else if (o.phoneLayout && el.matches('.staff-chip') && hidden) o.setTab('work'); else if (o.phoneLayout && el.closest('.controls, .floor-top, .floor-scrubber') && document.body.dataset.sheet === 'full') o.setSheet('half'); })()`);
      await page.until('(() => { const t = document.querySelector(".floor-panel")?.getBoundingClientRect().top ?? 0; const same = window.__sheetTop === t; window.__sheetTop = t; return same; })()', 'the sheet to stop moving', 9000).catch(() => {});
      const box = await page.until(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'nearest' }); const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, `element ${selector}`);
      const top = await ev(`(() => { const t = document.elementFromPoint(${box.x}, ${box.y}); const el = document.querySelector(${JSON.stringify(selector)}); return !!t && (t === el || el.contains(t) || t.contains(el)); })()`);
      if (!top) throw new Error(`${selector} is covered by ${await ev(`(() => { const t = document.elementFromPoint(${box.x}, ${box.y}); return (t ? t.tagName + '.' + t.className : 'nothing') + ' [sheet ' + (document.body.dataset.sheet || '-') + ', panel top ' + Math.round(document.querySelector('.floor-panel')?.getBoundingClientRect().top ?? -1) + ']'; })()`)} at ${Math.round(box.x)},${Math.round(box.y)}`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    },
    async drag(x1, y1, x2, y2, touch) {
      if (touch) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
        for (let i = 1; i <= 6; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / 6, y: y1 + (y2 - y1) * i / 6 }] }); await sleep(30); }
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        return;
      }
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 6; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / 6, y: y1 + (y2 - y1) * i / 6, button: 'left', buttons: 1 }); await sleep(20); }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
    },
    async type(selector, text) {
      await page.click(selector);
      await ev(`document.querySelector(${JSON.stringify(selector)}).select?.()`);
      await send('Input.insertText', { text });
    },
    async press(key) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 0, text: key === 'Enter' ? '\r' : undefined }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key }); },
    async cookies() { return (await send('Network.getAllCookies')).result.cookies; },
    close() { closing = true; ws.close(); fetch(`http://127.0.0.1:${port}/json/close/${made.id}`).catch(() => {}); },
  };
  return page;
}
