// The domain broker: the one place in the building that can spend money, and it only does so after a click from that floor's boss.
// Bots can ask. They hold no tool that approves, and nothing they write can reach the approve route. The registrant's details stay inside a single call.
//
// Status: awaiting_boss -> buying (click taken, nothing sent yet) -> sent (create may have gone out) -> bought -> live. Also declined and failed.
// "sent" is written BEFORE the create call, so a crash or a timeout can never lead to a second create: only the registrar's own list can settle it.
import { get, all, run, tx } from './db.js';
import { createNamecheapClient, NamecheapError } from './namecheap.js';

const DAY = (ms) => new Date(ms).toISOString().slice(0, 10);
const OPEN_REQUESTS = 5, REQUEST_TTL_MS = 7 * 86400000, UNCERTAIN_GRACE_MS = 15 * 60000, MAX_DNS_TRIES = 12, PRICE_TTL_MS = 10 * 60000, CHECKS_PER_HOUR = 60;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Registered in the owner's name, so a name that invites a trademark complaint lands on the owner.
const MARKS = /(google|gmail|youtube|apple|icloud|iphone|facebook|instagram|whatsapp|microsoft|windows|amazon|paypal|stripe|netflix|tiktok|openai|chatgpt|anthropic|claude|visa|mastercard|coinbase|binance|namecheap)/;

export class DomainRefused extends Error {}

export function cleanDomain(cfg, raw) {
  const d = String(raw ?? '').trim().toLowerCase().replace(/\.$/, '');
  const parts = d.split('.');
  if (d.length > 70 || parts.length !== 2 || !LABEL.test(parts[0])) throw new DomainRefused('a domain is one plain name and an ending, such as example.com');
  if (parts[0].length < 3) throw new DomainRefused('names under three letters are premium territory');
  if (parts[0].slice(2, 4) === '--') throw new DomainRefused('international and reserved-form names are not allowed');
  if (!cfg.domainTlds.includes(parts[1])) throw new DomainRefused(`only these endings can be bought here: ${cfg.domainTlds.join(', ')}`);
  if (MARKS.test(parts[0])) throw new DomainRefused('that name contains someone else\'s brand');
  for (const own of [cfg.appsBaseDomain?.split(':')[0], (() => { try { return new URL(cfg.publicOrigin).hostname; } catch { return ''; } })(), cfg.domainContactSource]) {
    if (own && (d === own || own.endsWith(`.${d}`))) throw new DomainRefused('that name is part of this building');
  }
  return d;
}

export const domainsConfigured = (cfg) => !!(cfg.namecheapKey && cfg.namecheapUser && cfg.namecheapClientIp && cfg.domainContactSource && cfg.serverIp && cfg.appsBaseDomain);

export function createDomainBroker({ db, cfg, engine, client }) {
  const enabled = domainsConfigured(cfg);
  const nc = enabled ? client || createNamecheapClient(cfg) : null;
  const prices = new Map(); const checks = new Map(); const working = new Set();
  const now = () => engine.now();
  const row = (id) => get(db, 'SELECT * FROM domain_orders WHERE id=?', id);
  const set = (id, patch) => {
    const keys = Object.keys(patch);
    run(db, `UPDATE domain_orders SET ${keys.map((k) => `${k}=?`).join(',')}, updated_at=? WHERE id=?`, ...keys.map((k) => patch[k]), now(), id);
  };
  const tell = (floorId) => engine.emit(floorId, 'domain', {}, { ownerOnly: true, persist: false });
  const wakeManager = (floorId, note) => {
    engine.addMessage(floorId, 'note', null, note);
    run(db, 'UPDATE floors SET manager_wake=1 WHERE id=?', floorId);
    engine.kick();
  };

  async function priceOf(tld) {
    const hit = prices.get(tld);
    if (hit && now() - hit.at < PRICE_TTL_MS) return hit.usd;
    const usd = await nc.price(tld);
    prices.set(tld, { usd, at: now() });
    return usd;
  }
  /** Everything known about one name right now. Never trusts a cached answer on availability. */
  async function quote(domains) {
    const seen = await nc.check(domains);
    const out = [];
    for (const d of domains) {
      const r = seen.find((x) => x.domain === d);
      const tld = d.split('.')[1];
      let usd = null;
      try { usd = await priceOf(tld); } catch { usd = null; }
      const total = usd === null ? null : Math.round((usd + (r?.icannFee || 0)) * 100) / 100;
      let why = '';
      if (!r) why = 'no answer from the registrar';
      else if (!r.available) why = 'taken';
      else if (r.premium || r.premiumPrice > 0 || r.eapFee > 0) why = 'premium';
      else if (total === null) why = 'no price listed';
      else if (total > cfg.domainMaxUsd) why = `over the $${cfg.domainMaxUsd} limit`;
      out.push({ domain: d, available: !!r?.available, premium: !!r?.premium, priceUsd: total, buyable: !why, why });
    }
    return out;
  }
  const sayNc = (e) => {
    if (e instanceof NamecheapError && e.kind === 'not_configured') return 'domain buying is not set up';
    if (e instanceof NamecheapError && e.safeText) return e.safeText;
    return 'the registrar did not answer properly';
  };

  const liveToday = (where, ...a) => get(db, `SELECT COUNT(*) n FROM domain_orders WHERE ${where} AND approved_at>=? AND status IN ('buying','sent','bought','live')`, ...a, Date.parse(`${DAY(now())}T00:00:00Z`)).n;

  // ---- what bots can do: look, and ask ----
  async function check(floor, names) {
    if (!enabled) throw new DomainRefused('domain buying is not set up in this building');
    const list = [...new Set((Array.isArray(names) ? names : [names]).slice(0, 10))];
    const good = []; const results = [];
    for (const n of list) { try { good.push(cleanDomain(cfg, n)); } catch (e) { if (e instanceof DomainRefused) results.push({ domain: String(n).slice(0, 80), available: false, buyable: false, why: e.message }); else throw e; } }
    const c = checks.get(floor.id);
    const hour = Math.floor(now() / 3600000);
    const used = c?.hour === hour ? c.n : 0;
    if (used + good.length > CHECKS_PER_HOUR) throw new DomainRefused('this floor has checked a lot of names this hour; try again later');
    checks.set(floor.id, { hour, n: used + good.length });
    if (good.length) { try { results.push(...await quote(good)); } catch (e) { throw new DomainRefused(`could not check: ${sayNc(e)}`); } }
    return results;
  }

  async function request(floor, agent, task, { domain: raw, project, why }) {
    if (!enabled) throw new DomainRefused('domain buying is not set up in this building');
    const domain = cleanDomain(cfg, raw);
    if (!get(db, 'SELECT 1 x FROM projects WHERE floor_id=? AND slug=?', floor.id, project)) throw new DomainRefused(`there is no project "${String(project).slice(0, 40)}" on this floor`);
    const mine = get(db, "SELECT id,status FROM domain_orders WHERE floor_id=? AND domain=? AND status IN ('awaiting_boss','buying','sent','bought','live') ORDER BY id DESC LIMIT 1", floor.id, domain);
    // Asking twice changes nothing. There is one request, and one click.
    if (mine) return { id: mine.id, status: mine.status, already: true };
    if (get(db, "SELECT COUNT(*) n FROM domain_orders WHERE floor_id=? AND status='awaiting_boss'", floor.id).n >= OPEN_REQUESTS) throw new DomainRefused('the boss already has several domain requests waiting');
    let q;
    try { [q] = await quote([domain]); } catch (e) { throw new DomainRefused(`could not check: ${sayNc(e)}`); }
    if (!q.buyable) throw new DomainRefused(`${domain} can't be bought: ${q.why}`);
    const t = now();
    const r = run(db, "INSERT INTO domain_orders (floor_id,agent_id,task_id,domain,project,why,status,quoted_usd,created_at,updated_at) VALUES (?,?,?,?,?,?,'awaiting_boss',?,?,?)", floor.id, agent?.id ?? null, task?.id ?? null, domain, project, String(why ?? '').slice(0, 400), q.priceUsd, t, t);
    tell(floor.id);
    return { id: Number(r.lastInsertRowid), status: 'awaiting_boss', priceUsd: q.priceUsd };
  }

  // ---- what only the boss's click can do ----
  /** Takes the click and returns at once; the buying happens behind it. seenUsd is the price on the button: a dearer one needs a fresh click. */
  function approve(floor, id, seenUsd) {
    if (!enabled) throw new DomainRefused('domain buying is not set up in this building');
    if (engine.globalPaused()) throw new DomainRefused('the building is paused');
    const seen = Number(seenUsd);
    if (!Number.isFinite(seen) || seen <= 0) throw new DomainRefused('the price on the button is missing');
    const took = tx(db, () => {
      const o = get(db, 'SELECT * FROM domain_orders WHERE id=? AND floor_id=?', id, floor.id);
      if (!o) throw new DomainRefused('no such request on this floor');
      if (o.status !== 'awaiting_boss') return false; // a double click, or a retry: the first one is already at work
      if (now() - o.created_at > REQUEST_TTL_MS) throw new DomainRefused('that request is over a week old; ask the manager to check the name again');
      if (seen > cfg.domainMaxUsd) throw new DomainRefused(`that is over the $${cfg.domainMaxUsd} limit`);
      if (liveToday('floor_id=?', floor.id) >= cfg.domainsPerFloorDay) throw new DomainRefused(`this floor has bought its ${cfg.domainsPerFloorDay} domains for today`);
      if (liveToday('1=1') >= cfg.domainsGlobalDay) throw new DomainRefused('the building has bought its domains for today');
      if (get(db, "SELECT 1 x FROM domain_orders WHERE domain=? AND status IN ('buying','sent','bought','live')", o.domain)) throw new DomainRefused('someone in this building is already buying that name');
      run(db, "UPDATE domain_orders SET status='buying', approved_usd=?, approved_at=?, note='', updated_at=? WHERE id=? AND status='awaiting_boss'", seen, now(), now(), id);
      return true;
    });
    tell(floor.id);
    if (took) { const p = purchase(id).catch((e) => engine.fail('domain', e)); engine.domainWork = p; }
    return row(id);
  }
  function decline(floor, id) {
    const r = run(db, "UPDATE domain_orders SET status='declined', updated_at=? WHERE id=? AND floor_id=? AND status='awaiting_boss'", now(), id, floor.id);
    if (r.changes) { wakeManager(floor.id, `The boss said no to buying ${row(id).domain}. Do not ask for it again.`); tell(floor.id); }
    return !!r.changes;
  }
  /** Boss-only: point a domain the floor owns at another of its projects. */
  function attach(floor, id, project) {
    const o = get(db, "SELECT * FROM domain_orders WHERE id=? AND floor_id=? AND status IN ('bought','live')", id, floor.id);
    if (!o) throw new DomainRefused('no such domain on this floor');
    if (!get(db, 'SELECT 1 x FROM projects WHERE floor_id=? AND slug=?', floor.id, project)) throw new DomainRefused('no such project on this floor');
    set(id, { project });
    tell(floor.id);
    return row(id);
  }

  // ---- buying ----
  const backToBoss = (o, note) => { set(o.id, { status: 'awaiting_boss', note, approved_at: null, approved_usd: null }); tell(o.floor_id); };
  async function purchase(id) {
    if (working.has(id)) return;
    working.add(id);
    let contacts = null;
    try {
      const o = row(id);
      if (o.status !== 'buying') return;
      // Everything up to here is free and safe to repeat.
      let q, balance;
      try {
        [q] = await quote([o.domain]);
        balance = await nc.balance();
        contacts = await nc.contacts(cfg.domainContactSource);
      } catch (e) {
        engine.log('warn', 'domain preflight failed', { order: id, kind: e?.kind, number: e?.number });
        backToBoss(o, `Nothing was charged: ${sayNc(e)}. You can press the button again.`);
        engine.officeNotice(o.floor_id, `I couldn't buy **${o.domain}**, boss: ${sayNc(e)}. Nothing was charged. You can try the button again in Requests.`);
        return;
      }
      if (!q.buyable) { set(id, { status: 'failed', note: `Not bought: ${q.why}. Nothing was charged.` }); wakeManager(o.floor_id, `${o.domain} could not be bought: ${q.why}. Nothing was charged. Pick another name if one is still needed.`); tell(o.floor_id); return; }
      if (q.priceUsd > o.approved_usd + 0.005) {
        set(id, { status: 'awaiting_boss', quoted_usd: q.priceUsd, approved_usd: null, approved_at: null, note: `The price went up from $${o.approved_usd.toFixed(2)} to $${q.priceUsd.toFixed(2)}, so it needs a fresh click.` });
        tell(o.floor_id);
        return;
      }
      if (balance === null || balance < q.priceUsd) {
        backToBoss(o, `Nothing was charged. The building's Namecheap balance is too low for this name ($${q.priceUsd.toFixed(2)}). Press the button again once it has been topped up.`);
        engine.officeNotice(o.floor_id, `Boss, **${o.domain}** was not bought and nothing was charged: the building's Namecheap balance is too low to cover the $${q.priceUsd.toFixed(2)}. Ask the building manager to top it up, then press Buy again under Requests.`);
        return;
      }
      // Written first. From this line on, nothing may ever send another create for this order.
      const claimed = run(db, "UPDATE domain_orders SET status='sent', sent_at=?, updated_at=? WHERE id=? AND status='buying'", now(), now(), id);
      if (!claimed.changes) return;
      let made;
      try { made = await nc.create(o.domain, contacts); } catch (e) {
        if (nc.isCertainRefusal(e)) {
          const low = e.lowFunds;
          engine.log('warn', 'domain refused', { order: id, number: e.number });
          if (low) {
            backToBoss(o, 'Nothing was charged. The building\'s Namecheap balance is too low. Press the button again once it has been topped up.');
            engine.officeNotice(o.floor_id, `Boss, **${o.domain}** was not bought and nothing was charged: the building's Namecheap balance is too low. Ask the building manager to top it up, then press Buy again under Requests.`);
          } else {
            set(id, { status: 'failed', note: `Not bought: ${e.safeText || `the registrar refused it (error ${e.number})`}. Nothing was charged.` });
            engine.officeNotice(o.floor_id, `I couldn't buy **${o.domain}**, boss: ${e.safeText || 'the registrar refused it'}. Nothing was charged.`);
            tell(o.floor_id);
          }
          return;
        }
        // Timed out, or an answer that could mean anything. It may have gone through, so it stays "sent" until the registrar's own list says which.
        engine.log('warn', 'domain outcome unclear', { order: id, kind: e?.kind, number: e?.number });
        set(id, { note: 'The registrar did not give a clear answer. Checking whether it went through; it will not be bought twice.', next_try_at: now() + (cfg.domainRetryMs ?? 30000) });
        tell(o.floor_id);
        return;
      }
      if (!made.registered) {
        set(id, { status: 'failed', note: 'The registrar did not register it. Nothing was charged.' });
        engine.officeNotice(o.floor_id, `I couldn't buy **${o.domain}**, boss: the registrar didn't register it. Nothing was charged.`);
        tell(o.floor_id);
        return;
      }
      bought(row(id), made.charged ?? q.priceUsd, made.charged === null, made);
      await pointDns(id);
    } finally { contacts = null; working.delete(id); }
  }
  /** Status and ledger change together, or not at all, and only once. */
  function bought(o, usd, estimated, made = {}) {
    const done = tx(db, () => {
      const r = run(db, "UPDATE domain_orders SET status='bought', charged_usd=?, charged_estimated=?, order_id=?, txn_id=?, registrar_id=?, privacy=?, bought_at=?, note='', updated_at=? WHERE id=? AND status='sent'", usd, estimated ? 1 : 0, made.orderId || '', made.transactionId || '', made.domainId || '', made.privacy ? 1 : 0, now(), now(), o.id);
      if (!r.changes) return false;
      run(db, "INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at,kind) VALUES (?,?,?,?,0,0,?,?,'domain')", o.floor_id, DAY(now()), o.agent_id, `domain:${o.domain}`, usd, now());
      return true;
    });
    if (!done) return;
    if (made.privacy === false) engine.log('warn', 'domain bought without privacy', { order: o.id });
    engine.feed(o.floor_id, null, `Bought ${o.domain}.`, o.project);
    engine.emit(o.floor_id, 'spend', { today: engine.spentToday(o.floor_id), cap: cfg.floorDailyUsd }, { persist: false });
    tell(o.floor_id);
  }
  async function pointDns(id) {
    const o = row(id);
    if (o.status !== 'bought') return;
    const records = [{ host: '@', type: 'A', address: cfg.serverIp }, { host: 'www', type: 'A', address: cfg.serverIp }];
    if (cfg.serverIp6) records.push({ host: '@', type: 'AAAA', address: cfg.serverIp6 }, { host: 'www', type: 'AAAA', address: cfg.serverIp6 });
    try {
      let ok = false;
      try { ok = await nc.setHosts(o.domain, records); } catch (e) {
        // A brand-new name may not be on Namecheap's own nameservers yet.
        if (e?.number === 2030288) { await nc.setDefaultDns(o.domain); ok = await nc.setHosts(o.domain, records); } else throw e;
      }
      if (!ok) throw new NamecheapError('api');
      set(id, { status: 'live', dns_ok: 1, note: '' });
      engine.feed(o.floor_id, null, `${o.domain} now points at ${o.project}.`, o.project);
      wakeManager(o.floor_id, `${o.domain} is bought and now serves the project "${o.project}" at https://${o.domain}/ (the first visit may take a minute while the certificate is issued). Use it as the canonical address, and tell the boss.`);
      engine.emitProject(o.floor_id, o.project);
      tell(o.floor_id);
    } catch (e) {
      const tries = o.dns_tries + 1;
      engine.log('warn', 'domain dns failed', { order: id, kind: e?.kind, number: e?.number, tries });
      set(id, { dns_tries: tries, next_try_at: now() + Math.min((cfg.domainRetryMs ?? 30000) * 2 ** tries, 3600000), note: tries >= MAX_DNS_TRIES ? 'Bought, but its address could not be set. The building manager has to finish this by hand.' : 'Bought. Still setting its address.' });
      if (tries === MAX_DNS_TRIES) engine.officeNotice(o.floor_id, `**${o.domain}** is bought, boss, but I can't point it at the site. The building manager needs to finish that by hand.`);
      tell(o.floor_id);
    }
  }

  // ---- after a restart, and on a slow timer ----
  function recover() {
    // A click that had not reached the create call: nothing went out, so it simply waits for the boss again.
    for (const o of all(db, "SELECT * FROM domain_orders WHERE status='buying'")) if (!working.has(o.id)) backToBoss(o, 'Interrupted before anything was sent. Nothing was charged. You can press the button again.');
  }
  /** "sent" is only ever settled by the registrar's list. It never sends another create. */
  async function reconcile() {
    if (!enabled) return;
    for (const o of all(db, "SELECT * FROM domain_orders WHERE status IN ('sent','bought') AND next_try_at<=?", now())) {
      if (working.has(o.id)) continue;
      working.add(o.id);
      try {
        if (o.status === 'bought') { if (o.dns_tries < MAX_DNS_TRIES) { working.delete(o.id); await pointDns(o.id); } continue; }
        let mine;
        try { mine = await nc.owned(o.domain); } catch { set(o.id, { next_try_at: now() + (cfg.domainRetryMs ?? 60000) }); continue; }
        if (mine) {
          bought(o, o.approved_usd ?? o.quoted_usd, true);
          working.delete(o.id);
          await pointDns(o.id);
        } else if (now() - (o.sent_at || o.updated_at) > UNCERTAIN_GRACE_MS) {
          set(o.id, { status: 'failed', note: 'It never appeared in the account, so it was not bought. Nothing shows as charged.' });
          engine.officeNotice(o.floor_id, `**${o.domain}** didn't go through in the end, boss. It never appeared in the account. Ask the manager if you still want it.`);
          tell(o.floor_id);
        } else set(o.id, { next_try_at: now() + (cfg.domainRetryMs ?? 60000) });
      } finally { working.delete(o.id); }
    }
  }

  // ---- views: never the registrant, never a credential ----
  const view = (o) => ({ id: o.id, domain: o.domain, project: o.project, why: o.why, status: o.status, priceUsd: o.quoted_usd, chargedUsd: o.charged_usd, note: o.note, createdAt: o.created_at, boughtAt: o.bought_at });
  return {
    enabled, check, request, approve, decline, attach, recover, reconcile, view,
    forFloor: (floorId) => all(db, 'SELECT * FROM domain_orders WHERE floor_id=? ORDER BY id DESC LIMIT 30', floorId).map(view),
    adminList: () => all(db, 'SELECT o.*, f.name floor FROM domain_orders o LEFT JOIN floors f ON f.id=o.floor_id ORDER BY o.id DESC LIMIT 200').map((o) => ({ ...view(o), floor: o.floor || '(closed)', orderId: o.order_id, transactionId: o.txn_id, privacy: !!o.privacy, estimated: !!o.charged_estimated })),
    /** The live domain for a Host header, apex or www. */
    lookup(host) {
      const h = String(host || '').toLowerCase().split(':')[0].replace(/\.$/, '');
      if (!h.includes('.')) return null;
      const apex = h.startsWith('www.') ? h.slice(4) : h;
      const o = get(db, "SELECT domain,floor_id,project FROM domain_orders WHERE domain=? AND status='live'", apex);
      return o ? { ...o, www: apex !== h } : null;
    },
    liveFor: (floorId, project) => get(db, "SELECT domain FROM domain_orders WHERE floor_id=? AND project=? AND status='live' ORDER BY id DESC LIMIT 1", floorId, project)?.domain || '',
  };
}
