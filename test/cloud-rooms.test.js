// Office Cloud's multiplayer rooms, its quotas and its rate limits. Rooms are WebSockets on a project's own origin;
// everything that could grow (people, rooms, messages, state, storage, requests) has a cap, and the caps hold.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { get } from '../server/db.js';
import { serverSecret, signPreview } from '../server/auth.js';
import { previewCookieName } from '../server/apps.js';
import { frame } from '../server/cloud/ws.js';
import { boot, claim, sleep, until } from './helpers.js';
import { BASE, P1, P2, P3, hit, publish, cloud, wsConnect, joinRoom, png } from './cloud-helpers.js';

const setup = async (overrides = {}) => {
  const t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', publicOrigin: 'https://main.test.example', ...overrides });
  t.cfg.publicOrigin = '';
  const a = await claim(t, 'Alpha Co'); const b = await claim(t, 'Beta Co');
  t.floorA = get(t.db, 'SELECT * FROM floors WHERE slug=?', a.slug); t.floorB = get(t.db, 'SELECT * FROM floors WHERE slug=?', b.slug);
  return t;
};
const p4 = 's'.repeat(40);

describe('multiplayer rooms', () => {
  let t, hostA, hostB, hostPriv;
  before(async () => {
    t = await setup();
    hostA = publish(t, t.floorA, 'game'); hostB = publish(t, t.floorB, 'game'); hostPriv = publish(t, t.floorA, 'secret', {}, { priv: true });
  });
  after(() => t.close());

  test('two players meet: join, messages to all and to one, shared state, presence, and leave', async () => {
    const one = await joinRoom(t, hostA, 'lobby', { name: 'One', presence: { x: 1 } });
    assert.ok(one.accept, 'a real 101 with an accept key');
    assert.equal(one.welcome.t, 'welcome'); assert.deepEqual(one.welcome.members, []); assert.deepEqual(one.welcome.state, {});
    assert.equal(one.welcome.you.name, 'One'); assert.equal(one.welcome.you.guest, true);
    const two = await joinRoom(t, hostA, 'lobby', { name: 'Two', player: P2 });
    assert.deepEqual(two.welcome.members.map((m) => [m.name, m.presence]), [['One', { x: 1 }]]);
    const joined = await one.type('join');
    assert.equal(joined.member.name, 'Two');
    const twoId = two.welcome.you.id, oneId = one.welcome.you.id;

    one.send({ t: 'send', data: { hi: 'everyone' } });
    const got = await two.type('msg');
    assert.deepEqual(got, { t: 'msg', from: oneId, data: { hi: 'everyone' } });
    await sleep(30); assert.ok(!one.msgs.some((m) => m.t === 'msg'), 'no echo to the sender');

    two.send({ t: 'to', to: oneId, data: 'psst' });
    assert.deepEqual(await one.type('msg'), { t: 'msg', from: twoId, data: 'psst', direct: true });

    one.send({ t: 'set', key: 'door', value: 'open' });
    for (const c of [one, two]) assert.deepEqual(await c.type('state'), { t: 'state', key: 'door', value: 'open', by: oneId });
    two.send({ t: 'presence', data: { x: 9, y: 2 } });
    assert.deepEqual(await one.type('presence'), { t: 'presence', id: twoId, data: { x: 9, y: 2 } });

    const late = await joinRoom(t, hostA, 'lobby', { name: 'Late', player: P3 });
    assert.deepEqual(late.welcome.state, { door: 'open' });
    assert.deepEqual(late.welcome.members.map((m) => m.name).sort(), ['One', 'Two']);
    late.close();
    for (const c of [one, two]) assert.equal((await c.type('leave')).id, late.welcome.you.id);
    one.send({ t: 'set', key: 'door', value: null });
    assert.equal((await two.type('state')).value, null);
    assert.equal((await cloud(t, hostA, 'GET', 'rooms/lobby')).json.players, 2);
    assert.deepEqual((await cloud(t, hostA, 'GET', 'rooms')).json.rooms, [{ name: 'lobby', players: 2, full: false }]);
    one.close(); two.close();
    await until(() => t.app.cloud.rooms.rooms.size === 0, { what: 'the room to empty' });
  });

  test('a room name in another project is another room, and state is forgotten when a room empties', async () => {
    const a1 = await joinRoom(t, hostA, 'arena');
    a1.send({ t: 'set', key: 'score', value: 5 }); await a1.type('state');
    const b1 = await joinRoom(t, hostB, 'arena');
    assert.deepEqual(b1.welcome.members, []); assert.deepEqual(b1.welcome.state, {});
    b1.send({ t: 'send', data: 'from b' });
    await sleep(40); assert.ok(!a1.msgs.some((m) => m.t === 'msg'));
    a1.close(); b1.close();
    await until(() => t.app.cloud.rooms.rooms.size === 0, { what: 'rooms to empty' });
    const again = await joinRoom(t, hostA, 'arena');
    assert.deepEqual(again.welcome.state, {});
    again.close();
  });

  test('an account joins as itself; a session from elsewhere is refused', async () => {
    const s = (await cloud(t, hostA, 'POST', 'auth/signup', { body: { username: 'roomie', name: 'Roomie R', password: 'correct horse' } })).json;
    const c = await joinRoom(t, hostA, 'acct', { session: s.session, name: 'Pretender' });
    assert.equal(c.welcome.you.user, s.user.id); assert.equal(c.welcome.you.name, 'Roomie R'); assert.equal(c.welcome.you.guest, false);
    c.close();
    const elsewhere = await joinRoom(t, hostB, 'acct', { session: s.session });
    assert.equal(elsewhere.welcome.code, 'signed_out');
    assert.equal(await elsewhere.closedWith(), 4401);
  });

  test('only the project\'s own pages may connect, and a private project needs its pass', async () => {
    for (const origin of [`https://${hostB}`, 'https://evil.example', null]) assert.equal((await wsConnect(t, hostA, 'lobby', { origin })).refused, 403, String(origin));
    assert.equal((await wsConnect(t, hostPriv, 'lobby')).refused, 404);
    const exp = Math.floor(Date.now() / 1000) + 600;
    const pass = `${exp}.${signPreview(serverSecret(t.db), t.floorA.id, 'secret', exp)}`;
    const ok = await joinRoom(t, hostPriv, 'lobby', {}, { cookie: `${previewCookieName(t.cfg)}=${pass}` });
    assert.equal(ok.welcome.t, 'welcome');
    ok.close();
    const forged = `${exp}.${signPreview(serverSecret(t.db), t.floorA.id, 'game', exp)}`;
    assert.equal((await wsConnect(t, hostPriv, 'lobby', { cookie: `${previewCookieName(t.cfg)}=${forged}` })).refused, 404, 'a pass for another project opens nothing');
    assert.equal((await wsConnect(t, `127.0.0.1:${t.port}`, 'lobby', { origin: `http://127.0.0.1:${t.port}` })).refused, 404, 'the main site has no rooms');
    assert.equal((await wsConnect(t, hostA, 'bad name!')).refused, 400);
    assert.equal((await wsConnect(t, hostA, 'x', { path: '/_office/cloud/db/posts' })).refused, 400);
  });

  test('the protocol is enforced: hello first, JSON text only, nothing oversized', async () => {
    const rude = await wsConnect(t, hostA, 'proto');
    rude.send({ t: 'send', data: 1 });
    assert.equal(await rude.closedWith(), 4008);
    const c = await joinRoom(t, hostA, 'proto');
    c.send('not json');
    assert.equal((await c.type('error')).code, 'bad_json');
    c.send({ t: 'set', key: 'bad key', value: 1 });
    assert.equal((await c.type('error')).code, 'bad_key');
    c.send({ t: 'send', data: 'x'.repeat(9 * 1024) });
    assert.equal(await c.closedWith(), 1009);
    const bin = await joinRoom(t, hostA, 'proto');
    bin.raw(frame(0x2, Buffer.from([1, 2, 3]), true));
    assert.equal(await bin.closedWith(), 1003);
    const unmasked = await joinRoom(t, hostA, 'proto');
    unmasked.raw(frame(0x1, Buffer.from('{"t":"ping"}'), false));
    assert.equal(await unmasked.closedWith(), 1002);
    await until(() => t.app.cloud.rooms.conns.size === 0, { what: 'connections to close' });
  });
});

describe('caps: storage, people and messages', () => {
  let t, host;
  before(async () => {
    t = await setup({
      cloudLimits: { dataBytes: 6000, docBytes: 2000, collections: 2, docsPerOwner: 3, boards: 2, boardEntries: 3, fileMax: 3000, fileBytes: 5000 },
      cloudRoomLimits: { members: 2, roomsPerProject: 2, msgRate: 5, msgBurst: 5, connsPerIp: 4, stateKeys: 2 },
    });
    host = publish(t, t.floorA, 'tight');
  });
  after(() => t.close());

  test('documents: size, per-person count, collections, then the project\'s whole quota', async () => {
    assert.equal((await cloud(t, host, 'POST', 'db/a', { body: { data: { s: 'x'.repeat(2100) } } })).status, 413);
    for (let i = 0; i < 3; i++) assert.equal((await cloud(t, host, 'POST', 'db/a', { body: { data: { i } } })).status, 201);
    const fourth = await cloud(t, host, 'POST', 'db/a', { body: { data: { i: 4 } } });
    assert.equal(fourth.status, 507); assert.equal(fourth.json.error, 'quota');
    assert.equal((await cloud(t, host, 'POST', 'db/b', { player: P2, body: { data: {} } })).status, 201);
    assert.equal((await cloud(t, host, 'POST', 'db/c', { player: P2, body: { data: {} } })).status, 507, 'a third collection');
    let full = null;
    for (const [i, p] of [P2, P3, p4, 't'.repeat(40), 'u'.repeat(40)].entries()) {
      const r = await cloud(t, host, 'POST', 'db/b', { player: p, body: { data: { s: 'y'.repeat(1700), i } } });
      if (r.status !== 201) { full = r; break; }
    }
    assert.ok(full, 'the project fills up'); assert.equal(full.status, 507); assert.match(full.json.message, /storage/);
    const used = t.app.cloud.store.usage(t.floorA.id, 'tight').bytes;
    assert.ok(used <= 6000, `${used} bytes used`);
  });

  test('leaderboards: a board count cap, and a full board keeps its best', async () => {
    const t2 = publish(t, t.floorA, 'boards');
    assert.equal((await cloud(t, t2, 'POST', 'boards/one', { body: { score: 1 } })).status, 200);
    assert.equal((await cloud(t, t2, 'POST', 'boards/two', { body: { score: 1 } })).status, 200);
    assert.equal((await cloud(t, t2, 'POST', 'boards/three', { body: { score: 1 } })).status, 507);
    for (const [p, s] of [[P1, 10], [P2, 20], [P3, 30]]) await cloud(t, t2, 'POST', 'boards/top', { player: p, body: { score: s } });
    const weak = await cloud(t, t2, 'POST', 'boards/top', { player: p4, body: { score: 5 } });
    assert.equal(weak.status, 507, 'top is a third board');
    const r = await cloud(t, t2, 'POST', 'boards/one', { player: p4, body: { score: 0 } });
    assert.equal(r.status, 200);
    for (const [p, s] of [[P2, 20], [P3, 30]]) await cloud(t, t2, 'POST', 'boards/one', { player: p, body: { score: s } });
    const beaten = await cloud(t, t2, 'POST', 'boards/one', { player: 'v'.repeat(40), body: { score: -1 } });
    assert.equal(beaten.json.improved, false);
    const strong = await cloud(t, t2, 'POST', 'boards/one', { player: 'w'.repeat(40), body: { score: 99 } });
    assert.equal(strong.json.improved, true);
    const board = (await cloud(t, t2, 'GET', 'boards/one')).json.entries.map((e) => e.score);
    assert.deepEqual(board, [99, 30, 20]);
  });

  test('files: per-file size and the project\'s file quota', async () => {
    const t3 = publish(t, t.floorA, 'files');
    assert.equal((await cloud(t, t3, 'POST', 'files', { raw: png(4000), type: 'image/png' })).status, 413);
    assert.equal((await cloud(t, t3, 'POST', 'files', { raw: png(2500), type: 'image/png' })).status, 201);
    assert.equal((await cloud(t, t3, 'POST', 'files', { player: P2, raw: png(2500), type: 'image/png' })).status, 201);
    const over = await cloud(t, t3, 'POST', 'files', { player: P3, raw: png(100), type: 'image/png' });
    assert.equal(over.status, 507); assert.match(over.json.message, /file space/);
  });

  test('two uploads at once per address; a third is told to wait', async () => {
    const h4 = publish(t, t.floorA, 'slow');
    const slow = () => {
      const body = png(2000);
      const req = http.request({ host: '127.0.0.1', port: t.port, method: 'POST', path: '/_office/cloud/files', headers: { host: h4, origin: `https://${h4}`, 'sec-fetch-site': 'same-origin', 'x-office-player': P1, 'content-type': 'image/png', 'content-length': body.length } });
      const done = new Promise((res) => req.on('response', (r) => { r.resume(); r.on('end', () => res(r.statusCode)); }));
      req.write(body.subarray(0, 100));
      return { finish: () => { req.end(body.subarray(100)); return done; } };
    };
    const one = slow(), two = slow();
    await sleep(150);
    const third = await cloud(t, h4, 'POST', 'files', { raw: png(200), type: 'image/png' });
    assert.equal(third.status, 429); assert.match(third.json.message, /other uploads/);
    assert.deepEqual([await one.finish(), await two.finish()], [201, 201]);
    assert.equal((await cloud(t, h4, 'POST', 'files', { raw: png(200), type: 'image/png' })).status, 201, 'free again once they finish');
  });

  test('rooms: people per room, rooms per project, connections per address, state keys and message rate', async () => {
    const r1 = await joinRoom(t, host, 'r1'); const r2 = await joinRoom(t, host, 'r1', { player: P2 });
    const r3 = await joinRoom(t, host, 'r1', { player: P3 });
    assert.equal(r3.welcome.code, 'room_full'); assert.equal(await r3.closedWith(), 4003);
    const other = await joinRoom(t, host, 'r2');
    const third = await joinRoom(t, host, 'r3', { player: P3 });
    assert.equal(third.welcome.code, 'no_rooms'); assert.equal(await third.closedWith(), 4003);
    const extra = await wsConnect(t, host, 'r2');
    assert.ok(!extra.refused, 'a fourth connection from one address is fine');
    assert.equal((await wsConnect(t, host, 'r2')).refused, 429, 'a fifth is not');
    extra.close();
    r1.send({ t: 'set', key: 'a', value: 1 }); r1.send({ t: 'set', key: 'b', value: 2 }); r1.send({ t: 'set', key: 'c', value: 3 });
    assert.equal((await r1.type('error')).code, 'state_full');
    // A second for the allowance to fill back up, then more than it allows at once.
    await sleep(1100); r1.msgs.length = 0; r2.msgs.length = 0;
    for (let i = 0; i < 15; i++) r1.send({ t: 'send', data: i });
    assert.equal((await r1.type('error')).code, 'rate_limited');
    await sleep(100);
    const delivered = r2.msgs.filter((m) => m.t === 'msg').length;
    assert.ok(delivered >= 3 && delivered <= 7, `${delivered} got through`);
    for (const c of [r1, r2, other]) c.close();
    await until(() => t.app.cloud.rooms.conns.size === 0 && t.app.cloud.rooms.rooms.size === 0, { what: 'everything to close' });
  });

  test('nothing is left behind after many people come and go', async () => {
    const R = t.app.cloud.rooms;
    for (let round = 0; round < 5; round++) {
      const batch = await Promise.all([0, 1].map((i) => joinRoom(t, host, `churn${i}`, { player: String(round * 2 + i).padStart(40, '0') })));
      for (const c of batch) c.close();
      await until(() => R.conns.size === 0, { what: 'the batch to leave' });
    }
    assert.equal(R.rooms.size, 0); assert.equal(R.perIp.size, 0); assert.equal(R.perProject.size, 0); assert.equal(R.roomsPer.size, 0);
  });

  test('the running totals still match a recount after all that', () => {
    for (const p of ['tight', 'boards', 'files']) {
      const u = t.app.cloud.store.usage(t.floorA.id, p); const real = t.app.cloud.store.recount(t.floorA.id, p);
      for (const k of Object.keys(real)) assert.equal(u[k], real[k], `${p} ${k}`);
    }
  });
});

describe('rate limits', () => {
  test('per project and for the whole building', async () => {
    const t = await setup({ cloudRateScale: 1, cloudRates: { project: [10, 60000], all: [25, 60000] } });
    try {
      const [r1, r2, r3] = ['r-one', 'r-two', 'r-three'].map((s) => publish(t, t.floorA, s));
      for (let i = 0; i < 10; i++) assert.equal((await cloud(t, r1, 'GET', 'ping')).status, 200);
      const limited = await cloud(t, r1, 'GET', 'ping');
      assert.equal(limited.status, 429); assert.equal(limited.json.error, 'rate_limited'); assert.equal(limited.headers['retry-after'], '30');
      for (let i = 0; i < 9; i++) assert.equal((await cloud(t, r2, 'GET', 'ping')).status, 200, 'another project has its own allowance');
      let n = 0;
      while ((await cloud(t, r3, 'GET', 'ping')).status === 200) n++;
      assert.ok(n < 10, `the building-wide limit stopped project three after ${n}, short of its own 10`);
      assert.equal((await wsConnect(t, r3, 'lobby')).refused, 429, 'rooms count too');
    } finally { await t.close(); }
  });
  test('log-ins per account, sign-ups per address, scores per player, uploads per address and queries', async () => {
    const t = await setup({ cloudRateScale: 1, cloudRates: { loginAccount: [3, 900000], signupIp: [2, 3600000], score: [3, 60000], upload: [2, 3600000], query: [3, 60000] } });
    try {
      const h = publish(t, t.floorA, 'limits');
      for (let i = 0; i < 2; i++) assert.equal((await cloud(t, h, 'POST', 'auth/signup', { body: { username: `user${i}`, password: 'correct horse' } })).status, 201);
      assert.equal((await cloud(t, h, 'POST', 'auth/signup', { body: { username: 'user9', password: 'correct horse' } })).status, 429);
      for (let i = 0; i < 3; i++) assert.equal((await cloud(t, h, 'POST', 'auth/login', { body: { login: 'user0', password: 'guess' + i } })).status, 401);
      assert.equal((await cloud(t, h, 'POST', 'auth/login', { body: { login: 'user0', password: 'correct horse' } })).status, 429, 'even the right password waits');
      assert.equal((await cloud(t, h, 'POST', 'auth/login', { body: { login: 'user1', password: 'correct horse' } })).status, 200, 'another account is unaffected');
      for (let i = 0; i < 3; i++) assert.equal((await cloud(t, h, 'POST', 'boards/b', { body: { score: i } })).status, 200);
      assert.equal((await cloud(t, h, 'POST', 'boards/b', { body: { score: 9 } })).status, 429);
      for (let i = 0; i < 2; i++) assert.equal((await cloud(t, h, 'POST', 'files', { raw: png(100), type: 'image/png' })).status, 201);
      assert.equal((await cloud(t, h, 'POST', 'files', { raw: png(100), type: 'image/png' })).status, 429);
      for (let i = 0; i < 3; i++) assert.equal((await cloud(t, h, 'GET', 'db/things?sort=name')).status, 200);
      assert.equal((await cloud(t, h, 'GET', 'db/things')).status, 429, 'queries have their own allowance');
      assert.equal((await cloud(t, h, 'GET', 'ping')).status, 200, 'and running out of it stops nothing else');
    } finally { await t.close(); }
  });
});
