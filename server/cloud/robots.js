// robots.txt, as RFC 9309 has it: one group for this crawler, or else the '*' group; the longest matching rule wins and Allow wins a tie.
// The file comes from strangers, so the sizes are capped, and a pattern is matched piece by piece with indexOf rather than a regex that a line of stars could stall.
export const CRAWLER = 'theofficebot';
const MAX_RULES = 2000, MAX_PATTERN = 512;

const upperHex = (s) => s.replace(/%[0-9a-f]{2}/gi, (x) => x.toUpperCase());
function normalize(pattern) {
  let p = upperHex(pattern);
  if (!p.startsWith('/') && !p.startsWith('*')) p = `/${p}`;
  try { p = p.replace(/[^\x00-\x7f]+/g, (x) => encodeURI(x)); } catch { /* a lone surrogate: left as it is */ }
  return p;
}

/** Pieces between the stars, and whether the pattern ends with $. */
function compile(pattern) {
  const anchored = pattern.endsWith('$');
  const pieces = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  return { pieces, anchored, weight: pattern.length };
}
function matches(rule, path) {
  const { pieces, anchored } = rule;
  if (!path.startsWith(pieces[0])) return false;
  let at = pieces[0].length;
  const last = pieces.length - 1;
  for (let i = 1; i <= last; i++) {
    if (i === last && anchored) {
      const piece = pieces[i];
      return path.length - piece.length >= at && path.endsWith(piece);
    }
    const found = path.indexOf(pieces[i], at);
    if (found < 0) return false;
    at = found + pieces[i].length;
  }
  return anchored ? at === path.length : true;
}

/** The rules that apply to this crawler: {rules: [{allow, ...}], delay: seconds or null}. */
export function parseRobots(text, crawler = CRAWLER) {
  const groups = [];
  let current = null, inAgents = false;
  for (const raw of String(text).replace(/^﻿/, '').split(/\r\n|\n|\r/)) {
    const line = raw.split('#')[0].trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!inAgents) { current = { agents: [], rules: [], delay: null }; groups.push(current); inAgents = true; }
      current.agents.push(value.split('/')[0].trim().toLowerCase());
      continue;
    }
    if (key !== 'allow' && key !== 'disallow' && key !== 'crawl-delay') continue;
    if (!current) continue;   // rules before any user-agent line belong to nobody
    inAgents = false;
    if (key === 'crawl-delay') { const n = Number(value); if (Number.isFinite(n) && n >= 0 && current.delay === null) current.delay = n; continue; }
    if (!value || value.length > MAX_PATTERN || current.rules.length >= MAX_RULES) continue;
    current.rules.push({ allow: key === 'allow', ...compile(normalize(value)) });
  }
  const own = groups.filter((g) => g.agents.includes(crawler));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules).slice(0, MAX_RULES);
  return { rules, delay: chosen.map((g) => g.delay).find((d) => d !== null) ?? null };
}

/** Whether this crawler may fetch the given path and query. No rule that matches means yes, and /robots.txt itself is always allowed. */
export function robotsAllows(parsed, pathAndQuery) {
  const path = upperHex(pathAndQuery || '/');
  if (path === '/robots.txt') return true;
  let best = null;
  for (const rule of parsed.rules) {
    if (best && (rule.weight < best.weight || (rule.weight === best.weight && best.allow))) continue;
    if (matches(rule, path)) best = rule;
  }
  return best ? best.allow : true;
}
