// The boss's Servers tab in real Chrome, desktop and phone, against a stand-in runner: a slot request answered, a server restarted and stopped, its logs and jobs,
// settings that never come back, a full building, and the slot freed. OS-assigned ports, its own Chrome profile, no real AI.
import { launch, sleep } from './cdp.mjs';
import { get } from '../../server/db.js';
import { writeFile } from '../../server/workspace.js';
import { toolsForRole } from '../../server/tools.js';
import { boot, claim, until } from '../helpers.js';
import { fakeRunner } from '../fake-runner.js';

const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(ok); if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${String(detail).slice(0, 160)})` : ''}`); };

const fake = await fakeRunner();
const t = await boot({ appsBaseDomain: 'apps.localhost:1', appsScheme: 'http', runnerSocket: fake.socketPath, runnerTokenFile: fake.tokenFile, runnerTickMs: 100, runnerPollMs: 5, runnerBuildWaitMs: 2000 });
t.cfg.appsBaseDomain = `apps.localhost:${t.port}`;
const main = `http://localhost:${t.port}`;
t.cfg.publicOrigin = main;
t.base = `${main}/theoffice`; t.host = `localhost:${t.port}`;

const CODE = { 'server.js': "require('http').createServer((q,s)=>s.end('ok')).listen(process.env.PORT)\n", 'package.json': '{"name":"s","private":true,"scripts":{"start":"node server.js"}}', 'office.json': '{"cron":[{"name":"tick","schedule":"*/30 * * * *","run":"node tick.js"}]}' };

async function floorWith(name) {
  const boss = await claim(t, name);
  const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
  const agent = { ...get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='builder'", floor.id), role: 'builder' };
  const tool = (n, a) => t.app.engine.tools.exec({ allowed: toolsForRole('builder'), floor, agent, task: null, project: a.project, say: () => {} }, n, JSON.stringify(a));
  const code = (project, files = CODE) => { for (const [p, c] of Object.entries(files)) writeFile(t.db, floor.id, `projects/${project}/server/${p}`, c, null, 1e8); };
  const ask = async (project, files) => { code(project, files); await tool('deploy_server', { project, why: `${project} needs a schedule` }); };
  const allow = async (project) => { const r = await boss.post(`/api/floors/${boss.slug}/servers/${project}/approve`, {}); if (r.status !== 200) throw new Error(`approve ${r.status}`); };
  return { boss, floor, ask, allow, tool };
}
const labelOf = (f, project) => get(t.db, 'SELECT label FROM server_apps WHERE floor_id=? AND project=?', f.floor.id, project).label;

async function scenario(kind, opts, boss) {
  const b = await launch();
  try {
    const f = await floorWith(boss);
    await f.ask('shop');
    await f.allow('shop');
    await until(() => fake.apps[labelOf(f, 'shop')]?.build?.status === 'ok' && !get(t.db, 'SELECT building x FROM server_apps WHERE floor_id=? AND project=?', f.floor.id, 'shop').x, { what: 'shop built' });
    await f.ask('broken', { ...CODE, 'server.js': '// BUILD_FAIL\n' });
    await f.allow('broken');
    await until(() => fake.apps[labelOf(f, 'broken')]?.build?.status === 'failed', { what: 'broken failed' });
    await f.ask('scraper');

    const p = await b.newPage(opts);
    await p.send('Network.setCookie', { name: 'office_s', value: f.boss.cookies.office_s, url: `${main}/theoffice/`, path: '/theoffice', httpOnly: true, sameSite: 'Lax' });
    await p.goto(`${main}/theoffice/floor/${f.boss.slug}`);
    await p.until('!!window.__office && !!document.querySelector("[data-tab=requests]")', 'the floor to open');
    const noWider = () => p.ev('document.documentElement.scrollWidth <= window.innerWidth + 1');

    // The request, in the same list as every other one.
    await p.ev('window.__office.setTab("requests")');
    await p.until('!!document.querySelector("[data-server-request=scraper]")', 'the slot request');
    const card = await p.ev('document.querySelector("[data-server-request=scraper]").innerText');
    check(`${kind}: the request says it uses a slot`, /one of the building's server slots/.test(card) && /free right now/.test(card), card);
    check(`${kind}: no money on it`, !/\$\s?\d/.test(card));
    check(`${kind}: the requests fit the screen`, await noWider());
    await p.click('[data-server-approve=scraper]');
    await p.until('!document.querySelector("[data-server-request=scraper]")', 'the request to go');
    check(`${kind}: Allow it deployed it`, !!fake.apps[labelOf(f, 'scraper')]);

    // The panel.
    await p.ev('window.__office.setTab("servers")');
    await p.until('!!document.querySelector("[data-server=shop] .server-status")', 'the server card');
    await p.until('document.querySelector("[data-server=shop] .server-status").dataset.status === "sleeping"', 'asleep');
    check(`${kind}: a sleeping server says Asleep`, (await p.ev('document.querySelector("[data-server=shop] .server-status").innerText')) === 'Asleep');
    await p.until('!!document.querySelector("[data-server=broken]")', 'the broken server');
    check(`${kind}: a failed build says so`, /Build failed/.test(await p.ev('document.querySelector("[data-server=broken]").innerText')));
    check(`${kind}: the panel fits the screen`, await noWider());
    const shopCard = '[data-server=shop]';
    await p.click(`${shopCard} [data-server-restart]`);
    await p.until(`document.querySelector("${shopCard} .server-status").dataset.status === "running"`, 'running after restart');
    check(`${kind}: restart wakes it`, true);
    await p.click(`${shopCard} [data-server-stop]`);
    await p.until(`document.querySelector("${shopCard} .server-status").dataset.status === "stopped"`, 'stopped');
    await p.ev(`[...document.querySelectorAll("${shopCard} .btn")].find((x) => x.innerText === "Start").click()`);
    await p.until(`document.querySelector("${shopCard} .server-status").dataset.status === "running"`, 'started again');
    check(`${kind}: stop and start work`, true);
    await p.ev(`document.querySelector("${shopCard} details[data-open-key^=logs] summary").click()`);
    await p.until(`document.querySelector("${shopCard} .server-log").innerText.includes("hello from the app")`, 'the logs');
    check(`${kind}: recent logs show`, true);
    await p.ev(`document.querySelector("${shopCard} details[data-open-key^=jobs] summary").click()`);
    await p.until(`document.querySelector("${shopCard} [data-job=tick]") && document.querySelector("${shopCard} .server-jobs").innerText.includes("every 30 minutes")`, 'the job');
    check(`${kind}: a scheduled job reads in words`, true);
    await p.ev(`document.querySelector("${shopCard} [data-job=tick]").click()`);
    await until(() => fake.calls.some((c) => c.path.includes('/jobs/tick')), { what: 'the job to run' });
    check(`${kind}: run now works`, true);
    await p.ev(`document.querySelector("${shopCard} details[data-open-key^=env] summary").click()`);
    await p.until(`document.querySelector("${shopCard} [data-env-name]").offsetParent !== null`, 'the settings form');
    await p.ev(`document.querySelector("${shopCard} [data-env-name]").value = "MY_API_KEY"`);
    await p.ev(`document.querySelector("${shopCard} [data-env-value]").value = "super-secret-value-123"`);
    await p.ev(`document.querySelector("${shopCard} .server-env-form").requestSubmit()`);
    await p.until(`!!document.querySelector("${shopCard} [data-env-remove=MY_API_KEY]")`, 'the name to appear');
    await sleep(200);
    const html = await p.ev('document.documentElement.outerHTML');
    check(`${kind}: the setting's name shows, its value never does`, !html.includes('super-secret-value-123'));
    check(`${kind}: the runner really got it`, fake.apps[labelOf(f, 'shop')].secrets.MY_API_KEY === 'super-secret-value-123');
    check(`${kind}: the open panel stays open across a refresh`, await p.ev(`document.querySelector("${shopCard} details[data-open-key^=env]").open`));
    check(`${kind}: settings fit the screen`, await noWider());
    const full = `/tmp/runner2-scratch/server-panel-${kind}.jpg`;
    await p.shot(full);

    // A full building: kind words, the boss's own servers to free, and no way to overspend it.
    fake.occupy(Math.max(0, fake.cfg.MAX_APPS - Object.keys(fake.apps).length));
    await f.ask('extra');
    await t.app.engine.servers.tick();
    await p.ev('window.__office.setTab("requests")');
    await p.until('!!document.querySelector("[data-server-request=extra]")', 'the second request');
    await p.ev('window.__office.reload && window.__office.reload()').catch(() => {});
    await until(async () => (await p.ev('document.querySelector("[data-server-request=extra]")?.innerText || ""')).includes('full right now'), { what: 'the full-building words' });
    const disabled = await p.ev('document.querySelector("[data-server-approve=extra]").disabled');
    const offer = await p.ev('document.querySelector("[data-server-request=extra]").innerText');
    check(`${kind}: a full building says so and offers the boss's own`, disabled && /delete one of your own servers/.test(offer) && !/other-standard/.test(offer), offer);
    await p.ev('[...document.querySelectorAll("[data-server-request=extra] .btn")].find((x) => x.innerText === "See my servers").click()');
    await p.until('!!document.querySelector("[data-server=broken] [data-server-delete]")', 'the servers tab');
    await p.ev('window.confirm = () => true');
    await p.click('[data-server=broken] [data-server-delete]');
    await p.until('!document.querySelector("[data-server=broken]")', 'the deleted server to go');
    check(`${kind}: deleting frees the slot`, !fake.apps[labelOf(f, 'broken')]);
    await p.close?.();
    // Leave the building empty for the next boss.
    for (const k of Object.keys(fake.apps)) delete fake.apps[k];
  } finally { await b.close(); }
}

let crashed = null;
try {
  await scenario('desktop', { width: 1280, height: 800 }, 'Desk Co');
  await scenario('phone', { mobile: true, width: 390, height: 844 }, 'Phone Co');
} catch (e) { crashed = e; console.log(`CRASH ${String(e?.stack || e).slice(0, 500)}`); }
await t.close(); await fake.close();
console.log(`${results.length - failures}/${results.length} passed${crashed ? ', then crashed' : ''}`);
process.exit(failures || crashed ? 1 : 0);
