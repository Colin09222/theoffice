// Round 2, r2-j61 (docs/redesign/OFFICE-ANSWERS-2.md, Q13; section 6: "A waiting question emails the boss once, and again once after 24 hours").
// Three events only (question waiting, launch ready, something shipped), at most 3 a day per boss, one 24 h reminder, through the existing mail
// sender (the mock Resend here). BOSS_ALERTS ships OFF: then nothing is sent and nothing is queued to send later. Tests run with it on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim } from './helpers.js';
import { get, run, all } from '../server/db.js';
import { startMockResend } from '../server/mail-mock.js';
import { setBossEmail } from '../server/mail.js';
import { MAX_A_DAY } from '../server/bossalerts.js';

const HOUR = 3600e3;
async function start(over = {}, clockAt = Date.UTC(2026, 10, 18, 15, 0)) {
  const mock = await startMockResend();
  let clock = clockAt;
  const t = await boot({ resendApiKey: mock.apiKey, resendWebhookSecret: mock.webhookSecret, resendApiBase: mock.base, mailTickMs: 30, bossAlerts: true, ...over }, { now: () => clock });
  const close = t.close; t.close = async () => { await close(); await mock.close(); };
  t.app.engine.runManager = async () => {};
  const c = await claim(t, 'TheTireRx'); const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  setBossEmail(t.db, f.id, 'boss@example.com');
  return { t, mock, f, at: () => clock, set: (ms) => { clock = ms; }, tick: () => t.app.engine.r2b.alerts.tick() };
}
const toBoss = (mock) => mock.state.sent.filter((m) => [].concat(m.to).includes('boss@example.com'));

test('a waiting question emails the boss once, and again once after 24 hours; never a third time', async () => {
  const s = await start();
  try {
    await s.tick();  // switched on: starts from now
    run(s.t.db, 'INSERT INTO questions (floor_id,text,created_at) VALUES (?,?,?)', s.f.id, 'Which colour for the booking button?', s.at() + 1000);
    s.set(s.at() + 60000); await s.tick(); await s.tick();
    assert.equal(toBoss(s.mock).length, 1);
    assert.match(toBoss(s.mock)[0].subject, /question is waiting/);
    s.set(s.at() + 23 * HOUR); await s.tick();
    assert.equal(toBoss(s.mock).length, 1, 'no reminder before 24 hours');
    s.set(s.at() + 1 * HOUR); await s.tick(); await s.tick();
    assert.equal(toBoss(s.mock).length, 2);
    assert.match(toBoss(s.mock)[1].subject, /Still waiting/);
    s.set(s.at() + 48 * HOUR); await s.tick();
    assert.equal(toBoss(s.mock).length, 2, 'one reminder only');
    // Answered questions are never mailed.
    run(s.t.db, "INSERT INTO questions (floor_id,text,answer,created_at,answered_at) VALUES (?,'q','a',?,?)", s.f.id, s.at(), s.at());
    s.set(s.at() + 60000); await s.tick();
    assert.equal(toBoss(s.mock).length, 2);
  } finally { await s.t.close(); }
});

test('three events only, at most 3 emails a day per boss; one over the cap is never sent later', async () => {
  const s = await start();
  try {
    await s.tick();
    const t0 = s.at() + 1000;
    for (let i = 0; i < 3; i++) run(s.t.db, 'INSERT INTO questions (floor_id,text,created_at) VALUES (?,?,?)', s.f.id, `Q${i}`, t0 + i);
    run(s.t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'tires','Tire finder','site',0,?,1)", s.f.id, t0 + 10);
    s.set(t0 + 60000); await s.tick();
    assert.equal(toBoss(s.mock).length, MAX_A_DAY);
    const rows = all(s.t.db, 'SELECT kind, status FROM boss_alerts WHERE floor_id=? ORDER BY created_at', s.f.id);
    assert.deepEqual(rows.map((r) => r.status).sort(), ['capped', 'sent', 'sent', 'sent']);
    s.set(t0 + 30 * HOUR); await s.tick();  // the next day: the capped one is still not sent (only the reminders are new events)
    assert.ok(!toBoss(s.mock).some((m) => /Shipped/.test(m.subject)));
    // The kinds are only these three (plus the reminder).
    assert.ok(all(s.t.db, 'SELECT DISTINCT kind FROM boss_alerts').every((r) => ['question', 'reminder', 'launch_ready', 'shipped'].includes(r.kind)));
    // No money in any of them.
    for (const m of toBoss(s.mock)) assert.doesNotMatch(`${m.subject}\n${m.text}`, /\$|usd|cost|spend/i);
  } finally { await s.t.close(); }
});

test('a launch ready for the boss\'s tap, and something shipped, each email once', async () => {
  const s = await start();
  try {
    await s.tick();
    s.t.app.engine.makers;  // the maker_jobs table is made when the app starts
    run(s.t.db, "INSERT INTO maker_jobs (floor_id,project,type,title,stage,started_at,updated_at) VALUES (?,'game','game','Loopling','ready',?,?)", s.f.id, s.at(), s.at() + 1);
    run(s.t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'menu','Menu page','site',0,?,1)", s.f.id, s.at() + 2);
    run(s.t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'secret','Secret','site',1,?,1)", s.f.id, s.at() + 3);
    s.set(s.at() + 60000); await s.tick(); await s.tick();
    assert.deepEqual(toBoss(s.mock).map((m) => m.subject).sort(), ['Ready to launch: Loopling', 'Shipped: Menu page']);
  } finally { await s.t.close(); }
});

test('BOSS_ALERTS off (the default): nothing sent, nothing recorded, nothing queued; switched on later, nothing from before is sent', async () => {
  const s = await start({ bossAlerts: false });
  try {
    run(s.t.db, 'INSERT INTO questions (floor_id,text,created_at) VALUES (?,?,?)', s.f.id, 'While off', s.at());
    s.set(s.at() + 25 * HOUR); await s.tick();
    assert.equal(toBoss(s.mock).length, 0);
    assert.equal(get(s.t.db, 'SELECT COUNT(*) n FROM boss_alerts').n, 0);
    assert.equal(get(s.t.db, "SELECT value FROM settings WHERE key='boss_alerts_since'"), undefined);
    s.t.cfg.bossAlerts = true;  // the orchestrator turns it on
    await s.tick(); s.set(s.at() + 60000); await s.tick();
    assert.equal(toBoss(s.mock).length, 0, 'the question asked while it was off is not mailed now');
  } finally { await s.t.close(); }
  const { loadConfig } = await import('../server/config.js');
  assert.equal(loadConfig({ AI_MODE: 'mock' }).bossAlerts, false, 'off by default');
  assert.equal(loadConfig({ AI_MODE: 'mock', BOSS_ALERTS: '1' }).bossAlerts, true);
});
