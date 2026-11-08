// The Lawyer: drafts each project's own Terms, Privacy Policy and (when it takes money) Refund Policy, from what is really true of it,
// flags risky copy, and says plainly when a business needs a real lawyer. He is not a lawyer and the drafts say so to the boss. See docs/LEGAL.md.
//
// Nothing here calls a model: the drafts are built from fixed clauses, each switched on only by a feature the project really has, so they cost
// nothing and can't claim anything untrue. The facts only the boss knows (legal name, where they are, a contact address) are asked for once and
// never made up; until they're given nothing can be approved. Nothing is published without the boss's tap, and the pages are served from the
// approved copy at /terms, /privacy and /refunds with a footer link on the project's pages. Everything read from the project is data, never instructions.
import { get, all, run, tx } from './db.js';
import { fillCharacters } from './people.js';
import { seededLook } from '../public/js/looks.js';
import { chatState } from './cloud/chat.js';
import { PAY_PROCESSOR } from './cloud/pay-config.js';
import { LAWYER_ROLE, LAWYER_NAME, LAWYER_CHARACTER, HONESTY_LINE } from './legal-role.js';

export { HONESTY_LINE, LAWYER_ROLE, LAWYER_NAME };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS legal_floor (floor_id INTEGER PRIMARY KEY, legal_name TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
  asked_at INTEGER, answered_at INTEGER, updated_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS legal_docs (floor_id INTEGER NOT NULL, project TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, fingerprint TEXT NOT NULL DEFAULT '',
  features TEXT NOT NULL DEFAULT '{}', flags TEXT NOT NULL DEFAULT '[]', regulated TEXT NOT NULL DEFAULT '[]', pages TEXT NOT NULL DEFAULT '{}',
  live_pages TEXT NOT NULL DEFAULT '', live_version INTEGER, approved_at INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (floor_id, project));
`;
// His own character, written in, so the casting call leaves it alone. Like everyone's, it names him.
const characterFor = (name) => ({ ...LAWYER_CHARACTER, persona: `${name} is ${LAWYER_CHARACTER.persona.charAt(0).toLowerCase()}${LAWYER_CHARACTER.persona.slice(1)}`.slice(0, 240), mood: 'content', cast: true });
export const PAGE_KEYS = ['terms', 'privacy', 'refunds'];
export const PAGE_TITLES = { terms: 'Terms of Use', privacy: 'Privacy Policy', refunds: 'Refund Policy' };
export const FACT_LIMITS = { legalName: 120, region: 80, contact: 200 };
const FACT_LABELS = { legalName: 'legal or trading name', region: 'country or state', contact: 'contact address' };
const DRAFT_KINDS = new Set(['site', 'app', 'game']);
const TEXT_FILE = /\.(html?|js|mjs|jsx|ts|tsx|css|md|txt|json|svg)$/i;
const MAX_SCAN = 600_000;

const plain = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const asText = (c) => (typeof c === 'string' ? c : Buffer.isBuffer(c) || c instanceof Uint8Array ? Buffer.from(c).toString('utf8') : '');

/** The boss's own facts, cleaned. Blank stays blank: there is no default for any of them. */
export function cleanFacts(b = {}) {
  return { legalName: plain(b.legalName, FACT_LIMITS.legalName), region: plain(b.region, FACT_LIMITS.region), contact: plain(b.contact, FACT_LIMITS.contact) };
}
export const missingFacts = (facts) => Object.keys(FACT_LABELS).filter((k) => !facts?.[k]);

// ---- what is true of a project ----

/**
 * Reads what a project really does. src: { title, description, kind, files: [{path, content}], paymentLink, products: [{interval}], chatOn, adCampaign, mailbox }.
 * Every feature is false unless something in the project shows it.
 */
export function analyze(src) {
  let code = '';
  for (const f of src.files || []) { if (!TEXT_FILE.test(f.path)) continue; code += `\n${asText(f.content)}`; if (code.length > MAX_SCAN) break; }
  const has = (re) => re.test(code);
  const products = src.products || [];
  const f = {
    payments: !!src.paymentLink || products.length > 0 || has(/\boffice\.pay\.\w+|_office\/pay\b/),
    subscriptions: products.some((p) => !!p.interval),
    accounts: has(/\boffice\.auth\.(signUp|logIn|user|onChange)\b/),
    saves: has(/\bOffice\.(save|load)\s*\(|\boffice\.(saves|db|shared)\.|\bOffice\.shared\./),
    scores: has(/\bOffice\.(submitScore|leaderboard)\s*\(|\boffice\.leaderboard\./),
    forms: has(/<form\b|\bOffice\.submitForm\s*\(|\boffice\.forms\.submit\b/i),
    emailCollected: has(/<input[^>]+type\s*=\s*["']?email\b|newsletter/i),
    uploads: has(/\boffice\.files\.upload\b|<input[^>]+type\s*=\s*["']?file\b/i),
    chat: !!src.chatOn,
    ai: has(/\boffice\.ai\.chat\b|\bOffice\.ai\b/),
    adScripts: has(/adsbygoogle|googlesyndication\.com|doubleclick\.net|googletagmanager\.com/i),
    adCampaign: !!src.adCampaign,
    mailbox: !!src.mailbox,
  };
  return f;
}

// The kinds of business that need a real lawyer before launch. Matched on what the company and project say about themselves.
const REGULATED = [
  ['gambling', 'Gambling or betting', /\b(gambl\w*|casino\w*|betting|bets?\b|sportsbook|wager\w*|lotter(y|ies)|poker|slot machines?|real[- ]money (games?|prizes?))\b/i],
  ['alcohol-tobacco', 'Alcohol, tobacco or vaping', /\b(alcohol\w*|liquor|spirits shop|wine (shop|store|club|delivery)|brewery|beer (shop|delivery)|vap(e|es|ing)|tobacco|cigar\w*|cigarettes?|e-?liquid|cannabis|cbd|thc)\b/i],
  ['health', 'Health or medical', /\b(medical|medicine|clinic\w*|doctors?|diagnos\w*|treatments?|therap(y|ies|ist)|prescriptions?|pharmac\w*|telehealth|supplements?|dental|dentist\w*|nutritionist|mental health|symptoms?|weight[- ]loss|blood[- ]?(work|tests?|testing)|lab[- ]?(work|tests?|testing))\b/i],
  ['finance', 'Financial advice or investing', /\b(invest\w*|stock tips?|stocks|trading signals?|forex|crypto\w*|bitcoin|financial advi\w*|loans?|lending|credit repair|insurance|tax advice|portfolio management)\b/i],
  ['children', 'Children\'s data', /\b(for kids|kids'?|children'?s?|under[- ]13|toddlers?|preschool\w*|pupils?|schoolchildren|parents? of young)\b/i],
  ['illegal', 'Something that may be illegal', /\b(counterfeit|fake (ids?|passports?|documents?)|replica designer|drugs? (shop|delivery|for sale)|firearms?|guns? for sale|ammunition|explosives?|hacking services?|stolen|piracy|torrent)\b/i],
];
/** What makes this a regulated or risky business, from the company's and project's own words. */
export function regulatedOf(text) {
  const t = String(text || '');
  return REGULATED.filter(([, , re]) => re.test(t)).map(([id, label]) => ({ id, label }));
}

// Well-known marks a small company's site or name shouldn't lean on. A short list on purpose: it's a flag for the boss, not a search.
const BRANDS = ['Disney', 'Pixar', 'Marvel', 'Star Wars', 'Pokémon', 'Pokemon', 'Nintendo', 'Mario', 'Zelda', 'PlayStation', 'Xbox', 'Minecraft', 'Fortnite', 'Roblox', 'Lego', 'Harry Potter',
  'Hello Kitty', 'Barbie', 'Coca-Cola', 'Pepsi', 'Starbucks', 'McDonald\'s', 'Nike', 'Adidas', 'Gucci', 'Louis Vuitton', 'Rolex', 'Ferrari', 'Tesla', 'Apple', 'iPhone', 'Google', 'YouTube',
  'Netflix', 'Spotify', 'Amazon', 'Facebook', 'Instagram', 'TikTok', 'WhatsApp', 'Uber', 'Airbnb', 'Microsoft', 'ChatGPT', 'OpenAI', 'Tetris', 'Monopoly', 'Scrabble', 'Wordle'];
const brandRe = (b) => new RegExp(`(^|[^\\p{L}\\p{N}])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu');
const COPY_FLAGS = [
  ['guarantee', 'Promises guaranteed results', /\b(guarantee[ds]?|100% (results|success|satisfaction)|risk[- ]free|never fails|instant results)\b/i],
  ['health-claim', 'Makes a health claim', /\b(cures?|heals?|prevents? (cancer|disease|illness)|treats? (anxiety|depression|cancer|diabetes|pain)|clinically proven|doctor[- ](approved|recommended)|lose \d+\s?(lbs?|pounds|kg|kilos))\b/i],
  ['money-claim', 'Makes a money claim', /\b(get rich|passive income|double your money|earn \$?\d[\d,]*|make \$\d[\d,]*|financial freedom|guaranteed (returns?|income|profit))\b/i],
  ['reviews', 'Looks like reviews or testimonials nobody gave', /(what (our|my) (customers|clients|users) say|testimonials?|★★★★★|\b\d[\d,]* (happy|satisfied) (customers|clients|users)\b|\brated \d(\.\d)? (out of 5|stars)\b|\b5[- ]star reviews?\b)/i],
];
const stripHtml = (s) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ');
/** Risky things in the copy and the name. Flags for the boss; they never hold Launch by themselves. */
export function reviewCopy({ name = '', files = [] } = {}) {
  let text = '';
  for (const f of files) { if (!/\.(html?|md|txt)$/i.test(f.path)) continue; text += `\n${stripHtml(asText(f.content))}`; if (text.length > MAX_SCAN) break; }
  const out = [];
  for (const [id, label, re] of COPY_FLAGS) { const m = text.match(re); if (m) out.push({ id, label, quote: plain(m[0], 80) }); }
  const inName = BRANDS.find((b) => brandRe(b).test(name));
  if (inName) out.push({ id: 'trademark-name', label: `The name uses "${inName}", which is obviously someone else's trademark`, quote: plain(name, 80) });
  const inCopy = BRANDS.filter((b) => b !== inName && brandRe(b).test(text)).slice(0, 3);
  if (inCopy.length) out.push({ id: 'brand', label: `Mentions someone else's brand: ${inCopy.join(', ')}`, quote: '' });
  return out;
}

// ---- the drafts ----

const WAIT = (k) => `[waiting for the boss: ${FACT_LABELS[k]}]`;
/**
 * The pages, as sections of plain sentences. Only the features that are true add a clause; a missing fact stays a visible placeholder.
 * Returns { terms, privacy, refunds? }, each { title, sections: [{ h, p: [] }] }.
 */
export function draftPages({ title, kind, features: ft, facts: given = {} }) {
  const facts = cleanFacts(given);
  const who = facts.legalName || WAIT('legalName');
  const where = facts.region || WAIT('region');
  const contact = facts.contact || WAIT('contact');
  const name = plain(title, 80) || 'this site';
  const thing = { game: 'game', app: 'app', site: 'website' }[kind] || 'website';
  const userContent = ft.forms || ft.uploads || ft.scores || ft.chat || ft.saves;
  const terms = { title: PAGE_TITLES.terms, sections: [
    { h: 'Who we are', p: [`${name} is ${/^[aeiou]/i.test(thing) ? 'an' : 'a'} ${thing} run by ${who}, based in ${where}. You can reach us at ${contact}.`, `By using ${name} you agree to these terms. If you don't agree, please don't use it.`] },
    { h: 'Using it', p: ['Use it for lawful purposes only. Don\'t try to break it, overload it, get into parts that aren\'t meant for you, or use it to harm anyone.', 'We may stop or limit access for anyone who breaks these terms.'] },
  ] };
  if (ft.accounts) terms.sections.push({ h: 'Your account', p: ['Keep your password to yourself; you are responsible for what happens under your account.', `You can ask us to close your account at any time by writing to ${contact}. We may close accounts that break these terms.`] });
  if (ft.payments) {
    const p = [`Prices are shown before you pay. Payments are taken by ${PAY_PROCESSOR} on its own payment page; we never see your full card number.`, 'What you buy is described where you buy it.'];
    if (ft.subscriptions) p.push('Subscriptions renew each period until you cancel. You can cancel at any time and it stops the next renewal.');
    p.push(`Refunds are covered in our Refund Policy.`);
    terms.sections.push({ h: 'Payments', p });
  }
  if (userContent) terms.sections.push({ h: 'What you add', p: ['Anything you post, send or upload stays yours. You let us store and show it as part of how ' + name + ' works.', 'Only add things you have the right to share, and nothing unlawful or hurtful. We may remove anything that breaks these terms.'] });
  if (ft.ai) terms.sections.push({ h: 'AI features', p: ['Some answers here are written by an AI model. They can be wrong, so don\'t rely on them for anything important.'] });
  if (ft.chat) terms.sections.push({ h: 'Chat', p: ['Replies in the chat on this site may be written by AI. They can be wrong, and they are not a promise from us.'] });
  terms.sections.push(
    { h: 'No promises', p: [`${name} is provided as it is. We do our best, but we can't promise it will always be available, error-free or right for what you need. As far as the law allows, we aren't liable for losses from using it.`, 'Nothing here takes away rights you have under the law where you live.'] },
    { h: 'Changes', p: ['We may update these terms. The date at the top shows when they last changed.'] },
    { h: 'Law', p: [`These terms are governed by the law of ${where}.`] },
  );

  const collected = ['Visit counts. When a page is opened, a daily count is kept using a salted one-way hash of the day, the page, your address and browser. It sets no cookie, and the hashes are thrown away after a day.'];
  if (ft.accounts) collected.push('Your account: the details you sign up with. Passwords are stored only as hashes.');
  if (ft.saves) collected.push('What you save: your progress and anything you create, kept so it is there next time. A copy may also be kept in your own browser\'s storage.');
  if (ft.scores) collected.push('Scores, with the name you choose to show next to them.');
  if (ft.forms) collected.push('What you type into the forms on this site.');
  if (ft.emailCollected) collected.push('Your email address, when you give it to us.');
  if (ft.uploads) collected.push('Files you upload.');
  if (ft.chat) collected.push('The messages you send in the site chat.');
  if (ft.payments) collected.push(`Purchase records: what you bought, when, and a ${PAY_PROCESSOR} customer reference. Card details are handled by ${PAY_PROCESSOR}, not us.`);
  if (ft.ai) collected.push('What you type into AI features, so that an answer can be written.');
  if (ft.adScripts) collected.push('Ad scripts on this site come from an ad network that may set its own cookies and collect data under its own privacy policy.');
  const shared = [`${name} is hosted on The Office, which stores the data above for us.`];
  if (ft.payments) shared.push(`${PAY_PROCESSOR} processes payments.`);
  if (ft.ai || ft.chat) shared.push(`AI model providers receive what you type into ${ft.ai && ft.chat ? 'AI features or the chat' : ft.ai ? 'AI features' : 'the chat'}, to write the reply.`);
  if (ft.mailbox) shared.push('If you email us, the mail passes through our email provider.');
  if (ft.adScripts) shared.push('The ad network that serves the ads on this site.');
  const privacy = { title: PAGE_TITLES.privacy, sections: [
    { h: 'Who we are', p: [`${who}, based in ${where}, runs ${name}. Contact: ${contact}.`] },
    { h: 'What we collect', p: collected },
    { h: 'Who else handles it', p: shared },
    { h: 'Your choices', p: [`Write to ${contact} to ask what we hold about you, or to have it corrected or deleted.`] },
    { h: 'Changes', p: ['We may update this policy. The date at the top shows when it last changed.'] },
  ] };
  const pages = { terms, privacy };
  if (ft.payments) {
    const p = [`To ask for a refund, write to ${contact} with what you bought and roughly when.`, `We look at every request and tell you what we can do. Approved refunds go back to the card you paid with, through ${PAY_PROCESSOR}.`];
    if (ft.subscriptions) p.push('Cancelling a subscription stops future renewals; it keeps working until the end of the period you paid for.');
    p.push('Nothing here takes away rights you have under the law where you live.');
    pages.refunds = { title: PAGE_TITLES.refunds, sections: [{ h: 'Refunds', p }, { h: 'Who we are', p: [`${who}, ${where}. Contact: ${contact}.`] }] };
  }
  return pages;
}

const dayText = (t) => new Date(t).toISOString().slice(0, 10);
/** One published page. No authorship line at all: it never says a lawyer wrote it. */
export function renderPage(page, { site, updatedAt, links }) {
  const body = page.sections.map((s) => `<h2>${esc(s.h)}</h2>\n${s.p.map((x) => `<p>${esc(x)}</p>`).join('\n')}`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.title)} · ${esc(site)}</title></head><body><main>
<h1>${esc(page.title)}</h1>
<p><small>${esc(site)}. Last updated ${esc(dayText(updatedAt))}.</small></p>
${body}
</main>${links}</body></html>`;
}
const footerHtml = (base, keys) => `<footer data-office-legal style="margin:2em 0 1em;text-align:center;font-size:13px">${keys.map((k) => `<a href="${esc(base + k)}">${esc(PAGE_TITLES[k].replace(/ (of Use|Policy)$/, ''))}</a>`).join(' · ')}</footer>`;
/** A published HTML page with the legal links added at its foot, before the last </body>. */
export function withFooter(html, base, keys) {
  const s = asText(html);
  if (!keys.length || s.includes('data-office-legal')) return html;
  const i = s.toLowerCase().lastIndexOf('</body>');
  const foot = footerHtml(base, keys);
  return i < 0 ? s + foot : s.slice(0, i) + foot + s.slice(i);
}

// ---- the module ----

export function installLegal(ext) {
  const { db, cfg, engine, now, hooks, GET, POST, json, readJson, limit, requireOwner, HttpError, BASE, log } = ext;
  db.exec(SCHEMA);
  const lawyerOf = (floorId) => get(db, 'SELECT * FROM agents WHERE floor_id=? AND role=?', floorId, LAWYER_ROLE);
  const factsOf = (floorId) => { const r = get(db, 'SELECT * FROM legal_floor WHERE floor_id=?', floorId); return { legalName: r?.legal_name || '', region: r?.region || '', contact: r?.contact || '', askedAt: r?.asked_at || null }; };
  const docOf = (floorId, slug) => get(db, 'SELECT * FROM legal_docs WHERE floor_id=? AND project=?', floorId, slug);
  const tryAll = (sql, ...a) => { try { return all(db, sql, ...a); } catch { return []; } };
  const tryGet = (sql, ...a) => { try { return get(db, sql, ...a); } catch { return null; } };

  /** Hollis gets his own name and character, and stays through a floor reset like a founding role. */
  function dressLawyer(floorId) {
    const a = lawyerOf(floorId);
    if (!a) return;
    run(db, 'UPDATE agents SET hired=0, character=? WHERE id=?', JSON.stringify(characterFor(a.name)), a.id);
  }
  function addLawyer(floor) {
    if (lawyerOf(floor.id)) return null;
    const taken = new Set(all(db, 'SELECT name FROM agents WHERE floor_id=?', floor.id).map((a) => a.name.toLowerCase()));
    const title = engine.models.all[LAWYER_ROLE]?.title || 'Lawyer';
    const name = taken.has(LAWYER_NAME.toLowerCase()) ? `${LAWYER_NAME} Q.` : LAWYER_NAME;
    run(db, 'INSERT INTO agents (floor_id,role,title,name,look,character,office,hired,created_at) VALUES (?,?,?,?,?,?,?,0,?)', floor.id, LAWYER_ROLE, title, name,
      JSON.stringify(seededLook(floor.id * 19 + 11)), JSON.stringify(characterFor(name)), `office-${LAWYER_ROLE}`, now());
    fillCharacters(db, floor.id);
    return lawyerOf(floor.id);
  }

  // New companies get him by default. Filler floors never do: nothing on them reaches a real boss.
  const seed = engine.seedStaff.bind(engine);
  engine.seedStaff = (floorId) => {
    seed(floorId);
    const f = get(db, 'SELECT * FROM floors WHERE id=?', floorId);
    // He never takes the last seat under a staff limit: a floor capped at its founding team keeps its room to hire, and can add him later.
    const n = f ? get(db, "SELECT COUNT(*) n FROM agents WHERE floor_id=? AND role!='manager'", f.id).n : 0;
    if (f && !f.filler && engine.models.all[LAWYER_ROLE] && n + 1 < cfg.maxStaff) addLawyer(f);
  };
  // Hired any other way (the manager's hire_staff, the Customise panel), he is still Hollis.
  const hire = engine.hireStaff.bind(engine);
  engine.hireStaff = (floor, role, name) => {
    const out = hire(floor, role, role === LAWYER_ROLE && !name ? LAWYER_NAME : name);
    if (role === LAWYER_ROLE) { dressLawyer(floor.id); setImmediate(() => considerFloor(floor.id)); }
    return out;
  };
  // Something went live: he looks at it once the publish has landed.
  const upsert = engine.upsertProject.bind(engine);
  engine.upsertProject = (floor, slug, o = {}) => {
    const r = upsert(floor, slug, o);
    if (o.published && DRAFT_KINDS.has(o.kind)) setImmediate(() => { try { consider(floor.id, slug); } catch (e) { log?.('error', 'legal consider', { err: String(e?.message).slice(0, 200) }); } });
    return r;
  };
  // Before a maker Launch he reads the copy and tells the boss what worries him. A flag, never a hold.
  if (engine.makers?.launch) {
    const launch = engine.makers.launch;
    engine.makers.launch = async (floor, opts) => {
      try { const j = get(db, 'SELECT project FROM maker_jobs WHERE floor_id=? ORDER BY id DESC LIMIT 1', floor.id); if (j) preLaunch(floor, j.project); } catch (e) { log?.('error', 'legal review', { err: String(e?.message).slice(0, 200) }); }
      return launch(floor, opts);
    };
  }

  const filesOf = (floorId, slug, live) => (live
    ? tryAll('SELECT path,content FROM published_files WHERE floor_id=? AND project=? LIMIT 400', floorId, slug)
    : tryAll('SELECT substr(path, ?) path, content FROM files WHERE floor_id=? AND path LIKE ? LIMIT 400', `projects/${slug}/`.length + 1, floorId, `projects/${slug}/%`));
  function sourceOf(f, pr) {
    const live = filesOf(f.id, pr.slug, true);
    let chatOn = false; try { chatOn = !!chatState(db, cfg, f, pr).on; } catch { /* no chat here */ }
    return {
      title: pr.title, description: pr.description, kind: pr.kind, files: live.length ? live : filesOf(f.id, pr.slug, false),
      paymentLink: pr.payment_link || '',
      products: tryAll("SELECT interval FROM pay_products WHERE floor_id=? AND project=? AND status='live'", f.id, pr.slug),
      chatOn,
      adCampaign: !!tryGet("SELECT 1 x FROM ad_spend WHERE floor_id=? AND project=? AND status IN ('approved','running','paused','ended')", f.id, pr.slug),
      mailbox: !!tryGet('SELECT 1 x FROM mail_addresses WHERE floor_id=?', f.id),
    };
  }
  function companyWords(f, pr) {
    const id = parse(f.identity, {});
    const job = tryGet('SELECT title,pitch,goal FROM maker_jobs WHERE floor_id=? AND project=? ORDER BY id DESC LIMIT 1', f.id, pr.slug);
    return [f.name, f.tagline, id.about, pr.title, pr.description, job?.title, job?.pitch, job?.goal].filter(Boolean).join('\n');
  }

  /** Tells the boss, in the boss's own channel. The facts and the flags are theirs alone. */
  function tell(floorId, text) {
    const a = lawyerOf(floorId);
    // The building's boss-only notice: never shown to visitors, never read back to a model, and not the manager's launch report.
    engine.addMessage(floorId, 'budget', a?.id ?? null, text);
  }
  const ping = (floorId) => engine.emit(floorId, 'legal', {}, { ownerOnly: true, persist: false });

  /** Drafts or redrafts one project's pages when what's true of it has changed. Returns the doc row. */
  function consider(floorId, slug) {
    const f = get(db, 'SELECT * FROM floors WHERE id=?', floorId);
    if (!f || f.filler || f.status !== 'active' || !lawyerOf(floorId)) return null;
    const pr = get(db, 'SELECT * FROM projects WHERE floor_id=? AND slug=? AND published_at IS NOT NULL', floorId, slug);
    if (!pr || !DRAFT_KINDS.has(pr.kind)) return null;
    const src = sourceOf(f, pr);
    const features = analyze(src);
    const regulated = regulatedOf(companyWords(f, pr));
    const flags = reviewCopy({ name: `${f.name || ''} ${pr.title || ''}`, files: src.files });
    const facts = factsOf(floorId);
    const kept = { legalName: facts.legalName, region: facts.region, contact: facts.contact };
    const fingerprint = JSON.stringify({ features, regulated: regulated.map((r) => r.id), facts: kept, title: pr.title, kind: pr.kind });
    const old = docOf(floorId, slug);
    if (old && old.fingerprint === fingerprint) {
      if (old.flags !== JSON.stringify(flags)) { run(db, 'UPDATE legal_docs SET flags=?, updated_at=? WHERE floor_id=? AND project=?', JSON.stringify(flags), now(), floorId, slug); ping(floorId); }
      return docOf(floorId, slug);
    }
    const pages = regulated.length ? {} : draftPages({ title: pr.title, kind: pr.kind, features, facts: kept });
    const status = regulated.length ? 'regulated' : missingFacts(kept).length ? 'needs_facts' : 'drafted';
    const version = (old?.version || 0) + 1;
    run(db, `INSERT INTO legal_docs (floor_id,project,status,version,fingerprint,features,flags,regulated,pages,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(floor_id,project) DO UPDATE SET status=excluded.status, version=excluded.version, fingerprint=excluded.fingerprint, features=excluded.features, flags=excluded.flags,
      regulated=excluded.regulated, pages=excluded.pages, updated_at=excluded.updated_at`, floorId, slug, status, version, fingerprint, JSON.stringify(features), JSON.stringify(flags), JSON.stringify(regulated), JSON.stringify(pages), now());
    const title = pr.title || slug;
    if (status === 'regulated') {
      tell(floorId, `**${title} needs a real lawyer before launch, boss.** It looks like ${regulated.map((r) => r.label.toLowerCase()).join(' and ')}, which comes with rules I can't responsibly guess at. I haven't drafted Terms for it as if it were routine. ${HONESTY_LINE}`);
    } else if (status === 'needs_facts') {
      if (!facts.askedAt) {
        run(db, 'INSERT INTO legal_floor (floor_id,asked_at,updated_at) VALUES (?,?,?) ON CONFLICT(floor_id) DO UPDATE SET asked_at=excluded.asked_at, updated_at=excluded.updated_at', floorId, now(), now());
        tell(floorId, `I've started the Terms and Privacy Policy for **${title}**, boss. Three things I can't know and won't make up: your **legal or trading name**, your **country or state**, and a **contact address** for customers. Fill them in on the card under Requests and the drafts are ready for your tap. ${HONESTY_LINE}`);
      }
    } else {
      const again = old && old.live_version;
      tell(floorId, again
        ? `**${title} changed, so I've updated its legal pages** (${changeWords(parse(old.features, {}), features) || 'details'}). The approved version stays up until you approve this one under Requests. ${HONESTY_LINE}`
        : `**The legal pages for ${title} are drafted** and waiting for your tap under Requests: ${Object.values(pages).map((p) => p.title).join(', ')}. ${HONESTY_LINE}`);
    }
    if (flags.length && (!old || old.flags !== JSON.stringify(flags))) tellFlags(floorId, title, flags);
    engine.feed(floorId, lawyerOf(floorId), status === 'regulated' ? `flagged ${title} for a real lawyer` : `drafted the legal pages for ${title}`, slug);
    ping(floorId);
    return docOf(floorId, slug);
  }
  function changeWords(a, b) {
    const words = { payments: 'payments', accounts: 'accounts', saves: 'saved data', scores: 'scores', forms: 'forms', emailCollected: 'email sign-ups', uploads: 'uploads', chat: 'site chat', ai: 'AI features', adScripts: 'ad scripts', subscriptions: 'subscriptions' };
    return Object.keys(words).filter((k) => !!a[k] !== !!b[k]).map((k) => `${words[k]} ${b[k] ? 'switched on' : 'switched off'}`).join(', ');
  }
  function tellFlags(floorId, title, flags) {
    tell(floorId, `**A few things on ${title} worry me, boss.** They don't stop Launch, but I'd look at them:\n${flags.map((x) => `- ${x.label}${x.quote ? `: "${x.quote}"` : ''}`).join('\n')}\n${HONESTY_LINE}`);
  }
  function preLaunch(floor, slug) {
    if (!lawyerOf(floor.id)) return;
    const pr = get(db, 'SELECT * FROM projects WHERE floor_id=? AND slug=?', floor.id, slug);
    if (!pr) return;
    const flags = reviewCopy({ name: `${floor.name || ''} ${pr.title || ''}`, files: filesOf(floor.id, slug, false) });
    const regulated = regulatedOf(companyWords(floor, pr));
    if (regulated.length) tell(floor.id, `Before ${pr.title || slug} goes out: it looks like ${regulated.map((r) => r.label.toLowerCase()).join(' and ')}. That needs a real lawyer before launch. ${HONESTY_LINE}`);
    if (flags.length) tellFlags(floor.id, pr.title || slug, flags);
  }
  function considerFloor(floorId) {
    for (const p of all(db, 'SELECT slug FROM projects WHERE floor_id=? AND published_at IS NOT NULL', floorId)) { try { consider(floorId, p.slug); } catch (e) { log?.('error', 'legal consider', { err: String(e?.message).slice(0, 200) }); } }
  }

  function setFacts(floor, b) {
    const facts = cleanFacts(b);
    if (missingFacts(facts).length) throw new HttpError(400, 'facts', `Fill in your ${missingFacts(facts).map((k) => FACT_LABELS[k]).join(', ')}.`);
    run(db, `INSERT INTO legal_floor (floor_id,legal_name,region,contact,asked_at,answered_at,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(floor_id) DO UPDATE SET legal_name=excluded.legal_name, region=excluded.region, contact=excluded.contact, answered_at=excluded.answered_at, updated_at=excluded.updated_at`,
    floor.id, facts.legalName, facts.region, facts.contact, now(), now(), now());
    considerFloor(floor.id);
    return facts;
  }
  /** The boss's tap. Only a drafted version the boss has seen, with every fact given, goes up. */
  function approve(floor, slug, version) {
    const d = docOf(floor.id, slug);
    if (!d) throw new HttpError(404, 'not_found', 'There is no draft for that project.');
    if (d.status === 'regulated') throw new HttpError(409, 'regulated', 'This one needs a real lawyer before launch, so there is nothing to approve.');
    if (d.status === 'needs_facts' || missingFacts(factsOf(floor.id)).length) throw new HttpError(409, 'needs_facts', 'Fill in your name, country or state and contact address first.');
    if (d.status !== 'drafted') throw new HttpError(409, 'not_waiting', 'Nothing is waiting for you on that project.');
    if (Number(version) !== d.version) throw new HttpError(409, 'stale', 'The draft changed while you were looking. Have another look.');
    run(db, "UPDATE legal_docs SET status='approved', live_pages=pages, live_version=version, approved_at=?, updated_at=? WHERE floor_id=? AND project=? AND version=? AND status='drafted'", now(), now(), floor.id, slug, d.version);
    engine.feed(floor.id, lawyerOf(floor.id), `put up the approved legal pages for ${slug}`, slug);
    engine.emitProject?.(floor.id, slug);
    ping(floor.id);
  }
  function decline(floor, slug) {
    const d = docOf(floor.id, slug);
    if (!d || d.status !== 'drafted') throw new HttpError(409, 'not_waiting', 'Nothing is waiting for you on that project.');
    run(db, "UPDATE legal_docs SET status='declined', updated_at=? WHERE floor_id=? AND project=?", now(), floor.id, slug);
    ping(floor.id);
  }

  // ---- serving: the approved copy only ----
  const LEGAL_PATH = /^(terms|privacy|refunds)(\.html|\/index\.html|\/)?$/;
  const livePagesOf = (f, pr) => { const d = docOf(f.id, pr.slug); return d?.live_pages ? { d, pages: parse(d.live_pages, {}) } : null; };
  const baseOf = (f, pr) => (cfg.appsBaseDomain ? '/' : `${BASE}/f/${f.slug}/${pr.slug}/`);
  /** A legal page for this path, or null. Called by the published-site server before the project's own files. */
  function page(f, pr, path) {
    const m = String(path).match(LEGAL_PATH);
    if (!m) return null;
    const live = livePagesOf(f, pr);
    const pg = live?.pages[m[1]];
    if (!pg) return null;
    const keys = PAGE_KEYS.filter((k) => live.pages[k]);
    return { type: 'text/html; charset=utf-8', body: renderPage(pg, { site: pr.title || pr.slug, updatedAt: live.d.approved_at || live.d.updated_at, links: footerHtml(baseOf(f, pr), keys) }) };
  }
  /** The footer links on a project's own HTML pages, once the boss has approved its legal pages. */
  function decorate(f, pr, hit) {
    if (!hit || !/^text\/html/.test(hit.type)) return hit;
    const live = livePagesOf(f, pr);
    if (!live) return hit;
    return { ...hit, body: withFooter(hit.body, baseOf(f, pr), PAGE_KEYS.filter((k) => live.pages[k])) };
  }

  // ---- what the boss sees ----
  function view(f) {
    const a = lawyerOf(f.id);
    const facts = factsOf(f.id);
    const docs = all(db, 'SELECT d.* FROM legal_docs d JOIN projects p ON p.floor_id=d.floor_id AND p.slug=d.project WHERE d.floor_id=? ORDER BY d.updated_at DESC LIMIT 20', f.id);
    return {
      lawyer: a ? { id: a.id, name: a.name, title: a.title } : null,
      canHire: !a && !!engine.models.all[LAWYER_ROLE],
      honesty: HONESTY_LINE,
      facts: { legalName: facts.legalName, region: facts.region, contact: facts.contact, missing: missingFacts(facts) },
      docs: docs.map((d) => ({
        project: d.project, status: d.status, version: d.version, liveVersion: d.live_version || null, features: parse(d.features, {}), flags: parse(d.flags, []), regulated: parse(d.regulated, []),
        pages: parse(d.pages, {}), live: !!d.live_pages, paths: d.live_pages ? PAGE_KEYS.filter((k) => parse(d.live_pages, {})[k]).map((k) => `${baseOf(f, { slug: d.project })}${k}`) : [],
      })),
    };
  }
  hooks.snapshot.push((f, viewer, out) => { if (viewer?.owner) out.legal = view(f); });

  const wrapErr = (fn) => { try { return fn(); } catch (e) { if (e instanceof HttpError) throw e; throw e; } };
  GET('/api/floors/:slug/legal', async ({ req, res, p }) => { const f = requireOwner(req, p.slug); json(res, 200, view(f)); });
  POST('/api/floors/:slug/legal/hire', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    if (lawyerOf(f.id)) throw new HttpError(409, 'already_hired', 'You already have a Lawyer.');
    const n = get(db, "SELECT COUNT(*) n FROM agents WHERE floor_id=? AND role!='manager'", f.id).n;
    if (n >= cfg.maxStaff) throw new HttpError(409, 'staff_full', `This floor is at its limit of ${cfg.maxStaff} staff. Let someone go first.`);
    // The same path as any hire, so the floor sees him walk in; nobody else's work is touched.
    wrapErr(() => engine.hireStaff(f, LAWYER_ROLE, LAWYER_NAME));
    json(res, 201, view(f));
  });
  POST('/api/floors/:slug/legal/facts', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 4096);
    setFacts(f, b);
    json(res, 200, view(f));
  });
  POST('/api/floors/:slug/legal/:project/:action', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 512);
    if (p.action === 'approve') approve(f, p.project, b.version);
    else if (p.action === 'decline') decline(f, p.project);
    else if (p.action === 'redraft') consider(f.id, p.project);
    else throw new HttpError(400, 'bad_action');
    json(res, 200, view(f));
  });

  // Payments switched on, a form added, chat turned on: he notices on his rounds and redrafts. Nothing is read by a model, so a round costs nothing.
  let timer = null;
  const ROUND_MS = cfg.legalRoundMs || 10 * 60 * 1000;
  return {
    consider, considerFloor, approve, decline, setFacts, page, decorate, view, addLawyer,
    start() {
      if (timer) return;
      timer = setInterval(() => { for (const r of all(db, 'SELECT DISTINCT floor_id FROM legal_docs')) considerFloor(r.floor_id); }, ROUND_MS);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
