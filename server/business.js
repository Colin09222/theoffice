// Business mode: a guided Idea, Build, Customers, Launch journey for one floor. Off until the boss taps "Start a business" or asks the manager to find
// them a business idea and build it. The work itself is ordinary tasks for the ordinary staff, through the ordinary engine, tools and ledger; this
// module only keeps the journey's place, hands out each step's tasks, reads where they stand, and tells the manager what changed. See docs/BUSINESS.md.
// Honesty: an idea card's links must have been opened or found on this floor, and every figure on it must come from one of them. Money: the only
// figure anyone sees is the boss's own choice of ad money, and an ad request needs the boss's own click. Paid ads run on Google Search only, and
// only with ADS_PAID_ENABLED on: the approval is recorded first, then the campaign is made PAUSED, then switched on; it ends within 7 days, never
// costs more than the approved amount, and the building's monthly cap is checked before each one. See docs/ADS.md and server/googleads.js.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { get, all, run, tx } from './db.js';
import { slugify, readFile, floorBytes, mimeOf } from './workspace.js';
import { googleAdsFromConfig, planCampaign, createCampaign, campaignId, campaignStats, checkSearchAd, monthStartMs, accountInfo, AdsError, HARD_MAX_USD, LIMITS } from './googleads.js';
import { createMockGoogleAds } from './googleads-mock.js';

const CONFIG = JSON.parse(readFileSync(new URL('../config/business.json', import.meta.url), 'utf8'));
export const loadBusinessConfig = () => CONFIG;
export const NOTE = 'Business mode:';
// A floor has one of these at a time. queued is the old by-hand path's, kept for requests filed before Google was connected.
const LIVE_SPEND = ['awaiting_boss', 'approved', 'running', 'paused', 'queued'];
// Approved this month: what counts against the building's monthly cap.
const COMMITTED = ['approved', 'running', 'paused', 'ended'];

const AD_COLUMNS = {
  tag: "TEXT NOT NULL DEFAULT ''", campaign: "TEXT NOT NULL DEFAULT ''", budget_rn: "TEXT NOT NULL DEFAULT ''", starts_at: 'INTEGER', ends_at: 'INTEGER',
  spent_micros: 'INTEGER NOT NULL DEFAULT 0', impressions: 'INTEGER NOT NULL DEFAULT 0', clicks: 'INTEGER NOT NULL DEFAULT 0', synced_at: 'INTEGER',
  note: "TEXT NOT NULL DEFAULT ''", updated_at: 'INTEGER',
};
/** The building's stop: set by the admin's pause-all or by the watchdog finding a campaign over its amount or the month over the cap. While it
 * is set no new paid campaign starts, whatever ADS_PAID_ENABLED says, until the admin runs "ads resume". */
export const adsStopped = (db) => get(db, 'SELECT reason, at FROM ad_stop WHERE id=1') || null;
export const stopAds = (db, reason, at = Date.now()) => run(db, 'INSERT INTO ad_stop (id, reason, at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET reason=excluded.reason, at=excluded.at', String(reason).slice(0, 300), at);
export const resumeAds = (db) => run(db, 'DELETE FROM ad_stop WHERE id=1').changes > 0;
/** The ad requests table, with its Google columns. The watchdog and the admin script open it too. */
export function ensureAdSpend(db) {
  db.exec(SCHEMA);
  db.exec('CREATE TABLE IF NOT EXISTS ad_stop (id INTEGER PRIMARY KEY CHECK (id = 1), reason TEXT NOT NULL, at INTEGER NOT NULL)');
  const have = new Set(all(db, 'PRAGMA table_info(ad_spend)').map((c) => c.name));
  for (const [name, def] of Object.entries(AD_COLUMNS)) if (!have.has(name)) db.exec(`ALTER TABLE ad_spend ADD COLUMN ${name} ${def}`);
  db.exec(`DROP INDEX IF EXISTS ad_spend_one_live; CREATE UNIQUE INDEX IF NOT EXISTS ad_spend_live ON ad_spend(floor_id) WHERE status IN (${LIVE_SPEND.map((s) => `'${s}'`).join(',')});`);
}
/** What counts against the monthly cap: every campaign approved, running or made on Google this month (whatever became of its request), at its
 * approved amount or its real cost if that is higher. */
export function committedUsd(db, { now = Date.now(), timeZone = 'America/New_York', except = 0 } = {}) {
  const since = monthStartMs(now, timeZone);
  const rows = all(db, `SELECT amount, spent_micros FROM ad_spend WHERE id != ? AND (status IN (${COMMITTED.map(() => '?').join(',')}) OR campaign != '') AND (decided_at >= ? OR COALESCE(ends_at, 0) >= ?)`, except, ...COMMITTED, since, since);
  return rows.reduce((n, r) => n + Math.max(Number(r.amount) || 0, (Number(r.spent_micros) || 0) / 1e6), 0);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS business_journeys (
  floor_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', step TEXT NOT NULL DEFAULT 'idea', wish TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '', ideas TEXT NOT NULL DEFAULT '[]', research TEXT NOT NULL DEFAULT '{}', picked INTEGER NOT NULL DEFAULT -1,
  tasks TEXT NOT NULL DEFAULT '{}', ads TEXT NOT NULL DEFAULT '{}', ad_money INTEGER NOT NULL DEFAULT 0, money_set INTEGER NOT NULL DEFAULT 0,
  ads_skipped INTEGER NOT NULL DEFAULT 0, rounds INTEGER NOT NULL DEFAULT 0, noted TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0, launched_at INTEGER
);
CREATE TABLE IF NOT EXISTS ad_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, project TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL, ads TEXT NOT NULL DEFAULT '[]',
  audience TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'awaiting_boss', purchase_id INTEGER, created_at INTEGER NOT NULL, decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS ad_spend_floor ON ad_spend(floor_id, id);
`;

export class BusinessError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

const plain = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const isUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; } };
export const urlKey = (u) => String(u).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/+$/, '');
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// ---- honesty ----
// A figure is a sum of money, a percentage, a multiple, or any number of two digits or more: a count, a size, a year. Each one has to come from a source.
const NUMBER = /([$€£¥]\s?)?(\d(?:[\d,]*\d)?(?:\.\d+)?)(\s?(?:%|percent\b|k\b|m\b|bn\b|million\b|billion\b|thousand\b|x\b))?/gi;
const numbersIn = (text) => [...String(text ?? '').matchAll(NUMBER)].map(([whole, cur, num, unit]) => ({ text: whole.trim(), digits: num.replace(/,/g, ''), figure: !!(cur || unit) || num.replace(/\D/g, '').length >= 2 }));
export const figuresIn = (text) => numbersIn(text).filter((n) => n.figure).map(({ text: t, digits }) => ({ text: t, digits }));
/** Figures in some words that none of the backing text carries, number for number. */
export function unbacked(text, backing) {
  const have = new Set(numbersIn(backing).map((n) => n.digits));
  return figuresIn(text).filter((f) => !have.has(f.digits));
}

/** The researcher's idea cards, checked. unseen(urls) gives back the keys of links nobody on this floor has opened or found in a search. */
export function checkIdeas(input, { cfg = CONFIG, unseen = () => new Set() } = {}) {
  const problems = [];
  const { min, max, evidenceMin, evidenceMax } = cfg.ideas;
  const list = Array.isArray(input?.ideas) ? input.ideas : [];
  if (list.length < min || list.length > max) problems.push(`give ${min === max - 1 ? `${min} or ${max}` : `${min} to ${max}`} ideas, not ${list.length}`);
  const links = [];
  const ideas = list.slice(0, max).map((raw, i) => {
    const n = `idea ${i + 1}`;
    const card = { name: plain(raw?.name, 60), whoPays: plain(raw?.who_pays, 200), problem: plain(raw?.problem, 300), sell: plain(raw?.what_you_sell, 300), whyNow: plain(raw?.why_now, 300), evidence: [], revenue: null };
    for (const [k, label] of [['name', 'name'], ['whoPays', 'who_pays'], ['problem', 'problem'], ['sell', 'what_you_sell'], ['whyNow', 'why_now']]) if (card[k].length < 3) problems.push(`${n}: ${label} is missing`);
    const ev = Array.isArray(raw?.evidence) ? raw.evidence : [];
    card.evidence = ev.slice(0, evidenceMax + 1).map((e) => ({ url: String(e?.url ?? '').trim().slice(0, 1000), title: plain(e?.title, 160), shows: plain(e?.shows, 240) }));
    if (card.evidence.some((e) => !isUrl(e.url))) problems.push(`${n}: every evidence link must be a full http(s) address`);
    const keys = new Set(card.evidence.filter((e) => isUrl(e.url)).map((e) => urlKey(e.url)));
    if (keys.size < evidenceMin || card.evidence.length > evidenceMax) problems.push(`${n}: give ${evidenceMin} to ${evidenceMax} different evidence links`);
    if (card.evidence.some((e) => e.shows.length < 3)) problems.push(`${n}: say in a few words what each link shows`);
    links.push(...card.evidence.filter((e) => isUrl(e.url)).map((e) => ({ n, url: e.url })));
    const r = raw?.revenue;
    if (r !== undefined && r !== null && r !== '') {
      const low = Number(r.low), high = Number(r.high);
      const assumptions = (Array.isArray(r.assumptions) ? r.assumptions : []).slice(0, 5).map((a) => ({ text: plain(a?.text, 240), source: String(a?.source_url ?? '').trim().slice(0, 1000) }));
      if (!(Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high >= low)) problems.push(`${n}: a revenue range needs a low and a high figure, low first, or leave it out`);
      else if (!assumptions.length) problems.push(`${n}: a revenue range needs its assumptions stated, each with a source link, or leave the range out`);
      else if (assumptions.some((a) => a.text.length < 5 || !isUrl(a.source))) problems.push(`${n}: every revenue assumption needs its words and a source link`);
      else {
        card.revenue = { low: Math.round(low), high: Math.round(high), per: r.per === 'year' ? 'year' : 'month', assumptions };
        links.push(...assumptions.map((a) => ({ n, url: a.source })));
      }
    }
    // Every figure on the card is quoted from one of its own links, or from a stated, sourced assumption.
    const backing = [...card.evidence.map((e) => `${e.title} ${e.shows}`), ...(card.revenue?.assumptions || []).map((a) => a.text)].join(' ');
    for (const f of unbacked([card.name, card.whoPays, card.problem, card.sell, card.whyNow].join(' • '), backing)) problems.push(`${n}: "${f.text}" is not backed by a source. Quote it in what one of your links shows, or take it out`);
    return card;
  });
  const markets = (Array.isArray(input?.markets_checked) ? input.markets_checked : []).map((m) => plain(m, 120)).filter(Boolean).slice(0, 6);
  const compared = (Array.isArray(input?.compared) ? input.compared : []).map((c) => ({ idea: plain(c?.idea, 60), verdict: plain(c?.verdict, 200) })).filter((c) => c.idea && c.verdict).slice(0, 8);
  if (!markets.length) problems.push('list the markets you checked in markets_checked');
  if (compared.length < 2) problems.push('say how the ideas compared in compared, including any you dropped and why');
  const left = links.length ? unseen(links.map((l) => l.url)) : new Set();
  for (const l of links) if (left.has(urlKey(l.url))) problems.push(`${l.n}: nobody here opened or found "${l.url.slice(0, 120)}". Open it with fetch_url, or use a page you did open`);
  return { ok: !problems.length, problems: [...new Set(problems)].slice(0, 12), ideas, research: { markets, compared } };
}

/** An ad spend request, checked against the boss's own choice and the building's rules. Says nothing about the rules themselves. */
export function checkAdSpend({ amount, chosen, live = false, cfg = CONFIG }) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return 'an ad spend request needs the amount the boss chose. With no ad money, the ads go up on the floor for free and there is nothing to request';
  if (a > cfg.adMaxUsd || !cfg.adMoney.includes(a) || a !== Number(chosen)) return 'the amount has to be exactly what the boss chose for ads. Nothing was filed';
  if (live) return 'this floor already has a campaign going. One at a time: nothing was filed';
  return null;
}
export const moneyOk = (amount, cfg = CONFIG) => Number.isInteger(amount) && cfg.adMoney.includes(amount) && amount <= Math.min(cfg.adMaxUsd, HARD_MAX_USD);

// ---- the journey's shape ----
const stepIndex = (id) => CONFIG.steps.findIndex((s) => s.id === id);
const TASK_ITEMS = CONFIG.tracks.flatMap((t) => t.items.filter((i) => i.task));

export function installBusiness(ext) {
  const { db, cfg, engine, log, now, hooks, GET, POST, json, send, readJson, limit, requireOwner, floorBySlug, viewerFor, HttpError, BASE } = ext;
  ensureAdSpend(db);
  const on = cfg.businessMode !== false;
  let timer = null, stopped = false;
  // Google Ads: the real API with this server's credentials, a mock in tests (cfg.adsMock, never from the environment), or nothing.
  const adsMock = cfg.adsMock ? createMockGoogleAds({ now, timeZone: cfg.googleAds?.timeZone }) : null;
  const gads = googleAdsFromConfig(cfg, { mock: adsMock });
  const tz = gads?.timeZone || cfg.googleAds?.timeZone || 'America/New_York';
  const paidOn = () => !!(cfg.adsPaidEnabled && gads && !adsStopped(db));
  // The account's currency and time zone, read once an hour: a budget is in the account's currency and Google reads dates in its zone.
  let acct = null;
  const accountOk = async () => {
    if (!acct || now() - acct.at > 3600000) acct = { ...(await accountInfo(gads)), at: now() };
    if (acct.currency !== 'USD') return `the Google Ads account is in ${acct.currency || 'an unknown currency'}, not US dollars`;
    if (acct.timeZone && acct.timeZone !== tz) return `the Google Ads account's time zone is ${acct.timeZone}, not ${tz}`;
    return '';
  };
  const moneyOptions = () => (paidOn() ? CONFIG.adMoney.filter((n) => n <= Math.min(CONFIG.adMaxUsd, HARD_MAX_USD)) : [0]);
  const roomFor = (amount, except = 0) => committedUsd(db, { now: now(), timeZone: tz, except }) + Number(amount) <= cfg.adMonthlyCapUsd;
  const dayText = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms));
  const PAID_OFF = 'Paid ads aren’t switched on yet. Launch for free and the ads still go up on the floor to share.';
  const NO_ROOM = 'The building can’t take another paid campaign this month. Launch for free and the ads still go up on the floor to share.';
  const seen = new Map();  // floorId -> what the floor last saw of the journey, so a change is announced once

  const rowOf = (floorId) => get(db, 'SELECT * FROM business_journeys WHERE floor_id=?', floorId);
  const activeRow = (floorId) => { const r = rowOf(floorId); return r && r.status === 'active' ? r : null; };
  const patch = (floorId, fields) => {
    const keys = Object.keys(fields);
    run(db, `UPDATE business_journeys SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE floor_id=?`, ...keys.map((k) => fields[k]), now(), floorId);
  };
  const tasksOf = (row) => parse(row.tasks, {});
  const adsOf = (row) => parse(row.ads, {});
  const manager = (floorId) => get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floorId);
  const has = (floorId, role) => !!get(db, 'SELECT 1 x FROM agents WHERE floor_id=? AND role=?', floorId, role);
  const changed = (floorId) => engine.emit(floorId, 'business', {}, { persist: false });
  /** In the manager's own reading as an office note, never as the boss's words. Each key is said once. */
  function tellManager(floor, key, text) {
    if (key && activeRow(floor.id)?.noted === key) return;
    if (key) patch(floor.id, { noted: key });
    engine.addMessage(floor.id, 'note', null, `${NOTE} ${text}`);
    run(db, 'UPDATE floors SET manager_wake=1 WHERE id=?', floor.id);
    engine.kick();
  }
  function give(floor, key, { to, title, brief, project, after = [], lane = '' }, plan) {
    const r = engine.assignTask(floor, manager(floor.id), { to, title, brief, plan, project, dependsOn: after, lane });
    return r.id;
  }
  const taskRow = (id) => (id ? get(db, 'SELECT id,status,agent_id,title FROM tasks WHERE id=?', id) : null);
  const finished = (t) => !t || ['done', 'review', 'failed', 'cancelled'].includes(t.status);
  const project = (floorId, slug) => (slug ? get(db, 'SELECT * FROM projects WHERE floor_id=? AND slug=?', floorId, slug) : null);
  const formsOn = () => !!cfg.appsBaseDomain;

  // ---- step 1: ideas ----
  function ideasBrief(row, wish, again) {
    const last = parse(row?.ideas, []).map((i) => i.name).filter(Boolean);
    return [`Business mode, step 1 of 4: find ${CONFIG.ideas.min === 2 && CONFIG.ideas.max === 3 ? '2 or 3' : `${CONFIG.ideas.min} to ${CONFIG.ideas.max}`} small business ideas this boss could really start now, from real research.`,
      wish ? `What the boss said they want: "${plain(wish, 300)}".` : 'The boss left it open: pick ideas a small team with a website could start this month.',
      again && last.length ? `The boss wants different ideas from these: ${last.join(', ')}.` : '',
      'Use web_search (at most three searches), then open the pages that matter with fetch_url. Check real markets: who pays today, what they pay for, who already sells it.',
      'Each card: the name, who pays, the problem they have, what you would sell, why now, and 2 to 4 links to pages you opened or found in a search, each with a few words on what it shows.',
      'Only give a revenue range if you can state every assumption with a source link; otherwise leave it out. Any number you write on a card must be quoted from one of its links in what that link shows. No invented figures.',
      'Then call propose_ideas with the cards, the markets you checked, and how the ideas compared, including any you dropped and why. Do not publish anything. Your reply can be one line: the boss reads the cards.'].filter(Boolean).join(' ');
  }
  function assignIdeas(floor, row, { wish = '', again = false } = {}) {
    if (!has(floor.id, 'researcher')) engine.hireStaff(floor, 'researcher');
    const id = give(floor, 'ideas', { to: 'researcher', title: again ? 'Find other business ideas' : 'Find business ideas', brief: ideasBrief(row, wish, again), project: '' }, 'Business mode: ideas');
    patch(floor.id, { tasks: JSON.stringify({ ...tasksOf(activeRow(floor.id)), ideas: id }), rounds: (activeRow(floor.id).rounds || 0) + 1 });
    return id;
  }
  function start(floor, { wish = '', by = 'boss' } = {}) {
    if (!on) throw new BusinessError(404, 'off', 'Business mode is not switched on in this building.');
    if (floor.status !== 'active') throw new BusinessError(423, 'closed', 'This floor is closed.');
    const was = rowOf(floor.id);
    if (was?.status === 'active') return { already: true };
    const t = now();
    run(db, 'INSERT OR REPLACE INTO business_journeys (floor_id,status,step,wish,started_at,updated_at) VALUES (?,?,?,?,?,?)', floor.id, 'active', 'idea', plain(wish, 300), t, t);
    try { assignIdeas(floor, rowOf(floor.id), { wish }); } catch (e) {
      run(db, 'DELETE FROM business_journeys WHERE floor_id=?', floor.id);
      throw new BusinessError(409, 'busy', `The team can't start that right now: ${String(e.message).slice(0, 160)}`);
    }
    if (by === 'boss') tellManager(floor, 'idea.researching', `the boss tapped Start a business, so Business mode is on: Idea, Build, Customers, Launch, shown as a header on the floor. Your researcher is already looking for ${CONFIG.ideas.min} to ${CONFIG.ideas.max} ideas with real web research; the cards appear on the floor and the boss taps one to pick it. In two or three short lines, tell the boss what happens now and that they can ask you anything at any point. Assign nothing yourself for this step. Tap-to-send suggestions appear under your message, so don't list options.`);
    log('info', 'business started', { floorId: floor.id, by });
    changed(floor.id);
    return { started: true };
  }
  function proposeIdeas(c, a, { unseen }) {
    const row = activeRow(c.floor.id);
    if (!row || row.step !== 'idea' || tasksOf(row).ideas !== c.task?.id) throw new BusinessError(409, 'not_now', 'propose_ideas is only for the Business mode idea task');
    const r = checkIdeas(a, { unseen });
    if (!r.ok) throw new BusinessError(400, 'bad_ideas', `nothing was saved. Fix these and call propose_ideas again: ${r.problems.join('; ')}`);
    const old = parse(row.research, {});
    patch(c.floor.id, { ideas: JSON.stringify(r.ideas.map((x, i) => ({ ...x, id: i }))), research: JSON.stringify({ ...old, ...r.research }), picked: -1 });
    c.say('typing', 'Pinning up idea cards', `pinned up ${r.ideas.length} business ideas for the boss`);
    tellManager(c.floor, `idea.pick.${row.rounds}`, `the researcher's ${r.ideas.length} idea cards are on the floor: ${r.ideas.map((x, i) => `${i + 1}. ${x.name} (${x.whoPays})`).join('; ')}. In two or three lines, say which you'd pick and why, from the cards' own evidence. The boss taps a card to pick it, or asks for other ideas. Don't repeat the cards.`);
    changed(c.floor.id);
    return `Saved ${r.ideas.length} idea cards. The boss sees them now, with your links. You're done: reply with one line.`;
  }

  // ---- step 2: build ----
  function uniqueSlug(floorId, base) {
    let slug = slugify(base, 'business').slice(0, 30).replace(/-+$/, '') || 'business';
    for (let i = 2; get(db, 'SELECT 1 x FROM projects WHERE floor_id=? AND slug=?', floorId, slug); i++) slug = `${slugify(base, 'business').slice(0, 26).replace(/-+$/, '')}-${i}`;
    return slug;
  }
  function buildBriefs(floor, idea, slug) {
    const about = `"${idea.name}": ${idea.sell}, for ${idea.whoPays}. Their problem: ${idea.problem}. Why now: ${idea.whyNow}. Evidence: ${idea.evidence.map((e) => e.url).join(' ')}`;
    return {
      look: `Business mode, Build, Website track. The boss picked ${about}. Pick the look for its landing page: write projects/${slug}/style.css and projects/${slug}/notes/look.md (palette, type, and one idea only this business could have). Don't publish.`,
      offer: `Business mode, Build, Product track. The boss picked ${about}. Write projects/${slug}/notes/offer.md: what we sell in the first version, who it is for, the one promise, three short points, a price clearly marked as planned (use notes/prices.md if it is there), a short FAQ, and the notify-me line. No testimonials, customer counts, launch dates or discounts nobody agreed. Don't publish.`,
      prices: `Business mode, Build, Product track. The boss picked ${about}. Find what three named rivals charge for something like it, with a link to each price on their own page, and write projects/${slug}/notes/prices.md. Mark anything you couldn't confirm. Don't publish.`,
      site: `Business mode, Build, Website track. Build the landing page for ${about}. Use projects/${slug}/notes/offer.md, notes/prices.md, notes/look.md and style.css from your teammates. There is no Stripe here, so there is no Buy button: ${formsOn() ? 'add a notify-me sign-up with Office.submitForm(\'waitlist\', ...) instead, saying plainly it isn\'t open yet' : 'sign-up forms are off in this building, so say plainly on the page that it isn\'t open yet and how people can find out more'}. The boss watches a live preview while you save. Run the checklist, fix what it finds, then publish project ${slug}.`,
    };
  }
  function pick(floor, index, { by = 'boss' } = {}) {
    const row = activeRow(floor.id);
    if (!row) throw new BusinessError(409, 'not_started', 'Business mode is not on for this floor.');
    if (row.step !== 'idea') throw new BusinessError(409, 'picked', 'An idea is already picked.');
    const ideas = parse(row.ideas, []);
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= ideas.length) throw new BusinessError(400, 'bad_idea', 'Pick one of the idea cards.');
    const idea = ideas[i];
    const slug = uniqueSlug(floor.id, idea.name);
    const briefs = buildBriefs(floor, idea, slug);
    const plan = `Business mode: build ${idea.name}`;
    const ids = { ...tasksOf(row) };
    try {
      tx(db, () => {
        for (const it of TASK_ITEMS.filter((x) => x.task !== 'site')) ids[it.task] = give(floor, it.task, { to: it.role, title: it.title, brief: briefs[it.task], project: slug }, plan);
        const site = TASK_ITEMS.find((x) => x.task === 'site');
        ids.site = give(floor, 'site', { to: site.role, title: site.title, brief: briefs.site, project: slug, after: (site.after || []).map((k) => ids[k]).filter(Boolean), lane: 'business' }, plan);
        patch(floor.id, { step: 'build', picked: i, project: slug, tasks: JSON.stringify(ids) });
      });
    } catch (e) { throw new BusinessError(409, 'busy', `The team can't start the build right now: ${String(e.message).slice(0, 160)}`); }
    engine.upsertProject(floor, slug, { title: idea.name, description: idea.sell.slice(0, 200) });
    const guide = `the boss picked "${idea.name}". The build has started in four tracks: Website (look, then the page, then live), Product (the offer and rival prices), Payments (no Stripe here, so a notify-me sign-up instead, and say so honestly), Analytics (the visitor counter and the launch checklist). Project slug: ${slug}. ${floor.name ? '' : 'The company has no name yet: call set_company with a name, tagline and what it does that fit this idea. '}${engine.domains?.enabled ? 'Once the page is live, offer the boss 2 or 3 short .com names you checked with check_domain; only their Buy click buys one. ' : ''}In two or three lines, tell the boss what the team is doing now. The tasks are already assigned, so assign nothing more unless the boss asks.`;
    if (by === 'boss') { tellManager(floor, 'build', guide); engine.bossMessage(floor, `Let's go with ${idea.name}.`); }
    changed(floor.id);
    return { project: slug, guide };
  }
  /** Each track's items, read from the tasks and the floor's own records. A check is something the office knows for itself. */
  function trackView(floor, row) {
    const ids = tasksOf(row); const slug = row.project; const pr = project(floor.id, slug);
    const live = !!pr?.published_at;
    const checkOf = (name) => {
      if (name === 'published') return live ? 'done' : 'waiting';
      if (name === 'domain') {
        if (!engine.domains?.enabled) return 'off';
        const d = engine.domains.forFloor(floor.id).filter((x) => x.project === slug);
        if (d.some((x) => ['bought', 'live'].includes(x.status))) return 'done';
        if (d.some((x) => x.status === 'awaiting_boss')) return 'yours';
        if (d.some((x) => ['buying', 'sent', 'uncertain'].includes(x.status))) return 'working';
        return 'waiting';
      }
      if (name === 'signup') {
        if (!live) return 'waiting';
        if (!formsOn()) return 'done';
        const files = all(db, "SELECT content FROM published_files WHERE floor_id=? AND project=? AND (path LIKE '%.html' OR path LIKE '%.js')", floor.id, slug);
        return files.some((f) => typeof f.content === 'string' ? f.content.includes('Office.submitForm') : Buffer.from(f.content).includes('Office.submitForm')) ? 'done' : 'attention';
      }
      if (name === 'counter') return live && !pr.private ? 'done' : 'waiting';
      if (name === 'checklist') {
        const c = parse(pr?.launch_check || 'null', null);
        if (!c) return 'waiting';
        return (c.errors?.length || 0) + (c.claims?.length || 0) === 0 ? 'done' : 'attention';
      }
      if (name === 'visit') return live && get(db, 'SELECT COALESCE(SUM(views),0) n FROM app_visits WHERE floor_id=? AND project=?', floor.id, slug).n > 0 ? 'done' : 'waiting';
      return 'waiting';
    };
    const taskState = (t) => (!t ? 'waiting' : t.status === 'done' ? 'done' : t.status === 'review' ? 'checking' : t.status === 'doing' ? 'working' : t.status === 'blocked' ? 'yours' : t.status === 'failed' ? 'attention' : t.status === 'cancelled' ? 'skipped' : 'waiting');
    return CONFIG.tracks.map((tr) => {
      const items = tr.items.map((it) => {
        const t = it.task ? taskRow(ids[it.task]) : null;
        const state = it.task ? taskState(t) : checkOf(it.check);
        return { label: it.label, state, optional: !!it.optional, ...(t ? { taskId: t.id } : {}) };
      }).filter((x) => x.state !== 'off');
      const needed = items.filter((x) => !x.optional);
      const done = needed.filter((x) => x.state === 'done' || x.state === 'checking' || x.state === 'skipped').length;
      const lamp = done === needed.length ? 'done' : items.some((x) => x.state === 'attention' || x.state === 'yours') ? 'attention' : items.some((x) => x.state === 'working' || x.state === 'checking') ? 'working' : 'off';
      return { id: tr.id, label: tr.label, note: tr.id === 'payments' && !formsOn() ? 'No card payments yet: there is no Stripe here, and sign-up forms are off in this building, so the page says plainly that it isn\'t open yet.' : tr.note || '', lamp, done, total: needed.length, items };
    });
  }

  // ---- step 3: customers ----
  function adsBriefs(floor, row, idea, notes = '') {
    const slug = row.project; const url = engine.liveUrl(floor, slug);
    const extra = notes ? ` What the boss asked for this time: "${plain(notes, 300)}".` : '';
    return {
      pictures: `Business mode, Customers. Make ${CONFIG.ads.pictures} picture ads for "${idea.name}" (${idea.sell}, for ${idea.whoPays}; live at ${url}) with generate_image in project ${slug}, directory ads: name one ad-1 (aspect 1:1, for the feed) and one ad-2 (aspect 9:16, for stories). Each an illustration, never a photo pretending to be real; any words in the picture short and spelled out in your prompt. No prices, customer counts or claims.${extra} Don't publish.`,
      ads: `Business mode, Customers. Plan the ads for "${idea.name}" (${idea.sell}, for ${idea.whoPays}; live at ${url}; the offer is in projects/${slug}/notes/offer.md). Paid ads run as a Google search ad (Facebook and Instagram come later); the picture and video ads are for sharing. First call save_ad_plan with the headline and the primary text (for sharing), the goal, who it is for, an A-versus-B test (two headlines), and the Google search ad: ${LIMITS.headlines[0]} to ${LIMITS.headlines[1]} search_headlines of ${LIMITS.headline} characters or fewer with no exclamation marks, ${LIMITS.descriptions[0]} to ${LIMITS.descriptions[1]} search_descriptions of ${LIMITS.description} characters or fewer, and ${LIMITS.keywords[0]} to ${LIMITS.keywords[1]} keywords, the short phrases someone types into Google when they want this. Then make ${CONFIG.ads.videos} short vertical video ads with make_video_ad in project ${slug}: ${CONFIG.video.minSeconds} to ${CONFIG.video.maxSeconds} seconds each, one caption line each, named video-1 and video-2, showing the idea rather than any real person or place. Nothing invented: no customer numbers, testimonials or prices that aren't marked as planned in the offer.${extra} Don't publish.`,
    };
  }
  function startCustomers(floor, row, { notes = '' } = {}) {
    const idea = parse(row.ideas, [])[row.picked];
    if (!idea) return;
    let writer = 'marketer';
    if (!has(floor.id, 'marketer')) { try { engine.hireStaff(floor, 'marketer'); } catch { writer = 'writer'; } }
    const briefs = adsBriefs(floor, row, idea, notes);
    const ids = { ...tasksOf(row) };
    const plan = `Business mode: find customers for ${idea.name}`;
    ids.pictures = give(floor, 'pictures', { to: has(floor.id, 'designer') ? 'designer' : writer, title: 'Make the picture ads', brief: briefs.pictures, project: row.project }, plan);
    ids.ads = give(floor, 'ads', { to: writer, title: 'Write the ads and make the videos', brief: briefs.ads, project: row.project }, plan);
    delete ids.fallback;
    const ads = notes ? { ...adsOf(row), plan: null, videoFailed: '' } : {};
    patch(floor.id, { step: 'customers', tasks: JSON.stringify(ids), ads: JSON.stringify(ads), money_set: 0 });
    tellManager(floor, `customers.${ids.ads}`, `${notes ? 'the boss wants the ads changed, and the team is remaking them.' : `the build is done: "${idea.name}" is live at ${engine.liveUrl(floor, row.project)}.`} Step 3 of 4, Customers: the team is making ${CONFIG.ads.pictures} picture ads, ${CONFIG.ads.videos} short vertical video ads with captions, the ad words and a campaign plan. When they're ready the boss chooses the ad money on the floor: nothing ("just for fun", the default) or a small amount they pick. In two or three lines, tell the boss what's happening.`);
    changed(floor.id);
  }
  function adFiles(floorId, slug) {
    if (!slug) return { pictures: [], videos: [] };
    const rows = all(db, 'SELECT path,size,updated_at FROM files WHERE floor_id=? AND path LIKE ? ORDER BY path', floorId, `projects/${slug}/ads/%`);
    const name = (p) => p.slice(`projects/${slug}/ads/`.length);
    return {
      pictures: rows.filter((r) => /\.(png|jpe?g|webp)$/i.test(r.path)).map((r) => ({ name: name(r.path), at: r.updated_at })),
      videos: rows.filter((r) => /\.(mp4|webm)$/i.test(r.path)).map((r) => ({ name: name(r.path), at: r.updated_at, captions: rows.some((x) => x.path === r.path.replace(/\.(mp4|webm)$/i, '.vtt')) ? name(r.path).replace(/\.(mp4|webm)$/i, '.vtt') : '' })),
    };
  }
  function adsReady(row) {
    const ids = tasksOf(row);
    return !!adsOf(row).plan && finished(taskRow(ids.pictures)) && finished(taskRow(ids.ads)) && finished(taskRow(ids.fallback));
  }
  function saveAdPlan(c, a) {
    const row = activeRow(c.floor.id);
    if (!row || row.step !== 'customers' || tasksOf(row).ads !== c.task?.id) throw new BusinessError(409, 'not_now', 'save_ad_plan is only for the Business mode ads task');
    const t = (k, max, min = 3) => { const v = plain(a?.[k], max); if (v.length < min) throw new BusinessError(400, 'missing', `${k} is required`); return v; };
    // Paid ads run on Google Search, so that is where the plan says; the picture and video ads are made for sharing either way.
    const plan = {
      headline: t('headline', 60), primaryText: t('primary_text', 200), goal: t('goal', 160), who: t('who', 200), where: ['Google Search'],
      test: { a: plain(a?.test_a, 120), b: plain(a?.test_b, 120), measure: plain(a?.test_measure, 120) || 'whichever gets more sign-ups per click' },
    };
    if (!plan.test.a || !plan.test.b) throw new BusinessError(400, 'test', 'the A-versus-B test needs both test_a and test_b');
    const search = checkSearchAd({ headlines: a?.search_headlines, descriptions: a?.search_descriptions, keywords: a?.keywords, path1: a?.path1, path2: a?.path2 });
    if (!search.ok) throw new BusinessError(400, 'search_ad', `nothing was saved: ${search.problems.join('; ')}`);
    plan.search = { headlines: search.headlines, descriptions: search.descriptions, keywords: search.keywords, path1: search.path1, path2: search.path2 };
    // The ad's words promise nothing the offer doesn't: a figure in them is one the offer or the rival prices already carry.
    const notes = ['offer.md', 'prices.md'].map((f) => readFile(db, c.floor.id, `projects/${row.project}/notes/${f}`)?.content).filter((x) => typeof x === 'string').join(' ');
    const loose = unbacked([plan.headline, plan.primaryText, plan.test.a, plan.test.b, ...search.headlines, ...search.descriptions].join(' • '), notes);
    if (loose.length) throw new BusinessError(400, 'figures', `nothing was saved: ${loose.slice(0, 4).map((f) => `"${f.text}"`).join(', ')} ${loose.length === 1 ? 'is' : 'are'} not in the offer. Take ${loose.length === 1 ? 'it' : 'them'} out of the ad words`);
    patch(c.floor.id, { ads: JSON.stringify({ ...adsOf(row), plan }) });
    c.say('typing', 'Planning the campaign', 'wrote the ad words and the campaign plan', { project: row.project });
    changed(c.floor.id);
    return `Saved the ad words and the plan. ${engine.media ? `Now make the ${CONFIG.ads.videos} video ads with make_video_ad.` : 'Video making is not switched on here, so say so in your reply.'}`;
  }
  /** Where a video ad goes, checked before any money is spent on it. */
  function videoTarget(c, a) {
    const row = activeRow(c.floor.id);
    if (!row || row.step !== 'customers' || tasksOf(row).ads !== c.task?.id) throw new BusinessError(409, 'not_now', 'make_video_ad is only for the Business mode ads task');
    const name = String(a?.name ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || `video-${adFiles(c.floor.id, row.project).videos.length + 1}`;
    const seconds = Math.round(Number(a?.seconds ?? CONFIG.video.defaultSeconds));
    if (!(seconds >= CONFIG.video.minSeconds && seconds <= CONFIG.video.maxSeconds)) throw new BusinessError(400, 'seconds', `seconds is ${CONFIG.video.minSeconds} to ${CONFIG.video.maxSeconds}`);
    const caption = plain(a?.caption, 110);
    if (caption.length < 3) throw new BusinessError(400, 'caption', 'caption is required: the one line people read with the sound off');
    const loose = unbacked(caption, ['offer.md', 'prices.md'].map((f) => readFile(db, c.floor.id, `projects/${row.project}/notes/${f}`)?.content).filter((x) => typeof x === 'string').join(' '));
    if (loose.length) throw new BusinessError(400, 'figures', `${loose.map((f) => `"${f.text}"`).join(', ')} is not in the offer. Take it out of the caption`);
    c.videosMade = c.videosMade || 0;
    if (c.videosMade >= CONFIG.video.perTask) throw new BusinessError(429, 'enough', `that is ${CONFIG.video.perTask} videos for this task`);
    const today = get(db, "SELECT COUNT(*) n FROM ledger WHERE floor_id=? AND kind='video' AND created_at>=?", c.floor.id, now() - 86400000)?.n ?? 0;
    if (today >= CONFIG.video.perFloorDay) throw new BusinessError(429, 'enough', 'this floor has made its videos for today');
    return { project: row.project, name, seconds, caption, prompt: plain(a?.prompt, 1200) };
  }
  function videoSaved(c, v) {
    c.videosMade = (c.videosMade || 0) + 1;
    c.say('typing', `Cutting ${v.name}`, `made a video ad: ${v.name}`, { project: v.project });
    changed(c.floor.id);
  }
  /** The AI video didn't come. The fallback is the real site, recorded on the Builder's computer, with the caption burnt in. */
  function videoFailed(c, v, why) {
    const row = activeRow(c.floor.id);
    if (!row) return 'Carry on without it.';
    const ids = tasksOf(row);
    patch(c.floor.id, { ads: JSON.stringify({ ...adsOf(row), videoFailed: plain(why, 160) }) });
    if (ids.fallback) return 'The Builder is already recording the site for the video ads. Carry on with the rest.';
    if (!engine.computer || !has(c.floor.id, 'builder')) { changed(c.floor.id); return 'Nobody here can record the site instead, so there are no video ads this time. Say so plainly in your reply and carry on.'; }
    const url = engine.liveUrl(c.floor, row.project);
    try {
      ids.fallback = give(c.floor, 'fallback', { to: 'builder', title: 'Record the site as video ads', project: row.project, brief: `Business mode, Customers: the AI video ads didn't work, so make ${CONFIG.ads.videos} short vertical video ads from the real site instead, on your computer. For each: open ${url} in a headless browser at 720x1280, scroll slowly through the page for ${CONFIG.video.minSeconds} to ${CONFIG.video.maxSeconds} seconds while recording (Playwright's recordVideo), then use ffmpeg (npm ffmpeg-static if it isn't installed) to make an H.264 mp4 with this caption burnt in near the bottom: "${v.caption}" for video-1, and a second line of your own from the offer for video-2. Save them as ads/video-1.mp4 and ads/video-2.mp4 in the project and save your work. Don't publish.` }, `Business mode: video ads for ${row.project}`);
      patch(c.floor.id, { tasks: JSON.stringify(ids) });
    } catch (e) { return `Nobody can record the site instead right now (${String(e.message).slice(0, 80)}). Carry on without video ads and say so.`; }
    changed(c.floor.id);
    return 'The Builder is recording the real site as the video ads instead, with your caption. Carry on with the rest.';
  }

  // ---- step 4: launch ----
  /** The ads go up with the live site, so each has a link anyone can open. Built from the drive each time, so a later publish that dropped them is put right. */
  function publishAds(floor, row) {
    const slug = row.project;
    if (!slug || !project(floor.id, slug)?.published_at || row.ads_skipped) return 0;
    const files = all(db, 'SELECT path,content,size FROM files WHERE floor_id=? AND path LIKE ?', floor.id, `projects/${slug}/ads/%`).filter((f) => /\.(png|jpe?g|webp|mp4|webm|vtt)$/i.test(f.path));
    let n = 0;
    tx(db, () => {
      for (const f of files) {
        const rel = f.path.slice(`projects/${slug}/`.length);
        const had = get(db, 'SELECT size FROM published_files WHERE floor_id=? AND project=? AND path=?', floor.id, slug, rel);
        if (had && had.size === f.size) continue;
        if (floorBytes(db, floor.id) - (had?.size || 0) + f.size > cfg.quotaBytes) continue;
        run(db, 'INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?,?,?,?,?) ON CONFLICT(floor_id,project,path) DO UPDATE SET content=excluded.content,size=excluded.size', floor.id, slug, rel, f.content, f.size);
        n++;
      }
    });
    return n;
  }
  function launch(floor, amount, { skip = false, by = 'boss' } = {}) {
    const row = activeRow(floor.id);
    if (!row) throw new BusinessError(409, 'not_started', 'Business mode is not on for this floor.');
    if (stepIndex(row.step) < stepIndex('customers')) throw new BusinessError(409, 'not_yet', 'The ads come after the build.');
    if (row.step === 'launch') throw new BusinessError(409, 'launched', 'This one has already launched.');
    const a = skip ? 0 : Number(amount ?? 0);
    if (!moneyOk(a)) throw new BusinessError(400, 'bad_amount', 'Choose one of the ad amounts shown.');
    if (a > 0 && !paidOn()) throw new BusinessError(400, 'paid_off', PAID_OFF);
    if (!skip && !adsReady(row)) throw new BusinessError(409, 'not_ready', 'The ads are still being made.');
    if (a > 0 && !adsOf(row).plan?.search) throw new BusinessError(409, 'no_search_ad', 'The Google search ad isn’t written yet. Ask your manager to change the ads, or launch for free.');
    if (a > 0 && !roomFor(a)) throw new BusinessError(409, 'no_room', NO_ROOM);
    patch(floor.id, { step: 'launch', ad_money: a, money_set: 1, ads_skipped: skip ? 1 : 0 });
    const n = publishAds(floor, activeRow(floor.id));
    const url = engine.liveUrl(floor, row.project);
    const report = `give the boss the launch report for ${row.project} with launch_report.`;
    const guide = skip ? `the boss skipped ads for now, so it launches without them. Step 4 of 4, Launch: ${report} Then, in a line, say they can make ads any time by asking you.`
      : a === 0 ? `the boss chose no ad money: "just for fun". Step 4 of 4, Launch: the ads are up on the floor${n ? ' and on the live site' : ''} for anyone to share. ${report} Then tell the boss, in a line or two, how to share them and who to send them to first.`
        : `the boss chose ad money for this campaign and it is waiting on their approval. Step 4 of 4, Launch: call request_ad_spend with amount ${a} (exactly that), the audience from the plan, and the ads (the file names in ads/). Then ${report} Tell the boss the request needs their one click on the floor; then it runs as a Google search ad for up to a week, never spends more than they approved, and stops on its own. Don't repeat the amount in chat.`;
    if (by === 'boss') tellManager(floor, 'launch', guide);
    log('info', 'business launch', { floorId: floor.id, paid: a > 0, skip, by });
    changed(floor.id);
    return { step: 'launch', live: url, guide };
  }
  function requestAdSpend(c, a) {
    const row = activeRow(c.floor.id);
    if (!row || row.step !== 'launch') throw new BusinessError(409, 'not_now', 'an ad spend request comes after the boss chooses ad money at launch');
    const live = !!get(db, `SELECT 1 x FROM ad_spend WHERE floor_id=? AND status IN (${LIVE_SPEND.map(() => '?').join(',')})`, c.floor.id, ...LIVE_SPEND);
    const problem = checkAdSpend({ amount: a?.amount, chosen: row.money_set ? row.ad_money : 0, live });
    if (problem) throw new BusinessError(400, 'refused', problem);
    if (!paidOn()) throw new BusinessError(400, 'refused', 'paid ads are switched off in this building right now, so nothing was filed. The ads are up on the floor to share for free');
    if (!roomFor(a.amount)) throw new BusinessError(400, 'refused', 'the building can’t take another paid campaign this month, so nothing was filed. The ads are up on the floor to share for free');
    const files = adFiles(c.floor.id, row.project);
    const known = new Set([...files.pictures, ...files.videos].map((f) => f.name));
    const ads = (Array.isArray(a?.ads) ? a.ads : []).map((x) => String(x).split('/').pop()).filter((x) => known.has(x)).slice(0, 6);
    const audience = plain(a?.audience, 300) || adsOf(row).plan?.who || '';
    if (!audience) throw new BusinessError(400, 'audience', 'say who the ads are for in audience');
    try {
      run(db, 'INSERT INTO ad_spend (floor_id,project,amount,ads,audience,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', c.floor.id, row.project, Number(a.amount), JSON.stringify(ads.length ? ads : [...known].slice(0, 4)), audience, 'awaiting_boss', now(), now());
    } catch { throw new BusinessError(409, 'live', 'this floor already has a campaign going. One at a time: nothing was filed'); }
    c.say('typing', 'Filing the ad request', 'filed an ad spend request for the boss to approve');
    engine.emit(c.floor.id, 'ad_spend', {}, { persist: false, ownerOnly: true });
    changed(c.floor.id);
    return 'Filed. The boss sees it on the floor with an Approve button. Nothing is spent until they click it; then it runs as a Google search ad for up to a week, never over what they approved, and stops on its own.';
  }
  const spendRow = (id) => get(db, 'SELECT * FROM ad_spend WHERE id=?', id);
  /** Closes a request that never reached Google, or that Google turned down, with the reason. Nothing was spent either way. */
  function closeSpend(r, status, note, say) {
    if (!run(db, `UPDATE ad_spend SET status=?, note=?, decided_at=COALESCE(decided_at, ?), updated_at=? WHERE id=? AND status IN ('awaiting_boss','approved')`, status, plain(note, 200), now(), now(), r.id).changes) return;
    const floor = get(db, 'SELECT * FROM floors WHERE id=?', r.floor_id);
    if (floor && say) tellManager(floor, '', say);
    changed(r.floor_id);
  }
  /** The boss's one click. Approving records it, then the campaign is made on Google, paused, and switched on once it is all there. */
  function decideAdSpend(floor, id, answer) {
    const r = get(db, 'SELECT * FROM ad_spend WHERE id=? AND floor_id=?', id, floor.id);
    if (!r) throw new BusinessError(404, 'not_found', 'There is no such ad request.');
    if (r.status !== 'awaiting_boss') throw new BusinessError(409, 'decided', 'That one is already decided.');
    if (answer === 'decline') {
      run(db, "UPDATE ad_spend SET status='declined', decided_at=?, updated_at=? WHERE id=? AND status='awaiting_boss'", now(), now(), id);
      tellManager(floor, '', 'the boss declined the ad spend request. Nothing was spent. Acknowledge it in a line; the ads stay up on the floor to share.');
    } else if (answer === 'approve') {
      if (!paidOn()) closeSpend(r, 'withdrawn', 'Paid ads are switched off right now', 'the boss approved the ad, but paid ads are switched off in this building right now, so nothing was set up and nothing was spent. Say so in a line; the ads stay up on the floor to share.');
      else {
        // The cap is checked and the approval recorded together, so two floors approving at once can't both squeeze under it.
        const ok = tx(db, () => {
          if (!roomFor(r.amount, id)) return false;
          if (!run(db, "UPDATE ad_spend SET status='approved', decided_at=?, tag=?, updated_at=? WHERE id=? AND status='awaiting_boss'", now(), randomBytes(3).toString('hex'), now(), id).changes) throw new BusinessError(409, 'decided', 'That one is already decided.');
          return true;
        });
        if (!ok) closeSpend(r, 'withdrawn', 'No room for another paid campaign in the building this month', 'the boss approved the ad, but the building can’t take another paid campaign this month, so nothing was set up and nothing was spent. Say so in a line, without any amounts; the ads stay up on the floor to share.');
        else {
          tellManager(floor, '', 'the boss approved the ad. It is being set up on Google Search now: made paused, then switched on once it is all in place. It runs for up to a week, never spends more than they approved, and stops on its own. Tell the boss that in a line or two; don\'t repeat the amount.');
          setImmediate(() => { runCampaign(id).catch(() => {}); });
        }
      }
    } else throw new BusinessError(400, 'bad_answer', 'answer is approve or decline');
    changed(floor.id);
    return adSpendView(floor.id);
  }
  /** Makes the approved request's campaign on Google, PAUSED, then switches it on, but only while the boss's approval still stands on record. */
  const settingUp = new Set();
  async function runCampaign(id) {
    if (!gads || settingUp.has(id)) return;
    settingUp.add(id);
    let made = null;
    try {
      const r = spendRow(id);
      if (!r || r.status !== 'approved' || !r.decided_at) return;
      const floor = get(db, 'SELECT * FROM floors WHERE id=?', r.floor_id);
      if (!paidOn() || !floor) return closeSpend(r, 'withdrawn', 'Paid ads were switched off before it started');
      const pr = project(r.floor_id, r.project);
      // The ad points at the live site: its own domain, its app address, or the building's address plus the floor's path.
      const live = pr?.published_at && !pr.private ? engine.liveUrl(floor, r.project) : '';
      let finalUrl = '';
      try { finalUrl = live ? new URL(live, `${cfg.publicOrigin || 'http://localhost'}/`).href : ''; } catch { /* left empty: refused below */ }
      const words = adsOf(rowOf(r.floor_id) || {}).plan?.search || {};
      const wrong = await accountOk();
      if (wrong) return closeSpend(r, 'failed', wrong, `the Google ad couldn't be set up: ${wrong}. Nothing was spent. Tell the boss plainly in a line; the building manager has to fix the account first.`);
      let plan;
      try {
        plan = planCampaign({ requestId: r.id, tag: r.tag, label: `floor ${floor.number ?? floor.id} ${r.project}`, amountUsd: r.amount, days: cfg.adCampaignDays, cpcCeilingUsd: cfg.adCpcCeilingUsd,
          now: now(), timeZone: tz, finalUrl, ...words, geo: CONFIG.google?.geo, language: CONFIG.google?.language });
      } catch (e) {
        return closeSpend(r, 'failed', e.message, `the Google ad couldn't be set up: ${plain(e.message, 200)}. Nothing was spent. Tell the boss plainly in a line; once it's fixed you can file it again with request_ad_spend if they want.`);
      }
      run(db, 'UPDATE ad_spend SET starts_at=?, ends_at=?, updated_at=? WHERE id=?', plan.startsAt, plan.endsAt, now(), id);
      made = await createCampaign(gads, plan);
      run(db, 'UPDATE ad_spend SET campaign=?, budget_rn=?, updated_at=? WHERE id=?', made.campaign, made.budget, now(), id);
      const again = spendRow(id);
      if (again?.status !== 'approved' || !again.decided_at || !paidOn()) {
        if (made.status !== 'PAUSED') await gads.setStatus([made.campaign], 'PAUSED');
        if (again?.status === 'approved') closeSpend(again, 'withdrawn', 'Paid ads were switched off before it started');
        return;
      }
      await gads.setStatus([made.campaign], 'ENABLED');
      // Stopped while it was being switched on (pause-all, the watchdog): it goes straight back off.
      if (!run(db, "UPDATE ad_spend SET status='running', updated_at=? WHERE id=? AND status='approved'", now(), id).changes) {
        await gads.setStatus([made.campaign], 'PAUSED');
        log('warn', 'ad campaign stopped as it was switched on', { request: id, campaign: campaignId(made.campaign) });
        return;
      }
      log('info', 'ad campaign on', { floorId: r.floor_id, request: id, campaign: campaignId(made.campaign), ends: plan.endText });
      tellManager(floor, '', `the Google search ad is on now and runs until ${dayText(plan.endsAt)}, then stops on its own. Tell the boss in a line, and that you'll tell them how many people saw it and clicked.`);
      changed(r.floor_id);
    } catch (e) {
      const why = e instanceof AdsError ? e.message : 'Google Ads didn’t answer';
      log('warn', 'ad campaign failed', { request: id, err: plain(why, 200) });
      const r = spendRow(id);
      const camp = made?.campaign || r?.campaign;
      if (camp) {
        // It exists on Google, and may even be on (a switch-on that timed out after it landed). It is paused, and the request stays counted
        // against the cap and live for the floor, so the watchdog keeps it paused and nobody files a second one on top of it.
        const paused = await gads.setStatus([camp], 'PAUSED').then(() => true, () => false);
        run(db, "UPDATE ad_spend SET status='paused', note=?, updated_at=? WHERE id=? AND status='approved'", paused ? 'Stopped while it was being set up. Nothing more will be spent' : 'Stopped while it was being set up', now(), id);
        if (!paused) log('error', 'ad campaign could not be paused after a failed set-up; the watchdog will pause it', { request: id, campaign: campaignId(camp) });
        const floor = r && get(db, 'SELECT * FROM floors WHERE id=?', r.floor_id);
        if (floor) tellManager(floor, '', `Google had trouble switching the ad on (${plain(why, 160)}), so it was stopped. Tell the boss plainly in a line; the building manager will look at it.`);
        if (r) changed(r.floor_id);
      } else if (r) closeSpend(r, 'failed', why, `Google didn't take the ad (${plain(why, 160)}). Nothing was spent. Tell the boss plainly in a line; once it's fixed you can file it again with request_ad_spend if they want.`);
    } finally { settingUp.delete(id); }
  }
  /** Every minute or so: picks up a set-up a restart cut short, pauses and closes campaigns past their end, and reads views, clicks and cost. */
  let adsBusy = false, lastAds = 0, lastSync = 0;
  async function adsTick({ force = false } = {}) {
    if (!gads || adsBusy || (!force && now() - lastAds < cfg.adsTickMs)) return;
    adsBusy = true; lastAds = now();
    try {
      for (const r of all(db, "SELECT id FROM ad_spend WHERE status='approved' AND COALESCE(updated_at, decided_at, 0) < ?", now() - 60000)) await runCampaign(r.id);
      const rows = all(db, "SELECT * FROM ad_spend WHERE status IN ('running','paused') AND campaign != ''");
      for (const r of rows.filter((x) => x.ends_at && x.ends_at <= now())) {
        if (r.status === 'running') await gads.setStatus([r.campaign], 'PAUSED');
        run(db, "UPDATE ad_spend SET status='ended', updated_at=? WHERE id=?", now(), r.id);
        const floor = get(db, 'SELECT * FROM floors WHERE id=?', r.floor_id);
        if (floor && r.status === 'running') tellManager(floor, '', `the Google search ad has finished, as planned. ${r.impressions ? `It was seen ${r.impressions} times and clicked ${r.clicks} times.` : ''} Tell the boss in a line, without any amounts.`);
        changed(r.floor_id);
      }
      const on = rows.filter((x) => !(x.ends_at && x.ends_at <= now()));
      if (on.length && (force || now() - lastSync >= cfg.adsSyncMs)) {
        lastSync = now();
        const stats = await campaignStats(gads, on.map((r) => campaignId(r.campaign)));
        for (const r of on) {
          const s = stats.get(campaignId(r.campaign));
          if (!s) continue;
          run(db, 'UPDATE ad_spend SET spent_micros=?, impressions=?, clicks=?, synced_at=? WHERE id=?', s.costMicros, s.impressions, s.clicks, now(), r.id);
          // Stopped here but on at Google (switched on by hand, or a pause that never landed): off again, watchdog or not.
          if (r.status === 'paused' && s.status === 'ENABLED') { await gads.setStatus([r.campaign], 'PAUSED'); log('warn', 'stopped ad campaign was on at Google, paused again', { request: r.id }); }
          // Belt and braces with the watchdog: one that has cost more than its approved amount stops at once.
          if (r.status === 'running' && s.costMicros > r.amount * 1e6) {
            await gads.setStatus([r.campaign], 'PAUSED');
            run(db, "UPDATE ad_spend SET status='paused', note=?, updated_at=? WHERE id=?", 'Stopped: it cost more than was approved', now(), r.id);
            log('warn', 'ad campaign over its amount, paused', { request: r.id, campaign: campaignId(r.campaign) });
          }
          if (s.impressions !== r.impressions || s.clicks !== r.clicks) changed(r.floor_id);
        }
      }
    } catch (e) { log('error', 'ads', { err: plain(e?.message || e, 200) }); } finally { adsBusy = false; }
  }
  function adSpendView(floorId) {
    const r = get(db, 'SELECT * FROM ad_spend WHERE floor_id=? ORDER BY id DESC LIMIT 1', floorId);
    if (!r) return null;
    const label = {
      awaiting_boss: 'Waiting for your approval', approved: 'Approved: setting it up on Google Search', running: 'Running on Google Search', ended: 'Finished',
      paused: 'Stopped early. Nothing more will be spent', failed: 'Google didn’t take it. Nothing was spent', withdrawn: 'Not set up. Nothing was spent', declined: 'You declined it',
      queued: 'Queued for the building manager', rejected: 'The building manager turned it down',
    }[r.status] || r.status;
    return { id: r.id, amount: r.amount, status: r.status, label, where: 'Google Search', ads: parse(r.ads, []), audience: r.audience, createdAt: r.created_at,
      endsOn: r.ends_at && ['approved', 'running', 'paused', 'ended'].includes(r.status) ? dayText(r.ends_at) : '', views: r.impressions || 0, clicks: r.clicks || 0,
      note: ['failed', 'withdrawn', 'paused'].includes(r.status) ? r.note : '' };
  }

  // ---- the boss's and the manager's other asks ----
  function action(floor, { action: what, idea, notes } = {}, { by = 'manager' } = {}) {
    const row = activeRow(floor.id);
    if (!row) throw new BusinessError(409, 'not_started', 'Business mode is not on. Use start_business first.');
    if (what === 'more_ideas') {
      if (row.step !== 'idea') throw new BusinessError(409, 'picked', 'an idea is already picked and being built');
      if (row.rounds >= CONFIG.ideas.rounds) throw new BusinessError(429, 'enough', 'that is enough rounds of ideas for now: help the boss pick, or take their own idea');
      if (!finished(taskRow(tasksOf(row).ideas))) return 'The researcher is still on the first round. Wait for the cards.';
      assignIdeas(floor, row, { wish: plain(notes, 300) || row.wish, again: true });
      patch(floor.id, { ideas: '[]', noted: '' });
      changed(floor.id);
      return 'The researcher is looking for other ideas now. The new cards replace these when they are ready.';
    }
    if (what === 'pick') { const r = pick(floor, Number(idea) - 1, { by }); return `Picked: ${r.guide}`; }
    if (what === 'redo_ads') {
      if (row.step !== 'customers') throw new BusinessError(409, 'not_now', 'the ads can be changed while the boss is still choosing ad money');
      const ids = tasksOf(row);
      if (!finished(taskRow(ids.ads)) || !finished(taskRow(ids.pictures))) return 'The team is still making the first ads. Pass the change on when they are done.';
      startCustomers(floor, row, { notes: plain(notes, 300) || 'make them different' });
      return 'The team is remaking the ads now.';
    }
    if (what === 'skip_ads') { const r = launch(floor, 0, { skip: true, by }); return `Done: ${r.guide}`; }
    throw new BusinessError(400, 'bad_action', 'action is more_ideas, pick, redo_ads or skip_ads');
  }
  function stop(floor) {
    const row = activeRow(floor.id);
    if (!row) return false;
    patch(floor.id, { status: 'stopped' });
    changed(floor.id);
    return true;
  }

  // ---- what each viewer sees ----
  function phaseOf(floor, row, tracks) {
    if (row.step === 'idea') return parse(row.ideas, []).length ? 'pick' : 'researching';
    if (row.step === 'build') return 'building';
    if (row.step === 'customers') return adsReady(row) ? 'money' : 'making';
    return row.launched_at ? 'launched' : 'launching';
  }
  function progressOf(row, phase, tracks) {
    if (row.step === 'idea') return phase === 'pick' ? 20 : 8;
    if (row.step === 'build') { const d = tracks.reduce((n, t) => n + t.done, 0), all2 = tracks.reduce((n, t) => n + t.total, 0) || 1; return Math.round(25 + 25 * d / all2); }
    if (row.step === 'customers') {
      if (phase === 'money') return 72;
      const f = adFiles(row.floor_id, row.project); const want = CONFIG.ads.pictures + CONFIG.ads.videos + 1;
      return Math.round(50 + 20 * Math.min(want, Math.min(f.pictures.length, CONFIG.ads.pictures) + Math.min(f.videos.length, CONFIG.ads.videos) + (adsOf(row).plan ? 1 : 0)) / want);
    }
    return phase === 'launched' ? 100 : 88;
  }
  function chipsFor(row, phase) {
    if (row.step === 'idea') return CONFIG.chips[phase === 'pick' ? 'idea.pick' : 'idea.researching'];
    if (row.step === 'build') return CONFIG.chips.build.filter((c) => engine.domains?.enabled || !/\.com/.test(c));
    if (row.step === 'customers') return CONFIG.chips[phase === 'money' ? 'customers.money' : 'customers.making'];
    return CONFIG.chips[row.ad_money > 0 ? 'launch.paid' : 'launch.free'];
  }
  function view(f, viewer) {
    const row = rowOf(f.id);
    if (!row || row.status !== 'active') return { on, active: false };
    const tracks = row.step === 'idea' ? CONFIG.tracks.map((t) => ({ id: t.id, label: t.label, note: '', lamp: 'off', done: 0, total: t.items.filter((i) => !i.optional).length, items: [] })) : trackView(f, row);
    const phase = phaseOf(f, row, tracks);
    const at = stepIndex(row.step);
    const steps = CONFIG.steps.map((s, i) => ({ id: s.id, label: s.label, state: i < at || (i === at && phase === 'launched') ? 'done' : i === at ? 'now' : 'next' }));
    const pr = project(f.id, row.project);
    const live = !!pr?.published_at;
    const ideas = parse(row.ideas, []);
    const files = adFiles(f.id, row.project);
    const fileUrl = (name) => `${BASE}/api/floors/${f.slug}/business/file/${encodeURIComponent(name)}`;
    const showAds = row.step === 'launch' && !row.ads_skipped;
    const ads = { pictures: files.pictures.map((x) => ({ name: x.name, src: fileUrl(x.name) })), videos: files.videos.map((x) => ({ name: x.name, src: fileUrl(x.name), captions: x.captions ? fileUrl(x.captions) : '' })), plan: adsOf(row).plan || null, videoFailed: adsOf(row).videoFailed || '', skipped: !!row.ads_skipped };
    const base = {
      on, active: true, step: row.step, phase, steps, progress: progressOf(row, phase, tracks), project: row.project, title: pr?.title || (row.picked >= 0 ? ideas[row.picked]?.name : '') || '',
      tracks: tracks.map((t) => ({ id: t.id, label: t.label, note: t.note, lamp: t.lamp, done: t.done, total: t.total, items: t.items.map((i) => ({ label: i.label, state: i.state, optional: i.optional })) })),
      liveUrl: live && !pr.private ? engine.liveUrl(f, row.project) : '', launched: phase === 'launched',
      ads: showAds && live && !pr.private ? { pictures: ads.pictures, videos: ads.videos, plan: ads.plan ? { headline: ads.plan.headline, primaryText: ads.plan.primaryText } : null } : null,
    };
    if (!viewer.owner) return base;
    const research = parse(row.research, {});
    return {
      ...base, chips: chipsFor(row, phase), picked: row.picked, wish: row.wish,
      ideas: ideas.map((x) => ({ id: x.id, name: x.name, whoPays: x.whoPays, problem: x.problem, sell: x.sell, whyNow: x.whyNow, evidence: x.evidence, revenue: x.revenue })),
      research: { searches: (research.searches || []).slice(-8), pages: (research.pages || []).slice(-12), markets: research.markets || [], compared: research.compared || [] },
      researchTask: (() => { const t = taskRow(tasksOf(row).ideas); return t ? { status: t.status } : null; })(),
      ads, preview: !!row.project && stepIndex(row.step) >= 1,
      adMoney: { options: moneyOptions(), chosen: row.money_set ? row.ad_money : 0, set: !!row.money_set, ready: phase === 'money', paid: paidOn() },
      channels: [{ id: 'google', label: 'Google Search', on: paidOn(), soon: !cfg.adsPaidEnabled || !gads }, { id: 'meta', label: 'Facebook & Instagram', on: false, soon: true }],
      adSpend: adSpendView(f.id),
    };
  }
  /** A line for the manager's state message, and a short brief for scripted test runs. Only the boss's own ad money is a figure in here. */
  function stateLine(floorId) {
    const row = activeRow(floorId);
    if (!row) return '';
    const floor = get(db, 'SELECT * FROM floors WHERE id=?', floorId);
    const v = view(floor, { owner: true });
    const ideas = v.ideas.map((x, i) => `${i + 1}. ${x.name}: ${x.sell}, for ${x.whoPays}; why now: ${x.whyNow}; links: ${x.evidence.map((e) => e.url).join(' ')}`).join(' | ');
    const tracks = v.tracks.map((t) => `${t.label} ${t.done}/${t.total}${t.lamp === 'attention' ? ' (needs attention)' : ''}`).join(', ');
    const s = v.adSpend;
    return [`Business mode is on: step ${CONFIG.steps.findIndex((x) => x.id === v.step) + 1} of 4, ${v.step} (${v.phase}).`,
      ideas ? `Idea cards: ${ideas}.` : 'Idea cards: the researcher is still looking.',
      v.picked >= 0 ? `Picked: ${v.title}, project slug ${v.project}${v.liveUrl ? `, live at ${v.liveUrl}` : ''}. Tracks: ${tracks}.` : '',
      v.step === 'customers' || v.step === 'launch' ? `Ads: ${v.ads.pictures.length} pictures, ${v.ads.videos.length} videos${v.ads.plan ? `, words and plan saved (headline "${v.ads.plan.headline}")` : ''}${v.ads.videoFailed ? `; the AI video failed (${v.ads.videoFailed})` : ''}.` : '',
      v.step === 'launch' ? `Ad money: ${v.ads.skipped ? 'skipped for now' : v.adMoney.chosen ? `${v.adMoney.chosen}, the boss's own choice` : 'none, just for fun'}.${s ? ` Ad request #${s.id}: ${s.label.toLowerCase()}.` : ''}` : '',
      'The boss picks ideas, chooses ad money and approves requests with buttons on the floor; you explain, answer anything, and keep the team on it. Their suggestions appear as chips, so never list options for them to choose from.'].filter(Boolean).join(' ');
  }
  function brief(floorId) {
    const row = activeRow(floorId);
    if (!row) return null;
    const floor = get(db, 'SELECT * FROM floors WHERE id=?', floorId);
    const v = view(floor, { owner: true });
    return { step: v.step, phase: v.phase, project: v.project, ideas: v.ideas.length, adMoney: v.adMoney.chosen, adSpend: v.adSpend?.status || '', reported: !!project(floorId, row.project)?.launch_report };
  }
  /** Extra tools for this run, on a floor that has Business mode on. The manager can always start it. */
  function toolsFor(floorId, role, task) {
    if (!on) return [];
    const row = activeRow(floorId);
    if (role === 'manager') return row ? ['start_business', 'business_action', 'request_ad_spend'] : ['start_business'];
    if (!row || !task) return [];
    const ids = tasksOf(row);
    if (task.id === ids.ideas) return ['propose_ideas'];
    if (task.id === ids.ads) return ['save_ad_plan', 'make_video_ad', 'generate_image'];
    if (task.id === ids.pictures) return ['generate_image'];
    return [];
  }
  /** The researcher's searches and pages, kept as the work shown on the idea step. What was searched for is only ever the boss's to see. */
  function sawTool(c, name, args) {
    const row = activeRow(c.floor.id);
    if (!row || row.step !== 'idea' || !c.task || tasksOf(row).ideas !== c.task.id) return;
    const r = parse(row.research, {});
    if (name === 'web_search') r.searches = [...(r.searches || []), { q: plain(args?.query, 160), at: now() }].slice(-12);
    else if (name === 'fetch_url' && isUrl(args?.url)) r.pages = [...(r.pages || []).filter((p) => urlKey(p.url) !== urlKey(args.url)), { url: String(args.url).slice(0, 500), host: hostOf(args.url), at: now() }].slice(-16);
    else return;
    patch(c.floor.id, { research: JSON.stringify(r) });
    changed(c.floor.id);
  }

  // ---- the runner: reads where the tracks stand and moves the journey on ----
  function step(floor, row) {
    if (row.step === 'build') {
      const tracks = trackView(floor, row);
      if (tracks.every((t) => t.done === t.total)) startCustomers(floor, row);
    } else if (row.step === 'customers' && adsReady(row)) {
      const idea = parse(row.ideas, [])[row.picked];
      tellManager(floor, `customers.money.${tasksOf(row).ads}`, `the ads for "${idea?.name}" are ready on the floor: pictures, videos and the plan. The boss now chooses the ad money with the buttons on the floor; nothing ("just for fun") is the default, and only they can choose an amount. In two or three lines, say what you'd test first and why, from the plan. Don't name any amounts.`);
    } else if (row.step === 'launch') {
      publishAds(floor, row);
      if (!row.launched_at && project(floor.id, row.project)?.launch_report) { patch(floor.id, { launched_at: now() }); log('info', 'business launched', { floorId: floor.id }); }
    }
    const sig = JSON.stringify(view(floor, { owner: true }));
    if (seen.get(floor.id) !== sig) { if (seen.has(floor.id)) changed(floor.id); seen.set(floor.id, sig); }
  }
  /** What the building manager decided about an approved ad request reaches its card. */
  function syncSpend() {
    for (const r of all(db, "SELECT a.id, a.floor_id, p.status FROM ad_spend a JOIN purchases p ON p.id=a.purchase_id WHERE a.status='queued' AND p.status IN ('bought','rejected')")) {
      run(db, "UPDATE ad_spend SET status=?, decided_at=? WHERE id=? AND status='queued'", r.status === 'bought' ? 'running' : 'rejected', now(), r.id);
      changed(r.floor_id);
    }
  }
  function tick() {
    if (stopped || engine.stopped) return;
    try {
      for (const row of all(db, "SELECT * FROM business_journeys WHERE status='active'")) {
        const floor = get(db, 'SELECT * FROM floors WHERE id=?', row.floor_id);
        if (!floor) { run(db, 'DELETE FROM business_journeys WHERE floor_id=?', row.floor_id); continue; }
        if (floor.status !== 'active') continue;
        step(floor, row);
      }
      syncSpend();
      adsTick().catch(() => {});
    } catch (e) { log('error', 'business', { err: String(e?.message || e).slice(0, 200) }); }
  }

  // ---- hooks and routes ----
  hooks.snapshot.push((f, viewer, out) => { out.business = view(f, viewer); });
  const wrap = (fn) => { try { return fn(); } catch (e) { if (e instanceof BusinessError) throw new HttpError(e.status, e.code, e.message); throw e; } };
  POST('/api/floors/:slug/business/start', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 2048);
    const r = wrap(() => start(f, { wish: b.wish, by: 'boss' }));
    if (r.started) engine.bossMessage(f, plain(b.wish, 300) ? `Find me a business idea and build it: ${plain(b.wish, 300)}` : 'Find me a business idea and build it.');
    json(res, 200, { business: view(f, { owner: true }) });
  });
  POST('/api/floors/:slug/business/pick', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 1024);
    wrap(() => pick(f, b.idea, { by: 'boss' }));
    json(res, 200, { business: view(f, { owner: true }) });
  });
  POST('/api/floors/:slug/business/launch', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 1024);
    wrap(() => launch(f, b.amount, { skip: b.skip === true, by: 'boss' }));
    json(res, 200, { business: view(f, { owner: true }) });
  });
  POST('/api/floors/:slug/business/ad-spend/:id', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 1024);
    if (!/^\d{1,15}$/.test(p.id)) throw new HttpError(404, 'not_found');
    wrap(() => decideAdSpend(f, Number(p.id), b.answer));
    json(res, 200, { business: view(f, { owner: true }) });
  });
  POST('/api/floors/:slug/business/stop', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    json(res, 200, { stopped: stop(f) });
  });
  GET('/api/floors/:slug/business/preview', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    const row = activeRow(f.id);
    if (!row?.project) throw new HttpError(404, 'not_found');
    const ready = !!readFile(db, f.id, `projects/${row.project}/index.html`);
    json(res, 200, { url: ready ? ext.workspacePreviewUrl(f, row.project) : '', ready });
  });
  // An ad, for the floor's own page: the boss's at any time, everyone's once it has launched. Ranges, because a phone won't play a video without them.
  GET('/api/floors/:slug/business/file/:name', async ({ req, res, p }) => {
    const f = floorBySlug(p.slug);
    const row = activeRow(f.id);
    const name = String(p.name || '');
    if (!row?.project || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,60}\.(png|jpe?g|webp|mp4|webm|vtt)$/i.test(name)) throw new HttpError(404, 'not_found');
    const viewer = viewerFor(req, f);
    const pr = project(f.id, row.project);
    if (!viewer.owner && !(row.step === 'launch' && !row.ads_skipped && pr?.published_at && !pr.private && f.status === 'active')) throw new HttpError(404, 'not_found');
    const file = readFile(db, f.id, `projects/${row.project}/ads/${name}`);
    if (!file) throw new HttpError(404, 'not_found');
    const body = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
    const type = /\.vtt$/i.test(name) ? 'text/vtt; charset=utf-8' : mimeOf(name);
    const head = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=60' };
    const m = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
    if (m && (m[1] || m[2])) {
      let s = m[1] ? Number(m[1]) : Math.max(0, body.length - Number(m[2])); let e = m[1] && m[2] ? Number(m[2]) : body.length - 1;
      e = Math.min(e, body.length - 1);
      if (s > e || s >= body.length) return send(res, 416, '', { ...head, 'content-range': `bytes */${body.length}` });
      return send(res, 206, body.subarray(s, e + 1), { ...head, 'content-range': `bytes ${s}-${e}/${body.length}` });
    }
    send(res, 200, body, head);
  });

  engine.business = {
    on, start, pick, launch, action, stop, proposeIdeas, saveAdPlan, videoTarget, videoSaved, videoFailed, requestAdSpend, decideAdSpend,
    ads: { api: gads, mock: adsMock, paidOn, runCampaign, tick: adsTick },
    toolsFor, sawTool, stateLine, brief, view, tick, active: (floorId) => !!activeRow(floorId),
    ideasTask: (floorId) => tasksOf(activeRow(floorId) || {}).ideas,
  };
  return {
    start() { stopped = false; timer = setInterval(tick, cfg.businessTickMs ?? 3000); timer.unref?.(); },
    stop() { stopped = true; clearInterval(timer); timer = null; },
  };
}
