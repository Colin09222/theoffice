// The real process, the real CLI and the real database file: what the container will actually run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../server/config.js';
import { until } from './helpers.js';

const CLI = join(ROOT, 'scripts/admin.mjs');
test('server boots, the admin CLI issues working codes, and logs stay clean', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-boot-'));
  const port = 18000 + Math.floor(Math.random() * 2000);
  const env = { PATH: process.env.PATH, NODE_NO_WARNINGS: '1', DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', AI_MODE: 'mock', MOCK_DELAY_MS: '1', ADMIN_PASSWORD: 'cli-test-password', OPENROUTER_API_KEY: 'sk-or-v1-NEVERLOGME' };
  const proc = spawn(process.execPath, [join(ROOT, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
  try {
    const base = `http://127.0.0.1:${port}/theoffice`;
    await until(async () => (await fetch(`${base}/robots.txt`).catch(() => null))?.ok, { what: 'server to start' });
    const code = execFileSync(process.execPath, [CLI, 'code', '--floor', '7'], { env, encoding: 'utf8' }).trim();
    assert.match(code, /^OFFICE-[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    const headers = { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` };
    const res = await fetch(`${base}/api/claim`, { method: 'POST', headers, body: JSON.stringify({ code, name: 'CLI Co', bossName: 'Cleo' }) });
    assert.equal(res.status, 201);
    const j = await res.json();
    assert.equal(j.number, 7);
    assert.match(execFileSync(process.execPath, [CLI, 'floors'], { env, encoding: 'utf8' }), /cli-co/);
    assert.throws(() => execFileSync(process.execPath, [CLI, 'code', '--floor', '7'], { env, stdio: 'pipe' }), /already taken/);
    assert.throws(() => execFileSync(process.execPath, [CLI, 'code', '--floor', 'abc'], { env, stdio: 'pipe' }));
    const reuse = await fetch(`${base}/api/claim`, { method: 'POST', headers, body: JSON.stringify({ code, name: 'Again', bossName: 'X' }) });
    assert.equal(reuse.status, 404);
    for (const secret of [code, 'NEVERLOGME', 'cli-test-password', j.recoveryCode, j.csrf]) assert.ok(!out.includes(secret), `log leaked ${secret.slice(0, 6)}`);
    assert.ok(statSync(join(dir, 'office.db')).size > 0);
    const exit = new Promise((r) => proc.on('exit', r));
    proc.kill('SIGTERM');
    assert.equal(await exit, 0);
    // And everything survives a restart.
    const again = spawn(process.execPath, [join(ROOT, 'server/index.js')], { env, stdio: 'ignore' });
    await until(async () => (await fetch(`${base}/api/floors/cli-co`).catch(() => null))?.status === 200, { what: 'restart' });
    const ex2 = new Promise((r) => again.on('exit', r)); again.kill('SIGTERM'); await ex2;
  } finally {
    proc.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
