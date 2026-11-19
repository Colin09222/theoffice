// A floor's portfolio page (docs/redesign, job 24): a public share URL per open floor listing its launches, with a link preview (title and a
// real screenshot as og:image), and nothing about sign-ups, sales, money or demo launches. Mock mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client } from './helpers.js';
import { get, run } from '../server/db.js';

const DAY = 864e5;
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 5), Buffer.from([0xff, 0xd9])]);
const publish = (t, fid, slug, { priv = 0, kind = 'site', at = Date.now() - DAY } = {}) => run(t.db, 'INSERT INTO projects (floor_id,slug,title,description,kind,private,published_at,created_at) VALUES (?,?,?,?,?,?,?,?)', fid, slug, `${slug} title`, 'one line', kind, priv, at, at - 2 * DAY);
const page = async (t, path) => { const r = await fetch(`${t.base}${path}`); return { status: r.status, html: await r.text() }; };
const meta = (html, k) => html.match(new RegExp(`<meta (?:property|name)="${k}" content="([^"]*)">`))?.[1];

describe('the portfolio list', () => {
  test('one floor\'s launches only, newest first, work in progress marked; private work and demo floors left out', async () => {
    const t = await boot({ fillerCompanies: true, fillerTickMs: 1e6, towerFloors: 30 });
    try {
      const a = await claim(t, 'Alpha Co'); const b = await claim(t, 'Beta Co');
      const fa = get(t.db, 'SELECT id FROM floors WHERE slug=?', a.slug).id, fb = get(t.db, 'SELECT id FROM floors WHERE slug=?', b.slug).id;
      publish(t, fa, 'alpha-one', { at: Date.now() - 2 * DAY }); publish(t, fa, 'alpha-two'); publish(t, fa, 'alpha-secret', { priv: 1 }); publish(t, fb, 'beta-one');
      t.app.engine.makers;
      run(t.db, "INSERT INTO maker_jobs (floor_id,project,type,title,stage,started_at,updated_at) VALUES (?,'alpha-two','site','x','build',?,?)", fa, Date.now(), Date.now());
      const list = (await new Client(t).get(`/api/building/launched?floor=${a.slug}`)).data.projects;
      assert.deepEqual(list.map((p) => p.slug), ['alpha-two', 'alpha-one']);
      assert.equal(list.find((p) => p.slug === 'alpha-two').wip, true);
      assert.doesNotMatch(JSON.stringify(list), /signup|sales|usd|price|cost/i);
      const demo = get(t.db, 'SELECT slug, id FROM floors WHERE filler=1');
      publish(t, demo.id, 'fake');
      assert.deepEqual((await new Client(t).get(`/api/building/launched?floor=${demo.slug}`)).data.projects, []);
      assert.deepEqual((await new Client(t).get('/api/building/launched?floor=no-such-floor')).data.projects, []);
    } finally { await t.close(); }
  });
});

describe('the share link', () => {
  test('the floor\'s page is the app with a preview: its name as the title and the best launch\'s real screenshot as og:image', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Quote "Co" & Sons');
      const f = get(t.db, 'SELECT id, slug FROM floors WHERE slug=?', c.slug);
      publish(t, f.id, 'best'); publish(t, f.id, 'other');
      run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'best',?,'/',9,9)", f.id, new Date().toISOString().slice(0, 10));
      // No photo yet: a title and a line, but no image (a drawn SVG card is no use to a chat app).
      let r = await page(t, `/launched/${c.slug}`);
      assert.equal(r.status, 200);
      assert.match(r.html, /<script type="module" src="\/theoffice\/js\/main\.js\?v=/, 'the same app shell');
      assert.equal(meta(r.html, 'og:title'), 'Quote &quot;Co&quot; &amp; Sons: launched in The Office');
      assert.equal(meta(r.html, 'og:image'), undefined);
      assert.match(meta(r.html, 'og:url'), new RegExp(`/theoffice/launched/${c.slug}$`));
      run(t.db, "INSERT INTO launch_shots (floor_id,project,image,bytes,url,taken_at) VALUES (?,'best',?,?,'x',?)", f.id, jpeg, jpeg.length, 12345);
      r = await page(t, `/launched/${c.slug}`);
      assert.match(meta(r.html, 'og:image'), new RegExp(`/theoffice/api/building/shot/${c.slug}/best\\?v=12345$`));
      assert.equal(meta(r.html, 'twitter:card'), 'summary_large_image');
      assert.match(r.html, /<title>Quote &quot;Co&quot; &amp; Sons: launched in The Office<\/title>/);
      // The image it names is really there, for anyone.
      assert.equal((await fetch(`${t.base}/api/building/shot/${c.slug}/best`)).status, 200);
      // The building's own Launched page has a preview too, and an unknown floor gets the plain shell.
      r = await page(t, '/launched');
      assert.equal(meta(r.html, 'og:title'), 'Launched in The Office');
      r = await page(t, '/launched/no-such-floor');
      assert.equal(r.status, 200); assert.equal(meta(r.html, 'og:title'), undefined);
      assert.doesNotMatch(r.html, /og:/);
    } finally { await t.close(); }
  });
});

describe('the page', () => {
  test('title, lane filter, launch cards, work in progress below, the floor header, Share and Visit floor; the empty state', () => {
    const src = readFileSync(new URL('../public/js/launched-ui.js', import.meta.url), 'utf8');
    for (const s of ["'Launched'", "['game', 'Games'], ['website', 'Websites'], ['business', 'Business']", "'Work in progress'", "'Visit floor'", "'Share'", 'Nothing launched yet. The team is on step ${now.step} of ${now.steps}.', 'launchCard(p, { onFloor })']) assert.ok(src.includes(s), s);
    const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
    assert.match(main, /path\.match\(\/\^\\\/launched\(\?:\\\/\(\[a-z0-9-\]\+\)\)\?\$\/\)/);
  });
});
