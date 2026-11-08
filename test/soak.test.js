// Soak: 50 floors, many rounds of ticks, viewers coming and going. It passes only with no errors, no stuck work, no leaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, Client, claim, floorState, until, sse, sleep, allDone } from './helpers.js';

test('50 floors through repeated rounds with no errors or leaks', { timeout: 300000 }, async () => {
  // The mock prices its long prompts as real tokens, so 50 floors would hit the real building cap; that isn't what this measures.
  const t = await boot({ mockDelayMs: 1, globalDailyUsd: 1000, towerFloors: 40 });
  t.cfg.mockDelayMs = 1;
  const floors = [];
  for (let i = 0; i < 40; i++) floors.push(await claim(t, `Soak ${i}`));
  // The tower is 40 floors. A bigger building proves the 50.
  t.cfg.towerFloors = 60;
  for (let i = 40; i < 50; i++) floors.push(await claim(t, `Soak ${i}`));
  assert.equal(new Set(floors.map((f) => f.number)).size, 50);

  const heap = []; let ticks = 0;
  const rounds = 4;
  for (let round = 0; round < rounds; round++) {
    const viewers = floors.filter((_, i) => i % 5 === round % 5).map((f) => sse(new Client(t), f.slug));
    await Promise.all(floors.map((f, i) => f.post(`/api/floors/${f.slug}/chat`, { text: i % 7 === 0 ? 'just thinking out loud' : `go build round ${round} thing ${i}${i % 3 === 0 ? ' [buy]' : ''}${i % 11 === 0 ? ' [hire]' : ''}` })));
    // Churn across the round: pause and resume some floors while they run.
    await sleep(5);
    await Promise.all(floors.filter((_, i) => i % 9 === 1).map(async (f) => { await f.post(`/api/floors/${f.slug}/control`, { action: 'pause' }); await sleep(2); await f.post(`/api/floors/${f.slug}/control`, { action: 'resume' }); }));
    await until(async () => { t.app.engine.tick(); ticks++; if (t.app.engine.runs.size) return false; const st = await Promise.all(floors.map((f) => floorState(f))); return st.every((s) => s.tasks.length === 0 || allDone(s)) && st.every((s) => !s.floor.paused); }, { timeout: 120000, every: 25, what: `round ${round} to settle` });
    await Promise.all(viewers.map((v) => v.close()));
    await until(() => t.app.bus.total === 0, { what: 'SSE cleanup' });
    global.gc?.();
    heap.push(process.memoryUsage().heapUsed);
  }
  const e = t.app.engine;
  assert.deepEqual(e.errors, [], 'engine errors');
  assert.deepEqual(t.logs.filter((l) => l.includes('"level":"error"')), [], 'error logs');
  assert.ok(ticks > 0);
  assert.equal(e.runs.size, 0); assert.equal(e.limiter.active, 0); assert.equal(e.limiter.queue.length, 0); assert.equal(e.limiter.floorActive.size, 0);
  assert.equal(e.reserved.size, 0, 'budget reservations released'); assert.ok(e.reservedTotal < 1e-9);
  assert.ok(e.limiter.peak <= 6); assert.ok(e.limiter.peakFloor <= 3);
  assert.equal(t.app.bus.total, 0); assert.equal(t.app.bus.floors.size, 0); assert.equal(t.app.bus.byIp.size, 0);
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM tasks WHERE status IN ('todo','doing','blocked','review')").get().n, 0, 'no stuck tasks');
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM floors WHERE manager_wake=1').get().n, 0);
  const done = t.db.prepare("SELECT COUNT(*) n FROM tasks WHERE status='done'").get().n;
  assert.ok(done >= 40 * rounds * 4, `only ${done} tasks done`);
  // Each floor's data stays its own.
  for (const f of floors) {
    const s = await floorState(f);
    for (const p of s.projects) assert.ok(s.files.some((x) => x.path.startsWith(`projects/${p.slug}/`)));
    assert.equal(s.floor.slug, f.slug);
  }
  const growth = heap.at(-1) - heap[0];
  console.log(`soak: ${done} tasks, ${ticks} polling ticks, heap ${heap.map((h) => Math.round(h / 1e6)).join(' -> ')} MB, rss ${Math.round(process.memoryUsage().rss / 1e6)} MB, peak LLM ${e.limiter.peak}`);
  assert.ok(growth < 60e6, `heap grew ${Math.round(growth / 1e6)} MB`);
  await t.close();
});
