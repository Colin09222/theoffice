// The Lawyer: drafts from what's true, never invents the boss's facts, publishes only on the boss's tap, and warns about regulated businesses.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, floorState, until } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { analyze, draftPages, regulatedOf, reviewCopy, withFooter, renderPage, cleanFacts, missingFacts, HONESTY_LINE } from '../server/legal.js';
import { toolsForRole } from '../server/tools.js';
import { loadModels } from '../server/config.js';

const textOf = (pages) => JSON.stringify(pages);
const NONE = analyze({ files: [] });

describe('what is true of a project', () => {
  test('a plain page has no features, and each feature needs real evidence', () => {
    assert.ok(Object.entries(NONE).every(([, v]) => v === false), JSON.stringify(NONE));
    const f = analyze({ files: [{ path: 'index.html', content: '<form><input type="email" name="e"></form><script>office.auth.signUp(); office.ai.chat("hi")</script>' }] });
    assert.equal(f.forms, true); assert.equal(f.emailCollected, true); assert.equal(f.accounts, true); assert.equal(f.ai, true);
    assert.equal(f.payments, false); assert.equal(f.chat, false); assert.equal(f.adScripts, false);
    assert.equal(analyze({ files: [], paymentLink: 'https://buy.stripe.com/x' }).payments, true);
    assert.equal(analyze({ files: [], products: [{ interval: 'month' }] }).subscriptions, true);
    assert.equal(analyze({ files: [{ path: 'a.png', content: 'office.pay.checkout' }] }).payments, false, 'binary files are not read as code');
  });
  test('only true features appear in a draft', () => {
    const plain = textOf(draftPages({ title: 'Tiny Site', kind: 'site', features: NONE, facts: {} }));
    for (const word of ['Stripe', 'Refund', 'account', 'AI', 'chat', 'upload', 'email address', 'forms', 'Scores', 'ad network']) assert.ok(!plain.includes(word), `plain site mentions ${word}`);
    const pages = draftPages({ title: 'Shop', kind: 'site', features: { ...NONE, payments: true, accounts: true, chat: true }, facts: {} });
    assert.ok(pages.refunds, 'a project that takes money gets a Refund Policy');
    const t = textOf(pages);
    assert.match(t, /Stripe/); assert.match(t, /Your account/); assert.match(t, /chat/);
    assert.ok(!/AI features/.test(t) && !/Files you upload/.test(t));
    assert.equal(draftPages({ title: 'x', kind: 'game', features: NONE }).refunds, undefined);
  });
  test('the boss\'s facts are never invented: blanks stay visible placeholders', () => {
    const t = textOf(draftPages({ title: 'Tiny', kind: 'site', features: NONE, facts: {} }));
    assert.match(t, /\[waiting for the boss: legal or trading name\]/);
    assert.match(t, /\[waiting for the boss: country or state\]/);
    assert.match(t, /\[waiting for the boss: contact address\]/);
    assert.ok(!/@[a-z]+\.(com|org)|Ltd|LLC|Inc\b|California|London/.test(t), 'no made-up name, place or address');
    assert.deepEqual(missingFacts(cleanFacts({ legalName: '  ', region: 'UK' })), ['legalName', 'contact']);
    const given = textOf(draftPages({ title: 'Tiny', kind: 'site', features: NONE, facts: { legalName: 'Tiny Ltd', region: 'Wales', contact: 'hi@tiny.test' } }));
    assert.ok(given.includes('Tiny Ltd') && given.includes('Wales') && given.includes('hi@tiny.test') && !given.includes('waiting for the boss'));
  });
  test('regulated businesses are spotted', () => {
    for (const s of ['Lucky Star Casino', 'online sports betting tips', 'craft beer delivery', 'a vape shop', 'telehealth for skin', 'stock tips and crypto signals', 'a learning game for kids', 'counterfeit sneakers'])
      assert.ok(regulatedOf(s).length, s);
    for (const s of ['a bakery in town', 'a frog who delivers mail', 'a band that plays gigs']) assert.equal(regulatedOf(s).length, 0, s);
  });
  test('risky copy and borrowed names are flagged', () => {
    const flags = reviewCopy({ name: 'Pokemon Pals', files: [{ path: 'index.html', content: '<h2>What our customers say</h2><p>Guaranteed results. Lose 10 lbs! Earn $5,000 a week.</p>' }] }).map((f) => f.id);
    for (const id of ['reviews', 'guarantee', 'health-claim', 'money-claim', 'trademark-name']) assert.ok(flags.includes(id), id);
    assert.deepEqual(reviewCopy({ name: 'Night Owl Bakery', files: [{ path: 'index.html', content: '<p>Fresh bread every night.</p>' }] }), []);
  });
  test('published pages never claim a lawyer wrote them, and the footer links go in once', () => {
    const pages = draftPages({ title: 'Shop', kind: 'site', features: { ...NONE, payments: true }, facts: { legalName: 'A', region: 'B', contact: 'c@d.test' } });
    for (const p of Object.values(pages)) assert.ok(!/lawyer|attorney|solicitor|legal advice/i.test(renderPage(p, { site: 'Shop', updatedAt: 0, links: '' })));
    const html = withFooter('<html><body><p>hi</p></body></html>', '/', ['terms', 'privacy']);
    assert.match(html, /<a href="\/terms">Terms<\/a> · <a href="\/privacy">Privacy<\/a><\/footer><\/body>/);
    assert.equal(withFooter(html, '/', ['terms']), html);
  });
  test('he is Sonnet 5.5, a Lawyer, and has no way to spend, email out or publish', () => {
    const m = loadModels();
    assert.equal(m.hireable.lawyer.title, 'Lawyer'); assert.equal(m.hireable.lawyer.model, 'claude-sonnet-5-5');
    assert.match(m.hireable.lawyer.brief, /not a real one/);
    const tools = toolsForRole('lawyer');
    for (const t of ['publish_project', 'file_purchase_request', 'mail_send', 'mail_reply', 'request_domain', 'assign_task']) assert.ok(!tools.includes(t), t);
    assert.ok(tools.includes('ask_boss') && tools.includes('read_file'));
  });
});

describe('on a floor', () => {
  let t;
  before(async () => { t = await boot(); });
  after(async () => { await t.close(); });
  const floorOf = (c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const site = (c, slug, html, o = {}) => {
    const f = floorOf(c);
    run(t.db, 'DELETE FROM published_files WHERE floor_id=? AND project=?', f.id, slug);
    run(t.db, 'INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?,?,?,?,?)', f.id, slug, 'index.html', html, html.length);
    t.app.engine.upsertProject(f, slug, { title: o.title || slug, description: o.description || '', kind: 'site', sources: [], published: true });
  };
  const docOf = (c, slug) => get(t.db, 'SELECT * FROM legal_docs WHERE floor_id=? AND project=?', floorOf(c).id, slug);
  const page = (c, slug, path) => fetch(`${t.base}/f/${c.slug}/${slug}/${path}`);

  test('a new company gets Hollis the Lawyer by default', async () => {
    const c = await claim(t, 'Lamp Works');
    const s = await floorState(c);
    const law = s.agents.find((a) => a.role === 'lawyer');
    assert.ok(law, 'there is a lawyer'); assert.equal(law.title, 'Lawyer'); assert.equal(law.name, 'Hollis');
    assert.match(law.persona, /Dry, careful/);
    assert.equal(s.legal.lawyer.name, 'Hollis'); assert.equal(s.legal.canHire, false);
  });

  test('an existing company adds him with one tap, and nobody else is disturbed', async () => {
    const c = await claim(t, 'Old Firm');
    const f = floorOf(c);
    run(t.db, "DELETE FROM agents WHERE floor_id=? AND role='lawyer'", f.id);  // a floor from before the Lawyer existed
    const before = all(t.db, "SELECT id,name,role,state,task_id FROM agents WHERE floor_id=? ORDER BY id", f.id);
    let s = await floorState(c);
    assert.equal(s.legal.lawyer, null); assert.equal(s.legal.canHire, true);
    const r = await c.post(`/api/floors/${c.slug}/legal/hire`, {});
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.lawyer.name, 'Hollis');
    assert.deepEqual(all(t.db, "SELECT id,name,role,state,task_id FROM agents WHERE floor_id=? AND role!='lawyer' ORDER BY id", f.id), before);
    assert.equal((await c.post(`/api/floors/${c.slug}/legal/hire`, {})).status, 409);
    s = await floorState(c);
    assert.ok(s.agents.some((a) => a.role === 'lawyer' && a.title === 'Lawyer'));
  });

  test('drafts wait for the facts and the boss\'s tap, then go up at /terms and /privacy with footer links', async () => {
    const c = await claim(t, 'Candle Co');
    site(c, 'candles', '<html><body><h1>Candles</h1><p>Nice candles.</p></body></html>', { title: 'Candles' });
    await until(() => docOf(c, 'candles'), { what: 'a draft' });
    let s = await floorState(c);
    let d = s.legal.docs.find((x) => x.project === 'candles');
    assert.equal(d.status, 'needs_facts');
    assert.equal(s.legal.honesty, HONESTY_LINE);
    assert.match(HONESTY_LINE, /Drafted by AI, not legal advice\. Have a real lawyer check it before relying on it\./);
    const asked = all(t.db, "SELECT text FROM messages WHERE floor_id=? AND role='report'", floorOf(c).id).map((m) => m.text).join('\n');
    assert.match(asked, /legal or trading name/); assert.ok(asked.includes(HONESTY_LINE));
    // Nothing goes up without the facts, even with a tap.
    assert.equal((await c.post(`/api/floors/${c.slug}/legal/candles/approve`, { version: d.version })).status, 409);
    assert.equal((await page(c, 'candles', 'terms')).status, 404);
    assert.equal((await c.post(`/api/floors/${c.slug}/legal/facts`, { legalName: 'Candle Co Ltd', region: '' })).status, 400);
    const r = await c.post(`/api/floors/${c.slug}/legal/facts`, { legalName: 'Candle Co Ltd', region: 'Scotland', contact: 'hello@candle.test' });
    assert.equal(r.status, 200);
    d = r.data.docs.find((x) => x.project === 'candles');
    assert.equal(d.status, 'drafted'); assert.equal(d.pages.refunds, undefined);
    // Drafted is not published.
    assert.equal((await page(c, 'candles', 'terms')).status, 404);
    assert.ok(!(await (await page(c, 'candles', '')).text()).includes('data-office-legal'));
    // A visitor can't approve, and a stale version can't be approved.
    assert.equal((await fetch(`${t.base}/api/floors/${c.slug}/legal/candles/approve`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://${t.host}` }, body: JSON.stringify({ version: d.version }) })).status, 401);
    assert.equal((await c.post(`/api/floors/${c.slug}/legal/candles/approve`, { version: d.version + 5 })).status, 409);
    assert.equal((await c.post(`/api/floors/${c.slug}/legal/candles/approve`, { version: d.version })).status, 200);
    const terms = await page(c, 'candles', 'terms');
    assert.equal(terms.status, 200);
    const body = await terms.text();
    assert.match(body, /Terms of Use/); assert.match(body, /Candle Co Ltd/); assert.ok(!/lawyer|attorney/i.test(body));
    assert.equal((await page(c, 'candles', 'privacy')).status, 200);
    assert.equal((await page(c, 'candles', 'refunds')).status, 404, 'no Refund Policy for a site that takes no money');
    const home = await (await page(c, 'candles', '')).text();
    assert.match(home, /data-office-legal/); assert.match(home, /\/terms">Terms</);
  });

  test('payments switched on: he redrafts and asks again, and the old pages stay until the tap', async () => {
    const c = await claim(t, 'Mug Hut');
    await c.post(`/api/floors/${c.slug}/legal/facts`, { legalName: 'Mug Hut', region: 'Ohio', contact: 'mugs@hut.test' });
    site(c, 'mugs', '<html><body>Mugs</body></html>');
    await until(() => docOf(c, 'mugs')?.status === 'drafted', { what: 'a draft' });
    const v1 = docOf(c, 'mugs').version;
    assert.equal((await c.post(`/api/floors/${c.slug}/legal/mugs/approve`, { version: v1 })).status, 200);
    run(t.db, "UPDATE projects SET payment_link='https://buy.stripe.com/test' WHERE floor_id=? AND slug='mugs'", floorOf(c).id);
    await c.post(`/api/floors/${c.slug}/legal/mugs/redraft`, {});
    const d = docOf(c, 'mugs');
    assert.equal(d.status, 'drafted'); assert.ok(d.version > v1); assert.equal(d.live_version, v1);
    assert.ok(JSON.parse(d.pages).refunds, 'a Refund Policy now');
    assert.equal((await page(c, 'mugs', 'refunds')).status, 404, 'not until the boss taps');
    assert.equal((await c.post(`/api/floors/${c.slug}/legal/mugs/approve`, { version: d.version })).status, 200);
    assert.equal((await page(c, 'mugs', 'refunds')).status, 200);
  });

  test('a regulated business gets the real-lawyer warning and no routine draft', async () => {
    const c = await claim(t, 'Lucky Star Casino');
    await c.post(`/api/floors/${c.slug}/legal/facts`, { legalName: 'Lucky Star', region: 'Nevada', contact: 'x@lucky.test' });
    site(c, 'slots', '<html><body>Spin to win real money prizes</body></html>', { title: 'Slots' });
    await until(() => docOf(c, 'slots'), { what: 'a review' });
    const d = docOf(c, 'slots');
    assert.equal(d.status, 'regulated'); assert.deepEqual(JSON.parse(d.pages), {});
    const said = all(t.db, "SELECT text FROM messages WHERE floor_id=? AND role='report'", floorOf(c).id).map((m) => m.text).join('\n');
    assert.match(said, /needs a real lawyer before launch/);
    assert.equal((await c.post(`/api/floors/${c.slug}/legal/slots/approve`, { version: d.version })).status, 409);
  });

  test('risky copy is flagged to the boss, and The Office has its own Terms page', async () => {
    const c = await claim(t, 'Glow Shop');
    site(c, 'glow', '<html><body><h2>What our customers say</h2><p>Guaranteed results!</p></body></html>');
    await until(() => docOf(c, 'glow'), { what: 'a review' });
    const flags = JSON.parse(docOf(c, 'glow').flags).map((f) => f.id);
    assert.ok(flags.includes('reviews') && flags.includes('guarantee'));
    const r = await fetch(`${t.base}/terms`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /you are the seller/i); assert.match(html, /chargebacks/); assert.match(html, /provided as it is/i); assert.match(html, /office@iscolinfree\.com/);
    assert.match(await (await fetch(`${t.base}/privacy`)).text(), /\/theoffice\/terms/);
  });
});
