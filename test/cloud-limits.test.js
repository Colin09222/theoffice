// One project's own Office Cloud limits, raised by the admin: they reach only that project, and with owners listed
// the per-owner ones (file size, files and bytes per owner, uploads an hour) reach only those accounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { openDb, get, run } from '../server/db.js';
import { createStore } from '../server/cloud/store.js';
import { boot, claim } from './helpers.js';
import { BASE, P2, publish, cloud, png } from './cloud-helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = (dir, ...args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'scripts/admin.mjs'), ...args], { env: { ...process.env, DATA_DIR: dir, AI_MODE: 'mock' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; }
};

test('a raised project takes bigger files, more of them and more uploads an hour; its guests, other projects and other floors keep the defaults', async () => {
  const t = await boot({
    appsBaseDomain: BASE, appsScheme: 'https', publicOrigin: 'https://main.test.example', trustProxy: true, cloudRateScale: 1,
    cloudLimits: { fileMax: 3000, fileBytes: 6000, filesPerOwner: 2, fileBytesPerOwner: 5000 },
    cloudRates: { upload: [3, 3600000], uploadProject: [100, 3600000] },
  });
  try {
    t.cfg.publicOrigin = '';
    const a = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'Alpha Co')).slug);
    const b = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'Beta Co')).slug);
    const photos = publish(t, a, 'photos'), other = publish(t, a, 'other'), theirs = publish(t, b, 'photos');
    const up = (host, size, opts = {}) => cloud(t, host, 'POST', 'files', { raw: png(size), type: 'image/png', ...opts });
    const from = (ip, more = {}) => ({ headers: { 'x-forwarded-for': ip }, ...more });

    const signup = (await cloud(t, photos, 'POST', 'auth/signup', { body: { username: 'shooter', password: 'correct horse' } })).json;
    const uid = signup.user.id;
    run(t.db, 'INSERT INTO cloud_limits (floor_id,project,limits,owners,updated_at) VALUES (?,?,?,?,?)', a.id, 'photos',
      JSON.stringify({ fileMax: 8000, fileBytes: 60000, filesPerOwner: 10, fileBytesPerOwner: 50000, uploadsPerHour: 8 }), JSON.stringify([`u:${uid}`]), Date.now());

    // The owner: past the default file size, file count, bytes and hourly uploads.
    for (let i = 0; i < 6; i++) assert.equal((await up(photos, 7000, from('1.1.1.1', { session: signup.session }))).status, 201, `owner upload ${i}`);
    assert.equal((await cloud(t, photos, 'GET', 'files', { session: signup.session })).json.files.length, 6, 'the list shows all of them');
    assert.equal((await up(photos, 9000, from('1.1.1.1', { session: signup.session }))).status, 413, 'the raised file size still holds');

    // A guest on the same project keeps the building's per-owner limits.
    assert.equal((await up(photos, 4000, from('2.2.2.2', { player: P2 }))).status, 413);
    assert.equal((await up(photos, 2000, from('2.2.2.2', { player: P2 }))).status, 201);
    assert.equal((await up(photos, 2000, from('2.2.2.2', { player: P2 }))).status, 201);
    const third = await up(photos, 2000, from('2.2.2.9', { player: P2 }));
    assert.equal(third.status, 507); assert.match(third.json.message, /your upload space/);
    for (let i = 0; i < 3; i++) await up(photos, 100, from('3.3.3.3', { player: 'z'.repeat(40) + i }));
    assert.equal((await up(photos, 100, from('3.3.3.3', { player: 'y'.repeat(40) }))).status, 429, 'guests keep the default hourly cap');

    // Another project on the same floor, and the same slug on another floor, are untouched.
    assert.equal((await up(other, 4000, from('4.4.4.4'))).status, 413);
    assert.equal((await up(theirs, 4000, from('5.5.5.5'))).status, 413);

    // With no owners listed, the raised limits reach everyone on that project.
    run(t.db, "UPDATE cloud_limits SET owners='[]' WHERE floor_id=? AND project='photos'", a.id);
    assert.equal((await up(photos, 7000, from('6.6.6.6', { player: 'x'.repeat(40) }))).status, 201);
  } finally { t.close(); }
});

test('cloud limits from the command line: set for named owners, show, list and clear', () => {
  const dir = mkdtempSync(join(tmpdir(), 'office-limits-'));
  try {
    const db = openDb(dir);
    run(db, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at) VALUES ('acme',3,'Acme','{}','{}','{}','x',?)", Date.now());
    const f = get(db, "SELECT id FROM floors WHERE slug='acme'").id;
    run(db, "INSERT INTO projects (floor_id,slug,title,kind,created_at) VALUES (?,'photos','Photos','site',?)", f, Date.now());
    const store = createStore(db);
    const user = store.users.create(f, 'photos', store.users.validate({ username: 'shooter', email: 'shoot@example.com', password: 'correct horse' }), 's1$16384$8$1$c2FsdA==$a2V5');
    db.close();

    assert.match(cli(dir, 'cloud', 'limits').out, /default limits/);
    assert.notEqual(cli(dir, 'cloud', 'limits', 'photos', '--floor', '3', '--owner', 'nobody').code, 0);
    assert.notEqual(cli(dir, 'cloud', 'limits', 'photos', '--floor', '3', '--file-max', '900MB').code, 0, 'a single file stays under 50 MB');
    const set = cli(dir, 'cloud', 'limits', 'photos', '--floor', '3', '--file-bytes', '1GB', '--file-max', '15MB', '--files-per-owner', '600', '--owner-bytes', '1GB', '--hourly-uploads', '150', '--owner', 'Shoot@Example.com');
    assert.equal(set.code, 0, set.out);
    assert.match(set.out, /floor 3 photos: fileBytes 1 GB \(default 50 MB\), fileMax 15 MB \(default 5 MB\) for shooter/);
    assert.doesNotMatch(set.out, /Note:/);
    const db2 = openDb(dir);
    const s2 = createStore(db2);
    const mine = s2.limitsFor(f, 'photos', { key: `u:${user.uid}` }), guest = s2.limitsFor(f, 'photos', { key: 'g:x' });
    assert.deepEqual([mine.fileBytes, mine.fileMax, mine.filesPerOwner, mine.fileBytesPerOwner, mine.uploadsPerHour], [1024 ** 3, 15 * 1024 ** 2, 600, 1024 ** 3, 150]);
    assert.deepEqual([guest.fileBytes, guest.fileMax, guest.filesPerOwner, guest.uploadsPerHour], [1024 ** 3, 5 * 1024 ** 2, 100, undefined]);
    assert.equal(s2.limitsFor(f, 'other', { key: `u:${user.uid}` }).fileBytes, 50 * 1024 ** 2);
    db2.close();

    assert.notEqual(cli(dir, 'cloud', 'limits', 'photos', '--floor', '3', '--files', 'off').code, 0, 'only the hourly caps can be off');
    assert.match(cli(dir, 'cloud', 'limits', 'photos', '--floor', '3', '--hourly-uploads', 'off', '--project-hourly-uploads', 'OFF').out, /uploadsPerHour off \(default 30\) for shooter.*projectUploadsPerHour off \(default 300\)/);
    const db3 = openDb(dir); const s3 = createStore(db3);
    const off = s3.limitsFor(f, 'photos', { key: `u:${user.uid}` }), guest3 = s3.limitsFor(f, 'photos', { key: 'g:x' });
    assert.deepEqual([off.uploadsPerHour, off.projectUploadsPerHour], [Infinity, Infinity]);
    assert.deepEqual([guest3.uploadsPerHour, guest3.projectUploadsPerHour], [undefined, undefined], 'with owners named, off reaches only them');
    db3.close();
    assert.match(cli(dir, 'cloud', 'limits', 'photos', '--floor', '3', '--files', '3000').out, /files 3000 \(default 2000\).*fileMax 15 MB/, 'a later change keeps the rest');
    assert.match(cli(dir, 'cloud', 'limits').out, /floor 3 photos: fileBytes 1 GB/);
    assert.match(cli(dir, 'cloud', 'limits', 'photos', '--floor', '3', '--clear').out, /back on the building's default limits/);
    assert.match(cli(dir, 'cloud', 'limits').out, /Every project uses the building's default limits/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an owner with the hourly caps off can upload past them; a guest on the same project still hits the default', async () => {
  const t = await boot({
    appsBaseDomain: BASE, appsScheme: 'https', publicOrigin: 'https://main.test.example', trustProxy: true, cloudRateScale: 1,
    cloudRates: { upload: [3, 3600000], uploadProject: [4, 3600000] },
  });
  try {
    t.cfg.publicOrigin = '';
    const a = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'Alpha Co')).slug);
    const photos = publish(t, a, 'photos');
    const up = (opts) => cloud(t, photos, 'POST', 'files', { raw: png(100), type: 'image/png', ...opts });
    const signup = (await cloud(t, photos, 'POST', 'auth/signup', { body: { username: 'shooter', password: 'correct horse' } })).json;
    run(t.db, 'INSERT INTO cloud_limits (floor_id,project,limits,owners,updated_at) VALUES (?,?,?,?,?)', a.id, 'photos',
      JSON.stringify({ uploadsPerHour: 'off', projectUploadsPerHour: 'off', filesPerOwner: 50, files: 100 }), JSON.stringify([`u:${signup.user.id}`]), Date.now());
    for (let i = 0; i < 8; i++) assert.equal((await up({ headers: { 'x-forwarded-for': '1.1.1.1' }, session: signup.session })).status, 201, `owner upload ${i}`);
    // The owner's uploads don't count against the project's hour; guests from many addresses still stop at the default.
    for (let i = 0; i < 4; i++) assert.equal((await up({ headers: { 'x-forwarded-for': `2.2.2.${i}` }, player: P2 })).status, 201, `guest upload ${i}`);
    assert.equal((await up({ headers: { 'x-forwarded-for': '2.2.2.9' }, player: P2 })).status, 429, 'the project-wide cap still holds for guests');
  } finally { t.close(); }
});
