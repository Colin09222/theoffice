// Round 2, r2-j50 (docs/redesign/OFFICE-ANSWERS-2.md, Q17, Q21, section 3 "Look" and "Home and desk"; section 6: "The basement shows on the
// tower panel and at B on the lift, with the robot at its desk"). The robot is built in node with three.js and measured; the room and the page
// wiring are read from the code. A browser run (npm run e2e:r2-building) opens the room itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from '../public/vendor/three/three.module.min.js';
import { makeRobot, ROBOT_HEIGHT, BEAN_HEIGHT, MAX_TRIANGLES } from '../public/js/robot.js';
import { robotState, signFor, trayView, eyeFor, COLORS, pigeonholes, STATES } from '../public/js/mailroom-state.js';
import { boot, claim, Client } from './helpers.js';

const src = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');

test('the robot: boxy, on two wheels, about 0.8 of a bean\'s height, under 1,500 triangles, Ink and Slate, one eye, a Tower Red stamp, "buddehbot" on its plate', () => {
  const r = makeRobot();
  assert.ok(r.triangles < MAX_TRIANGLES, `${r.triangles} triangles`);
  assert.equal(MAX_TRIANGLES, 1500);
  const box = new THREE.Box3().setFromObject(r.group);
  assert.ok(Math.abs(box.max.y - BEAN_HEIGHT * 0.8) < 0.02 && box.min.y >= -1e-6, `height ${box.max.y}`);
  assert.equal(ROBOT_HEIGHT, BEAN_HEIGHT * 0.8);
  const colours = new Set(); r.group.traverse((o) => { if (o.isMesh && o.material.color) colours.add(`#${o.material.color.getHexString()}`); });
  for (const c of [COLORS.ink, COLORS.slate, COLORS.red]) assert.ok(colours.has(c.toLowerCase()), c);
  assert.equal(r.plate.userData.text, 'buddehbot');
  let eyes = 0; r.group.traverse((o) => { if (o.name === 'eye') eyes++; }); assert.equal(eyes, 1);
  // Eye light: Amber busy, Teal free, off asleep or away.
  r.setState('busy'); assert.equal(`#${r.eye.material.color.getHexString()}`, COLORS.amber.toLowerCase());
  r.setState('free'); assert.equal(`#${r.eye.material.color.getHexString()}`, COLORS.teal.toLowerCase());
  assert.equal(eyeFor('asleep'), COLORS.off); assert.equal(eyeFor('away'), COLORS.off);
});
test('states in section 3\'s order; the sign; the tray: one folder per open item up to 8, then +N; one pigeonhole per open floor', () => {
  assert.deepEqual(STATES, ['asleep', 'away', 'busy', 'waiting', 'free']);
  const open = { state: 'open' }, picked = { state: 'picked' };
  assert.equal(robotState({ freeze: true, heartbeatFresh: false, items: [picked] }), 'asleep');
  assert.equal(robotState({ heartbeatFresh: false, items: [picked] }), 'away');
  assert.equal(robotState({ items: [open, picked] }), 'busy');
  assert.equal(robotState({ items: [open] }), 'waiting');
  assert.equal(robotState({ items: [{ state: 'bought' }] }), 'free');
  assert.equal(signFor('asleep'), 'Back at 08:00'); assert.equal(signFor('away'), 'Away'); assert.equal(signFor('free'), '');
  assert.deepEqual(trayView(Array(3).fill(open)), { folders: 3, more: 0, label: '' });
  assert.deepEqual(trayView(Array(11).fill(open)), { folders: 8, more: 3, label: '+3' });
  assert.deepEqual(trayView([]), { folders: 0, more: 0, label: '' });
  assert.deepEqual(pigeonholes([6, 3, 6, 0, 9]), [3, 6, 9]);
});
test('the room has every piece section 3 lists, with the robot at its desk', () => {
  const s = src('js/mailroom-scene.js');
  for (const piece of ['brickTexture', 'hanging lamp', 'pigeonholes', 'inTray', 'out-tray', 'stamp pad', 'desk phone', 'sign stand', 'brass tube', 'charging dock']) assert.ok(s.includes(piece), piece);
  assert.match(s, /this\.robot = makeRobot\(\); this\.robot\.group\.position\.copy\(this\.deskSpot\);/);
});
test('the feed carries the robot (state, sign, tray) and the open floors for the pigeonholes', async () => {
  // A fresh heartbeat (r2-j53): without one the robot would be Away.
  const beat = join(mkdtempSync(join(tmpdir(), 'beat-')), 'last'); writeFileSync(beat, `recv_ts=${Math.floor(Date.now() / 1000)} v=1\n`);
  const t = await boot({ macbeatFile: beat });
  try {
    const c = await claim(t, 'TheTireRx');
    const d = (await new Client(t).get('/api/mailroom')).data;
    assert.deepEqual(d.robot, { state: 'free', sign: '', tray: { folders: 0, more: 0, label: '' } });
    assert.ok(d.floors.length >= 1 && d.floors.includes((await new Client(t).get('/api/floors')).data.floors.find((f) => f.slug === c.slug).number));
  } finally { await t.close(); }
});
test('B on the lift and the strip at the foot of the tower panel both go to the mailroom; a phone gets the plain room, with no 3D code', () => {
  const ui = src('js/lobby-ui.js'), m = src('js/mailroom-ui.js'), main = src('js/main.js');
  assert.match(ui, /h\('button\.lift-btn\.lift-b', \{ type: 'button', 'data-lift': 'B'/);
  assert.match(ui, /h\('aside\.home-tower', [^\n]*footStrip\)/);
  assert.match(m, /onclick: \(\) => window\.officeGo\('\/mailroom'\)/);
  assert.match(main, /if \(path === '\/mailroom'\) \{ const \{ showMailroom, hideMailroom \} = await import\('\.\/mailroom-ui\.js'\)/);
  assert.match(m, /if \(!isPhone\(\)\) \{/);
  // The home page's own imports carry no three.js: mailroom-ui and mailroom-state are plain.
  for (const f of ['js/mailroom-ui.js', 'js/mailroom-state.js']) {
    const imports = src(f).split('\n').filter((l) => /^import /.test(l)).join('\n');
    assert.doesNotMatch(imports, /three|stage|robot\.js|mailroom-scene/, f);
  }
});
