// The Managed Agents client: one small surface over the official SDK, so the computer runner and its mock speak the same language.
// The API key stays in this process. Containers get only what is uploaded to them, and nothing uploaded holds a secret.
import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { ProviderError, scrub } from './llm.js';

const BETA = 'managed-agents-2026-04-01';

export function createManagedClient(cfg) {
  const sdk = new Anthropic({ apiKey: cfg.anthropicKey || 'unset', maxRetries: 2, ...(cfg.anthropicBase ? { baseURL: cfg.anthropicBase } : {}) });
  const need = () => { if (!cfg.anthropicKey) throw new ProviderError('No Claude API key is configured on the server.', { status: 401 }); };
  const wrap = (fn) => async (...args) => {
    need();
    try { return await fn(...args); } catch (e) {
      if (e?.name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) throw e;
      if (e instanceof Anthropic.APIConnectionError) throw new ProviderError('Could not reach the model provider.', { retryable: true });
      if (e instanceof Anthropic.APIError) {
        const err = new ProviderError(`Model provider said ${e.status}: ${scrub(e.error?.error?.message || e.message, cfg)}`, { status: e.status, retryable: e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500 });
        throw err;
      }
      throw e;
    }
  };
  return {
    createEnvironment: wrap((def) => sdk.beta.environments.create(def)),
    createAgent: wrap((def) => sdk.beta.agents.create(def)),
    updateAgent: wrap((id, def) => sdk.beta.agents.update(id, def)),
    upload: wrap(async (buffer, name) => (await sdk.files.upload({ file: await toFile(buffer, name, { type: name.endsWith('.tgz') ? 'application/gzip' : 'application/octet-stream' }) })).id),
    deleteFile: wrap((id) => sdk.files.delete(id)),
    addFile: wrap((id, fileId, mountPath) => sdk.beta.sessions.resources.add(id, { type: 'file', file_id: fileId, mount_path: mountPath })),
    createSession: wrap((params) => sdk.beta.sessions.create(params)),
    retrieve: wrap((id) => sdk.beta.sessions.retrieve(id)),
    updateSession: wrap((id, params) => sdk.beta.sessions.update(id, params)),
    send: wrap((id, events) => sdk.beta.sessions.events.send(id, { events })),
    // A long timeout: a quiet stream is normal while a build runs. The runner has its own stall detector.
    stream: wrap((id, signal) => sdk.beta.sessions.events.stream(id, {}, { signal, timeout: 3 * 3600 * 1000 })),
    // From a moment on, when given one: a long session's whole history is a lot to page through on every reconnect. This only saves that paging, because the runner
    // checks the dates itself, so a platform that won't take the filter can still be read from the start.
    listEvents: async function* (id, fromMs) {
      need();
      let got = 0;
      try {
        for await (const ev of sdk.beta.sessions.events.list(id, fromMs ? { 'created_at[gte]': new Date(fromMs).toISOString() } : {})) { got++; yield ev; }
      } catch (e) {
        if (!fromMs || got || !(e instanceof Anthropic.APIError) || e.status < 400 || e.status >= 500 || e.status === 429) throw e;
        for await (const ev of sdk.beta.sessions.events.list(id)) yield ev;
      }
    },
    listOutputs: wrap(async (id) => {
      const out = [];
      for await (const f of sdk.beta.files.list({ scope_id: id, betas: [BETA] })) out.push({ id: f.id, filename: f.filename, size: f.size_bytes, createdAt: f.created_at });
      return out;
    }),
    download: wrap(async (id) => Buffer.from(await (await sdk.files.download(id)).arrayBuffer())),
  };
}
