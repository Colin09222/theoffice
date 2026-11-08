// office-runner settings. Defaults live here; /opt/office-runner/etc/runner.json overrides any key
// (it holds no secrets), and an env var of the same name wins over both, e.g. MAX_APPS=6.
import fs from 'node:fs';

export const DEFAULTS = Object.freeze({
  ROOT: '/opt/office-runner',
  MAX_APPS: 4, // deployed apps in total, sleeping ones included. A 5th deploy is refused.
  MAX_BROWSER_APPS: 2, // of those, how many may use the browser tier
  IDLE_MINUTES: 15, // an app with no traffic for this long is stopped; the next request wakes it
  WAKE_TIMEOUT_S: 45, // how long a request waits for a sleeping app to listen on its port
  JOB_TIMEOUT_MIN: 15, // default limit for one scheduled job run (an app may ask for up to 60)
  BUILD_TIMEOUT_MIN: 10,
  CONTROL_HOST: '127.0.0.1',
  CONTROL_PORT: 8092, // Phase 2 API + the edge's internal calls (bearer tokens, loopback only)
  CONTROL_SOCKET: '/run/office-runner/api/runner.sock', // same API on a unix socket a container can mount
  CONTROL_SOCKET_GID: 1000, // the Office container runs as node (1000)
  EDGE_HOST: '127.0.0.1',
  EDGE_PORT: 8090, // Caddy sends api--<label>.middistance.com here
  EGRESS_HOST: '172.30.1.1', // build-time egress proxy, on the office-build bridge only
  EGRESS_PORT: 3128,
  EGRESS_ALLOW: ['registry.npmjs.org', 'cdn.playwright.dev', 'playwright.download.prss.microsoft.com'],
  APPS_NETWORK: 'office-apps',
  APPS_IP_PREFIX: '172.30.0.', // apps get fixed addresses .10 to .250
  BUILD_NETWORK: 'office-build',
  APP_PORT: 8080,
  APP_UID: 10001,
  HOST_PREFIX: 'api--',
  HOST_SUFFIX: '.middistance.com',
  BASE_STANDARD: 'node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d', // Debian 12, Node 22.23.4
  BASE_BROWSER: 'office-runner/browser:pw1.65.0',
  PLAYWRIGHT_VERSION: '1.65.0',
  RUNTIME: 'runsc',
  PIDS_LIMIT: 128,
  BUILD_PIDS_LIMIT: 256,
  DATA_MB: 256, // per-app /data volume (a loop-mounted ext4 image, so the size is a hard quota)
  TIERS: {
    standard: { memoryMb: 512, cpus: 1, tmpMb: 64, shmMb: 64 },
    browser: { memoryMb: 1024, cpus: 1, tmpMb: 256, shmMb: 128 },
  },
  BUILD_MEMORY_MB: 1536,
  BUILD_CPUS: 2,
  MAX_UPLOAD_MB: 20, // a deploy's files, decoded
  MAX_FILES: 3000,
  MAX_BODY_MB: 32, // request bodies proxied to an app
  MAX_CONNS_PER_APP: 256,
});

const INT_KEYS = Object.keys(DEFAULTS).filter((k) => typeof DEFAULTS[k] === 'number');

export function loadConfig({ file, env = process.env, overrides = {} } = {}) {
  const path = file ?? env.RUNNER_CONFIG ?? `${DEFAULTS.ROOT}/etc/runner.json`;
  let fromFile = {};
  try {
    fromFile = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`bad config ${path}: ${e.message}`);
  }
  const cfg = { ...DEFAULTS, ...fromFile, ...overrides };
  cfg.TIERS = {
    standard: { ...DEFAULTS.TIERS.standard, ...(fromFile.TIERS?.standard ?? {}), ...(overrides.TIERS?.standard ?? {}) },
    browser: { ...DEFAULTS.TIERS.browser, ...(fromFile.TIERS?.browser ?? {}), ...(overrides.TIERS?.browser ?? {}) },
  };
  for (const k of INT_KEYS) {
    if (env[k] !== undefined && env[k] !== '') cfg[k] = Number(env[k]);
    if (!Number.isFinite(cfg[k]) || cfg[k] < 0) throw new Error(`config ${k} must be a number`);
  }
  if (cfg.MAX_BROWSER_APPS > cfg.MAX_APPS) cfg.MAX_BROWSER_APPS = cfg.MAX_APPS;
  cfg.paths = {
    state: `${cfg.ROOT}/state`,
    apps: `${cfg.ROOT}/state/apps.json`,
    killed: `${cfg.ROOT}/state/KILLED`,
    secrets: `${cfg.ROOT}/secrets`,
    appSecrets: `${cfg.ROOT}/secrets/apps`,
    apiToken: `${cfg.ROOT}/secrets/api.token`,
    edgeToken: `${cfg.ROOT}/secrets/edge.token`,
    forbiddenHashes: `${cfg.ROOT}/etc/forbidden-secret-sha256`,
    volumes: `${cfg.ROOT}/volumes`,
    mnt: `${cfg.ROOT}/mnt`,
    logs: `${cfg.ROOT}/logs`,
  };
  return cfg;
}
