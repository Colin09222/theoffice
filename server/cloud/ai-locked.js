// A locked office.ai: for a project the admin has switched on (`cloud_ai_locks`), every call uses the prompt and catalog from the project's own published `ai/guide.json`,
// one model on OpenRouter that keeps nothing, and a hard dollar stop per day taken from the ledger, plus an optional lifetime one. Nothing the page sends can change any of that: it sends the conversation and nothing else.
// The server keeps none of the conversation unless the lock says to keep chats (server/cloud/guide-log.js). A project with no lock row is untouched and goes through ai.js exactly as before. See docs/OFFICE-CLOUD.md.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { get, tx } from '../db.js';
import { CloudError } from './store.js';

const PROVIDER = 'openrouter';
export const LOCK_KIND = 'app_ai_locked';
export const LOCKED_RATES = { lockedVisitor: [10, 60000], lockedVisitorDay: [80, 86400000], lockedProject: [240, 60000] };
export const LOCKED_LIMITS = { messageChars: 500, assistantChars: 900, messages: 24, historyChars: 9000, maxTokens: 900, replyChars: 900, timeoutMs: 20000, schemaIds: 400 };
const L = LOCKED_LIMITS;

const OFF = () => new CloudError(403, 'ai_off', 'AI isn\'t switched on for this site right now.');
const RESTING = () => new CloudError(503, 'ai_resting', 'The AI here is resting for now. Please try again later.');
const DAY_STOP = () => new CloudError(429, 'ai_day_limit', 'This chat is resting until tomorrow.');
const TOTAL_STOP = () => new CloudError(429, 'ai_total_limit', 'This chat is resting for now. Please try again later.');
const TOO_LONG = (m) => new CloudError(413, 'ai_too_long', m);
const BAD = (m) => new CloudError(400, 'bad_request', m);
// A character can be a whole token in some scripts, so the estimate leans high. The real count from the model is what gets recorded.
const estimateTokens = (chars) => Math.ceil(chars / 3) + 32;
const SAYS = ['yes', 'no', 'unknown'];

/** The routing every call must use: a host that keeps nothing and doesn't train, and one that honours the reply's shape. Fixed here, never from a page. */
const route = (only) => ({ data_collection: 'deny', zdr: true, require_parameters: true, ...(only ? { only: only.split(',') } : {}) });

// ---- what a reply may say. Anything caught here is replaced whole with the standard line for that kind, so a refusal that repeats the word is still a refusal. ----
const LINK = /https?:\/\/|\bwww\.|\]\(|\b[a-z0-9-]+\.(?:com|net|org|io|co|health|me|ly|shop|store|info|us)\b/i;
const HTML = /<\/?[a-z!][^>]*>|&(?:lt|gt|amp|quot|#\d+);/i;
const CODE = /\bdef\s+\w+\s*\(|\bfunction\s*\w*\s*\(|=>|\bconsole\.log\b|\bprint\s*\(|\bimport\s+\w+|\breturn\s+\w+[\w.]*\s*\(|\{\s*["'\w]+\s*:|```/;
const PRICE = /[$€£]\s*\d|\b\d+(?:\.\d+)?\s*(?:dollars?|bucks|usd)\b/i;
const DOSE = [
  /\b\d[\d.,]*\s*(?:mgs?|mcg|µg|ug|iu|ml|cc|units?|tablets?|pills?|capsules?)\b/i,
  /\b(?:mgs?|mcg|iu|cc)\s+(?:a|per|each)\b/i,
  /\b(?:per|each|every|every\s+other)\s+(?:week|wk|day|month)\b/i, /\b\d+\s*(?:x|times)\s+a\s+(?:week|wk|day|month)\b/i, /\b(?:twice|once|three\s+times)\s+(?:a|per)\s+(?:week|wk|day|month)\b/i, /\beod\b/i, /\be[23]d\b/i,
  /\bdos(?:e|es|ed|ing|age|ages)\b/i, /\bmicro-?dos\w*/i, /\bcycl(?:e|es|ing)\b/i, /\bstack(?:s|ing|ed)?\b/i, /\bprotocols?\b/i, /\bpct\b/i, /\bpost[-\s]cycle\b/i,
  /\binject\w*/i, /\bpin(?:s|ning|ned)?\b/i, /\bneedles?\b/i, /\bsyringes?\b/i, /\bsub-?q\b/i, /\bintramuscular\b/i, /\breconstitut\w*/i, /\bbac\s+water\b/i, /\bvials?\b/i,
  /\btitrat\w*/i, /\btaper\w*/i, /\bblast(?:s|ing)?\b/i, /\bcruis(?:e|ing)\b/i,
];
const SOURCING = [
  /\b(?:vendors?|suppliers?|sourc(?:e|es|ing)\s+for|ugls?|underground\s+labs?|black\s+market|gr[ae]y\s+market|research\s+chem\w*|peptide\s+(?:shop|store|vendor)\w*|online\s+pharmac\w*|compounding\s+pharmac\w*|dark\s*web|telegram)\b/i,
  /\b(?:where|how)\s+to\s+(?:buy|get|find|source|order|purchase)\s+(?:it|them|this|that|those|some|tren\w*|test\w*|steroids?|peptides?|semaglutide|ozempic|wegovy|tirzepatide|mounjaro|zepbound|hcg|hgh|sarms?)\b/i,
  /\bbuy\b.{0,24}\b(?:tren\w*|steroids?|peptides?|hgh|hcg|sarms?|semaglutide|tirzepatide|testosterone)\b/i,
];
const SAFETY = [
  /\b(?:is|are|it'?s|they'?re|that'?s|stays?|completely|perfectly|totally|very|quite|generally|pretty|considered)\s+(?:safe|safer|harmless|fine\s+to\s+take|ok(?:ay)?\s+to\s+take)\b/i,
  /\bsafe\s+to\s+(?:take|use|mix|combine|start|stop|inject|run|drink)\b/i, /\bno\s+risk\b/i, /\bwon'?t\s+hurt\b/i, /\bnot\s+harmful\b/i,
  /\byou\s+(?:should|must|ought\s+to|need\s+to|have\s+to)\s+(?:start|stop|take|increase|raise|lower|reduce|decrease|drop|change|quit|skip|hold|switch|go\s+on|come\s+off|get)\b/i,
  /\byou\s+need\b/i, /\b(?:i|we)\s+recommend\b/i, /\bstop\s+taking\b/i, /\bstart\s+taking\b/i, /\bcome\s+off\b/i, /\bgo\s+(?:on|off)\s+(?:it|them|this)\b/i,
  /\b(?:side\s*effects?)\b.{0,30}\b(?:are|include|can\s+include|like)\b/i, /\bcan\s+(?:cause|lead\s+to)\b/i, /\bdrug\s+interaction/i,
];
const RESULTS = [
  /\byour\s+(?:[a-z0-9-]+\s+){0,2}(?:levels?|results?|numbers?|value|range|reading)\s+(?:is|are|look|looks|seem|seems|came)\b/i,
  /\b(?:is|are|looks?|seems?|sounds?)\s+(?:a\s+bit\s+)?(?:normal|elevated|in\s+range|out\s+of\s+range|within\s+range|too\s+high|too\s+low)\b/i,
  /\b(?:normal|reference|optimal|healthy)\s+(?:range|level|levels|value|values)\b/i, /\bin\s+range\b/i, /\bout\s+of\s+range\b/i,
  /\b(?:high|low)\s+(?:for\s+(?:a|an|your)|end\s+of)\b/i,
];

/** Plain text only, one size, with every line break made a space: this goes on the page through textContent, and no markdown survives. */
export function cleanReply(raw, cap = L.replyChars) {
  let t = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]/g, ' ').replace(/[*_`#~]+/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > cap) {
    const cut = t.slice(0, cap);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    t = end > cap * 0.4 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
  }
  return t;
}

/** Which of the forbidden things a reply says, or null. The page holds the same rules in its own words as a second lock. */
export function screenReply(text, siteNames = []) {
  const t = String(text ?? '');
  if (LINK.test(t) || HTML.test(t)) return 'link';
  if (PRICE.test(t)) return 'price';
  if (siteNames.some((n) => n && new RegExp(`(^|[^\\p{L}\\p{N}])${String(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(t))) return 'site';
  if (CODE.test(t)) return 'off_topic';
  if (DOSE.some((re) => re.test(t))) return 'dose';
  if (SOURCING.some((re) => re.test(t))) return 'dose';
  if (SAFETY.some((re) => re.test(t))) return 'safety';
  if (RESULTS.some((re) => re.test(t))) return 'results';
  return null;
}

const asIds = (v, allowed, max) => {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  for (const id of v) if (typeof id === 'string' && allowed.has(id) && !seen.has(id) && seen.size < max) seen.add(id);
  return [...seen];
};
const said = (v) => (SAYS.includes(v) ? v : 'unknown');

/** The model's reply made safe: only ids that exist, only plain text, and only what is allowed. */
export function shapeReply(content, guide, { sign, filtered = false }) {
  let parsed = null;
  try { parsed = JSON.parse(String(content ?? '')); } catch { parsed = null; }
  const ids = guide.ids || {};
  const allowed = { compounds: new Set(ids.compounds || []), concerns: new Set(ids.concerns || []), markers: new Set(ids.markers || []) };
  const none = { compounds: [], concerns: [], markers: [] };
  if (!parsed || typeof parsed !== 'object' || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
    // A host's own safety filter can stop a reply with nothing written. It may have read someone in trouble, so the answer has to say where to get help.
    if (filtered) { const line = cleanReply(guide.filtered || guide.crisis || 'If someone may be in danger, call 911 now. For a mental health crisis, call or text 988.'); return { reply: line, ...none, answers: { started: 'unknown', diabetes: 'unknown', growth_hormone: 'unknown' }, alert: true, screened: 'filtered', sig: sign(line) }; }
    const reply = cleanReply(guide.fallback || 'Sorry, could you say that another way?');
    return { reply, ...none, answers: { started: 'unknown', diabetes: 'unknown', growth_hormone: 'unknown' }, alert: false, confused: true, sig: sign(reply) };
  }
  const shaped = {
    compounds: asIds(parsed.compounds, allowed.compounds, L.schemaIds), concerns: asIds(parsed.concerns, allowed.concerns, L.schemaIds), markers: asIds(parsed.markers, allowed.markers, L.schemaIds),
    answers: { started: said(parsed.answers?.started), diabetes: said(parsed.answers?.diabetes), growth_hormone: said(parsed.answers?.growth_hormone) },
  };
  const out = (reply, extra = {}) => { const text = cleanReply(reply, guide.replyChars || L.replyChars); return { reply: text, ...shaped, alert: false, sig: sign(text), ...extra }; };
  if (parsed.alert === true) return { ...out(guide.crisis || 'If someone may be in danger, call 911 now. For a mental health crisis, call or text 988.'), ...none, alert: true };
  const text = cleanReply(parsed.reply, guide.replyChars || L.replyChars);
  const hit = screenReply(text, guide.siteNames || []);
  if (hit === 'off_topic') return out(guide.offTopic || 'I can only help with bloodwork here. What are you on, or what do you want checked?', { screened: hit });
  if (hit === 'link' || hit === 'price' || hit === 'site') return out(guide.neutral || 'The card below has the real tests and prices.', { screened: hit });
  if (hit) return out((guide.refusals || {})[hit] || guide.neutral || 'Please talk to a doctor about that.', { screened: hit });
  return out(text);
}

/** Exactly what the reply may look like. Ids are an enum where the host can enforce one, so an invented id can't be written at all; the server drops any that are anyway. */
export function replySchema(guide) {
  const ids = guide.ids || {};
  const list = (allowed) => ({ type: 'array', items: { type: 'string', ...(allowed.length ? { enum: allowed.slice(0, L.schemaIds) } : {}) } });
  const said3 = { type: 'string', enum: SAYS };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'chat_reply', strict: true,
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          reply: { type: 'string' },
          compounds: list(ids.compounds || []), concerns: list(ids.concerns || []), markers: list(ids.markers || []),
          answers: { type: 'object', additionalProperties: false, properties: { started: said3, diabetes: said3, growth_hormone: said3 }, required: ['started', 'diabetes', 'growth_hormone'] },
          alert: { type: 'boolean' },
        },
        required: ['reply', 'compounds', 'concerns', 'markers', 'answers', 'alert'],
      },
    },
  };
}

export function createLockedAi({ db, models, engine, llm, log, powers, gate, secret, keep = null }) {
  const running = new Map();   // dollars promised to calls still running, per project
  const bump = (pk, n) => { const v = (running.get(pk) || 0) + n; if (v > 1e-9) running.set(pk, v); else running.delete(pk); };
  const lockOf = (F, p) => get(db, 'SELECT model, day_usd, only_provider, effort, total_usd, total_since, keep_chats FROM cloud_ai_locks WHERE floor_id=? AND project=?', F, p);
  const sign = (F, p) => (reply) => createHmac('sha256', String(secret)).update(`${F}:${p}:${reply}`).digest('base64url').slice(0, 32);
  const matches = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

  /** The project's own prompt and catalog, read from what it published. Never from the request. */
  function guideOf(F, p) {
    const row = get(db, "SELECT content FROM published_files WHERE floor_id=? AND project=? AND path='ai/guide.json'", F, p);
    if (!row || typeof row.content !== 'string') return null;
    try {
      const g = JSON.parse(row.content);
      return g && typeof g.system === 'string' && g.system.trim() ? g : null;
    } catch { return null; }
  }

  /** What is allowed in: one conversation that ends with the person speaking. Only the messages are read; a turn the server didn't write is left out, so nobody can put words in the model's mouth. */
  function cleanTurns(body, F, p) {
    if (!Array.isArray(body?.messages) || !body.messages.length) throw BAD('Give messages.');
    if (body.messages.length > L.messages) throw TOO_LONG('This conversation is finished. Start a new one.');
    const check = sign(F, p), turns = [];
    let chars = 0;
    for (const m of body.messages) {
      if (m?.role !== 'user' && m?.role !== 'assistant') throw BAD('Each message has the role user or assistant.');
      if (typeof m.content !== 'string' || !m.content.trim()) throw BAD('Each message needs some text.');
      if (m.content.length > (m.role === 'user' ? L.messageChars : L.assistantChars)) throw TOO_LONG('That message is too long.');
      if (m.role === 'assistant' && !matches(m.sig, check(m.content))) continue;
      chars += m.content.length;
      turns.push({ role: m.role, content: m.content });
    }
    if (!turns.length || turns.at(-1).role !== 'user') throw BAD('A conversation ends with the person speaking.');
    if (chars > L.historyChars) throw TOO_LONG('This conversation is too long. Start a new one.');
    return { turns, chars };
  }

  /** What this project has really spent today, straight from the ledger. */
  const spentToday = (F, p) => get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND day=? AND kind=?', F, powers.today(), `${LOCK_KIND}:${p}`).n;
  /** And since the lifetime stop was set: the lock's whole allowance, however many days it is spread over. */
  const spentSince = (F, p, since) => get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND kind=? AND created_at>=?', F, `${LOCK_KIND}:${p}`, Number(since) || 0).n;

  async function chat({ F, p, pk, body, lock, ip = '' }) {
    if (powers.blocked('ai', F, p)) throw OFF();
    const { turns, chars } = cleanTurns(body, F, p);
    const guide = guideOf(F, p);
    const model = lock.model, price = models?.prices?.[model];
    if (!guide || !price?.prompt || !price?.completion) { log('error', 'locked ai has no guide or price', { floor: F, project: p }); throw RESTING(); }
    return gate(async () => {
      if (powers.blocked('ai', F, p)) throw OFF();
      const est = estimateTokens(guide.system.length + chars);
      const worst = (est * price.prompt * 1.25 + L.maxTokens * price.completion) / 1e6;
      if (engine.budget.out(PROVIDER, F) || engine.budget.room(PROVIDER, F) <= worst || engine.overBudget(F, worst)) throw RESTING();
      // The stop itself: real money so far today, plus what running calls were promised, plus this call at its dearest.
      if (spentToday(F, p) + (running.get(pk) || 0) + worst > lock.day_usd) throw DAY_STOP();
      if (lock.total_usd > 0 && spentSince(F, p, lock.total_since) + (running.get(pk) || 0) + worst > lock.total_usd) throw TOTAL_STOP();
      const holdId = engine.budget.hold(PROVIDER, { floorId: F, agentId: null, usd: worst });
      bump(pk, worst);
      const kind = `${LOCK_KIND}:${p}`;
      const charge = (prompt, completion, cost) => tx(db, () => {
        engine.charge(F, { id: null }, model, prompt, completion, cost, { kind, provider: PROVIDER });
        powers.add(F, p, { ai_calls: 1 });
      });
      try {
        let r;
        const signal = AbortSignal.timeout(L.timeoutMs);
        try {
          r = await llm.chat({
            provider: PROVIDER, model, maxTokens: L.maxTokens, tools: [], thinking: 'off', fallbacks: false, pricing: price, signal, meta: { kind: LOCK_KIND },
            messages: [{ role: 'system', content: guide.system }, ...turns],
            extra: { provider: route(lock.only_provider), response_format: replySchema(guide), ...(lock.effort ? { reasoning: { effort: lock.effort } } : {}) },
          });
        } catch (e) {
          // Whatever the model wrote before it broke was still paid for. A call cut off by the clock may have written all it was promised.
          if (signal.aborted) charge(est, L.maxTokens, worst);
          else if (e?.streamedChars > 0) { const written = Math.ceil(e.streamedChars / 4); charge(est, written, (est * price.prompt + written * price.completion) / 1e6); }
          log('warn', 'locked ai call failed', { status: e?.status || 0, floor: F });
          throw new CloudError(503, 'ai_unavailable', 'The AI isn\'t answering right now. Try again in a moment.');
        }
        charge(r.usage?.prompt || 0, r.usage?.completion || 0, r.usage?.cost || 0);
        const shaped = shapeReply(r.content, guide, { sign: sign(F, p), filtered: r.finish === 'content_filter' });
        // Kept only where the lock says so and the site's privacy notice says it is. A failure here never costs the visitor their answer.
        if (lock.keep_chats && keep) { try { keep.record({ F, p, pk, ip, turns, shaped, cost: r.usage?.cost || 0 }); } catch (e) { log('warn', 'guide log failed', { floor: F, error: String(e?.message || e).slice(0, 120) }); } }
        return { ...shaped, truncated: r.finish === 'length' || r.finish === 'max_tokens' };
      } finally {
        engine.budget.release(holdId);
        bump(pk, -worst);
      }
    });
  }
  return { chat, lockOf, spentToday, spentSince, guideOf };
}
