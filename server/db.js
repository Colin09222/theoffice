// SQLite schema and connection. The per-floor virtual workspace lives here, so agent paths never meet the real filesystem.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CLOUD_SCHEMA } from './cloud/schema.js';
import { PAY_SCHEMA } from './cloud/pay-schema.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codes (
  hash TEXT PRIMARY KEY, floor_number INTEGER, created_at INTEGER NOT NULL,
  claimed_at INTEGER, floor_id INTEGER
);
CREATE TABLE IF NOT EXISTS floors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, number INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL, tagline TEXT NOT NULL DEFAULT '', colors TEXT NOT NULL, boss TEXT NOT NULL, decor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', paused INTEGER NOT NULL DEFAULT 0, pause_reason TEXT NOT NULL DEFAULT '',
  manager_wake INTEGER NOT NULL DEFAULT 0, budget_notice_day TEXT NOT NULL DEFAULT '',
  public_chat INTEGER NOT NULL DEFAULT 0, default_private INTEGER NOT NULL DEFAULT 0,
  recovery_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, kind TEXT NOT NULL, floor_id INTEGER, csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_floor ON sessions(floor_id);
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, role TEXT NOT NULL, title TEXT NOT NULL,
  name TEXT NOT NULL, look TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'idle', activity TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '', task_id INTEGER, hired INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_floor ON agents(floor_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, role TEXT NOT NULL, agent_id INTEGER,
  text TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_floor ON messages(floor_id, id);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, plan TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '', agent_id INTEGER, project TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo',
  depends_on TEXT NOT NULL DEFAULT '[]', result TEXT NOT NULL DEFAULT '', transcript TEXT NOT NULL DEFAULT '',
  revisions INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_floor ON tasks(floor_id, status);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, agent_id INTEGER, task_id INTEGER,
  text TEXT NOT NULL, answer TEXT, created_at INTEGER NOT NULL, answered_at INTEGER
);
CREATE INDEX IF NOT EXISTS questions_floor ON questions(floor_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, type TEXT NOT NULL, project TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_floor ON events(floor_id, id);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, floor_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL,
  path TEXT NOT NULL, message_id INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_floor ON attachments(floor_id);
CREATE TABLE IF NOT EXISTS files (
  floor_id INTEGER NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, size INTEGER NOT NULL,
  agent_id INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (floor_id, path)
);
CREATE TABLE IF NOT EXISTS projects (
  floor_id INTEGER NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'site', private INTEGER NOT NULL DEFAULT 0, sources TEXT NOT NULL DEFAULT '[]',
  published_at INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY (floor_id, slug)
);
CREATE TABLE IF NOT EXISTS published_files (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, path TEXT NOT NULL, content TEXT NOT NULL, size INTEGER NOT NULL,
  PRIMARY KEY (floor_id, project, path)
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, agent_id INTEGER, item TEXT NOT NULL, price REAL NOT NULL,
  why TEXT NOT NULL, link TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_floor ON purchases(floor_id);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, day TEXT NOT NULL, agent_id INTEGER, model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_floor_day ON ledger(floor_id, day);
CREATE INDEX IF NOT EXISTS ledger_day ON ledger(day);
CREATE TABLE IF NOT EXISTS app_labels (
  label TEXT PRIMARY KEY, floor_id INTEGER NOT NULL, project TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS app_labels_project ON app_labels(floor_id, project);
CREATE TABLE IF NOT EXISTS app_short_labels (
  label TEXT PRIMARY KEY, floor_id INTEGER NOT NULL, project TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS app_short_labels_project ON app_short_labels(floor_id, project);
CREATE TABLE IF NOT EXISTS floor_old_slugs (slug TEXT PRIMARY KEY, floor_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS app_kv (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  size INTEGER NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (floor_id, project, scope, key)
);
CREATE TABLE IF NOT EXISTS app_scores (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, board TEXT NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL,
  score REAL NOT NULL, lower INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (floor_id, project, board, player)
);
CREATE INDEX IF NOT EXISTS app_scores_rank ON app_scores(floor_id, project, board, score);
CREATE TABLE IF NOT EXISTS domain_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, agent_id INTEGER, task_id INTEGER, domain TEXT NOT NULL, project TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, quoted_usd REAL NOT NULL, approved_usd REAL, charged_usd REAL, charged_estimated INTEGER NOT NULL DEFAULT 0,
  order_id TEXT NOT NULL DEFAULT '', txn_id TEXT NOT NULL DEFAULT '', registrar_id TEXT NOT NULL DEFAULT '', privacy INTEGER NOT NULL DEFAULT 0, dns_ok INTEGER NOT NULL DEFAULT 0,
  dns_tries INTEGER NOT NULL DEFAULT 0, reply TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, approved_at INTEGER, sent_at INTEGER, bought_at INTEGER, next_try_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS domain_orders_floor ON domain_orders(floor_id, id);
CREATE INDEX IF NOT EXISTS domain_orders_domain ON domain_orders(domain, status);
-- The database itself refuses a second live order for one name, whatever the code above it does.
CREATE UNIQUE INDEX IF NOT EXISTS domain_orders_one_active ON domain_orders(domain) WHERE status IN ('buying','sent','uncertain','bought','live');
CREATE TABLE IF NOT EXISTS app_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, project TEXT NOT NULL, form TEXT NOT NULL, data TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS app_forms_project ON app_forms(floor_id, project, id);
CREATE UNIQUE INDEX IF NOT EXISTS app_forms_dedupe ON app_forms(floor_id, project, form, hash);
CREATE TABLE IF NOT EXISTS app_visits (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, uniques INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (floor_id, project, day, path)
);
CREATE TABLE IF NOT EXISTS app_visit_refs (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, day TEXT NOT NULL, ref TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (floor_id, project, day, ref)
);
CREATE TABLE IF NOT EXISTS app_visit_seen (day TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (day, hash));
CREATE TABLE IF NOT EXISTS ios_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, agent_id INTEGER, project TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'awaiting_boss', build_id TEXT NOT NULL DEFAULT '', task_id INTEGER, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ios_requests_floor ON ios_requests(floor_id, id);
-- The help line to the owner's assistant. It holds only what a manager typed; the floor's name and number come from the floors table when it is listed.
CREATE TABLE IF NOT EXISTS help_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, agent_id INTEGER, question TEXT NOT NULL, tried TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', answer TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_at INTEGER, delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS help_requests_floor ON help_requests(floor_id, id);
CREATE INDEX IF NOT EXISTS help_requests_open ON help_requests(status, expires_at);
-- Money promised to calls and computer sessions that are running now. It lives here rather than in memory, so a restart can't forget it and overspend a provider's limit.
CREATE TABLE IF NOT EXISTS budget_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'call', floor_id INTEGER, agent_id INTEGER, task_id INTEGER, usd REAL NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS budget_holds_provider ON budget_holds(provider);
CREATE INDEX IF NOT EXISTS budget_holds_task ON budget_holds(task_id);
CREATE TABLE IF NOT EXISTS contractor_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, task_id INTEGER NOT NULL, project TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL DEFAULT '', files TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'held', summary TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, done_at INTEGER, closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS contractor_jobs_status ON contractor_jobs(status);
CREATE TABLE IF NOT EXISTS work_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, project TEXT NOT NULL, triggers TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS work_rounds_project ON work_rounds(floor_id, project, created_at);
CREATE TABLE IF NOT EXISTS cost_alerts (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, floor_id INTEGER NOT NULL, task_id INTEGER, usd REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cost_alerts_created ON cost_alerts(created_at);
`;
// Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS.
const ADDED = { tasks: { session_id: "TEXT NOT NULL DEFAULT ''", session_sent: 'INTEGER NOT NULL DEFAULT 0', session_charged: 'REAL NOT NULL DEFAULT 0', session_baseline: "TEXT NOT NULL DEFAULT ''", session_publish: "TEXT NOT NULL DEFAULT '[]'", session_tries: 'INTEGER NOT NULL DEFAULT 0' }, app_scores: { lower: 'INTEGER NOT NULL DEFAULT 0' },
  ledger: { kind: "TEXT NOT NULL DEFAULT 'model'" },
  domain_orders: { reply: "TEXT NOT NULL DEFAULT ''" },
  purchases: { admin_note: "TEXT NOT NULL DEFAULT ''", decided_at: 'INTEGER' },
  projects: { payment_link: "TEXT NOT NULL DEFAULT ''", launch_check: "TEXT NOT NULL DEFAULT ''", launch_report: "TEXT NOT NULL DEFAULT ''", design_review: "TEXT NOT NULL DEFAULT ''", indexable: 'INTEGER NOT NULL DEFAULT 0' },
};
Object.assign(ADDED.tasks, { vault: 'INTEGER NOT NULL DEFAULT 0' });
// Selling: whether a product is posted to the buyer, and what the boss needs to send an order (what was in the basket, who bought it, where it goes).
// The last look before a first publish (server/shipcheck.js): what it said about each version it saw.
Object.assign(ADDED.projects, { ship_check: "TEXT NOT NULL DEFAULT ''" });
ADDED.pay_products = { ships: 'INTEGER NOT NULL DEFAULT 0' };
ADDED.pay_orders = { items: "TEXT NOT NULL DEFAULT ''", email: "TEXT NOT NULL DEFAULT ''", buyer_name: "TEXT NOT NULL DEFAULT ''", ship_to: "TEXT NOT NULL DEFAULT ''", told: 'INTEGER NOT NULL DEFAULT 0', told_buyer: 'INTEGER NOT NULL DEFAULT 0', fulfilled_at: 'INTEGER' };
// floors-plus: filler companies are flagged in the row itself, and the last time the boss opened the floor decides whether standing orders keep running.
ADDED.floors = { filler: 'INTEGER NOT NULL DEFAULT 0', last_opened_at: 'INTEGER NOT NULL DEFAULT 0' };
// lanes: which playbook a task belongs to (game, website or business), so the person doing it gets their part of that playbook.
Object.assign(ADDED.tasks, { lane: "TEXT NOT NULL DEFAULT ''" });
// The building's limits: which provider each ledger row was paid to, which providers have stopped a floor, and a decision from the CLI that the floor hasn't heard yet.
Object.assign(ADDED.ledger, { provider: "TEXT NOT NULL DEFAULT ''" });
Object.assign(ADDED.floors, { budget_out: "TEXT NOT NULL DEFAULT ''" });
// life: a floor the building manager has hidden stays out of every lobby listing but still opens by its own link.
Object.assign(ADDED.floors, { hidden: 'INTEGER NOT NULL DEFAULT 0' });
Object.assign(ADDED.purchases, { notify: 'INTEGER NOT NULL DEFAULT 0' });
// A long task's early steps get dropped from its transcript. The links it saw go here, because publishing a doc checks that its sources were really opened.
Object.assign(ADDED.tasks, { seen_links: "TEXT NOT NULL DEFAULT ''" });
// Each person's own character, notebook and room. See server/people.js. A floor with an empty name is still being set up by chat.
// The boss's uploads: which of them came with a chat message, and which the manager handed to a task.
Object.assign(ADDED.messages ||= {}, { files: "TEXT NOT NULL DEFAULT ''" });
Object.assign(ADDED.tasks, { files: "TEXT NOT NULL DEFAULT '[]'" });
ADDED.agents = { character: "TEXT NOT NULL DEFAULT ''", memory: "TEXT NOT NULL DEFAULT '[]'", office: "TEXT NOT NULL DEFAULT ''" };
// Work modes: a task the team set itself while working on its own runs on the autonomous models. See server/modes.js.
Object.assign(ADDED.tasks, { auto: 'INTEGER NOT NULL DEFAULT 0' });

// What a project's files added up to when the manager sent a task back, so the manager can be told when it comes back with nothing changed.
Object.assign(ADDED.tasks, { sent_back_sum: "TEXT NOT NULL DEFAULT ''" });
Object.assign(ADDED.tasks, { model_tier: "TEXT NOT NULL DEFAULT ''" });
// A floor with a sign-in code of its own: the same code at every sign-in, instead of a recovery code that rotates.
Object.assign(ADDED.floors, { keep_code: 'INTEGER NOT NULL DEFAULT 0' });
// The contractor hold (server/contractor.js): a floor whose Builder and Designer jobs go to the building's outside contractor, and the task that is with them now.
Object.assign(ADDED.floors, { contractor: 'INTEGER NOT NULL DEFAULT 0' });
// Whether the staff's small talk may rib the boss (server/gossip.js). The boss turns it off in their settings; on by default.
Object.assign(ADDED.floors, { banter_sass: 'INTEGER NOT NULL DEFAULT 1' });
Object.assign(ADDED.tasks, { contractor: 'INTEGER NOT NULL DEFAULT 0' });
// How big a computer's conversation had grown at its last step, and whether its task was sent back since: past a size, the fix round starts on a fresh computer (server/computer.js).
Object.assign(ADDED.tasks, { session_ctx: 'INTEGER NOT NULL DEFAULT 0', session_fresh: 'INTEGER NOT NULL DEFAULT 0' });
// How the manager sized a job, the boss's request in one line, its acceptance checks, what jobs like it have cost (admin only), and the doer's own check of it (docs/MANAGER.md).
Object.assign(ADDED.tasks, { size: "TEXT NOT NULL DEFAULT ''", intent: "TEXT NOT NULL DEFAULT ''", checks: "TEXT NOT NULL DEFAULT ''", est_usd: 'REAL NOT NULL DEFAULT 0', selfcheck: "TEXT NOT NULL DEFAULT ''" });

// A locked AI's lifetime stop and whether its conversations are kept for the admin and the boss; a project let through while the rest of the building is paused (server/cloud/ai-locked.js, guide-log.js, powers.js, chat.js).
Object.assign(ADDED, {
  cloud_ai_locks: { total_usd: 'REAL NOT NULL DEFAULT 0', total_since: 'INTEGER NOT NULL DEFAULT 0', keep_chats: 'INTEGER NOT NULL DEFAULT 0' },
  cloud_powers: { ai_exempt: 'INTEGER NOT NULL DEFAULT 0', fetch_exempt: 'INTEGER NOT NULL DEFAULT 0' },
  chat_settings: { exempt: 'INTEGER NOT NULL DEFAULT 0' },
  chat_conversations: { kind: "TEXT NOT NULL DEFAULT 'chat'", visitor: "TEXT NOT NULL DEFAULT ''", cost_usd: 'REAL NOT NULL DEFAULT 0', screened: 'INTEGER NOT NULL DEFAULT 0', off_topic: 'INTEGER NOT NULL DEFAULT 0', flags: "TEXT NOT NULL DEFAULT ''" },
});

// redesign lane B (docs/redesign/LANE-B.md). Every lane B table and column is here, so the two lanes merge cleanly. Additive only.
// j04: whether the contractor takes a task, decided once when it is made; when the contractor handed it back (it is never held again after that);
// how many times a Tester failed it; the handed-back task a fix task fixes; refused re-holds for the admin; and the one ping each task ever gets.
const LANE_B_SCHEMA = `
CREATE TABLE IF NOT EXISTS hold_refusals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, task_id INTEGER NOT NULL, why TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hold_refusals_created ON hold_refusals(created_at);
CREATE TABLE IF NOT EXISTS contractor_pings (task_id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
-- j05: the budget check's records, one every two hours (server/spendcheck.js).
CREATE TABLE IF NOT EXISTS spend_records (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS spend_records_created ON spend_records(created_at);
-- j06: what reached the owner (the alert log), each alert's last state so it fires once per change, and one digest a day.
CREATE TABLE IF NOT EXISTS owner_alerts (key TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sending', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS owner_alerts_created ON owner_alerts(created_at);
CREATE TABLE IF NOT EXISTS owner_alert_state (scope TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS owner_digests (day TEXT PRIMARY KEY, text TEXT NOT NULL, created_at INTEGER NOT NULL);
-- j08: every "not allowed" a signed-in user gets: who, which floor, what they tried, when (server/denied.js).
CREATE TABLE IF NOT EXISTS denied_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT NOT NULL, floor_id INTEGER, action TEXT NOT NULL, status INTEGER NOT NULL, code TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS denied_requests_created ON denied_requests(created_at);
-- j09: what a Tester noticed beyond a job's done-means lines, kept on the project for the boss, never sent back to the Builder (server/donemeans.js).
CREATE TABLE IF NOT EXISTS project_later (id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, project TEXT NOT NULL, task_id INTEGER, text TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS project_later_project ON project_later(floor_id, project);
-- j11: each smoke check after a publish: did the live page load with no errors, and where its screenshot is on the floor's drive (server/smoke.js).
CREATE TABLE IF NOT EXISTS smoke_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, project TEXT NOT NULL, task_id INTEGER, url TEXT NOT NULL, ok INTEGER NOT NULL, how TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0, errors TEXT NOT NULL DEFAULT '[]', shot_path TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS smoke_checks_task ON smoke_checks(task_id);
CREATE INDEX IF NOT EXISTS smoke_checks_project ON smoke_checks(floor_id, project, id);
-- Round 1 rest, j20: one weekly plan a floor a week (drafted Monday 08:05 New York), and the floors kept out of weekly plans.
CREATE TABLE IF NOT EXISTS weekly_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, week TEXT NOT NULL, status TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', jobs TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, autostart_at INTEGER, approved_at INTEGER, edited_at INTEGER, started_at INTEGER, task_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS weekly_plans_week ON weekly_plans(floor_id, week);
CREATE TABLE IF NOT EXISTS weekly_plan_floors (floor_id INTEGER PRIMARY KEY, off INTEGER NOT NULL DEFAULT 0, draft_asked INTEGER, updated_at INTEGER NOT NULL);
-- Round 1 rest, j23: the plan a new floor's boss is shown in onboarding (lane, template, three answers), drafted by one manager call, started by one Start.
CREATE TABLE IF NOT EXISTS onboarding_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, status TEXT NOT NULL, lane TEXT NOT NULL, template TEXT NOT NULL, form INTEGER NOT NULL DEFAULT 0,
  answers TEXT NOT NULL DEFAULT '[]', name TEXT NOT NULL DEFAULT '', goal TEXT NOT NULL DEFAULT '', jobs TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, started_at INTEGER,
  task_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS onboarding_plans_floor ON onboarding_plans(floor_id, id);
`;
Object.assign(ADDED.tasks, { contractor_route: 'INTEGER NOT NULL DEFAULT 0', handed_back_at: 'INTEGER', tester_fails: 'INTEGER NOT NULL DEFAULT 0', fix_of: 'INTEGER' });
// j07: a task's own cap when it isn't the building's (Tier 3 is $6), when it was ended at its cap, whether what it saved shipped as Work in progress, and what is not done yet.
Object.assign(ADDED.tasks, { cap_usd: 'REAL NOT NULL DEFAULT 0', capped_at: 'INTEGER', wip: 'INTEGER NOT NULL DEFAULT 0', not_done: "TEXT NOT NULL DEFAULT ''" });
// j09: when a job's done-means lines froze (work started), when the boss last changed them, and a Tester's verdict on each line.
Object.assign(ADDED.tasks, { checks_frozen_at: 'INTEGER', checks_amended_at: 'INTEGER', test_lines: "TEXT NOT NULL DEFAULT ''" });
// j11: the job's last smoke check (smoke_checks.id).
Object.assign(ADDED.tasks, { smoke_id: 'INTEGER' });
// j17: the task's model tier (0 to 3) and why, when it was decided, whether the manager tagged it a hard build, and whether the owner let it use Fable.
// j18: which task a ledger row was for, and whether it was a computer's step, so the average Builder call can be measured (scripts/builder-context.mjs).
Object.assign(ADDED.ledger, { task_id: 'INTEGER', computer: 'INTEGER NOT NULL DEFAULT 0' });
// j19: when the owner pressed Send out on a task (the only way to the contractor now).
Object.assign(ADDED.tasks, { sent_out_at: 'INTEGER' });
// Round 1 rest, j21: the estimate of the job a task belongs to, shown to the boss as information only, and what it was based on.
Object.assign(ADDED.tasks, { job_est_usd: 'REAL', job_est_kind: "TEXT NOT NULL DEFAULT ''", job_est_basis: "TEXT NOT NULL DEFAULT ''" });
Object.assign(ADDED.tasks, { tier: 'INTEGER', tier_why: "TEXT NOT NULL DEFAULT ''", tier_at: 'INTEGER', hard: 'INTEGER NOT NULL DEFAULT 0', fable_ok: 'INTEGER NOT NULL DEFAULT 0' });
/** Lane B's one-time fills, each guarded by a settings row so it runs once. */
function laneBFills(db) {
  // A database from long before these columns (one with no agent_id on its tasks, say) has nothing to fill, and is never kept from booting by it.
  const once = (key, fn) => { if (db.prepare('SELECT 1 x FROM settings WHERE key=?').get(key)) return; try { fn(); } catch { /* nothing to fill */ } db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(key, String(Date.now())); };
  once('laneb_j04_route_v1', () => {
    // Work the contractor already handed back is never held again, and work waiting on a contractor floor keeps the routing it would have had.
    db.exec("UPDATE tasks SET handed_back_at=(SELECT MAX(COALESCE(j.done_at,j.closed_at)) FROM contractor_jobs j WHERE j.task_id=tasks.id AND j.status='closed') WHERE handed_back_at IS NULL AND id IN (SELECT task_id FROM contractor_jobs WHERE status='closed')");
    db.exec("UPDATE tasks SET contractor_route=1 WHERE handed_back_at IS NULL AND (contractor=1 OR (status='todo' AND floor_id IN (SELECT id FROM floors WHERE contractor=1) AND agent_id IN (SELECT id FROM agents WHERE role IN ('builder','designer','researcher'))))");
    // One ping per task, ever: the tasks already pinged count.
    db.exec('INSERT OR IGNORE INTO contractor_pings (task_id,job_id,created_at) SELECT task_id, MIN(id), MIN(created_at) FROM contractor_jobs GROUP BY task_id');
  });
}
// redesign lane A (docs/redesign): what visitors see. New tables only; each statement is safe to run on every start.
const LANE_A_SCHEMA = `
CREATE TABLE IF NOT EXISTS launch_shots (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, image BLOB, type TEXT NOT NULL DEFAULT 'image/jpeg', bytes INTEGER NOT NULL DEFAULT 0,
  url TEXT NOT NULL DEFAULT '', taken_at INTEGER, failed_at INTEGER, error TEXT NOT NULL DEFAULT '', PRIMARY KEY (floor_id, project)
);
CREATE TABLE IF NOT EXISTS job_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, key TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'todo', step INTEGER NOT NULL DEFAULT 1, steps INTEGER NOT NULL DEFAULT 1, agent_id INTEGER, who TEXT NOT NULL DEFAULT '',
  line TEXT NOT NULL DEFAULT '', task_ids TEXT NOT NULL DEFAULT '[]', thumb TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  done_at INTEGER, UNIQUE (floor_id, key)
);
CREATE INDEX IF NOT EXISTS job_cards_floor ON job_cards(floor_id, updated_at);
CREATE TABLE IF NOT EXISTS quiet_messages (message_id INTEGER PRIMARY KEY, floor_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS job_shots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, card_id INTEGER NOT NULL, step TEXT NOT NULL, project TEXT NOT NULL,
  image BLOB, bytes INTEGER NOT NULL DEFAULT 0, url TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, taken_at INTEGER, failed_at INTEGER, tries INTEGER NOT NULL DEFAULT 0,
  UNIQUE (card_id, step)
);
CREATE INDEX IF NOT EXISTS job_shots_pending ON job_shots(taken_at, failed_at);
CREATE TABLE IF NOT EXISTS floor_marks (
  floor_id INTEGER PRIMARY KEY, priority INTEGER NOT NULL DEFAULT 0, killed INTEGER NOT NULL DEFAULT 0, was_hidden INTEGER NOT NULL DEFAULT 0,
  was_paused INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tel_taps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, project TEXT NOT NULL, path TEXT NOT NULL, number TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tel_taps_floor ON tel_taps(floor_id, created_at);
CREATE TABLE IF NOT EXISTS rank_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, floor_number INTEGER, action TEXT NOT NULL, who TEXT NOT NULL, created_at INTEGER NOT NULL
);
`;

// redesign r2 lane B (docs/redesign/ROUND2.md): new tables only; each statement is safe to run on every start.
const R2_LANE_B_SCHEMA = `
-- r2-j61: what reached a boss by email, one row per event (question waiting, its 24 h reminder, launch ready, something shipped).
CREATE TABLE IF NOT EXISTS boss_alerts (key TEXT PRIMARY KEY, floor_id INTEGER NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS boss_alerts_floor_day ON boss_alerts(floor_id, day);
-- r2-j62: the weekly floor report email, one per floor per week (week = that Monday's New York date).
-- r2-j64: one numbers-led proposal per active floor per week: one change, one reason, the number behind it; Yes / No; dropped after 7 days.
CREATE TABLE IF NOT EXISTS floor_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, week TEXT NOT NULL, change TEXT NOT NULL, reason TEXT NOT NULL, number TEXT NOT NULL,
  metric TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '', baseline INTEGER, line TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, task_id INTEGER,
  created_at INTEGER NOT NULL, decided_at INTEGER, UNIQUE (floor_id, week)
);
CREATE TABLE IF NOT EXISTS weekly_reports (floor_id INTEGER NOT NULL, week TEXT NOT NULL, status TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, PRIMARY KEY (floor_id, week));
`;

export function openDb(dataDir) {
  let path = ':memory:';
  if (dataDir !== ':memory:') { mkdirSync(dataDir, { recursive: true }); path = join(dataDir, 'office.db'); }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 4000; PRAGMA foreign_keys = OFF;');
  db.exec(SCHEMA);
  db.exec(CLOUD_SCHEMA);
  db.exec(PAY_SCHEMA);
  db.exec(LANE_A_SCHEMA);
  for (const [table, cols] of Object.entries(ADDED)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, def] of Object.entries(cols)) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS ledger_provider ON ledger(provider, cost_usd)');
  db.exec(LANE_B_SCHEMA);
  laneBFills(db);
  db.exec(R2_LANE_B_SCHEMA);  // redesign r2 lane B
  // Rows from before the column existed. A bare claude- id went to the Claude API; an id with a slash is OpenRouter's naming, whoever made the model. Domains are paid from the registrar balance and count towards neither.
  if (db.prepare("SELECT 1 x FROM ledger WHERE provider='' AND kind!='domain' LIMIT 1").get()) {
    db.exec(`UPDATE ledger SET provider = CASE WHEN kind='search' THEN 'anthropic' WHEN kind IN ('image','review') THEN 'openrouter' WHEN model='managed-session' OR model LIKE 'claude-%' THEN 'anthropic' ELSE 'openrouter' END WHERE provider='' AND kind!='domain'`);
  }
  return db;
}

export const get = (db, sql, ...a) => db.prepare(sql).get(...a);
export const all = (db, sql, ...a) => db.prepare(sql).all(...a);
export const run = (db, sql, ...a) => db.prepare(sql).run(...a);
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
