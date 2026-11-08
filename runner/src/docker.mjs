// A small Docker Engine API client over the unix socket. Only the control daemon (root) uses it.
import http from 'node:http';

export class DockerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class Docker {
  constructor({ socketPath = '/var/run/docker.sock', version = 'v1.47' } = {}) {
    this.socketPath = socketPath;
    this.prefix = `/${version}`;
  }

  // Resolves { status, headers, body: Buffer } or, with stream: true, { status, headers, res }.
  request(method, path, { query, json, body, headers = {}, timeoutMs = 60000, stream = false } = {}) {
    const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
    let payload = body;
    if (json !== undefined) {
      payload = Buffer.from(JSON.stringify(json));
      headers = { 'content-type': 'application/json', ...headers };
    }
    if (payload) headers = { 'content-length': payload.length, ...headers };
    return new Promise((resolve, reject) => {
      const req = http.request({ socketPath: this.socketPath, method, path: this.prefix + path + qs, headers, timeout: timeoutMs }, (res) => {
        if (stream) return resolve({ status: res.statusCode, headers: res.headers, res });
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new DockerError(0, `docker ${method} ${path} timed out`)));
      req.on('error', reject);
      req.end(payload);
    });
  }

  async call(method, path, opts = {}) {
    const r = await this.request(method, path, opts);
    if (r.status >= 400) {
      let msg = r.body.toString('utf8');
      try {
        msg = JSON.parse(msg).message ?? msg;
      } catch {}
      throw new DockerError(r.status, `docker ${method} ${path.split('?')[0]}: ${r.status} ${msg.slice(0, 300)}`);
    }
    if (r.status === 204 || r.body.length === 0) return null;
    return (r.headers['content-type'] ?? '').includes('json') ? JSON.parse(r.body.toString('utf8')) : r.body;
  }

  inspect(id) {
    return this.call('GET', `/containers/${encodeURIComponent(id)}/json`).catch((e) => {
      if (e.status === 404) return null;
      throw e;
    });
  }
  list(labelFilter, all = true) {
    return this.call('GET', '/containers/json', { query: { all: all ? 1 : 0, filters: JSON.stringify({ label: [labelFilter] }) } });
  }
  create(name, spec) {
    return this.call('POST', '/containers/create', { query: { name }, json: spec });
  }
  start(id) {
    return this.call('POST', `/containers/${encodeURIComponent(id)}/start`).catch((e) => {
      if (e.status === 304) return null;
      throw e;
    });
  }
  stop(id, seconds = 5) {
    return this.call('POST', `/containers/${encodeURIComponent(id)}/stop`, { query: { t: seconds }, timeoutMs: (seconds + 30) * 1000 }).catch((e) => {
      if (e.status === 304 || e.status === 404) return null;
      throw e;
    });
  }
  kill(id) {
    return this.call('POST', `/containers/${encodeURIComponent(id)}/kill`).catch((e) => {
      if (e.status === 404 || e.status === 409) return null;
      throw e;
    });
  }
  remove(id) {
    return this.call('DELETE', `/containers/${encodeURIComponent(id)}`, { query: { force: 1, v: 1 } }).catch((e) => {
      if (e.status === 404) return null;
      throw e;
    });
  }
  wait(id, timeoutMs) {
    return this.call('POST', `/containers/${encodeURIComponent(id)}/wait`, { timeoutMs });
  }
  putArchive(id, dir, tarBuf) {
    return this.call('PUT', `/containers/${encodeURIComponent(id)}/archive`, { query: { path: dir }, body: tarBuf, headers: { 'content-type': 'application/x-tar' }, timeoutMs: 120000 });
  }
  commit(id, repo, tag, config) {
    return this.call('POST', '/commit', { query: { container: id, repo, tag, pause: 'false' }, json: config, timeoutMs: 300000 });
  }
  removeImage(ref) {
    return this.call('DELETE', `/images/${encodeURIComponent(ref)}`, { query: { force: 0, noprune: 0 } }).catch((e) => {
      if (e.status === 404 || e.status === 409) return null;
      throw e;
    });
  }
  images(reference) {
    return this.call('GET', '/images/json', { query: { filters: JSON.stringify({ reference: [reference] }) } });
  }
  imageExists(ref) {
    return this.call('GET', `/images/${encodeURIComponent(ref)}/json`).then(
      () => true,
      (e) => (e.status === 404 ? false : Promise.reject(e)),
    );
  }

  // Last lines of a container's stdout+stderr as text.
  async logs(id, tailLines = 200) {
    const r = await this.request('GET', `/containers/${encodeURIComponent(id)}/logs`, { query: { stdout: 1, stderr: 1, timestamps: 1, tail: tailLines } });
    if (r.status === 404) return '';
    if (r.status >= 400) throw new DockerError(r.status, 'logs failed');
    return demux(r.body);
  }

  // Runs a command in a running container; resolves { exitCode, output } (output already demuxed).
  async exec(id, cmd, { user, env = [], timeoutMs, maxOutput = 256 * 1024 } = {}) {
    const ex = await this.call('POST', `/containers/${encodeURIComponent(id)}/exec`, {
      json: { Cmd: cmd, AttachStdout: true, AttachStderr: true, User: user, Env: env, WorkingDir: '/app' },
    });
    const r = await this.request('POST', `/exec/${ex.Id}/start`, { json: { Detach: false, Tty: false }, stream: true, timeoutMs: 0 });
    const chunks = [];
    let size = 0;
    let timedOut = false;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        r.res.destroy();
        resolve();
      }, timeoutMs);
      r.res.on('data', (c) => {
        size += c.length;
        if (size <= maxOutput) chunks.push(c);
      });
      r.res.on('end', () => (clearTimeout(timer), resolve()));
      r.res.on('error', () => (clearTimeout(timer), resolve()));
      r.res.on('close', () => (clearTimeout(timer), resolve()));
    });
    let exitCode = null;
    if (!timedOut) {
      const info = await this.call('GET', `/exec/${ex.Id}/json`);
      exitCode = info.ExitCode;
    }
    return { exitCode, timedOut, output: demux(Buffer.concat(chunks)) };
  }
}

// Docker multiplexes stdout/stderr frames as [stream, 0, 0, 0, size(4 bytes BE)] + payload.
export function demux(buf) {
  const out = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    if (buf[i] > 2 || buf[i + 1] !== 0 || buf[i + 2] !== 0 || buf[i + 3] !== 0) break;
    const size = buf.readUInt32BE(i + 4);
    out.push(buf.subarray(i + 8, Math.min(buf.length, i + 8 + size)));
    i += 8 + size;
  }
  if (i === 0) return buf.toString('utf8'); // not multiplexed (a tty container)
  return Buffer.concat(out).toString('utf8');
}
