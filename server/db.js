// SQLite schema and connection. The per-floor virtual workspace lives here, so agent paths never meet the real filesystem.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
CREATE TABLE IF NOT EXISTS app_kv (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  size INTEGER NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (floor_id, project, scope, key)
);
CREATE TABLE IF NOT EXISTS app_scores (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, board TEXT NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL,
  score REAL NOT NULL, lower INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (floor_id, project, board, player)
);
CREATE INDEX IF NOT EXISTS app_scores_rank ON app_scores(floor_id, project, board, score);
`;
// Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS.
const ADDED = { tasks: { session_id: "TEXT NOT NULL DEFAULT ''", session_sent: 'INTEGER NOT NULL DEFAULT 0', session_charged: 'REAL NOT NULL DEFAULT 0', session_baseline: "TEXT NOT NULL DEFAULT ''", session_publish: "TEXT NOT NULL DEFAULT '[]'", session_tries: 'INTEGER NOT NULL DEFAULT 0' }, app_scores: { lower: 'INTEGER NOT NULL DEFAULT 0' } };

export function openDb(dataDir) {
  let path = ':memory:';
  if (dataDir !== ':memory:') { mkdirSync(dataDir, { recursive: true }); path = join(dataDir, 'office.db'); }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 4000; PRAGMA foreign_keys = OFF;');
  db.exec(SCHEMA);
  for (const [table, cols] of Object.entries(ADDED)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, def] of Object.entries(cols)) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
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
