// Office Cloud storage: what a published project keeps for its visitors. Documents, accounts, saves, scores and files.
// Every row carries (floor_id, project) and every query names both, so one project's data can never answer for another's.
// Sizes are counted as rows change, in cloud_usage, so a quota check never has to add up a whole project.
import { createHash, randomBytes } from 'node:crypto';
import { get, all, run, tx } from '../db.js';
import { CLOUD_TABLES as TABLES, CLOUD_POWER_TABLES } from './schema.js';

export const CLOUD_LIMITS = {
  dataBytes: 20 * 1024 * 1024, fileBytes: 50 * 1024 * 1024, totalBytes: 8 * 1024 * 1024 * 1024,
  docBytes: 32 * 1024, collections: 50, docs: 20000, docsPerOwner: 2000, queryMax: 100, responseBytes: 512 * 1024, offsetMax: 10000, filters: 8,
  saveBytes: 64 * 1024, savesPerOwner: 200, saveBytesPerOwner: 1024 * 1024,
  users: 50000, sessionsPerUser: 10, sessionDays: 30,
  boards: 50, boardEntries: 5000, scoreMax: 1e12,
  fileMax: 5 * 1024 * 1024, filesPerOwner: 100, fileBytesPerOwner: 25 * 1024 * 1024, files: 2000,
};
const ROW = 64, SCORE_ROW = 120, USER_ROW = 320, CHUNK = 256 * 1024;


export class CloudError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }
const bad = (code, message) => new CloudError(400, code, message);
const full = (message) => new CloudError(507, 'quota', message);

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
const newId = (n = 12) => randomBytes(n).toString('base64url');

export const COLL = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,39}$/;
export const KEY = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,63}$/;
const DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_ID = /^[A-Za-z0-9_-]{22}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,39}(\.[A-Za-z_][A-Za-z0-9_]{0,39}){0,3}$/;
export const SESSION = /^[A-Za-z0-9_-]{43}$/;
export const PLAYER = /^[A-Za-z0-9_-]{32,64}$/;
const USERNAME = /^[a-z0-9_][a-z0-9_.-]{2,23}$/;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s.]{2,}$/;

const need = (re, v, code, message) => { if (typeof v !== 'string' || !re.test(v)) throw bad(code, message); return v; };
/** A name that ends up on other people's screens: no markup characters, no control characters, short. */
export const cleanName = (s, max = 32) => String(s ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069<>&"'`]+/g, '').trim().slice(0, max);
function encode(value, max, what = 'value') {
  let text;
  try { text = JSON.stringify(value); } catch { throw bad('bad_value', `That ${what} can't be stored.`); }
  if (text === undefined) throw bad('bad_value', `Send a ${what}.`);
  const size = Buffer.byteLength(text);
  if (size > max) throw new CloudError(413, 'too_large', `A ${what} can be at most ${Math.floor(max / 1024)} KB.`);
  return { text, size };
}
const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Who is asking: an account, or a guest known only by the random token their browser keeps. */
export const guestKey = (token) => `g:${sha(token).slice(0, 32)}`;
export const userKey = (uid) => `u:${uid}`;
/** What other people may see of an owner. A guest's key is never shown, only a tag derived from it. */
export const ownerView = (key, name) => (key.startsWith('u:') ? { id: key.slice(2), name, guest: false } : { id: `guest-${sha(`pub:${key}`).slice(0, 10)}`, name, guest: true });

// ---- file types, from the bytes and never from what the uploader claims ----
const ascii = (b, from, to) => b.subarray(from, to).toString('latin1');
const MP4_BRANDS = /^(isom|iso[2-9]|mp41|mp42|avc1|dash|M4V |M4A |3gp[4-6]|qt  )$/;
export function sniff(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && ascii(b, 1, 8) === 'PNG\r\n\x1a\n') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(ascii(b, 0, 6))) return 'image/gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'M4A ') return 'audio/mp4';
    if (MP4_BRANDS.test(brand)) return 'video/mp4';
    return null;
  }
  if (ascii(b, 0, 4) === 'OggS') return 'audio/ogg';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2)) return 'audio/mpeg';
  return null;
}
const cleanFileName = (s) => cleanName(String(s || '').split(/[\\/]/).pop(), 100).replace(/[;]/g, '') || 'file';

export function createStore(db, limits = {}, now = Date.now) {
  const L = { ...CLOUD_LIMITS, ...limits };

  // ---- usage ----
  const ZERO = { bytes: 0, file_bytes: 0, docs: 0, users: 0, saves: 0, scores: 0, files: 0, day: '', requests: 0 };
  const usage = (f, p) => get(db, 'SELECT * FROM cloud_usage WHERE floor_id=? AND project=?', f, p) || { ...ZERO };
  function bump(f, p, d) {
    run(db, `INSERT INTO cloud_usage (floor_id,project,bytes,file_bytes,docs,users,saves,scores,files) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(floor_id,project) DO UPDATE SET bytes=bytes+excluded.bytes, file_bytes=file_bytes+excluded.file_bytes, docs=docs+excluded.docs,
      users=users+excluded.users, saves=saves+excluded.saves, scores=scores+excluded.scores, files=files+excluded.files`,
    f, p, d.bytes || 0, d.fileBytes || 0, d.docs || 0, d.users || 0, d.saves || 0, d.scores || 0, d.files || 0);
  }
  const totalBytes = () => get(db, 'SELECT COALESCE(SUM(bytes + file_bytes),0) n FROM cloud_usage').n;
  function room(f, p, grow, files = false) {
    if (grow <= 0) return;
    const u = usage(f, p);
    if (files ? u.file_bytes + grow > L.fileBytes : u.bytes + grow > L.dataBytes) throw full(files ? 'This project has used all of its file space.' : 'This project has used all of its storage.');
    if (totalBytes() + grow > L.totalBytes) throw full('The building is out of storage space for now.');
  }
  /** Requests are counted in memory and written now and then, so a busy page doesn't turn every read into a write. */
  function addRequests(counts, day) {
    tx(db, () => {
      for (const [k, n] of counts) {
        const i = k.indexOf(':'); const f = Number(k.slice(0, i)); const p = k.slice(i + 1);
        run(db, `INSERT INTO cloud_usage (floor_id,project,day,requests) VALUES (?,?,?,?)
          ON CONFLICT(floor_id,project) DO UPDATE SET requests=CASE WHEN day=excluded.day THEN requests+excluded.requests ELSE excluded.requests END, day=excluded.day`, f, p, day, n);
      }
    });
  }

  // ---- accounts ----
  const users = {
    find: (f, p, login) => {
      const l = String(login || '').trim().toLowerCase();
      if (!l || l.length > 254) return null;
      return get(db, `SELECT * FROM cloud_users WHERE floor_id=? AND project=? AND ${l.includes('@') ? 'email' : 'username'}=?`, f, p, l) || null;
    },
    /** Checks the fields before any hashing is paid for. */
    validate({ username, email, password, name }) {
      const u = username === undefined || username === null || username === '' ? null : String(username).trim().toLowerCase();
      const e = email === undefined || email === null || email === '' ? null : String(email).trim().toLowerCase();
      if (!u && !e) throw bad('need_login', 'Choose a username or give an email address.');
      if (u !== null && !USERNAME.test(u)) throw bad('bad_username', 'A username is 3 to 24 letters, digits, _ . or -.');
      if (e !== null && (e.length > 254 || !EMAIL.test(e))) throw bad('bad_email', 'That email address does not look right.');
      if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 512) throw bad('bad_password', 'A password is at least 8 characters.');
      const shown = cleanName(name, 32) || u || e.split('@')[0].slice(0, 32);
      return { username: u, email: e, name: shown };
    },
    taken: (f, p, { username, email }) => (username && get(db, 'SELECT 1 x FROM cloud_users WHERE floor_id=? AND project=? AND username=?', f, p, username) ? 'username'
      : email && get(db, 'SELECT 1 x FROM cloud_users WHERE floor_id=? AND project=? AND email=?', f, p, email) ? 'email' : null),
    create(f, p, fields, hash, guest) {
      return tx(db, () => {
        const clash = users.taken(f, p, fields);
        if (clash) throw new CloudError(409, `${clash}_taken`, clash === 'username' ? 'That username is taken.' : 'That email address already has an account.');
        if (usage(f, p).users >= L.users) throw full('This project has all the accounts it can hold.');
        room(f, p, USER_ROW);
        const uid = newId(9);
        const r = run(db, 'INSERT INTO cloud_users (floor_id,project,uid,username,email,name,hash,created_at,login_at) VALUES (?,?,?,?,?,?,?,?,?)',
          f, p, uid, fields.username, fields.email, fields.name, hash, now(), now());
        bump(f, p, { users: 1, bytes: USER_ROW });
        // A guest who signs up keeps what they did as a guest: the account is new, so nothing can clash.
        if (guest) {
          const to = userKey(uid);
          for (const t of ['cloud_docs', 'cloud_saves', 'cloud_scores', 'cloud_files']) run(db, `UPDATE ${t} SET owner=? WHERE floor_id=? AND project=? AND owner=?`, to, f, p, guest);
          run(db, 'UPDATE cloud_docs SET owner_name=? WHERE floor_id=? AND project=? AND owner=?', fields.name, f, p, to);
          run(db, 'UPDATE cloud_scores SET name=? WHERE floor_id=? AND project=? AND owner=?', fields.name, f, p, to);
        }
        return get(db, 'SELECT * FROM cloud_users WHERE id=?', Number(r.lastInsertRowid));
      });
    },
    startSession(user) {
      const token = newToken(); const t = now();
      tx(db, () => {
        run(db, 'INSERT INTO cloud_sessions (hash,user_id,floor_id,project,created_at,expires_at) VALUES (?,?,?,?,?,?)', sha(token), user.id, user.floor_id, user.project, t, t + L.sessionDays * 86400000);
        run(db, 'DELETE FROM cloud_sessions WHERE user_id=? AND hash NOT IN (SELECT hash FROM cloud_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT ?)', user.id, user.id, L.sessionsPerUser);
        run(db, 'UPDATE cloud_users SET login_at=? WHERE id=?', t, user.id);
      });
      return token;
    },
    /** The account behind a session token, for this project only. A token from any other project finds nothing. */
    bySession(f, p, token) {
      if (!SESSION.test(String(token || ''))) return null;
      const r = get(db, 'SELECT u.*, s.expires_at FROM cloud_sessions s JOIN cloud_users u ON u.id=s.user_id WHERE s.hash=? AND s.floor_id=? AND s.project=? AND u.floor_id=? AND u.project=?', sha(token), f, p, f, p);
      if (!r) return null;
      if (r.expires_at <= now()) { run(db, 'DELETE FROM cloud_sessions WHERE hash=?', sha(token)); return null; }
      return r;
    },
    endSession: (token) => run(db, 'DELETE FROM cloud_sessions WHERE hash=?', sha(String(token || ''))).changes,
    endOthers: (user, keep) => run(db, 'DELETE FROM cloud_sessions WHERE user_id=? AND hash!=?', user.id, sha(String(keep || ''))).changes,
    rename(user, name) {
      const n = cleanName(name, 32);
      if (!n) throw bad('bad_name', 'Give a name.');
      tx(db, () => {
        run(db, 'UPDATE cloud_users SET name=? WHERE id=?', n, user.id);
        const k = userKey(user.uid);
        run(db, 'UPDATE cloud_docs SET owner_name=? WHERE floor_id=? AND project=? AND owner=?', n, user.floor_id, user.project, k);
        run(db, 'UPDATE cloud_scores SET name=? WHERE floor_id=? AND project=? AND owner=?', n, user.floor_id, user.project, k);
      });
      return n;
    },
    setHash: (user, hash) => run(db, 'UPDATE cloud_users SET hash=? WHERE id=?', hash, user.id),
    /** Closing an account takes everything it owns with it. */
    remove(user) {
      const f = user.floor_id, p = user.project, k = userKey(user.uid);
      tx(db, () => {
        dropOwned(f, p, k);
        run(db, 'DELETE FROM cloud_sessions WHERE user_id=?', user.id);
        run(db, 'DELETE FROM cloud_users WHERE id=?', user.id);
        bump(f, p, { users: -1, bytes: -USER_ROW });
      });
    },
  };
  const publicUser = (u, self = false) => ({ id: u.uid, username: u.username, name: u.name, createdAt: u.created_at, ...(self ? { email: u.email } : {}) });

  function dropOwned(f, p, owner) {
    const d = get(db, 'SELECT COUNT(*) n, COALESCE(SUM(size),0) b FROM cloud_docs WHERE floor_id=? AND project=? AND owner=?', f, p, owner);
    const s = get(db, 'SELECT COUNT(*) n, COALESCE(SUM(size),0) b FROM cloud_saves WHERE floor_id=? AND project=? AND owner=?', f, p, owner);
    const sc = get(db, 'SELECT COUNT(*) n FROM cloud_scores WHERE floor_id=? AND project=? AND owner=?', f, p, owner).n;
    const fl = get(db, 'SELECT COUNT(*) n, COALESCE(SUM(size),0) b FROM cloud_files WHERE floor_id=? AND project=? AND owner=?', f, p, owner);
    run(db, 'DELETE FROM cloud_file_chunks WHERE floor_id=? AND project=? AND id IN (SELECT id FROM cloud_files WHERE floor_id=? AND project=? AND owner=?)', f, p, f, p, owner);
    for (const t of ['cloud_docs', 'cloud_saves', 'cloud_scores', 'cloud_files']) run(db, `DELETE FROM ${t} WHERE floor_id=? AND project=? AND owner=?`, f, p, owner);
    bump(f, p, { docs: -d.n, saves: -s.n, scores: -sc, files: -fl.n, bytes: -(d.b + s.b + sc * SCORE_ROW), fileBytes: -fl.b });
  }

  // ---- documents ----
  const docRow = (f, p, coll, id) => get(db, 'SELECT * FROM cloud_docs WHERE floor_id=? AND project=? AND coll=? AND id=?', f, p, coll, id);
  const viewDoc = (r, who) => ({
    id: r.id, data: JSON.parse(r.data), owner: ownerView(r.owner, r.owner_name), mine: !!who && r.owner === who.key, private: !!r.private,
    version: r.version, createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const docSize = (coll, id, text) => Buffer.byteLength(text) + coll.length + id.length + ROW;
  function readable(r, who) { return r && (!r.private || (who && r.owner === who.key)); }
  function needDoc(f, p, who, coll, id) {
    const r = docRow(f, p, need(COLL, coll, 'bad_collection', 'A collection name is 1 to 40 letters, digits, _ or -.'), need(DOC_ID, id, 'bad_id', 'A document id is 1 to 64 letters, digits, _ or -.'));
    if (!readable(r, who)) throw new CloudError(404, 'not_found', 'No such document.');
    return r;
  }
  const mustOwn = (r, who) => { if (!who || r.owner !== who.key) throw new CloudError(403, 'not_yours', 'Only whoever made this can change it.'); };
  const needWho = (who) => { if (!who) throw new CloudError(401, 'no_identity', 'This needs a player token or an account.'); return who; };
  function docData(data) {
    if (!plainObject(data)) throw bad('bad_data', 'A document is a JSON object.');
    return encode(data, L.docBytes, 'document');
  }

  const docs = {
    add(f, p, who, coll, data, { id, private: priv } = {}) {
      needWho(who); need(COLL, coll, 'bad_collection', 'A collection name is 1 to 40 letters, digits, _ or -.');
      const docId = id === undefined || id === null ? newId() : need(DOC_ID, id, 'bad_id', 'A document id is 1 to 64 letters, digits, _ or -.');
      const { text } = docData(data);
      return tx(db, () => {
        if (docRow(f, p, coll, docId)) throw new CloudError(409, 'exists', 'A document with that id already exists.');
        return insertDoc(f, p, who, coll, docId, text, !!priv);
      });
    },
    get: (f, p, who, coll, id) => viewDoc(needDoc(f, p, who, coll, id), who),
    /** Create or replace. A document that exists can only be replaced by whoever made it. */
    set(f, p, who, coll, id, data, { private: priv, ifVersion } = {}) {
      needWho(who); need(COLL, coll, 'bad_collection', 'A collection name is 1 to 40 letters, digits, _ or -.'); need(DOC_ID, id, 'bad_id', 'A document id is 1 to 64 letters, digits, _ or -.');
      const { text } = docData(data);
      return tx(db, () => {
        const r = docRow(f, p, coll, id);
        if (!r) { if (ifVersion !== undefined && ifVersion !== 0) throw new CloudError(409, 'version_conflict', 'Someone else changed this first.'); return insertDoc(f, p, who, coll, id, text, !!priv); }
        if (!readable(r, who)) throw new CloudError(409, 'exists', 'A document with that id already exists.');
        mustOwn(r, who);
        return replaceDoc(f, p, who, r, text, priv === undefined ? !!r.private : !!priv, ifVersion);
      });
    },
    /** Shallow merge: top-level fields in the patch replace the old ones, and a null removes one. */
    update(f, p, who, coll, id, patch, { ifVersion } = {}) {
      needWho(who);
      if (!plainObject(patch)) throw bad('bad_data', 'A change is a JSON object.');
      return tx(db, () => {
        const r = needDoc(f, p, who, coll, id); mustOwn(r, who);
        const merged = JSON.parse(r.data);
        for (const [k, v] of Object.entries(patch)) { if (v === null) delete merged[k]; else merged[k] = v; }
        return replaceDoc(f, p, who, r, docData(merged).text, !!r.private, ifVersion);
      });
    },
    remove(f, p, who, coll, id) {
      needWho(who);
      return tx(db, () => {
        const r = needDoc(f, p, who, coll, id); mustOwn(r, who);
        run(db, 'DELETE FROM cloud_docs WHERE floor_id=? AND project=? AND coll=? AND id=?', f, p, coll, id);
        bump(f, p, { docs: -1, bytes: -r.size });
        return true;
      });
    },
    find(f, p, who, coll, q = {}) {
      need(COLL, coll, 'bad_collection', 'A collection name is 1 to 40 letters, digits, _ or -.');
      const where = ['floor_id=?', 'project=?', 'coll=?', '(private=0 OR owner=?)']; const args = [f, p, coll, who ? who.key : ''];
      if (q.mine) { where.push('owner=?'); args.push(who ? who.key : ''); }
      const filters = q.where === undefined || q.where === null ? {} : q.where;
      if (!plainObject(filters)) throw bad('bad_where', 'where is an object of field: value.');
      const entries = Object.entries(filters);
      if (entries.length > L.filters) throw bad('bad_where', `At most ${L.filters} filters.`);
      for (const [field, v] of entries) {
        need(FIELD, field, 'bad_field', 'A field is letters, digits and _, with dots for nested fields.');
        const path = `$.${field}`;
        if (v === null) { where.push("json_type(data, ?)='null'"); args.push(path); } else if (typeof v === 'boolean') { where.push('json_type(data, ?)=?'); args.push(path, v ? 'true' : 'false'); } else if (typeof v === 'number' && Number.isFinite(v)) {
          where.push("json_type(data, ?) IN ('integer','real') AND json_extract(data, ?)=?"); args.push(path, path, v);
        } else if (typeof v === 'string' && v.length <= 500) { where.push("json_type(data, ?)='text' AND json_extract(data, ?)=?"); args.push(path, path, v); } else throw bad('bad_where', 'Filter values are strings, numbers, true, false or null.');
      }
      const order = q.order === 'desc' ? 'DESC' : 'ASC';
      let by;
      const sort = q.sort === undefined || q.sort === null || q.sort === '' ? 'createdAt' : q.sort;
      if (sort === 'createdAt') by = `created_at ${order}, id ${order}`; else if (sort === 'updatedAt') by = `updated_at ${order}, id ${order}`; else if (sort === 'id') by = `id ${order}`; else {
        need(FIELD, sort, 'bad_sort', 'sort is a field name, createdAt, updatedAt or id.');
        by = `json_extract(data, ?) ${order}, created_at ASC, id ASC`;
      }
      const limit = Math.min(Math.max(Number.parseInt(q.limit, 10) || 50, 1), L.queryMax);
      const offset = Math.min(Math.max(Number.parseInt(q.offset, 10) || 0, 0), L.offsetMax);
      const sortArgs = by.startsWith('json_extract') ? [`$.${sort}`] : [];
      const rows = all(db, `SELECT * FROM cloud_docs WHERE ${where.join(' AND ')} ORDER BY ${by} LIMIT ? OFFSET ?`, ...args, ...sortArgs, limit + 1, offset);
      const out = []; let bytes = 0;
      for (const r of rows.slice(0, limit)) { bytes += r.size; if (out.length && bytes > L.responseBytes) break; out.push(viewDoc(r, who)); }
      return { docs: out, more: rows.length > out.length };
    },
    count(f, p, who, coll) {
      need(COLL, coll, 'bad_collection', 'A collection name is 1 to 40 letters, digits, _ or -.');
      return get(db, 'SELECT COUNT(*) n FROM cloud_docs WHERE floor_id=? AND project=? AND coll=? AND (private=0 OR owner=?)', f, p, coll, who ? who.key : '').n;
    },
  };
  function insertDoc(f, p, who, coll, id, text, priv) {
    const u = usage(f, p);
    if (u.docs >= L.docs) throw full('This project has all the documents it can hold.');
    if (!get(db, 'SELECT 1 x FROM cloud_docs WHERE floor_id=? AND project=? AND coll=? LIMIT 1', f, p, coll)
      && get(db, 'SELECT COUNT(DISTINCT coll) n FROM cloud_docs WHERE floor_id=? AND project=?', f, p).n >= L.collections) throw full(`A project can have at most ${L.collections} collections.`);
    if (get(db, 'SELECT COUNT(*) n FROM cloud_docs WHERE floor_id=? AND project=? AND owner=?', f, p, who.key).n >= L.docsPerOwner) throw full('You have made as many documents here as one person can.');
    const size = docSize(coll, id, text);
    room(f, p, size);
    const t = now();
    run(db, 'INSERT INTO cloud_docs (floor_id,project,coll,id,owner,owner_name,private,data,size,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)',
      f, p, coll, id, who.key, who.name || '', priv ? 1 : 0, text, size, t, t);
    bump(f, p, { docs: 1, bytes: size });
    return viewDoc(docRow(f, p, coll, id), who);
  }
  function replaceDoc(f, p, who, r, text, priv, ifVersion) {
    if (ifVersion !== undefined && ifVersion !== r.version) throw new CloudError(409, 'version_conflict', 'Someone else changed this first.');
    const size = docSize(r.coll, r.id, text);
    room(f, p, size - r.size);
    run(db, 'UPDATE cloud_docs SET data=?, size=?, private=?, owner_name=?, version=version+1, updated_at=? WHERE floor_id=? AND project=? AND coll=? AND id=?',
      text, size, priv ? 1 : 0, who.name || r.owner_name, now(), f, p, r.coll, r.id);
    bump(f, p, { bytes: size - r.size });
    return viewDoc(docRow(f, p, r.coll, r.id), who);
  }

  // ---- saves: one person's own storage ----
  const saveRow = (f, p, owner, key) => get(db, 'SELECT * FROM cloud_saves WHERE floor_id=? AND project=? AND owner=? AND key=?', f, p, owner, key);
  const saves = {
    list: (f, p, who) => all(db, 'SELECT key, size, version, updated_at FROM cloud_saves WHERE floor_id=? AND project=? AND owner=? ORDER BY key LIMIT ?', f, p, needWho(who).key, L.savesPerOwner)
      .map((r) => ({ key: r.key, size: r.size, version: r.version, updatedAt: r.updated_at })),
    get(f, p, who, key) {
      const r = saveRow(f, p, needWho(who).key, need(KEY, key, 'bad_key', 'A key is 1 to 64 letters, digits or _ . : -'));
      // Nothing saved yet is a normal answer, not an error: a 404 would put a red line in every new player's console.
      if (!r) return { key, value: null, version: 0, found: false };
      return { key, value: JSON.parse(r.value), version: r.version, updatedAt: r.updated_at, found: true };
    },
    put(f, p, who, key, value, ifVersion) {
      needWho(who); need(KEY, key, 'bad_key', 'A key is 1 to 64 letters, digits or _ . : -');
      if (value === undefined) throw bad('no_value', 'Send a value.');
      const { text } = encode(value, L.saveBytes);
      const size = Buffer.byteLength(text) + key.length + ROW;
      return tx(db, () => {
        const prev = saveRow(f, p, who.key, key);
        if (ifVersion !== undefined && (prev?.version ?? 0) !== ifVersion) throw new CloudError(409, 'version_conflict', 'This save changed somewhere else first.');
        const mine = get(db, 'SELECT COUNT(*) n, COALESCE(SUM(size),0) b FROM cloud_saves WHERE floor_id=? AND project=? AND owner=?', f, p, who.key);
        if ((!prev && mine.n >= L.savesPerOwner) || mine.b - (prev?.size || 0) + size > L.saveBytesPerOwner) throw full('You have used all of your save space here.');
        room(f, p, size - (prev?.size || 0));
        const version = (prev?.version || 0) + 1;
        run(db, `INSERT INTO cloud_saves (floor_id,project,owner,key,value,size,version,updated_at) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(floor_id,project,owner,key) DO UPDATE SET value=excluded.value, size=excluded.size, version=excluded.version, updated_at=excluded.updated_at`,
        f, p, who.key, key, text, size, version, now());
        bump(f, p, { saves: prev ? 0 : 1, bytes: size - (prev?.size || 0) });
        return { key, version };
      });
    },
    remove(f, p, who, key) {
      needWho(who); need(KEY, key, 'bad_key', 'A key is 1 to 64 letters, digits or _ . : -');
      return tx(db, () => {
        const prev = saveRow(f, p, who.key, key);
        if (!prev) return false;
        run(db, 'DELETE FROM cloud_saves WHERE floor_id=? AND project=? AND owner=? AND key=?', f, p, who.key, key);
        bump(f, p, { saves: -1, bytes: -prev.size });
        return true;
      });
    },
  };

  // ---- leaderboards ----
  const boardLower = (f, p, board) => { const r = get(db, 'SELECT lower FROM cloud_scores WHERE floor_id=? AND project=? AND board=? LIMIT 1', f, p, board); return r ? !!r.lower : null; };
  function rankOf(f, p, board, lower, row) {
    const better = lower ? 'score < ?' : 'score > ?';
    return get(db, `SELECT COUNT(*) n FROM cloud_scores WHERE floor_id=? AND project=? AND board=? AND (${better} OR (score = ? AND updated_at < ?))`, f, p, board, row.score, row.score, row.updated_at).n + 1;
  }
  const scores = {
    submit(f, p, who, board, score, { name, lower: wantLower } = {}) {
      needWho(who); need(KEY, board, 'bad_board', 'A board name is 1 to 64 letters, digits or _ . : -');
      if (typeof score !== 'number' || !Number.isFinite(score) || Math.abs(score) > L.scoreMax) throw bad('bad_score', `A score is a number between -${L.scoreMax} and ${L.scoreMax}.`);
      const shown = who.kind === 'user' ? who.name : cleanName(name, 24) || 'Guest';
      return tx(db, () => {
        // The first score settles which way a board counts, so a later request can't flip it and knock the leaders off.
        const stored = boardLower(f, p, board);
        const lower = stored === null ? wantLower === true : stored;
        const prev = get(db, 'SELECT * FROM cloud_scores WHERE floor_id=? AND project=? AND board=? AND owner=?', f, p, board, who.key);
        const t = now();
        if (prev && (lower ? prev.score <= score : prev.score >= score)) {
          if (prev.name !== shown) run(db, 'UPDATE cloud_scores SET name=? WHERE floor_id=? AND project=? AND board=? AND owner=?', shown, f, p, board, who.key);
          return { board, lower, best: prev.score, improved: false, rank: rankOf(f, p, board, lower, prev) };
        }
        if (!prev) {
          if (stored === null && get(db, 'SELECT COUNT(DISTINCT board) n FROM cloud_scores WHERE floor_id=? AND project=?', f, p).n >= L.boards) throw full(`A project can have at most ${L.boards} leaderboards.`);
          if (get(db, 'SELECT COUNT(*) n FROM cloud_scores WHERE floor_id=? AND project=? AND board=?', f, p, board).n >= L.boardEntries) {
            // A full board keeps its best: a new score has to beat the worst one, which then drops off.
            const worst = get(db, `SELECT owner, score FROM cloud_scores WHERE floor_id=? AND project=? AND board=? ORDER BY score ${lower ? 'DESC' : 'ASC'}, updated_at DESC LIMIT 1`, f, p, board);
            if (lower ? score >= worst.score : score <= worst.score) return { board, lower, best: score, improved: false, rank: null };
            run(db, 'DELETE FROM cloud_scores WHERE floor_id=? AND project=? AND board=? AND owner=?', f, p, board, worst.owner);
            bump(f, p, { scores: -1, bytes: -SCORE_ROW });
          }
          room(f, p, SCORE_ROW);
          bump(f, p, { scores: 1, bytes: SCORE_ROW });
        }
        run(db, `INSERT INTO cloud_scores (floor_id,project,board,owner,name,score,lower,updated_at) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(floor_id,project,board,owner) DO UPDATE SET name=excluded.name, score=excluded.score, updated_at=excluded.updated_at`, f, p, board, who.key, shown, score, lower ? 1 : 0, t);
        return { board, lower, best: score, improved: true, rank: rankOf(f, p, board, lower, { score, updated_at: t }) };
      });
    },
    top(f, p, who, board, { limit, lower: wantLower } = {}) {
      need(KEY, board, 'bad_board', 'A board name is 1 to 64 letters, digits or _ . : -');
      const stored = boardLower(f, p, board);
      const lower = stored === null ? wantLower === true : stored;
      const n = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), L.queryMax);
      const rows = all(db, `SELECT owner, name, score, updated_at FROM cloud_scores WHERE floor_id=? AND project=? AND board=? ORDER BY score ${lower ? 'ASC' : 'DESC'}, updated_at ASC LIMIT ?`, f, p, board, n);
      const mine = who ? get(db, 'SELECT * FROM cloud_scores WHERE floor_id=? AND project=? AND board=? AND owner=?', f, p, board, who.key) : null;
      return {
        board, lower,
        entries: rows.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, at: r.updated_at, player: ownerView(r.owner, r.name).id, you: !!who && r.owner === who.key })),
        me: mine ? { rank: rankOf(f, p, board, lower, mine), score: mine.score, name: mine.name } : null,
      };
    },
  };

  // ---- files: stored in pieces, so serving one never holds the whole thing in memory ----
  const fileView = (r) => ({ id: r.id, name: r.name, type: r.type, size: r.size, url: `/_office/cloud/files/${r.id}`, createdAt: r.created_at });
  const files = {
    put(f, p, who, { name, body }) {
      needWho(who);
      if (!body.length) throw bad('empty', 'That file is empty.');
      if (body.length > L.fileMax) throw new CloudError(413, 'too_large', `A file can be at most ${Math.floor(L.fileMax / 1048576)} MB.`);
      const type = sniff(body);
      if (!type) throw new CloudError(415, 'bad_type', 'Only images (PNG, JPEG, GIF, WebP, AVIF), sound (MP3, OGG, WAV, M4A) and video (MP4, WebM) can be uploaded.');
      return tx(db, () => {
        const mine = get(db, 'SELECT COUNT(*) n, COALESCE(SUM(size),0) b FROM cloud_files WHERE floor_id=? AND project=? AND owner=?', f, p, who.key);
        if (mine.n >= L.filesPerOwner || mine.b + body.length > L.fileBytesPerOwner) throw full('You have used all of your upload space here.');
        if (usage(f, p).files >= L.files) throw full('This project has all the files it can hold.');
        room(f, p, body.length, true);
        const id = newId(16); const chunks = Math.ceil(body.length / CHUNK);
        for (let i = 0; i < chunks; i++) run(db, 'INSERT INTO cloud_file_chunks (floor_id,project,id,n,data) VALUES (?,?,?,?,?)', f, p, id, i, body.subarray(i * CHUNK, (i + 1) * CHUNK));
        run(db, 'INSERT INTO cloud_files (floor_id,project,id,owner,name,type,size,chunks,created_at) VALUES (?,?,?,?,?,?,?,?,?)', f, p, id, who.key, cleanFileName(name), type, body.length, chunks, now());
        bump(f, p, { files: 1, fileBytes: body.length });
        return fileView(get(db, 'SELECT * FROM cloud_files WHERE floor_id=? AND project=? AND id=?', f, p, id));
      });
    },
    meta(f, p, id) { if (!FILE_ID.test(String(id))) return null; return get(db, 'SELECT * FROM cloud_files WHERE floor_id=? AND project=? AND id=?', f, p, id) || null; },
    chunk: (f, p, id, n) => get(db, 'SELECT data FROM cloud_file_chunks WHERE floor_id=? AND project=? AND id=? AND n=?', f, p, id, n)?.data || null,
    CHUNK,
    list: (f, p, who) => all(db, 'SELECT * FROM cloud_files WHERE floor_id=? AND project=? AND owner=? ORDER BY created_at DESC LIMIT ?', f, p, needWho(who).key, L.filesPerOwner).map(fileView),
    view: fileView,
    remove(f, p, who, id) {
      needWho(who);
      return tx(db, () => {
        const r = files.meta(f, p, id);
        if (!r) throw new CloudError(404, 'not_found', 'No such file.');
        mustOwn(r, who);
        run(db, 'DELETE FROM cloud_file_chunks WHERE floor_id=? AND project=? AND id=?', f, p, id);
        run(db, 'DELETE FROM cloud_files WHERE floor_id=? AND project=? AND id=?', f, p, id);
        bump(f, p, { files: -1, fileBytes: -r.size });
        return true;
      });
    },
  };

  // ---- the building manager's tools ----
  /** Counts only: what a boss may see about their own project. No names, no content, nothing from a password. */
  function summary(f, p) {
    const u = usage(f, p);
    return {
      users: u.users, docs: u.docs, saves: u.saves, scores: u.scores, files: u.files, bytes: u.bytes, fileBytes: u.file_bytes,
      collections: get(db, 'SELECT COUNT(DISTINCT coll) n FROM cloud_docs WHERE floor_id=? AND project=?', f, p).n,
      boards: get(db, 'SELECT COUNT(DISTINCT board) n FROM cloud_scores WHERE floor_id=? AND project=?', f, p).n,
      requestsToday: u.day === new Date(now()).toISOString().slice(0, 10) ? u.requests : 0,
      limits: { bytes: L.dataBytes, fileBytes: L.fileBytes },
    };
  }
  const projects = () => all(db, 'SELECT floor_id, project FROM cloud_usage UNION SELECT floor_id, project FROM cloud_users ORDER BY floor_id, project');
  /** Everything a project keeps, for the admin's export. Accounts leave without their password hashes or sessions. */
  function exportProject(f, p, { withFiles = false } = {}) {
    const files = all(db, 'SELECT * FROM cloud_files WHERE floor_id=? AND project=? ORDER BY created_at', f, p).map((r) => ({
      ...fileView(r), owner: r.owner, ...(withFiles ? { base64: Buffer.concat(all(db, 'SELECT data FROM cloud_file_chunks WHERE floor_id=? AND project=? AND id=? ORDER BY n', f, p, r.id).map((c) => Buffer.from(c.data))).toString('base64') } : {}),
    }));
    return {
      floorId: f, project: p, exportedAt: new Date(now()).toISOString(), usage: summary(f, p),
      users: all(db, 'SELECT uid, username, email, name, created_at, login_at FROM cloud_users WHERE floor_id=? AND project=? ORDER BY id', f, p),
      docs: all(db, 'SELECT coll, id, owner, owner_name, private, data, version, created_at, updated_at FROM cloud_docs WHERE floor_id=? AND project=? ORDER BY coll, created_at', f, p).map((r) => ({ ...r, data: JSON.parse(r.data) })),
      saves: all(db, 'SELECT owner, key, value, version, updated_at FROM cloud_saves WHERE floor_id=? AND project=? ORDER BY owner, key', f, p).map((r) => ({ ...r, value: JSON.parse(r.value) })),
      scores: all(db, 'SELECT board, owner, name, score, lower, updated_at FROM cloud_scores WHERE floor_id=? AND project=? ORDER BY board, score', f, p),
      files,
    };
  }
  function wipeProject(f, p) {
    return tx(db, () => {
      let n = 0;
      for (const t of TABLES) n += run(db, `DELETE FROM ${t} WHERE floor_id=? AND project=?`, f, p).changes;
      return n;
    });
  }
  const wipeFloor = (f) => tx(db, () => { for (const t of [...TABLES, ...CLOUD_POWER_TABLES]) run(db, `DELETE FROM ${t} WHERE floor_id=?`, f); });
  /** Recounts a project from its rows, for the admin to check the running totals against. */
  function recount(f, p) {
    const n = (sql) => get(db, sql, f, p).n;
    const real = {
      docs: n('SELECT COUNT(*) n FROM cloud_docs WHERE floor_id=? AND project=?'), saves: n('SELECT COUNT(*) n FROM cloud_saves WHERE floor_id=? AND project=?'),
      scores: n('SELECT COUNT(*) n FROM cloud_scores WHERE floor_id=? AND project=?'), users: n('SELECT COUNT(*) n FROM cloud_users WHERE floor_id=? AND project=?'),
      files: n('SELECT COUNT(*) n FROM cloud_files WHERE floor_id=? AND project=?'), file_bytes: n('SELECT COALESCE(SUM(size),0) n FROM cloud_files WHERE floor_id=? AND project=?'),
    };
    real.bytes = n('SELECT COALESCE(SUM(size),0) n FROM cloud_docs WHERE floor_id=? AND project=?') + n('SELECT COALESCE(SUM(size),0) n FROM cloud_saves WHERE floor_id=? AND project=?')
      + real.scores * SCORE_ROW + real.users * USER_ROW;
    return real;
  }
  /** Drops sessions that have run out, so the table can't only grow. */
  const sweep = () => run(db, 'DELETE FROM cloud_sessions WHERE expires_at <= ?', now()).changes;

  return { L, usage, summary, projects, addRequests, users, publicUser, docs, saves, scores, files, exportProject, wipeProject, wipeFloor, recount, sweep };
}
