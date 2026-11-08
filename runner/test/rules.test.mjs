import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as A from '../src/apps.mjs';
import { loadConfig } from '../src/config.mjs';
import { cronMatches, parseCron } from '../src/cron.mjs';
import { isPublicV4 } from '../src/edge.mjs';
import { makeTar } from '../src/tar.mjs';

const cfg = loadConfig({ file: '/nonexistent/runner.json', env: {} });
const b64 = (s) => Buffer.from(s).toString('base64');

test('config: MAX_APPS defaults to 4 and an env var raises it', () => {
  assert.equal(cfg.MAX_APPS, 4);
  assert.equal(cfg.MAX_BROWSER_APPS, 2);
  assert.equal(loadConfig({ file: '/nonexistent', env: { MAX_APPS: '6' } }).MAX_APPS, 6);
});

test('cron: parses, matches in UTC, refuses schedules tighter than 5 minutes', () => {
  const c = parseCron('*/15 9-17 * * 1-5');
  assert.ok(cronMatches(c, new Date('2026-11-09T09:30:00Z'))); // Monday
  assert.ok(!cronMatches(c, new Date('2026-11-08T09:30:00Z'))); // Sunday
  assert.ok(!cronMatches(c, new Date('2026-11-09T09:31:00Z')));
  assert.ok(cronMatches(parseCron('@daily'), new Date('2026-11-09T00:00:00Z')));
  assert.ok(cronMatches(parseCron('0 0 * * 7'), new Date('2026-11-08T00:00:00Z')));
  assert.throws(() => parseCron('* * * * *'), /every 5 minutes/);
  assert.throws(() => parseCron('*/2 * * * *'), /every 5 minutes/);
  assert.throws(() => parseCron('0 0 * *'), /5 fields/);
  assert.throws(() => parseCron('61 * * * *'), /bad cron/);
  assert.doesNotThrow(() => parseCron('5 * * * *'));
});

test('labels and hosts', () => {
  for (const ok of ['a', 'my-app', 'x1', 'a'.repeat(40)]) assert.ok(A.validLabel(ok), ok);
  for (const bad of ['', '-a', 'a-', 'a--b', 'A', 'a.b', 'a'.repeat(41), 'a_b']) assert.ok(!A.validLabel(bad), bad);
  assert.equal(A.hostLabel('api--my-app.middistance.com', cfg), 'my-app');
  assert.equal(A.hostLabel('API--My-App.middistance.com:443', cfg), 'my-app');
  assert.equal(A.hostLabel('my-app.middistance.com', cfg), null);
  assert.equal(A.hostLabel('api--x.middistance.com.evil.com', cfg), null);
  assert.equal(A.hostLabel('api--a--b.middistance.com', cfg), null);
});

test('files: no traversal, no absolute paths, size limits', () => {
  const ok = A.checkFiles([{ path: 'server.js', data: b64('x') }, { path: 'lib/a.js', data: 'y', encoding: 'utf8' }], cfg);
  assert.equal(ok.length, 2);
  for (const p of ['../x', '/etc/passwd', 'a/../../b', 'a//b', './a', 'a\\b', '', 'a/.']) {
    assert.throws(() => A.checkFiles([{ path: p, data: '' }], cfg), /path/i, p);
  }
  assert.throws(() => A.checkFiles([{ path: 'a', data: '' }, { path: 'a', data: '' }], cfg), /twice/);
  assert.throws(() => A.checkFiles([{ path: 'a', data: '' }, { path: 'a/b', data: '' }], cfg), /file and a folder/);
  const small = { ...cfg, MAX_UPLOAD_MB: 0.001 };
  assert.throws(() => A.checkFiles([{ path: 'a', data: b64('x'.repeat(2000)) }], small), /MB/);
});

test('manifest: start command, tier and jobs', () => {
  const files = (o) => Object.entries(o).map(([p, v]) => ({ path: p, data: Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)) }));
  assert.equal(A.readManifest(files({ 'server.js': '' }), undefined, cfg).start, 'node server.js');
  assert.equal(A.readManifest(files({ 'package.json': { scripts: { start: 'node x.js' } } }), undefined, cfg).start, 'npm start');
  assert.equal(A.readManifest(files({ 'package.json': { main: 'lib/m.js' }, 'lib/m.js': '' }), undefined, cfg).start, 'node lib/m.js');
  const m = A.readManifest(files({ 'office.json': { tier: 'browser', start: 'node a.js', cron: [{ name: 'scrape', schedule: '*/30 * * * *', run: 'node job.js' }] } }), undefined, cfg);
  assert.equal(m.tier, 'browser');
  assert.equal(m.cron[0].timeoutMinutes, cfg.JOB_TIMEOUT_MIN);
  assert.throws(() => A.readManifest(files({ 'a.txt': '' }), undefined, cfg), /No way to start/);
  assert.throws(() => A.readManifest(files({ 'office.json': { start: 'node a.js\nrm -rf /' } }), undefined, cfg), /one-line/);
  assert.throws(() => A.readManifest(files({ 'server.js': '' }), 'gpu', cfg), /tier/);
  assert.throws(() => A.readManifest(files({ 'office.json': { start: 'x', cron: [{ name: 'a', schedule: '* * * * *', run: 'x' }] } }), undefined, cfg), /5 minutes/);
});

test('capacity: a 5th app is refused, and a 3rd browser app', () => {
  const apps = {};
  for (const l of ['a', 'b', 'c', 'd']) {
    A.checkCapacity(apps, l, l < 'c' ? 'browser' : 'standard', cfg);
    apps[l] = { label: l, tier: l < 'c' ? 'browser' : 'standard', ip: A.allocateIp(apps, cfg) };
  }
  assert.deepEqual(Object.values(apps).map((a) => a.ip), ['172.30.0.10', '172.30.0.11', '172.30.0.12', '172.30.0.13']);
  assert.throws(() => A.checkCapacity(apps, 'e', 'standard', cfg), (e) => e.status === 409 && e.code === 'capacity' && /4 of 4/.test(e.message));
  assert.doesNotThrow(() => A.checkCapacity(apps, 'd', 'standard', cfg)); // redeploying an existing app is fine
  assert.throws(() => A.checkCapacity(apps, 'd', 'browser', cfg), (e) => e.code === 'browser_capacity');
});

test('secrets: names checked, reserved names and the building keys refused', () => {
  assert.doesNotThrow(() => A.checkSecrets({ API_KEY: 'x' }));
  assert.throws(() => A.checkSecrets({ lower: 'x' }), /UPPER_SNAKE/);
  assert.throws(() => A.checkSecrets({ PORT: '1' }), /set by the runner/);
  assert.throws(() => A.checkSecrets({ K: 'x'.repeat(5000) }), /4 KB/);
  const forbidden = new Set([crypto.createHash('sha256').update('sk-building-key').digest('hex')]);
  assert.throws(() => A.checkSecrets({ OPENAI_API_KEY: 'sk-building-key' }, forbidden), (e) => e.code === 'forbidden_secret' && !e.message.includes('sk-building-key'));
});

test('egress proxy refuses private addresses', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.1.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1']) assert.ok(!isPublicV4(ip), ip);
  for (const ip of ['1.1.1.1', '104.16.0.1', '2.29.59.122', '172.32.0.1']) assert.ok(isPublicV4(ip), ip);
});

test('tar: system tar reads it back with owners and long paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-tar-'));
  const long = 'deep/' + 'd'.repeat(90) + '/' + 'f'.repeat(90) + '.js';
  const t = makeTar([
    { path: 'app', type: 'dir', uid: 10001, gid: 10001 },
    { path: 'app/server.js', type: 'file', data: Buffer.from('hello'), uid: 10001, gid: 10001 },
    { path: `app/${long}`, type: 'file', data: Buffer.from('x'.repeat(700)), uid: 10001, gid: 10001 },
  ]);
  fs.writeFileSync(path.join(dir, 't.tar'), t);
  const listing = execFileSync('tar', ['-tvnf', path.join(dir, 't.tar')], { encoding: 'utf8' });
  assert.match(listing, /10001\s+10001.*app\/server\.js/);
  assert.ok(listing.includes(long));
  fs.mkdirSync(path.join(dir, 'x'));
  execFileSync('tar', ['-xf', path.join(dir, 't.tar'), '-C', path.join(dir, 'x')]);
  assert.equal(fs.readFileSync(path.join(dir, 'x/app/server.js'), 'utf8'), 'hello');
  assert.equal(fs.readFileSync(path.join(dir, 'x/app', long), 'utf8').length, 700);
  fs.rmSync(dir, { recursive: true });
});
