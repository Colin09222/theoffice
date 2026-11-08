// Office Cloud in real Chrome: the starter game the builders get is published to its own origin, then played. It saves progress,
// signs up, posts scores, survives a reload, and two tabs meet in one multiplayer room. Then the boss looks at the counts.
// Runs on *.apps.localhost, a real secure context, in mock mode with no spend.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';
import { get, all } from '../../server/db.js';
import { writeFile, publishSnapshot } from '../../server/workspace.js';
import { appLabel } from '../../server/apps.js';
import { boot, claim } from '../helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(ok); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };

const PORT = 29600 + Math.floor(Math.random() * 300);
const t = await boot({ appsBaseDomain: `apps.localhost:${PORT}`, appsScheme: 'http' }, {});
await new Promise((r) => t.app.server.close(r));
await new Promise((r) => t.app.server.listen(PORT, '127.0.0.1', r));
const main = `http://localhost:${PORT}`;
t.cfg.publicOrigin = main;
t.base = `${main}/theoffice`; t.host = `localhost:${PORT}`;
const a = await claim(t, 'Cloud Co');
const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', a.slug);
const GAME = readFileSync(join(ROOT, 'server/app-client/examples/cloud-game.html'), 'utf8');
writeFile(t.db, floor.id, 'projects/stars/index.html', GAME, null, 1e8);
publishSnapshot(t.db, floor.id, 'stars', 1e8);
t.app.engine.upsertProject(floor, 'stars', { title: 'Star Catch', kind: 'game', published: true });
const origin = `http://${appLabel(t.db, floor, 'stars')}.apps.localhost:${PORT}`;
const rows = (sql) => all(t.db, sql, floor.id);

const b = await launch();
try {
  const p = await b.newPage({ width: 1100, height: 760 });
  await p.goto(`${origin}/`);
  await p.until('window.game && Office.connect().mode === "live"', 'the game and a live backend', 15000);
  check('the SDK loads from the project\'s own origin and finds the backend', await p.ev('typeof Office.connect === "function" && Office.connect().mode') === 'live');
  await p.until('document.querySelectorAll("#players li").length === 1', 'joining the room');

  // A guest plays a round: three stars, then the round ends.
  await p.ev('game.start(); game.catchStar(); game.catchStar(); game.catchStar(); game.end()');
  await p.until('game.state().played === 1 && document.querySelector("#board li")', 'the round to be saved and posted');
  const save = rows("SELECT owner, value FROM cloud_saves WHERE floor_id=? AND project='stars'");
  check('progress is saved on the server', save.length === 1 && JSON.parse(save[0].value).best === 3 && save[0].owner.startsWith('g:'), JSON.stringify(save));
  check('the score is on the board', (await p.ev('document.querySelector("#board li").textContent')) === 'Guest: 3 (you)');

  // Sign up with the page's own form: the guest's save and score come along.
  await p.type('#user', 'ace_pilot');
  await p.type('#pass', 'correct horse');
  await p.click('button[value=signup]');
  await p.until('document.querySelector("#who").textContent === "Logged in as ace_pilot"', 'signing up');
  const owner = rows("SELECT owner FROM cloud_saves WHERE floor_id=? AND project='stars'")[0]?.owner || '';
  check('signing up keeps the guest\'s save', owner.startsWith('u:'), owner);
  const user = rows("SELECT username, hash FROM cloud_users WHERE floor_id=? AND project='stars'");
  check('the account is stored with a hashed password', user.length === 1 && user[0].username === 'ace_pilot' && user[0].hash.startsWith('s1$') && !user[0].hash.includes('correct horse'));

  // A better round, logged in.
  await p.ev('game.start(); for (let i = 0; i < 5; i++) game.catchStar(); game.end()');
  await p.until('[...document.querySelectorAll("#board li")].some((li) => li.textContent === "ace_pilot: 5 (you)")', 'the logged-in score');
  check('a logged-in score goes up under the account name', rows("SELECT name, score FROM cloud_scores WHERE floor_id=? AND project='stars'").some((r) => r.name === 'ace_pilot' && r.score === 5));

  // A reload keeps the login and the save.
  await p.goto(`${origin}/`);
  await p.until('window.game && document.querySelector("#who").textContent === "Logged in as ace_pilot" && document.querySelector("#best").textContent === "5"', 'the reload', 15000);
  check('after a reload: still logged in, best and rounds restored', (await p.ev('document.querySelector("#played").textContent')) === '2');

  // A second tab joins the same room.
  const q = await b.newPage({ width: 900, height: 700 });
  await q.goto(`${origin}/`);
  await q.until('window.game && typeof room !== "undefined" && room.members.length === 2', 'the second tab in the room', 15000);
  await p.front();
  await p.until('room.members.length === 2 && document.querySelectorAll("#players li").length === 2', 'the first tab to see the second', 10000);
  check('two tabs are in one room', (await p.ev('room.members.length')) === 2 && (await q.ev('room.members.length')) === 2);
  await p.ev('game.start(); game.catchStar()');
  await q.until('document.querySelector("#last").textContent === "ace_pilot just caught a star."', 'shared state reaching the other tab', 10000);
  check('a catch in one tab shows in the other (shared state)', true);
  await q.ev('room.setPresence({ x: 0.25, y: 0.75, score: 7 })');
  await p.until('room.members.some((m) => !m.you && m.presence && m.presence.score === 7)', 'presence', 10000);
  check('presence from one tab reaches the other', true);
  await p.ev('window.__got = []; room.on("message", (d) => window.__got.push(d.hello)); true');
  await q.ev('room.send({ hello: "from tab two" }); true');
  await p.until('window.__got.includes("from tab two")', 'a message from the other tab', 10000);
  check('a message from one tab arrives in the other', true);
  await p.ev('game.end()');
  await sleep(600);
  await p.shot(join(ROOT, 'media', 'office-cloud-game.jpg'));
  q.close();
  await p.until('room.members.length === 1', 'the second tab to leave', 10000);
  check('closing a tab leaves the room', (await p.ev('document.querySelectorAll("#players li").length')) === 1);
  const csp = await p.ev(`fetch('/').then((r) => r.headers.get('content-security-policy'))`);
  check('the page CSP still only connects to its own host', /connect-src 'self' ws:\/\/[a-z0-9-]+\.apps\.localhost:\d+ data: blob:;/.test(csp), csp.slice(0, 160));
  check('no page errors', p.errors.length === 0, p.errors.join(' | ').slice(0, 200));

  // The boss sees counts, and nothing anyone saved.
  const o = await b.newPage({ width: 1440, height: 900 });
  await o.send('Network.setCookie', { name: 'office_s', value: a.cookies.office_s, url: `${main}/theoffice/`, path: '/theoffice', httpOnly: true, sameSite: 'Lax' });
  await o.goto(`${main}/theoffice/floor/${a.slug}`);
  await o.until('window.__office && window.__office.state', 'the floor page', 20000);
  await o.ev('window.__office.setTab("projects")');
  await o.until('!!document.querySelector(\'[data-cloud="stars"]\')', 'the Backend button', 15000);
  await o.click('[data-cloud="stars"]');
  await o.until('!!document.querySelector(".modal") && document.querySelector(".modal").innerText.includes("Accounts")', 'the Backend view', 10000);
  const text = await o.ev('document.querySelector(".modal").innerText');
  check('the boss sees the backend counts', /Accounts\s*1/.test(text) && /Saves\s*1/.test(text) && /Leaderboard scores\s*1 on 1 board/.test(text), text.replace(/\s+/g, ' ').slice(0, 200));
  check('and none of what players saved, nor any password', !/ace_pilot|correct horse|s1\$/.test(text));
  check('requests today are counted', /Requests today\s*[1-9]/.test(text));
  await sleep(900);
  await o.shot(join(ROOT, 'media', 'office-cloud-boss.jpg'));
  // The floor page has always logged one CSP notice about string evaluation on load, before any of this runs; anything else fails.
  const bossErrors = o.errors.filter((e) => !/Evaluating a string as JavaScript violates/.test(e));
  check('no errors on the boss\'s page', bossErrors.length === 0, bossErrors.join(' | ').slice(0, 200));
} catch (e) {
  check(`ran to the end: ${e.message}`, false);
} finally { b.close(); }
console.log(`${results.length - failures} of ${results.length} passed`);
await t.close();
process.exit(failures ? 1 : 0);
