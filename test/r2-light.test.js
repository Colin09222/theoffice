// Round 2, r2-j35 (docs/redesign/OFFICE-ANSWERS-2.md, Q2; section 6: "With the clock set to 23:30 New York, all room lights are off and the crown
// sign is lit"). New York time for everyone; sunrise and sunset by formula; dawn, day, golden hour (the last 60 minutes before sunset) and night,
// each change blended over 20 minutes and read once a minute; 23:00 to 08:00 room lights and desk lamps off on every floor, with the crown sign,
// the billboard, the street lights and the visit sign lights still on. Fake clock throughout.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nyParts, sunTimes, lightAt, lightsOnAt, mixLook, lightClock, PALETTE, BLEND_MIN, UPDATE_MS } from '../public/js/nylight.js';

const src = (p) => readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');
/** An instant from a New York wall-clock time in November 2026 (EST, UTC-5) or June 2026 (EDT, UTC-4). */
const nyNov = (d, hh, mm) => Date.UTC(2026, 10, d, hh + 5, mm);
const nyJun = (d, hh, mm) => Date.UTC(2026, 5, d, hh + 4, mm);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

describe('the New York clock and the sun', () => {
  test('New York wall time for any instant, winter and summer', () => {
    assert.deepEqual((({ hour, minute }) => ({ hour, minute }))(nyParts(nyNov(19, 23, 30))), { hour: 23, minute: 30 });
    assert.deepEqual((({ hour, minute }) => ({ hour, minute }))(nyParts(nyJun(21, 23, 30))), { hour: 23, minute: 30 });
  });
  test('sunrise and sunset by formula, within 3 minutes of the almanac', () => {
    // Published New York times: 21 June 05:25 / 20:31 (EDT); 21 December 07:16 / 16:32 (EST); 19 November 06:47 / 16:35.
    const jun = sunTimes(2026, 6, 21), dec = sunTimes(2026, 12, 21), nov = sunTimes(2026, 11, 19);
    near(jun.rise, 5 * 60 + 25, 3, 'June sunrise'); near(jun.set, 20 * 60 + 31, 3, 'June sunset');
    near(dec.rise, 7 * 60 + 16, 3, 'December sunrise'); near(dec.set, 16 * 60 + 32, 3, 'December sunset');
    near(nov.rise, 6 * 60 + 47, 3, 'November sunrise'); near(nov.set, 16 * 60 + 35, 3, 'November sunset');
  });
});

describe('four looks, 20-minute blends', () => {
  test('night, dawn, day, golden hour (the last 60 minutes before sunset), night', () => {
    const { rise, set } = sunTimes(2026, 11, 19);
    const at = (m) => lightAt(nyNov(19, Math.floor(m / 60), m % 60)).phase;
    assert.equal(at(3 * 60), 'night');
    assert.equal(at(rise), 'dawn');
    assert.equal(at(12 * 60), 'day');
    assert.equal(at(set - 30), 'golden');
    assert.equal(at(set - 55), 'golden', 'golden hour starts 60 minutes before sunset');
    assert.equal(at(set - 75), 'day');
    assert.equal(at(set + 30), 'night');
  });
  test('each change takes 20 minutes: halfway at the boundary, all one look 10 minutes either side; weights always add to 1', () => {
    assert.equal(BLEND_MIN, 20);
    const { set } = sunTimes(2026, 11, 19);
    const w = (m) => lightAt(nyNov(19, Math.floor(m / 60), m % 60)).weights;
    const g = set - 60;
    assert.equal(w(g - 10).golden, 0); near(w(g).golden, 0.5, 0.02, 'golden at its boundary'); assert.equal(w(g + 10).golden, 1);
    near(w(g + 5).day + w(g + 5).golden, 1, 1e-9, 'sum');
    for (let m = 0; m < 1440; m += 7) { const x = w(m); near(x.dawn + x.day + x.golden + x.night, 1, 1e-9, `sum at ${m}`); assert.ok(Object.values(x).every((v) => v >= 0 && v <= 1)); }
    // Halfway between golden and night, the colours are halfway too.
    const mid = mixLook({ dawn: 0, day: 0, golden: 0.5, night: 0.5 });
    near(mid.sunI, (PALETTE.golden.sunI + PALETTE.night.sunI) / 2, 1e-9, 'sun');
  });
  test('read once a minute, not every frame', () => {
    let t = nyNov(19, 12, 0); const seen = [];
    const c = lightClock({ now: () => t, apply: (l) => seen.push(l.phase) });
    assert.equal(UPDATE_MS, 60000);
    c.tick(); t += 1000; c.tick(); t += 58000; c.tick();
    assert.equal(seen.length, 1);
    t += 1000; c.tick();
    assert.equal(seen.length, 2);
  });
});

describe('23:00 to 08:00: room lights off, crown sign on', () => {
  test('at 23:30 New York every room light is off; at 08:00 they come on; at 22:59 they are still on', () => {
    assert.equal(lightAt(nyNov(19, 23, 30)).lightsOn, false);
    assert.equal(lightAt(nyJun(21, 23, 30)).lightsOn, false);
    assert.equal(lightAt(nyNov(20, 7, 59)).lightsOn, false);
    assert.equal(lightAt(nyNov(20, 8, 0)).lightsOn, true);
    assert.equal(lightAt(nyNov(19, 22, 59)).lightsOn, true);
    assert.equal(lightsOnAt(23 * 60), false);
  });
  test('the tower: one shared switch dims every floor\'s windows; the crown sign, street lights and beacon are not on it', () => {
    const s = src('lobby-scene.js');
    assert.match(s, /export const ROOM_LIGHTS = \{ value: 1 \};/);
    assert.match(s, /float on = taken \* uLights;/, 'every taken floor\'s window light goes through uLights');
    assert.match(s, /ROOM_LIGHTS\.value = l\.lightsOn \? 1 : 0;/);
    // The crown sign is a basic (unlit) material with its own glow: no light, and no switch, touches it.
    assert.match(s, /const signMat = new THREE\.MeshBasicMaterial\(\{ map: signTex/);
    assert.doesNotMatch(s, /signMat\.(visible|opacity)\s*=/);
    assert.match(s, /crownLit: true/);
    // Street lights: always there; their glow follows the dark, and "low" gets colour only (Q9: no lamp lights).
    assert.match(s, /function streetLights\(\)/);
    assert.match(s, /st\.glowMat\.opacity = low \? 0 : look\.street \* 0\.85/);
    assert.equal(PALETTE.night.street, 1);
    // Read once a minute from the frame loop.
    assert.match(s, /this\.light\.tick\(\);/);
  });
  test('the room: lane B\'s one hook switches its lights on the same clock, on every floor', () => {
    const o = src('office-scene.js'), r = src('room-light.js');
    assert.match(o, /setRoomLights\(on, look\) \{/);
    assert.match(o, /this\.hemi\.intensity = on \? 0\.8 : 0\.3;/);
    assert.match(o, /\(this\.nyLight \|\|= roomLight\(this\)\)\.tick\(\);/);
    assert.match(r, /view\.setRoomLights\(l\.lightsOn, look\)/);
  });
});
