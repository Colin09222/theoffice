// A page opened in the building's shared headless browser (docs/redesign, job 28). Live has no browser in the Office's own image, so docker-compose.yml
// runs one beside it (the `shots` service: office-runner/browser's Chromium headless shell with remote debugging on 9222, reachable only on the compose
// network). This speaks the Chrome DevTools Protocol to it with Node's own fetch and WebSocket, so the Office needs no browser and no new package.
// One call opens a fresh, isolated browser context, loads the page at 1280x800 (16:10), counts console errors, uncaught page errors and failed loads,
// takes a JPEG and closes the context again. Nothing here calls a model. Any later screenshot work (launch cards, timeline thumbnails) can call cdpPage.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const TIMEOUT_MS = 20000, SETTLE_MS = 600, ERRORS_KEPT = 8;
const clip = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Chrome answers its DevTools HTTP endpoint only when the Host header is an IP address or localhost (a guard against DNS rebinding), so a compose
 * service name such as http://shots:9222 is resolved here first and the browser is spoken to by address.
 */
export async function cdpBase(cdpUrl, { resolve = lookup } = {}) {
  const u = new URL(cdpUrl);
  if (u.hostname !== 'localhost' && !isIP(u.hostname.replace(/^\[|\]$/g, ''))) {
    const { address, family } = await resolve(u.hostname);
    u.hostname = family === 6 ? `[${address}]` : address;
  }
  return `${u.protocol}//${u.host}`;
}

/** A DevTools connection: send(method, params, sessionId) resolves with the result; on(event, fn) hears events. */
function connect(wsUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map(), handlers = [];
    let id = 0;
    const timer = setTimeout(() => { try { ws.close(); } catch { /* gone */ } reject(new Error('the browser did not answer')); }, timeoutMs);
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('could not reach the browser')); });
    ws.addEventListener('close', () => { for (const p of pending.values()) p.reject(new Error('the browser closed the connection')); pending.clear(); });
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(clip(m.error.message))); else p.resolve(m.result || {}); return; }
      if (m.method) for (const h of handlers) h(m);
    });
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve({
        send: (method, params = {}, sessionId) => new Promise((res, rej) => { const n = ++id; pending.set(n, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })); }),
        on: (fn) => handlers.push(fn),
        close: () => { try { ws.close(); } catch { /* gone */ } },
      });
    });
  });
}

/**
 * Opens `url` in the browser at `cdpUrl`. Resolves { ok, status, errors, shot } (shot a JPEG Buffer, or null when the page never loaded).
 * Throws only when the browser itself can't be reached, so the caller can fall back to something else.
 */
export async function cdpPage(cdpUrl, url, { width = 1280, height = 800, timeoutMs = TIMEOUT_MS, settleMs = SETTLE_MS, httpFetch = fetch, resolve } = {}) {
  const base = await cdpBase(cdpUrl, { resolve });
  const v = await (await httpFetch(`${base}/json/version`, { signal: AbortSignal.timeout(5000) })).json();
  if (!v?.webSocketDebuggerUrl) throw new Error('the browser gave no debugger address');
  // The address it hands back names the host it was asked by; keep the one we reached it on.
  const ws = new URL(v.webSocketDebuggerUrl); ws.host = new URL(base).host;
  const c = await connect(ws.href, 5000);
  let contextId = null;
  try {
    ({ browserContextId: contextId } = await c.send('Target.createBrowserContext', { disposeOnDetach: true }));
    const { targetId } = await c.send('Target.createTarget', { url: 'about:blank', browserContextId: contextId });
    const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => c.send(method, params, sessionId);
    const errors = [];
    let status = 0, loaded, failed = '';
    const load = new Promise((r) => { loaded = r; });
    c.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') errors.push(`error: ${clip(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text)}`);
      else if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') errors.push(`console: ${clip((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))}`);
      else if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') errors.push(`console: ${clip(m.params.entry.text)}${m.params.entry.url ? ` (${clip(m.params.entry.url, 100)})` : ''}`);
      else if (m.method === 'Network.responseReceived' && m.params?.type === 'Document' && !status) status = m.params.response?.status || 0;
      else if (m.method === 'Page.loadEventFired') loaded();
    });
    await Promise.all([s('Page.enable'), s('Runtime.enable'), s('Log.enable'), s('Network.enable'), s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })]);
    const nav = await s('Page.navigate', { url });
    if (nav.errorText) failed = nav.errorText;
    else await Promise.race([load, new Promise((r) => setTimeout(r, timeoutMs))]);
    if (failed) return { ok: false, status, errors: [`the page didn't load: ${clip(failed, 120)}`], shot: null };
    await new Promise((r) => setTimeout(r, settleMs));
    const { data } = await s('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
    if (status && status !== 200) errors.unshift(`the page answered ${status}`);
    return { ok: errors.length === 0 && (status === 200 || status === 0), status, errors: errors.slice(0, ERRORS_KEPT), shot: data ? Buffer.from(data, 'base64') : null };
  } finally {
    if (contextId) await c.send('Target.disposeBrowserContext', { browserContextId: contextId }).catch(() => {});
    c.close();
  }
}
