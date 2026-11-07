// OpenRouter client (OpenAI-compatible, streaming). One attempt per call: retry and backoff live in the engine, outside the concurrency slot.
export class ProviderError extends Error {
  constructor(message, { retryable = false, status = 0, retryAfterMs = 0 } = {}) {
    super(message); this.name = 'ProviderError'; this.retryable = retryable; this.status = status; this.retryAfterMs = retryAfterMs;
  }
}

export const scrub = (s, cfg) => {
  let out = String(s ?? '').replace(/sk-(or|ant)-[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  if (cfg?.openrouterKey) out = out.split(cfg.openrouterKey).join('[redacted]');
  if (cfg?.anthropicKey) out = out.split(cfg.anthropicKey).join('[redacted]');
  if (cfg?.webSearchKey) out = out.split(cfg.webSearchKey).join('[redacted]');
  return out.slice(0, 300);
};

export function createOpenRouterClient(cfg) {
  return {
    async chat({ model, messages, tools, maxTokens, onToken, onToolCall, signal, pricing }) {
      if (!cfg.openrouterKey) throw new ProviderError('No OpenRouter key is configured on the server.', { status: 401 });
      const ctl = new AbortController();
      const onAbort = () => ctl.abort(signal.reason);
      if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
      let idle; const bump = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(new ProviderError('The model went quiet for too long.', { retryable: true })), 90_000); };
      bump();
      let streamed = 0;
      try {
        let res;
        try {
          res = await fetch(`${cfg.openrouterBase}/chat/completions`, {
            method: 'POST', signal: ctl.signal,
            headers: { authorization: `Bearer ${cfg.openrouterKey}`, 'content-type': 'application/json', 'x-title': 'The Office' },
            body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens, usage: { include: true }, ...(tools?.length ? { tools, tool_choice: 'auto' } : {}) }),
          });
        } catch (e) {
          if (signal?.aborted) throw e;
          if (e instanceof ProviderError) throw e;
          throw new ProviderError('Could not reach the model provider.', { retryable: true });
        }
        if (!res.ok) {
          const body = scrub(await res.text().catch(() => ''), cfg);
          const after = Number(res.headers.get('retry-after'));
          let detail = ''; try { detail = JSON.parse(body).error?.message || ''; } catch { detail = ''; }
          throw new ProviderError(`Model provider said ${res.status}${detail ? `: ${scrub(detail, cfg)}` : ''}`, { status: res.status, retryable: res.status === 429 || res.status >= 500, retryAfterMs: Number.isFinite(after) ? after * 1000 : 0 });
        }
        let content = ''; let usage = null; let finish = ''; const calls = []; let buf = '';
        const dec = new TextDecoder();
        const handle = (json) => {
          if (json.error) throw new ProviderError(`Model provider error: ${scrub(json.error.message || 'unknown', cfg)}`, { status: json.error.code || 0, retryable: true });
          if (json.usage) usage = json.usage;
          const ch = json.choices?.[0]; if (!ch) return;
          if (ch.finish_reason) finish = ch.finish_reason;
          const d = ch.delta || {};
          if (d.content) { content += d.content; streamed += d.content.length; onToken?.(d.content); }
          for (const tc of d.tool_calls || []) {
            const c = (calls[tc.index ?? 0] ||= { id: '', name: '', args: '' });
            if (tc.id) c.id = tc.id;
            if (tc.function?.name) { c.name += tc.function.name; onToolCall?.(c.name); }
            if (tc.function?.arguments) { c.args += tc.function.arguments; streamed += tc.function.arguments.length; }
          }
        };
        try {
          for await (const chunk of res.body) {
            bump();
            buf += dec.decode(chunk, { stream: true });
            let nl;
            while ((nl = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (data === '[DONE]') continue;
              let json; try { json = JSON.parse(data); } catch { continue; }
              handle(json);
            }
          }
        } catch (e) {
          if (signal?.aborted || e instanceof ProviderError) { e.streamedChars = streamed; throw e; }
          const err = new ProviderError('The model stream broke.', { retryable: true }); err.streamedChars = streamed; throw err;
        }
        const toolCalls = calls.filter(Boolean).map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, args: c.args }));
        const prompt = usage?.prompt_tokens ?? Math.ceil(JSON.stringify(messages).length / 4);
        const completion = usage?.completion_tokens ?? Math.ceil(streamed / 4);
        const cost = typeof usage?.cost === 'number' ? usage.cost : (prompt * (pricing?.prompt || 0) + completion * (pricing?.completion || 0)) / 1e6;
        return { content, toolCalls, finish, usage: { prompt, completion, cost, real: typeof usage?.cost === 'number' } };
      } finally { clearTimeout(idle); signal?.removeEventListener?.('abort', onAbort); }
    },
  };
}
