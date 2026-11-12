// What the staff gossip about over the kettle: the floor's own recent happenings as short plain facts, and how much cheek they may give the boss.
// Facts come only from this floor's own rows. Each says whether a visitor could already see it, so a line built on one they couldn't stays with the boss
// (server/engine.js talk, `hush`). No figure about money ever goes in: a stopped day is "the day's allowance ran out", never an amount.
import { get, all } from './db.js';

const HOUR = 3600000;
// The feed lines worth a remark. Reading files and starting computers aren't news.
const NEWSY = /^(finished|could not finish|approved|sent ".+" back|published|put up)/;
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const short = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t; };

export const bossNameOf = (floor) => { try { return short(JSON.parse(floor.boss || '{}').name, 30) || 'the boss'; } catch { return 'the boss'; } };
/** Whether this floor's small talk may rib its boss: the building's switch and the boss's own. */
export const sassOn = (cfg, floor) => cfg.banterSass !== false && Number(floor?.banter_sass ?? 1) !== 0;

/**
 * Recent happenings on one floor, newest first: [{ text, open }]. `open` is false for anything a visitor couldn't see: private work, what the boss said
 * on a floor whose chat is closed, and a day the work stopped early.
 */
export function floorGossip(db, floor, { now = Date.now(), hours = 12, most = 8 } = {}) {
  const since = now - hours * HOUR, boss = bossNameOf(floor);
  const privateProject = new Map(all(db, 'SELECT slug, private FROM projects WHERE floor_id=?', floor.id).map((p) => [p.slug, !!p.private]));
  const hidden = (project, agent) => (project ? privateProject.get(project) ?? false : !!floor.default_private && agent !== null);
  const out = [], seen = new Set();
  for (const e of all(db, "SELECT project, data FROM events WHERE floor_id=? AND type='feed' AND created_at>=? ORDER BY id DESC LIMIT 300", floor.id, since)) {
    let d; try { d = JSON.parse(e.data); } catch { continue; }
    if (!NEWSY.test(String(d.text || ''))) continue;
    const text = short(`${d.name || 'Someone'} ${d.text}`, 150);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ text, open: !hidden(e.project, d.agent ?? null) });
    if (out.length >= most) break;
  }
  // Plans the boss's word overturned: a count, no titles, so it says nothing about what the work was.
  const scrapped = get(db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status='cancelled' AND updated_at>=?", floor.id, since).n;
  if (scrapped >= 2) out.push({ text: `${scrapped} jobs were scrapped in the last ${hours} hours after plans changed`, open: true });
  const said = all(db, "SELECT text, created_at FROM messages WHERE floor_id=? AND role='boss' AND created_at>=? ORDER BY id DESC LIMIT 12", floor.id, now - 24 * HOUR);
  if (said.length) {
    const quote = short(said[0].text, 140);
    out.push({ text: `${boss}'s latest message to the manager: "${quote}"`, open: !!floor.public_chat, bossSaid: quote });
    const lately = said.filter((m) => m.created_at >= now - 3 * HOUR).length;
    if (lately >= 3) out.push({ text: `${boss} has sent the manager ${lately} messages in the last three hours`, open: true });
  }
  const stopped = get(db, "SELECT created_at FROM messages WHERE floor_id=? AND role='budget' AND created_at>=? ORDER BY id DESC LIMIT 1", floor.id, now - 36 * HOUR);
  if (stopped) out.push({ text: `Work stopped early on ${DAY[new Date(stopped.created_at).getDay()]} because the day's allowance ran out, and everyone was sent home`, open: false });
  return out;
}

/** How the small talk sounds: with the boss in it when sass is on, the plain office kind when it isn't. */
export function banterStyle(boss, sass) {
  const common = 'Make it actually funny: quick jabs, callbacks, deadpan, one-upmanship, a bit of mock outrage. Each line is a reply to the one before it. Use a fact or two from the list as the hook, by its real name. Never put words in the boss\'s mouth: quote the boss only word for word from the boss\'s real message in the list, inside quote marks; otherwise say it plainly without quote marks ("the boss asked for a status again"); never make up what anyone said, a time of day or a number.';
  const safe = 'Hard limits: no slurs, no hate, no threats or violence, nothing sexual, nothing about anyone\'s race, religion, gender, sexuality, body, age, health or nationality, nothing about money or costs, and no keys, passwords, addresses or anything from outside this floor.';
  if (!sass) return `${common} Keep it warm about everyone, ${boss} included. No swearing. ${safe}`;
  return `${common} The boss is ${boss}. They gripe and gossip about ${boss} the way office people do: ${boss} changing their mind, sending messages at odd hours, wanting it yesterday, scrapping a plan. Roast ${boss} playfully, never cruelly, and have someone stick up for them sometimes ("nah, ${boss}'s alright actually"). Call them ${boss} or "the boss", never he or she. Mild swearing is fine ("damn", "hell", "pain in the ass", "asshole" at most), sparingly. ${safe}`;
}

// A last net under the model, for what no prompt should let through. A line that trips it is dropped, not cleaned.
const OFF_LIMITS = /\b(?:nigg\w*|f[a@4]gg?[o0]ts?|retard(?:ed|s)?|trann(?:y|ies)|kikes?|spics?|chinks?|wetbacks?|cunts?|rap(?:e|ed|es|ist)|porn\w*|sex(?:y|ual)?|nudes?|naked|suicid\w*|api[ _-]?keys?|passwords?|kill (?:him|her|them|you|yourself))\b/i;
export const fitToSay = (text) => !OFF_LIMITS.test(String(text ?? ''));

// A second net for made-up quotes. Any quoted words in a line that names the boss, or says somebody said them, must be the boss's real words from the facts the
// writer was given (or a real piece of work's title, or a fact's own words when the boss isn't named). Otherwise the line is dropped.
const QUOTED = /"([^"]{2,})"|\u201c([^\u201c\u201d]{2,})\u201d|\u2018([^\u2018\u2019]{2,})\u2019|(?:^|[\s(\[:,\u2014-])'([^']{2,}?)'(?=[\s.,!?;:)\]\u2014-]|$)/g;
const SPEECH = /\b(?:said|says|saying|wrote|writes|asked|asks|told|tells|goes|went|messaged|texted|typed|quote|quoting|like)\b/i;
// Words only, so a quote matches whole words in the same order whatever its quote marks, case or end punctuation.
const words = (s) => ` ${(String(s ?? '').toLowerCase().replace(/[\u2018\u2019]/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}]+)*/gu) || []).join(' ')} `;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Quoted words in a line: [string]. */
export const quotesIn = (text) => [...String(text ?? '').matchAll(QUOTED)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]).filter((q) => words(q).trim().length > 0);
/**
 * Whether a line keeps to what was really said. `bossSaid` are the boss's real messages as the writer saw them; `known` is anything else it may quote
 * (work titles, facts). A line naming the boss may quote only the boss's words or a work title; a line with "said"/"asked" and no boss may quote any fact.
 */
export function quotesHonest(text, { boss = 'the boss', bossSaid = [], titles = [], known = [] } = {}) {
  const quotes = quotesIn(text);
  if (!quotes.length) return true;
  const first = String(boss).split(/\s+/)[0];
  const names = [boss, /^(?:the|mr|mrs|ms|dr)\.?$/i.test(first) ? '' : first, 'boss'].filter((n) => n && n.length >= 3);
  const aboutBoss = names.some((n) => new RegExp(`\\b${escape(n)}\\b`, 'i').test(text));
  if (!aboutBoss && !SPEECH.test(text)) return true;
  const allowed = [...bossSaid, ...titles, ...(aboutBoss ? [] : known)].map(words);
  return quotes.every((q) => { const w = words(q); return allowed.some((a) => a.includes(w)); });
}

// A third net, for the kettle saying the same thing over. Lines are compared as words only.
const wordList = (s) => words(s).trim().split(' ').filter(Boolean);
const opener = (s, n = 3) => wordList(s).slice(0, n).join(' ');
/** How much two lines share: the words they have in common over the shorter line's words, 0 to 1. Lines under 4 words share nothing. */
export function overlap(a, b) {
  const x = new Set(wordList(a)), y = new Set(wordList(b));
  if (Math.min(x.size, y.size) < 4) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size);
}
/** Whether a line is a near repeat of any earlier one: the same first three words, or more than `most` of its words shared. */
export const nearRepeat = (text, earlier, most = 0.7) => earlier.some((e) => (opener(text) && opener(text) === opener(e)) || overlap(text, e) > most);
/**
 * Keeps an exchange's lines that don't repeat the last few exchanges on the floor (`before`, oldest first, each a list of lines) or an earlier line of this one.
 * The first line may not lean on the last exchange's first line at all: no shared opener and at most half its words.
 */
export function freshLines(lines, before = []) {
  const earlier = before.flat(), opening = before.at(-1)?.[0];
  const out = [];
  for (const l of lines) {
    if (nearRepeat(l.text, [...earlier, ...out.map((o) => o.text)])) continue;
    if (!out.length && opening && nearRepeat(l.text, [opening], 0.5)) continue;
    out.push(l);
  }
  return out;
}
/** Whether a speaker talks about themself by name ("Nico's own note", said by Nico). People say I, me and my. */
export const selfNamed = (text, name) => {
  const first = String(name ?? '').split(/\s+/)[0];
  return first.length >= 2 && new RegExp(`(?<![\\p{L}\\p{N}])${escape(first)}(?![\\p{L}\\p{N}])`, 'u').test(String(text ?? ''));
};
