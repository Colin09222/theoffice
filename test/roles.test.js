// Six working roles (docs/redesign/OFFICE-ANSWERS-1.md, Q13 and section 6; job 27): Manager, Researcher, Writer (takes the Marketer's words), Designer (takes
// the Illustrator's), Builder, Tester. The beans keep their names and desks; only the model calls merge. The Lawyer is the office's launch checklist, the
// Analyst is the manager reading the Numbers; the team planning meeting and the Business Development bean are off.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, until, sleep, floorState } from './helpers.js';
import { get, all } from '../server/db.js';
import { loadModels } from '../server/config.js';
import { MERGED_ROLES } from '../server/engine.js';
import { toolsForRole } from '../server/tools.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });
const LINES = ['The words are on the page', 'They match the offer', 'They fit a phone'];

function scripted() {
  const calls = [];
  return { calls, chat: async (a) => { calls.push(a); a.onToken?.('Done.'); return { content: 'Done.', toolCalls: [], finish: 'stop', usage: { prompt: 1, completion: 1, cost: 0.001, real: true } }; } };
}
async function floor(overrides = {}, { mock = false } = {}) {
  const llm = scripted();
  const t = await boot({ staffSelfCheck: false, ...overrides }, mock ? {} : { llm });
  open.push(t);
  const c = await claim(t, `Roles ${open.length}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  const e = t.app.engine;
  for (const r of ['marketer', 'illustrator', 'analyst', 'writer', 'designer']) if (!get(t.db, 'SELECT 1 x FROM agents WHERE floor_id=? AND role=?', f.id, r)) e.hireStaff(f, r);
  const tool = (name, args) => e.tools.exec(e.toolCtx(f, mgr, null, toolsForRole('manager')), name, JSON.stringify(args));
  const agentOf = (role) => get(t.db, 'SELECT * FROM agents WHERE floor_id=? AND role=?', f.id, role);
  return { t, c, f, mgr, e, tool, agentOf, llm, db: t.db };
}

describe('six working roles', () => {
  test('a Marketer\'s job goes to the Writer and an Illustrator\'s to the Designer; the beans keep their desks', async () => {
    const h = await floor({ peopleTalk: false });
    h.e.runManager = async () => {};
    const m = h.e.assignTask(h.f, h.mgr, { to: 'marketer', title: 'Ad words', brief: 'Write them.', plan: '', project: 'ads', dependsOn: [], afterPrevious: false, checks: LINES });
    const i = h.e.assignTask(h.f, h.mgr, { to: 'illustrator', title: 'A picture', brief: 'Draw it.', plan: '', project: 'pics', dependsOn: [], afterPrevious: false, checks: LINES });
    assert.equal(m.agentId, h.agentOf('writer').id); assert.equal(i.agentId, h.agentOf('designer').id);
    await until(() => all(h.db, "SELECT 1 x FROM tasks WHERE floor_id=? AND status IN ('review','done')", h.f.id).length === 2, { what: 'both jobs' });
    const roles = new Set(h.llm.calls.filter((x) => x.meta.kind === 'staff').map((x) => x.meta.role));
    assert.deepEqual([...roles].sort(), ['designer', 'writer'], 'no Marketer or Illustrator model call');
    assert.ok(h.agentOf('marketer') && h.agentOf('illustrator'), 'the beans are still there, at their desks');
  });

  test('the Analyst\'s and the Lawyer\'s jobs are refused with where the work went; every role lands on one of six', async () => {
    const h = await floor({ peopleTalk: false });
    h.e.runManager = async () => {};
    assert.match(await h.tool('assign_task', { to: 'analyst', title: 'Numbers', brief: 'Size it up.', checks: LINES, intent: 'numbers' }), /the numbers are yours to read on the daily run/);
    assert.match(await h.tool('assign_task', { to: 'lawyer', title: 'Terms', brief: 'Write the terms.', checks: LINES, intent: 'terms' }), /launch checklist \(launch_check\), not a person/);
    const six = new Set(['manager', 'researcher', 'writer', 'designer', 'builder', 'tester']);
    for (const role of Object.keys(loadModels().all)) assert.ok(six.has(MERGED_ROLES[role] || role), `${role} works as one of the six`);
  });

  test('the team planning meeting is off: a plan makes no huddle model call; TEAM_MEETINGS=1 brings it back', async () => {
    // The scripted building's own manager (server/mock.js) plans on "go"; a huddle is a ledger row of its own.
    const meetings = async (over) => {
      const h = await floor({ meetingGapMs: 0, ...over }, { mock: true });
      await h.c.post(`/api/floors/${h.c.slug}/chat`, { text: 'go build a website for my bakery' });
      await until(async () => all(h.db, 'SELECT 1 x FROM tasks WHERE floor_id=?', h.f.id).length > 0, { what: 'a plan' });
      await sleep(800);
      return get(h.db, "SELECT COUNT(*) n FROM ledger WHERE floor_id=? AND kind='talk-meeting'", h.f.id).n;
    };
    assert.equal(await meetings({}), 0);
    assert.ok(await meetings({ teamMeetings: true, statusFromCode: false }) > 0, 'switched back on, the huddle happens');  // the huddle in the model's words also needs STATUS_FROM_CODE=0 since job 12
  });

  test('the Business Development bean is off unless BIZ_DEV_BEAN=1', async () => {
    const h = await floor({ peopleTalk: false });
    assert.equal((await floorState(h.c)).bizDev, false);
    const on = await floor({ peopleTalk: false, bizDevBean: true });
    assert.equal((await floorState(on.c)).bizDev, true);
  });
});
