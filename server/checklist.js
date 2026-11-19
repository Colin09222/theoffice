// The launch checklist (docs/redesign/OFFICE-ANSWERS-2.md, Q11 a; job r2-j57): eight checks, all by code, before the boss's Launch tap. Three
// block it: no HTTPS, a broken form, a broken link on the main page. The other five are warnings the boss sees. The checklist gates Launch only:
// staff publishing work in progress is never held by it. No model is called; nothing here is a budget.
//
//   1 loads under 3 s on a phone      the main page and what it loads, at Lighthouse's slow 4G (1.6 Mbit/s, 150 ms a round trip)   warning
//   2 phone view fits                 a device-width viewport, and no fixed page width wider than a phone                          warning
//   3 no broken links                 every link, picture, script and stylesheet on the main page goes somewhere real              BLOCKS
//   4 form test arrives               each form on the main page takes a test entry through the real form handler, then it's removed BLOCKS
//   5 link-preview tags               og:title, a description and og:image                                                         warning
//   6 icon                            a favicon                                                                                    warning
//   7 404 page                        a 404.html                                                                                   warning
//   8 HTTPS                           the live address is https (a building running on localhost is exempt)                        BLOCKS
//
// LAUNCH_CHECKLIST=0 takes the gate away (the checks still run and show).
import { get, all, run } from './db.js';
import { WorkspaceError } from './workspace.js';
import { handleData } from './appdata.js';
import { safeFetch } from './safefetch.js';

export const CHECKS = [
  ['speed', 'Loads under 3 s on a phone', false],
  ['fits', 'Phone view fits', false],
  ['links', 'No broken links on the main page', true],
  ['form', 'Form test arrives', true],
  ['preview', 'Link-preview tags', false],
  ['icon', 'Icon', false],
  ['notfound', '404 page', false],
  ['https', 'HTTPS', true],
];
const SLOW_4G = { bytesPerSec: 1.6e6 / 8, rttMs: 150, baseMs: 600 };
const text = (d) => (typeof d === 'string' ? d : Buffer.from(d || '').toString('utf8'));
const attrs = (html, tag, attr) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]{0,2000}?\\b${attr}\\s*=\\s*(?:"([^"]{0,2000})"|'([^']{0,2000})'|([^\\s>]{1,2000}))`, 'gi'))].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim());
const metaContent = (html, key) => { const m = new RegExp(`<meta\\b[^>]{0,600}\\b(?:property|name)\\s*=\\s*["']${key}["'][^>]{0,600}>`, 'i').exec(html)?.[0]?.match(/\bcontent\s*=\s*(?:"([^"]{0,2000})"|'([^']{0,2000})')/i); return (m?.[1] ?? m?.[2] ?? '').trim(); };
/** A path on the site, from a link on the main page: null for anything that isn't the site's own (another site, mailto:, a #fragment). */
function ownPath(href) {
  const h = String(href || '').trim();
  if (!h || h.startsWith('#') || /^(mailto|tel|sms|javascript|data|blob):/i.test(h) || /^(https?:)?\/\//i.test(h)) return null;
  let p = h.split('#')[0].split('?')[0];
  try { p = decodeURIComponent(p); } catch { /* keep it as written */ }
  p = p.replace(/^\.\//, '').replace(/^\/+/, '');
  if (!p || p.endsWith('/')) p += 'index.html';
  return p;
}
const isLocal = (u) => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(u).hostname) || new URL(u).hostname.endsWith('.localhost'); } catch { return false; } };

/**
 * The checklist for one site. `files`: [{ path, data }] as it will go live; `liveUrl`: its absolute address; `fetchUrl(url)` answers { ok, status }
 * for a link to another site; `formTest(name)` sends one test entry through the real form handler and answers whether it arrived.
 * Returns { checks: [{ id, label, blocks, ok, note }], passed, blocked, warnings }.
 */
export async function runChecklist({ files, liveUrl = '', fetchUrl = null, formTest = null }) {
  const byPath = new Map((files || []).map((f) => [f.path.replace(/^\/+/, ''), f]));
  const main = byPath.get('index.html');
  const html = main ? text(main.data) : '';
  const results = {};
  const put = (id, ok, note = '') => { results[id] = { ok: !!ok, note }; };

  // 1. Speed: the main page and everything of the site's own that it pulls in, over slow 4G.
  const assets = [...attrs(html, 'script', 'src'), ...attrs(html, 'link', 'href'), ...attrs(html, 'img', 'src')].map(ownPath).filter((p) => p && byPath.has(p));
  const bytes = Buffer.byteLength(html) + [...new Set(assets)].reduce((n, p) => n + Buffer.byteLength(text(byPath.get(p).data)), 0);
  const ms = SLOW_4G.baseMs + (bytes / SLOW_4G.bytesPerSec) * 1000 + SLOW_4G.rttMs * Math.ceil((1 + new Set(assets).size) / 6);
  put('speed', main && ms < 3000, main ? `About ${(ms / 1000).toFixed(1)} s on a slow phone connection (${Math.round(bytes / 1024)} KB)` : 'No main page');

  // 2. Fits a phone: a device-width viewport and no page width set wider than a phone.
  const viewport = /<meta\b[^>]{0,400}name\s*=\s*["']viewport["'][^>]{0,400}width\s*=\s*device-width/i.test(html);
  const css = [html, ...[...byPath.entries()].filter(([p]) => /\.css$/i.test(p)).map(([, f]) => text(f.data))].join('\n');
  const wide = [...css.matchAll(/(?:^|[;{\s])(?:min-)?width\s*:\s*(\d{3,5})px/gi)].map((m) => Number(m[1])).filter((n) => n > 600);
  put('fits', viewport && !wide.length, !viewport ? 'No phone viewport tag' : wide.length ? `A fixed width of ${wide[0]}px is wider than a phone` : 'Fits a phone screen');

  // 3. Links on the main page: the site's own must exist; another site's must answer.
  const links = [...attrs(html, 'a', 'href'), ...attrs(html, 'img', 'src'), ...attrs(html, 'script', 'src'), ...attrs(html, 'link', 'href')];
  const broken = [];
  for (const href of [...new Set(links)].slice(0, 80)) {
    const own = ownPath(href);
    // The building serves _office/ (its client library, Three.js, Phaser, pay, cloud) and _data/ on every project itself.
    if (own !== null && /(^|\/)_(office|data)\//.test(own)) continue;
    if (own !== null) { if (!byPath.has(own) && !byPath.has(`${own.replace(/\/?$/, '')}/index.html`) && !byPath.has(`${own}.html`)) broken.push(href); continue; }
    if (/^(https?:)?\/\//i.test(href) && fetchUrl) {
      const url = href.startsWith('//') ? `https:${href}` : href;
      let r = null; try { r = await fetchUrl(url); } catch { r = null; }
      if (!r?.ok) broken.push(href);
    }
  }
  put('links', main && !broken.length, !main ? 'No main page' : broken.length ? `Broken: ${broken.slice(0, 3).join(', ')}${broken.length > 3 ? ` and ${broken.length - 3} more` : ''}` : `${new Set(links).size} links checked`);

  // 4. Forms: each <form> on the main page must send somewhere that takes the entry. The building's own handler gets one test entry.
  const forms = (html.match(/<form\b/gi) || []).length;
  const scripts = [html, ...[...byPath.entries()].filter(([p]) => /\.(m?js)$/i.test(p)).map(([, f]) => text(f.data))].join('\n');
  const names = [...new Set([...scripts.matchAll(/_data\/v1\/form\/([A-Za-z0-9_-]{1,40})/g)].map((m) => m[1]))];
  const external = attrs(html, 'form', 'action').filter((a) => /^https?:\/\//i.test(a));
  if (!forms) put('form', true, 'No form on the main page');
  else if (!names.length && !external.length) put('form', false, 'The form sends nowhere');
  else {
    const failed = [];
    for (const n of names) { let ok = false; try { ok = formTest ? await formTest(n) : false; } catch { ok = false; } if (!ok) failed.push(n); }
    for (const a of external) { let r = null; try { r = fetchUrl ? await fetchUrl(a) : null; } catch { r = null; } if (!r?.ok) failed.push(a); }
    put('form', !failed.length, failed.length ? `The test entry did not arrive (${failed.slice(0, 2).join(', ')})` : `A test entry arrived (${[...names, ...external].length} form${names.length + external.length === 1 ? '' : 's'})`);
  }

  // 5 to 7: the small things.
  const ogTitle = metaContent(html, 'og:title'), desc = metaContent(html, 'og:description') || metaContent(html, 'description'), ogImage = metaContent(html, 'og:image');
  put('preview', ogTitle && desc && ogImage, ogTitle && desc && ogImage ? 'Title, description and picture are set' : `Missing: ${[!ogTitle && 'og:title', !desc && 'description', !ogImage && 'og:image'].filter(Boolean).join(', ')}`);
  const icon = /<link\b[^>]{0,400}rel\s*=\s*["'][^"']*\bicon\b/i.test(html) || [...byPath.keys()].some((p) => /^favicon\.(ico|png|svg)$/i.test(p));
  put('icon', icon, icon ? 'Has an icon' : 'No icon');
  put('notfound', byPath.has('404.html'), byPath.has('404.html') ? 'Has a 404 page' : 'No 404.html');

  // 8. HTTPS. A building running on this machine (localhost) can't have it and isn't held for it.
  const https = /^https:\/\//i.test(liveUrl);
  put('https', https || isLocal(liveUrl), https ? 'Served over HTTPS' : isLocal(liveUrl) ? 'A local building (localhost): not checked' : `Not HTTPS: ${liveUrl || 'no address'}`);

  const checks = CHECKS.map(([id, label, blocks]) => ({ id, label, blocks, ...results[id] }));
  return { checks, passed: checks.filter((c) => c.ok).length, blocked: checks.filter((c) => c.blocks && !c.ok).map((c) => c.id), warnings: checks.filter((c) => !c.blocks && !c.ok).map((c) => c.id) };
}

/** The live address as an absolute URL: its own domain, the apps origin, or the building's own address in front of the office path. */
export function absoluteLive(cfg, url) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${cfg.publicOrigin || `http://localhost:${cfg.port || 8080}`}${url}`;
}
/** Another site's link, answered with a quick GET through the building's guarded fetcher (no private addresses, a short timeout). */
export async function fetchLink(url) {
  try { const r = await safeFetch(url, { maxBytes: 64 * 1024, timeoutMs: 6000, types: /.*/ }); return { ok: (r.status ?? 200) < 400, status: r.status }; } catch { return { ok: false }; }
}
/** One test entry through the real form handler, then gone again: it proves the form takes entries without leaving anything in the boss's list or inbox. */
export function formTester(db, floorId, project, now = Date.now()) {
  return async (name) => {
    const marker = `launch-check-${now}`;
    const [status] = await handleData({ db, req: { method: 'POST', headers: {} }, floorId, project, segments: ['form', name], query: new URLSearchParams(), body: async () => ({ fields: { name: 'Launch checklist', message: marker } }), now: () => now, onForm: null });
    const row = get(db, "SELECT id FROM app_forms WHERE floor_id=? AND project=? AND form=? AND data LIKE ? ORDER BY id DESC LIMIT 1", floorId, project, name, `%${marker}%`);
    if (row) run(db, 'DELETE FROM app_forms WHERE id=?', row.id);
    return status === 200 && !!row;
  };
}

/**
 * r2-j58: the CHECKED mark, from a kept checklist: { passed: 8, of: 8 } when all eight passed, otherwise null. It is the code checklist's own
 * stamp, never anyone's signature (spec Q23: no buddehbot stamp on a launch).
 */
export function checkedMark(result) {
  let r = result;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch { return null; } }
  const n = r?.checks?.length || 0;
  return n === CHECKS.length && r.passed === n ? { passed: n, of: n } : null;
}
/** The last checklist of each project, as JSON; the boss's Launch tab and the CHECKED mark (r2-j58) read it. */
export function savedChecklist(db, floorId, project) {
  const r = get(db, 'SELECT result, checked_at FROM launch_checklists WHERE floor_id=? AND project=?', floorId, project);
  return r ? { ...JSON.parse(r.result), checkedAt: r.checked_at } : null;
}

export function installChecklist(ext) {
  const { db, cfg, engine, now, GET, json, requireOwner, HttpError, log } = ext;
  const filesOf = (floorId, slug) => all(db, 'SELECT path, content FROM files WHERE floor_id=? AND path LIKE ?', floorId, `projects/${slug}/%`)
    .map((f) => ({ path: f.path.slice(`projects/${slug}/`.length), data: f.content }));
  /** Runs the eight checks on a project as it stands and keeps the result. */
  async function check(floor, slug) {
    const live = absoluteLive(cfg, engine.liveUrl(floor, slug));
    const r = await runChecklist({ files: filesOf(floor.id, slug), liveUrl: live, fetchUrl: cfg.checklistFetch || fetchLink, formTest: formTester(db, floor.id, slug, now()) });
    run(db, 'INSERT INTO launch_checklists (floor_id, project, result, checked_at) VALUES (?,?,?,?) ON CONFLICT(floor_id, project) DO UPDATE SET result=excluded.result, checked_at=excluded.checked_at', floor.id, slug, JSON.stringify(r), now());
    return r;
  }
  ext.launchChecklist = check;
  // The Launch tap (the maker job's Launch, launch-ui.js) waits on the three blocking checks. Publishing work in progress never does.
  if (engine.makers?.launch) {
    const launch = engine.makers.launch;
    engine.makers.launch = async (floor, opts) => {
      const j = get(db, 'SELECT project FROM maker_jobs WHERE floor_id=? ORDER BY id DESC LIMIT 1', floor.id);
      if (j?.project) {
        let r = null;
        try { r = await check(floor, j.project); } catch (e) { log?.('warn', 'launch checklist', { err: String(e?.message || e).slice(0, 160) }); }
        if (r?.blocked.length && cfg.launchChecklist !== false) {
          const lines = r.checks.filter((c) => c.blocks && !c.ok).map((c) => `${c.label}: ${c.note}`);
          throw new WorkspaceError(`Not launched yet. Fix ${lines.length === 1 ? 'this' : 'these'} first, then tap Launch again. ${lines.join('. ')}.`);
        }
      }
      return launch(floor, opts);
    };
  }
  GET('/api/floors/:slug/launch-checklist/:project', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(p.project) || !get(db, 'SELECT 1 x FROM projects WHERE floor_id=? AND slug=?', f.id, p.project)) throw new HttpError(404, 'not_found');
    json(res, 200, { checklist: await check(f, p.project) });
  });
  return null;
}
