// Alerts to the owner, and his daily digest (docs/redesign/OFFICE-ANSWERS-1.md, Q8 "Alerts to Colon"; job 6).
// One digest a day at 08:05 New York time, right after the night freeze lifts: spend yesterday by floor, both pots left, weeks of runway at the last
// 7 days' pace, launches, stuck jobs and decisions waiting. Then only five things reach him at once: the building pot passes 80%; it passes 95%; a
// floor hits its stop; a task is ended at its cap (job 7); a purchase request arrives. Each fires once and does not repeat until its state changes
// (owner_alert_state). The 50% flag and every repeating alert are retired. Delivery is the OpenClaw gateway hook the contractor ping uses, delivered to
// the owner's chat. No model is called here. OWNER_ALERTS=0 and OWNER_DIGEST=0 switch them off.
import { randomUUID } from 'node:crypto';
import { get, all, run } from './db.js';
import { newFence } from './help.js';
import { PROVIDERS } from './budget.js';
import { wallClock } from './modes.js';
import { wallToUtc } from './orders.js';
import { OWNER_TZ, dayStart, weekStart } from './spendcheck.js';

const RETRY = new Set([408, 425, 429, 500, 502, 503, 504]);
const POT_LINES = [95, 80];
const POT_NAME = { anthropic: 'Anthropic (Claude)', openrouter: 'OpenRouter' };
const LIMIT = { anthropic: 'budgetAnthropicUsd', openrouter: 'budgetOpenrouterUsd' };
const STOP = { anthropic: 'claudeStopUsd', openrouter: 'openrouterStopUsd' };
const usd = (n) => `$${Number(n).toFixed(2)}`;
const HOUR = 3600000, DAY = 86400000;
export const ownerKey = (key) => `theoffice-owner-alert-${key}`;

/** POST one message for the owner through the gateway hook, delivered to his chat. Retries a busy gateway with the same key. Never throws. */
export async function sendOwner(cfg, key, { name, text, floorName = null }, { httpFetch = fetch, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!cfg.hookUrl || !cfg.hookToken) { log('warn', 'owner alert not sent: OPENCLAW_HOOK_URL or OPENCLAW_HOOK_TOKEN is not set', { key }); return { skipped: true }; }
  const fence = newFence();
  const message = [fence.notice, '', 'The Office, for Colon. Send him the lines below as one message, word for word, then stop. Do nothing else about it.', '',
    floorName === null ? text : text.replace('{floor}', fence.wrap('floor name', floorName))].join('\n');
  const body = JSON.stringify({ message, name, agentId: cfg.hookAgentId || 'main', sessionMode: 'isolated', deliver: true, channel: cfg.hookChannel, to: cfg.hookTo });
  const headers = { authorization: `Bearer ${cfg.hookToken}`, 'content-type': 'application/json', 'idempotency-key': ownerKey(key) };
  let status = 0;
  for (let i = 0; i < (cfg.hookTries ?? 5); i++) {
    if (i) await sleep((cfg.hookRetryMs ?? 2000) * 2 ** (i - 1));
    try {
      const res = await httpFetch(cfg.hookUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
      status = res.status;
      await res.text().catch(() => '');
      if (res.ok) { log('info', 'owner alert accepted', { key, status }); return { ok: true, status }; }
      if (!RETRY.has(status)) break;
    } catch (e) { status = 0; log('warn', 'owner alert attempt failed', { key, err: String(e?.name || 'error') }); }
  }
  log('error', 'owner alert gave up', { key, status });
  return { ok: false, status };
}

/** Where a building pot stands against the 80% and 95% lines: '95', '80' or 'none'. */
export function potLine(db, cfg, p) {
  const cap = cfg[LIMIT[p]];
  if (!Number.isFinite(cap) || cap <= 0) return { line: 'none', percent: null, spent: 0, cap: null };
  const spent = get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE provider=?', p).n;
  const percent = spent / cap * 100;
  return { line: String(POT_LINES.find((l) => percent >= l) ?? 'none'), percent, spent, cap };
}

/** The digest's numbers for the owner's day before `at`. Floor names come back raw: the caller fences them. */
export function digestFacts(db, cfg, at, { budget = null } = {}) {
  const today = dayStart(at), yesterday = dayStart(at, 1), week = at - 7 * DAY;
  const floors = all(db, `SELECT f.id, f.number, f.name, COALESCE(SUM(l.cost_usd),0) usd FROM ledger l JOIN floors f ON f.id=l.floor_id
    WHERE l.provider!='' AND l.created_at>=? AND l.created_at<? GROUP BY f.id HAVING usd>0 ORDER BY usd DESC`, yesterday, today);
  const pots = PROVIDERS.map((p) => {
    const cap = cfg[LIMIT[p]];
    const spent = get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE provider=?', p).n;
    const pace = get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE provider=? AND created_at>=? AND created_at<?', p, week, at).n;
    const left = Number.isFinite(cap) ? Math.max(0, cap - spent) : null;
    return { provider: p, left, cap: Number.isFinite(cap) ? cap : null, weekUsd: pace, runwayWeeks: left === null ? null : pace > 0 ? left / pace : Infinity };
  });
  const launches = all(db, "SELECT p.title, p.slug, f.number, f.name FROM projects p JOIN floors f ON f.id=p.floor_id WHERE f.filler=0 AND p.private=0 AND p.published_at>=? AND p.published_at<? ORDER BY p.published_at", yesterday, today);
  // Stuck: held for the contractor, waiting on the boss, or not moved for six hours while open; and anything that failed yesterday.
  const stuck = all(db, `SELECT t.id, t.title, t.status, t.contractor, t.updated_at, f.number, f.name FROM tasks t JOIN floors f ON f.id=t.floor_id WHERE f.filler=0 AND f.status='active'
    AND ((t.status IN ('todo','doing','blocked') AND t.updated_at<?) OR (t.status='failed' AND t.updated_at>=? AND t.updated_at<?)) ORDER BY t.id LIMIT 20`, at - 6 * HOUR, yesterday, today);
  const purchases = get(db, "SELECT COUNT(*) n FROM purchases WHERE status='pending'").n;
  const help = get(db, "SELECT 1 x FROM sqlite_master WHERE type='table' AND name='help_requests'") ? get(db, "SELECT COUNT(*) n FROM help_requests WHERE status='pending'").n : 0;
  const held = get(db, "SELECT COUNT(*) n FROM contractor_jobs WHERE status='held'").n;
  const stopped = budget ? all(db, "SELECT id, number, name FROM floors WHERE status='active' AND filler=0").filter((f) => PROVIDERS.some((p) => { const s = budget.floorStatus(f.id); const spent = p === 'anthropic' ? s.claudeUsd : s.openrouterUsd; return spent >= s[STOP[p]]; })) : [];
  // Floors the owner doubled down on in the ranked view (job 26): named first, so he sees them every morning. A mark only, no cap.
  const priority = get(db, "SELECT 1 x FROM sqlite_master WHERE type='table' AND name='floor_marks'") ? all(db, "SELECT f.number, f.name FROM floor_marks m JOIN floors f ON f.id=m.floor_id WHERE m.priority=1 AND f.status!='killed' ORDER BY f.number") : [];
  // Tapped calls this week (job 33), one figure for each business floor: a floor running a business journey or business work, or with a tap.
  const hasTable = (t) => !!get(db, "SELECT 1 x FROM sqlite_master WHERE type='table' AND name=?", t);
  const calls = hasTable('tel_taps') ? all(db, `SELECT f.id, f.number, f.name, (SELECT COUNT(*) FROM tel_taps x WHERE x.floor_id=f.id AND x.created_at>=? AND x.created_at<?) n FROM floors f
    WHERE f.status='active' AND f.filler=0 ORDER BY f.number`, weekStart(at), at).filter((f) => f.n > 0
      || (hasTable('business_journeys') && get(db, "SELECT 1 x FROM business_journeys WHERE floor_id=? AND status='active'", f.id))
      || get(db, "SELECT lane FROM tasks WHERE floor_id=? AND lane!='' ORDER BY id DESC LIMIT 1", f.id)?.lane === 'business').map(({ number, name, n }) => ({ number, name, n })) : [];
  return { yesterday, floors, pots, launches, stuck, priority, calls, decisions: { purchases, help, contractorHeld: held, floorsStopped: stopped } };
}

const runway = (w) => (w === null ? 'no cap' : w === Infinity ? 'nothing spent in the last 7 days' : `${w.toFixed(1)} weeks at the last 7 days' pace`);
/** The digest as the owner reads it. Floor names and titles were written by floors, so they are fenced. */
export function digestText(facts, fence) {
  const day = new Date(facts.yesterday + 12 * HOUR).toISOString().slice(0, 10);
  const name = (n) => fence.wrap('floor name', n);
  const total = facts.floors.reduce((s, f) => s + f.usd, 0);
  const lines = [`The Office, daily digest for ${day}.`, ''];
  if (facts.priority?.length) lines.push(`Priority floors (double down): ${facts.priority.map((f) => `floor ${f.number} ${name(f.name)}`).join(', ')}.`, '');
  lines.push(`Spent yesterday: ${usd(total)}.`);
  for (const f of facts.floors) lines.push(`- Floor ${f.number} ${name(f.name)}: ${usd(f.usd)}`);
  lines.push('', 'Pots:');
  for (const p of facts.pots) lines.push(`- ${POT_NAME[p.provider]}: ${p.left === null ? 'no cap' : `${usd(p.left)} left of ${usd(p.cap)}`}, ${runway(p.runwayWeeks)}.`);
  lines.push('', facts.launches.length ? `Went live yesterday: ${facts.launches.map((l) => `floor ${l.number} ${fence.wrap('title', l.title)}`).join(', ')}.` : 'Nothing went live yesterday.');
  if (facts.calls?.length) lines.push(`Calls tapped this week: ${facts.calls.map((f) => `floor ${f.number} ${name(f.name)} ${f.n}`).join('; ')}.`);
  lines.push(facts.stuck.length ? `Stuck jobs (${facts.stuck.length}):` : 'No stuck jobs.');
  for (const t of facts.stuck) lines.push(`- Floor ${t.number} task #${t.id} [${t.contractor && t.status === 'blocked' ? 'with the contractor' : t.status}] ${fence.wrap('task title', t.title)}`);
  const d = facts.decisions;
  const waiting = [d.purchases && `${d.purchases} purchase request${d.purchases > 1 ? 's' : ''}`, d.help && `${d.help} help request${d.help > 1 ? 's' : ''}`, d.contractorHeld && `${d.contractorHeld} contractor job${d.contractorHeld > 1 ? 's' : ''} held`, d.floorsStopped.length && `floor${d.floorsStopped.length > 1 ? 's' : ''} at their stop: ${d.floorsStopped.map((f) => f.number).join(', ')}`].filter(Boolean);
  lines.push(waiting.length ? `Decisions waiting: ${waiting.join('; ')}.` : 'Nothing needs you.');
  return lines.join('\n');
}

/** The digest time today, in the owner's zone, as a UTC instant. */
export function digestAt(cfg, at) {
  const [hh, mm] = String(cfg.digestAt || '08:05').split(':').map(Number);
  const w = wallClock(OWNER_TZ, at);
  return wallToUtc(OWNER_TZ, w.y, w.m, w.d, hh, mm);
}

/**
 * The alerts and the digest. Each check is cheap and returns at once; the POSTs run behind it. idle() resolves when nothing is in flight.
 * `budget` is the engine's (floor stops); `now` is the clock.
 */
export function createOwnerAlerts({ db, cfg, budget = null, now = Date.now, log = () => {}, httpFetch }) {
  const flying = new Set();
  const on = () => cfg.ownerAlerts !== false;
  const send = (key, msg) => {
    const p = sendOwner(cfg, key, msg, { httpFetch, log }).then((r) => { run(db, 'UPDATE owner_alerts SET status=? WHERE key=?', r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', key); return r; })
      .catch((e) => log('error', 'owner alert failed', { key, err: String(e?.message || e) })).finally(() => flying.delete(p));
    flying.add(p);
    return p;
  };
  /** Fires when a thing's state moves to one worth telling, once per change. Returns true if it fired. */
  function changed(scope, state, tell, msg) {
    const was = get(db, 'SELECT state FROM owner_alert_state WHERE scope=?', scope)?.state ?? null;
    if (was === state) return false;
    run(db, 'INSERT INTO owner_alert_state (scope,state,updated_at) VALUES (?,?,?) ON CONFLICT(scope) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at', scope, state, now());
    if (!tell || !on()) return false;
    const key = `${scope}:${state}:${randomUUID().slice(0, 8)}`;  // one key per change, the same for every retry of it
    run(db, 'INSERT INTO owner_alerts (key,kind,text,created_at) VALUES (?,?,?,?)', key, scope.split(':')[0], msg.text, now());
    send(key, msg);
    return true;
  }
  const quietly = (what, fn) => { try { return fn(); } catch (e) { log('warn', 'owner alert check failed', { what, err: String(e?.message || e) }); return false; } };
  const order = { none: 0, 80: 1, 95: 2 };

  return {
    /** After every ledger row: the building pots, and this floor's stop. */
    charged(floorId) {
      quietly('charged', () => {
        for (const p of PROVIDERS) {
          const { line, percent, spent, cap } = potLine(db, cfg, p);
          const was = get(db, 'SELECT state FROM owner_alert_state WHERE scope=?', `pot:${p}`)?.state ?? 'none';
          // Only a rise is told. A cap raised by hand moves the state down quietly, so the next rise is told again.
          changed(`pot:${p}`, line, order[line] > order[was], { name: `The Office: ${POT_NAME[p]} pot at ${line}%`, text: `The building's ${POT_NAME[p]} pot has passed ${line}%: ${usd(spent)} of ${usd(cap)} spent (${percent.toFixed(1)}%), ${usd(Math.max(0, cap - spent))} left.` });
        }
        if (!budget || floorId == null) return;
        const f = get(db, 'SELECT id, number, name, filler FROM floors WHERE id=?', floorId);
        if (!f || f.filler) return;
        const s = budget.floorStatus(floorId);
        for (const p of PROVIDERS) {
          const spent = p === 'anthropic' ? s.claudeUsd : s.openrouterUsd, stop = s[STOP[p]];
          const out = Number.isFinite(stop) && spent >= stop;
          changed(`floorstop:${floorId}:${p}`, out ? 'out' : 'ok', out, { name: `The Office: floor ${f.number} at its stop`, floorName: f.name, text: `Floor ${f.number} ({floor}) has hit its ${POT_NAME[p]} stop of ${usd(stop)} and has paused that work. Raise it with admin.mjs floor-limit if you want it to carry on.` });
        }
      });
    },
    /** A task was ended at its cap (job 7). Once per task. */
    taskCapped({ floorId, taskId, title, usd: cost, capUsd }) {
      return quietly('taskCapped', () => {
        const f = get(db, 'SELECT number, name, filler FROM floors WHERE id=?', floorId);
        if (!f || f.filler) return false;
        const fence = newFence();
        return changed(`taskcap:${taskId}`, 'ended', true, { name: `The Office: task #${taskId} ended at its cap`, floorName: f.name, text: `Floor ${f.number} ({floor}): task #${taskId} was ended at its ${usd(capUsd)} cap, after ${usd(cost)}. Its title: ${fence.wrap('task title', String(title || '').split('\n')[0].slice(0, 160))}` });
      });
    },
    /** A purchase request arrived. Once per request. */
    purchase({ floorId, id, item, price }) {
      return quietly('purchase', () => {
        const f = get(db, 'SELECT number, name, filler FROM floors WHERE id=?', floorId);
        if (!f || f.filler) return false;
        const fence = newFence();
        return changed(`purchase:${id}`, 'asked', true, { name: `The Office: purchase request #${id}`, floorName: f.name, text: `Floor ${f.number} ({floor}) asks to buy ${fence.wrap('item', String(item || '').slice(0, 160))} for ${usd(Number(price) || 0)} (request #${id}). See admin.mjs purchases list.` });
      });
    },
    /** The digest, once a day at DIGEST_AT (08:05) New York time. Returns the text when it was sent this call. */
    digestTick() {
      return quietly('digest', () => {
        if (cfg.ownerDigest === false) return false;
        const t = now();
        const at = digestAt(cfg, t);
        if (t < at) return false;
        const day = wallClock(OWNER_TZ, t).day;
        if (get(db, 'SELECT 1 x FROM owner_digests WHERE day=?', day)) return false;
        const fence = newFence();
        const text = digestText(digestFacts(db, cfg, t, { budget }), fence);
        run(db, 'INSERT INTO owner_digests (day,text,created_at) VALUES (?,?,?)', day, text, t);
        const key = `digest:${day}`;
        run(db, 'INSERT OR IGNORE INTO owner_alerts (key,kind,text,created_at) VALUES (?,?,?,?)', key, 'digest', text, t);
        send(key, { name: `The Office digest ${day}`, text: `${fence.notice}\n\n${text}` });
        return text;
      });
    },
    idle: () => Promise.allSettled([...flying]),
  };
}

/** What reached the owner, newest first: the alert log for the admin. */
export function alertLog(db, { since = 0, limit = 100 } = {}) {
  return all(db, 'SELECT key, kind, status, text, created_at FROM owner_alerts WHERE created_at>=? ORDER BY created_at DESC LIMIT ?', since, limit).map((r) => ({ at: new Date(r.created_at).toISOString(), kind: r.kind, status: r.status, text: r.text }));
}

// ---- the night freeze ----
const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
/** Whether no new floor work may start now: 23:00 to 08:00 New York time by default. A settings row (admin.mjs freeze on|off|auto) wins over NIGHT_FREEZE. */
export function nightFrozen(db, cfg, at = Date.now()) {
  const set = get(db, "SELECT value FROM settings WHERE key='night_freeze'")?.value;
  if (set === 'off') return false;
  if (set !== 'on' && !cfg.nightFreeze) return false;
  const { minutes } = wallClock(cfg.nightFreezeTz || OWNER_TZ, at);
  const from = toMin(cfg.nightFreezeFrom || '23:00'), to = toMin(cfg.nightFreezeTo || '08:00');
  return from > to ? minutes >= from || minutes < to : minutes >= from && minutes < to;
}
export function setNightFreeze(db, mode) {
  if (mode === 'auto') run(db, "DELETE FROM settings WHERE key='night_freeze'");
  else run(db, "INSERT INTO settings (key,value) VALUES ('night_freeze',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", mode === 'on' ? 'on' : 'off');
}
