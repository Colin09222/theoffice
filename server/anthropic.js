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
 */
export function buildRequest({ model, effort, maxTokens, system, messages, tools = [], toolChoice, thinking = 'adaptive', fallbacks = true, cache = true, stream = true }) {
  const shape = modelShape(model);
  const body = { model, max_tokens: maxTokens };
  if (stream) body.stream = true;
  if (thinking === 'off' && shape.thinkingOff === 'between_tools' && (!effort || AT_MOST_HIGH.has(effort))) body.thinking = { type: 'between_tools' };
  else if (thinking === 'off' && shape.thinkingOff === 'disabled' && (!effort || AT_MOST_HIGH.has(effort))) body.thinking = { type: 'disabled' };
  else body.thinking = { type: 'adaptive' };
  if (cache) body.cache_control = { type: 'ephemeral' };
  if (effort) body.output_config = { effort };
  if (fallbacks && shape.fallbacks) { body.betas = [FALLBACK_BETA]; body.fallbacks = shape.fallbacks; }
  if (system) body.system = system;
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

export function costOf(usage, pricing) {
  const input = usage.input_tokens || 0, write = usage.cache_creation_input_tokens || 0, read = usage.cache_read_input_tokens || 0, output = usage.output_tokens || 0;
  const p = pricing?.prompt || 0;
  return { prompt: input + write + read, completion: output, cost: (input * p + write * p * 1.25 + read * (pricing?.cacheRead ?? p * 0.1) + output * (pricing?.completion || 0)) / 1e6 };
}

/** Tool calls from a finished message. A call cut off by max_tokens may have parsed "successfully" from partial JSON, so it is sent back as invalid. */
export function toolCallsOf(msg) {
  return msg.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: msg.stop_reason === 'max_tokens' ? '{' : JSON.stringify(b.input ?? {}) }));
}

export function createAnthropicClient(cfg) {
  const client = new Anthropic({ apiKey: cfg.anthropicKey, maxRetries: 0, ...(cfg.anthropicBase ? { baseURL: cfg.anthropicBase } : {}) });
  return {
    async chat({ model, effort, messages, tools, maxTokens, onToken, onToolCall, signal, pricing, thinking, fallbacks }) {
      if (!cfg.anthropicKey) throw new ProviderError('No Claude API key is configured on the server.', { status: 401 });
      const ctl = new AbortController();
      const onAbort = () => ctl.abort(signal.reason);
      if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
      let idle; let timedOut = false;
      const bump = () => { clearTimeout(idle); idle = setTimeout(() => { timedOut = true; ctl.abort(); }, 240_000); };
      bump();
      let streamed = 0;
      const converted = toAnthropic(messages, tools);
      try {
        const stream = client.beta.messages.stream(buildRequest({ model, effort, maxTokens, system: converted.system, messages: converted.messages, tools: converted.tools, ...(thinking ? { thinking } : {}), ...(fallbacks === false ? { fallbacks } : {}) }), { signal: ctl.signal });
        for await (const ev of stream) {
          bump();
          if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') onToolCall?.(ev.content_block.name);
          if (ev.type === 'content_block_delta') {
            if (ev.delta.type === 'text_delta') { streamed += ev.delta.text.length; onToken?.(ev.delta.text); }
            else if (ev.delta.type === 'input_json_delta' || ev.delta.type === 'thinking_delta') streamed += (ev.delta.partial_json || ev.delta.thinking || '').length;
          }
        }
        const msg = await stream.finalMessage();
        const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
        const usage = costOf(msg.usage, pricing);
        if (msg.stop_reason === 'refusal') {
          const content = "I can't help with that one. Try asking for something else.";
          onToken?.(content);
          return { content, toolCalls: [], finish: 'refusal', usage: { ...usage, real: true } };
        }
        return { content: text, toolCalls: toolCallsOf(msg), finish: msg.stop_reason, rawContent: msg.content, usage: { ...usage, real: true } };
      } catch (e) {
        if (signal?.aborted) throw e;
        let err;
        if (timedOut) err = new ProviderError('The model went quiet for too long.', { retryable: true });
        else if (e instanceof Anthropic.APIConnectionError) err = new ProviderError('Could not reach the model provider.', { retryable: true });
        else if (e instanceof Anthropic.APIError) {
          const after = Number(e.headers?.get?.('retry-after'));
          err = new ProviderError(`Model provider said ${e.status}: ${scrub(e.error?.error?.message || e.message, cfg)}`, { status: e.status, retryable: e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500, retryAfterMs: Number.isFinite(after) ? after * 1000 : 0 });
        } else err = new ProviderError('The model stream broke.', { retryable: true });
        err.streamedChars = streamed;
        throw err;
      } finally { clearTimeout(idle); signal?.removeEventListener?.('abort', onAbort); }
    },
  };
}

/** Sends each call to the provider its role names. The Claude-only replay field never reaches OpenRouter. */
export function createRouter({ anthropic, openrouter }) {
  return {
    chat(args) {
      if (args.provider === 'anthropic') return anthropic.chat(args);
      return openrouter.chat({ ...args, messages: args.messages.map(({ anthropic_content, office_blocks, files, ...m }) => m) });
    },
  };
}
