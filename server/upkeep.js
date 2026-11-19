// Upkeep rounds (docs/redesign/OFFICE-ANSWERS-2.md, Q10 a; job r2-j63): every Tuesday from 09:00 New York time, every live site in the building
// gets its checks by code: broken links, load time on a phone, a form test entry, and its domain's renewal date. A model is called only when a check
// fails, as one small edit job for the Builder (a small job ships on the smoke check and its maker's self-check, no Tester: round 1 job 11).
// At most 3 fixes per site per week; after each fix the site is checked again. A domain due for renewal within 30 days is told to the boss once.
// Nothing outside the site (a business profile, a directory listing) is ever touched: that always needs the boss's tap, so upkeep only says so.
//
// Which floors: every open floor with a live public site, including floors switched out of weekly plans (round 1's `plan off`, like TheTireRx on
// floor 6, which is on upkeep only). A paused floor gets its checks and its report, but no fix job: a paused floor starts no work. Demo floors never.
// UPKEEP=0 stops it. No budget rule: the fix jobs cost what any job costs, on the ledger.
import { get, all, run } from './db.js';
import { wallClock } from './modes.js';
import { weekOf } from './weekplan.js';
import { runChecklist, absoluteLive, fetchLink, formTester } from './checklist.js';

const NY = 'America/New_York';
export const UPKEEP = { weekday: 2, fromMin: 9 * 60, fixesPerSiteWeek: 3, renewalDays: 30, yearMs: 365 * 86400000 };
const DAY = 86400000;
const SITE_KINDS = new Set(['site', 'app', 'game', 'simulation']);

/** Whether `at` is in the Tuesday upkeep window, New York time: Tuesday from 09:00 to midnight. */
export function upkeepDue(at) { const w = wallClock(NY, at); return w.weekday === UPKEEP.weekday && w.minutes >= UPKEEP.fromMin; }

export function installUpkeep(ext) {
  const { db, cfg, engine, now, log } = ext;
  const filesLive = (floorId, slug) => all(db, 'SELECT path, content FROM published_files WHERE floor_id=? AND project=?', floorId, slug).map((f) => ({ path: f.path, data: f.content }));
  /** The code checks for one live site: the three the spec names, from the launch checklist's own checks, on the files that are live. */
  async function checkSite(floor, slug) {
    const r = await runChecklist({ files: filesLive(floor.id, slug), liveUrl: absoluteLive(cfg, engine.liveUrl(floor, slug)), fetchUrl: cfg.checklistFetch || fetchLink, formTest: formTester(db, floor.id, slug, now()) });
    const pick = (id) => r.checks.find((c) => c.id === id);
    return { links: pick('links'), speed: pick('speed'), form: pick('form') };
  }
  const fixesThisWeek = (floorId, slug, week) => get(db, 'SELECT COUNT(*) n FROM upkeep_fixes WHERE floor_id=? AND project=? AND week=?', floorId, slug, week).n;
  /** A failing site gets one small edit job, within the week's 3. Returns the task id or null. */
  function fix(floor, slug, failed, week, at) {
    if (fixesThisWeek(floor.id, slug, week) >= UPKEEP.fixesPerSiteWeek) return null;
    const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id);
    if (!mgr) return null;
    const what = failed.map((c) => `${c.label}: ${c.note}`);
    const t = engine.assignTask(floor, mgr, {
      to: 'builder', size: 'small', plan: '', dependsOn: [], project: slug,
      title: `Upkeep: fix ${slug} (${failed.map((c) => c.label.toLowerCase()).join(', ')})`.slice(0, 160),
      brief: `This week's upkeep check of the live ${slug} found:\n${what.map((w) => `- ${w}`).join('\n')}\nFix only that, as a small edit, then publish ${slug} again. Change nothing else, and nothing outside the site.`,
      checks: failed.map((c) => (c.id === 'links' ? 'Every link on the main page goes somewhere real' : c.id === 'form' ? 'The form takes an entry' : 'The main page loads in under 3 s on a phone')),
    });
    run(db, 'INSERT INTO upkeep_fixes (floor_id, project, week, task_id, created_at) VALUES (?,?,?,?,?)', floor.id, slug, week, t.id, at);
    engine.kick?.();
    return t.id;
  }
  /** A domain bought about a year ago is due again: told to the boss once, 30 days ahead. Renewing is the boss's tap, never upkeep's. */
  function renewals(floor, at) {
    const out = [];
    for (const d of all(db, "SELECT id, domain, bought_at FROM domain_orders WHERE floor_id=? AND status='live' AND bought_at IS NOT NULL", floor.id)) {
      let due = d.bought_at + UPKEEP.yearMs; while (due < at) due += UPKEEP.yearMs;
      if (due - at > UPKEEP.renewalDays * DAY) continue;
      const key = `${d.id}:${due}`;
      if (run(db, 'INSERT OR IGNORE INTO upkeep_notices (floor_id, key, created_at) VALUES (?,?,?)', floor.id, key, at).changes) {
        engine.bossNotice?.(floor.id, `${d.domain} is due for renewal in ${Math.max(1, Math.round((due - at) / DAY))} days. Renewing is your call: say the word and your manager asks for it.`);
        out.push(d.domain);
      }
    }
    return out;
  }
  /** One floor's upkeep round. */
  async function round(floor, at, week) {
    const paused = !!engine.floorState?.(floor.id)?.paused;
    const sites = all(db, 'SELECT slug, kind FROM projects WHERE floor_id=? AND published_at IS NOT NULL AND private=0 ORDER BY slug', floor.id).filter((p) => SITE_KINDS.has(p.kind) && get(db, 'SELECT 1 x FROM published_files WHERE floor_id=? AND project=? LIMIT 1', floor.id, p.slug));
    const report = { at, paused, sites: [], renewals: renewals(floor, at) };
    for (const s of sites) {
      const c = await checkSite(floor, s.slug);
      const failed = Object.values(c).filter((x) => x && !x.ok);
      report.sites.push({ slug: s.slug, ok: !failed.length, failed: failed.map((x) => ({ id: x.id, note: x.note })), fix: failed.length && !paused ? fix(floor, s.slug, failed, week, at) : null });
    }
    const found = report.sites.filter((x) => !x.ok);
    if (found.length) engine.officeNotice?.(floor.id, `This week's upkeep check found ${found.length === 1 ? 'a problem' : 'problems'} on ${found.map((x) => x.slug).join(', ')}${paused ? '. The floor is paused, so nothing is being fixed until it resumes.' : ': one small fix job each is on the board.'}`);
    return report;
  }
  /** After a fix job finishes, its site is checked again; still failing, another fix (within the week's 3). */
  async function recheck(at) {
    for (const r of all(db, "SELECT u.*, t.status FROM upkeep_fixes u JOIN tasks t ON t.id=u.task_id WHERE u.checked_at IS NULL AND t.status IN ('done','review','failed','cancelled')")) {
      if (r.status === 'review' && get(db, "SELECT 1 x FROM tasks WHERE id=? AND status='review'", r.task_id) && at - (get(db, 'SELECT updated_at u FROM tasks WHERE id=?', r.task_id)?.u || 0) < 30000) continue;  // give the manager a moment to ship it
      const floor = get(db, 'SELECT * FROM floors WHERE id=?', r.floor_id);
      if (!floor) continue;
      const c = await checkSite(floor, r.project);
      const failed = Object.values(c).filter((x) => x && !x.ok);
      run(db, 'UPDATE upkeep_fixes SET checked_at=?, fixed=? WHERE id=?', at, failed.length ? 0 : 1, r.id);
      if (failed.length && !engine.floorState?.(floor.id)?.paused) fix(floor, r.project, failed, r.week, at);
    }
  }
  /** The tick: Tuesday from 09:00 New York, each open floor once a week; and the re-checks after fixes, any time. */
  async function tick(at = now()) {
    if (cfg.upkeep === false) return [];
    const done = [];
    if (upkeepDue(at)) {
      const week = weekOf(at);
      for (const floor of all(db, "SELECT * FROM floors WHERE status='active' AND filler=0 ORDER BY number")) {
        if (!run(db, 'INSERT OR IGNORE INTO upkeep_runs (floor_id, week, ran_at, report) VALUES (?,?,?,?)', floor.id, week, at, '{}').changes) continue;
        try {
          const report = await round(floor, at, week);
          run(db, 'UPDATE upkeep_runs SET report=? WHERE floor_id=? AND week=?', JSON.stringify(report), floor.id, week);
          done.push({ floor: floor.number, ...report });
        } catch (e) { log?.('warn', 'upkeep', { floor: floor.number, err: String(e?.message || e).slice(0, 160) }); }
      }
    }
    await recheck(at);
    return done;
  }
  ext.upkeepTick = tick;
  let timer = null, busy = false;
  return {
    tick,
    start() { if (cfg.upkeep === false) return; timer = setInterval(() => { if (busy) return; busy = true; tick().catch((e) => log?.('warn', 'upkeep', { err: String(e?.message || e).slice(0, 160) })).finally(() => { busy = false; }); }, cfg.upkeepTickMs || 60000); timer.unref?.(); },
    stop() { clearInterval(timer); timer = null; },
  };
}
