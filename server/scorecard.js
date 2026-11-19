// The idea scorecard (docs/redesign/ROUND1-REST.md, job 25). Each Business idea card carries four scores, 0 to 3, that the Researcher fills in within
// the propose_ideas call it already makes (no extra model call): Who pays, Days to first dollar, Cost to build, Cost to run per week. The bar is 8 of 12
// with Who pays above 0. Below it the boss sees one plain warning and can still pick the idea: nothing is blocked and nothing needs Colon's OK.
// The scores are the boss's only. What the Researcher reads says the scales in words; the dollar bands are for the boss's legend alone, so no prompt or
// tool description carries a figure.

export const BAR = 8;
export const MAX = 12;
/** The four scores: the key the Researcher writes, the key kept on the card, the label and the legend the boss reads. */
export const SCORES = [
  { arg: 'who_pays', key: 'whoPays', label: 'Who pays', legend: '3 = a clear group already pays for this, 0 = nobody clear',
    words: '3 if a named group already pays for this today (one of your links shows it), 2 if they pay for something close, 1 if maybe, 0 if nobody clear pays' },
  { arg: 'days_to_first_dollar', key: 'daysToFirstDollar', label: 'Days to first dollar', legend: '3 = within a week, 2 = within a month, 1 = within three months, 0 = longer',
    words: '3 if the first sale could come within a week of going live, 2 within a month, 1 within three months, 0 longer' },
  { arg: 'cost_to_build', key: 'costToBuild', label: 'Cost to build', legend: '3 = under $3, 2 = $3 to $10, 1 = $10 to $30, 0 = over $30',
    words: '3 if the first version is one page with a form, 2 a small shop or a few pages, 1 an app or many parts, 0 something big (stock, premises, licences or a large app)' },
  { arg: 'cost_to_run', key: 'costToRun', label: 'Cost to run per week', legend: '3 = nothing to speak of, 0 = a lot',
    words: '3 if it costs nothing to keep running each week, 2 a little (a domain or a cheap tool), 1 a fair amount (stock, deliveries), 0 a lot' },
];

/** The Researcher's four scores, read as whole numbers 0 to 3, or null if any is missing or out of range. */
export function readScores(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const s of SCORES) {
    const v = raw[s.arg] ?? raw[s.key];
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (!Number.isInteger(n) || n < 0 || n > 3) return null;
    out[s.key] = n;
  }
  return out;
}

const REASON = {
  whoPays: 'it isn\'t clear enough who pays for it.',
  daysToFirstDollar: 'the first dollar is a long way off.',
  costToBuild: 'it costs a lot to build.',
  costToRun: 'it costs a lot to run each week.',
};
/** The plain warning a boss sees below the bar, or '' at or above it. */
export function warningFor(scores) {
  if (!scores) return '';
  const total = SCORES.reduce((s, x) => s + scores[x.key], 0);
  if (total >= BAR && scores.whoPays > 0) return '';
  const why = scores.whoPays === 0 ? 'nobody clear pays for it yet.' : REASON[[...SCORES].sort((a, b) => scores[a.key] - scores[b.key])[0].key];
  return `This idea scores ${total} of ${MAX}: ${why}`;
}

/** What the boss's card shows: the four scores with their legends, the total, and the warning if it is below the bar. */
export function scoreView(scores) {
  if (!scores) return null;
  const total = SCORES.reduce((s, x) => s + scores[x.key], 0);
  const warning = warningFor(scores);
  return { total, max: MAX, bar: BAR, below: !!warning, warning, rows: SCORES.map((s) => ({ key: s.key, label: s.label, value: scores[s.key], legend: s.legend })) };
}

/** The tool's own description of the scores, in words only. */
export const SCORES_SCHEMA = {
  type: 'object',
  description: 'Four scores for this idea, each a whole number 0 to 3. Be honest: a low score is fine, the boss still decides.',
  properties: Object.fromEntries(SCORES.map((s) => [s.arg, { type: 'integer', minimum: 0, maximum: 3, description: `${s.label}: ${s.words}` }])),
  required: SCORES.map((s) => s.arg),
};
/** The line in the Researcher's brief. */
export const SCORES_BRIEF = `Score each card 0 to 3 on four things in its scores: ${SCORES.map((s) => `${s.arg} (${s.words})`).join('; ')}. Low scores are fine: say it as it is.`;
