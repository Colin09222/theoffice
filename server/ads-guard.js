// The building's own controls over paid ads: the spend watchdog's run (scripts/ads-watchdog.mjs, from a scheduler), the admin's list of what was
// approved against what Google says it cost, and the emergency stop. Admin only: nothing here is shown on a floor. See docs/ADS.md.
import { all, run } from './db.js';
import { ensureAdSpend, committedUsd } from './business.js';
import { watchAccount, campaignId, campaignStats, usd } from './googleads.js';

const WATCHDOG_NOTE = 'Stopped early by the building’s spend check. Nothing more will be spent';

/** One watchdog pass: read the account, pause what has to stop, and write down what it found. Returns watchAccount's answer, line included. */
export async function runWatchdog({ db, cfg, api, now = Date.now(), pause = true }) {
  ensureAdSpend(db);
  const rows = all(db, "SELECT * FROM ad_spend WHERE campaign != ''");
  const known = rows.map((r) => ({ id: campaignId(r.campaign), approvedUsd: r.amount, endsAt: r.ends_at, request: r.id }));
  const res = await watchAccount({ api, known, capUsd: cfg.adMonthlyCapUsd, now, pause });
  for (const r of rows) {
    const id = campaignId(r.campaign);
    if (res.lifeCost.has(id)) run(db, 'UPDATE ad_spend SET spent_micros=?, synced_at=? WHERE id=?', res.lifeCost.get(id), now, r.id);
    if (!pause || !res.paused.includes(id) || !['running', 'approved'].includes(r.status)) continue;
    const onSchedule = !res.alert && res.ended.includes(id);
    run(db, 'UPDATE ad_spend SET status=?, note=?, updated_at=? WHERE id=?', onSchedule ? 'ended' : 'paused', onSchedule ? '' : WATCHDOG_NOTE, now, r.id);
  }
  return res;
}

/** The emergency stop: every enabled campaign in the account is paused, the Office's own and any other, and none of the Office's starts again. */
export async function pauseAll({ db, api, now = Date.now() }) {
  ensureAdSpend(db);
  const rows = await api.search("SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name FROM campaign WHERE campaign.status != 'REMOVED'");
  const on = rows.map((r) => r.campaign).filter((c) => c?.status === 'ENABLED');
  await api.setStatus(on.map((c) => c.resourceName || api.rn('campaigns', c.id)), 'PAUSED');
  const marked = run(db, "UPDATE ad_spend SET status='paused', note=?, updated_at=? WHERE status IN ('approved','running')", 'Stopped by the building manager. Nothing more will be spent', now).changes;
  return { paused: on.map((c) => String(c.id)), marked, line: `ads pause-all: paused ${on.length} campaign${on.length === 1 ? '' : 's'} on Google; ${marked} Office request${marked === 1 ? '' : 's'} marked stopped` };
}

/** Approved against spent, per campaign, with Google's own figures when it can be read. */
export async function adsListing({ db, cfg, api, now = Date.now() }) {
  ensureAdSpend(db);
  const rows = all(db, "SELECT a.*, f.number AS floor_number FROM ad_spend a LEFT JOIN floors f ON f.id=a.floor_id WHERE a.status != 'declined' ORDER BY a.id DESC LIMIT 60");
  let live = null, error = '';
  if (api) { try { live = await campaignStats(api, rows.map((r) => campaignId(r.campaign)).filter(Boolean)); } catch (e) { error = String(e?.message || e).slice(0, 200); } }
  const items = rows.map((r) => {
    const s = live?.get(campaignId(r.campaign));
    return { request: r.id, floor: r.floor_number ?? null, project: r.project, status: r.status, approvedUsd: r.amount, spentUsd: Math.round(s ? s.costMicros / 1e4 : r.spent_micros / 1e4) / 100,
      fromGoogle: !!s, googleStatus: s?.status || '', campaign: campaignId(r.campaign), endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : '', note: r.note || '' };
  });
  return { paidEnabled: !!cfg.adsPaidEnabled, googleConnected: !!api, capUsd: cfg.adMonthlyCapUsd, committedThisMonthUsd: committedUsd(db, { now, timeZone: cfg.googleAds?.timeZone }), items, error };
}
export function adsListingText(l) {
  const head = `Paid ads ${l.paidEnabled ? 'ON' : 'OFF'} (ADS_PAID_ENABLED); Google ${l.googleConnected ? 'connected' : 'not set up'}. This month: ${usd(l.committedThisMonthUsd * 1e6)} committed of the ${usd(l.capUsd * 1e6)} cap.${l.error ? ` Google couldn't be read: ${l.error}` : ''}`;
  if (!l.items.length) return `${head}\nNo ad requests yet.`;
  return [head, ...l.items.map((i) => `#${i.request} floor ${i.floor ?? '?'} ${i.project}: ${i.status}${i.googleStatus ? ` (Google: ${i.googleStatus})` : ''}, approved $${i.approvedUsd}, spent ${usd(i.spentUsd * 1e6)}${i.fromGoogle ? '' : ' (last known)'}${i.campaign ? `, campaign ${i.campaign}` : ''}${i.endsAt ? `, ends ${i.endsAt.slice(0, 16).replace('T', ' ')} UTC` : ''}${i.note ? `. ${i.note}` : ''}`)].join('\n');
}
