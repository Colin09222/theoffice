// How a job is sized, checked and costed (docs/MANAGER.md). Plain helpers with no state of their own: the tools, the engine and the computers call them.
// - A job's acceptance checks: the "Done means:" list, as its own field, so whoever does the job can tick each one off with evidence before handing in.
// - The self-check: that ticking-off, read back out of a reply. It is the doer's own word, so it is data for the manager and the Tester, never a verdict.
// - The estimate: what jobs like this one have cost here before. For the admin's reports only; no bot and no boss is ever shown a figure.
import { get, all } from './db.js';

export const SIZES = ['small', 'standard', 'big'];
const CHECKS_MAX = 8, CHECK_CHARS = 300, EVIDENCE_CHARS = 240;
const DONE_MEANS = /done means\s*:/i;
const oneLine = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** The checks the manager passed, cleaned: text only, a handful at most. */
export function cleanChecks(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => typeof x === 'string').map((x) => oneLine(x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''), CHECK_CHARS)).filter((x) => x.length >= 3).slice(0, CHECKS_MAX);
}
/** The checks a brief already carries after its last "Done means:", when the manager typed them there instead: bullets or numbered lines, or one line split at its semicolons. */
export function checksInBrief(brief) {
  const text = String(brief ?? '');
  let at = -1;
  for (const m of text.matchAll(new RegExp(DONE_MEANS.source, 'gi'))) at = m.index + m[0].length;
  if (at < 0) return [];
  const rest = text.slice(at);
  const lines = rest.split('\n').map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^(?:[-*•]|\d+[.)])\s+\S/.test(l));
  if (bullets.length >= 2) return cleanChecks(bullets);
  return cleanChecks((lines[0] || '').split(/;\s+/));
}
/** The brief as the doer reads it: the checks as its "Done means:" list, unless the brief already has one. */
export function briefWithChecks(brief, checks) {
  if (!checks.length || DONE_MEANS.test(brief)) return brief;
  return `${String(brief).trimEnd()}${doneBlock(checks)}`;
}
/** The list the office writes into a brief. Numbered, because the self-check answers it by number. */
const doneBlock = (checks) => `\n\nDone means:\n${checks.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
/** A brief without the list the office wrote into it, so a changed list can take its place. A list the manager typed itself stays where it is. */
export function briefWithoutChecks(brief, checks) {
  const block = checks.length ? doneBlock(checks) : '';
  return block && String(brief).endsWith(block) ? String(brief).slice(0, -block.length) : String(brief);
}
export function readChecks(task) { try { const c = JSON.parse(task?.checks || '[]'); return Array.isArray(c) ? c.filter((x) => typeof x === 'string') : []; } catch { return []; } }

// ---- the self-check ----
/** Said to whoever does a job that has acceptance checks, with their brief. */
export const selfCheckAsk = (checks) => `Before you hand in: go through these checks one at a time, and check each one yourself against what you actually made: open it, run it or read the file. Fix what fails and check it again.
${checks.map((c, i) => `${i + 1}. ${c}`).join('\n')}
Then end your reply with this block, one line per check, with the same numbers:
Self-check:
1. PASS - what you opened, ran or read, and what you saw
2. FAIL - what is wrong, and why you couldn't fix it
3. NOT CHECKED - why you couldn't check it
PASS means you saw it yourself in this job. Never write PASS for something you didn't check: an honest NOT CHECKED is worth more than a PASS that isn't true. Keep each line short.`;
/** Sent once when a reply came back without it. The marker is how a job that was stopped and picked up again knows it has already been asked. */
export const SELF_CHECK_MARK = '[Office note, not from the boss] Before this goes to review:';
export const selfCheckNudge = (checks) => `${SELF_CHECK_MARK} your reply has no self-check of the "Done means" list${checks.length ? ` (${checks.length} check${checks.length === 1 ? '' : 's'})` : ''}. Check each one now against what you actually made, fix what fails, then reply again with your short summary and, after it, the block:
Self-check:
1. PASS, FAIL or NOT CHECKED - what you opened, ran or read, and what you saw
One line per check, in the same order. Never write PASS for something you didn't check.`;

const VERDICTS = [[/^pass(?:ed|es)?\b/i, 'pass'], [/^fail(?:ed|s)?\b/i, 'fail'], [/^(?:not checked|could(?: ?no|n'?)t check|unchecked|not verified)\b/i, 'unchecked']];
// A line that names the check first and gives its verdict after: only the words in capitals count there, so "it must not fail" is not a verdict.
const VERDICT_LATER = [[/\bNOT CHECKED\b|\bCOULD NOT CHECK\b/, 'unchecked'], [/\bPASS(?:ED)?\b/, 'pass'], [/\bFAIL(?:ED)?\b/, 'fail']];
/**
 * A reply's self-check, read back: { lines: [{ n, verdict, evidence }], summary }, or null when the reply has none. `summary` is the reply without the block,
 * which is what the report keeps: a report is cut to a length, and the block sits at its end.
 */
export function readSelfCheck(text) {
  const src = String(text ?? '');
  // The heading, and whatever follows it: some write the first line straight after "Self-check:".
  const head = [...src.matchAll(/^[ \t>*_#-]*self[- ]?check\b[ \t]*[:*_]*/gim)].at(-1);
  if (!head) return null;
  const lines = [], rest = src.slice(head.index + head[0].length).split('\n');
  let gap = false, after = '';
  for (let i = 0; i < rest.length; i++) {
    const raw = rest[i];
    if (!raw.trim()) { gap = true; continue; }
    const m = /^\s*(?:[-*•]\s*)?(?:check\s*)?(\d{1,2})\s*[.):-]\s*(.*)$/i.exec(raw);
    if (!m) {
      // Words after a blank line are no longer the block: they go back with the report. Words straight under a line are the rest of that line.
      if (lines.length && gap) { after = rest.slice(i).join('\n').trim(); break; }
      if (lines.length && !/^\s*(?:[-*•]|\d)/.test(raw)) lines.at(-1).evidence = oneLine(`${lines.at(-1).evidence} ${raw}`, EVIDENCE_CHARS);
      continue;
    }
    gap = false;
    const body = m[2].replace(/^[*_`\s[]+/, '');
    const hit = VERDICTS.find(([re]) => re.test(body)) || VERDICT_LATER.find(([re]) => re.test(body));
    if (!hit) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 20 || lines.some((l) => l.n === n)) continue;
    lines.push({ n, verdict: hit[1], evidence: oneLine(body.replace(hit[0], '').replace(/^[\s*_`\]:.–—-]+/, ''), EVIDENCE_CHARS) });
    if (lines.length >= CHECKS_MAX) break;
  }
  if (!lines.length) return null;
  return { lines, summary: [src.slice(0, head.index).trim(), after].filter(Boolean).join('\n\n') };
}
/** Does this reply tick off every check? A block shorter than the list is a block with something left out. */
export const selfChecked = (text, checks) => { const r = readSelfCheck(text); return !!r && r.lines.length >= Math.min(checks.length, CHECKS_MAX); };
/** A self-check without evidence is a claim, so a bare PASS is told apart from one that says what was seen. */
const EVIDENCE_MIN = 12;
export function selfCheckWords(raw, checks = []) {
  let lines; try { lines = JSON.parse(raw || '[]'); } catch { return ''; }
  if (!Array.isArray(lines) || !lines.length) return '';
  const word = { pass: 'PASS', fail: 'FAIL', unchecked: 'NOT CHECKED' };
  const bare = lines.filter((l) => l.verdict === 'pass' && String(l.evidence || '').length < EVIDENCE_MIN).length;
  const count = (v) => lines.filter((l) => l.verdict === v).length;
  const head = `${count('pass')} PASS${bare ? ` (${bare} with no evidence given)` : ''}, ${count('fail')} FAIL, ${count('unchecked')} NOT CHECKED${checks.length > lines.length ? `, ${checks.length - lines.length} of the ${checks.length} checks not mentioned` : ''}`;
  return `${head}\n${lines.map((l) => `${l.n}. ${word[l.verdict] || 'NOT CHECKED'}${checks[l.n - 1] ? ` ("${oneLine(checks[l.n - 1], 90)}")` : ''}: ${l.evidence || 'no evidence given'}`).join('\n')}`;
}

// ---- the estimate ----
// What a job of each kind cost on the real floors in the week to 2026-11-11 (docs/EFFICIENCY.md), used until a floor has finished jobs of its own to go by.
const TYPICAL_USD = { builder: { small: 2, standard: 6, big: 17 }, tester: { small: 1.5, standard: 3, big: 3 }, researcher: { small: 1, standard: 3, big: 8 }, marketer: { small: 1, standard: 2, big: 5 }, lawyer: { small: 0.2, standard: 0.3, big: 1 } };
const OTHER_USD = { small: 0.5, standard: 1, big: 2 };
const SAMPLE = 15, ENOUGH = 3;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
/**
 * What a job like this has cost before: the median of the last finished ones that cost anything, for the same job on this floor at this size, then on this floor
 * at any size, then anywhere in the building, then a typical figure. A job that goes to the outside contractor calls no model, so it is estimated at nothing.
 */
export function estimateUsd(db, floorId, role, size = '', { contractor = false } = {}) {
  if (contractor) return 0;
  const past = (where, ...args) => all(db, `SELECT t.cost_usd c FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE a.role=? AND t.status='done' AND t.cost_usd>0 AND t.contractor=0 ${where} ORDER BY t.id DESC LIMIT ?`, role, ...args, SAMPLE).map((r) => r.c);
  const tries = [() => past('AND t.floor_id=? AND t.size=?', floorId, size), () => past('AND t.floor_id=?', floorId), () => past('AND t.size=?', size), () => past('')];
  for (const t of tries) { const got = t(); if (got.length >= ENOUGH) return Math.round(median(got) * 100) / 100; }
  return (TYPICAL_USD[role] || OTHER_USD)[size || 'standard'] ?? OTHER_USD.standard;
}

// ---- one job, written once ----
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'with', 'its', 'it', 'is', 'at', 'by', 'from', 'as', 'that', 'this', 'then', 'plus']);
const titleWords = (s) => new Set(String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
/** Two titles that say the same job: the same words, or nearly all of them. */
export function sameJob(a, b) {
  const x = titleWords(a), y = titleWords(b);
  if (!x.size || !y.size) return false;
  let both = 0; for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= 0.75;
}
/** A job this person already has waiting on this project that says the same thing: the one to amend, rather than a second copy. */
export function waitingTwin(db, floorId, agentId, project, title) {
  const waiting = all(db, "SELECT id,title FROM tasks WHERE floor_id=? AND agent_id=? AND project=? AND status='todo' AND transcript='' AND cost_usd=0 ORDER BY id", floorId, agentId, project);
  return waiting.find((t) => sameJob(t.title, title)) || null;
}
/** The manager's own question to the boss that nobody has answered yet. */
export const openManagerQuestion = (db, floorId) => get(db, "SELECT q.id,q.text FROM questions q JOIN agents a ON a.id=q.agent_id WHERE q.floor_id=? AND q.answer IS NULL AND q.task_id IS NULL AND a.role='manager' ORDER BY q.id LIMIT 1", floorId);
