// Round 2, r2-j62 (docs/redesign/OFFICE-ANSWERS-2.md, Q13; section 6: "Each boss gets one Monday email with what shipped, visits and one suggestion").
// Mondays 09:00 New York; WEEKLY_REPORT_EMAIL ships OFF (nothing sent or queued); tests run with it on. Fake clock, mock Resend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim } from './helpers.js';
import { get, run } from '../server/db.js';
import { startMockResend } from '../server/mail-mock.js';
import { setBossEmail } from '../server/mail.js';
import { buildReport } from '../server/weeklyreport.js';

// Monday 23 November 2026, 08:59 and 09:00 New York (EST).
const MON_0859 = Date.UTC(2026, 10, 23, 13, 59), MON_0900 = Date.UTC(2026, 10, 23, 14, 0), DAY = 86400000;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
async function start(over = {}) {
  const mock = await startMockResend();
  let clock = MON_0859;
  const t = await boot({ resendApiKey: mock.apiKey, resendWebhookSecret: mock.webhookSecret, resendApiBase: mock.base, mailTickMs: 30, weeklyReportEmail: true, ...over }, { now: () => clock });
  const close = t.close; t.close = async () => { await close(); await mock.close(); };
  t.app.engine.runManager = async () => {};
  const a = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'TheTireRx')).slug);
  const b = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'Quiet Co')).slug);
  setBossEmail(t.db, a.id, 'a@example.com'); setBossEmail(t.db, b.id, 'b@example.com');
  run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'finder','Tire finder','site',0,?,1)", a.id, MON_0900 - 2 * DAY);
  run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'finder',?,'/',700,649)", a.id, dayOf(MON_0900 - DAY));
  return { t, mock, a, b, set: (ms) => { clock = ms; }, tick: () => t.app.engine.r2b.reports.tick() };
}
const to = (mock, addr) => mock.state.sent.filter((m) => [].concat(m.to).includes(addr));

test('each boss gets one Monday email at 09:00 with what shipped, the visits and one suggestion', async () => {
  const s = await start();
  try {
    await s.tick();
    assert.equal(s.mock.state.sent.length, 0, 'not before 09:00');
    s.set(MON_0900); await s.tick(); await s.tick();
    s.set(MON_0900 + 5 * 3600e3); await s.tick();
    const ma = to(s.mock, 'a@example.com'), mb = to(s.mock, 'b@example.com');
    assert.equal(ma.length, 1); assert.equal(mb.length, 1);
    assert.match(ma[0].text, /Shipped: Tire finder\./);
    assert.match(ma[0].text, /Visits: 649 real visits in the last 7 days \(Tire finder 649\)/);
    assert.match(ma[0].text, /One suggestion: "Tire finder" had the most visits/);
    assert.match(mb[0].text, /Shipped: nothing new last week\./);
    assert.match(mb[0].text, /One suggestion: Nothing shipped last week/);
    for (const m of [...ma, ...mb]) assert.doesNotMatch(m.text, /\$|usd|cost|spend/i);
    s.set(MON_0900 + 7 * DAY); await s.tick();
    assert.equal(to(s.mock, 'a@example.com').length, 2, 'and one the next Monday');
    s.set(MON_0900 + 8 * DAY); await s.tick();
    assert.equal(to(s.mock, 'a@example.com').length, 2, 'never on a Tuesday');
  } finally { await s.t.close(); }
});

test('WEEKLY_REPORT_EMAIL off (the default): nothing built, sent or recorded; switched on on a Tuesday, nothing until the next Monday', async () => {
  const s = await start({ weeklyReportEmail: false });
  try {
    s.set(MON_0900); await s.tick();
    assert.equal(s.mock.state.sent.length, 0);
    assert.equal(get(s.t.db, 'SELECT COUNT(*) n FROM weekly_reports').n, 0);
    s.t.cfg.weeklyReportEmail = true;
    s.set(MON_0900 + DAY); await s.tick();
    assert.equal(s.mock.state.sent.length, 0, 'Monday\'s report is not sent late');
  } finally { await s.t.close(); }
  const { loadConfig } = await import('../server/config.js');
  assert.equal(loadConfig({ AI_MODE: 'mock' }).weeklyReportEmail, false);
});

test('the report is built from real records only', async () => {
  const s = await start({ weeklyReportEmail: false });
  try {
    const r = buildReport(s.t.db, s.a, { now: MON_0900 });
    assert.deepEqual(r.shipped, ['Tire finder']); assert.equal(r.visits, 649);
    const q = buildReport(s.t.db, s.b, { now: MON_0900 });
    assert.deepEqual([q.shipped, q.visits], [[], 0]);
  } finally { await s.t.close(); }
});
