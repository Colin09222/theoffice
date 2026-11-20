// Round 2, r2-j53 (docs/redesign/OFFICE-ANSWERS-2.md, Q19 and section 3 "States"; section 6: "With no heartbeat for 15 minutes the sign reads 'Away';
// during the freeze it reads 'Back at 08:00'"). The existing Mac heartbeat is reused: the server reads only recv_ts from MACBEAT_FILE (mounted
// read-only from /var/lib/macbeat). A missing or unreadable file is Away, never a crash. Fake clock, fake files, mock mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, claim, Client } from './helpers.js';
import { readBeat, beatFresh, FRESH_MS, DEFAULT_FILE } from '../server/macbeat.js';
import { setNightFreeze } from '../server/owneralerts.js';

const dir = mkdtempSync(join(tmpdir(), 'macbeat-'));
const beat = (name, recvMs, rest = ' v=1 mac_ts=1 gw=ok disk_gb=48 pc=ok') => { const f = join(dir, name); writeFileSync(f, `recv_ts=${Math.floor(recvMs / 1000)}${rest}\n`); return f; };
// 14:00 New York on 19 November 2026 (EST), and 23:30 the same night.
const DAY = Date.UTC(2026, 10, 19, 19, 0), NIGHT = Date.UTC(2026, 10, 20, 4, 30);
const robot = async (t) => (await new Client(t).get('/api/mailroom')).data.robot;

test('only recv_ts is read; fresh means within 15 minutes; a missing, empty or odd file is not fresh and never throws', () => {
  const f = beat('a', DAY);
  assert.equal(readBeat(f), DAY);
  assert.equal(FRESH_MS, 15 * 60000);
  assert.equal(beatFresh(readBeat(f), DAY + 14 * 60000), true);
  assert.equal(beatFresh(readBeat(f), DAY + 15 * 60000 + 1000), false);
  assert.equal(readBeat(join(dir, 'missing')), null);
  writeFileSync(join(dir, 'empty'), ''); assert.equal(readBeat(join(dir, 'empty')), null);
  writeFileSync(join(dir, 'odd'), 'mac_ts=1700000000 gw=ok'); assert.equal(readBeat(join(dir, 'odd')), null, 'mac_ts is not the server\'s receipt time');
  assert.equal(readBeat(dir), null, 'a directory, not a file');
  assert.equal(beatFresh(null, DAY), false);
  assert.equal(DEFAULT_FILE, '/run/macbeat/last');
  // The other fields are never read or passed on.
  const src = readFileSync(new URL('../server/macbeat.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src.replace(/^\/\/.*$/gm, ''), /mac_ts|gw=|disk_gb|pc=/);
});

test('no heartbeat for 15 minutes: the sign reads "Away"; a fresh one: free; the freeze: "Back at 08:00" whatever the heartbeat', async () => {
  let clock = DAY;
  const f = beat('live', DAY - 60000);
  const t = await boot({ macbeatFile: f, nightFreeze: true }, { now: () => clock });
  try {
    await claim(t, 'TheTireRx');
    assert.deepEqual(await robot(t), { state: 'free', sign: '', tray: { folders: 0, more: 0, label: '' } });
    clock = DAY + 16 * 60000 + 11000;  // the Mac went quiet 17 minutes ago (the reader looks again after 10 s)
    const away = await robot(t);
    assert.equal(away.state, 'away'); assert.equal(away.sign, 'Away');
    clock = NIGHT;  // 23:30 New York: the freeze is on
    const asleep = await robot(t);
    assert.equal(asleep.state, 'asleep'); assert.equal(asleep.sign, 'Back at 08:00');
    beat('live', NIGHT);  // a fresh heartbeat changes nothing during the freeze
    clock = NIGHT + 11000;
    assert.equal((await robot(t)).sign, 'Back at 08:00');
    setNightFreeze(t.db, 'off');
    assert.equal((await robot(t)).state, 'free');
    // The reply never carries the heartbeat's own fields or time.
    assert.doesNotMatch(JSON.stringify((await new Client(t).get('/api/mailroom')).data), /recv_ts|mac_ts|disk|gw/);
  } finally { await t.close(); }
});

test('no file at all (as on a server without the mount): Away, and the mailroom still answers', async () => {
  const t = await boot({ macbeatFile: join(dir, 'nowhere', 'last') });
  try {
    const r = await new Client(t).get('/api/mailroom');
    assert.equal(r.status, 200); assert.equal(r.data.robot.state, 'away');
  } finally { await t.close(); }
});

test('docker-compose mounts the Mac heartbeat directory read-only; no Mac script is added', () => {
  const dc = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(dc, /- \/var\/lib\/macbeat:\/run\/macbeat:ro/);
});
