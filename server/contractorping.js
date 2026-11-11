// The contractor ping. When a job is held for the building's outside contractor (server/contractor.js), the owner's assistant, buddehbot, hears about it at once
// through its gateway's agent hook, and either starts a Mac worker (pre-approved floors) or asks the owner on Telegram first. One POST per job: the job's id is the idempotency key, so a retry
// never starts a second run. It runs in the background and never holds up a floor. With no hook set up it logs and does nothing.
import { newFence } from './help.js';

const RETRY = new Set([408, 425, 429, 500, 502, 503, 504]);
const TITLE_MAX = 160;
// Floors Colon has pre-approved: LabStackr (3), TheTireRx (6), Cailyn (7). Every other floor's job waits for his yes.
const PRE_APPROVED = new Set([3, 6, 7]);

export const pingKey = (jobId) => `theoffice-contractor-job-${jobId}`;

/** What buddehbot reads. Only the office's own numbers sit outside the fence; the floor's name and the job title are fenced as untrusted data. */
export function pingMessage({ floorNumber, floorName, taskId, role, title }) {
  const fence = newFence();
  const line = String(title ?? '').split(/\r?\n/)[0].slice(0, TITLE_MAX);
  return [
    fence.notice,
    '',
    `The Office: a ${role} job is held for the outside contractor.`,
    `Floor ${floorNumber}: ${fence.wrap('floor name', floorName)}`,
    `Task #${taskId}, role ${role}`,
    `Job: ${fence.wrap('task title', line)}`,
    '',
    'Office jobs always run on buddehbot\'s Mac, never the PC.',
    PRE_APPROVED.has(Number(floorNumber))
      ? `Colon has pre-approved floor ${floorNumber}: start a Mac worker for task #${taskId} per the contractor runbook in memory, then tell Colon in one or two lines.`
      : `Before doing anything else, ask Colon in this Telegram chat: "Take contractor job #${taskId}?" with the floor and job title above. Do not start, queue or run it until he says yes, and never automatically.`,
    `The full brief is in \`node scripts/admin.mjs contractor list\` on hz (task #${taskId}).`,
  ].join('\n');
}

/**
 * POST the ping and retry with backoff on a network error or a busy gateway. Resolves with { ok, status } or { skipped }; never throws.
 * `job` is { id, floorNumber, floorName, taskId, role, title }.
 */
export async function pingContractor(cfg, job, { httpFetch = fetch, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!cfg.hookUrl || !cfg.hookToken) { log('warn', 'contractor ping skipped: OPENCLAW_HOOK_URL or OPENCLAW_HOOK_TOKEN is not set', { job: job.id, task: job.taskId }); return { skipped: true }; }
  const body = JSON.stringify({
    message: pingMessage(job), name: `The Office contractor job ${job.id}`, agentId: cfg.hookAgentId, sessionMode: 'isolated',
    deliver: true, channel: cfg.hookChannel, to: cfg.hookTo,
  });
  const headers = { authorization: `Bearer ${cfg.hookToken}`, 'content-type': 'application/json', 'idempotency-key': pingKey(job.id) };
  const tries = cfg.hookTries ?? 5;
  let status = 0;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep((cfg.hookRetryMs ?? 2000) * 2 ** (i - 1));
    try {
      const res = await httpFetch(cfg.hookUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
      status = res.status;
      await res.text().catch(() => '');
      if (res.ok) { log('info', 'contractor ping accepted', { job: job.id, task: job.taskId, status }); return { ok: true, status }; }
      if (!RETRY.has(status)) break;
    } catch (e) { status = 0; log('warn', 'contractor ping attempt failed', { job: job.id, err: String(e?.name || 'error') }); }
  }
  log('error', 'contractor ping gave up', { job: job.id, task: job.taskId, status });
  return { ok: false, status };
}
