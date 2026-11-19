// A floor with something to show, for the redesign look checks: two launched projects, one work in progress, and a job under way.
// Straight into the database, so no model call (not even a mock one) is needed to have a launch on the wall.
export async function seedShowcase(t, boss) {
  const db = t.db;
  const f = db.prepare('SELECT id FROM floors WHERE slug=?').get(boss.slug);
  const now = Date.now();
  const page = (title, bg) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="margin:0;font:600 40px sans-serif;background:${bg};color:#fff;display:grid;place-items:center;height:100vh">${title}</body></html>`;
  const projects = [
    ['loopling', 'Loopling', 'A one-thumb arcade loop', 'game', now - 3 * 864e5, '#17766F'],
    ['lanternfall', 'Lanternfall', 'A short pixel adventure', 'game', now - 9 * 864e5, '#C93A24'],
    ['tiny-site', 'Tiny Arcade site', 'Where the games live', 'site', null, '#5B6270'],
  ];
  for (const [slug, title, description, kind, published, bg] of projects) {
    db.prepare('INSERT OR IGNORE INTO projects (floor_id, slug, title, description, kind, private, published_at, created_at) VALUES (?,?,?,?,?,0,?,?)').run(f.id, slug, title, description, kind, published, now - 12 * 864e5);
    const html = page(title, bg);
    db.prepare('INSERT OR REPLACE INTO published_files (floor_id, project, path, content, size) VALUES (?,?,?,?,?)').run(f.id, slug, 'index.html', html, html.length);
  }
  return { floorId: f.id };
}
