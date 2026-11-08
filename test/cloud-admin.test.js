// The building manager's Office Cloud commands, run the way they are on the server: a separate process on the same database file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { openDb, run, get } from '../server/db.js';
import { createStore } from '../server/cloud/store.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = (dir, ...args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'scripts/admin.mjs'), ...args], { env: { ...process.env, DATA_DIR: dir, AI_MODE: 'mock' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; }
};

test('backend usage, export and wipe from the command line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-cloud-'));
  try {
    const db = openDb(dir);
    const at = Date.now();
    run(db, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at) VALUES ('acme',3,'Acme','{}','{}','{}','x',?)", at);
    const f = get(db, "SELECT id FROM floors WHERE slug='acme'").id;
    const store = createStore(db);
    const who = { kind: 'guest', key: 'g:abc', name: '' };
    const user = store.users.create(f, 'space-game', store.users.validate({ username: 'pilot', email: 'p@example.com', password: 'correct horse' }), 's1$16384$8$1$c2FsdA==$a2V5');
    store.docs.add(f, 'space-game', who, 'ships', { name: 'Comet' });
    store.saves.put(f, 'space-game', who, 'slot', { level: 2 });
    store.scores.submit(f, 'space-game', who, 'high', 42, { name: 'Ace' });
    store.files.put(f, 'space-game', who, { name: 'p.png', body: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]) });
    store.docs.add(f, 'other', who, 'notes', { keep: true });
    db.close();

    const usage = cli(dir, 'backend', 'usage');
    assert.equal(usage.code, 0, usage.out);
    assert.match(usage.out, /floor 3 space-game: 1 accounts, 1 documents in 1 collections, 1 saves, 1 scores on 1 boards, 1 files/);
    assert.doesNotMatch(usage.out, /pilot|Comet|s1\$|\$\d/);
    const json = JSON.parse(cli(dir, 'backend', 'usage', '--json').out);
    assert.equal(json.find((r) => r.project === 'space-game').users, 1);

    const out = join(dir, 'export.json');
    assert.equal(cli(dir, 'backend', 'export', '--floor', '3', '--project', 'space-game', '--files', '--out', out).code, 0);
    const dump = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(dump.users[0].username, 'pilot'); assert.equal(dump.docs[0].data.name, 'Comet'); assert.equal(dump.saves[0].value.level, 2);
    assert.equal(dump.scores[0].score, 42); assert.equal(dump.files[0].type, 'image/png'); assert.ok(dump.files[0].base64.length > 40);
    assert.doesNotMatch(JSON.stringify(dump), /s1\$|"hash"|c2FsdA|session/);
    assert.ok(user.uid);

    assert.equal(cli(dir, 'backend', 'wipe', '--floor', '3', '--project', 'space-game').code, 1, 'a wipe needs --yes');
    assert.notEqual(cli(dir, 'backend', 'wipe', '--floor', '3', '--project', '../x', '--yes').code, 0);
    assert.notEqual(cli(dir, 'backend', 'wipe', '--floor', '9', '--project', 'space-game', '--yes').code, 0, 'no company on floor 9');
    const wiped = cli(dir, 'backend', 'wipe', '--floor', '3', '--project', 'space-game', '--yes');
    assert.equal(wiped.code, 0, wiped.out); assert.match(wiped.out, /Wiped space-game on floor 3/);
    const after = openDb(dir);
    for (const t of ['cloud_users', 'cloud_docs', 'cloud_saves', 'cloud_scores', 'cloud_files', 'cloud_file_chunks', 'cloud_usage']) {
      assert.equal(get(after, `SELECT COUNT(*) n FROM ${t} WHERE project='space-game'`).n, 0, t);
    }
    assert.equal(get(after, "SELECT COUNT(*) n FROM cloud_docs WHERE project='other'").n, 1, 'the other project is untouched');
    after.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cloud ai and cloud fetch: status, pause and resume from the command line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-powers-'));
  try {
    const db = openDb(dir);
    const at = Date.now();
    run(db, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at) VALUES ('acme',3,'Acme','{}','{}','{}','x',?)", at);
    run(db, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at) VALUES ('bravo',5,'Bravo','{}','{}','{}','x',?)", at);
    const f = get(db, "SELECT id FROM floors WHERE slug='acme'").id, g = get(db, "SELECT id FROM floors WHERE slug='bravo'").id;
    for (const id of [f, g]) run(db, "INSERT INTO projects (floor_id,slug,title,published_at,created_at) VALUES (?,'space-game','Space',?,?)", id, at, at);
    run(db, "INSERT INTO app_labels (label,floor_id,project,created_at) VALUES ('space-game--acme',?,'space-game',?)", f, at);
    run(db, "INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at,kind,provider) VALUES (?,?,NULL,'claude-haiku-5-5',10,10,0.5,?,'app_ai','anthropic')", f, new Date().toISOString().slice(0, 10), at);
    db.close();

    const first = cli(dir, 'cloud', 'ai', 'status');
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /AI for published apps: on/);
    assert.match(first.out, /25% of the building's daily ceiling/, 'a share of the ceiling, not an amount');
    assert.doesNotMatch(first.out, /\$\d|\busd\b/i);

    assert.equal(cli(dir, 'cloud', 'ai', 'pause', 'space-game').code, 1, 'two floors have one called that');
    assert.match(cli(dir, 'cloud', 'ai', 'pause', 'nothing-here', '--floor', '3').out, /No project called nothing-here/);
    assert.match(cli(dir, 'cloud', 'ai', 'pause', 'space-game', '--floor', '3').out, /AI paused for floor 3 space-game/);
    const paused = JSON.parse(cli(dir, 'cloud', 'ai', 'status', 'space-game--acme', '--json').out);
    assert.equal(paused.projects[0].paused, true); assert.equal(paused.projects[0].fastLeft, 150000);
    assert.match(cli(dir, 'cloud', 'ai', 'status').out, /floor 3 space-game: PAUSED/);
    assert.match(cli(dir, 'cloud', 'ai', 'resume', 'space-game--acme').out, /AI back on for floor 3 space-game/);
    assert.equal(JSON.parse(cli(dir, 'cloud', 'ai', 'status', 'space-game--acme', '--json').out).projects[0].paused, false);

    assert.match(cli(dir, 'cloud', 'fetch', 'pause', 'space-game', '--floor', '5').out, /Web fetching paused for floor 5 space-game/);
    assert.match(cli(dir, 'cloud', 'fetch', 'status').out, /floor 5 space-game: PAUSED, 0 pages today, 500 left/);
    assert.match(cli(dir, 'cloud', 'fetch', 'pause', '--all').out, /paused for the whole building/);
    assert.equal(JSON.parse(cli(dir, 'cloud', 'fetch', 'status', '--json').out).buildingPaused, true);
    assert.match(cli(dir, 'cloud', 'fetch', 'resume', '--all').out, /back on for the whole building/);
    assert.equal(cli(dir, 'cloud', 'nonsense', 'status').code, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
