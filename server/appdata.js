// The data a published game or app can keep: per-player saves, shared state and leaderboards. It runs no agent code and spends no money,
// and it is only ever reached from a project's own origin, keyed by that project. Everything here is untrusted input from the open web.
import { createHash } from 'node:crypto';
import { get, all, run, tx } from './db.js';

export const DATA_LIMITS = {
  valueBytes: 16 * 1024, bodyBytes: 32 * 1024, projectBytes: 5 * 1024 * 1024, floorBytes: 25 * 1024 * 1024, projectKeys: 5000,
  playerKeys: 100, playerBytes: 256 * 1024, boards: 20, boardEntries: 1000, listMax: 100, scoreRowBytes: 120,
};
const KEY = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,63}$/;
const PLAYER = /^[A-Za-z0-9_-]{32,64}$/;

export class DataError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }
const bad = (code, message) => new DataError(400, code, message);

const projectBytes = (db, f, p) => get(db, 'SELECT COALESCE(SUM(size),0) n FROM app_kv WHERE floor_id=? AND project=?', f, p).n
  + get(db, 'SELECT COUNT(*) n FROM app_scores WHERE floor_id=? AND project=?', f, p).n * DATA_LIMITS.scoreRowBytes;
const floorDataBytes = (db, f) => get(db, 'SELECT COALESCE(SUM(size),0) n FROM app_kv WHERE floor_id=?', f).n
  + get(db, 'SELECT COUNT(*) n FROM app_scores WHERE floor_id=?', f).n * DATA_LIMITS.scoreRowBytes;

function checkRoom(db, f, p, grow) {
  if (projectBytes(db, f, p) + grow > DATA_LIMITS.projectBytes || floorDataBytes(db, f) + grow > DATA_LIMITS.floorBytes) throw new DataError(507, 'quota', 'This project has used all of its saved-data space.');
}
const playerScope = (token) => `p:${createHash('sha256').update(token).digest('hex')}`;
function needPlayer(req) {
  const t = String(req.headers['x-office-player'] || '');
  if (!PLAYER.test(t)) throw bad('bad_player', 'Send a player token.');
  return t;
}
const needKey = (k, what = 'key') => { if (!KEY.test(k)) throw bad(`bad_${what}`, `A ${what} is 1 to 64 letters, digits or _ . : -`); return k; };
function encodeValue(b) {
  if (!('value' in b) || b.value === undefined) throw bad('no_value', 'Send a value.');
  const text = JSON.stringify(b.value);
  if (text === undefined) throw bad('bad_value', 'That value is not JSON.');
  const size = Buffer.byteLength(text);
  if (size > DATA_LIMITS.valueBytes) throw new DataError(413, 'too_large', `A value can be at most ${DATA_LIMITS.valueBytes} bytes.`);
  return { text, size };
}
// Names end up on other players' screens, so markup characters go even though the client library uses textContent.
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029<>&"'`]+/g, '').trim().slice(0, 24) || 'Anonymous';

function putKv(db, f, p, scope, key, text, size, now, ifVersion) {
  return tx(db, () => {
    const prev = get(db, 'SELECT size,version FROM app_kv WHERE floor_id=? AND project=? AND scope=? AND key=?', f, p, scope, key);
    if (ifVersion !== undefined && (prev?.version ?? 0) !== ifVersion) throw new DataError(409, 'version_conflict', 'Someone else changed this first.');
    if (!prev && get(db, 'SELECT COUNT(*) n FROM app_kv WHERE floor_id=? AND project=?', f, p).n >= DATA_LIMITS.projectKeys) throw new DataError(507, 'quota', 'This project has too many saved items.');
    if (scope !== 'shared') {
      const mine = get(db, 'SELECT COUNT(*) n, COALESCE(SUM(size),0) b FROM app_kv WHERE floor_id=? AND project=? AND scope=?', f, p, scope);
      if ((!prev && mine.n >= DATA_LIMITS.playerKeys) || mine.b - (prev?.size || 0) + size > DATA_LIMITS.playerBytes) throw new DataError(507, 'quota', 'This player has used all of their saved-data space.');
    }
    checkRoom(db, f, p, size - (prev?.size || 0));
    const version = (prev?.version || 0) + 1;
    run(db, `INSERT INTO app_kv (floor_id,project,scope,key,value,size,version,updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(floor_id,project,scope,key) DO UPDATE SET value=excluded.value,size=excluded.size,version=excluded.version,updated_at=excluded.updated_at`, f, p, scope, key, text, size, version, now);
    return version;
  });
}
const readKv = (db, f, p, scope, key) => get(db, 'SELECT value,version,updated_at FROM app_kv WHERE floor_id=? AND project=? AND scope=? AND key=?', f, p, scope, key);
const viewKv = (key, r) => ({ key, value: JSON.parse(r.value), version: r.version, updatedAt: r.updated_at });

/** Handles one request. `body()` reads the JSON body. Returns [status, object]. Isolation comes from the caller: f and p are derived from the Host, never from the request. */
export async function handleData({ db, req, floorId: f, project: p, segments: seg, query, body, now }) {
  const m = req.method;
  if (seg.length > 3 || seg.some((s) => s.length > 80)) throw new DataError(404, 'not_found');
  const t = now();

  if (seg[0] === 'save') {
    const scope = playerScope(needPlayer(req));
    if (seg.length === 1 && m === 'GET') return [200, { keys: all(db, 'SELECT key FROM app_kv WHERE floor_id=? AND project=? AND scope=? ORDER BY key LIMIT ?', f, p, scope, DATA_LIMITS.listMax).map((r) => r.key) }];
    if (seg.length !== 2) throw new DataError(404, 'not_found');
    const key = needKey(seg[1]);
    if (m === 'GET') { const r = readKv(db, f, p, scope, key); if (!r) throw new DataError(404, 'not_found'); return [200, viewKv(key, r)]; }
    if (m === 'PUT') { const { text, size } = encodeValue(await body()); return [200, { key, version: putKv(db, f, p, scope, key, text, size, t) }]; }
    if (m === 'DELETE') { run(db, 'DELETE FROM app_kv WHERE floor_id=? AND project=? AND scope=? AND key=?', f, p, scope, key); return [200, { ok: true }]; }
  }
  if (seg[0] === 'shared' && seg[1]) {
    const key = needKey(seg[1]);
    if (seg[2] === 'incr' && m === 'POST') {
      const b = await body(); const by = b.by === undefined ? 1 : b.by;
      if (!Number.isInteger(by) || Math.abs(by) > 1e6) throw bad('bad_by', 'by must be a whole number up to a million.');
      return tx(db, () => {
        const r = readKv(db, f, p, 'shared', key);
        const cur = r ? JSON.parse(r.value) : 0;
        if (typeof cur !== 'number') throw new DataError(409, 'not_a_number', 'That value is not a number.');
        const next = cur + by;
        if (!Number.isSafeInteger(next)) throw new DataError(409, 'not_a_number', 'That number is out of range.');
        const text = JSON.stringify(next);
        checkRoom(db, f, p, r ? 0 : text.length);
        const version = (r?.version || 0) + 1;
        run(db, `INSERT INTO app_kv (floor_id,project,scope,key,value,size,version,updated_at) VALUES (?,?,'shared',?,?,?,?,?)
          ON CONFLICT(floor_id,project,scope,key) DO UPDATE SET value=excluded.value,size=excluded.size,version=excluded.version,updated_at=excluded.updated_at`, f, p, key, text, text.length, version, t);
        return [200, { key, value: next, version }];
      });
    }
    if (seg.length === 2) {
      if (m === 'GET') { const r = readKv(db, f, p, 'shared', key); if (!r) throw new DataError(404, 'not_found'); return [200, viewKv(key, r)]; }
      if (m === 'PUT') {
        const b = await body(); const { text, size } = encodeValue(b);
        if (b.ifVersion !== undefined && !Number.isInteger(b.ifVersion)) throw bad('bad_version');
        return [200, { key, version: putKv(db, f, p, 'shared', key, text, size, t, b.ifVersion) }];
      }
      if (m === 'DELETE') { run(db, "DELETE FROM app_kv WHERE floor_id=? AND project=? AND scope='shared' AND key=?", f, p, key); return [200, { ok: true }]; }
    }
  }
  if (seg[0] === 'board' && seg.length === 2) {
    const board = needKey(seg[1], 'board');
    const lowerQ = query.get('order') === 'asc';
    if (m === 'GET') {
      const limit = Math.min(Math.max(Number(query.get('limit')) || 20, 1), DATA_LIMITS.listMax);
      const rows = all(db, `SELECT name,score,updated_at,player FROM app_scores WHERE floor_id=? AND project=? AND board=? ORDER BY score ${lowerQ ? 'ASC' : 'DESC'}, updated_at ASC LIMIT ?`, f, p, board, limit);
      const tok = req.headers['x-office-player'];
      const me = PLAYER.test(String(tok || '')) ? playerScope(String(tok)) : null;
      return [200, { board, entries: rows.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, at: r.updated_at, you: r.player === me })) }];
    }
    if (m === 'POST') {
      const player = playerScope(needPlayer(req));
      const b = await body();
      if (typeof b.score !== 'number' || !Number.isFinite(b.score) || Math.abs(b.score) > 1e15) throw bad('bad_score', 'score must be a number.');
      const lower = b.lower === true;
      return tx(db, () => {
        const prev = get(db, 'SELECT score FROM app_scores WHERE floor_id=? AND project=? AND board=? AND player=?', f, p, board, player);
        if (prev && (lower ? prev.score <= b.score : prev.score >= b.score)) return [200, { board, best: prev.score, improved: false }];
        if (!prev) {
          if (!get(db, 'SELECT 1 x FROM app_scores WHERE floor_id=? AND project=? AND board=? LIMIT 1', f, p, board) && get(db, 'SELECT COUNT(DISTINCT board) n FROM app_scores WHERE floor_id=? AND project=?', f, p).n >= DATA_LIMITS.boards) throw new DataError(507, 'quota', 'This project has too many leaderboards.');
          if (get(db, 'SELECT COUNT(*) n FROM app_scores WHERE floor_id=? AND project=? AND board=?', f, p, board).n >= DATA_LIMITS.boardEntries) {
            // Full board: the new score has to beat the worst one, which then drops off.
            const worst = get(db, `SELECT player,score FROM app_scores WHERE floor_id=? AND project=? AND board=? ORDER BY score ${lower ? 'DESC' : 'ASC'}, updated_at DESC LIMIT 1`, f, p, board);
            if (lower ? b.score >= worst.score : b.score <= worst.score) return [200, { board, best: b.score, improved: false }];
            run(db, 'DELETE FROM app_scores WHERE floor_id=? AND project=? AND board=? AND player=?', f, p, board, worst.player);
          } else checkRoom(db, f, p, DATA_LIMITS.scoreRowBytes);
        }
        run(db, `INSERT INTO app_scores (floor_id,project,board,player,name,score,updated_at) VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(floor_id,project,board,player) DO UPDATE SET name=excluded.name,score=excluded.score,updated_at=excluded.updated_at`, f, p, board, player, cleanName(b.name), b.score, t);
        return [200, { board, best: b.score, improved: true }];
      });
    }
  }
  throw new DataError(404, 'not_found');
}

export function deleteFloorData(db, floorId) {
  run(db, 'DELETE FROM app_kv WHERE floor_id=?', floorId);
  run(db, 'DELETE FROM app_scores WHERE floor_id=?', floorId);
}
