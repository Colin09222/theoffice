// office.ai: Claude for a published project, called from the server, so no key or model name ever reaches a page. See docs/OFFICE-CLOUD.md.
// A model here has no tools and sees nothing of the building: only what the page sent it. Each call is held against the building's budget
// while it runs and goes on the ledger against its floor afterwards, the same as anything the staff spend.
import { get, tx } from '../db.js';
import { CloudError } from './store.js';

const PROVIDER = 'anthropic';
const OFF = () => new CloudError(403, 'ai_off', 'AI isn\'t switched on for this site right now.');
const RESTING = () => new CloudError(503, 'ai_resting', 'The AI here is resting for now. Please try again later.');
const NO_ALLOWANCE = () => new CloudError(429, 'ai_limit', 'This site has used today\'s AI allowance. It comes back tomorrow.');
const TOO_LONG = () => new CloudError(413, 'ai_too_long', 'That is too long for the AI. Try something shorter.');
const BAD = (msg) => new CloudError(400, 'bad_request', msg);
// A character can be a whole token in some scripts, so the estimate leans high. The real count from the model is what gets recorded.
const estimateTokens = (chars) => Math.ceil(chars / 3) + 32;

export function createAppAi({ db, models, engine, llm, log, powers, gate }) {
  const L = powers.AI;
  const reserved = new Map();   // tokens promised to calls still running, per project and tier
  let runningUsd = 0;
  const bump = (key, n) => { const v = (reserved.get(key) || 0) + n; if (v > 0) reserved.set(key, v); else reserved.delete(key); };

  /** What the page sent, checked: one prompt or a conversation that ends with the person speaking. */
  function clean(body) {
    const tier = body.model === undefined ? 'fast' : body.model;
    if (tier !== 'fast' && tier !== 'smart') throw new CloudError(400, 'bad_model', 'The model is \'fast\' or \'smart\'.');
    if (body.prompt !== undefined && body.messages !== undefined) throw BAD('Give a prompt or messages, not both.');
    let turns;
    if (typeof body.prompt === 'string') turns = [{ role: 'user', content: body.prompt }];
    else if (Array.isArray(body.messages)) turns = body.messages.map((m) => ({ role: m?.role, content: m?.content }));
    else throw BAD('Give a prompt or messages.');
    if (!turns.length || turns.length > L.messages) throw BAD(`A conversation is 1 to ${L.messages} messages.`);
    let chars = 0;
    for (const t of turns) {
      if (t.role !== 'user' && t.role !== 'assistant') throw BAD('Each message has the role user or assistant.');
      if (typeof t.content !== 'string' || !t.content.trim()) throw BAD('Each message needs some text.');
      chars += t.content.length;
    }
    if (turns[0].role !== 'user' || turns.at(-1).role !== 'user') throw BAD('A conversation starts and ends with the user.');
    if (chars > L.inputChars) throw TOO_LONG();
    const system = body.system === undefined ? '' : body.system;
    if (typeof system !== 'string') throw BAD('system is text.');
    if (system.length > L.systemChars) throw TOO_LONG();
    let maxTokens = L.defaultTokens;
    if (body.maxTokens !== undefined) {
      if (!Number.isInteger(body.maxTokens) || body.maxTokens < 1) throw BAD('maxTokens is a whole number above 0.');
      maxTokens = body.maxTokens;
    }
    return { tier, turns, system: system.trim(), maxTokens: Math.min(maxTokens, L.maxTokens), chars: chars + system.length };
  }

  async function chat({ F, p, pk, body }) {
    if (powers.blocked('ai', F, p)) throw OFF();
    const q = clean(body);
    const model = models?.appAi?.[q.tier];
    const price = model && models.prices?.[model];
    if (!price?.prompt || !price?.completion) { log('error', 'office.ai has no model or price', { tier: q.tier }); throw RESTING(); }
    return gate(async () => {
      if (powers.blocked('ai', F, p)) throw OFF();
      const key = `${pk}:${q.tier}`, column = `ai_${q.tier}`, perDay = q.tier === 'smart' ? L.daySmart : L.dayFast;
      const est = estimateTokens(q.chars);
      // What is left once this call's input and the calls already running are counted. The last of the allowance can still be used, on a shorter reply.
      const room = perDay - powers.counts(F, p)[column] - (reserved.get(key) || 0) - est;
      if (room < L.minOutput) throw NO_ALLOWANCE();
      const maxTokens = Math.min(q.maxTokens, room);
      const worst = (est * price.prompt * 1.25 + maxTokens * price.completion) / 1e6;
      if (engine.budget.out(PROVIDER) || engine.budget.room(PROVIDER) <= worst || engine.overBudget(F, worst)) throw RESTING();
      const todayUsd = get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE day=? AND kind='app_ai'", powers.today()).n;
      if (todayUsd + runningUsd + worst > L.buildingDayUsd) throw RESTING();
      const holdId = engine.budget.hold(PROVIDER, { floorId: F, agentId: null, usd: worst });
      const promised = est + maxTokens;
      bump(key, promised); runningUsd += worst;
      const charge = (prompt, completion, cost) => tx(db, () => {
        engine.charge(F, { id: null }, model, prompt, completion, cost, { kind: 'app_ai', provider: PROVIDER });
        powers.add(F, p, { [column]: prompt + completion, ai_calls: 1 });
      });
      try {
        let r;
        try {
          r = await llm.chat({
            provider: PROVIDER, model, effort: 'low', maxTokens, tools: [], thinking: 'off', fallbacks: false, pricing: price,
            messages: [...(q.system ? [{ role: 'system', content: q.system }] : []), ...q.turns],
            signal: AbortSignal.timeout(L.timeoutMs), meta: { kind: 'app_ai' },
          });
        } catch (e) {
          // Whatever the model wrote before it broke was still paid for, so it goes down too.
          if (e?.streamedChars > 0) {
            const written = Math.ceil(e.streamedChars / 4);
            charge(est, written, (est * price.prompt + written * price.completion) / 1e6);
          }
          log('warn', 'office.ai call failed', { status: e?.status || 0, floor: F });
          throw new CloudError(503, 'ai_unavailable', 'The AI isn\'t answering right now. Try again in a moment.');
        }
        const prompt = r.usage?.prompt || 0, completion = r.usage?.completion || 0;
        charge(prompt, completion, r.usage?.cost || 0);
        return { text: String(r.content ?? ''), truncated: r.finish === 'max_tokens', refused: r.finish === 'refusal', model: q.tier, tokens: prompt + completion, left: powers.aiLeft(powers.counts(F, p)) };
      } finally {
        engine.budget.release(holdId);
        bump(key, -promised); runningUsd -= worst;
      }
    });
  }
  return { chat };
}
