#!/usr/bin/env node
// How big a Builder call is (redesign job 18): the average input tokens over the last N real Builder model calls, from the ledger, split by whether the
// call was a computer's step. The target is 80,000 or less (it was 211,000). Reads the database file only; calls nothing.
//   node scripts/builder-context.mjs [--last 20] [--floor N] [--json]
import { loadConfig } from '../server/config.js';
import { openDb, all, get } from '../server/db.js';

const args = process.argv.slice(2);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const last = Math.max(1, Math.min(10000, Number(val('--last', 20)) || 20));
const db = openDb(loadConfig().dataDir);
const floorNo = val('--floor');
const floor = floorNo ? get(db, 'SELECT id FROM floors WHERE number=?', Number(floorNo)) : null;
if (floorNo && !floor) { console.error(`There is no floor ${floorNo}.`); process.exit(1); }
const rows = all(db, `SELECT l.prompt_tokens n, l.computer c, l.model m, l.created_at t FROM ledger l JOIN agents a ON a.id=l.agent_id
  WHERE a.role='builder' AND l.kind='model' AND l.prompt_tokens>0 AND l.model!='managed-session' ${floor ? 'AND l.floor_id=?' : ''} ORDER BY l.id DESC LIMIT ?`, ...(floor ? [floor.id] : []), last);
const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const all_ = rows.map((r) => r.n), comp = rows.filter((r) => r.c).map((r) => r.n), plain = rows.filter((r) => !r.c).map((r) => r.n);
const out = { calls: rows.length, averageTokens: avg(all_), medianTokens: median(all_), maxTokens: all_.length ? Math.max(...all_) : null, onComputer: { calls: comp.length, averageTokens: avg(comp) }, withoutComputer: { calls: plain.length, averageTokens: avg(plain) }, target: 80000, since: rows.length ? new Date(rows.at(-1).t).toISOString() : null };
if (args.includes('--json')) console.log(JSON.stringify(out, null, 2));
else console.log(rows.length ? `Last ${out.calls} Builder calls${floorNo ? ` on floor ${floorNo}` : ''}: average ${out.averageTokens.toLocaleString('en-US')} input tokens (median ${out.medianTokens.toLocaleString('en-US')}, max ${out.maxTokens.toLocaleString('en-US')}); on a computer ${comp.length} at ${avg(comp)?.toLocaleString('en-US') ?? '-'}, without ${plain.length} at ${avg(plain)?.toLocaleString('en-US') ?? '-'}. Target: 80,000 or less.` : 'No Builder calls in the ledger yet.');
db.close();
