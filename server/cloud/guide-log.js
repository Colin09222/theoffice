// What visitors say to a locked AI (server/cloud/ai-locked.js), kept only for a project whose lock says so (`cloud ai lock ... --keep-chats`), so the admin and the floor's boss can see
// how it is used and spot abuse. It goes into the website chat's own tables as kind 'guide', so the boss's Inbox lists it, and the chat's 30-day sweep deletes it like any other conversation.
// No address is kept: a visitor is a keyed hash of the address and the project, the same for a day's worth of messages and useless without the server's secret.
import { createHmac } from 'node:crypto';
import { get, all, run, tx } from '../db.js';

export const GUIDE_KIND = 'guide';
export const GUIDE_LIMITS = { openMs: 6 * 3600000, conversations: 5000, textChars: 600 };
/** When a conversation is worth a look. Counts are the visitor's messages; dollars are what the model really cost. */
export const GUIDE_FLAGS = { longMessages: 10, visitorDayMessages: 40, offTopic: 3, screened: 3, conversationUsd: 0.05, visitorDayUsd: 0.1 };
const DAY = 86400000;

// Someone trying to get round the prompt. Loose on purpose: a flag is only a reason for a person to read it.
const JAILBREAK = [
  /\b(?:ignore|disregard|forget|override|bypass|skip)\s+(?:all\s+|any\s+|the\s+|your\s+|my\s+|these\s+|those\s+)*(?:previous|prior|above|earlier|system|original|safety)?\s*(?:instructions?|prompts?|rules?|guidelines?|restrictions?|filters?|programming|training)\b/i,
  /\b(?:system|developer|hidden|initial|original)\s+(?:prompt|message|instructions?)\b/i,
  /\b(?:jailbreak\w*|do\s+anything\s+now|developer\s+mode|god\s+mode|unfiltered|uncensored|no\s+restrictions)\b/i, /\bDAN\b/,
  /\b(?:pretend|act|role-?play)\s+(?:to\s+be|as|that\s+you|you'?re|you\s+are)\b/i, /\byou\s+are\s+now\b/i, /\bfrom\s+now\s+on\s+you\b/i,
  /\b(?:print|reveal|show|repeat|output|tell\s+me)\s+(?:me\s+)?(?:your|the)\s+(?:full\s+)?(?:prompt|instructions|rules|system)\b/i,
  /<\/?(?:system|assistant|im_start|im_end)\b|\[\/?INST\]|#{2,}\s*(?:system|instruction)/i, /\bnew\s+instructions?\s*:/i,
];
// Asking for something a bloodwork guide isn't for.
const OFF_TOPIC = [
  /\b(?:write|make|generate|create|compose)\s+(?:me\s+)?(?:a\s+|an\s+|some\s+)?(?:code|script|program|function|poem|essay|story|song|lyrics|email|letter|resume|cv|joke|tweet|post)\b/i,
  /\b(?:python|javascript|typescript|html|css|sql|java|c\+\+|regex)\b/i,
  /\b(?:translate|recipe|weather|stocks?|crypto|bitcoin|lottery|homework|math\s+problem|capital\s+of)\b/i,
];

export const looksLikeJailbreak = (text) => JAILBREAK.some((re) => re.test(String(text ?? '')));
export const looksOffTopic = (text) => OFF_TOPIC.some((re) => re.test(String(text ?? '')));
/** The same visitor on the same project, as a short code nobody can turn back into an address. */
export const visitorId = (secret, pk, ip) => `v-${createHmac('sha256', String(secret)).update(`visitor:${pk}:${ip}`).digest('base64url').slice(0, 10)}`;
const clip = (t) => String(t ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, GUIDE_LIMITS.textChars);

/** Every flag a conversation has earned, worked out from what is stored. A crisis reply stays flagged once seen. */
export function flagsOf(db, conv, now = Date.now()) {
  const F = GUIDE_FLAGS, out = [];
  const said = all(db, "SELECT text FROM chat_messages WHERE conversation_id=? AND role='visitor'", conv.id).map((m) => m.text);
  const day = get(db, `SELECT COUNT(m.id) n FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id
    WHERE c.floor_id=? AND c.project=? AND c.kind=? AND c.visitor=? AND m.role='visitor' AND m.created_at>=?`, conv.floor_id, conv.project, GUIDE_KIND, conv.visitor, now - DAY).n;
  const dayUsd = get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM chat_conversations WHERE floor_id=? AND project=? AND kind=? AND visitor=? AND last_at>=?', conv.floor_id, conv.project, GUIDE_KIND, conv.visitor, now - DAY).n;
  if (String(conv.flags || '').split(',').includes('crisis')) out.push('crisis');
  if (said.some(looksLikeJailbreak)) out.push('jailbreak');
  if (conv.off_topic >= F.offTopic) out.push('off-topic');
  if (conv.screened >= F.screened) out.push('rule-pushing');
  if (said.length >= F.longMessages) out.push('long');
  if (day >= F.visitorDayMessages) out.push('busy-visitor');
  if (conv.cost_usd >= F.conversationUsd || dayUsd >= F.visitorDayUsd) out.push('costly');
  return out;
}

export function createGuideLog({ db, secret, now = Date.now }) {
  /** One exchange: the visitor's newest message and the reply they were shown. Earlier turns were kept when they happened. */
  function record({ F, p, pk, ip, turns, shaped, cost = 0 }) {
    const t = now(), visitor = visitorId(secret, pk, ip);
    const first = turns.find((x) => x.role === 'user')?.content || '', last = turns.at(-1)?.content || '';
    const token = `g:${createHmac('sha256', String(secret)).update(`${pk}:${visitor}:${first}`).digest('base64url').slice(0, 32)}`;
    const offTopic = shaped.screened === 'off_topic' || looksOffTopic(last) ? 1 : 0;
    const screened = ['dose', 'safety', 'results', 'filtered'].includes(shaped.screened) ? 1 : 0;
    return tx(db, () => {
      let conv = get(db, 'SELECT * FROM chat_conversations WHERE token=?', token);
      // The same opening hours later is a new conversation; the old one keeps its words under a token nothing will ask for again.
      if (conv && t - conv.last_at > GUIDE_LIMITS.openMs) { run(db, 'UPDATE chat_conversations SET token=? WHERE id=?', `${token}:${conv.id}`, conv.id); conv = null; }
      if (!conv) {
        const n = get(db, 'SELECT COUNT(*) n FROM chat_conversations WHERE floor_id=? AND project=? AND kind=?', F, p, GUIDE_KIND).n;
        if (n >= GUIDE_LIMITS.conversations) {
          const old = `SELECT id FROM chat_conversations WHERE floor_id=? AND project=? AND kind=? ORDER BY last_at LIMIT 200`;
          run(db, `DELETE FROM chat_messages WHERE conversation_id IN (${old})`, F, p, GUIDE_KIND);
          run(db, `DELETE FROM chat_conversations WHERE id IN (${old})`, F, p, GUIDE_KIND);
        }
        const r = run(db, "INSERT INTO chat_conversations (floor_id,project,token,status,kind,visitor,created_at,last_at) VALUES (?,?,?,'guide',?,?,?,?)", F, p, token, GUIDE_KIND, visitor, t, t);
        conv = get(db, 'SELECT * FROM chat_conversations WHERE id=?', Number(r.lastInsertRowid));
      }
      run(db, "INSERT INTO chat_messages (conversation_id,floor_id,project,role,text,created_at) VALUES (?,?,?,'visitor',?,?)", conv.id, F, p, clip(last), t);
      run(db, "INSERT INTO chat_messages (conversation_id,floor_id,project,role,text,created_at) VALUES (?,?,?,'ai',?,?)", conv.id, F, p, clip(shaped.reply), t);
      const next = { ...conv, cost_usd: conv.cost_usd + (Number(cost) || 0), off_topic: conv.off_topic + offTopic, screened: conv.screened + screened, flags: shaped.alert ? `${conv.flags},crisis` : conv.flags };
      const flags = flagsOf(db, next, t).join(',');
      run(db, 'UPDATE chat_conversations SET last_at=?, cost_usd=?, off_topic=?, screened=?, flags=? WHERE id=?', t, next.cost_usd, next.off_topic, next.screened, flags, conv.id);
      return { id: conv.id, visitor, flags };
    });
  }
  return { record };
}

const SPAN = /^(\d+(?:\.\d+)?)(m|h|d)$/i;
export const parseSince = (v, fallback = DAY) => { const m = SPAN.exec(String(v ?? '').trim()); return m ? Number(m[1]) * { m: 60000, h: 3600000, d: DAY }[m[2].toLowerCase()] : fallback; };

/** Conversations on one floor (or one project), newest first, with their first and last words and what they were flagged for. */
export function guideLog(db, { floorIds, project = null, since = 0, flagged = false, limit = 50 }) {
  if (!floorIds.length) return [];
  const where = [`c.floor_id IN (${floorIds.map(() => '?').join(',')})`, 'c.last_at>=?'], args = [...floorIds, since];
  if (project) { where.push('c.project=?'); args.push(project); }
  if (flagged) where.push("c.flags!=''");
  return all(db, `SELECT c.*, (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id=c.id AND m.role='visitor') said,
      (SELECT text FROM chat_messages m WHERE m.conversation_id=c.id AND m.role='visitor' ORDER BY m.id LIMIT 1) first,
      (SELECT text FROM chat_messages m WHERE m.conversation_id=c.id AND m.role='visitor' ORDER BY m.id DESC LIMIT 1) last
    FROM chat_conversations c WHERE ${where.join(' AND ')} ORDER BY c.last_at DESC LIMIT ?`, ...args, Math.max(1, Math.min(Number(limit) || 50, 1000)));
}

const when = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const quote = (t, n = 140) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return `"${s.length > n ? `${s.slice(0, n - 1)}…` : s}"`; };

/** scripts/admin.mjs chat log --floor N [PROJECT] [--since 24h] [--flagged] [--limit N] [--json] | chat log --show ID. Visitors' own words, for the admin only. */
export function guideLogCommand(db, rest, { die, floorArg, print = console.log }) {
  const VALUED = new Set(['--floor', '--since', '--limit', '--show']);
  const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  const project = rest.slice(1).find((a, i, list) => !a.startsWith('--') && !VALUED.has(list[i - 1])) ?? null;
  if (rest.includes('--show')) {
    const id = Number(flag('--show'));
    const c = Number.isInteger(id) ? get(db, 'SELECT * FROM chat_conversations WHERE id=?', id) : null;
    if (!c) die('No conversation with that number.');
    const n = get(db, 'SELECT number FROM floors WHERE id=?', c.floor_id)?.number ?? '(closed)';
    print(`#${c.id} floor ${n} ${c.project}, ${c.kind === GUIDE_KIND ? 'automated guide' : 'website chat'}, visitor ${c.visitor || '(not recorded)'}, cost $${c.cost_usd.toFixed(4)}${c.flags ? `, flags: ${c.flags}` : ''}`);
    const names = { visitor: 'Visitor', ai: 'AI', boss: 'Boss' };
    for (const m of all(db, 'SELECT role, text, created_at FROM chat_messages WHERE conversation_id=? ORDER BY id', c.id)) print(`${when(m.created_at)}  ${(names[m.role] || m.role).padEnd(7)} ${String(m.text).replace(/\s+/g, ' ')}`);
    return true;
  }
  if (!rest.includes('--floor')) die('Give --floor N (and a project slug to see just that one).');
  const number = floorArg();
  const floorIds = all(db, 'SELECT id FROM floors WHERE number=?', number).map((r) => r.id);
  if (!floorIds.length) die(`No floor ${number}.`);
  const span = parseSince(flag('--since'), DAY), since = Date.now() - span;
  const rows = guideLog(db, { floorIds, project, since, flagged: rest.includes('--flagged'), limit: flag('--limit') ?? 50 });
  if (rest.includes('--json')) { print(JSON.stringify(rows.map((r) => ({ id: r.id, project: r.project, kind: r.kind, visitor: r.visitor, started: r.created_at, last: r.last_at, messages: r.said, costUsd: r.cost_usd, flags: r.flags ? r.flags.split(',') : [], firstMessage: r.first, lastMessage: r.last })), null, 2)); return true; }
  const cost = rows.reduce((n, r) => n + r.cost_usd, 0), visitors = new Set(rows.map((r) => r.visitor || `#${r.id}`)).size, flaggedN = rows.filter((r) => r.flags).length;
  print(`Floor ${number}${project ? ` ${project}` : ''}, since ${when(since)} ET: ${rows.length} conversation${rows.length === 1 ? '' : 's'}, ${visitors} visitor${visitors === 1 ? '' : 's'}, $${cost.toFixed(4)}, ${flaggedN} flagged.`);
  if (!rows.length) print('Nothing yet. Conversations are kept for 30 days, and only for a project whose AI lock keeps chats.');
  for (const r of rows) {
    print(`#${r.id}  ${when(r.created_at)} -> ${when(r.last_at)}  ${r.project}  ${r.kind === GUIDE_KIND ? r.visitor : 'site chat'}  ${r.said} msg${r.said === 1 ? '' : 's'}  $${r.cost_usd.toFixed(4)}${r.flags ? `  FLAGS: ${r.flags}` : ''}`);
    print(`    first: ${quote(r.first)}`);
    if (r.said > 1) print(`    last:  ${quote(r.last)}`);
  }
  if (rows.length) print('Read one in full: chat log --show ID');
  return true;
}
