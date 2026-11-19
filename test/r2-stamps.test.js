// Round 2, r2-j52 (docs/redesign/OFFICE-ANSWERS-2.md, section 3 "Voice lines"; section 6: "Closing a test item as bought shows BOUGHT and the line
// 'Bought.' once"). Only section 3's list; one bubble per event, 2.5 s. "Already done." is left out: no record ever says so (checked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diffFeed, EventPlayer, stampFor, lineFor, STAMPS, VOICE_LINES, BUBBLE_S, APPROVED_STAMP } from '../public/js/mailroom-events.js';
import { boot, claim, Client } from './helpers.js';
import { get, run } from '../server/db.js';
import { decidePurchase } from '../server/purchases.js';
import { answerHelp } from '../server/help.js';

const src = (p) => readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');
const ev = (kind, state) => ({ event: 'close', kind, state, type: 'x', number: 1 });

test('the stamps and the lines are section 3\'s, and only those', () => {
  assert.deepEqual(STAMPS, { answered: 'ANSWERED', bought: 'BOUGHT', done: 'DONE', declined: 'DECLINED', expired: 'EXPIRED' });
  assert.equal(APPROVED_STAMP, 'COLON APPROVED');
  assert.deepEqual([lineFor(ev('help', 'answered')), lineFor(ev('help', 'declined')), lineFor(ev('help', 'expired'))], ['Answered.', 'Not this one.', '']);
  assert.deepEqual([lineFor(ev('purchase', 'bought')), lineFor(ev('purchase', 'declined'))], ['Bought.', 'Not this one.']);
  assert.equal(lineFor(ev('contractor', 'done')), 'Done.');
  assert.equal(lineFor({ event: 'pickup', kind: 'contractor' }), 'On it.');
  assert.equal(stampFor(ev('help', 'expired')), 'EXPIRED', 'expired: the stamp only');
  assert.ok(!VOICE_LINES.includes('Already done.'), 'no record ever says an item was already finished');
  assert.equal(BUBBLE_S, 2.5);
  // No other words are spoken anywhere in the mailroom code.
  for (const f of ['mailroom-ui.js', 'mailroom-scene.js', 'mailroom-floor.js']) assert.doesNotMatch(src(f), /onSay\?\.\('|onSay\('/, f);
});
test('the "already done" check: a second decision is refused and stored nowhere', async () => {
  const t = await boot();
  try {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'Twice')).slug);
    const id = Number(run(t.db, "INSERT INTO help_requests (floor_id,question,created_at,expires_at) VALUES (?,'q',1,?)", f.id, Date.now() + 3600e3).lastInsertRowid);
    answerHelp(t.db, id, 'yes');
    assert.throws(() => answerHelp(t.db, id, 'again'), /already/);
    assert.equal(get(t.db, 'SELECT status FROM help_requests WHERE id=?', id).status, 'answered');
  } finally { await t.close(); }
});
test('closing a test purchase as bought shows BOUGHT and says "Bought." once', async () => {
  const t = await boot();
  try {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'TheTireRx')).slug);
    const c = new Client(t);
    const id = Number(run(t.db, "INSERT INTO purchases (floor_id,item,price,why,link,created_at) VALUES (?,'Test',5,'t','',?)", f.id, Date.now()).lastInsertRowid);
    const a = (await c.get('/api/mailroom')).data;
    decidePurchase(t.db, id, 'bought', '', Date.now());
    const b = (await c.get('/api/mailroom')).data;
    const stamps = [], lines = [];
    const p = new EventPlayer((e) => { const w = stampFor(e), l = lineFor(e); if (w) stamps.push(w); if (l) lines.push(l); return BUBBLE_S; });
    for (const e of diffFeed(a, b)) p.push(e);
    for (const e of diffFeed(b, (await c.get('/api/mailroom')).data)) p.push(e);  // a third reading: nothing new
    for (let i = 0; i < 100; i++) p.update(0.1);
    assert.deepEqual(stamps, ['BOUGHT']); assert.deepEqual(lines, ['Bought.']);
  } finally { await t.close(); }
});
test('the page: one bubble per event for 2.5 s; the stamp in Tower Red; the stamp sound', () => {
  const ui = src('mailroom-ui.js');
  assert.match(ui, /bubbleTimer = setTimeout\(\(\) => \{ bubble\.hidden = true; \}, BUBBLE_S \* 1000\);/);
  assert.match(ui, /eventSound\('stamp'\);/);
  assert.match(readFileSync(new URL('../public/css/r2b.css', import.meta.url), 'utf8'), /\.mailroom-stamp \{[^}]*border: 4px solid #C93A24/);
});
