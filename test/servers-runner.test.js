// The Office against the real runner daemon (runner/src/control.mjs, with Docker and the host stubbed): the two halves agree on the API, not just on the tests' idea of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { get } from '../server/db.js';
import { writeFile } from '../server/workspace.js';
import { toolsForRole } from '../server/tools.js';
import { boot, claim, until } from './helpers.js';
import { BASE } from './cloud-helpers.js';
import { loadConfig as runnerConfig } from '../runner/src/config.mjs';
import { createControl } from '../runner/src/control.mjs';
import { setLogSink } from '../runner/src/util.mjs';

class Docker {
  constructor(base) { this.c = new Map(); this.images = new Set(base); }
  async inspect(n) { return this.c.has(n) ? structuredClone(this.c.get(n)) : null; }
  async list() { return [...this.c.values()].map((x) => ({ Id: x.Name })); }
  async create(n, spec) { this.c.set(n, { Name: n, Config: { Labels: spec.Labels, Env: spec.Env ?? [] }, Spec: spec, State: { Running: false, ExitCode: 0 } }); }
  async start(n) { this.c.get(n).State.Running = true; }
  async stop(n) { if (this.c.has(n)) this.c.get(n).State.Running = false; }
  async kill(n) { if (this.c.has(n)) this.c.get(n).State.Running = false; }
  async remove(n) { this.c.delete(n); }
  async wait(n) { this.c.get(n).State.Running = false; return { StatusCode: this.failing ? 1 : 0 }; }
  async putArchive() {}
  async commit(n, repo, tag) { this.images.add(`${repo}:${tag}`); }
  async removeImage(ref) { this.images.delete(ref); }
  async imageExists(ref) { return this.images.has(ref); }
  async logs(n) { return n.startsWith('office-build-') ? (this.failing ? 'npm ERR! 404 no-such-package\n' : 'added 1 package\nBUILD-OK\n') : 'listening on 8080\n'; }
  async exec() { return { exitCode: 0, timedOut: false, output: 'ok\n' }; }
}

test('deploy, status, settings, restart, logs and delete, through the real API', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-real-'));
  setLogSink(() => {});
  const rcfg = runnerConfig({ file: '/nonexistent', env: {}, overrides: { ROOT: root, WAKE_TIMEOUT_S: 2 } });
  for (const d of [rcfg.paths.state, rcfg.paths.appSecrets, rcfg.paths.logs]) fs.mkdirSync(d, { recursive: true });
  const API = 'a'.repeat(40);
  const docker = new Docker([rcfg.BASE_STANDARD, rcfg.BASE_BROWSER]);
  const ctl = createControl({ cfg: rcfg, docker, sys: { ensureVolume: async () => {}, dropVolume: async () => {}, firewallReady: async () => true }, tokens: { api: API, edge: 'e'.repeat(40) }, now: () => Date.now(), probe: async () => true });
  const srv = ctl.server();
  const socketPath = path.join(root, 'runner.sock'), tokenFile = path.join(root, 'api.token');
  fs.writeFileSync(tokenFile, `${API}\n`);
  await new Promise((r) => srv.listen(socketPath, r));
  const t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', anthropicKey: 'sk-ant-api03-building-secret-value', runnerSocket: socketPath, runnerTokenFile: tokenFile, runnerTickMs: 15, runnerPollMs: 2, runnerBuildWaitMs: 3000 });
  try {
    const boss = await claim(t, 'Real Co');
    const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
    for (const [p, c] of Object.entries({ 'server.js': 'require("http").createServer((q,s)=>s.end("ok")).listen(8080)', 'package.json': '{"name":"x","private":true,"scripts":{"start":"node server.js"}}', 'office.json': '{"cron":[{"name":"tick","schedule":"*/30 * * * *","run":"node t.js"}]}' })) writeFile(t.db, floor.id, `projects/shop/server/${p}`, c, null, 1e8);
    const agent = { ...get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='builder'", floor.id), role: 'builder' };
    const tool = (n, a) => t.app.engine.tools.exec({ allowed: toolsForRole('builder'), floor, agent, task: null, project: 'shop', say: () => {} }, n, JSON.stringify(a));
    const post = (a, b = {}) => boss.post(`/api/floors/${boss.slug}/servers/shop/${a}`, b);
    assert.match(await tool('deploy_server', { project: 'shop', why: 'schedule' }), /Asked/);
    const slots = (await boss.get(`/api/floors/${boss.slug}/servers`)).data.slots;
    assert.deepEqual(slots, { used: 0, max: 4, browserUsed: 0, browserMax: 2, killed: false });
    assert.equal((await post('approve')).status, 200);
    const label = get(t.db, 'SELECT label FROM server_apps').label;
    await until(() => ctl.state().apps[label]?.build?.status === 'ok' && !get(t.db, 'SELECT building x FROM server_apps').x, { what: 'the build' });
    let v = (await boss.get(`/api/floors/${boss.slug}/servers`)).data.servers[0];
    assert.equal(v.status, 'sleeping'); assert.equal(v.cron[0].schedule, '*/30 * * * *');
    assert.equal(v.tier, 'standard'); assert.equal(v.build.status, 'ok');
    assert.deepEqual(v.env, []);
    const secretsFile = JSON.parse(fs.readFileSync(path.join(rcfg.paths.appSecrets, `${label}.json`), 'utf8'));
    assert.match(secretsFile.OFFICE_TOKEN, /^ofs_/);
    assert.equal((await post('env', { set: { MY_KEY: 'value-of-mine-12345' } })).data.names[0], 'MY_KEY');
    assert.deepEqual((await boss.get(`/api/floors/${boss.slug}/servers`)).data.servers[0].env, ['MY_KEY']);
    assert.equal((await post('restart')).data.status, 'running');
    assert.equal((await post('stop')).data.status, 'stopped');
    assert.equal((await post('start')).data.status, 'running');
    const logs = (await boss.get(`/api/floors/${boss.slug}/servers/shop/logs`)).data;
    assert.match(logs.logs, /listening/); assert.match(logs.build, /BUILD-OK/);
    assert.match(await tool('server_status', { project: 'shop' }), /running, standard tier/);
    // A real build failure, through the real API: the Builder reads what npm said.
    docker.failing = true;
    const failed = await tool('deploy_server', { project: 'shop', why: 'update' });
    assert.match(failed, /was not deployed/); assert.match(failed, /no-such-package/);
    docker.failing = false;
    assert.match(await tool('deploy_server', { project: 'shop', why: 'fixed' }), /^Built/);
    assert.equal((await post('delete')).status, 200);
    assert.equal(ctl.state().apps[label], undefined);
    assert.equal((await boss.get(`/api/floors/${boss.slug}/servers`)).data.servers.length, 0);
  } finally { await t.close(); await new Promise((r) => { srv.close(() => r()); srv.closeAllConnections?.(); }); setLogSink(null); fs.rmSync(root, { recursive: true, force: true }); }
});
