// The maker flow: a boss picks what to make in three taps, the team builds it from a tested starter, and the server runs the passes.
// Design doc, a playable slice, then up to three depth passes, each played by the Tester. Its bug list feeds the next pass, a regression
// blocks, and a pass that fails twice asks the boss instead of looping. The work is ordinary tasks for the ordinary staff through the usual
// engine and ledger; this file only keeps the job's place, decides the next step and publishes a version the Tester passed.
// Types, done-rules, quality bars, caps and ideas are in config/makers.json. No money anywhere.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, all, run, tx } from './db.js';
import { writeFile, readFile, slugify, slugPattern, floorBytes, goesLive, WorkspaceError } from './workspace.js';
import { runCheck, saveCheck, gateProblem } from './launch.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config/makers.json'), 'utf8'));
export const loadMakersConfig = () => CONFIG;
export const MAKER_TYPES = Object.keys(CONFIG.types);
export const STARTERS_DIR = join(ROOT, 'server/app-client/starters');
export const MARK = '[Maker]';

const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const parse = (raw, fb) => { try { const v = JSON.parse(raw); return v ?? fb; } catch { return fb; } };

// ---- ideas ----
const STOP = new Set('the and for with that this from your our about into what make made want game app site website business some like just very really would could should their them they have want need'.split(' '));
const wordsOf = (s) => new Set((String(s || '').toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !STOP.has(w)));
function rng(seed) { let x = (Number(seed) >>> 0) || 0x9e3779b9; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const identityWords = (floor) => { const id = parse(floor?.identity || '{}', {}) || {}; return wordsOf(`${floor?.name || ''} ${floor?.tagline || ''} ${id.about || ''}`); };

/** A card the boss can tap: everything Go needs, already filled in and still editable. */
export function cardFor(type, idea, cfg = CONFIG) {
  const t = cfg.types[type];
  return {
    type, id: idea.id, title: idea.title, pitch: idea.pitch, name: idea.title, starter: idea.starter || starterFor(type, idea.pitch),
    goal: t.goal, plan: [...t.plan], ...(idea.mechanics ? { mechanics: [...idea.mechanics] } : {}),
  };
}
/** Three cards, best fit to what the company already is first, then a seeded shuffle so "more ideas" shows different ones. Games mix 2D and 3D. */
export function ideaCards(type, { floor = null, seed = 0, cfg = CONFIG } = {}) {
  const bank = cfg.ideas[type] || [];
  const want = identityWords(floor);
  const r = rng(seed + 7);
  const scored = bank.map((idea) => ({ idea, score: idea.tags.filter((t) => want.has(t)).length * 10 + r() }));
  scored.sort((a, b) => b.score - a.score);
  const pick = scored.slice(0, 3).map((s) => s.idea);
  if (type === 'game' && !pick.some((i) => i.starter === 'game-3d')) { const three = scored.find((s) => s.idea.starter === 'game-3d'); if (three) pick[2] = three.idea; }
  if (type === 'game' && !pick.some((i) => i.starter === 'game-2d')) { const two = scored.find((s) => s.idea.starter === 'game-2d'); if (two) pick[2] = two.idea; }
  return pick.map((i) => cardFor(type, i, cfg));
}
export function surprise(type, { seed = Date.now(), cfg = CONFIG } = {}) {
  const bank = cfg.ideas[type] || [];
  return cardFor(type, bank[Math.floor(rng(seed)() * bank.length)] || bank[0], cfg);
}
export const starterFor = (type, text = '') => (type === 'game' ? (/\b(3d|three|first[- ]person|fly|flying|drive|driving|planet|race|racing|island|glide)\b/i.test(text) ? 'game-3d' : 'game-2d') : type === 'app' ? 'app' : type === 'website' ? 'website' : '');
/** The boss's own words: a name made from them, the type's goal and plan, and the words themselves as the pitch. */
export function fromWords(type, text, cfg = CONFIG) {
  const said = clip(text, 400);
  const words = said.replace(/[^\p{L}\p{N}' -]+/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()) && !/^(a|an|of|to|in|on|where|who|which|when|lets|let's)$/i.test(w));
  const name = words.slice(0, 3).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ') || cfg.types[type].label;
  return { type, id: 'own', title: name.slice(0, 40), name: name.slice(0, 40), pitch: said, starter: starterFor(type, said), goal: cfg.types[type].goal, plan: [...cfg.types[type].plan] };
}

// ---- the report a Tester leaves ----
/** TEST-REPORT.md ends with a fenced office-verdict block of JSON. A report without one is read for a plain PASS or FAIL. */
export function parseReport(text) {
  const s = String(text || '');
  const m = s.match(/```office-verdict\s*([\s\S]{0,20000}?)```/);
  let v = m ? parse(m[1], null) : null;
  if (!v || typeof v !== 'object') {
    const word = s.match(/\bverdict\s*[:=-]\s*(pass|fail)\b/i)?.[1];
    if (!word) return null;
    v = { verdict: word.toLowerCase() };
  }
  const rules = {};
  for (const [k, x] of Object.entries(v.rules && typeof v.rules === 'object' ? v.rules : {})) if (/^[a-z][a-z0-9_-]{0,30}$/i.test(k)) rules[k] = x === true ? true : x === false ? false : null;
  const bugs = (Array.isArray(v.bugs) ? v.bugs : []).slice(0, 30).map((b) => (typeof b === 'string' ? { severity: 'major', text: clip(b, 300) } : { severity: ['blocker', 'major', 'minor'].includes(b?.severity) ? b.severity : 'major', text: clip(b?.text, 300) })).filter((b) => b.text);
  const regressions = (Array.isArray(v.regressions) ? v.regressions : []).slice(0, 20).map((x) => clip(x, 300)).filter(Boolean);
  return { verdict: v.verdict === 'pass' ? 'pass' : 'fail', rules, bugs, regressions, summary: clip(v.summary, 400) };
}

// ---- the loop ----
/**
 * What happens after a step, as a pure function of the job and what the step produced, so it can be tested alone.
 * job: {pass, depth, fails, best, launchable, tokens, type}. ev: {step: 'doc' | 'build' | 'test', ok, report}.
 * Returns {action, patch, bugs, regressions}: action is 'build' (queue pass n with its Tester), 'retest', 'ready', 'ask', or 'wait'.
 */
export function decide(job, ev, cfg = CONFIG) {
  const limit = cfg.passes.failsBeforeAsking || 2;
  const depth = Math.max(0, Math.min(cfg.passes.max ?? 3, job.depth ?? cfg.passes.depth ?? 3));
  const overTokens = (cfg.passes.maxJobTokens || 0) > 0 && (job.tokens || 0) >= cfg.passes.maxJobTokens;
  const rulesFor = cfg.types[job.type]?.doneRules || [];
  if (ev.step === 'doc') {
    if (ev.ok) return { action: 'wait', patch: { fails: 0 } };
    const fails = (job.fails || 0) + 1;
    return fails >= limit ? { action: 'ask', patch: { fails }, why: 'the design doc did not get written twice' } : { action: 'redo-doc', patch: { fails } };
  }
  if (ev.step === 'build') {
    if (ev.ok) return { action: 'wait', patch: {} };
    const fails = (job.fails || 0) + 1;
    if (fails >= limit) return { action: 'ask', patch: { fails }, why: `pass ${job.pass} did not finish twice` };
    return { action: 'build', pass: job.pass, patch: { fails }, bugs: job.bugs || [], regressions: [] };
  }
  // A test.
  const r = ev.ok ? ev.report : null;
  if (!r) {
    const fails = (job.fails || 0) + 1;
    if (fails >= limit) return { action: 'ask', patch: { fails }, why: 'the Tester could not play it twice' };
    return { action: 'retest', pass: job.pass, patch: { fails } };
  }
  const best = job.best || {};
  const regressions = [...new Set([...r.regressions, ...Object.keys(best).filter((k) => best[k] === true && r.rules[k] === false).map((k) => `${ruleText(rulesFor, k)} worked before and broke`)])];
  const browserBroken = rulesFor.filter((x) => x.check === 'browser' && r.rules[x.id] === false).map((x) => x.text);
  const blockers = r.bugs.filter((b) => b.severity === 'blocker');
  const passing = r.verdict === 'pass' && !regressions.length && !browserBroken.length && !blockers.length;
  const unmet = rulesFor.filter((x) => r.rules[x.id] === false || (r.rules[x.id] === undefined && x.check === 'judge')).map((x) => x.text);
  const allDone = passing && !unmet.length && !r.bugs.some((b) => b.severity === 'major');
  const merged = { ...best }; if (passing) for (const [k, v] of Object.entries(r.rules)) if (v !== null) merged[k] = v;
  const bugs = [...regressions.map((t) => ({ severity: 'blocker', text: `Regression: ${t}` })), ...browserBroken.filter((t) => !regressions.includes(t)).map((t) => ({ severity: 'blocker', text: `Done-rule failing: ${t}` })), ...r.bugs].slice(0, 30);
  const patch = { fails: passing ? 0 : (job.fails || 0) + 1, best: merged, bugs, unmet, launchable: job.launchable || passing, lastPassing: passing ? job.pass : job.lastPassing ?? -1 };
  if (allDone) return { action: 'ready', patch, passing, why: 'every done-rule passed' };
  if (!passing && patch.fails >= limit) return { action: 'ask', patch, passing, why: regressions.length ? 'a regression is still there after a second try' : 'the same pass failed the Tester twice' };
  if (job.pass >= depth || overTokens) return patch.launchable ? { action: 'ready', patch, passing, why: overTokens ? 'it reached the job\'s work limit' : 'every depth pass is done' } : { action: 'ask', patch, passing, why: overTokens ? 'it reached the job\'s work limit without a version that passed' : 'no version passed the Tester yet' };
  return { action: 'build', pass: job.pass + 1, patch, passing, bugs, regressions, unmet };
}
const ruleText = (rules, id) => rules.find((x) => x.id === id)?.text || id;

// ---- briefs ----
const rulesBlock = (type, cfg = CONFIG) => cfg.types[type].doneRules.map((r) => `- ${r.id}: ${r.text}${r.check === 'browser' ? ' (checked in a real browser)' : ' (judged against the design doc)'}`).join('\n');
const barsLine = (type, cfg = CONFIG) => Object.entries(cfg.types[type].bars || {}).map(([k, v]) => `${k} ${v}`).join(', ');
const DOC = {
  game: (j) => `Write notes/design.md for ${j.title}: ${j.pitch}
It is where the depth gets decided, so make it specific enough that two builders would make the same game. Exactly these headings:
1. Core loop and controls: what the player does every second; keyboard, touch and gamepad, each control named.
2. Progression: how a run ramps and how the game keeps growing past 10 minutes.
3. Mechanics and enemies: at least 3 distinct ones${j.mechanics ? ` (start from: ${j.mechanics.join('; ')})` : ''}, each with how it behaves, how the player counters it, and the wave it first appears.
4. Levels or waves: a table of at least 8, with what is new in each.
5. Upgrades or unlocks: at least 5, with what each costs in the game's own currency.
6. Scoring, win and lose.
7. Juice and audio: what shakes, what bursts into particles, where hit-stop goes, what tweens, which sound for what.
8. Phone controls: exactly what each thumb does on a portrait phone.
9. Look: a palette with hex values, the shapes, and the one idea only this game has.
10. Passes: what the playable slice holds, then what each depth pass adds (pass 1, 2, 3).
About two pages. It builds on the starter already in the project (read STARTER.md), so design for it. Original only: no named game's characters, levels, art or look. Do not publish.`,
  app: (j) => `Write notes/spec.md for ${j.title}: ${j.pitch}
Exactly these headings: Who it is for (one line); The core thing they make or track (the ${j.object || 'item'}, with its fields); Screens (landing, sign up, the list, the detail or edit, settings), what each shows when empty, loading and failing; The one moment it has to nail; Passes (what the first version holds, then what each polish pass adds); Words (the landing page headline, three short points, and the call to action, all real: no testimonials, numbers or prices nobody gave). Payments are only a "coming soon" hook. It builds on the starter already in the project (read STARTER.md). Do not publish.`,
  website: (j) => `Write notes/copy.md and notes/design.md for ${j.title}: ${j.pitch}
copy.md: who it is for, the one thing a visitor should do, a page title, a one-sentence description, and the real words for every section, ready to use. Only facts from the boss; where one is missing, write the sentence so it doesn't need one, and never invent a review, price, phone number, address or story.
design.md: a palette with names and hex values, typefaces (system stacks with character, named), the layout, the sections in order, and the one idea only this subject could have. It builds on the starter already in the project (read STARTER.md). Do not publish.`,
};
const DOC_ROLE = { game: 'designer', app: 'writer', website: 'writer' };

export function docBrief(job) { return `${MARK} doc · ${job.title}\n${DOC[job.type](job)}`; }
export function buildBrief(job, pass, { bugs = [], regressions = [], unmet = [] } = {}, cfg = CONFIG) {
  const doc = job.type === 'game' ? 'notes/design.md' : job.type === 'app' ? 'notes/spec.md' : 'notes/copy.md and notes/design.md';
  const head = pass === 0
    ? `Build the first ${job.type === 'game' ? 'playable slice' : 'version'} of ${job.title} from ${doc}, on the starter already in this project. Read STARTER.md first: it already has ${STARTER_HAS[job.type]}. Make it this ${job.type === 'game' ? 'game' : job.type === 'app' ? 'app' : 'site'}: replace the starter's demo content, keep its structure and its test hooks.`
    : `Depth pass ${pass} of ${job.depth} on ${job.title}. Add what ${doc} lists for pass ${pass}, and fix the Tester's list below first. Change what's needed; don't rewrite what works.`;
  const fix = [
    regressions.length ? `REGRESSIONS (these worked before; fix them first, nothing goes live until they do):\n${regressions.map((x) => `- ${x}`).join('\n')}` : '',
    bugs.length ? `The Tester's bug list from the last pass:\n${bugs.map((b) => `- [${b.severity}] ${b.text}`).join('\n')}` : '',
    unmet.length ? `Done-rules not met yet:\n${unmet.map((x) => `- ${x}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return `${MARK} build ${pass} · ${job.title}
${head}
${fix}
The Tester plays it after you, in a real browser, against these done-rules:
${rulesBlock(job.type, cfg)}
Quality bars: ${barsLine(job.type, cfg)}.
Keep index.html at the project's root and no build step. Do not publish: the server publishes a version only once the Tester has passed it, and the boss launches it.`;
}
const STARTER_HAS = {
  game: 'boot, menu, play, pause and game over; keyboard, touch and gamepad; a responsive canvas; audio with mute; settings; saves and a leaderboard through Office Cloud; and juice helpers (shake, particles, tweens, hit-stop)',
  app: 'a landing page and a signed-in app shell on Office Cloud accounts and the database, with create, edit and delete, empty, loading and error states, settings and a coming-soon payments hook',
  website: 'fast accessible sections, full search and social meta, and a contact form that posts to Office Cloud',
};
export function testBrief(job, pass, { computer = false } = {}, cfg = CONFIG) {
  const doc = job.type === 'game' ? 'notes/design.md' : job.type === 'app' ? 'notes/spec.md' : 'notes/copy.md';
  const how = computer
    ? `Run the browser half first: node .office/playtest.mjs project --type ${job.type} --out .office/playtest (install playwright with npm i -D playwright && npx playwright install chromium if it asks). It serves the project, ${job.type === 'game' ? 'plays 60 s of scripted and random keyboard, touch and gamepad input at desktop and phone size, watches for console errors, soft-locks and the frame rate, and saves screenshots of the menu, play and game over' : job.type === 'app' ? 'signs up, creates something, reloads, signs out and back in, at desktop and phone size' : 'checks the phone layout, every link, the meta tags and the form'}, and writes playtest.json with a result for each browser rule. Then look at the screenshots and judge them against ${doc}, as a ${job.type === 'game' ? 'player: is it clear, is it alive, would you go again' : 'first real visitor'}.`
    : `You have no browser here, so read the code against ${doc} and the rules, and give null for any browser rule you can't be sure of.`;
  return `${MARK} test ${pass} · ${job.title}
Test ${pass === 0 ? 'the first version' : `depth pass ${pass}`} of ${job.title}. ${how}
Fix nothing big yourself: the Builder gets your list. Write TEST-REPORT.md in the project (it never goes live): what you checked, what you saw, then the bugs worst first. End it with this block, filled in, and nothing after it:
\`\`\`office-verdict
{"verdict": "pass or fail", "rules": {${cfg.types[job.type].doneRules.map((r) => `"${r.id}": true`).join(', ')}}, "bugs": [{"severity": "blocker, major or minor", "text": "what is wrong and how to see it"}], "regressions": ["anything that worked in the last version and doesn't now"], "summary": "one line"}
\`\`\`
pass means a first-time ${job.type === 'game' ? 'player' : 'visitor'} would get a working thing: no blocker, no failing browser rule, no regression. A rule is true, false, or null if you couldn't check it.
The rules:
${rulesBlock(job.type, cfg)}
Quality bars: ${barsLine(job.type, cfg)}.`;
}

// ---- starters ----
function walk(dir, base = '') {
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n), rel = base ? `${base}/${n}` : n;
    if (statSync(p).isDirectory()) out.push(...walk(p, rel)); else out.push({ path: rel, data: readFileSync(p, 'utf8') });
  }
  return out;
}
// The game starters share the kit (screens, input, audio, saves, juice); each game adds its own index.html and game.js.
export const starterFiles = (name) => (name && /^[a-z0-9-]+$/.test(name) ? [...(name.startsWith('game-') ? walk(join(STARTERS_DIR, 'game-kit')) : []), ...walk(join(STARTERS_DIR, name))] : []);

// ---- the server side ----
const SCHEMA = `
CREATE TABLE IF NOT EXISTS maker_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, project TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
  pitch TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '', plan TEXT NOT NULL DEFAULT '[]', starter TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'doc', pass INTEGER NOT NULL DEFAULT 0, depth INTEGER NOT NULL DEFAULT 3, state TEXT NOT NULL DEFAULT '{}',
  launched_at INTEGER, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS maker_jobs_floor ON maker_jobs(floor_id, id);
CREATE TABLE IF NOT EXISTS maker_tasks (task_id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL, step TEXT NOT NULL, pass INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS maker_snapshots (job_id INTEGER NOT NULL, path TEXT NOT NULL, content BLOB, size INTEGER NOT NULL, PRIMARY KEY (job_id, path));
`;
const OPEN = new Set(['doc', 'build', 'test']);

export function createMakers({ db, cfg, engine, now = Date.now, config = CONFIG }) {
  db.exec(SCHEMA);
  const jobOf = (floorId) => get(db, 'SELECT * FROM maker_jobs WHERE floor_id=? ORDER BY id DESC LIMIT 1', floorId);
  const stateOf = (j) => parse(j.state, {}) || {};
  const save = (j, fields, statePatch) => {
    const st = statePatch ? { ...stateOf(j), ...statePatch } : stateOf(j);
    const f = { ...fields, state: JSON.stringify(st), updated_at: now() };
    run(db, `UPDATE maker_jobs SET ${Object.keys(f).map((k) => `${k}=?`).join(',')} WHERE id=?`, ...Object.values(f), j.id);
    Object.assign(j, f);
    engine.emit(j.floor_id, 'maker', { id: j.id, stage: j.stage, pass: j.pass }, { persist: false, ownerOnly: true });
    return j;
  };
  const manager = (floor) => get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id);
  const ensure = (floor, role) => { if (!get(db, 'SELECT 1 x FROM agents WHERE floor_id=? AND role=?', floor.id, role)) engine.hireStaff(floor, role); };
  const computerOn = (role) => !!engine.computer?.handles?.(role);
  const tokensSince = (floorId, t) => get(db, 'SELECT COALESCE(SUM(prompt_tokens+completion_tokens),0) n FROM ledger WHERE floor_id=? AND created_at>=?', floorId, t).n;

  function queue(floor, j, step, pass, brief, role, deps = []) {
    const lane = config.types[j.type].lane;
    const title = step === 'doc' ? `Design doc: ${j.title}` : step === 'build' ? (pass === 0 ? `Build the first version of ${j.title}` : `Depth pass ${pass}: ${j.title}`) : `Play-test ${pass === 0 ? 'the first version' : `pass ${pass}`} of ${j.title}`;
    const r = engine.assignTask(floor, manager(floor), { to: role, title, brief, plan: `Make ${j.title}`, project: j.project, dependsOn: deps, afterPrevious: false, lane });
    run(db, 'INSERT INTO maker_tasks (task_id, job_id, step, pass) VALUES (?,?,?,?)', r.id, j.id, step, pass);
    return r.id;
  }
  function queuePass(floor, j, pass, extra) {
    const b = queue(floor, j, 'build', pass, buildBrief(j, pass, extra, config), 'builder');
    queue(floor, j, 'test', pass, testBrief(j, pass, { computer: computerOn('tester') }, config), 'tester', [b]);
    save(j, { stage: 'build', pass });
  }

  /** Go. Everything is checked before anything changes, so a refusal leaves the floor as it was. */
  function start(floor, input) {
    const type = String(input.type || '');
    if (!MAKER_TYPES.includes(type) || type === 'business') throw new WorkspaceError('pick a game, an app or a website');
    const live = jobOf(floor.id);
    if (live && OPEN.has(live.stage)) throw new WorkspaceError(`the team is still making ${live.title}`);
    const title = clip(input.name || input.title, 40) || config.types[type].label;
    const pitch = clip(input.pitch, 400) || title;
    const goal = clip(input.goal, 200) || config.types[type].goal;
    const plan = (Array.isArray(input.plan) ? input.plan : config.types[type].plan).map((x) => clip(x, 120)).filter(Boolean).slice(0, 8);
    const ideaId = clip(input.idea, 30);
    const known = (config.ideas[type] || []).find((i) => i.id === ideaId);
    const starter = type === 'game' ? (['game-2d', 'game-3d'].includes(input.starter) ? input.starter : known?.starter || starterFor(type, pitch)) : starterFor(type, pitch);
    let project = slugify(title, type).slice(0, 36).replace(/-+$/, '') || type;
    if (!slugPattern.test(project)) project = type;
    for (let i = 2; get(db, 'SELECT 1 x FROM projects WHERE floor_id=? AND slug=?', floor.id, project) || get(db, 'SELECT 1 x FROM files WHERE floor_id=? AND path LIKE ?', floor.id, `projects/${project}/%`); i++) project = `${project.replace(/-\d+$/, '')}-${i}`;
    const depth = Math.max(0, Math.min(config.passes.max, Number.isInteger(input.depth) ? input.depth : config.passes.depth));
    const role = DOC_ROLE[type];
    for (const r of [role, 'builder', 'tester']) ensure(floor, r);
    // A floor with no company yet gets one named after what it's making. The boss can rename it under Customise.
    if (floor.setup && engine.company?.setCompany) { try { engine.company.setCompany(floor, { name: title, what_it_does: pitch.slice(0, 200) }); } catch { /* the name is a nicety */ } }
    const t = now();
    const id = Number(run(db, 'INSERT INTO maker_jobs (floor_id,project,type,title,pitch,goal,plan,starter,stage,pass,depth,state,started_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      floor.id, project, type, title, pitch, goal, JSON.stringify(plan), starter, 'doc', 0, depth, JSON.stringify({ fails: 0, best: {}, bugs: [], launchable: false, lastPassing: -1, mechanics: known?.mechanics || null, object: known?.object || null }), t, t).lastInsertRowid);
    const j = get(db, 'SELECT * FROM maker_jobs WHERE id=?', id);
    engine.upsertProject(floor, project, { title });
    for (const f of starterFiles(starter)) writeFile(db, floor.id, `projects/${project}/${f.path}`, f.data.replaceAll('{{TITLE}}', title).replaceAll('{{PITCH}}', pitch.replace(/"/g, '&quot;')), null, cfg.quotaBytes);
    const jobView = { ...j, ...stateOf(j) };
    // The boss's pick goes in the chat as their words, and the plan is already made, so no model call is needed to start.
    engine.addMessage(floor.id, 'boss', null, `Let's make ${title}: ${pitch}\nGoal: ${goal}`);
    const doc = queue(floor, j, 'doc', 0, docBrief(jobView), role);
    const b = queue(floor, j, 'build', 0, buildBrief(jobView, 0, {}, config), 'builder', [doc]);
    queue(floor, j, 'test', 0, testBrief(jobView, 0, { computer: computerOn('tester') }, config), 'tester', [b]);
    engine.feed?.(floor.id, null, `The team started making ${title}`, project);
    say(floor, `On it. **${title}**: ${plan.map((p, i) => `${i + 1}. ${p}`).join(' ')}\nThe Tester plays every version in a real browser, and you get a **Launch** button once one passes.`);
    return view(floor);
  }

  function snapshot(j) {
    const prefix = `projects/${j.project}/`;
    const rows = all(db, 'SELECT path,content,size FROM files WHERE floor_id=? AND path LIKE ?', j.floor_id, `${prefix}%`).filter((f) => goesLive(f.path.slice(prefix.length)));
    tx(db, () => {
      run(db, 'DELETE FROM maker_snapshots WHERE job_id=?', j.id);
      for (const r of rows) run(db, 'INSERT INTO maker_snapshots (job_id,path,content,size) VALUES (?,?,?,?)', j.id, r.path.slice(prefix.length), r.content, r.size);
    });
  }
  /** Publishes the version the Tester last passed, never a pass still being built. Same checklist and gate as publish_project. */
  async function publishTested(floor, j) {
    const rows = all(db, 'SELECT path,content,size FROM maker_snapshots WHERE job_id=?', j.id);
    if (!rows.length) throw new WorkspaceError('no version has passed the Tester yet');
    const files = rows.map((r) => ({ path: r.path, data: r.content }));
    const kind = j.type === 'game' ? 'game' : j.type === 'app' ? 'app' : 'site';
    const check = await runCheck(db, floor, j.project, '', kind, files);
    const problem = gateProblem(check, j.type === 'game' ? 'scores and ratings in a game are the game\'s own' : '');
    if (problem && check.errors.length) { saveCheck(db, floor.id, j.project, check, '', now()); throw new WorkspaceError(problem); }
    tx(db, () => {
      const old = get(db, 'SELECT COALESCE(SUM(size),0) n FROM published_files WHERE floor_id=? AND project=?', floor.id, j.project).n;
      const total = rows.reduce((n, r) => n + r.size, 0);
      if (floorBytes(db, floor.id) - old + total > cfg.quotaBytes) throw new WorkspaceError('publishing would go past this floor\'s storage');
      run(db, 'DELETE FROM published_files WHERE floor_id=? AND project=?', floor.id, j.project);
      for (const r of rows) run(db, 'INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?,?,?,?,?)', floor.id, j.project, r.path, r.content, r.size);
    });
    engine.upsertProject(floor, j.project, { title: j.title, description: j.pitch.slice(0, 300), kind, sources: [], published: true });
    saveCheck(db, floor.id, j.project, check, '', now());
    engine.emitProject?.(floor.id, j.project);
    return engine.liveUrl(floor, j.project);
  }
  const shareUrl = (floor, j) => { const u = engine.liveUrl(floor, j.project); return /^https?:/.test(u) ? u : `${cfg.publicOrigin || ''}${u}`; };

  function say(floor, text) { engine.managerSays(floor.id, text); }
  function ask(floor, j, why) {
    const st = stateOf(j);
    const worst = (st.bugs || []).slice(0, 3).map((b) => `- ${b.text}`).join('\n');
    save(j, { stage: 'asking' }, { asked: why });
    say(floor, `**${j.title} is stuck, boss:** ${why}.${worst ? `\n${worst}` : ''}\nRather than go round in circles, it's your call: **Try again**, ${st.launchable ? '**Launch what works** (the last version that passed), ' : ''}or **Stop**. The buttons are on the maker card.`);
  }
  async function ready(floor, j, why) {
    const st = stateOf(j);
    save(j, { stage: 'ready' }, { why });
    if (j.launched_at) {
      try { const url = await publishTested(floor, j); say(floor, `**${j.title} got better and the Tester passed it**, so the live version is updated: ${url}`); } catch (e) { say(floor, `The newest ${j.title} passed the Tester but didn't go live: ${clip(e.message, 300)}`); }
      return;
    }
    say(floor, `**${j.title} passed the Tester${st.lastPassing > 0 ? ` after ${st.lastPassing} depth pass${st.lastPassing === 1 ? '' : 'es'}` : ''}** (${why}). Tap **Launch** on the maker card to put it live and get a link to share.`);
  }

  /** The engine's hook when a task finishes. True when this file took charge of what happens next, so the manager isn't woken for it. */
  function afterTask(floor, agent, task, status, result) {
    const link = get(db, 'SELECT * FROM maker_tasks WHERE task_id=?', task.id);
    if (!link) return false;
    const j = get(db, 'SELECT * FROM maker_jobs WHERE id=?', link.job_id);
    if (!j || !OPEN.has(j.stage)) return true;
    const ok = status !== 'failed';
    if (ok) run(db, "UPDATE tasks SET status='done', updated_at=? WHERE id=? AND status='review'", now(), task.id);
    const st = stateOf(j);
    const report = link.step === 'test' && ok ? parseReport(readFile(db, floor.id, `projects/${j.project}/TEST-REPORT.md`)?.content || result) : null;
    const d = decide({ ...st, type: j.type, pass: link.pass, depth: j.depth, tokens: tokensSince(floor.id, j.started_at) }, { step: link.step, ok: link.step === 'test' ? ok && !!report : ok, report }, config);
    save(j, { pass: link.pass, stage: link.step === 'doc' ? 'build' : link.step === 'build' && ok ? 'test' : j.stage }, { ...d.patch, lastReport: report ? { verdict: report.verdict, summary: report.summary, bugs: report.bugs.length, pass: link.pass } : st.lastReport || null });
    if (report && d.passing) snapshot(j);
    const cancelPaired = () => { for (const t of all(db, "SELECT m.task_id id FROM maker_tasks m JOIN tasks t ON t.id=m.task_id WHERE m.job_id=? AND t.status IN ('todo','blocked')", j.id)) engine.cancelTask(floor, t.id); };
    try {
      if (d.action === 'wait') return true;
      if (d.action === 'redo-doc') { cancelPaired(); const doc = queue(floor, j, 'doc', 0, docBrief({ ...j, ...stateOf(j) }), DOC_ROLE[j.type]); const b = queue(floor, j, 'build', 0, buildBrief({ ...j, ...stateOf(j) }, 0, {}, config), 'builder', [doc]); queue(floor, j, 'test', 0, testBrief(j, 0, { computer: computerOn('tester') }, config), 'tester', [b]); return true; }
      if (d.action === 'retest') { queue(floor, j, 'test', d.pass, testBrief(j, d.pass, { computer: computerOn('tester') }, config), 'tester'); return true; }
      if (d.action === 'build') { cancelPaired(); queuePass(floor, j, d.pass, { bugs: d.bugs, regressions: d.regressions, unmet: d.unmet || [] }); return true; }
      cancelPaired();
      if (d.action === 'ready') { ready(floor, j, d.why).catch(() => {}); return true; }
      if (d.action === 'ask') { ask(floor, j, d.why); return true; }
    } catch (e) {
      // The floor's own limits (open tasks, tasks a day) can refuse a pass. Then it's the boss's call, not a silent stop.
      ask(floor, j, `the next pass couldn't start (${clip(e.message, 160)})`);
    }
    return true;
  }

  async function launch(floor) {
    const j = jobOf(floor.id);
    if (!j) throw new WorkspaceError('nothing has been made here yet');
    if (!stateOf(j).launchable) throw new WorkspaceError('no version has passed the Tester yet');
    const url = await publishTested(floor, j);
    save(j, { launched_at: j.launched_at || now(), ...(j.stage === 'asking' ? { stage: 'ready' } : {}) });
    const share = shareUrl(floor, j);
    engine.feed?.(floor.id, null, `${j.title} launched`, j.project);
    say(floor, `**${j.title} is live:** ${share}\nShare that link. Want it on its own .com? Ask me and I'll find one; you approve before anything is bought.`);
    return { url, share, view: view(floor) };
  }
  function decideAsk(floor, choice) {
    const j = jobOf(floor.id);
    if (!j || j.stage !== 'asking') throw new WorkspaceError('nothing is waiting for you');
    if (choice === 'stop') { save(j, { stage: 'stopped' }); say(floor, `Stopped work on ${j.title}. Everything made so far stays on the drive.`); return view(floor); }
    if (choice === 'retry') {
      const st = stateOf(j);
      save(j, {}, { fails: 0 });
      queuePass(floor, j, Math.min(j.pass + (st.lastPassing === j.pass ? 1 : 0), j.depth), { bugs: st.bugs || [], unmet: st.unmet || [] });
      say(floor, `Going again on ${j.title}, with the Tester's list.`);
      return view(floor);
    }
    throw new WorkspaceError('choose retry or stop');
  }

  function view(floor) {
    const j = jobOf(floor.id);
    const types = MAKER_TYPES.map((id) => ({ id, label: config.types[id].label, blurb: config.types[id].blurb }));
    if (!j) return { types, job: null };
    const st = stateOf(j);
    const tasks = all(db, 'SELECT m.step, m.pass, t.status FROM maker_tasks m JOIN tasks t ON t.id=m.task_id WHERE m.job_id=? ORDER BY m.task_id', j.id);
    const stepState = (step, pass) => { const ts = tasks.filter((t) => t.step === step && t.pass === pass); if (!ts.length) return 'todo'; const last = ts[ts.length - 1].status; return last === 'done' || last === 'review' ? 'done' : last === 'doing' ? 'doing' : last === 'failed' ? 'failed' : last === 'cancelled' ? 'skipped' : 'todo'; };
    const steps = [{ label: j.type === 'game' ? 'Design doc' : 'Spec', state: stepState('doc', 0) }, { label: j.type === 'game' ? 'Playable slice' : 'First version', state: stepState('build', 0) }, { label: 'Tested', state: stepState('test', 0) }];
    for (let p = 1; p <= j.depth; p++) steps.push({ label: `${j.type === 'game' ? 'Depth' : 'Polish'} pass ${p}`, state: stepState('test', p) === 'done' ? 'done' : stepState('build', p) === 'done' ? 'doing' : stepState('build', p) });
    return {
      types,
      job: {
        id: j.id, type: j.type, title: j.title, pitch: j.pitch, goal: j.goal, plan: parse(j.plan, []), project: j.project, stage: j.stage, pass: j.pass, depth: j.depth,
        launchable: !!st.launchable, launched: !!j.launched_at, url: j.launched_at ? shareUrl(floor, j) : '', steps,
        report: st.lastReport || null, asking: j.stage === 'asking' ? { why: st.asked || '', canLaunch: !!st.launchable } : null,
      },
    };
  }
  return { start, afterTask, launch, decideAsk, view, ideaCards: (type, floor, seed) => ideaCards(type, { floor, seed, cfg: config }), surprise: (type, seed) => surprise(type, { seed, cfg: config }), fromWords: (type, text) => fromWords(type, text, config), jobOf };
}

export function installMakers(ext) {
  const { db, cfg, engine, now, hooks, GET, POST, json, readJson, limit, requireOwner, HttpError } = ext;
  const makers = createMakers({ db, cfg, engine, now });
  engine.makers = makers;
  const wrap = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof WorkspaceError || e?.name === 'ToolError') throw new HttpError(400, 'maker', e.message); throw e; } };
  hooks.snapshot.push((f, viewer, out) => { if (viewer?.owner) out.makers = makers.view(f); });
  GET('/api/floors/:slug/makers/ideas', async ({ req, res, p, url }) => {
    const f = requireOwner(req, p.slug);
    const q = url?.searchParams || new URL(req.url, 'http://x').searchParams;
    const type = q.get('type');
    if (!MAKER_TYPES.includes(type)) throw new HttpError(400, 'type', 'pick a game, an app, a website or a business');
    const seed = Math.abs(Number(q.get('seed')) | 0);
    json(res, 200, { type, cards: makers.ideaCards(type, f, seed + f.id * 31), surprise: makers.surprise(type, seed + f.id * 31 + 1 + Math.floor(now() / 1000)) });
  });
  POST('/api/floors/:slug/makers/words', async ({ req, res, p, ip }) => {
    requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 4096);
    if (!MAKER_TYPES.includes(b.type)) throw new HttpError(400, 'type', 'pick a type first');
    if (!clip(b.text, 400)) throw new HttpError(400, 'text', 'say what you want to make');
    json(res, 200, { card: makers.fromWords(b.type, b.text) });
  });
  POST('/api/floors/:slug/makers/start', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    if (f.status !== 'active') throw new HttpError(409, 'inactive', 'this floor is not open');
    const b = await readJson(req, 8192);
    const v = await wrap(() => makers.start(f, b));
    json(res, 200, { makers: v });
  });
  POST('/api/floors/:slug/makers/launch', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const r = await wrap(() => makers.launch(f));
    json(res, 200, { url: r.share, makers: r.view });
  });
  POST('/api/floors/:slug/makers/decide', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 512);
    const v = await wrap(() => makers.decideAsk(f, String(b.choice || '')));
    json(res, 200, { makers: v });
  });
  return { stop() {} };
}
