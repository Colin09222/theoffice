// The three lanes: what the manager and staff are told per lane, how it reaches them, and that nobody is told about something this building can't do.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, floorState, until, waitDone, Client } from './helpers.js';
import { get, all } from '../server/db.js';
import { loadConfig } from '../server/config.js';
import { managerPrompt, staffPrompt, computerPrompt, computerBriefing, laneBrief, LANES } from '../server/prompts.js';
import { toolDefs, toolsForRole } from '../server/tools.js';
import { goesLive, writeFile, publishSnapshot } from '../server/workspace.js';
import { filesToPublish } from '../server/launch.js';

const floor = { name: 'A', number: 1, tagline: '' };
const BOSS = { name: 'B' }, ROSTER = { manager: 'M' };
const FULL = { appsBaseDomain: 'apps.example', computerEnabled: true, openrouterKey: 'k', anthropicKey: 'k' };
const BARE = { aiMode: 'live' };

describe('the manager\'s playbooks', () => {
  const full = managerPrompt(floor, BOSS, ROSTER, FULL);
  test('it knows the three lanes, and that ideas come only when asked for', () => {
    assert.deepEqual(LANES, ['game', 'website', 'business']);
    for (const h of [/^GAME$/m, /^WEBSITE$/m, /^BUSINESS$/m]) assert.match(full, h);
    assert.match(full, /If they ask for ideas or have nothing yet, give three ideas, one line each/); assert.match(full, /Set lane on every assign_task/);
  });
  test('the game lane goes concept, build, Tester in a real browser, fix, publish, with a saved score', () => {
    const game = full.slice(full.indexOf('GAME\n'), full.indexOf('WEBSITE\n'));
    assert.match(game, /choose it yourself/); assert.match(game, /Three ideas, one line each, only if the boss asks/); assert.match(game, /Never a copy of a named game/);
    assert.match(game, /playable version/); assert.match(game, /Say in the brief not to publish yet/); assert.match(game, /saved high score/);
    assert.match(game, /Hire a Tester/); assert.match(game, /play it in a real browser/); assert.match(game, /fix small clear bugs themselves and retest/); assert.match(game, /what nobody has replayed/);
    assert.match(game, /send the Builder's task back with review_task/); assert.match(game, /call publish_project yourself/);
  });
  test('the website lane goes brief, copy, named design, build, review_design, publish', () => {
    const site = full.slice(full.indexOf('WEBSITE\n'), full.indexOf('BUSINESS\n'));
    assert.match(site, /If you know what the site is about, start/); assert.match(site, /real words/); assert.match(site, /named choices/); assert.match(site, /review_design/); assert.match(site, /publishes/); assert.match(site, /never made up/);
  });
  test('the business lane covers research, estimates, plan, page, checklist and what only a human can do, and says what nobody here can do', () => {
    const biz = full.slice(full.indexOf('BUSINESS\n'), full.indexOf('Security rules'));
    assert.match(biz, /nobody here can send email, post, run ads, talk to customers or spend money/);
    assert.match(biz, /cited sources/); assert.match(biz, /named competitors/); assert.match(biz, /target customer/); assert.match(biz, /role analyst/); assert.match(biz, /role marketer/);
    assert.match(biz, /offer and pricing/); assert.match(biz, /estimates/); assert.match(biz, /launch checklist/); assert.match(biz, /waitlist/); assert.match(biz, /only the boss can do/);
  });
  test('with app origins off, nothing promises saved data, waitlists or leaderboards', () => {
    const bare = managerPrompt(floor, BOSS, ROSTER, BARE);
    assert.match(bare, /never promise those/);
    assert.match(bare, /best score for the session only/); assert.match(bare, /no form, because forms are not switched on/);
    assert.doesNotMatch(bare, /saved high score on a shared leaderboard/); assert.doesNotMatch(bare, /a waitlist or contact form/); assert.doesNotMatch(bare, /installable PWAs with/);
  });
  test('with computers off, nobody claims a browser, and the manager says the game has not been played', () => {
    const bare = managerPrompt(floor, BOSS, ROSTER, BARE);
    assert.match(bare, /Nobody here has a browser/); assert.match(bare, /publishes it unplayed/);
    assert.doesNotMatch(bare, /Hire a Tester/); assert.doesNotMatch(bare, /review_design/);
    assert.doesNotMatch(bare, /Builder has a real computer/);
  });
  test('switched-off things stay out: iPhones, domains, pictures and search', () => {
    const bare = managerPrompt(floor, BOSS, ROSTER, BARE);
    for (const word of [/ios_start/, /ios_request/, /iPhone/, /request_domain/, /check_domain/, /generate_image/, /use web_search/]) assert.doesNotMatch(bare, word);
    assert.match(bare, /web search is not switched on/);
    assert.doesNotMatch(full, /iPhone/);
    const cfg = loadConfig({ AI_MODE: 'live', APPS_BASE_DOMAIN: 'apps.example', NAMECHEAP_API_USER: 'u', NAMECHEAP_API_KEY: 'k', NAMECHEAP_CLIENT_IP: '203.0.113.7', DOMAIN_CONTACT_SOURCE: 'x.example', SERVER_IP: '198.51.100.9' });
    assert.match(managerPrompt(floor, BOSS, ROSTER, cfg), /request_domain/);
    assert.ok(!toolDefs(toolsForRole('manager'), loadConfig({ AI_MODE: 'live' }), 'manager').some((d) => /ios|domain/.test(d.function.name)));
    assert.ok(toolDefs(toolsForRole('manager'), cfg, 'manager').some((d) => d.function.name === 'request_domain'), 'domain buying is unchanged when it is set up');
  });
  test('every agent is told what nobody here can do, and to label estimates', () => {
    for (const p of [full, staffPrompt(floor, { name: 'S', title: 'T', role: 'writer' }, {}, {}, FULL), computerPrompt(FULL, 'builder', {}), computerPrompt(FULL, 'tester', {})]) {
      assert.match(p, /Nobody in this building can send email, post anywhere, run ads, contact anyone, sign up for a service or spend money/);
      assert.match(p, /label it "Estimate"/); assert.match(p, /source link/); assert.match(p, /marked as proposed/); assert.match(p, /traction/);
    }
  });
});

describe('each person\'s part', () => {
  test('a task in a lane gets that person\'s part, and no other lane\'s', () => {
    const writer = staffPrompt(floor, { name: 'S', title: 'Writer', role: 'writer' }, {}, { lane: 'business' }, FULL);
    assert.match(writer, /Your part of the business playbook/); assert.match(writer, /Only you can do these/); assert.match(writer, /Launch checklist/); assert.match(writer, /marked Estimate/);
    assert.doesNotMatch(writer, /game playbook|website playbook/);
    assert.doesNotMatch(staffPrompt(floor, { name: 'S', title: 'Writer', role: 'writer' }, {}, {}, FULL), /Your part of/);
    assert.equal(laneBrief('', 'writer', FULL), ''); assert.equal(laneBrief('game', 'writer', FULL), ''); assert.equal(laneBrief('nonsense', 'builder', FULL), '');
  });
  test('the staff get the concrete steps', () => {
    assert.match(laneBrief('game', 'builder', FULL), /office\.leaderboard\.submit/); assert.match(laneBrief('game', 'builder', FULL), /Keyboard and touch/); assert.match(laneBrief('game', 'builder', FULL), /do not publish: the Tester plays it next/);
    assert.match(laneBrief('game', 'tester', FULL), /press real keys/); assert.match(laneBrief('game', 'tester', FULL), /PASS/); assert.match(laneBrief('game', 'tester', FULL), /Do not publish/);
    assert.match(laneBrief('website', 'designer', FULL), /a name and a hex value/); assert.match(laneBrief('website', 'builder', FULL), /call review_design/); assert.match(laneBrief('website', 'writer', FULL), /No placeholder text/);
    assert.match(laneBrief('business', 'researcher', FULL), /at least three named competitors/); assert.match(laneBrief('business', 'researcher', FULL), /source URL/);
    assert.match(laneBrief('business', 'analyst', FULL), /"Estimate"/); assert.match(laneBrief('business', 'marketer', FULL), /No testimonials/);
    assert.match(laneBrief('business', 'builder', FULL), /Office\.submitForm/); assert.match(laneBrief('business', 'builder', FULL), /Never promise an automatic email/); assert.match(laneBrief('business', 'builder', FULL), /not open yet/);
  });
  test('and with features off they are told so, rather than building something that can\'t work', () => {
    assert.match(laneBrief('game', 'builder', BARE), /session only/); assert.doesNotMatch(laneBrief('game', 'builder', BARE), /submitScore|office\.leaderboard/); assert.match(laneBrief('game', 'builder', BARE), /has not been played/);
    assert.match(laneBrief('game', 'tester', BARE), /You have no browser here/);
    assert.match(laneBrief('business', 'builder', BARE), /no form/); assert.doesNotMatch(laneBrief('business', 'builder', BARE), /submitForm/);
    assert.doesNotMatch(laneBrief('website', 'builder', BARE), /review_design/);
    assert.match(laneBrief('business', 'researcher', BARE), /search is not switched on/);
  });
  test('every brief says what done means, and real work is checked by someone else before the boss hears it is done', () => {
    const full = managerPrompt(floor, BOSS, ROSTER, FULL);
    assert.match(full, /ends with a line starting "Done means:"/); assert.match(full, /Everything the boss named is in it/);
    const site = full.split(/^WEBSITE$/m)[1].split(/^BUSINESS$/m)[0];
    assert.match(site, /Say in the brief not to publish yet/); assert.match(site, /role tester/); assert.match(site, /phone and desktop size/);
    assert.match(site, /really submits every form/); assert.match(site, /send the Builder's task back with review_task/); assert.match(site, /One round of fixes/);
    assert.ok(site.indexOf('Tester') < site.indexOf('launch_report'), 'the Tester comes before the report');
    const bareSite = managerPrompt(floor, BOSS, ROSTER, BARE).split(/^WEBSITE$/m)[1].split(/^BUSINESS$/m)[0];
    assert.match(bareSite, /runs the checklist and publishes/); assert.doesNotMatch(bareSite, /role tester/);
    const builder = laneBrief('website', 'builder', FULL);
    for (const must of [/390 px wide phone/, /console is clean/, /every form really submits/, /every photo the boss sent/, /no lorem/, /og:image and a favicon/, /credited/]) assert.match(builder, must);
    assert.match(builder, /do not publish: a Tester checks it next/); assert.match(laneBrief('website', 'builder', BARE), /then publish/);
    const tester = laneBrief('website', 'tester', FULL);
    for (const must of [/390x844/, /1280x800/, /console errors/, /click every link and button/, /really submit every form/, /Done means/, /PASS/, /Do not publish/]) assert.match(tester, must);
    assert.match(laneBrief('website', 'tester', BARE), /no browser here/);
    const game = laneBrief('game', 'builder', FULL);
    assert.match(game, /every room, level, item, enemy, boss and screen it names goes in/); assert.match(game, /about 25 for one with rooms or levels/); assert.match(game, /a win where the game can be won/);
    assert.match(laneBrief('game', 'tester', FULL), /win screen as well as game over/);
    assert.match(laneBrief('business', 'builder', FULL), /390 px wide phone/); assert.match(laneBrief('business', 'builder', FULL), /submit the form once/); assert.match(laneBrief('business', 'builder', BARE), /then publish/);
    // A long report is cut before the manager reads it, so the verdict goes first.
    for (const role of ['game', 'website']) assert.match(laneBrief(role, 'tester', FULL), /Begin your reply with PASS/);
    assert.match(computerPrompt(FULL, 'tester', {}), /verdict first/); assert.match(computerPrompt(FULL, 'builder', {}), /cut off before the Office Manager reads it/);
  });
  test('on a computer it goes in the first message, because the system prompt is cached across floors', () => {
    const task = { id: 7, title: 'T', project: 'p', brief: 'Do it', lane: 'game' };
    const first = computerBriefing({ name: 'A', number: 1 }, { name: 'S', title: 'Builder', role: 'builder' }, {}, task, FULL);
    assert.match(first, /Do it/); assert.match(first, /Your part of the game playbook/);
    assert.doesNotMatch(computerBriefing({ name: 'A', number: 1 }, { name: 'S', title: 'Builder', role: 'builder' }, {}, { ...task, lane: '' }, FULL), /playbook/);
    assert.doesNotMatch(computerPrompt(FULL, 'builder', {}), /Your part of the/);
  });
});

describe('a lane through the engine', () => {
  test('tapping a lane is a short conversation that starts no work', async () => {
    const t = await boot();
    try {
      for (const [text, re] of [['Let\'s do a game. What could we build?', /Three small ideas/], ['Let\'s do a website. What do you need from me?', /Two quick questions/], ['Let\'s do a small business. Help me work it out.', /Nobody here can send email, post, run ads or spend money/]]) {
        const a = await claim(t, `Lane ${text.slice(10, 20)}`);
        const fresh = await floorState(a);
        assert.equal(fresh.messages.length, 1); assert.match(fresh.messages[0].text, /Tap one below/);
        assert.equal((await a.post(`/api/floors/${a.slug}/chat`, { text })).status, 202);
        const s = await until(async () => { const x = await floorState(a); return x.messages.some((m) => m.role === 'manager' && re.test(m.text)) && !t.app.engine.runs.size ? x : null; }, { what: 'the reply' });
        assert.equal(s.tasks.length, 0, 'no work yet');
        assert.ok(t.app.engine.spentToday(t.db.prepare('SELECT id FROM floors WHERE slug=?').get(a.slug).id) > 0, 'the reply went through the ordinary ledger');
      }
    } finally { await t.close(); }
  });
  test('the manager\'s lane reaches the task and the staff member\'s prompt, and a made-up lane is dropped', async () => {
    const seen = [];
    const { createMockClient } = await import('../server/mock.js');
    const t0 = await boot(); const inner = createMockClient(t0.cfg); await t0.close();
    const t = await boot({}, { llm: { chat(a) { if (a.meta.kind === 'staff') seen.push(a.messages[0].content); return inner.chat(a); } } });
    try {
      const a = await claim(t, 'Biz Lane');
      await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build a cleaning round [lane:business]' });
      await waitDone(a);
      const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', a.slug).id;
      const tasks = all(t.db, 'SELECT lane FROM tasks WHERE floor_id=?', fid);
      assert.equal(tasks.length, 4); assert.ok(tasks.every((x) => x.lane === 'business'));
      assert.ok(seen.some((p) => /Your part of the business playbook: Do real market research/.test(p)), 'the researcher got theirs');
      assert.ok(seen.some((p) => /Your part of the business playbook: Read the research/.test(p)), 'the writer got theirs');
      const c = await claim(t, 'Odd Lane');
      await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build an odd thing [lane:nonsense]' });
      await waitDone(c);
      const fc = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
      assert.ok(all(t.db, 'SELECT lane FROM tasks WHERE floor_id=?', fc).every((x) => x.lane === ''));
    } finally { await t.close(); }
  });
});

describe('working papers', () => {
  test('notes and test reports stay on the drive and never go live, or into the checklist', async () => {
    assert.equal(goesLive('index.html'), true); assert.equal(goesLive('images/hero.png'), true); assert.equal(goesLive('notes.html'), true);
    assert.equal(goesLive('notes/brief.md'), false); assert.equal(goesLive('notes/deep/x.md'), false); assert.equal(goesLive('TEST-REPORT.md'), false);
    const t = await boot();
    try {
      const a = await claim(t, 'Paperwork'); const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', a.slug);
      for (const [p, c] of [['index.html', '<h1>x</h1>'], ['notes/copy.md', 'draft words'], ['TEST-REPORT.md', 'bugs'], ['dist/index.html', '<h1>y</h1>'], ['dist/notes/x.md', 'z']]) writeFile(t.db, f.id, `projects/s/${p}`, c, null, 1e7);
      assert.equal(publishSnapshot(t.db, f.id, 's', 1e7), 3);
      assert.deepEqual(all(t.db, "SELECT path FROM published_files WHERE floor_id=? AND project='s' ORDER BY path", f.id).map((r) => r.path), ['dist/index.html', 'dist/notes/x.md', 'index.html']);
      assert.deepEqual(filesToPublish(t.db, f.id, 's').map((x) => x.path).sort(), ['dist/index.html', 'dist/notes/x.md', 'index.html']);
      assert.equal(publishSnapshot(t.db, f.id, 's', 1e7, 'dist'), 1, 'a build folder publishes the same way');
      assert.equal(get(t.db, "SELECT content FROM files WHERE floor_id=? AND path='projects/s/notes/copy.md'", f.id).content, 'draft words', 'still on the drive');
    } finally { await t.close(); }
  });
});

describe('the checklist, as a real Builder found', () => {
  test('an apostrophe in a description doesn\'t end it', async () => {
    const { checkSite } = await import('../server/launch-check.js');
    const page = (desc) => `<!doctype html><html lang="en"><head><title>Corner</title><meta name="viewport" content="width=device-width"><meta name="description" content=${desc}></head><body>x</body></html>`;
    const warned = (desc) => checkSite({ files: [{ path: 'index.html', data: page(desc) }] }).warnings.some((w) => /meta name="description"/.test(w));
    assert.equal(warned('"Maya\'s Saturday repair stand for riders in the neighbourhood."'), false);
    assert.equal(warned("'A \"plain\" description that is long enough to count as one.'"), false);
    assert.equal(warned('"Too short."'), true);
  });
});

describe('no dead ends', () => {
  let t, a, v;
  before(async () => { t = await boot(); a = await claim(t, 'New Boss'); v = new Client(t); });
  after(() => t.close());
  test('switched-off features report themselves off, so the page can leave them out', async () => {
    const s = await floorState(a);
    assert.equal(s.domainsOn, false); assert.deepEqual(s.domains, []); assert.deepEqual(s.ios, []);
    assert.equal((await a.post(`/api/floors/${a.slug}/ios/1/approve`, {})).status, 404);
  });
  test('a visitor gets none of it', async () => {
    const s = await floorState(v, a.slug);
    for (const k of ['domainsOn', 'domains', 'ios', 'help', 'orders', 'purchases']) assert.equal(s[k], undefined, k);
  });
});
