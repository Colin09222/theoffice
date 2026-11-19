// Done-means lines (docs/redesign/OFFICE-ANSWERS-1.md, Q9 and section 5 steps 3 and 8; job 9). Every new job carries 3 to 5 "done means" lines, stored as
// data on the task (tasks.checks) before work starts. Once work starts they are frozen (tasks.checks_frozen_at); only the boss can change them, through a
// message the manager turns into an amend. The Tester checks only those lines, and its report lists only those lines, each PASS or FAIL with evidence.
// Anything else it noticed goes to the project's "Later" list (project_later), never back to the Builder. Nothing here calls a model.
import { get, all, run } from './db.js';
import { readChecks, readSelfCheck } from './brain.js';

export const LINES_MIN = 3, LINES_MAX = 5;
const LATER_MAX = 10, LATER_CHARS = 240;
const oneLine = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** Why a list of lines can't be a job's done-means, or null. */
export function linesProblem(lines) {
  if (lines.length < LINES_MIN) return `every job needs ${LINES_MIN} to ${LINES_MAX} "done means" lines before it starts: short things anyone could check by opening it, in the boss's words where you can. Give them in checks.`;
  if (lines.length > LINES_MAX) return `a job has at most ${LINES_MAX} "done means" lines. Keep the ${LINES_MAX} that matter most to the boss; split the rest into a job of its own if it is really needed.`;
  return null;
}

/** The lines a Tester's job checks: those of the job it tests (one it waits on, else the last one finished on its project). */
export function testedLines(db, floorId, { dependsOn = [], project = '' }) {
  const ids = dependsOn.map(Number).filter(Number.isInteger);
  const notTests = "a.role IS NOT 'tester'";
  const rows = ids.length
    ? all(db, `SELECT t.checks FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND t.id IN (${ids.map(() => '?').join(',')}) AND ${notTests} ORDER BY t.id DESC`, floorId, ...ids)
    : project ? all(db, `SELECT t.checks FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND t.project=? AND ${notTests} AND t.status NOT IN ('cancelled') ORDER BY t.id DESC LIMIT 1`, floorId, project) : [];
  for (const r of rows) { const l = readChecks(r); if (l.length) return l.slice(0, LINES_MAX); }
  return [];
}

/** What a Tester is told, after the numbered "Done means:" list in its brief. */
export const TESTER_LINES = `How to test this job: check only the "Done means" lines above, one at a time, on the real thing. Nothing else is a failure, however much you would change.
End your reply with "Test report:" and one line per done-means line, with the same numbers:
1. PASS - what you opened or ran, and what you saw
2. FAIL - what you did, what you saw, and what was wrong
Write NOT CHECKED only when you truly could not check a line, and say why.
Anything else you noticed, ideas included, goes after that under "Later:" as a short list. It is kept on the project's Later list for the boss to decide on, and never goes back to whoever built it.`;

/** A Tester's report, read against the lines: one entry per line (a line it never reached is NOT CHECKED), and the Later list. null when there are no lines. */
export function readTestReport(text, lines) {
  if (!lines.length) return null;
  const src = String(text ?? '');
  const head = [...src.matchAll(/^[ \t>*_#-]*test report\b/gim)].at(-1);
  const laterAt = [...src.matchAll(/^[ \t>*_#-]*later\b[ \t]*[:*_]*/gim)].at(-1);
  const body = head ? `Self-check:${src.slice(head.index + head[0].length, laterAt && laterAt.index > head.index ? laterAt.index : undefined)}` : `Self-check:\n${laterAt ? src.slice(0, laterAt.index) : src}`;
  const got = readSelfCheck(body)?.lines || [];
  const out = lines.map((line, i) => {
    const g = got.find((x) => x.n === i + 1);
    return { n: i + 1, line, verdict: g?.verdict || 'unchecked', evidence: g?.evidence || '' };
  });
  const later = laterAt ? src.slice(laterAt.index + laterAt[0].length).split('\n').map((l) => oneLine(l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''), LATER_CHARS)).filter((l) => l.length >= 3).slice(0, LATER_MAX) : [];
  return { lines: out, later, failed: out.some((l) => l.verdict === 'fail') };
}

const WORD = { pass: 'PASS', fail: 'FAIL', unchecked: 'NOT CHECKED' };
/** The report as it is kept and handed on: only the done-means lines. */
export function testReportText(r) {
  const head = `Tested against its ${r.lines.length} "done means" lines: ${r.lines.filter((l) => l.verdict === 'pass').length} PASS, ${r.lines.filter((l) => l.verdict === 'fail').length} FAIL, ${r.lines.filter((l) => l.verdict === 'unchecked').length} NOT CHECKED.`;
  const body = r.lines.map((l) => `${l.n}. ${WORD[l.verdict]} ("${oneLine(l.line, 120)}"): ${l.evidence || 'no evidence given'}`).join('\n');
  return `${head}\n${body}${r.later.length ? `\n\n${r.later.length} other thing${r.later.length > 1 ? 's' : ''} the Tester noticed went to the project's Later list for the boss. They are not part of this job.` : ''}`;
}

/** Puts the Tester's other ideas on the project's Later list. */
export function keepLater(db, { floorId, project, taskId, items, now = Date.now() }) {
  for (const text of items) run(db, 'INSERT INTO project_later (floor_id,project,task_id,text,created_at) VALUES (?,?,?,?,?)', floorId, project || '', taskId, text, now);
}
export const laterList = (db, floorId, project) => all(db, 'SELECT id, text, task_id, created_at FROM project_later WHERE floor_id=? AND project=? ORDER BY id', floorId, project);
export const laterCount = (db, floorId, project) => get(db, 'SELECT COUNT(*) n FROM project_later WHERE floor_id=? AND project=?', floorId, project).n;
