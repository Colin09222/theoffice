// A company's own domain for email (docs/MAIL.md): hello@theirdomain.com instead of <slug>@MAIL_DOMAIN, set up by itself for a domain in the
// building's Namecheap account, and with the records shown to the boss for one held elsewhere. The building's mail provider allows only a few
// domains, so there is a limit (MAIL_MAX_DOMAINS); when it's full the company simply stays on MAIL_DOMAIN and the boss hears it kindly.
//
// Status: creating -> dns (domains in this account) or records (held elsewhere, the boss adds them) -> verifying -> verified.
// Also full (waiting for room), conflict (the domain already gets email somewhere else: nothing was changed), failed, expired, removed.
// Sending from a domain only ever happens once the provider says it's verified; until then the company's MAIL_DOMAIN address does the work.
import { get, all, run, tx } from './db.js';
import { MailProviderError } from './mail-provider.js';
import { zoneName } from './namecheap.js';

export const MAIL_LOCALS = ['hello', 'team', 'contact', 'support', 'info'];
export const HOLDS_PLACE = ['creating', 'dns', 'records', 'verifying', 'verified'];   // the ones holding one of the provider's few places
const ACTIVE = HOLDS_PLACE.map((x) => `'${x}'`).join(',');
const BOSS_SHOWN = ['creating', 'dns', 'records', 'verifying', 'verified', 'conflict', 'full', 'failed'];
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const BIG_MAIL = /(^|\.)(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm|gmx|zoho|yandex|fastmail|hey)\.(com|me|net|org|io)$/;
const DAY_MS = 86400e3, VERIFY_GIVE_UP_MS = 4 * DAY_MS, RECORDS_KEEP_MS = 7 * DAY_MS, RECORDS_RECHECK_MS = 30 * 60e3;
const REGION = 'us-east-1';

export class EmailDomainRefused extends Error {}

/** A domain name a boss typed: plain letters, digits, hyphens and dots, not part of the building, and not a mailbox company's own domain. */
export function cleanEmailDomain(raw, buildingNames = []) {
  const d = String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '').replace(/^www\./, '');
  if (!HOSTNAME.test(d)) throw new EmailDomainRefused('That doesn\'t look like a domain. Something like yourcompany.com.');
  for (const own of buildingNames) if (own && (d === own || d.endsWith(`.${own}`) || own.endsWith(`.${d}`))) throw new EmailDomainRefused('That domain is part of this building.');
  if (BIG_MAIL.test(d)) throw new EmailDomainRefused('Use a domain you own, not a mailbox company\'s.');
  return d;
}

/** Zone records from the provider's records, written for a registrar: names relative to the domain, TTL 300, MX priority kept. */
export function recordsToZone(records, domain) {
  const rel = (name) => { const n = zoneName(name); return n === domain ? '@' : n.endsWith(`.${domain}`) ? n.slice(0, -domain.length - 1) : n; };
  return (records || []).filter((r) => ['TXT', 'MX', 'CNAME'].includes(String(r.type).toUpperCase()) && r.value).map((r) => ({
    host: rel(r.name), type: String(r.type).toUpperCase(), address: String(r.value).replace(/^"(.*)"$/, '$1'), ttl: 300, ...(r.priority !== undefined && r.priority !== null ? { mxPref: Number(r.priority) } : {}) }));
}

/** Can this domain send yet? Their word "verified", or the same thing record by record when receiving is what's still missing. */
export function sendingReady(d) {
  if (d?.status === 'verified') return true;
  if (!['partially_verified', 'partially_failed'].includes(d?.status)) return false;
  const rs = d.records || [];
  const spf = rs.filter((r) => r.record === 'SPF' && zoneName(r.name) === 'send');
  return rs.some((r) => r.record === 'DKIM' && r.status === 'verified') && spf.length > 0 && spf.every((r) => r.status === 'verified');
}

export function createMailDomains({ db, set, provider, mailDomain, now, log, engine, hide, addAlert, notifyBoss, buildingHosts }) {
  const planFull = (e) => e instanceof MailProviderError && /limit|plan|upgrade/i.test(e.message) && e.status !== 429;
  const missing = (e) => e instanceof MailProviderError && e.status === 404;
  const row = (domain) => get(db, 'SELECT * FROM mail_domains WHERE domain=?', domain);
  const setRow = (domain, patch) => {
    const keys = Object.keys(patch);
    run(db, `UPDATE mail_domains SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE domain=?`, ...keys.map((k) => patch[k]), now(), domain);
  };
  const addressFor = (d) => `${d.local}@${d.domain}`;
  // A boss's press and the tick never work on the same domain at once: the provider's create isn't safe to send twice side by side.
  const working = new Set();
  const once = async (domain, fn) => { if (working.has(domain)) return undefined; working.add(domain); try { return await fn(); } finally { working.delete(domain); } };
  // MAIL_DOMAIN itself is one of the places.
  const usedPlaces = () => 1 + get(db, `SELECT COUNT(*) n FROM mail_domains WHERE status IN (${ACTIVE})`).n;
  const roomLeft = () => usedPlaces() < set.mailMaxDomains;
  const onFloor = (floorId) => get(db, `SELECT COUNT(*) n FROM mail_domains WHERE floor_id=? AND status IN (${ACTIVE},'conflict','full','failed')`, floorId).n;
  const fallbackOf = (floorId) => { const a = get(db, 'SELECT address FROM mail_addresses WHERE floor_id=? AND is_primary=1', floorId)?.address; return a ? `${a}@${mailDomain}` : `your address @${mailDomain}`; };
  const tell = (floorId, text) => { try { engine.bossNotice(floorId, text); } catch { /* the boss's notice is a courtesy */ } notifyBoss(floorId, { domain: true }); };

  /** The company's address on its own domain, if one is verified. Otherwise '' and it stays on MAIL_DOMAIN. */
  const ownAddress = (floorId) => get(db, `SELECT a.address FROM mail_domain_addresses a JOIN mail_domains d ON d.domain=a.domain WHERE a.floor_id=? AND a.is_primary=1 AND d.status='verified' ORDER BY d.verified_at DESC LIMIT 1`, floorId)?.address || '';
  /** Which floor a full address at a company's own domain belongs to, or null. Only a domain in use can take mail. Mail can arrive before sending is confirmed. */
  const route = (address) => get(db, "SELECT a.floor_id FROM mail_domain_addresses a JOIN mail_domains d ON d.domain=a.domain AND d.floor_id=a.floor_id WHERE a.address=? AND d.status NOT IN ('removed','expired')", address)?.floor_id ?? null;
  /** Is this domain one of the building's own, for the loop guard? */
  const inBuilding = (host) => !!host && (host === mailDomain || !!get(db, "SELECT 1 x FROM mail_domains WHERE domain=? AND status NOT IN ('removed','expired')", host));

  /** Makes `local@domain` the domain's sending address. Any earlier name stays as well: mail to it keeps arriving. */
  function useAddress(floorId, domain, local) {
    run(db, 'UPDATE mail_domain_addresses SET is_primary=0 WHERE floor_id=? AND domain=?', floorId, domain);
    run(db, 'INSERT INTO mail_domain_addresses (address,floor_id,domain,is_primary,created_at) VALUES (?,?,?,1,?) ON CONFLICT(address) DO UPDATE SET floor_id=excluded.floor_id, domain=excluded.domain, is_primary=1', `${local}@${domain}`, floorId, domain, now());
  }
  const dropAddresses = (domain) => run(db, 'DELETE FROM mail_domain_addresses WHERE domain=?', domain);

  function start(floor, domain, held) {
    if (!provider) throw new EmailDomainRefused('Email is still being set up for the building. Try again soon.');
    const had = row(domain);
    if (had && had.floor_id !== floor.id && !['removed', 'expired'].includes(had.status)) throw new EmailDomainRefused('That domain is already in use for email here.');
    if (had && had.floor_id === floor.id && !['removed', 'expired'].includes(had.status)) return had;
    if (onFloor(floor.id) >= set.mailFloorDomains) throw new EmailDomainRefused('One company can use one domain for email at a time. Stop using the other one first.');
    const t = now();
    const status = roomLeft() ? 'creating' : 'full';
    run(db, `INSERT INTO mail_domains (domain,floor_id,held,status,local,resend_id,records,note,tries,next_at,told,created_at,verified_at,updated_at) VALUES (?,?,?,?,?,'','[]','',0,0,0,?,NULL,?)
      ON CONFLICT(domain) DO UPDATE SET floor_id=excluded.floor_id, held=excluded.held, status=excluded.status, local=excluded.local, resend_id='', records='[]', note='', tries=0, next_at=0, told=0, created_at=excluded.created_at, verified_at=NULL, updated_at=excluded.updated_at`,
    domain, floor.id, held, status, had?.local && MAIL_LOCALS.includes(had.local) ? had.local : 'hello', t, t);
    dropAddresses(domain);  // left over from whoever had it before
    useAddress(floor.id, domain, row(domain).local);
    if (status === 'full') noteFull(row(domain));
    return row(domain);
  }
  /** Room ran out: the boss hears it kindly once, the admin gets an alert once, and email carries on from MAIL_DOMAIN. */
  function noteFull(d) {
    if (d.told) return;
    setRow(d.domain, { told: 1 });
    addAlert(d.floor_id, 'domains_full', `No room for ${d.domain} as an email domain (${usedPlaces()}/${set.mailMaxDomains} in use). It waits for a free place; raise MAIL_MAX_DOMAINS once the provider allows more.`);
    tell(d.floor_id, `Your company's email can't move to **${d.domain}** just yet, boss: every place for a company domain in this building is taken right now. It's nothing you did. Your email keeps going out from ${fallbackOf(d.floor_id)}, and it moves over by itself when a place opens up.`);
  }

  function fail(d, why, { alert = true } = {}) {
    setRow(d.domain, { status: 'failed', note: why, tries: 0, next_at: 0, told: 1 });
    if (alert) addAlert(d.floor_id, 'domain_failed', `${d.domain}: ${why}`);
    tell(d.floor_id, `I couldn't finish setting up email on **${d.domain}**, boss. ${why} Your email keeps going out from ${fallbackOf(d.floor_id)} for now. You can try again from the Inbox.`);
  }
  /** Go round again later: a little later each time, up to `maxMs`. */
  function retry(d, patch = {}, maxMs = 3600e3) {
    const tries = (d.tries || 0) + 1;
    setRow(d.domain, { tries, next_at: now() + Math.min(maxMs, 30e3 * 2 ** Math.min(tries, 12)), ...patch });
  }

  // ---- the steps, each safe to repeat ----
  async function create(d) {
    if (!provider) return retry(d);
    let found;
    try {
      const list = await provider.listDomains();
      found = (list?.data || []).find((x) => x.name === d.domain);
      // The provider's own list is the final word on how full it is, including anything added by hand.
      if (!found && (list?.data || []).length >= set.mailMaxDomains) return moveToFull(d);
      if (!found) found = await provider.createDomain({ name: d.domain, region: REGION, capabilities: { sending: 'enabled', receiving: 'enabled' }, open_tracking: false, click_tracking: false });
      if (!found.records) found = await provider.getDomain(found.id);
      if (found.capabilities && found.capabilities.receiving !== 'enabled') { await provider.updateDomain(found.id, { capabilities: { sending: 'enabled', receiving: 'enabled' } }); found = await provider.getDomain(found.id); }
    } catch (e) {
      if (planFull(e)) return moveToFull(d);
      log('warn', 'mail_domain_create', { domain: d.domain, err: hide(e?.message || e).slice(0, 160) });
      if (e instanceof MailProviderError && e.status >= 400 && e.status < 500 && e.status !== 429) return fail(d, 'The email provider wouldn\'t take that domain.');
      return retry(d);
    }
    const held = d.held === 'building';
    setRow(d.domain, { resend_id: String(found.id), records: JSON.stringify(found.records || []), status: held ? 'dns' : 'records', tries: 0, next_at: held ? 0 : now() + RECORDS_RECHECK_MS, note: '' });
    if (held) return writeDns(row(d.domain));
    tell(d.floor_id, `To move your company's email to **${d.domain}**, the DNS records it needs are in the Inbox. Add them where the domain is managed, then press Check again.`);
    return undefined;
  }
  function moveToFull(d) {
    setRow(d.domain, { status: 'full', next_at: now() + 600e3 });
    noteFull(row(d.domain));  // heard once, however many times it goes round
  }
  async function writeDns(d) {
    let out;
    try { out = await (engine.domains?.addMailRecords?.(d.domain, recordsToZone(JSON.parse(d.records), d.domain)) ?? { result: 'elsewhere' }); } catch (e) {
      log('warn', 'mail_domain_dns', { domain: d.domain, kind: e?.kind, number: e?.number });
      if ((d.tries || 0) >= 11) return fail(d, 'Its records couldn\'t be saved at the registrar.');
      return retry(d);
    }
    if (out.result === 'elsewhere') {
      setRow(d.domain, { held: 'outside', status: 'records', tries: 0, next_at: now() + RECORDS_RECHECK_MS, note: '' });
      tell(d.floor_id, `**${d.domain}** isn't managed from the building's account, so its email records have to be added where it is. They're in the Inbox, with a Check again button.`);
      return undefined;
    }
    if (out.result === 'conflict') {
      setRow(d.domain, { status: 'conflict', tries: 0, next_at: 0, note: '', told: 1 });
      if (d.told) { notifyBoss(d.floor_id, { domain: true }); return undefined; }  // said once; pressing Check again doesn't say it again
      addAlert(d.floor_id, 'domain_conflict', `${d.domain} already gets email somewhere else, so nothing was changed and the company stays on ${mailDomain}.`);
      tell(d.floor_id, `**${d.domain}** already gets email somewhere else, boss, so I left it exactly as it is. Your company's email stays on ${fallbackOf(d.floor_id)}. If that's not right, tell the building manager and press Check again in the Inbox.`);
      return undefined;
    }
    if (out.result !== 'done') return fail(d, 'Its records didn\'t save properly at the registrar.');
    setRow(d.domain, { status: 'verifying', tries: 0, next_at: now() + 45e3, note: '' });
    await askToVerify(row(d.domain));
    return undefined;
  }
  async function askToVerify(d) {
    try { await provider.verifyDomain(d.resend_id); return true; } catch (e) {
      if (missing(e)) { setRow(d.domain, { status: 'creating', resend_id: '', next_at: 0 }); return false; }
      log('warn', 'mail_domain_verify', { domain: d.domain, err: hide(e?.message || e).slice(0, 160) });
      return false;
    }
  }
  async function poll(d) {
    let got;
    try { got = await provider.getDomain(d.resend_id); } catch (e) {
      if (missing(e)) return setRow(d.domain, { status: 'creating', resend_id: '', next_at: 0 });
      log('warn', 'mail_domain_poll', { domain: d.domain, err: hide(e?.message || e).slice(0, 160) });
      return retry(d);
    }
    setRow(d.domain, { records: JSON.stringify(got.records || []), checked_at: now() });
    if (sendingReady(got)) return markVerified(d);
    if (d.status === 'records') {
      if (now() - d.created_at > RECORDS_KEEP_MS) return expire(d);
      setRow(d.domain, { next_at: now() + RECORDS_RECHECK_MS });
      if (d.asked_at === 0 || now() - d.asked_at > 6 * 3600e3) { await askToVerify(d); setRow(d.domain, { asked_at: now() }); }
      return undefined;
    }
    if (now() - d.created_at > VERIFY_GIVE_UP_MS || got.status === 'failed') return fail(d, 'The provider couldn\'t confirm its records.');
    if (['not_started', 'temporary_failure'].includes(got.status) && (d.tries || 0) % 4 === 3) await askToVerify(d);
    return retry(d, {}, 30 * 60e3);
  }
  function markVerified(d) {
    const cur = row(d.domain);  // the boss may have picked another name since this row was read
    const fresh = tx(db, () => {
      if (!cur || !['verifying', 'records', 'failed', 'conflict'].includes(cur.status)) return false;
      setRow(d.domain, { status: 'verified', verified_at: now(), tries: 0, next_at: now() + 6 * 3600e3, note: '', told: 0 });
      useAddress(d.floor_id, d.domain, cur.local);
      return true;
    });
    if (!fresh) return;
    const address = addressFor(cur);
    tell(d.floor_id, `Your company's email now goes out from **${address}**, boss. Replies come to your Inbox, and mail sent to ${fallbackOf(d.floor_id)} still reaches you too.`);
    log('info', 'mail_domain_verified', { domain: d.domain });
  }
  /** Checks a live domain is still good; once it stops being verified, mail falls back to MAIL_DOMAIN until it comes back. */
  async function recheckVerified(d) {
    let got;
    try { got = await provider.getDomain(d.resend_id); } catch (e) {
      if (missing(e)) return setRow(d.domain, { status: 'creating', resend_id: '', next_at: 0 });
      return setRow(d.domain, { next_at: now() + 6 * 3600e3 });
    }
    setRow(d.domain, { records: JSON.stringify(got.records || []), next_at: now() + 6 * 3600e3 });
    if (got.status === 'failed') return fail(d, 'Its records aren\'t there any more, so it can\'t send.');
    // temporary_failure is the provider re-checking a domain that was fine; it keeps sending while it does.
    if (!sendingReady(got) && got.status !== 'temporary_failure') setRow(d.domain, { status: 'verifying', created_at: now(), tries: 0, next_at: now() + 60e3 });
    return undefined;
  }
  /** The provider refused to send from this domain, so look at it again now instead of at the next six-hourly check. */
  const doubt = (domain) => run(db, "UPDATE mail_domains SET next_at=0 WHERE domain=? AND status='verified'", domain);
  async function expire(d) {
    tx(db, () => { setRow(d.domain, { status: 'expired', note: '', told: 1 }); dropAddresses(d.domain); });
    if (d.resend_id && provider) await provider.deleteDomain(d.resend_id).catch((e) => log('warn', 'mail_domain_delete', { domain: d.domain, err: hide(e?.message || e).slice(0, 160) }));
    tell(d.floor_id, `**${d.domain}** was never finished for email after a week, so I've let it go. Your email is unchanged, and you can add it again from the Inbox whenever you like.`);
  }

  async function release(d) {
    tx(db, () => { setRow(d.domain, { status: 'removed', next_at: 0, told: 0, note: '' }); dropAddresses(d.domain); });
    if (d.resend_id && provider) await provider.deleteDomain(d.resend_id).catch((e) => log('warn', 'mail_domain_delete', { domain: d.domain, err: hide(e?.message || e).slice(0, 160) }));
  }

  async function advance(d) {
    if (d.status === 'full') { if (roomLeft()) { setRow(d.domain, { status: 'creating', next_at: 0 }); await create(row(d.domain)); } else setRow(d.domain, { next_at: now() + 600e3 }); return; }
    if (d.status === 'creating') return create(d);
    if (d.status === 'dns') return writeDns(d);
    if (d.status === 'verifying' || d.status === 'records') return poll(d);
    if (d.status === 'verified') return recheckVerified(d);
  }
  /** On every Inbox-worthy tick: live domains get email without anyone asking (one domain per company by default), and a few rows move along. */
  let busy = false;
  async function tick() {
    if (busy || !provider) return;
    busy = true;
    try {
      for (const o of all(db, "SELECT o.domain, o.floor_id FROM domain_orders o JOIN floors f ON f.id=o.floor_id WHERE o.status='live' AND f.filler=0 AND f.status='active' AND NOT EXISTS (SELECT 1 FROM mail_domains d WHERE d.domain=o.domain) ORDER BY o.id LIMIT 20")) {
        if (onFloor(o.floor_id) >= set.mailFloorDomains) continue;
        const floor = get(db, 'SELECT * FROM floors WHERE id=?', o.floor_id);
        try { start(floor, o.domain, 'building'); } catch (e) { if (!(e instanceof EmailDomainRefused)) throw e; }
      }
      // A floor that's gone gives its place back.
      for (const d of all(db, "SELECT d.* FROM mail_domains d WHERE d.status NOT IN ('removed','expired') AND NOT EXISTS (SELECT 1 FROM floors f WHERE f.id=d.floor_id) LIMIT 5")) await release(d).catch((e) => log('error', 'mail_domain_release', { domain: d.domain, err: hide(e?.message || e).slice(0, 200) }));
      for (const d of all(db, "SELECT * FROM mail_domains WHERE status IN ('full','creating','dns','records','verifying','verified') AND next_at<=? ORDER BY next_at LIMIT 3", now())) {
        await once(d.domain, () => advance(d)).catch((e) => log('error', 'mail_domain_tick', { domain: d.domain, err: hide(e?.message || e).slice(0, 200) }));
      }
    } finally { busy = false; }
  }

  // ---- what the boss can do ----
  function own(f, domain) { const d = row(domain); if (!d || d.floor_id !== f.id || !BOSS_SHOWN.includes(d.status)) throw new EmailDomainRefused('No such domain on this floor.'); return d; }
  async function addByBoss(f, raw) {
    const domain = cleanEmailDomain(raw, buildingHosts());
    const held = get(db, "SELECT 1 x FROM domain_orders WHERE floor_id=? AND domain=? AND status='live'", f.id, domain) ? 'building' : 'outside';
    if (held === 'outside' && get(db, "SELECT 1 x FROM domain_orders WHERE domain=? AND status IN ('sent','uncertain','bought','live')", domain)) throw new EmailDomainRefused('That domain is already in use for email here.');
    const d = start(f, domain, held);
    if (d.status === 'creating') await once(domain, () => create(row(domain)));
    return view(f);
  }
  async function recheck(f, domain) {
    const d = own(f, domain);
    await once(domain, () => checkNow(d));
    return view(f);
  }
  async function checkNow(d) {
    const { domain } = d;
    if (d.status === 'verified') { await recheckVerified(d); return; }
    if (d.status === 'conflict') { setRow(domain, { status: 'dns', tries: 0, next_at: 0 }); await writeDns(row(domain)); return; }
    if (d.status === 'full') { if (roomLeft()) { setRow(domain, { status: 'creating', next_at: 0, told: 0 }); await create(row(domain)); } return; }
    if (d.status === 'creating') { await create(d); return; }
    if (d.status === 'dns') { await writeDns(d); return; }
    // Failed, or waiting on records: ask the provider to look again now, and look soon. A boss's "check again" also gives a stale domain a fresh window.
    if (d.resend_id) await askToVerify(d);
    // Records that never reached the zone need writing again, not more waiting.
    if (d.status === 'failed') setRow(domain, { status: !d.resend_id ? 'creating' : d.held === 'building' ? 'dns' : 'verifying', tries: 0, next_at: 0, created_at: now() });
    else setRow(domain, { next_at: 0, asked_at: now(), created_at: now() });
    await advance(row(domain));
  }
  function setLocal(f, domain, raw) {
    const local = String(raw ?? '').trim().toLowerCase();
    if (!MAIL_LOCALS.includes(local)) throw new EmailDomainRefused('Pick one of the suggested names.');
    own(f, domain);
    tx(db, () => { setRow(domain, { local }); useAddress(f.id, domain, local); });
    return view(f);
  }
  async function stopUsing(f, domain) { await release(own(f, domain)); return view(f); }

  // ---- what the boss sees ----
  const LINES = {
    creating: () => 'Getting this domain ready for email.',
    dns: () => 'Getting this domain ready for email.',
    verifying: () => 'Almost there: waiting for the records to be confirmed. It usually takes a few minutes, occasionally a few hours.',
    verified: (d) => `Your email goes out from ${addressFor(d)}.`,
    records: () => 'Add these records where your domain is managed, then press Check again. It can take a while to show up after you add them.',
    conflict: (d) => `This domain already gets email somewhere else, so it was left exactly as it is. Your email stays on ${fallbackOf(d.floor_id)}.`,
    full: (d) => `Every place for a company domain in this building is taken right now. Your email stays on ${fallbackOf(d.floor_id)} and moves over by itself when a place opens up.`,
    failed: (d) => `It couldn't be finished this time. Your email stays on ${fallbackOf(d.floor_id)}. Press Check again to retry.`,
  };
  function domainView(d) {
    const recs = (() => { try { return JSON.parse(d.records || '[]'); } catch { return []; } })();
    return {
      domain: d.domain, status: d.status, held: d.held, address: addressFor(d), local: d.local, ready: d.status === 'verified', line: LINES[d.status]?.(d) || '',
      records: d.held === 'outside' ? recs.map((r) => ({ type: r.type, name: zoneName(r.name), value: r.value, priority: r.priority ?? null, ok: r.status === 'verified' })) : [],
      canCheck: ['records', 'failed', 'conflict', 'full', 'verifying'].includes(d.status), canRemove: true,
    };
  }
  function view(f) {
    const rows = all(db, `SELECT * FROM mail_domains WHERE floor_id=? AND status IN (${BOSS_SHOWN.map((s) => `'${s}'`).join(',')}) ORDER BY created_at`, f.id);
    const used = new Set(rows.map((d) => d.domain));
    return {
      domains: rows.map(domainView),
      // Domains the company already has here and could use instead.
      domainChoices: all(db, "SELECT domain FROM domain_orders WHERE floor_id=? AND status='live' ORDER BY id", f.id).map((o) => o.domain).filter((x) => !used.has(x)),
      canAddDomain: !!provider && rows.length < set.mailFloorDomains,
      localChoices: MAIL_LOCALS,
    };
  }
  return { route, inBuilding, ownAddress, tick, view, addByBoss, recheck, setLocal, stopUsing, start, usedPlaces, doubt };
}
