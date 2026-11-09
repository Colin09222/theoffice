// The "pressure" done-rule for games: a player who does nothing is hurt and then loses within the bars, and never loses in the first seconds.
// The idle run is driven here by a made-up game on a made-up clock, so no browser is needed; test/browser/makers.mjs times the real starters.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GAME_BARS, idleVerdict, idleRun } from '../server/playtest.js';
import { parseReport, decide, loadMakersConfig, buildBrief, testBrief, docBrief, starterFiles } from '../server/makers.js';
import { laneBrief } from '../server/prompts.js';

const CFG = loadMakersConfig();
const GAME = CFG.types.game;

/**
 * A game for the idle run to watch. script(t) gives the hook's state at t seconds of play; speed is how fast the game's clock runs
 * against real time; a choice screen opens at each time in picks and waits until its first option is clicked.
 */
function fakeGame(script, { speed = 1, picks = [], clockInHook = true } = {}) {
  let wall = 0, play = 0, last = 0, picking = false; const todo = [...picks]; let clicks = 0;
  const advance = () => { const step = wall - last; last = wall; if (!picking) play += (step / 1000) * speed; if (!picking && todo.length && play >= todo[0]) { todo.shift(); picking = true; } };
  return {
    now: () => wall,
    sleep: async (ms) => { wall += ms; },
    clicks: () => clicks,
    driver: {
      evaluate: async (expr) => {
        advance();
        if (/data-pick/.test(expr)) { if (picking) { picking = false; clicks++; } return true; }
        const s = script(play);
        if (!s) return null;
        return { scene: picking && s.scene === 'play' ? 'pick' : s.scene, ...(clockInHook ? { t: Math.round(play * 10) / 10 } : {}), ...s.more };
      },
    },
  };
}
const run = (game, o = {}) => idleRun(game.driver, { now: game.now, sleep: game.sleep, ...o });
const near = (v, want, slack = 0.5) => assert.ok(v !== null && Math.abs(v - want) <= slack, `${v} is not about ${want}`);
// Three lives, one lost at each time in hits, and game over with the last.
const lives = (hits, { won = false } = {}) => (t) => { const left = 3 - hits.filter((h) => t >= h).length; return left > 0 ? { scene: 'play', more: { lives: left } } : { scene: 'over', more: { won } }; };

describe('the pressure rule is in the config, and the browser half holds the same bars', () => {
  test('a browser rule for games, with bars the rule text names', () => {
    const rule = GAME.doneRules.find((r) => r.id === 'pressure');
    assert.ok(rule); assert.equal(rule.check, 'browser');
    const { idleHurtSeconds, idleLoseSeconds, idleSafeSeconds } = GAME.bars;
    assert.ok(idleSafeSeconds < idleHurtSeconds && idleHurtSeconds <= idleLoseSeconds, 'safe, then hurt, then lost');
    assert.ok(idleSafeSeconds >= 10, 'nobody loses in the first ten seconds'); assert.ok(idleHurtSeconds <= 30, 'trouble within half a minute'); assert.ok(idleLoseSeconds <= 60);
    for (const n of [idleHurtSeconds, idleLoseSeconds, idleSafeSeconds]) assert.match(rule.text, new RegExp(`\\b${n} s\\b`));
    for (const type of ['app', 'website']) assert.ok(!CFG.types[type].doneRules.some((r) => r.id === 'pressure'));
  });
  test('server/playtest.js runs on a computer without the config, so its own numbers have to match it', () => {
    for (const k of Object.keys(GAME_BARS)) assert.equal(GAME_BARS[k], GAME.bars[k], k);
  });
});

describe('the verdict from an idle run\'s numbers', () => {
  const v = (idle) => idleVerdict(idle, GAME.bars);
  test('hurt and lost inside the bars passes', () => {
    assert.equal(v({ hurt: 12, lose: 22, watched: 22, tellsHurt: true }).ok, true);
    assert.equal(v({ hurt: 30, lose: 60, watched: 60, tellsHurt: true }).ok, true, 'the bars themselves pass');
    assert.equal(v({ hurt: 10, lose: 10, watched: 10, tellsHurt: true }).ok, true, 'a loss at ten seconds is not inside the first ten');
  });
  test('too gentle fails, with the number in the note', () => {
    const late = v({ hurt: 41, lose: 55, watched: 55, tellsHurt: true });
    assert.equal(late.ok, false); assert.match(late.notes.join(' '), /first hurt after 41 s/);
    const alive = v({ hurt: 20, lose: null, watched: 60, tellsHurt: true });
    assert.equal(alive.ok, false); assert.match(alive.notes.join(' '), /still alive after 60 s/);
    assert.equal(v({ hurt: 20, lose: 72, watched: 72, tellsHurt: true }).ok, false, 'the last real game: 72 seconds');
    assert.equal(v({ hurt: null, lose: null, watched: 60, tellsHurt: true }).ok, false);
    assert.match(v({ hurt: null, lose: 45, watched: 45, tellsHurt: true }).notes.join(' '), /not hurt in the first 30 s/, 'a hook that shows lives and never showed one lost');
  });
  test('too harsh fails: nobody loses in the first ten seconds', () => {
    const fast = v({ hurt: 3, lose: 8.5, watched: 8.5, tellsHurt: true });
    assert.equal(fast.ok, false); assert.match(fast.notes.join(' '), /lost after 8\.5 s/);
  });
  test('doing nothing must never win', () => {
    assert.equal(v({ hurt: null, lose: 40, won: true, watched: 40, tellsHurt: true }).ok, false);
  });
  test('a hook with no lives, health or hurts is judged on game over alone, and says so', () => {
    const old = v({ hurt: null, lose: 45, watched: 45, tellsHurt: false });
    assert.equal(old.ok, true); assert.match(old.notes.join(' '), /time to first hurt is unknown/);
    assert.equal(v({ hurt: null, lose: null, watched: 60, tellsHurt: false }).ok, false, 'still alive at the bar fails either way');
    assert.equal(v({ hurt: null, lose: 20, watched: 20, tellsHurt: false }).notes.length, 0, 'lost inside the hurt bar, so hurt inside it too');
  });
  test('a run cut short is unknown, not a failure', () => {
    assert.equal(v({ hurt: null, lose: null, watched: 14, tellsHurt: true }).ok, null);
    assert.equal(v({ hurt: 12, lose: null, watched: 25, tellsHurt: true }).ok, null);
    assert.equal(v({ hurt: null, lose: null, watched: 14, tellsHurt: false }).ok, null);
    assert.equal(v(null).ok, null);
    assert.equal(v({ hurt: 12, lose: 8, watched: 8, tellsHurt: true }).ok, false, 'but what was seen still counts');
  });
});

describe('the idle run: no input, timed until hurt and until game over', () => {
  test('lives going down is the first hurt, and game over ends it', async () => {
    const r = await run(fakeGame(lives([12, 17, 22])));
    near(r.hurt, 12); near(r.lose, 22); assert.equal(r.won, false); assert.equal(r.tellsHurt, true); assert.equal(r.clock, 'game');
    assert.equal(idleVerdict(r, GAME.bars).ok, true);
  });
  test('health and the kit\'s hurts count are read the same way', async () => {
    const health = await run(fakeGame((t) => (t < 25 ? { scene: 'play', more: { health: t < 9 ? 100 : 60 } } : { scene: 'over' })));
    near(health.hurt, 9); near(health.lose, 25);
    const hurts = await run(fakeGame((t) => (t < 30 ? { scene: 'play', more: { hurts: t < 14 ? 0 : 1 } } : { scene: 'over' })));
    near(hurts.hurt, 14); assert.equal(hurts.tellsHurt, true);
    const healed = await run(fakeGame((t) => (t < 40 ? { scene: 'play', more: { lives: t < 5 ? 3 : t < 20 ? 4 : 3 } } : { scene: 'over' })));
    near(healed.hurt, 20, 0.5); assert.ok(healed.hurt > 19, 'a life gained is not a hurt');
  });
  test('a game too gentle is watched to the lose bar and no further', async () => {
    const g = fakeGame(lives([41, 58, 72]));
    const r = await run(g);
    near(r.hurt, 41); assert.equal(r.lose, null); near(r.watched, GAME.bars.idleLoseSeconds, 0.5);
    assert.ok(g.now() < (GAME.bars.idleLoseSeconds + 2) * 1000, 'it does not add minutes');
    assert.equal(idleVerdict(r, GAME.bars).ok, false);
  });
  test('an older hook with no lives falls back to the time to game over', async () => {
    const r = await run(fakeGame((t) => (t < 33 ? { scene: 'play' } : { scene: 'over' })));
    assert.equal(r.hurt, null); assert.equal(r.tellsHurt, false); near(r.lose, 33);
    assert.equal(idleVerdict(r, GAME.bars).ok, true);
    const noClock = await run(fakeGame((t) => (t < 33 ? { scene: 'play' } : { scene: 'over' }), { clockInHook: false }));
    near(noClock.lose, 33); assert.equal(noClock.clock, 'real', 'and a hook with no clock is timed in real time');
  });
  test('a choice screen waits for the player, so its time is not counted and its first option is picked', async () => {
    const g = fakeGame(lives([12, 17, 22]), { picks: [8, 15] });
    const r = await run(g);
    assert.equal(g.clicks(), 2); assert.equal(r.picks >= 2, true); near(r.hurt, 12); near(r.lose, 22);
  });
  test('on a slow machine the game\'s own clock is used, and a run it can\'t finish is unknown rather than failed', async () => {
    const half = await run(fakeGame(lives([12, 17, 22]), { speed: 0.5 }));
    near(half.hurt, 12); near(half.lose, 22); assert.equal(half.clock, 'game'); near(half.speed, 0.5, 0.05);
    const crawl = await run(fakeGame(lives([12, 17, 72]), { speed: 0.1 }));
    near(crawl.hurt, 12); assert.equal(crawl.lose, null); assert.ok(crawl.watched < GAME.bars.idleHurtSeconds, 'real time ran out first');
    assert.equal(idleVerdict(crawl, GAME.bars).ok, null);
    const slowAndGentle = await run(fakeGame(lives([41, 58, 72]), { speed: 0.25 }));
    assert.ok(slowAndGentle.watched > GAME.bars.idleHurtSeconds && slowAndGentle.watched < GAME.bars.idleLoseSeconds);
    assert.equal(idleVerdict(slowAndGentle, GAME.bars).ok, false, 'but what its own clock did show still counts: nobody was hurt in the first 30 s of play');
  });
  test('a clock in the hook that runs ahead of real time is not believed', async () => {
    const r = await run(fakeGame((t) => (t < 20 ? { scene: 'play', more: { lives: 3, t: t * 1000 } } : { scene: 'over', more: { t: t * 1000 } })));
    assert.equal(r.clock, 'real'); near(r.lose, 20);
  });
  test('a win, a freeze and a page that dies are all reported', async () => {
    const won = await run(fakeGame(lives([12, 17, 22], { won: true })));
    assert.equal(won.won, true); assert.equal(idleVerdict(won, GAME.bars).ok, false);
    const frozen = await run(fakeGame(() => ({ scene: 'play', more: { lives: 3, t: 4 } })));
    assert.match(frozen.softlock, /froze/);
    const gone = await run(fakeGame((t) => (t < 3 ? { scene: 'play' } : null)));
    assert.match(gone.softlock, /state went away/);
  });
});

describe('the loop acts on the pressure rule', () => {
  const job = (o = {}) => ({ type: 'game', pass: 0, depth: 3, fails: 0, best: {}, launchable: false, tokens: 0, ...o });
  const browser = Object.fromEntries(GAME.doneRules.map((r) => [r.id, r.check === 'browser' || r.serious === 'major']));
  const report = (o = {}) => ({ step: 'test', ok: true, report: { verdict: 'pass', rules: browser, bugs: [], regressions: [], ...o } });
  test('the report carries the two numbers', () => {
    const r = parseReport('x\n```office-verdict\n{"verdict":"pass","rules":{"pressure":true},"idle":{"hurt":12.34,"lose":"22"},"bugs":[]}\n```');
    assert.deepEqual(r.idle, { hurt: 12.3, lose: null }, 'numbers only');
    assert.equal(parseReport('x\n```office-verdict\n{"verdict":"pass","rules":{}}\n```').idle, null);
    assert.deepEqual(parseReport('x\n```office-verdict\n{"verdict":"pass","idle":{"hurt":-1,"lose":61}}\n```').idle, { hurt: null, lose: 61 });
  });
  test('a failing pressure rule is a failing browser rule: Launch is held and a fix pass follows', () => {
    const d = decide(job(), report({ rules: { ...browser, pressure: false }, idle: { hurt: 41, lose: null } }));
    assert.equal(d.passing, false); assert.equal(d.action, 'build'); assert.equal(d.fix, true); assert.equal(d.pass, 0); assert.equal(d.patch.launchable, false);
    const bug = d.bugs.find((b) => /A player who does nothing/.test(b.text));
    assert.equal(bug.severity, 'blocker'); assert.match(bug.text, /first hurt after 41 s/);
    assert.match(buildBrief({ type: 'game', title: 'T', depth: 3 }, d.pass, d), /Fix pass[\s\S]*\[blocker\] Done-rule failing: A player who does nothing[\s\S]*41 s/);
  });
  test('the numbers decide it, whatever the Tester ticked', () => {
    const gentle = decide(job(), report({ idle: { hurt: 20, lose: 72 } }));
    assert.equal(gentle.passing, false); assert.equal(gentle.fix, true); assert.match(gentle.bugs[0].text, /lasted 72 s/);
    assert.equal(gentle.patch.best.pressure, undefined, 'and it is not remembered as having passed');
    const harsh = decide(job(), report({ idle: { hurt: 2, lose: 6 } }));
    assert.equal(harsh.passing, false); assert.match(harsh.bugs[0].text, /lost after 6 s/);
    const slowHurt = decide(job(), report({ rules: { ...browser, pressure: null }, idle: { hurt: 44, lose: 50 } }));
    assert.equal(slowHurt.passing, false);
  });
  test('numbers inside the bars pass, and so does a report with none', () => {
    const good = decide(job(), report({ idle: { hurt: 12, lose: 22 } }));
    assert.equal(good.passing, true); assert.equal(good.action, 'build'); assert.equal(good.pass, 1); assert.equal(good.patch.best.pressure, true);
    assert.equal(decide(job(), report()).passing, true);
    assert.equal(decide(job(), report({ idle: { hurt: null, lose: null } })).passing, true);
    const unknown = decide(job(), report({ rules: { ...browser, pressure: null }, idle: null }));
    assert.equal(unknown.passing, true, 'unknown (no browser) does not block, like the other browser rules');
  });
  test('pressure that passed and then failed is a regression', () => {
    const d = decide(job({ pass: 2, best: { pressure: true }, launchable: true, lastPassing: 1 }), report({ rules: { ...browser, pressure: false }, idle: { hurt: 35, lose: 50 } }));
    assert.ok(d.regressions.some((x) => /A player who does nothing.*worked before and broke/.test(x))); assert.equal(d.patch.lastPassing, 1);
  });
  test('idle numbers on a job with no pressure rule change nothing', () => {
    const site = { type: 'website', pass: 1, depth: 3, fails: 0, best: {}, launchable: false, tokens: 0 };
    const all = Object.fromEntries(CFG.types.website.doneRules.map((r) => [r.id, true]));
    assert.equal(decide(site, report({ rules: all, idle: { hurt: 99, lose: 99 } })).action, 'ready');
  });
});

describe('the briefs and prompts name the rule, the bars and the two numbers', () => {
  const FULL = { appsBaseDomain: 'apps.example', computerEnabled: true };
  test('the Builder\'s and Tester\'s briefs are built from the config', () => {
    const b = buildBrief({ type: 'game', title: 'T', depth: 3 }, 1), t = testBrief({ type: 'game', title: 'T' }, 1, { computer: true });
    for (const brief of [b, t]) { assert.match(brief, /- pressure: A player who does nothing/); assert.match(brief, /idleHurtSeconds 30, idleLoseSeconds 60, idleSafeSeconds 10/); }
    assert.match(t, /"pressure": true/); assert.match(t, /"idle": \{"hurt": /); assert.match(t, /no input/); assert.match(t, /idle field of playtest\.json/);
    assert.ok(t.indexOf('"rules"') < t.indexOf('"idle"'));
    assert.doesNotMatch(testBrief({ type: 'game', title: 'T' }, 1, { computer: false }), /playtest\.json/);
    assert.doesNotMatch(testBrief({ type: 'app', title: 'T' }, 1, { computer: true }), /"idle"|idle run/);
    assert.match(docBrief({ type: 'game', title: 'T', pitch: 'p' }), /a player who does nothing: first hurt within 30 s and lost within 60 s, though nobody loses in the first 10 s/, 'the design doc plans for it');
    const other = { ...CFG, types: { ...CFG.types, game: { ...GAME, bars: { ...GAME.bars, idleSafeSeconds: 7 } } } };
    assert.match(testBrief({ type: 'game', title: 'T' }, 1, { computer: true }, other), /inside the first 7 s/, 'a change in the config reaches the brief');
  });
  test('the game playbook tells the Builder to time it and the Tester to report it', () => {
    const b = laneBrief('game', 'builder', FULL), t = laneBrief('game', 'tester', FULL);
    assert.match(b, /send no input at all/); assert.match(b, /hurt within 30 seconds and lost within 60, and never lost inside the first 10/); assert.match(b, /give both numbers in your reply/);
    assert.match(b, /\.office\/playtest\.mjs project --type game/);
    assert.match(t, /no input at all and report two numbers/); assert.match(t, /Over 30 to be hurt or over 60 to lose/); assert.match(t, /inside the first 10/);
    const bare = laneBrief('game', 'builder', { appsBaseDomain: 'apps.example' });
    assert.doesNotMatch(bare, /playtest\.mjs/, 'nobody is told to run a script without a computer'); assert.match(bare, /hurt within 30 seconds and has lost within 60/, 'but the bar is still in what makes it good');
  });
});

describe('the starters and the test hook', () => {
  const file = (starter, path) => starterFiles(starter).find((f) => f.path === path).data;
  test('the kit\'s hook says when the player is hurt and whether the run was won', () => {
    const kit = file('game-2d', 'kit.js');
    assert.match(kit, /export const playerHurt = /); assert.match(kit, /hurts: state\.hurts, won: state\.won/); assert.match(kit, /state\.hurts = 0; state\.won = false;/);
    const doc = file('game-2d', 'STARTER.md');
    assert.match(doc, /playerHurt\(\)/); assert.match(doc, /hurt within 30 s, lost within 60 s, and never lost in the first 10 s/);
  });
  test('both games count each hurt, show lives, and keep an idle player under pressure from the start', () => {
    for (const starter of ['game-2d', 'game-3d']) {
      const game = file(starter, 'game.js');
      assert.match(game, /playerHurt\(\)/, starter); assert.match(game, /lives: w\.player\.hp/, starter);
      const first = Number(game.match(/const STRIKE = \{ first: ([\d.]+), warn: ([\d.]+)/)?.[1]), warn = Number(game.match(/const STRIKE = \{ first: ([\d.]+), warn: ([\d.]+)/)?.[2]);
      assert.ok(first + warn > GAME.bars.idleSafeSeconds && first + warn < GAME.bars.idleHurtSeconds, `${starter}: the first strike lands after the safe time and well inside the hurt bar`);
    }
  });
  test('waiting for a scene really tests the scene', () => {
    // `window.officeGame ? state() : null?.scene === 'play'` is the state itself, always true: "restart works" and "pause is reachable" were never checked.
    const expr = readFileSync(new URL('../server/playtest.js', import.meta.url), 'utf8').match(/const STATE = '([^']+)';/)[1];
    const at = (scene) => Function('window', `return ${expr}?.scene === 'play'`)({ officeGame: { state: () => ({ scene }) } });
    assert.equal(at('play'), true); assert.equal(at('menu'), false); assert.equal(at('over'), false);
    assert.equal(Function('window', `return ${expr}?.scene === 'play'`)({}), false, 'and no hook is not a scene');
  });
  test('the copy on a computer is the browser half plus its command line, and it prints the idle numbers', () => {
    const box = readFileSync(new URL('../server/playtest-box.mjs', import.meta.url), 'utf8');
    // The two files become one module on a computer, so a name declared in both would stop the Tester's browser half from starting at all.
    const dir = mkdtempSync(join(tmpdir(), 'playtest-')), one = join(dir, 'playtest.mjs');
    writeFileSync(one, `${readFileSync(new URL('../server/playtest.js', import.meta.url), 'utf8')}\n${box}`);
    const checked = spawnSync(process.execPath, ['--check', one], { encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
    assert.equal(checked.status, 0, checked.stderr.slice(0, 400));
    assert.match(box, /idle: \{ hurt: slowest\('hurt'\), lose: slowest\('lose'\)/);
  });
});
