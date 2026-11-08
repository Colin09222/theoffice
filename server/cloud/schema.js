// The Office Cloud tables. No imports, so db.js can create them with everything else and the clean-up paths can always name them.
export const CLOUD_SCHEMA = `
CREATE TABLE IF NOT EXISTS cloud_usage (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, file_bytes INTEGER NOT NULL DEFAULT 0, docs INTEGER NOT NULL DEFAULT 0,
  users INTEGER NOT NULL DEFAULT 0, saves INTEGER NOT NULL DEFAULT 0, scores INTEGER NOT NULL DEFAULT 0, files INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL DEFAULT '', requests INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (floor_id, project)
);
CREATE TABLE IF NOT EXISTS cloud_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, project TEXT NOT NULL, uid TEXT NOT NULL UNIQUE, username TEXT, email TEXT,
  name TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL, login_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS cloud_users_username ON cloud_users(floor_id, project, username) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cloud_users_email ON cloud_users(floor_id, project, email) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS cloud_sessions (
  hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, floor_id INTEGER NOT NULL, project TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cloud_sessions_user ON cloud_sessions(user_id, created_at);
CREATE TABLE IF NOT EXISTS cloud_docs (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, coll TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL, owner_name TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, size INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (floor_id, project, coll, id)
);
CREATE INDEX IF NOT EXISTS cloud_docs_created ON cloud_docs(floor_id, project, coll, created_at);
CREATE INDEX IF NOT EXISTS cloud_docs_owner ON cloud_docs(floor_id, project, owner);
CREATE TABLE IF NOT EXISTS cloud_saves (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, owner TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, size INTEGER NOT NULL,
  version INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (floor_id, project, owner, key)
);
CREATE TABLE IF NOT EXISTS cloud_scores (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, board TEXT NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL, score REAL NOT NULL,
  lower INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (floor_id, project, board, owner)
);
CREATE INDEX IF NOT EXISTS cloud_scores_rank ON cloud_scores(floor_id, project, board, score);
CREATE TABLE IF NOT EXISTS cloud_files (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL,
  chunks INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (floor_id, project, id)
);
CREATE INDEX IF NOT EXISTS cloud_files_owner ON cloud_files(floor_id, project, owner);
CREATE TABLE IF NOT EXISTS cloud_file_chunks (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (floor_id, project, id, n)
);
CREATE TABLE IF NOT EXISTS cloud_powers (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, ai_off INTEGER NOT NULL DEFAULT 0, fetch_off INTEGER NOT NULL DEFAULT 0,
  ai_paused INTEGER NOT NULL DEFAULT 0, fetch_paused INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (floor_id, project)
);
CREATE TABLE IF NOT EXISTS cloud_power_days (
  floor_id INTEGER NOT NULL, project TEXT NOT NULL, day TEXT NOT NULL, ai_fast INTEGER NOT NULL DEFAULT 0, ai_smart INTEGER NOT NULL DEFAULT 0,
  ai_calls INTEGER NOT NULL DEFAULT 0, fetches INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (floor_id, project, day)
);
CREATE INDEX IF NOT EXISTS cloud_power_days_day ON cloud_power_days(day);
`;
// Child rows first, so a wipe never leaves orphans if it stops part way.
export const CLOUD_TABLES = ['cloud_docs', 'cloud_saves', 'cloud_scores', 'cloud_file_chunks', 'cloud_files', 'cloud_sessions', 'cloud_users', 'cloud_usage'];
// Switches and today's AI and web counts. Clearing a project's data leaves these alone, or clearing it would hand back the day's allowance and lift a pause. They only go with the floor.
export const CLOUD_POWER_TABLES = ['cloud_powers', 'cloud_power_days'];
