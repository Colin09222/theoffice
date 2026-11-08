// The Office's line to office-runner on this host: a unix socket and a token, both mounted read-only. No socket or no token and server slots are off, and nothing else notices.
import http from 'node:http';
import { statSync, readFileSync } from 'node:fs';

export const RUNNER_SOCKET = '/run/office-runner/api/runner.sock';
export const RUNNER_TOKEN_FILE = '/opt/office-runner/shared/api.token';
const MAX_ANSWER = 2 * 1048576;

export class RunnerError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

/** Checked on each use rather than at start, so the Office needs no restart when the runner is installed, restarted or taken away. Docker makes a missing bind source a directory: that counts as missing. */
export function runnerConfigured(cfg) {
  if (!cfg.runnerSocket || !cfg.runnerTokenFile) return false;
  try {
    if (!statSync(cfg.runnerSocket).isSocket()) return false;
    const t = statSync(cfg.runnerTokenFile);
    return t.isFile() && t.size > 0;
  } catch { return false; }
}

export const serversOn = (cfg) => !!cfg.appsBaseDomain && runnerConfigured(cfg);

export function createRunnerClient(cfg, { timeoutMs = 30000 } = {}) {
  const down = () => new RunnerError(503, 'runner_down', 'The server room isn\'t answering right now. Try again in a few minutes.');
  function call(method, path, body, { timeout = timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      let token;
      try { token = readFileSync(cfg.runnerTokenFile, 'utf8').trim(); } catch { return reject(down()); }
      if (!token) return reject(down());
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const q = http.request({ socketPath: cfg.runnerSocket, method, path, timeout, headers: { host: 'runner', authorization: `Bearer ${token}`, ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (r) => {
        const chunks = []; let size = 0;
        r.on('data', (c) => { size += c.length; if (size > MAX_ANSWER) { r.destroy(); reject(down()); } else chunks.push(c); });
        r.on('error', () => reject(down()));
        r.on('end', () => {
          let v = null;
          try { v = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { return reject(down()); }
          if (r.statusCode >= 400) return reject(new RunnerError(r.statusCode, String(v?.error || 'runner_error'), String(v?.message || 'The runner said no.').slice(0, 800)));
          resolve(v);
        });
      });
      q.on('timeout', () => { q.destroy(); reject(down()); });
      q.on('error', () => reject(down()));
      if (data) q.write(data);
      q.end();
    });
  }
  const app = (label) => `/v1/apps/${encodeURIComponent(label)}`;
  return {
    on: () => runnerConfigured(cfg),
    health: () => call('GET', '/v1/health'),
    list: () => call('GET', '/v1/apps'),
    get: (label) => call('GET', app(label)),
    deploy: (label, body) => call('POST', `${app(label)}/deploy`, body, { timeout: 120000 }),
    // A start waits for the app to listen, up to 45 seconds on the runner's side.
    start: (label) => call('POST', `${app(label)}/start`, {}, { timeout: 60000 }),
    stop: (label) => call('POST', `${app(label)}/stop`, {}, { timeout: 60000 }),
    sleep: (label) => call('POST', `${app(label)}/sleep`, {}, { timeout: 60000 }),
    logs: (label, tail = 200) => call('GET', `${app(label)}/logs?tail=${Number(tail) || 200}`),
    secretNames: (label) => call('GET', `${app(label)}/secrets`),
    patchSecrets: (label, change) => call('PATCH', `${app(label)}/secrets`, change),
    runJob: (label, name) => call('POST', `${app(label)}/jobs/${encodeURIComponent(name)}`, {}, { timeout: 1860000 }),
    remove: (label) => call('DELETE', app(label), undefined, { timeout: 120000 }),
    killAll: () => call('POST', '/v1/kill-all', {}, { timeout: 120000 }),
    release: () => call('POST', '/v1/kill-all/release', {}),
  };
}
