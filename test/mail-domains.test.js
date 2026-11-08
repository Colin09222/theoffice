// A company's own domain for email: routing by full address across domains, the DNS merge that must never lose a record, the limit on domains,
// and the building's address doing the work until a domain is verified. Resend is server/mail-mock.js and Namecheap is test/stubs/namecheap.mjs.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { get, all, run } from '../server/db.js';
import { boot, claim, until, adminClient } from './helpers.js';
import { toolsForRole } from '../server/tools.js';
import { startMockResend } from '../server/mail-mock.js';
import { startNamecheapStub } from './stubs/namecheap.mjs';
import { mergeHosts, sameRecord } from '../server/namecheap.js';
import { recordsToZone, cleanEmailDomain, sendingReady, EmailDomainRefused, MAIL_LOCALS } from '../server/mail-domains.js';
import { mailStatus, mailStatusText } from '../server/mail.js';

const open = [];
after(async () => { for (const c of open) await c(); });

async function start(over = {}) {
  const mock = await startMockResend();
  const stub = await startNamecheapStub();
  const t = await boot({
    resendApiKey: mock.apiKey, resendWebhookSecret: mock.webhookSecret, resendApiBase: mock.base, mailTickMs: 3600000,
    namecheapUser: 'colin', namecheapKey: 'NCSECRETKEY123', namecheapClientIp: '203.0.113.7', namecheapBase: stub.url, domainContactSource: 'owned-already.com', serverIp: '198.51.100.9', appsBaseDomain: 'apps.localhost', appsScheme: 'http', domainReconcileMs: 1e9, publicOrigin: '', peopleTalk: false, ...over,
  });
  open.push(async () => { await t.close(); await mock.close(); await stub.close(); });
  t.mock = mock; t.stub = stub; t.hook = `${t.base}/api/mail/inbound`;
  t.app.engine.runManager = async () => {};
  t.mail = t.app.engine.mail; t.domains = t.mail.domains;
  return t;
}
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const row = (t, d) => get(t.db, 'SELECT * FROM mail_domains WHERE domain=?', d);
const inbox = (t, c) => all(t.db, "SELECT * FROM mail_messages WHERE floor_id=? AND direction='in' ORDER BY id", floorOf(t, c).id);
const zoneOf = (t, d) => t.stub.state.hosts.get(d) || [];
/** A domain bought through The Office and attached to a project: live, in the building's Namecheap account, with the site's records on it. */
function live(t, c, domain, hosts = [{ host: '@', type: 'A', address: '198.51.100.9', ttl: '1800' }, { host: 'www', type: 'A', address: '198.51.100.9', ttl: '1800' }]) {
  const f = floorOf(t, c);
  t.stub.state.owned.add(domain); t.stub.state.hosts.set(domain, hosts.map((h) => ({ ...h })));
  const n = Date.now();
  run(t.db, "INSERT INTO domain_orders (floor_id,domain,project,why,status,quoted_usd,created_at,updated_at) VALUES (?,?,?,?,'live',?,?,?)", f.id, domain, 'launch', 'x', 11.28, n, n);
}
/** The mail tick, as many rounds as it takes, with no waiting between them. */
async function settle(t, rounds = 4) { for (let i = 0; i < rounds; i++) { run(t.db, 'UPDATE mail_domains SET next_at=0 WHERE next_at>0'); await t.domains.tick(); } }
/** Fetching is the tick's job in the real building (a drain that is just finishing doesn't see a row written that instant). The tests have no tick, so they ask. */
async function mailIn(t, opts) {
  const r = t.mock.receive(opts); const d = await t.mock.deliver(t.hook, r.event); assert.equal(d.status, 200, d.body);
  for (let i = 0; i < 200 && get(t.db, 'SELECT 1 x FROM mail_inbound WHERE done_at IS NULL'); i++) { await t.mail.drain(); await new Promise((f) => setTimeout(f, 2)); }
  return r;
}
const staffSend = (t, c, role, to, subject = 'Hello', body = 'Hello there, from the company.') => {
  const f = floorOf(t, c);
  const a = get(t.db, 'SELECT * FROM agents WHERE floor_id=? AND role=?', f.id, role);
  return t.app.engine.tools.exec(t.app.engine.toolCtx(f, a, null, toolsForRole(role)), 'mail_send', JSON.stringify({ to, subject, body }));
};
const bossSend = (t, c, to, subject = 'Hello') => c.post(`/api/floors/${c.slug}/mail/send`, { to, subject, text: 'A word from the boss.' });
const lastSent = (t) => t.mock.state.sent.at(-1);

describe('the merge of DNS records', () => {
  const site = [{ host: '@', type: 'A', address: '198.51.100.9', ttl: 1800 }, { host: 'www', type: 'CNAME', address: 'site.example.net.', ttl: 1800 }, { host: '@', type: 'TXT', address: 'google-site-verification=abc', ttl: 1800 }, { host: '@', type: 'CAA', address: 'letsencrypt.org', flag: '0', tag: 'issue', ttl: 1800 }];
  const mailRecords = [{ host: 'send', type: 'MX', address: 'feedback-smtp.us-east-1.amazonses.com', mxPref: 10, ttl: 300 }, { host: 'send', type: 'TXT', address: 'v=spf1 include:amazonses.com ~all', ttl: 300 }, { host: 'resend._domainkey', type: 'TXT', address: 'p=KEY', ttl: 300 }, { host: '@', type: 'MX', address: 'inbound-smtp.us-east-1.amazonaws.com', mxPref: 10, ttl: 300 }];

  test('everything on the zone stays, and running it twice changes nothing', () => {
    const merged = mergeHosts(site, mailRecords);
    for (const r of site) assert.ok(merged.some((m) => sameRecord(m, r)), r.host);
    for (const r of mailRecords) assert.ok(merged.some((m) => sameRecord(m, r)), r.host);
    assert.equal(merged.length, site.length + mailRecords.length);
    assert.deepEqual(mergeHosts(merged, mailRecords), merged);
  });

  test('a replacement only touches the same name: an email record on send, never a site record on @', () => {
    const had = [...site, { host: 'send', type: 'TXT', address: 'v=spf1 old ~all', ttl: 300 }];
    const merged = mergeHosts(had, mailRecords, (a, old) => ['send', 'resend._domainkey'].includes(a.host) && old.type === a.type);
    assert.ok(!merged.some((m) => m.address === 'v=spf1 old ~all'), 'the old copy is replaced');
    for (const r of site) assert.ok(merged.some((m) => sameRecord(m, r)), r.host);
  });

  test('Resend\'s records become registrar records: relative names, no stray quotes, priorities kept', () => {
    const z = recordsToZone([{ record: 'SPF', name: 'send.co.example', type: 'TXT', value: '"v=spf1 include:amazonses.com ~all"' }, { record: 'SPF', name: 'send', type: 'MX', value: 'feedback.amazonses.com', priority: 10 }, { record: 'Receiving', name: '@', type: 'MX', value: 'inbound.amazonaws.com', priority: 10 }, { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', value: 'p=K' }, { name: 'skip', type: 'A', value: '1.2.3.4' }], 'co.example');
    assert.deepEqual(z.map((r) => r.host), ['send', 'send', '@', 'resend._domainkey']);
    assert.equal(z[0].address, 'v=spf1 include:amazonses.com ~all');
    assert.equal(z[1].mxPref, 10); assert.equal(z[3].mxPref, undefined);
  });

  test('the zone at the registrar keeps every record and gets custom MX', async () => {
    const t = await start();
    const c = await claim(t, 'Teacups');
    live(t, c, 'teacups.com', [
      { host: '@', type: 'A', address: '198.51.100.9', ttl: '1800' }, { host: '@', type: 'AAAA', address: '2001:db8::9', ttl: '1800' }, { host: 'www', type: 'CNAME', address: 'teacups.apps.localhost.', ttl: '1800' },
      { host: 'blog', type: 'A', address: '203.0.113.20', ttl: '3600' }, { host: '@', type: 'TXT', address: 'google-site-verification=abc', ttl: '1800' }, { host: '_dmarc', type: 'TXT', address: 'v=DMARC1; p=reject;', ttl: '1800' },
      { host: 'app', type: 'MX', address: 'mx.elsewhere.example.', mxPref: '20', ttl: '1800' }, { host: '@', type: 'CAA', address: '0 issue "letsencrypt.org"', flag: '0', tag: 'issue', ttl: '1800' },
    ]);
    const before = zoneOf(t, 'teacups.com').map((h) => ({ ...h }));
    await settle(t);
    const after = zoneOf(t, 'teacups.com');
    for (const r of before) assert.ok(after.some((h) => h.host === r.host && h.type === r.type && String(h.address).toLowerCase() === String(r.address).toLowerCase()), `kept ${r.host} ${r.type}`);
    for (const want of [['send', 'MX'], ['send', 'TXT'], ['resend._domainkey', 'TXT'], ['@', 'MX']]) assert.ok(after.some((h) => h.host === want[0] && h.type === want[1]), `added ${want}`);
    assert.equal(after.filter((h) => h.host === '_dmarc').length, 1, 'an existing DMARC record is left alone');
    assert.equal(t.stub.state.emailType.get('teacups.com'), 'MX');
    assert.equal(t.stub.state.lastSetHosts.EmailType, 'MX');
    assert.equal(row(t, 'teacups.com').status, 'verifying');
    assert.ok(t.stub.count('namecheap.domains.dns.getHosts') >= 1, 'read before written');
    // A second pass over a domain that has its records writes nothing new.
    const again = await t.app.engine.domains.addMailRecords('teacups.com', recordsToZone(t.mock.state.domains[0].records, 'teacups.com'));
    assert.equal(again.result, 'done');
    assert.equal(zoneOf(t, 'teacups.com').length, after.length);
    assert.ok(!t.logs.some((l) => l.includes('NCSECRETKEY123')), 'no key in the logs');
  });

  test('a domain that already gets email is left exactly as it is: an apex MX, or forwarding rules', async () => {
    const t = await start();
    const c = await claim(t, 'Clay Mugs');
    live(t, c, 'claymugs.com', [{ host: '@', type: 'A', address: '198.51.100.9', ttl: '1800' }, { host: '@', type: 'MX', address: 'aspmx.l.google.com.', mxPref: '1', ttl: '1800' }]);
    const before = JSON.stringify(zoneOf(t, 'claymugs.com'));
    await settle(t);
    assert.equal(row(t, 'claymugs.com').status, 'conflict');
    assert.equal(t.stub.count('namecheap.domains.dns.setHosts'), 0, 'nothing written');
    assert.equal(JSON.stringify(zoneOf(t, 'claymugs.com')), before);
    assert.equal(t.mail.addressOf(floorOf(t, c).id), 'clay-mugs@middistance.com');
    assert.match(all(t.db, "SELECT text FROM mail_alerts WHERE kind='domain_conflict'")[0].text, /claymugs\.com/);

    const c2 = await claim(t, 'Fwd Co');
    live(t, c2, 'fwdco.com');
    t.stub.state.forwards.set('fwdco.com', [{ mailbox: 'me', to: 'someone@gmail.com' }]);
    await settle(t);
    assert.equal(row(t, 'fwdco.com').status, 'conflict');
    assert.equal(t.stub.count('namecheap.domains.dns.setHosts'), 0);
  });

  test('when the zone can\'t be read, nothing is written; a domain not on Namecheap\'s DNS shows the boss the records', async () => {
    const t = await start();
    const c = await claim(t, 'Read First');
    live(t, c, 'readfirst.com');
    t.stub.state.failAlways['namecheap.domains.dns.getHosts'] = 'timeout';
    await t.domains.tick();
    await t.domains.tick();
    assert.equal(t.stub.count('namecheap.domains.dns.setHosts'), 0, 'no write without a read');
    delete t.stub.state.failAlways['namecheap.domains.dns.getHosts'];

    const c2 = await claim(t, 'Own Dns');
    live(t, c2, 'owndns.com');
    t.stub.state.notOurDns.add('owndns.com');
    await settle(t);
    const r = row(t, 'owndns.com');
    assert.equal(r.status, 'records');
    assert.equal(r.held, 'outside');
    const v = await c2.get(`/api/floors/${c2.slug}/mail`);
    assert.ok(v.data.ownDomain.domains[0].records.some((x) => x.type === 'MX'));
    assert.equal(v.data.ownDomain.domains[0].canCheck, true);
  });
});

describe('one company, several addresses', () => {
  test('inbound routes by full address on any of its domains, the old address keeps arriving, and strangers are dropped', async () => {
    const t = await start();
    const c = await claim(t, 'Teacups');
    const other = await claim(t, 'Saucers');
    t.mail.ensureAddress(floorOf(t, c)); t.mail.ensureAddress(floorOf(t, other));
    live(t, c, 'teacups.com'); live(t, other, 'saucers.com');
    await settle(t);
    t.mock.verify('teacups.com'); t.mock.verify('saucers.com');
    await settle(t);
    await mailIn(t, { to: ['hello@teacups.com'], subject: 'On the new address' });
    await mailIn(t, { to: ['Teacups <HELLO@TeaCups.com>'], subject: 'Capitals too' });
    await mailIn(t, { to: ['teacups@middistance.com'], subject: 'On the old address' });
    await mailIn(t, { to: ['nobody@teacups.com'], subject: 'Nobody here' });
    await mailIn(t, { to: ['hello@saucers.com'], subject: 'For the other company' });
    await mailIn(t, { to: ['hello@stranger.com'], subject: 'Not ours at all' });
    await until(() => inbox(t, c).length === 3 && inbox(t, other).length === 1, { what: 'mail filed by address' });
    assert.deepEqual(inbox(t, c).map((m) => m.subject).sort(), ['Capitals too', 'On the new address', 'On the old address']);
    assert.equal(inbox(t, other)[0].subject, 'For the other company');
    await until(() => all(t.db, "SELECT outcome FROM mail_inbound WHERE outcome='unknown_recipient'").length === 2, { what: 'the unknown dropped' });

    // Changing the name: the old one keeps arriving, the new one sends.
    const r = await c.post(`/api/floors/${c.slug}/mail/domain/local`, { domain: 'teacups.com', local: 'team' });
    assert.equal(r.status, 200);
    assert.equal(t.mail.addressOf(floorOf(t, c).id), 'team@teacups.com');
    await mailIn(t, { to: ['hello@teacups.com'], subject: 'Old name, still here' });
    await mailIn(t, { to: ['team@teacups.com'], subject: 'New name' });
    await until(() => inbox(t, c).length === 5, { what: 'both names filed' });
    assert.equal((await c.post(`/api/floors/${c.slug}/mail/domain/local`, { domain: 'teacups.com', local: 'ceo' })).status, 400, 'only the offered names');
    assert.ok(MAIL_LOCALS.includes('hello') && MAIL_LOCALS.includes('support'));
  });

  test('mail reaches a company while its domain is still being confirmed', async () => {
    const t = await start();
    const c = await claim(t, 'Early Bird');
    live(t, c, 'earlybird.com');
    await settle(t);
    assert.equal(row(t, 'earlybird.com').status, 'verifying');
    await mailIn(t, { to: ['hello@earlybird.com'], subject: 'Before verified' });
    await until(() => inbox(t, c).length === 1, { what: 'early mail' });
  });

  test('another company on the building\'s domains counts for the loop guard', async () => {
    const t = await start();
    const c = await claim(t, 'Alpha Corp');
    const other = await claim(t, 'Beta Corp');
    live(t, c, 'alphacorp.com'); live(t, other, 'betacorp.com');
    await settle(t);
    t.mock.verify('alphacorp.com'); t.mock.verify('betacorp.com');
    await settle(t);
    await mailIn(t, { from: 'Beta <hello@betacorp.com>', to: ['hello@alphacorp.com'], subject: 'Hi from next door' });
    await until(() => inbox(t, c).length === 1, { what: 'filed' });
    assert.match(inbox(t, c)[0].machine, /another-company-here/);
    const reply = await t.mail.toolReply({ floor: floorOf(t, c), agent: get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floorOf(t, c).id) }, inbox(t, c)[0].id, 'Thanks!').catch((e) => e);
    assert.match(String(reply?.message || reply), /machine|mailing list/);
    assert.equal(t.mock.state.sent.length, 0);
  });
});

describe('sending', () => {
  test('before a domain is verified it goes from middistance.com under the company name; afterwards from the domain', async () => {
    const t = await start();
    const c = await claim(t, 'Teacups');
    const f = floorOf(t, c);
    assert.equal((await bossSend(t, c, 'sam@example.com')).status, 200);
    assert.equal(lastSent(t).from, '"Teacups" <teacups@middistance.com>', 'no domain at all');
    live(t, c, 'teacups.com');
    await settle(t);
    assert.equal(row(t, 'teacups.com').status, 'verifying');
    assert.equal(t.mail.addressOf(f.id), 'teacups@middistance.com');
    await bossSend(t, c, 'sam@example.com');
    assert.equal(lastSent(t).from, '"Teacups" <teacups@middistance.com>', 'not verified yet');
    t.mock.verify('teacups.com', { status: 'partially_verified' });  // receiving still waiting, sending good: that is enough to send
    await settle(t);
    assert.equal(row(t, 'teacups.com').status, 'verified');
    assert.equal(t.mail.addressOf(f.id), 'hello@teacups.com');
    await bossSend(t, c, 'sam@example.com', 'From the domain');
    assert.equal(lastSent(t).from, '"Teacups" <hello@teacups.com>');
    const m = get(t.db, "SELECT * FROM mail_messages WHERE floor_id=? AND direction='out' ORDER BY id DESC LIMIT 1", f.id);
    assert.equal(m.from_addr, 'hello@teacups.com');
    assert.equal(sendingReady({ status: 'not_started' }), false);
    assert.match((await c.get(`/api/floors/${c.slug}/mail`)).data.ownDomain.domains[0].line, /hello@teacups\.com/);
  });

  test('every mail rule still applies from an own domain: a new address waits for the boss, suppression and caps hold', async () => {
    const t = await start({ mailFloorDaily: 2 });
    const c = await claim(t, 'Teacups');
    live(t, c, 'teacups.com');
    await settle(t);
    t.mock.verify('teacups.com');
    await settle(t);
    const out = await staffSend(t, c, 'manager', 'new.person@example.com');
    assert.match(out, /waiting|boss/i);
    assert.equal(t.mock.state.sent.length, 0);
    run(t.db, "INSERT INTO mail_suppressed (address,reason,created_at) VALUES ('gone@example.com','bounced',1)");
    assert.equal((await bossSend(t, c, 'gone@example.com')).status, 409);
    await bossSend(t, c, 'one@example.com'); await bossSend(t, c, 'two@example.com');
    const third = await bossSend(t, c, 'three@example.com');
    assert.equal(third.data.status, 'failed');
    assert.equal(t.mock.state.sent.length, 2);
    assert.equal(t.mock.state.sent[0].from, '"Teacups" <hello@teacups.com>');
  });

  test('if the provider refuses the domain, that email still goes, from middistance.com, and the domain gets looked at', async () => {
    const t = await start();
    const c = await claim(t, 'Teacups');
    live(t, c, 'teacups.com');
    await settle(t);
    t.mock.verify('teacups.com');
    await settle(t);
    t.mock.state.refuseFrom.add('teacups.com');
    const r = await bossSend(t, c, 'sam@example.com');
    assert.equal(r.data.status, 'sent');
    assert.equal(lastSent(t).from, '"Teacups" <teacups@middistance.com>');
    assert.equal(row(t, 'teacups.com').next_at, 0);
    t.mock.state.domains[0].status = 'pending';
    await settle(t, 1);
    assert.equal(row(t, 'teacups.com').status, 'verifying');
    assert.equal(t.mail.addressOf(floorOf(t, c).id), 'teacups@middistance.com', 'back to the building\'s address until it is good again');
    t.mock.verify('teacups.com');
    await settle(t);
    assert.equal(t.mail.addressOf(floorOf(t, c).id), 'hello@teacups.com');
  });
});

describe('the limit on domains', () => {
  test('MAIL_MAX_DOMAINS counts middistance.com; when full the boss hears it kindly, email stays put, the admin is told', async () => {
    const t = await start({ mailMaxDomains: 2 });
    const c1 = await claim(t, 'First Company');
    const c2 = await claim(t, 'Second Company');
    const notes = [];
    const bn = t.app.engine.bossNotice.bind(t.app.engine);
    t.app.engine.bossNotice = (fid, text) => { notes.push({ fid, text }); return bn(fid, text); };
    live(t, c1, 'firstco.com'); live(t, c2, 'secondco.com');
    await settle(t);
    assert.equal(t.domains.usedPlaces(), 2);
    assert.equal(row(t, 'firstco.com').status, 'verifying');
    assert.equal(row(t, 'secondco.com').status, 'full');
    const v = await c2.get(`/api/floors/${c2.slug}/mail`);
    assert.equal(v.data.address, 'second-company@middistance.com', 'email stays on the building\'s domain');
    assert.match(v.data.ownDomain.domains[0].line, /taken right now/);
    assert.doesNotMatch(JSON.stringify(v.data.ownDomain) + notes.map((n) => n.text).join(' '), /\$|\bUSD\b|dollar|plan\b/i);
    assert.equal(t.mock.state.domains.length, 1, 'nothing created at the provider');
    assert.equal(notes.filter((n) => /taken/.test(n.text)).length, 1);
    await settle(t);
    assert.equal(all(t.db, "SELECT * FROM mail_alerts WHERE kind='domains_full'").length, 1, 'alerted once');
    assert.equal(notes.filter((n) => /taken/.test(n.text)).length, 1, 'told once');
    const admin = await adminClient(t);
    const a = await admin.get('/api/admin/mail');
    assert.equal(a.data.domainPlaces.used, 2); assert.equal(a.data.domainPlaces.max, 2);
    assert.ok(a.data.alerts.some((x) => x.kind === 'domains_full'));
    assert.match(mailStatusText(mailStatus(t.db, t.mail.settings)), /2 of 2 places/);

    // A place opens up: the waiting company moves by itself.
    await c1.post(`/api/floors/${c1.slug}/mail/domain/remove`, { domain: 'firstco.com' });
    assert.equal(t.domains.usedPlaces(), 1);
    await settle(t);
    assert.equal(row(t, 'secondco.com').status, 'verifying');
  });

  test('the provider running out of room reads as full, not as a failure', async () => {
    const t = await start();
    t.mock.state.maxDomains = 0;
    const c = await claim(t, 'Teacups');
    live(t, c, 'teacups.com');
    await settle(t);
    assert.equal(row(t, 'teacups.com').status, 'full');
    assert.ok(all(t.db, "SELECT * FROM mail_alerts WHERE kind='domains_full'").length === 1);
  });
});

describe('what the boss can do', () => {
  test('a domain held elsewhere shows the records and a re-check that goes live once they are there', async () => {
    const t = await start();
    const c = await claim(t, 'Teacups');
    const first = await c.post(`/api/floors/${c.slug}/mail/domain`, { domain: 'https://www.teacups-shop.co/' });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const d = first.data.domains[0];
    assert.equal(d.domain, 'teacups-shop.co'); assert.equal(d.status, 'records'); assert.equal(d.held, 'outside');
    assert.ok(d.records.length >= 4 && d.records.some((r) => r.type === 'TXT'));
    assert.equal(t.stub.count('namecheap.domains.dns.setHosts'), 0, 'not the building\'s to write');
    assert.equal((await c.post(`/api/floors/${c.slug}/mail/domain/check`, { domain: 'teacups-shop.co' })).data.domains[0].status, 'records');
    t.mock.verify('teacups-shop.co');
    assert.equal((await c.post(`/api/floors/${c.slug}/mail/domain/check`, { domain: 'teacups-shop.co' })).data.domains[0].status, 'verified');
    await bossSend(t, c, 'sam@example.com');
    assert.equal(lastSent(t).from, '"Teacups" <hello@teacups-shop.co>');
  });

  test('the building\'s own names, a mailbox company, and someone else\'s domain are refused', async () => {
    const t = await start();
    const c = await claim(t, 'Teacups');
    const other = await claim(t, 'Saucers');
    assert.throws(() => cleanEmailDomain('apps.localhost', ['apps.localhost']), EmailDomainRefused);
    for (const bad of ['gmail.com', 'not a domain', 'middistance.com', 'x.middistance.com']) assert.equal((await c.post(`/api/floors/${c.slug}/mail/domain`, { domain: bad })).status, 400, bad);
    live(t, other, 'saucers.com');
    await settle(t);
    assert.equal((await c.post(`/api/floors/${c.slug}/mail/domain`, { domain: 'saucers.com' })).status, 400);
    assert.equal((await c.post(`/api/floors/${c.slug}/mail/domain/check`, { domain: 'saucers.com' })).status, 400, 'another floor\'s domain');
    assert.equal(row(t, 'saucers.com').floor_id, floorOf(t, other).id);
  });

  test('stopping uses gives the place back, and mail to the domain no longer arrives', async () => {
    const t = await start();
    const c = await claim(t, 'Teacups');
    live(t, c, 'teacups.com');
    await settle(t);
    t.mock.verify('teacups.com');
    await settle(t);
    assert.equal(t.mock.state.domains.length, 1);
    await c.post(`/api/floors/${c.slug}/mail/domain/remove`, { domain: 'teacups.com' });
    assert.equal(t.mock.state.domains.length, 0);
    assert.equal(t.mail.addressOf(floorOf(t, c).id), 'teacups@middistance.com');
    await mailIn(t, { to: ['hello@teacups.com'], subject: 'After' });
    await until(() => all(t.db, "SELECT outcome FROM mail_inbound WHERE outcome='unknown_recipient'").length === 1, { what: 'dropped' });
    await settle(t);
    assert.equal(row(t, 'teacups.com').status, 'removed', 'it doesn\'t come back by itself');
  });

  test('visitors get none of it', async () => {
    const t = await start();
    const c = await claim(t, 'Teacups');
    const { Client } = await import('./helpers.js');
    const stranger = new Client(t);
    assert.equal((await stranger.post(`/api/floors/${c.slug}/mail/domain`, { domain: 'x.com' })).status, 401);
  });

  test('the staff and the boss\'s page see the new address', async () => {
    const t = await start();
    const c = await claim(t, 'Teacups');
    const f = floorOf(t, c);
    live(t, c, 'teacups.com');
    await settle(t);
    t.mock.verify('teacups.com');
    await settle(t);
    assert.match(t.mail.stateLine(f.id), /hello@teacups\.com/);
    assert.match(t.mail.toolInbox(f), /hello@teacups\.com/);
    const v = await c.get(`/api/floors/${c.slug}/mail`);
    assert.equal(v.data.address, 'hello@teacups.com'); assert.equal(v.data.onOwnDomain, true); assert.equal(v.data.canChange, false);
    assert.equal(v.data.buildingAddress, 'teacups@middistance.com');
    assert.equal((await c.get(`/api/floors/${c.slug}`)).data.mail.address, 'hello@teacups.com');
  });
});
