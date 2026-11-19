// The smoke check (docs/redesign/OFFICE-ANSWERS-1.md, Q9 Tier 0 and section 5 step 7; job 11). After a job publishes, a script, not a model, opens the live
// page: it must load, with no console errors, and a 16:10 screenshot is saved to the job (on the floor's drive, and in smoke_checks for the timeline).
// With Playwright's Chromium on this machine it is a real browser; without it, the page and its own scripts and styles are fetched and every classic
// script is parsed, so a page that won't load, a missing file or a script that can't even parse still fails, and there is simply no screenshot.
// An edit then ships on this check alone, with no Tester (except one that touches checkout, forms or sign-in). Nothing here calls a model.
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { get, all, run } from './db.js';
import { writeBinaryFile } from './workspace.js';

const TIMEOUT_MS = 15000, ASSETS_MAX = 12, ERRORS_KEPT = 8;
export const SHOT = { width: 1280, height: 800 };  // 16:10, like the launch cards
// A check is not a visitor: this says bot, so the site's visit counts leave it out (server/launch.js). Headless Chrome says so by itself.
const UA = { 'user-agent': 'TheOffice-smoke-check/1.0 (bot)' };

/** Playwright, if this machine has it (the runner's browser image does; a global install does). null otherwise. */
export async function loadPlaywright() {
  try { return createRequire(import.meta.url)('playwright'); } catch { /* not here */ }
  try { return await import('playwright'); } catch { return null; }
}

const clip = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The page through plain HTTP: it loads, its own scripts and styles answer, and each classic script parses. */
async function httpCheck(url, { httpFetch = fetch } = {}) {
  const errors = [];
  let res, html = '';
  try { res = await httpFetch(url, { redirect: 'follow', headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) }); html = await res.text(); } catch (e) { return { ok: false, status: 0, errors: [`the page didn't load: ${clip(e?.message || e, 120)}`] }; }
  if (res.status !== 200) return { ok: false, status: res.status, errors: [`the page answered ${res.status}`] };
  if (!/<(html|body|head|div|main|canvas|script)\b/i.test(html)) errors.push('the page has no HTML in it');
  const base = res.url || url;
  const refs = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>|<link\b[^>]*\brel=["']?stylesheet["']?[^>]*\bhref=["']([^"']+)["']|<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']?stylesheet/gi)]
    .map((m) => m[1] || m[2] || m[3]).filter((u) => u && !/^(https?:)?\/\//i.test(u) && !/^data:/i.test(u)).slice(0, ASSETS_MAX);
  for (const ref of refs) {
    try { const r = await httpFetch(new URL(ref, base), { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) }); await r.arrayBuffer(); if (r.status !== 200) errors.push(`${clip(ref, 80)} answered ${r.status}`); } catch { errors.push(`${clip(ref, 80)} didn't load`); }
  }
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=/i.test(m[1]) || /type=["']?(module|application\/(ld\+)?json|text\/(template|x-[a-z-]+))/i.test(m[1]) || !m[2].trim()) continue;
    try { new Script(m[2]); } catch (e) { errors.push(`a script on the page can't run: ${clip(e?.message, 120)}`); }
  }
  return { ok: errors.length === 0, status: 200, errors: errors.slice(0, ERRORS_KEPT) };
}

/** The page in a real browser: console errors and page errors count, and a 16:10 JPEG comes back. */
async function browserCheck(pw, url) {
  const browser = await pw.chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: SHOT });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${clip(m.text())}`); });
    page.on('pageerror', (e) => errors.push(`error: ${clip(e?.message || e)}`));
    let status = 0;
    try { const r = await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT_MS }); status = r?.status() ?? 0; } catch (e) { return { ok: false, status, errors: [`the page didn't load: ${clip(e?.message, 120)}`], shot: null }; }
    await page.waitForTimeout(600);
    const shot = await page.screenshot({ type: 'jpeg', quality: 60 });
    if (status !== 200) errors.unshift(`the page answered ${status}`);
    return { ok: errors.length === 0, status, errors: errors.slice(0, ERRORS_KEPT), shot };
  } finally { await browser.close().catch(() => {}); }
}

/** One check. how: 'browser' when Playwright is here (and SMOKE_BROWSER isn't 0), else 'http'. Never throws. */
export async function smokeCheck(url, { useBrowser = true, httpFetch, playwright } = {}) {
  try {
    const pw = useBrowser ? (playwright === undefined ? await loadPlaywright() : playwright) : null;
    if (pw) { try { return { how: 'browser', ...(await browserCheck(pw, url)) }; } catch { /* a browser that won't start: fall back */ } }
    return { how: 'http', shot: null, ...(await httpCheck(url, { httpFetch })) };
  } catch (e) { return { how: 'http', ok: false, status: 0, errors: [`the check itself broke: ${clip(e?.message, 120)}`], shot: null }; }
}

/** Runs the check on a project that was just published by `task`, keeps the result and the screenshot where the job and the timeline find them. */
export async function smokeProject(engine, floor, slug, task, { now = Date.now() } = {}) {
  const { db, cfg } = engine;
  let url = engine.liveUrl(floor, slug);
  if (url.startsWith('/')) url = `${engine.selfOrigin?.() || `http://127.0.0.1:${cfg.port}`}${url}`;
  const r = await smokeCheck(url, { useBrowser: cfg.smokeBrowser !== false, httpFetch: engine.smokeFetch, playwright: engine.smokePlaywright });
  let shotPath = '';
  if (r.shot) {
    shotPath = `projects/${slug}/notes/shots/smoke-${task?.id ?? 'publish'}.jpg`;
    try { writeBinaryFile(db, floor.id, shotPath, r.shot, null, cfg.quotaBytes); } catch { shotPath = ''; }
  }
  const id = Number(run(db, 'INSERT INTO smoke_checks (floor_id,project,task_id,url,ok,how,status,errors,shot_path,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', floor.id, slug, task?.id ?? null, url, r.ok ? 1 : 0, r.how, r.status, JSON.stringify(r.errors), shotPath, now).lastInsertRowid);
  if (task?.id) run(db, 'UPDATE tasks SET smoke_id=? WHERE id=?', id, task.id);
  return { id, ...r, shotPath, url };
}
export const lastSmoke = (db, taskId) => get(db, 'SELECT * FROM smoke_checks WHERE task_id=? ORDER BY id DESC LIMIT 1', taskId);
export const smokeFor = (db, floorId, project) => all(db, 'SELECT * FROM smoke_checks WHERE floor_id=? AND project=? ORDER BY id DESC LIMIT 20', floorId, project);

/** Whether an edit touches something a Tester must still look at once: checkout, a form, or signing in. */
export const SENSITIVE = /\b(check-?out|basket|cart|payments?|pay|stripe|price|form|forms|booking|book|sign[- ]?in|log[- ]?in|sign[- ]?up|account|password)\b/i;
export const touchesSensitive = (t) => SENSITIVE.test(`${t?.title || ''} ${t?.brief || ''} ${t?.intent || ''}`);
/** The Tester gets a computer only for games and shops. */
export function testerNeedsComputer(db, task) {
  if (['game', 'shop'].includes(task?.lane)) return true;
  if (!task?.project) return false;
  const p = get(db, 'SELECT kind FROM projects WHERE floor_id=? AND slug=?', task.floor_id, task.project);
  if (p?.kind === 'game') return true;
  if (get(db, "SELECT 1 x FROM tasks WHERE floor_id=? AND project=? AND lane IN ('game','shop') LIMIT 1", task.floor_id, task.project)) return true;
  return !!get(db, "SELECT 1 x FROM sqlite_master WHERE type='table' AND name='pay_products'") && !!get(db, 'SELECT 1 x FROM pay_products WHERE floor_id=? AND project=? LIMIT 1', task.floor_id, task.project);
}
