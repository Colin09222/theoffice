// The staff's small talk about what really happened on the floor, with some cheek for the boss: all of it in mock mode, with no key and no spend.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client, floorState, waitDone } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { createMockClient } from '../server/mock.js';
import { floorGossip, banterStyle, fitToSay, sassOn } from '../server/gossip.js';

const row = (t, slug) => get(t.db, 'SELECT * FROM floors WHERE slug=?', slug);
const banterPaid = (t, floorId) => all(t.db, "SELECT * FROM ledger WHERE floor_id=? AND kind='talk-banter'", floorId);
const feed = (t, floorId, agent, name, text, project = '', at = Date.now()) => run(t.db, "INSERT INTO events (floor_id,type,project,data,created_at) VALUES (?,'feed',?,?,?)", floorId, project, JSON.stringify({ agent, name, text, ts: at }), at);
const say = (t, floorId, role, text, at = Date.now()) => run(t.db, 'INSERT INTO messages (floor_id,role,agent_id,text,created_at) VALUES (?,?,NULL,?,?)', floorId, role, text, at);
// The model as a recorder: talk calls are kept, and banter answers with whatever the test hands it.
const recorder = (banterLines) => {
  const seen = []; const inner = createMockClient({ mockDelayMs: 1 });
  return { seen, llm: { chat(x) {
    if (x.meta?.purpose === 'banter') {
      seen.push(x);
      if (banterLines) return Promise.resolve({ content: JSON.stringify({ lines: banterLines(x.meta) }), toolCalls: [], finish: 'stop', usage: { prompt: 900, completion: 120, cost: 0.0002, real: false } });
    }
    return inner.chat(x);
  } } };
};
async function busyFloor(t, name = 'Kettle Co') {
  const c = await claim(t, name);
  await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build a small thing' });
  await waitDone(c); await t.app.engine.people.settled();
  return c;
}

describe('what the floor gossips about', () => {
  test('recent news only, newest first, each fact marked by whether a visitor could see it', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Gossip Desk');
      const f = row(t, c.slug);
      const now = Date.now();
      run(t.db, "INSERT INTO projects (floor_id,slug,title,private,created_at) VALUES (?,'secret','Secret',1,?)", f.id, now);
      feed(t, f.id, 1, 'Arlo', 'finished "Add Virginia and Baltimore metros"', '', now - 5000);
      feed(t, f.id, 1, 'Arlo', 'read projects/x/data.json', '', now - 4000);
      feed(t, f.id, 2, 'Tess', 'sent "Fix the map" back to Arlo with notes', '', now - 3000);
      feed(t, f.id, 1, 'Arlo', 'published secret (3 files)', 'secret', now - 2000);
      feed(t, f.id, 1, 'Arlo', 'finished "Old news"', '', now - 20 * 3600000);
      say(t, f.id, 'boss', 'Actually, make the buttons green. No, blue.', now - 1000);
      say(t, f.id, 'budget', 'The floor stopped for today.', now - 500);
      for (let i = 0; i < 2; i++) run(t.db, "INSERT INTO tasks (floor_id,title,status,created_at,updated_at) VALUES (?,?,'cancelled',?,?)", f.id, `Scrapped ${i}`, now, now);
      const news = floorGossip(t.db, row(t, c.slug), { now });
      const texts = news.map((n) => n.text);
      assert.equal(texts[0], 'Arlo published secret (3 files)');
      assert.equal(news[0].open, false, 'private work stays with the boss');
      assert.ok(texts.includes('Tess sent "Fix the map" back to Arlo with notes'));
      assert.ok(texts.includes('Arlo finished "Add Virginia and Baltimore metros"'));
      assert.ok(!texts.some((x) => /read projects|Old news/.test(x)), 'reading files is not news, and twenty hours ago is not lately');
      assert.ok(news.some((n) => /2 jobs were scrapped/.test(n.text) && n.open));
      const boss = news.find((n) => /latest message/.test(n.text));
      assert.match(boss.text, /^Boss's latest message to the manager: "Actually, make the buttons green/);
      assert.equal(boss.open, false, 'the chat is closed, so what the boss said is not for visitors');
      run(t.db, 'UPDATE floors SET public_chat=1 WHERE id=?', f.id);
      assert.equal(floorGossip(t.db, row(t, c.slug), { now }).find((n) => /latest message/.test(n.text)).open, true);
      const stopped = news.find((n) => /allowance ran out/.test(n.text));
      assert.equal(stopped.open, false);
      assert.doesNotMatch(JSON.stringify(news), /\$\s?\d|\bUSD\b|dollar/i);
      const other = await claim(t, 'Next Door');
      feed(t, row(t, other.slug).id, 9, 'Zed', 'finished "Next door\'s thing"');
      assert.ok(!floorGossip(t.db, row(t, c.slug), { now: Date.now() }).some((n) => /Zed/.test(n.text)), 'another floor\'s news never comes in');
    } finally { await t.close(); }
  });

  test('the style: cheek for the boss when sass is on, warm and clean when it is off', () => {
    const on = banterStyle('Justin', true), off = banterStyle('Justin', false);
    assert.match(on, /Justin changing their mind/); assert.match(on, /alright actually/); assert.match(on, /asshole/); assert.match(on, /no slurs/);
    assert.match(off, /No swearing/); assert.match(on, /never make up what anyone said/); assert.doesNotMatch(off, /asshole|Roast/); assert.match(off, /no slurs/);
    assert.equal(sassOn({ banterSass: true }, { banter_sass: 1 }), true);
    assert.equal(sassOn({ banterSass: true }, { banter_sass: 0 }), false);
    assert.equal(sassOn({ banterSass: false }, { banter_sass: 1 }), false);
    for (const bad of ['what a f4ggot', 'he is a retard', 'paste the API key here', 'I will kill you', 'that was sexy']) assert.equal(fitToSay(bad), false, bad);
    for (const ok of ['Justin changed his mind again, the asshole.', 'Spicy take, Tess.', 'Nah, Justin\'s alright actually.', 'Damn, that map is ugly.']) assert.equal(fitToSay(ok), true, ok);
  });
});

describe('banter on the floor', () => {
  test('one cheap call writes a few lines that start from real news and rib the boss by name', async () => {
    const { seen, llm } = recorder();
    const t = await boot({}, { llm });
    try {
      const c = await busyFloor(t);
      const f = row(t, c.slug);
      feed(t, f.id, null, 'Office', 'published kettle-co (4 files)');
      assert.equal(await t.app.engine.people.banter(f.id), true);
      await t.app.engine.people.settled();
      const call = seen.at(-1);
      assert.equal(call.provider, 'anthropic'); assert.equal(call.model, 'claude-haiku-5-5', 'the cheap model');
      assert.equal(call.thinking, 'off', 'written straight off, so the reply isn\'t spent thinking');
      const sys = call.messages[0].content, user = call.messages[1].content;
      assert.match(sys, /Boss, the boss/); assert.match(sys, /Roast Boss playfully/); assert.match(sys, /no slurs/);
      assert.match(user, /Office published kettle-co \(4 files\)/);
      const lines = (await floorState(c)).talk.filter((l) => l.kind === 'banter');
      assert.ok(lines.some((l) => /Boss will change their mind again/.test(l.text)), 'the boss gets a mention');
      const paid = banterPaid(t, f.id);
      assert.equal(paid.length, 1, 'one call for the whole exchange');
      assert.equal(paid[0].provider, 'anthropic');
    } finally { await t.close(); }
  });

  test('the boss can turn the sass off for their floor, and only the boss sees the setting', async () => {
    const { seen, llm } = recorder();
    const t = await boot({}, { llm });
    try {
      const c = await busyFloor(t);
      const f = row(t, c.slug);
      assert.equal((await floorState(c)).floor.banterSass, true, 'on by default');
      const visitor = new Client(t);
      assert.equal((await floorState(visitor, c.slug)).floor.banterSass, undefined);
      assert.equal((await visitor.post(`/api/floors/${c.slug}/settings`, { banterSass: false })).status >= 400, true);
      assert.equal((await c.post(`/api/floors/${c.slug}/customise`, { banterSass: false })).status, 200);
      assert.equal((await floorState(c)).floor.banterSass, false);
      assert.equal(row(t, c.slug).name, 'Kettle Co', 'nothing else changed');
      await t.app.engine.people.banter(f.id); await t.app.engine.people.settled();
      const sys = seen.at(-1).messages[0].content;
      assert.match(sys, /No swearing/); assert.doesNotMatch(sys, /Roast|asshole/);
      assert.equal(seen.at(-1).meta.sass, false);
      assert.ok(!(await floorState(c)).talk.some((l) => /change their mind/.test(l.text)));
      await c.post(`/api/floors/${c.slug}/settings`, { banterSass: true });
      assert.equal(row(t, c.slug).banter_sass, 1);
    } finally { await t.close(); }
  });

  test('BANTER=0 stops it everywhere, BANTER_SASS=0 keeps it clean everywhere', async () => {
    const { seen, llm } = recorder();
    const t = await boot({}, { llm });
    try {
      const c = await busyFloor(t);
      const f = row(t, c.slug);
      t.cfg.banter = false;
      assert.equal(await t.app.engine.people.banter(f.id), false);
      assert.equal(banterPaid(t, f.id).length, 0); assert.equal(seen.length, 0);
      t.cfg.banter = true; t.cfg.banterSass = false;
      await t.app.engine.people.banter(f.id); await t.app.engine.people.settled();
      assert.equal(seen.at(-1).meta.sass, false, 'the building\'s switch wins over the boss\'s');
    } finally { await t.close(); }
  });

  test('a floor\'s banter stops at its daily cost cap', async () => {
    const t = await boot({ banterUsdPerFloorDay: 0.001 });
    try {
      const c = await busyFloor(t);
      const f = row(t, c.slug);
      run(t.db, "INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at,kind,provider) VALUES (?,?,NULL,'claude-haiku-5-5',1,1,0.001,?,'talk-banter','anthropic')", f.id, new Date().toISOString().slice(0, 10), Date.now());
      assert.equal(await t.app.engine.people.banter(f.id), false);
      assert.equal(banterPaid(t, f.id).length, 1, 'no new call');
      t.cfg.banterUsdPerFloorDay = 0.1;
      assert.equal(await t.app.engine.people.banter(f.id), true);
    } finally { await t.close(); }
  });

  test('a line past the limits is dropped, names must be real, and no line over five', async () => {
    const { llm } = recorder((m) => [
      { who: m.speakers[0], text: 'Boss changed their mind again, the absolute asshole.' },
      { who: m.speakers[1], text: 'Here is the API key, go nuts.' },
      { who: 'Nobody Here', text: 'I do not work here.' },
      { who: m.speakers[1], text: 'Nah, Boss is alright actually.' },
      ...Array.from({ length: 6 }, (_, i) => ({ who: m.speakers[0], text: `Filler line ${i}.` })),
    ]);
    const t = await boot({}, { llm });
    try {
      const c = await busyFloor(t);
      await t.app.engine.people.banter(row(t, c.slug).id); await t.app.engine.people.settled();
      const said = (await floorState(c)).talk.filter((l) => l.kind === 'banter').map((l) => l.text);
      assert.ok(said.includes('Boss changed their mind again, the absolute asshole.'));
      assert.ok(said.includes('Nah, Boss is alright actually.'));
      assert.ok(!said.some((x) => /API key|do not work here/.test(x)));
      assert.ok(said.length <= 5);
    } finally { await t.close(); }
  });

  test('talk built on what a visitor can\'t see stays with the boss', async () => {
    const { seen, llm } = recorder((m) => [{ who: m.speakers[0], text: 'Boss wants green. No, blue. Make up your mind.' }, { who: m.speakers[1], text: 'Blue is fine, honestly.' }]);
    const t = await boot({ banterClosedShare: 1 }, { llm });
    try {
      const c = await busyFloor(t);
      const f = row(t, c.slug);
      say(t, f.id, 'boss', 'Make the buttons green. No, blue.');
      await t.app.engine.people.banter(f.id); await t.app.engine.people.settled();
      assert.match(seen.at(-1).messages[1].content, /latest message to the manager: "Make the buttons green/);
      assert.ok((await floorState(c)).talk.some((l) => l.text === 'Blue is fine, honestly.'), 'the boss sees it');
      const seenByVisitor = (await floorState(new Client(t), c.slug)).talk.filter((l) => l.kind !== 'work').map((l) => l.text);
      assert.ok(!seenByVisitor.some((x) => /blue/i.test(x)), JSON.stringify(seenByVisitor));
    } finally { await t.close(); }
  });

  test('nothing open on the floor\'s news means nothing private goes in', async () => {
    const { seen, llm } = recorder();
    const t = await boot({ banterClosedShare: 0 }, { llm });
    try {
      const c = await busyFloor(t);
      const f = row(t, c.slug);
      say(t, f.id, 'boss', 'Psst, my private plan is pineapples.');
      await t.app.engine.people.banter(f.id); await t.app.engine.people.settled();
      assert.doesNotMatch(seen.at(-1).messages[1].content, /pineapples/);
    } finally { await t.close(); }
  });
});
