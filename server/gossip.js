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
    out.push({ text: `${boss}'s latest message to the manager: "${short(said[0].text, 140)}"`, open: !!floor.public_chat });
    const lately = said.filter((m) => m.created_at >= now - 3 * HOUR).length;
    if (lately >= 3) out.push({ text: `${boss} has sent the manager ${lately} messages in the last three hours`, open: true });
  }
  const stopped = get(db, "SELECT created_at FROM messages WHERE floor_id=? AND role='budget' AND created_at>=? ORDER BY id DESC LIMIT 1", floor.id, now - 36 * HOUR);
  if (stopped) out.push({ text: `Work stopped early on ${DAY[new Date(stopped.created_at).getDay()]} because the day's allowance ran out, and everyone was sent home`, open: false });
  return out;
}

/** How the small talk sounds: with the boss in it when sass is on, the plain office kind when it isn't. */
export function banterStyle(boss, sass) {
  const common = 'Make it actually funny: quick jabs, callbacks, deadpan, one-upmanship, a bit of mock outrage. Each line is a reply to the one before it. Use a fact or two from the list as the hook, by its real name. Quote the boss only in words a fact gives; never make up what anyone said, a time of day or a number.';
  const safe = 'Hard limits: no slurs, no hate, no threats or violence, nothing sexual, nothing about anyone\'s race, religion, gender, sexuality, body, age, health or nationality, nothing about money or costs, and no keys, passwords, addresses or anything from outside this floor.';
  if (!sass) return `${common} Keep it warm about everyone, ${boss} included. No swearing. ${safe}`;
  return `${common} The boss is ${boss}. They gripe and gossip about ${boss} the way office people do: ${boss} changing their mind, sending messages at odd hours, wanting it yesterday, scrapping a plan. Roast ${boss} playfully, never cruelly, and have someone stick up for them sometimes ("nah, ${boss}'s alright actually"). Call them ${boss} or "the boss", never he or she. Mild swearing is fine ("damn", "hell", "pain in the ass", "asshole" at most), sparingly. ${safe}`;
}

// A last net under the model, for what no prompt should let through. A line that trips it is dropped, not cleaned.
const OFF_LIMITS = /\b(?:nigg\w*|f[a@4]gg?[o0]ts?|retard(?:ed|s)?|trann(?:y|ies)|kikes?|spics?|chinks?|wetbacks?|cunts?|rap(?:e|ed|es|ist)|porn\w*|sex(?:y|ual)?|nudes?|naked|suicid\w*|api[ _-]?keys?|passwords?|kill (?:him|her|them|you|yourself))\b/i;
export const fitToSay = (text) => !OFF_LIMITS.test(String(text ?? ''));
