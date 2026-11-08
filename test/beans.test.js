// What the character builder offers has to be what really shows on a bean, and looks saved before the beans have to keep working.
// The panel itself, and its preview against the person in the room, are checked in a real browser (test/browser/custom.mjs).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validLook } from '../server/app.js';
import { specFor } from '../public/js/cast.js';
import * as LOOKS from '../public/js/looks.js';

const OLD = { skin: '#f6d7bd', hair: 'bun', hairColor: '#4a2f1d', outfit: 'suit', outfitColor: '#27324a', hat: 'none', glasses: 'none' };
const who = (s) => [s.color, s.suit, s.tie, s.trousers, s.phase, s.id];

describe('the character builder, on a bean', () => {
  test('a look saved before the beans needs nothing new and keeps its own colours', () => {
    assert.deepEqual(validLook(OLD, OLD), OLD);
    for (const k of ['bodyColor', 'suitColor', 'tieColor']) assert.equal(k in validLook(OLD), false, `${k} isn't filled in behind the boss's back`);
    const s = specFor(OLD, { role: 'writer' });
    assert.ok(LOOKS.BODY_COLOR.includes(s.color)); assert.ok(LOOKS.SUIT_COLOR.includes(s.suit)); assert.ok(LOOKS.TIE_COLOR.includes(s.tie));
    assert.deepEqual(who(specFor(OLD, { role: 'writer' })), who(s), 'the same person every time');
  });

  test('a picked body, suit and tie colour show on anyone, and the server keeps them', () => {
    const look = validLook({ ...OLD, bodyColor: '#ec1a86', suitColor: '#1e5737', tieColor: '#f4b400' }, OLD);
    assert.deepEqual([look.bodyColor, look.suitColor, look.tieColor], ['#ec1a86', '#1e5737', '#f4b400']);
    for (const role of ['boss', 'writer', 'manager']) { const s = specFor(look, { role }); assert.deepEqual([s.color, s.suit, s.tie], ['#ec1a86', '#1e5737', '#f4b400'], role); }
  });

  test('a colour off the palette is not saved', () => {
    assert.deepEqual(validLook({ ...OLD, bodyColor: 'url(x)', suitColor: '#000001', tieColor: 7 }, OLD), OLD);
  });

  test('trying on a hat or glasses never changes who someone is', () => {
    const plain = who(specFor(OLD, { role: 'boss' }));
    for (const hat of LOOKS.HAT) for (const glasses of LOOKS.GLASSES) assert.deepEqual(who(specFor({ ...OLD, hat, glasses }, { role: 'boss' })), plain, `${hat} and ${glasses}`);
  });

  test('hats and glasses show on the boss and on nobody else', () => {
    const look = { ...OLD, hat: 'wizard', glasses: 'shades' };
    const boss = specFor(look, { role: 'boss' }); assert.equal(boss.hat, 'wizard'); assert.equal(boss.glasses, 'shades');
    const writer = specFor(look, { role: 'writer' }); assert.equal(writer.hat, 'none'); assert.equal(writer.glasses, null);
  });

  test('a boss in an outfit from before the suits keeps it until they pick a suit or tie colour', () => {
    const lab = { ...OLD, outfit: 'labcoat' }, boss = { role: 'boss' };
    assert.equal(specFor(lab, boss).outfit, 'labcoat');
    assert.equal(specFor({ ...lab, bodyColor: '#ec1a86' }, boss).outfit, 'labcoat', 'a body colour is no change of clothes');
    assert.equal(specFor({ ...lab, suitColor: '#1e5737' }, boss).outfit, 'suit');
    assert.equal(specFor({ ...lab, tieColor: '#f4b400' }, boss).outfit, 'suit');
    assert.equal(specFor(lab, { role: 'writer' }).outfit, 'suit', 'the staff are in suits whatever their old look said');
  });

  test('quick looks and Surprise me only touch what shows', () => {
    const shows = new Set(['bodyColor', 'suitColor', 'tieColor', 'hat', 'glasses']);
    for (const [id, p] of Object.entries(LOOKS.CHARACTER_PRESETS)) for (const k of Object.keys(p.look)) assert.ok(shows.has(k), `${id} sets ${k}`);
    let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 100; i++) for (const k of Object.keys(LOOKS.randomLook(rand))) assert.ok(shows.has(k), k);
  });
});
