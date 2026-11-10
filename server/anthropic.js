// Claude API client: same chat() contract as the OpenRouter client, on the official SDK. One attempt per call: retry and backoff live in the engine.
import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, scrub } from './llm.js';

const parseInput = (s) => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

/** Engine messages (OpenAI shape) to Messages API params. Assistant turns replay the provider's own content verbatim, thinking included: history stays append-only. */
export function toAnthropic(messages, tools) {
  const system = []; const out = [];
  for (const m of messages) {
    if (m.role === 'system') { system.push(m.content); continue; }
    if (m.role === 'tool') {
      // A tool that showed a picture or a PDF hands back the file itself, after its words.
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.office_blocks ? [{ type: 'text', text: String(m.content ?? '') || '(no text)' }, ...m.office_blocks] : String(m.content ?? '') };
      const last = out.at(-1);
      // All results of one assistant turn go back in a single user message.
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.at(-1)?.type === 'tool_result') last.content.push(block);
      else out.push({ role: 'user', content: [block] });
      continue;
    }
    if (m.role === 'assistant') {
      if (m.anthropic_content) { out.push({ role: 'assistant', content: m.anthropic_content }); continue; }
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.tool_calls || []) content.push({ type: 'tool_use', id: c.id, name: c.function.name, input: parseInput(c.function.arguments) });
      if (content.length) out.push({ role: 'assistant', content });
      continue;
    }
    // The boss's pictures and PDFs follow the words that name them.
    out.push({ role: 'user', content: m.office_blocks ? [{ type: 'text', text: String(m.content ?? '') }, ...m.office_blocks] : m.content });
  }
  return {
    system: system.join('\n\n'),
    messages: out,
    tools: (tools || []).map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters, eager_input_streaming: true })),
  };
}

/**
 * What a Claude model accepts, where the models differ. Opus 5.5 and Sonnet 5.5 both refuse thinking {type: 'disabled'} and forced tool_choice
 * ('any' or 'tool') with a 400, and take the server-side fallback only as fallbacks: 'default' under the server-side-fallback-2026-07-01 beta
 * (the array form and its 2026-06-01 header are a 400 on Sonnet 5.5). Sonnet 5.5 has its own thinking-off setting, between_tools, at effort high
 * or below. Haiku has no server-side fallback.
 */
export function modelShape(model) {
  const m = String(model || '');
  if (/^claude-sonnet-5-5\b/.test(m)) return { fallbacks: 'default', thinkingOff: 'between_tools', forcedToolChoice: false };
  if (/^claude-opus-5-5\b/.test(m)) return { fallbacks: 'default', thinkingOff: null, forcedToolChoice: false };
  // Fable 5.x: thinking is always on (an explicit 'disabled' is a 400, so effort is the only control) and a forced tool_choice is a 400.
  if (/^claude-(fable|mythos)-5\b/.test(m)) return { fallbacks: 'default', thinkingOff: null, forcedToolChoice: false };
  if (/^claude-haiku/.test(m)) return { fallbacks: null, thinkingOff: 'disabled', forcedToolChoice: true };
  if (/^claude-(opus|sonnet|fable)/.test(m)) return { fallbacks: 'default', thinkingOff: 'disabled', forcedToolChoice: true };
  return { fallbacks: null, thinkingOff: 'disabled', forcedToolChoice: true };
}
const AT_MOST_HIGH = new Set(['low', 'medium', 'high']);
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * The Messages API body for one call, shaped for its model. thinking 'off' asks for the least thinking the model allows; on Opus 5.5 that is
 * adaptive thinking, since effort is its only control. A forced tool_choice becomes 'auto' where the model refuses it: say which tool in the prompt.
 * Only volatile things belong after the cached prefix, which runs tools, then system, then messages, and each model keeps a cache of its own.
 *
 * Prompt caching (checked against the prompt caching page of the Claude docs and the SDK's types, not from memory):
 * - cache true: two breakpoints. One sits on the system prompt, so tools and system are written once and read by every later call that shares them,
 *   whatever the messages are: a manager's next wake, the same person's next task step, a second question to the same colleague. The other is the
 *   top-level cache_control, which the API puts on the last block of the request and so moves forward by itself on every step of a tool loop: step N
 *   reads everything up to step N-1's last tool result at the cache price and writes only what is new. A read only ever lands where an earlier request
 *   wrote, which is why the system prompt needs a marker of its own: without it a call whose messages differ from the last one's reads nothing at all.
 * - cache 'system': the system breakpoint alone, for a one-off question after a prefix worth keeping. Marking the question too would pay the write
 *   price on words nobody sends again.
 * - cache false: no caching, for a call that shares nothing with any other.
 * A request may carry four breakpoints, and this uses two at most. A prefix under the model's minimum (512 tokens on the 5.5 models) is silently not cached.
 */
export function buildRequest({ model, effort, maxTokens, system, messages, tools = [], toolChoice, thinking = 'adaptive', fallbacks = true, cache = true, stream = true }) {
  const shape = modelShape(model);
  const body = { model, max_tokens: maxTokens };
  if (stream) body.stream = true;
  if (thinking === 'off' && shape.thinkingOff === 'between_tools' && (!effort || AT_MOST_HIGH.has(effort))) body.thinking = { type: 'between_tools' };
  else if (thinking === 'off' && shape.thinkingOff === 'disabled' && (!effort || AT_MOST_HIGH.has(effort))) body.thinking = { type: 'disabled' };
  else body.thinking = { type: 'adaptive' };
  if (cache && cache !== 'system') body.cache_control = { type: 'ephemeral' };
  if (effort) body.output_config = { effort };
  if (fallbacks && shape.fallbacks) { body.betas = [FALLBACK_BETA]; body.fallbacks = shape.fallbacks; }
  if (system) body.system = cache ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system;
  body.messages = messages;
  if (tools.length) {
    body.tools = tools;
    if (toolChoice) {
      const forced = toolChoice.type === 'any' || toolChoice.type === 'tool';
      body.tool_choice = forced && !shape.forcedToolChoice ? { type: 'auto', ...(toolChoice.disable_parallel_tool_use ? { disable_parallel_tool_use: true } : {}) } : toolChoice;
    }
  }
  return body;
}

/** What a call cost. A five-minute cache write is 1.25 times the input price and a one-hour write is twice it; nothing here asks for the longer one, but the price is right if something does. */
export function costOf(usage, pricing) {
  const input = usage.input_tokens || 0, write = usage.cache_creation_input_tokens || 0, read = usage.cache_read_input_tokens || 0, output = usage.output_tokens || 0;
  const long = Math.min(write, usage.cache_creation?.ephemeral_1h_input_tokens || 0);
  const p = pricing?.prompt || 0;
  return { prompt: input + write + read, completion: output, cost: (input * p + (write - long) * p * 1.25 + long * p * 2 + read * (pricing?.cacheRead ?? p * 0.1) + output * (pricing?.completion || 0)) / 1e6 };
}

/** Tool calls from a finished message. A call cut off by max_tokens may have parsed "successfully" from partial JSON, so it is sent back as invalid. */
export function toolCallsOf(msg) {
  return msg.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: msg.stop_reason === 'max_tokens' ? '{' : JSON.stringify(b.input ?? {}) }));
}

// Thinking isn't streamed unless a summary is asked for, and the SDK drops the server's pings, so a long think looks exactly like a dead connection. At high effort a model can think for many minutes, so this has to be longer than that and only catches a stream that has really died.
export const STREAM_QUIET_MS = 20 * 60_000;
/**
 * A cache entry lives five minutes from the start of the last request that wrote or read it, and the time a reply takes to write counts against that.
 * A long think at high effort can run past it, and then the next step of the loop pays the write price for the whole conversation again instead of
 * the read price. So while a reply is still coming, the same request goes out again every four minutes with max_tokens 0 and no stream: the API reads
 * the prefix, which restarts its five minutes, writes nothing and bills only the cache read (the docs' keep-alive). It is skipped unless the request
 * really did cache a prefix worth keeping, it is charged like any other call, and if the API refuses it, it is not tried again for that call.
 */
export const KEEP_WARM_MS = 4 * 60_000;
const KEEP_WARM_MIN_TOKENS = 4000;

export function createAnthropicClient(cfg) {
  const client = new Anthropic({ apiKey: cfg.anthropicKey, maxRetries: 0, ...(cfg.anthropicBase ? { baseURL: cfg.anthropicBase } : {}) });
  return {
    async chat({ model, effort, messages, tools, maxTokens, onToken, onToolCall, signal, pricing, thinking, fallbacks, cache }) {
      if (!cfg.anthropicKey) throw new ProviderError('No Claude API key is configured on the server.', { status: 401 });
      const ctl = new AbortController();
      const onAbort = () => ctl.abort(signal.reason);
      if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
      let idle; let timedOut = false;
      const bump = () => { clearTimeout(idle); idle = setTimeout(() => { timedOut = true; ctl.abort(); }, STREAM_QUIET_MS); };
      bump();
      let streamed = 0;
      const converted = toAnthropic(messages, tools);
      const body = buildRequest({ model, effort, maxTokens, system: converted.system, messages: converted.messages, tools: converted.tools, ...(thinking ? { thinking } : {}), ...(fallbacks === false ? { fallbacks } : {}), ...(cache === undefined ? {} : { cache }) });
      // What keeping the cache warm cost, on top of the call itself.
      const warm = { prompt: 0, cost: 0, cached: 0, busy: false, timer: null };
      const keepWarm = () => {
        if (warm.busy || warm.cached < KEEP_WARM_MIN_TOKENS || ctl.signal.aborted) return;
        warm.busy = true;
        client.beta.messages.create({ ...body, stream: false, max_tokens: 0 }, { signal: ctl.signal })
          .then((m) => { const u = costOf(m.usage || {}, pricing); warm.prompt += u.prompt; warm.cost += u.cost; })
          .catch(() => { clearInterval(warm.timer); })
          .finally(() => { warm.busy = false; });
      };
      if (body.cache_control && cfg.cacheKeepWarm !== false) { warm.timer = setInterval(keepWarm, cfg.cacheKeepWarmMs ?? KEEP_WARM_MS); warm.timer.unref?.(); }
      try {
        const stream = client.beta.messages.stream(body, { signal: ctl.signal });
        for await (const ev of stream) {
          bump();
          if (ev.type === 'message_start') warm.cached = (ev.message?.usage?.cache_read_input_tokens || 0) + (ev.message?.usage?.cache_creation_input_tokens || 0);
          if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') onToolCall?.(ev.content_block.name);
          if (ev.type === 'content_block_delta') {
            if (ev.delta.type === 'text_delta') { streamed += ev.delta.text.length; onToken?.(ev.delta.text); }
            else if (ev.delta.type === 'input_json_delta' || ev.delta.type === 'thinking_delta') streamed += (ev.delta.partial_json || ev.delta.thinking || '').length;
          }
        }
        const msg = await stream.finalMessage();
        const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
        const own = costOf(msg.usage, pricing);
        const usage = { ...own, prompt: own.prompt + warm.prompt, cost: own.cost + warm.cost };
        if (msg.stop_reason === 'refusal') {
          const content = "I can't help with that one. Try asking for something else.";
          onToken?.(content);
          return { content, toolCalls: [], finish: 'refusal', usage: { ...usage, real: true } };
        }
        return { content: text, toolCalls: toolCallsOf(msg), finish: msg.stop_reason, rawContent: msg.content, usage: { ...usage, real: true } };
      } catch (e) {
        if (signal?.aborted) { if (e && typeof e === 'object') e.warmCost = warm.cost; throw e; }
        let err;
        if (timedOut) err = new ProviderError('The model went quiet for too long.', { retryable: true });
        else if (e instanceof Anthropic.APIConnectionError) err = new ProviderError('Could not reach the model provider.', { retryable: true });
        else if (e instanceof Anthropic.APIError) {
          const after = Number(e.headers?.get?.('retry-after'));
          err = new ProviderError(`Model provider said ${e.status}: ${scrub(e.error?.error?.message || e.message, cfg)}`, { status: e.status, retryable: e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500, retryAfterMs: Number.isFinite(after) ? after * 1000 : 0 });
        } else err = new ProviderError('The model stream broke.', { retryable: true });
        err.streamedChars = streamed;
        err.warmCost = warm.cost;
        throw err;
      } finally { clearTimeout(idle); clearInterval(warm.timer); signal?.removeEventListener?.('abort', onAbort); }
    },
  };
}

/** Sends each call to the provider its role names. The Claude-only replay field never reaches OpenRouter. */
export function createRouter({ anthropic, openrouter }) {
  return {
    chat(args) {
      if (args.provider === 'anthropic') return anthropic.chat(args);
      return openrouter.chat({ ...args, messages: args.messages.map(({ anthropic_content, office_blocks, files, ...m }) => {
        // A picture someone sent goes along as an image part. Everything else stays words.
        const pics = m.role === 'user' ? (office_blocks || []).filter((b) => b.type === 'image' && b.source?.type === 'base64') : [];
        return pics.length ? { ...m, content: [{ type: 'text', text: String(m.content ?? '') }, ...pics.map((b) => ({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }))] } : m;
      }) });
    },
  };
}
