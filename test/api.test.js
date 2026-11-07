import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, Client, claim, adminClient, floorState, spentToday, waitDone, until, sse, sleep, allDone } from './helpers.js';

describe('claiming and sessions', () => {
  let t; before(async () => { t = await boot(); }); after(() => t.close());
  test('a code is single use, and the cookie has the right flags', async () => {
    const c = new Client(t); const code = t.code();
    assert.equal((await c.post('/api/claim/check', { code })).status, 200);
    const r = await c.raw('POST', '/api/claim', { body: { code, name: 'First Co', bossName: 'Ana', look: { hair: 'bun', hat: 'crown' } } });
    assert.equal(r.status, 201);
    const sc = r.headers.getSetCookie()[0];
    for (const f of ['office_s=', 'Path=/theoffice', 'HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(sc.includes(f), f);
    const again = await new Client(t).post('/api/claim', { code, name: 'Second', bossName: 'B' });
    assert.equal(again.status, 404);
    assert.equal((await new Client(t).post('/api/claim/check', { code })).status, 404);
  });
  test('codes are stored hashed', () => {
    const code = t.code();
    const rows = t.db.prepare('SELECT hash FROM codes').all();
    assert.ok(rows.every((r) => r.hash !== code && /^[0-9a-f]{64}$/.test(r.hash)));
  });
  test('--floor codes claim that floor, and a taken floor refuses', async () => {
    const a = await claim(t, 'Floor Twelve', { floor: 12 });
    assert.equal(a.number, 12);
    const c = new Client(t); const code = t.code(12);
    assert.equal((await c.post('/api/claim', { code, name: 'Late', bossName: 'L' })).status, 409);
  });
  test('recovery logs in on a new device, rotates, and kills the old session', async () => {
    const a = await claim(t, 'Recover Me');
    const d = new Client(t);
    assert.equal((await d.post('/api/login', { slug: a.slug, recoveryCode: 'RECOVER-WRONG' })).status, 401);
    assert.equal((await d.post('/api/login', { slug: 'no-such-floor', recoveryCode: a.recovery })).status, 401);
    const ok = await d.post('/api/login', { slug: a.slug, recoveryCode: a.recovery });
    assert.equal(ok.status, 200); d.csrf = ok.data.csrf; d.slug = a.slug;
    assert.notEqual(ok.data.recoveryCode, a.recovery);
    assert.equal((await new Client(t).post('/api/login', { slug: a.slug, recoveryCode: a.recovery })).status, 401);
    assert.equal((await a.post(`/api/floors/${a.slug}/chat`, { text: 'hi' })).status, 401);
    assert.equal((await d.post(`/api/floors/${a.slug}/chat`, { text: 'hi' })).status, 202);
  });
  test('slugs avoid collisions and reserved words', async () => {
    const a = await claim(t, 'Twin Co'); const b = await claim(t, 'Twin Co'); assert.notEqual(a.slug, b.slug);
    const r = await claim(t, 'Admin'); assert.notEqual(r.slug, 'admin');
    assert.equal((await new Client(t).post('/api/claim', { code: t.code(), name: 'x', bossName: 'B' })).status, 400);
    assert.equal((await new Client(t).post('/api/claim', { code: t.code(), name: 'Good', bossName: '' })).status, 400);
  });
  test('app pages answer with or without a trailing slash', async () => {
    for (const p of ['', '/', '/admin', '/admin/', '/floor/x', '/floor/x/']) assert.equal((await new Client(t).raw('GET', p)).status, 200, p);
  });
  test('logout ends the session', async () => {
    const a = await claim(t, 'Leaver');
    assert.equal((await a.post('/api/logout', {})).status, 200);
    const me = await a.get('/api/me'); assert.equal(me.data.floor, null);
  });
  test('customising boss, staff, decor and colours persists; junk values are ignored', async () => {
    const a = await claim(t, 'Stylish');
    const r = await a.post(`/api/floors/${a.slug}/settings`, { name: 'Stylish Two', tagline: 'New line', colors: { primary: '#112233', accent: 'red' }, boss: { name: 'Queen', look: { hat: 'crown', hair: 'evil' } }, decor: { floor: 'terrazzo', plants: 5, arcade: true, pet: 'dog', wall: '#ddeeff', neon: 'yes' }, publicChat: true });
    assert.equal(r.status, 200);
    const s = await floorState(a);
    assert.equal(s.floor.name, 'Stylish Two'); assert.equal(s.floor.colors.primary, '#112233'); assert.equal(s.floor.colors.accent, '#ffcc00');
    assert.equal(s.floor.boss.look.hat, 'crown'); assert.equal(s.floor.boss.look.hair, 'bun'); assert.equal(s.floor.decor.floor, 'terrazzo'); assert.equal(s.floor.decor.pet, 'dog'); assert.equal(s.floor.decor.neon, true);
    const staff = s.agents.find((x) => x.role === 'writer');
    assert.equal((await a.post(`/api/floors/${a.slug}/staff/${staff.id}`, { name: 'Shakes', look: { hat: 'tophat' } })).status, 200);
    const s2 = await floorState(a); const w = s2.agents.find((x) => x.id === staff.id);
    assert.equal(w.name, 'Shakes'); assert.equal(w.look.hat, 'tophat');
  });
});

describe('two floors, mock mode, end to end', () => {
  let t, a, b; before(async () => { t = await boot(); a = await claim(t, 'Alpha Works'); b = await claim(t, 'Beta Labs'); }); after(() => t.close());
  test('brainstorm: the manager streams a reply and assigns nothing', async () => {
    const s = sse(a, a.slug);
    await sleep(30);
    assert.equal((await a.post(`/api/floors/${a.slug}/chat`, { text: 'thinking about soup' })).status, 202);
    await until(() => s.events.some((e) => e.type === 'message' && e.data.role === 'manager' && /Three angles/.test(e.data.text)), { what: 'manager reply' });
    assert.ok(s.events.some((e) => e.type === 'token'), 'tokens streamed');
    const st = await floorState(a); assert.equal(st.tasks.length, 0);
    await s.close();
  });
  test('both floors run a full chain of command at the same time', async () => {
    const sa = sse(a, a.slug), sb = sse(b, b.slug);
    await sleep(30);
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build soup finder' });
    await b.post(`/api/floors/${b.slug}/chat`, { text: 'please make hat museum' });
    const fa = await waitDone(a); const fb = await waitDone(b);
    for (const [f, s, slug] of [[fa, sa, 'soup-finder'], [fb, sb, 'hat-museum']]) {
      assert.equal(f.tasks.length, 4); assert.ok(f.tasks.every((x) => x.status === 'done'), JSON.stringify(f.tasks.map((x) => x.status)));
      assert.deepEqual(f.projects.map((p) => p.kind).sort(), ['doc', 'research', 'site']);
      assert.ok(f.projects.some((p) => p.slug === slug), f.projects.map((p) => p.slug).join());
      const kinds = new Set(s.events.map((e) => e.type));
      for (const k of ['agent', 'task', 'feed', 'meeting', 'handoff', 'message', 'token', 'project']) assert.ok(kinds.has(k), `missing ${k}`);
      assert.ok(!kinds.has('spend'), 'what was spent is the admin\'s alone');
      const states = new Set(s.events.filter((e) => e.type === 'agent').map((e) => e.data.state));
      for (const k of ['thinking', 'typing', 'reading', 'idle']) assert.ok(states.has(k), `no agent state ${k}`);
      assert.equal(f.spend, undefined); assert.ok(spentToday(t, f.floor) > 0); assert.match(f.messages.at(-1).text, /All done/);
      assert.ok(f.messages.at(-1).text.includes(`/theoffice/f/${f.floor.slug}/${slug}/`));
    }
    await sa.close(); await sb.close();
  });
  test('the published site, doc and research pages serve with the sandbox header', async () => {
    const v = new Client(t);
    const site = await v.raw('GET', `/f/${a.slug}/soup-finder/`);
    assert.equal(site.status, 200); assert.match(site.headers.get('content-type'), /text\/html/);
    assert.equal(site.headers.get('content-security-policy'), 'sandbox allow-scripts allow-forms allow-popups');
    assert.equal(site.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await site.text(), /Clap for the staff/);
    assert.match((await v.raw('GET', `/f/${a.slug}/soup-finder/style.css`)).headers.get('content-type'), /text\/css/);
    assert.match((await v.raw('GET', `/f/${a.slug}/soup-finder/app.js`)).headers.get('content-type'), /javascript/);
    const noslash = await v.raw('GET', `/f/${a.slug}/soup-finder`);
    assert.equal(noslash.status, 301); assert.equal(noslash.headers.get('location'), `/theoffice/f/${a.slug}/soup-finder/`);
    const doc = await (await v.raw('GET', `/f/${a.slug}/soup-finder-brief/`)).text();
    assert.match(doc, /<h1>The launch brief<\/h1>/);
    const res = await (await v.raw('GET', `/f/${a.slug}/soup-finder-research/`)).text();
    assert.match(res, /Sources/); assert.match(res, /https:\/\/example\.com\//);
  });
  test('catch up: a returning viewer gets what they missed from Last-Event-ID', async () => {
    const before = await floorState(a);
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go make second thing' });
    await waitDone(a);
    const s = sse(a, a.slug, { since: before.lastEventId });
    await until(() => s.events.some((e) => e.type === 'feed' && /finished/.test(e.data.text)), { what: 'replay' });
    const ids = s.events.map((e) => e.id).filter(Boolean);
    assert.ok(ids.every((id) => id > before.lastEventId));
    await s.close();
  });
  test('workspace files are readable by the owner, as text', async () => {
    const st = await floorState(a);
    const f = st.files.find((x) => x.path.endsWith('index.html'));
    const r = await a.get(`/api/floors/${a.slug}/files/${Buffer.from(f.path).toString('base64url')}`);
    assert.equal(r.status, 200); assert.match(r.data.text, /<html/); assert.match(r.headers.get('content-type'), /application\/json/);
  });
});

describe('boss controls', () => {
  let t; before(async () => { t = await boot(); }); after(() => t.close());
  test('pause halts work and resume finishes it', async () => {
    const a = await claim(t, 'Pauser');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build thing [slow]' });
    await until(async () => (await floorState(a)).tasks.some((x) => x.status === 'doing'), { what: 'work to start' });
    assert.equal((await a.post(`/api/floors/${a.slug}/control`, { action: 'pause' })).data.paused, true);
    await until(async () => (await floorState(a)).agents.every((x) => x.state === 'idle'), { what: 'idle' });
    const s = await floorState(a); assert.equal(s.floor.paused, true); assert.ok(s.tasks.some((x) => x.status === 'todo'));
    const cost = spentToday(t, a); await sleep(80);
    assert.equal(spentToday(t, a), cost, 'no spend while paused');
    await a.post(`/api/floors/${a.slug}/control`, { action: 'resume' });
    const f = await waitDone(a); assert.ok(f.tasks.every((x) => x.status === 'done'));
  });
  test('stop cancels everything and no task comes back', async () => {
    const a = await claim(t, 'Stopper');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build thing [slow]' });
    await until(async () => (await floorState(a)).tasks.some((x) => x.status === 'doing'), { what: 'work' });
    await a.post(`/api/floors/${a.slug}/control`, { action: 'stop' });
    await until(async () => (await floorState(a)).agents.every((x) => x.state === 'idle'), { what: 'idle' });
    await sleep(60);
    const s = await floorState(a);
    assert.ok(s.tasks.every((x) => x.status === 'cancelled'), JSON.stringify(s.tasks.map((x) => x.status)));
    assert.match(s.messages.at(-1).text, /stopped/);
  });
  test('redirect cancels the old plan and starts the new instruction', async () => {
    const a = await claim(t, 'Redirector');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build old thing [slow]' });
    await until(async () => (await floorState(a)).tasks.some((x) => x.status === 'doing'), { what: 'work' });
    await a.post(`/api/floors/${a.slug}/control`, { action: 'redirect', text: 'forget that, go build new thing' });
    const s = await until(async () => { const x = await floorState(a); return x.projects.some((p) => p.slug === 'forget-that-new-thing' || /new-thing/.test(p.slug)) && allDone(x) ? x : null; }, { what: 'new plan', timeout: 20000 });
    assert.ok(s.tasks.filter((x) => x.status === 'cancelled').length >= 1);
    assert.equal(s.tasks.filter((x) => x.status === 'done').length, 4);
  });
  test('a staff member asks the boss, waits, and carries on with the answer', async () => {
    const a = await claim(t, 'Asker');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build [ask] thing' });
    const q = await until(async () => (await floorState(a)).questions?.[0], { what: 'question' });
    assert.match(q.text, /silly or serious/);
    const blocked = await until(async () => { const s = await floorState(a); return s.tasks.find((x) => x.status === 'blocked'); }, { what: 'blocked' });
    assert.ok(blocked);
    assert.equal((await a.post(`/api/floors/${a.slug}/questions/${q.id}/answer`, { text: 'silly, obviously' })).status, 200);
    assert.equal((await a.post(`/api/floors/${a.slug}/questions/${q.id}/answer`, { text: 'again' })).status, 404);
    const s = await waitDone(a);
    assert.ok(s.tasks.every((x) => x.status === 'done')); assert.equal(s.questions.length, 0);
    const brief = s.files.find((f) => f.path.includes('brief'));
    const body = await a.get(`/api/floors/${a.slug}/files/${Buffer.from(brief.path).toString('base64url')}`);
    assert.match(body.data.text, /silly, obviously/);
  });
  test('the manager can ask too', async () => {
    const a = await claim(t, 'Mgr Asker');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'thoughts on this [mgrask]' });
    const q = await until(async () => (await floorState(a)).questions?.[0], { what: 'question' });
    await a.post(`/api/floors/${a.slug}/questions/${q.id}/answer`, { text: 'imaginary' });
    await until(async () => (await floorState(a)).messages.at(-1).text.includes('settles'), { what: 'reply' });
  });
  test('the manager sends work back once, then approves', async () => {
    const a = await claim(t, 'Reviser');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build [revise] thing' });
    const s = await until(async () => { const x = await floorState(a); return allDone(x) && /All done/.test(x.messages.at(-1).text) ? x : null; }, { what: 'done' });
    assert.ok(s.feed.some((f) => /sent .* back/.test(f.text))); assert.ok(s.tasks.every((x) => x.status === 'done'));
  });
  test('hiring adds staff, and the cap holds', async () => {
    const t2 = await boot({ maxStaff: 5 });
    const a = await claim(t2, 'Hirer');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build [hire] thing' });
    const s = await waitDone(a);
    const hired = s.agents.find((x) => x.role === 'analyst');
    assert.equal(hired.name, 'Quill'); assert.ok(s.tasks.some((x) => x.agentId === hired.id && x.status === 'done'));
    assert.match(await t2.app.engine.hireStaff(t2.db.prepare('SELECT * FROM floors').get(), 'analyst', 'Dup'), /already/);
    assert.throws(() => t2.app.engine.hireStaff(t2.db.prepare('SELECT * FROM floors').get(), 'marketer', 'Over'), /limit/);
    await t2.close();
  });
  test('purchase requests are only recorded, and the boss and admin both see them', async () => {
    const a = await claim(t, 'Buyer');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build [buy] thing' });
    const s = await waitDone(a);
    assert.equal(s.purchases.length, 1); assert.equal(s.purchases[0].status, 'pending'); assert.equal(s.purchases[0].price, 12);
    assert.equal((await new Client(t).get(`/api/floors/${a.slug}`)).data.purchases, undefined);
    const adm = await adminClient(t);
    assert.ok((await adm.get('/api/admin/overview')).data.purchases.some((p) => p.item === 'A domain name'));
    assert.equal((await a.post(`/api/floors/${a.slug}/purchases/${s.purchases[0].id}`, { status: 'declined' })).status, 200);
    assert.equal((await a.post(`/api/floors/${a.slug}/purchases/${s.purchases[0].id}`, { status: 'paid' })).status, 400);
    assert.equal((await floorState(a)).purchases[0].status, 'declined');
  });
});

describe('budget, concurrency and provider failure', () => {
  test('at the floor cap agents stop cleanly, the manager says so, other floors carry on, and tomorrow it resumes', async () => {
    let clock = Date.parse('2026-11-06T12:00:00Z');
    const t = await boot({ floorDailyUsd: 2, globalDailyUsd: 100 }, { now: () => clock });
    const a = await claim(t, 'Spender'); const b = await claim(t, 'Saver');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build thing [spendy]' });
    const stopped = await until(async () => { const s = await floorState(a); return s.floor.budgetStopped && s.agents.every((x) => x.state === 'idle') ? s : null; }, { what: 'budget stop' });
    assert.ok(stopped.messages.some((m) => /it for today/.test(m.text)));
    assert.equal(stopped.messages.filter((m) => /it for today/.test(m.text)).length, 1);
    assert.ok(spentToday(t, a) >= 2 && spentToday(t, a) < 2 + 3 * 0.5 + 0.01, `spent ${spentToday(t, a)}`);
    assert.ok(stopped.tasks.some((x) => x.status === 'todo'), 'unfinished work is kept for tomorrow');
    const spent = spentToday(t, a); await sleep(1200);
    assert.equal(spentToday(t, a), spent, 'nothing spent after the cap');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'one more thing' });
    assert.match((await floorState(a)).messages.at(-1).text, /first thing tomorrow/);
    await b.post(`/api/floors/${b.slug}/chat`, { text: 'go build other' });
    await waitDone(b);
    clock += 86400000;
    const fresh = await floorState(a);
    assert.equal(fresh.floor.budgetStopped, false); assert.equal(spentToday(t, a), 0);
    await until(() => spentToday(t, a) > 0, { what: 'next day work' });
    await t.close();
  });
  test('the global cap stops every floor', async () => {
    const t = await boot({ floorDailyUsd: 100, globalDailyUsd: 1 });
    const a = await claim(t, 'One'); const b = await claim(t, 'Two');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build x [spendy]' });
    await b.post(`/api/floors/${b.slug}/chat`, { text: 'go build y [spendy]' });
    await until(async () => (await floorState(a)).floor.budgetStopped && (await floorState(b)).floor.budgetStopped, { what: 'stop' });
    await until(() => t.app.engine.runs.size === 0, { what: 'runs to end' });
    assert.ok(t.app.engine.spentGlobal() < 1 + 6 * 0.5 + 0.01);
    await t.close();
  });
  test('never more than 3 LLM calls per floor, or 6 globally', async () => {
    const t = await boot({}, {});
    t.cfg.mockDelayMs = 10;
    const floors = [];
    for (let i = 0; i < 6; i++) floors.push(await claim(t, `Busy ${i}`));
    await Promise.all(floors.map((c) => c.post(`/api/floors/${c.slug}/chat`, { text: 'go build things' })));
    await Promise.all(floors.map((c) => waitDone(c)));
    const l = t.app.engine.limiter;
    assert.ok(l.peak <= 6, `global peak ${l.peak}`); assert.ok(l.peakFloor <= 3, `floor peak ${l.peakFloor}`);
    assert.ok(l.peak >= 4, 'real parallelism happened'); assert.equal(l.active, 0);
    await t.close();
  });
  test('a provider failure pauses the floor visibly, does not loop, and resumes on demand', async () => {
    let calls = 0;
    const { createMockClient } = await import('../server/mock.js');
    const { ProviderError } = await import('../server/llm.js');
    const t0 = await boot();
    const inner = createMockClient(t0.cfg);
    await t0.close();
    let broken = true;
    const llm = { chat(args) { calls++; if (broken) return Promise.reject(new ProviderError('Model provider said 503', { retryable: true, status: 503 })); return inner.chat(args); } };
    // Calls are counted here, so the people's chatter (people.test.js) stays out.
    const t = await boot({ peopleTalk: false }, { llm });
    const a = await claim(t, 'Fragile');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'hello' });
    const s = await until(async () => { const x = await floorState(a); return x.floor.paused ? x : null; }, { what: 'pause' });
    assert.match(s.floor.pauseReason, /provider/); assert.ok(s.messages.some((m) => /paused the floor/.test(m.text)));
    assert.equal(calls, 4, 'one try plus three backoff retries');
    await sleep(1300); assert.equal(calls, 4, 'no further calls while paused');
    await a.post(`/api/floors/${a.slug}/control`, { action: 'resume' });
    await until(() => calls > 4 && t.app.engine.runs.size === 0 || calls >= 8, { what: 'retry after resume' });
    await until(async () => (await floorState(a)).floor.paused, { what: 'pauses again rather than looping' });
    broken = false;
    await a.post(`/api/floors/${a.slug}/control`, { action: 'resume' });
    await until(async () => (await floorState(a)).messages.at(-1).text.includes('Three angles'), { what: 'recovery' });
    await t.close();
  });
  test('a non-retryable provider error pauses right away', async () => {
    const { ProviderError } = await import('../server/llm.js');
    let calls = 0;
    const t = await boot({ peopleTalk: false }, { llm: { chat() { calls++; return Promise.reject(new ProviderError('Model provider said 402', { status: 402 })); } } });
    const a = await claim(t, 'Broke');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'hello' });
    await until(async () => (await floorState(a)).floor.paused, { what: 'pause' });
    assert.equal(calls, 1);
    await t.close();
  });
  test('restart: unfinished work resumes from its saved transcript', async () => {
    const t = await boot();
    const a = await claim(t, 'Survivor');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build thing [slow]' });
    await until(async () => (await floorState(a)).tasks.some((x) => x.status === 'doing'), { what: 'work' });
    t.app.engine.stopped = true;
    for (const r of t.app.engine.runs.values()) r.ctl.abort(new (await import('../server/engine.js')).Halt('shutdown'));
    await until(() => t.app.engine.runs.size === 0, { what: 'runs to stop' });
    t.db.prepare("UPDATE tasks SET status='doing' WHERE status='todo'").run();  // what a hard crash leaves behind
    t.app.engine.stopped = false; clearInterval(t.app.engine.timer);
    t.app.engine.start();
    const s = await waitDone(a);
    assert.ok(s.tasks.every((x) => x.status === 'done'));
    await t.close();
  });
});

describe('admin', () => {
  let t, adm; before(async () => { t = await boot(); adm = await adminClient(t); }); after(() => t.close());
  test('issues working codes, and rejects taken floors', async () => {
    const r = await adm.post('/api/admin/codes', { floor: 30 });
    assert.equal(r.status, 201);
    const c = new Client(t);
    const claimed = await c.post('/api/claim', { code: r.data.code, name: 'Thirty', bossName: 'T' });
    assert.equal(claimed.data.number, 30);
    assert.equal((await adm.post('/api/admin/codes', { floor: 30 })).status, 409);
    assert.equal((await adm.post('/api/admin/codes', { floor: 9999 })).status, 400);
  });
  test('sees floors and spend; suspend closes a floor and its sites; unsuspend restores it', async () => {
    const a = await claim(t, 'Naughty');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build site' });
    await waitDone(a);
    const o = await adm.get('/api/admin/overview');
    const row = o.data.floors.find((f) => f.slug === a.slug);
    assert.ok(row.spendToday > 0); assert.equal(row.projects, 3);
    const p = (await floorState(a)).projects.find((x) => x.kind === 'site');
    assert.equal((await new Client(t).raw('GET', `/f/${a.slug}/${p.slug}/`)).status, 200);
    assert.equal((await adm.post(`/api/admin/floors/${row.id}/suspend`, {})).status, 200);
    assert.equal((await new Client(t).raw('GET', `/f/${a.slug}/${p.slug}/`)).status, 404);
    assert.equal((await a.post(`/api/floors/${a.slug}/chat`, { text: 'hi' })).status, 423);
    assert.equal((await adm.post(`/api/admin/floors/${row.id}/unsuspend`, {})).status, 200);
    assert.equal((await new Client(t).raw('GET', `/f/${a.slug}/${p.slug}/`)).status, 200);
  });
  test('reset wipes work but keeps the owner; kill frees the floor', async () => {
    const a = await claim(t, 'Resetme');
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build site' });
    await waitDone(a);
    const row = (await adm.get('/api/admin/overview')).data.floors.find((f) => f.slug === a.slug);
    await adm.post(`/api/admin/floors/${row.id}/reset`, {});
    const s = await floorState(a);
    assert.equal(s.tasks.length, 0); assert.equal(s.projects.length, 0); assert.equal(s.viewer.owner, true);
    await adm.post(`/api/admin/floors/${row.id}/kill`, {});
    assert.equal((await new Client(t).get(`/api/floors/${a.slug}`)).status, 404);
    assert.equal((await a.get('/api/me')).data.floor, null);
    assert.equal((await adm.post(`/api/admin/floors/${row.id}/nonsense`, {})).status, 404);
  });
  test('global pause stops all floors from working', async () => {
    const a = await claim(t, 'Paused By Global');
    await adm.post('/api/admin/pause', { on: true });
    await a.post(`/api/floors/${a.slug}/chat`, { text: 'hello' });
    await sleep(150);
    const s = await floorState(a);
    assert.equal(s.floor.globalPause, true); assert.equal(s.messages.at(-1).text, 'hello');
    await adm.post('/api/admin/pause', { on: false });
    await until(async () => (await floorState(a)).messages.at(-1).text.includes('Three angles'), { what: 'unpause' });
  });
  test('wrong password and no session are refused', async () => {
    assert.equal((await new Client(t).post('/api/admin/login', { password: 'nope' })).status, 401);
    assert.equal((await new Client(t).get('/api/admin/overview')).status, 401);
  });
});
