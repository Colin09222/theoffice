// What makes a product more than a page: first-party visitor counts, the waitlist the boss reads, the checklist and the launch report.
// Nothing here reaches a third party. Visitor counts use no cookie and keep no address: a hash salted per day, and those hashes are gone after a day.
import { createHash } from 'node:crypto';
import { get, all, run } from './db.js';
import { checkSite } from './launch-check.js';
import { publicUrl } from './tools.js';
import { goesLive } from './workspace.js';

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|curl|wget|python-requests|node-fetch|axios|go-http/i;
const MAX_PATHS = 50, MAX_REFS = 50;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export function recordVisit(db, { floorId, project, path, referer, ownHost, ua, ip, secret, now }) {
  if (!ua || BOT.test(ua)) return;
  const day = dayOf(now);
  let p = String(path || '/').split('?')[0].slice(0, 120) || '/';
  const have = get(db, 'SELECT 1 x FROM app_visits WHERE floor_id=? AND project=? AND day=? AND path=?', floorId, project, day, p);
  // A site that routes everything to one page could otherwise fill this table with made-up paths.
  if (!have && get(db, 'SELECT COUNT(*) n FROM app_visits WHERE floor_id=? AND project=? AND day=?', floorId, project, day).n >= MAX_PATHS) p = '(other)';
  const hash = createHash('sha256').update(`${secret}|${day}|${floorId}|${project}|${ip}|${ua}`).digest('base64url').slice(0, 22);
  const fresh = run(db, 'INSERT OR IGNORE INTO app_visit_seen (day,hash) VALUES (?,?)', day, hash).changes;
  run(db, 'INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,?,?,?,1,?) ON CONFLICT(floor_id,project,day,path) DO UPDATE SET views=views+1, uniques=uniques+excluded.uniques', floorId, project, day, p, fresh ? 1 : 0);
  let ref = '';
  try { ref = referer ? new URL(referer).hostname.toLowerCase().slice(0, 80) : ''; } catch { ref = ''; }
  if (ref && ref !== String(ownHost || '').split(':')[0].toLowerCase()) {
    const known = get(db, 'SELECT 1 x FROM app_visit_refs WHERE floor_id=? AND project=? AND day=? AND ref=?', floorId, project, day, ref);
    if (known || get(db, 'SELECT COUNT(*) n FROM app_visit_refs WHERE floor_id=? AND project=? AND day=?', floorId, project, day).n < MAX_REFS) run(db, 'INSERT INTO app_visit_refs (floor_id,project,day,ref,n) VALUES (?,?,?,?,1) ON CONFLICT(floor_id,project,day,ref) DO UPDATE SET n=n+1', floorId, project, day, ref);
  }
  run(db, 'DELETE FROM app_visit_seen WHERE day<?', dayOf(now - 86400000));
}

export function projectStats(db, floorId, project, now, days = 30) {
  const from = dayOf(now - (days - 1) * 86400000);
  const byDay = all(db, 'SELECT day, SUM(views) views, SUM(uniques) uniques FROM app_visits WHERE floor_id=? AND project=? AND day>=? GROUP BY day ORDER BY day', floorId, project, from);
  const pages = all(db, 'SELECT path, SUM(views) views FROM app_visits WHERE floor_id=? AND project=? AND day>=? GROUP BY path ORDER BY views DESC LIMIT 10', floorId, project, from);
  const refs = all(db, 'SELECT ref, SUM(n) n FROM app_visit_refs WHERE floor_id=? AND project=? AND day>=? GROUP BY ref ORDER BY n DESC LIMIT 10', floorId, project, from);
  return { days, views: byDay.reduce((n, d) => n + d.views, 0), uniques: byDay.reduce((n, d) => n + d.uniques, 0), byDay, pages, refs };
}

export const formCount = (db, floorId, project) => get(db, 'SELECT COUNT(*) n FROM app_forms WHERE floor_id=? AND project=?', floorId, project).n;
export const formEntries = (db, floorId, project, limit = 5000) => all(db, 'SELECT id,form,data,created_at FROM app_forms WHERE floor_id=? AND project=? ORDER BY id DESC LIMIT ?', floorId, project, limit).map((r) => ({ id: r.id, form: r.form, fields: JSON.parse(r.data), createdAt: r.created_at }));
// A spreadsheet runs a cell starting with these as a formula, and visitors write these cells.
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
export function formsCsv(entries) {
  const keys = [...new Set(entries.flatMap((e) => Object.keys(e.fields)))];
  return [['form', 'when', ...keys].map(csvCell).join(','), ...entries.map((e) => [e.form, new Date(e.createdAt).toISOString(), ...keys.map((k) => e.fields[k])].map(csvCell).join(','))].join('\r\n');
}

/** What the boss has actually said. The only source a claim on a published page may come from. */
export function bossText(db, floorId) {
  const said = all(db, "SELECT text FROM messages WHERE floor_id=? AND role='boss' ORDER BY id DESC LIMIT 300", floorId).map((m) => m.text);
  const answers = all(db, 'SELECT answer FROM questions WHERE floor_id=? AND answer IS NOT NULL ORDER BY id DESC LIMIT 100', floorId).map((q) => q.answer);
  return [...said, ...answers].join('\n');
}
export function filesToPublish(db, floorId, slug, directory = '') {
  const prefix = `projects/${slug}/${directory ? `${directory}/` : ''}`;
  return all(db, 'SELECT path,content FROM files WHERE floor_id=? ORDER BY path', floorId).filter((f) => f.path.startsWith(prefix) && goesLive(f.path.slice(prefix.length))).map((f) => ({ path: f.path.slice(prefix.length), data: f.content }));
}
const TEXTY = /\.(html?|js|mjs|css|json|webmanifest|svg|txt|md)$/i;
// One at a time, with the event loop let through first. The checker's own size limits and bounded patterns are what keep a hostile page from stalling the building.
let line = Promise.resolve();
export function runCheck(db, floor, slug, directory = '', kind = 'site') {
  const pr = get(db, 'SELECT payment_link FROM projects WHERE floor_id=? AND slug=?', floor.id, slug);
  // Only the names of binary files matter here.
  const files = filesToPublish(db, floor.id, slug, directory).map((f) => (TEXTY.test(f.path) ? f : { path: f.path, data: '' }));
  const input = { files, bossText: bossText(db, floor.id), paymentLink: !!pr?.payment_link, kind };
  const job = line.then(() => new Promise((resolve) => setImmediate(resolve))).then(() => checkSite(input));
  line = job.catch(() => {});
  return job;
}
export function saveCheck(db, floorId, slug, r, reason, now) {
  run(db, 'UPDATE projects SET launch_check=? WHERE floor_id=? AND slug=?', JSON.stringify({ at: now, errors: r.errors, claims: r.claims, warnings: r.warnings, passed: r.passed, reason: reason || '' }), floorId, slug);
}
/** A refusal to publish, or null. Errors can't be argued with. Possible inventions need a reason, and that reason goes in front of the boss. */
export function gateProblem(r, reason) {
  if (r.errors.length) return `It can't be published yet:\n${r.errors.map((x) => `- ${x}`).join('\n')}`;
  if (r.claims.length && !reason) return `This looks invented, and nothing on a published site may be. Only the boss can be the source of reviews, testimonials, ratings, customer numbers, press mentions or contact details:\n${r.claims.map((x) => `- ${x}`).join('\n')}\nRemove them. If the boss really did give you one, or it isn't a claim at all (a score in a game, say), publish again with claims_ok_because saying so; the boss sees that.`;
  return null;
}

export function launchFacts(db, cfg, floor, slug, domains, liveUrl) {
  const p = get(db, 'SELECT * FROM projects WHERE floor_id=? AND slug=?', floor.id, slug);
  if (!p) return null;
  const check = p.launch_check ? JSON.parse(p.launch_check) : null;
  const review = p.design_review ? JSON.parse(p.design_review) : null;
  const stats = projectStats(db, floor.id, slug, Date.now());
  return { project: p, url: liveUrl, domain: domains?.liveFor(floor.id, slug) || '', check, review, stats, signups: formCount(db, floor.id, slug), hasPayment: !!p.payment_link, friendly: publicUrl(floor.slug, slug) };
}
/** What goes in the chat. The link comes first, the words are the manager's, and anything the boss has to check themselves stays in. The rest is one click away under Report. */
export function chatReport(f, headline, nextSteps) {
  const c = f.check;
  const lines = [`**${f.project.title} is live:** ${f.url}`];
  if (String(headline || '').trim()) lines.push('', String(headline).trim());
  if (c?.claims?.length) lines.push('', '**Please check these yourself. They look like claims nobody gave us:**', ...c.claims.slice(0, 8).map((w) => `- ${w}`), ...(c.reason ? [`The team's reason for keeping them: ${c.reason}`] : []));
  if (String(nextSteps || '').trim()) lines.push('', '**Next:**', String(nextSteps).trim());
  lines.push('', 'The full checklist is under Report on the project card.');
  return lines.join('\n');
}
/** Built by the server from what is really on record, so a report can't claim a check that never ran. The manager only adds its own words at the top and bottom. */
export function composeReport(f, headline, nextSteps) {
  const c = f.check;
  const lines = [`## Launch report: ${f.project.title}`, '', String(headline || '').trim(), '', `**Live at:** ${f.url}`];
  if (f.project.private) lines.push('**Visibility:** private. Only you can open it.');
  lines.push(`**Domain:** ${f.domain ? `${f.domain}` : 'none yet; it is on its project address'}`);
  lines.push(`**Taking money:** ${f.hasPayment ? 'yes, through your Stripe Payment Link' : 'no. Paste your Stripe Payment Link on the project card to switch it on'}`);
  lines.push(`**Sign-ups so far:** ${f.signups}`, `**Visitors so far:** ${f.stats.uniques} (${f.stats.views} page views)`);
  if (f.review) lines.push(`**Design review:** ${f.review.verdict || 'done'}, by ${f.review.model}`); else lines.push('**Design review:** not done');
  if (!c) lines.push('**Checklist:** not run');
  else {
    if (c.passed?.length) lines.push(`**Checklist passed:** ${c.passed.join(', ')}`);
    if (c.warnings?.length) lines.push('**Still rough:**', ...c.warnings.slice(0, 8).map((w) => `- ${w}`));
    if (c.claims?.length) lines.push('**Please check these yourself. They look like claims nobody gave us:**', ...c.claims.slice(0, 8).map((w) => `- ${w}`), c.reason ? `The team's reason for keeping them: ${c.reason}` : '');
  }
  if (nextSteps) lines.push('', '**Next:**', String(nextSteps).trim());
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}
