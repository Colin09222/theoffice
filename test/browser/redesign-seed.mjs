// A building with something to show, for the redesign look checks: launches with real screenshots and visits, one work in progress,
// and a job under way. Straight into the database, so no model call (not even a mock one) is needed to have a launch on the wall.
import { localShooter } from '../../scripts/chrome.mjs';
import { takeDue } from '../../server/shots.js';

const DAY = 864e5;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const page = (title, bg, line) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="margin:0;font-family:sans-serif;background:${bg};color:#fff;display:grid;place-items:center;height:100vh;text-align:center"><div><h1 style="font-size:72px;margin:0">${title}</h1><p style="font-size:28px">${line}</p></div></body></html>`;

export async function seedShowcase(t, boss, { others = [] } = {}) {
  const db = t.db;
  const now = Date.now();
  const floorId = (slug) => db.prepare('SELECT id FROM floors WHERE slug=?').get(slug).id;
  const sets = [
    [boss.slug, [
      ['loopling', 'Loopling', 'A one-thumb arcade loop', 'game', now - 3 * DAY, '#17766F', 42],
      ['lanternfall', 'Lanternfall', 'A short pixel adventure', 'game', now - 9 * DAY, '#C93A24', 17],
      ['tiny-site', 'Tiny Arcade site', 'Where the games live', 'site', null, '#5B6270', 0],
    ]],
    ...others.map((slug) => [slug, [['labstackr', 'LabStackr', 'Cash prices for blood tests', 'site', now - 5 * DAY, '#1F2430', 25]]]),
  ];
  for (const [slug, projects] of sets) {
    const fid = floorId(slug);
    for (const [p, title, description, kind, published, bg, visits] of projects) {
      db.prepare('INSERT OR IGNORE INTO projects (floor_id, slug, title, description, kind, private, published_at, created_at) VALUES (?,?,?,?,?,0,?,?)').run(fid, p, title, description, kind, published, now - 12 * DAY);
      const html = page(title, bg, description);
      db.prepare('INSERT OR REPLACE INTO published_files (floor_id, project, path, content, size) VALUES (?,?,?,?,?)').run(fid, p, 'index.html', html, html.length);
      if (visits) db.prepare("INSERT OR REPLACE INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,?,?,'/',?,?)").run(fid, p, dayOf(now), visits, visits);
    }
  }
  // Real screenshots, the way the server timer takes them.
  const shooter = await localShooter({});
  if (shooter) { try { await takeDue(db, t.cfg, { shooter, origin: `http://127.0.0.1:${t.port}` }); } finally { shooter.close(); } }
  return { floorId: floorId(boss.slug) };
}
