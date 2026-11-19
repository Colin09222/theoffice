// Round 2, r2-j33 (docs/redesign/OFFICE-ANSWERS-2.md, Q1; section 6: "A hero card with 3 screenshots fades between them; a Working floor's badge
// pulses on a phone"). The hero API hands each card its real screenshots (the launch photo, then step photos), 3 at most; the page's clock fades
// between them every 4 s with a 0.6 s fade, only while the card is in view, never under reduce motion. Fake clock, fake records, mock mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client } from './helpers.js';
import { get, run } from '../server/db.js';
import { heroFrames, makeFader, HOLD_MS, FADE_MS, MAX_FRAMES } from '../public/js/hero-fade.js';

const DAY = 86400000;
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7), Buffer.from([0xff, 0xd9])]);
const src = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
function publish(t, floorId, slug, at = Date.now()) {
  run(t.db, "INSERT INTO projects (floor_id,slug,title,description,kind,private,published_at,created_at) VALUES (?,?,?,?,'site',0,?,?)", floorId, slug, slug, `${slug} line`, at, at - 3 * DAY);
}
/** A fake clock: setTimeout/clearTimeout that only move when the test says so. */
function fakeTimers() {
  let now = 0, id = 0; const q = new Map();
  return {
    setTimeout(fn, ms) { q.set(++id, { fn, at: now + ms }); return id; },
    clearTimeout(i) { q.delete(i); },
    advance(ms) { const end = now + ms; for (;;) { const due = [...q.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; q.delete(due[0]); now = due[1].at; due[1].fn(); } now = end; },
    get pending() { return q.size; },
  };
}

describe('the hero API: up to 3 real screenshots per card', () => {
  test('a launch with its photo and three step photos gives exactly 3, launch photo first; one with no photo gives none', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'TheTireRx'); const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      publish(t, f.id, 'tires'); publish(t, f.id, 'bare', Date.now() - 1000);
      run(t.db, "INSERT INTO launch_shots (floor_id,project,image,type,bytes,url,taken_at) VALUES (?,?,?,'image/jpeg',606,'x',?)", f.id, 'tires', jpeg(), 1700000000000);
      const card = Number(run(t.db, "INSERT INTO job_cards (floor_id,key,project,title,created_at,updated_at) VALUES (?,'k','tires','Tires',1,1)", f.id).lastInsertRowid);
      for (let i = 1; i <= 3; i++) run(t.db, 'INSERT INTO job_shots (floor_id,card_id,step,project,image,bytes,created_at,taken_at) VALUES (?,?,?,?,?,606,?,?)', f.id, card, `s${i}`, 'tires', jpeg(), i, 1000 + i);
      const { projects } = (await new Client(t).get('/api/building/hero')).data;
      const tires = projects.find((p) => p.slug === 'tires'), bare = projects.find((p) => p.slug === 'bare');
      assert.equal(tires.shots.length, 3);
      assert.match(tires.shots[0], /\/api\/building\/shot\/thetirerx\/tires\?v=1700000000000$/);
      assert.match(tires.shots[1], /\/api\/floors\/thetirerx\/jobshot\/3$/, 'then the newest step photo');
      assert.deepEqual(bare.shots, []);
      // Every address really serves a picture to a visitor.
      for (const u of tires.shots) { const r = await new Client(t).raw('GET', u.replace('/theoffice', '')); assert.equal(r.status, 200, u); }
    } finally { await t.close(); }
  });
  test('HERO_FADE=0 sends no extra screenshots', async () => {
    const t = await boot({ heroFade: false });
    try {
      const c = await claim(t, 'Still'); const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      publish(t, f.id, 'one');
      run(t.db, "INSERT INTO launch_shots (floor_id,project,image,type,bytes,url,taken_at) VALUES (?,?,?,'image/jpeg',606,'x',5)", f.id, 'one', jpeg());
      const { projects } = (await new Client(t).get('/api/building/hero')).data;
      assert.deepEqual(projects[0].shots, []);
    } finally { await t.close(); }
  });
});

describe('the page clock: 4 s each, 0.6 s fade, only the card in view', () => {
  test('the numbers are the spec\'s', () => {
    assert.equal(HOLD_MS, 4000); assert.equal(FADE_MS, 600); assert.equal(MAX_FRAMES, 3);
    assert.match(src('css/r2b.css'), /\.lcard-shot img\.lcard-fade \{[^}]*transition: opacity \.6s/);
  });
  test('frames: real screenshots only, no repeats, 3 at most', () => {
    assert.deepEqual(heroFrames({ shots: ['a', 'b', 'a', '', null, 'c', 'd'] }), ['a', 'b', 'c']);
    assert.deepEqual(heroFrames({}), []);
  });
  test('a card in view with 3 screenshots fades to the next every 4 s and goes round; out of view it holds still', () => {
    const tm = fakeTimers(); const shown = [];
    const f = makeFader({ count: 3, show: (i) => shown.push(i), timers: tm });
    tm.advance(10000);
    assert.deepEqual(shown, [], 'nothing before the card is in view');
    f.setVisible(true);
    tm.advance(3999); assert.deepEqual(shown, []);
    tm.advance(1); assert.deepEqual(shown, [1]);
    tm.advance(8000); assert.deepEqual(shown, [1, 2, 0]);
    f.setVisible(false);
    tm.advance(60000); assert.deepEqual(shown, [1, 2, 0], 'scrolled away: still');
    assert.equal(tm.pending, 0);
    f.setVisible(true); tm.advance(4000); assert.deepEqual(shown, [1, 2, 0, 1]);
  });
  test('reduce motion, or a single screenshot: never moves', () => {
    const tm = fakeTimers(); const shown = [];
    makeFader({ count: 3, reduce: true, show: (i) => shown.push(i), timers: tm }).setVisible(true);
    makeFader({ count: 1, show: (i) => shown.push(i), timers: tm }).setVisible(true);
    tm.advance(60000);
    assert.deepEqual(shown, []);
  });
  test('the home page wires it to the hero cards and stops it on the way out', () => {
    const s = src('js/lobby-ui.js');
    assert.match(s, /crossfade\(c, heroFrames\(list\[i\]\)\)/);
    assert.match(s, /fades\.forEach\(\(f\) => f\?\.stop\(\)\); fades = \[\];/);
    const h = src('js/hero-fade.js');
    assert.match(h, /new IntersectionObserver/);
    assert.match(h, /prefers-reduced-motion: reduce/);
    assert.match(src('index.html'), /css\/r2b\.css/);
  });
});

describe('the live dot on a phone', () => {
  test('a Working floor\'s badge pulses at phone width, and stops under reduce motion', () => {
    const css = src('css/r2b.css');
    assert.match(css, /@media \(max-width: 760px\) \{\s*\.dir-row \.badge\[data-state="working"\]::before \{ animation: r2-pulse/);
    assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*\.dir-row \.badge\[data-state="working"\]::before \{ animation: none; \}/);
    // The badge a Working floor wears has the dot to pulse (skin.css), and only Working has it.
    assert.match(src('css/skin.css'), /\.badge\[data-state="working"\]::before \{ content: '';/);
  });
});
