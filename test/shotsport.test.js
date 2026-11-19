// The browser's port (redesign job 31). On the server the headless shell ignores --remote-debugging-address and listens on 127.0.0.1:9222 only, so
// docker-compose.yml starts a node forwarder on 0.0.0.0:9223 in the same container. These tests run the exact forwarder and healthcheck text from
// docker-compose.yml (on spare ports, through FWD_LISTEN / FWD_TARGET), against a real headless shell when this machine has one, else a stand-in.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { until, sleep } from './helpers.js';
import { cdpPage } from '../server/cdp.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');
const stop = [];
after(async () => { for (const s of stop.reverse()) await s(); });

/** A folded block (`>-`) from the compose file, as YAML reads it: its lines joined with spaces. */
function folded(after) {
  const lines = COMPOSE.slice(COMPOSE.indexOf(after)).split('\n');
  const start = lines.findIndex((l) => /^\s*- >-\s*$/.test(l));
  const indent = lines[start + 1].match(/^\s*/)[0].length;
  const body = [];
  for (const l of lines.slice(start + 1)) { if (l.trim() && l.match(/^\s*/)[0].length < indent) break; body.push(l.trim()); }
  return body.join(' ');
}
const service = COMPOSE.slice(COMPOSE.indexOf('\n  shots:\n'));
const command = folded('\n  shots:\n');
const forwarder = command.match(/node -e "(.*?)" &/)[1];
const healthcheck = folded('    healthcheck:');
const ip = Object.values(networkInterfaces()).flat().find((a) => a.family === 'IPv4' && !a.internal)?.address;
const port = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

function startForwarder(listen, target) {
  const p = spawn(process.execPath, ['-e', forwarder], { env: { PATH: process.env.PATH, FWD_LISTEN: String(listen), FWD_TARGET: String(target) }, stdio: ['ignore', 'ignore', 'pipe'] });
  let said = ''; p.stderr.on('data', (d) => { said += d; });
  stop.push(async () => { p.kill(); await sleep(50); });
  return { proc: p, said: () => said };
}
const health = (listen) => spawnSync(process.execPath, ['-e', healthcheck], { env: { PATH: process.env.PATH, FWD_LISTEN: String(listen) }, timeout: 10000 }).status;

describe('the browser\'s port in docker-compose.yml', () => {
  test('the Office is pointed at the forwarder; only 9223 is exposed; the browser keeps to loopback; every hardening line is still there', () => {
    assert.match(COMPOSE, /SHOTS_CDP_URL: http:\/\/shots:9223\n/);
    assert.match(COMPOSE, /SHOTS_ORIGIN: http:\/\/theoffice:8083\n/);
    assert.match(COMPOSE, /extra_hosts:\n\s+- "buddehbot-mac\.tail2f5032\.ts\.net:100\.123\.213\.72"/, 'the tailnet gateway stays');
    assert.match(service, /expose:\n\s+- "9223"\n/); assert.doesNotMatch(service, /\n\s+ports:/); assert.doesNotMatch(service, /network_mode:\s*host/);
    assert.doesNotMatch(command, /--remote-debugging-address/, 'the shell ignores it; only the forwarder is reachable from outside');
    assert.match(command, /--remote-debugging-port=9222 /); assert.match(command, /& exec "\$\$B" --no-sandbox/);
    for (const line of ['image: office-runner/browser:pw1.65.0', 'restart: unless-stopped', 'init: true', 'user: "10001:10001"', 'read_only: true', '- /tmp:size=256m,nosuid,nodev', '- no-new-privileges:true', 'cap_drop:\n      - ALL', 'mem_limit: 600m', 'pids_limit: 256', 'max-size: 10m', 'max-file: "3"']) assert.ok(service.includes(line), line);
    assert.match(healthcheck, /!a\.internal/, 'the healthcheck uses the container\'s own network address, not loopback');
    assert.match(healthcheck, /\|\| 9223\)/);
  });

  test('through the forwarder, on a non-loopback address, the browser is reachable and cdpPage works; the healthcheck passes, and fails without the forwarder', async (t) => {
    if (!ip) { t.skip('no non-loopback address here'); return; }
    const roots = ['/opt/pw-browsers', '/ms-playwright', join(process.env.HOME || '/root', '.cache/ms-playwright')].filter(existsSync);
    const bin = roots.flatMap((r) => readdirSync(r).filter((d) => d.startsWith('chromium_headless_shell-')).map((d) => join(r, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'))).find(existsSync);
    const target = await port(), listen = await port();
    let real = false;
    if (bin) {
      const profile = mkdtempSync(join(tmpdir(), 'shotsport-'));
      // As on the server: debugging on loopback only.
      const chrome = spawn(bin, ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', `--remote-debugging-port=${target}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
      stop.push(async () => { chrome.kill(); await sleep(200); rmSync(profile, { recursive: true, force: true }); });
      await until(async () => { try { return (await fetch(`http://127.0.0.1:${target}/json/version`)).ok; } catch { return false; } }, { what: 'Chromium', timeout: 15000 });
      real = true;
    } else {
      // A stand-in that answers like Chrome's endpoint, on loopback only.
      const s = createServer((q, r) => r.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ Browser: 'stand-in', webSocketDebuggerUrl: `ws://${q.headers.host}/devtools/browser/x` })));
      await new Promise((r) => s.listen(target, '127.0.0.1', r));
      stop.push(() => new Promise((r) => s.close(r)));
    }
    await assert.rejects(fetch(`http://${ip}:${target}/json/version`, { signal: AbortSignal.timeout(2000) }), 'the browser itself is not reachable off loopback, as on the server');
    assert.equal(health(listen), 1, 'no forwarder: unhealthy');
    const fwd = startForwarder(listen, target);
    await until(() => /shots forwarder: 0\.0\.0\.0:\d+ -> 127\.0\.0\.1:\d+/.test(fwd.said()), { what: 'the forwarder' });
    const v = await (await fetch(`http://${ip}:${listen}/json/version`)).json();
    assert.ok(v.webSocketDebuggerUrl);
    assert.equal(health(listen), 0, 'healthy through the forwarder on the container\'s own address');
    if (real) {
      const page = createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(q.url === '/bad' ? '<h1>x</h1><script>window.nope.go()</script>' : '<h1>Fine</h1>'); });
      await new Promise((r) => page.listen(0, '0.0.0.0', r));
      stop.push(() => new Promise((r) => page.close(r)));
      // By name, the way the Office calls it (SHOTS_CDP_URL=http://shots:9223): looked up to the address, the debugger URL's host rewritten to it.
      const byName = { resolve: async (h) => { assert.equal(h, 'shots'); return { address: ip, family: 4 }; } };
      const ok = await cdpPage(`http://shots:${listen}`, `http://127.0.0.1:${page.address().port}/ok`, byName);
      assert.equal(ok.ok, true); assert.equal(ok.status, 200); assert.equal(ok.shot?.[0], 0xff, 'a JPEG came back through the forwarder');
      const bad = await cdpPage(`http://shots:${listen}`, `http://127.0.0.1:${page.address().port}/bad`, byName);
      assert.equal(bad.ok, false); assert.match(bad.errors.join(' '), /reading 'go'/);
    }
    fwd.proc.kill(); await sleep(100);
    assert.equal(health(listen), 1, 'forwarder gone: unhealthy again');
  });

  test('a forwarder that can\'t listen says so and exits, and takes the browser down with it so the container restarts', async () => {
    const busy = createServer(); await new Promise((r) => busy.listen(0, '0.0.0.0', r));
    stop.push(() => new Promise((r) => busy.close(r)));
    // Its parent here is a throwaway shell standing in for the browser it would kill.
    const sh = spawn('/bin/sh', ['-c', 'node -e "$FWD" & wait'], { env: { PATH: process.env.PATH, FWD: forwarder, FWD_LISTEN: String(busy.address().port), FWD_TARGET: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    let said = ''; sh.stderr.on('data', (d) => { said += d; });
    const code = await new Promise((r) => sh.on('exit', (c, sig) => r(sig || c)));
    assert.match(said, /shots forwarder: listen EADDRINUSE/);
    assert.equal(code, 'SIGKILL', 'the parent (the browser on the server) was killed');
  });
});
