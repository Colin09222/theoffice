// Round 2, lane A: the building library (docs/redesign/OFFICE-ANSWERS-2.md, Q14 b, all 7 rules).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, adminClient } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { toolsForRole, toolDefs } from '../server/tools.js';
import { scrub, privateWords, LIMITS } from '../server/library.js';

describe('r2-j69 building library', () => {
  let t, a, b, admin;
  const floor = (c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = (c) => get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor(c).id);
  const tool = (c, name, args, role = 'manager') => { const ag = role === 'manager' ? mgr(c) : get(t.db, 'SELECT * FROM agents WHERE floor_id=? AND role=?', floor(c).id, role); return t.app.engine.tools.exec(t.app.engine.toolCtx(floor(c), ag, null, toolsForRole(role)), name, JSON.stringify(args)); };
  before(async () => {
    t = await boot({ librarySeedFloors: '' });
    a = await claim(t, 'Harbor Tyres', { body: { bossName: 'Marla Quinn' } });
    b = await claim(t, 'Other Floor');
    admin = await adminClient(t);
    run(t.db, "INSERT INTO app_forms (floor_id, project, form, data, size, hash, created_at) VALUES (?, 'site', 'join', ?, 10, 'h1', 1)", floor(a).id, JSON.stringify({ name: 'Petunia Gallagher', email: 'p@x.io' }));
  });
  after(() => t.close());

  test('rule 3: code scrubs emails, phones, web addresses, prices and the floor\'s company, boss and customer names', () => {
    const words = privateWords(t.db, floor(a).id);
    for (const w of ['harbor', 'tyres', 'marla', 'quinn', 'petunia', 'gallagher']) assert.ok(words.has(w), w);
    const r = scrub('Ask Marla Quinn at marla@harbortyres.com or 555-201-3344, see https://harbortyres.com/menu and harbortyres.com, it costs $49.99 or 30 USD. Petunia loved it at Harbor Tyres.', words);
    assert.ok(!/marla|quinn|@|555|https?:|harbortyres|\$|49|usd|petunia|harbor|tyres/i.test(r.text), r.text);
    assert.ok(r.removed >= 10);
    assert.match(r.text, /\[removed\]/); assert.match(r.text, /loved it at/);
  });
  test('DONE MEANS: an entry with an email address in it is scrubbed, waits for Colon, and is readable by other floors only after his tap', async () => {
    const said = await tool(a, 'propose_library_entry', { title: 'Put the booking form above the fold', lane: 'website', lesson: 'Bookings doubled once the form sat at the top. Questions went to help@harbortyres.com, and that is fine to drop.', code: '<form id="book">...</form>' });
    assert.match(said, /Sent to the building manager/); assert.match(said, /private detail/);
    const e = get(t.db, 'SELECT * FROM library_entries WHERE floor_id=?', floor(a).id);
    assert.equal(e.status, 'waiting');
    assert.ok(!e.lesson.includes('@') && !e.lesson.toLowerCase().includes('harbortyres'), e.lesson);
    assert.match(e.lesson, /\[removed\]/);
    assert.equal(await tool(b, 'read_library', {}), 'The building library has nothing approved yet.', 'waiting: nobody can read it');
    // Colon's list shows it; one tap approves it.
    const list = (await admin.get('/api/admin/library')).data.entries;
    assert.ok(list.some((x) => x.id === e.id && x.status === 'waiting'));
    assert.equal((await admin.post(`/api/admin/library/${e.id}`, { action: 'approve' })).status, 200);
    const read = await tool(b, 'read_library', {}, 'builder');
    assert.match(read, /<untrusted_data source="building library">/); assert.match(read, /Put the booking form above the fold/);
    assert.ok(!read.includes('@') && !/harbor/i.test(read), 'still scrubbed when read');
    assert.ok(!read.includes(floor(a).slug) && !/floor \d/i.test(read.replace(/other floors/i, '')), 'it never says which floor it came from');
    assert.equal((await admin.post(`/api/admin/library/${e.id}`, { action: 'reject' })).status, 409, 'one decision');
  });
  test('rules 1, 2 and 4: a fixed form, 2 a week, and nobody but the admin decides', async () => {
    assert.match(await tool(a, 'propose_library_entry', { title: 'x', lane: 'moon', lesson: 'y' }), /lane must be/);
    assert.match(await tool(a, 'propose_library_entry', { title: 'x', lane: 'game', lesson: 'y'.repeat(LIMITS.lesson + 1) }), /at most 500/);
    assert.match(await tool(a, 'propose_library_entry', { title: 'Second', lane: 'game', lesson: 'A second lesson.' }), /Sent to/);
    assert.match(await tool(a, 'propose_library_entry', { title: 'Third', lane: 'game', lesson: 'A third lesson.' }), /its 2 entries this week/);
    const w = get(t.db, "SELECT id FROM library_entries WHERE title='Second'").id;
    assert.equal((await a.post(`/api/admin/library/${w}`, { action: 'approve' })).status, 401, 'a boss cannot approve');
    assert.equal((await a.get('/api/admin/library')).status, 401);
    assert.equal(get(t.db, 'SELECT status FROM library_entries WHERE id=?', w).status, 'waiting');
  });
  test('rules 5 and 6: only managers propose; the read tool is read-only, fenced, and the library is the only shared thing', async () => {
    assert.ok(toolsForRole('manager').includes('propose_library_entry') && toolsForRole('manager').includes('read_library'));
    assert.ok(!toolsForRole('builder').includes('propose_library_entry') && toolsForRole('builder').includes('read_library'));
    assert.match(await tool(b, 'propose_library_entry', { title: 'x', lane: 'game', lesson: 'y' }, 'builder'), /no tool called/);
    const defs = JSON.stringify(toolDefs(toolsForRole('manager'), t.cfg, 'manager'));
    assert.ok(defs.includes('read_library') && !/budget/i.test(defs));
    t.cfg.library = false;
    assert.ok(!JSON.stringify(toolDefs(toolsForRole('manager'), t.cfg, 'manager')).includes('read_library'), 'LIBRARY=0 takes the tools away');
    t.cfg.library = true;
  });
  test('rule 7: the seed is the launch checklist and Colon\'s own floors\' launches, every one waiting for his tap', async () => {
    const t2 = await boot({ librarySeedFloors: '6' });
    try {
      const six = await claim(t2, 'TheTireRx', { floor: 6 });
      await six.post(`/api/floors/${six.slug}/chat`, { text: 'go build tyre finder' });
      const { waitDone } = await import('./helpers.js');
      await waitDone(six);
      run(t2.db, 'DELETE FROM library_entries');
      assert.ok(t2.app.ext.librarySeed() >= 2);
      const seeds = all(t2.db, 'SELECT * FROM library_entries WHERE seed=1');
      assert.ok(seeds.every((s) => s.status === 'waiting'), 'nothing enters without his tap, the seed included');
      assert.ok(seeds.some((s) => s.title === 'The launch checklist' && /https/i.test(s.lesson)));
      assert.ok(seeds.some((s) => /was made/.test(s.title)), 'a part from floor 6');
      assert.ok(!seeds.some((s) => /thetirerx/i.test(s.lesson + s.title)), 'scrubbed of the floor\'s own name');
      assert.equal(t2.app.ext.librarySeed(), 0, 'seeded once');
    } finally { await t2.close(); }
  });
});
