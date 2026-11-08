#!/usr/bin/env node
// One-time email setup against Resend (docs/MAIL.md). Needs RESEND_API_KEY in the environment.
//   node scripts/mail-setup.mjs <secret-file> [--domain middistance.com] [--endpoint URL] [--region us-east-1] [--verify]
// Creates or finds MAIL_DOMAIN with sending and receiving on, prints the DNS records to add (they are not secret), creates or finds the
// webhook for email.received, email.bounced and email.complained, and writes its signing secret to <secret-file> with mode 600.
// It never prints the key or the signing secret.
import { writeFileSync, chmodSync, existsSync } from 'node:fs';
import { createResend, RESEND_API } from '../server/mail-provider.js';

const args = process.argv.slice(2);
const flag = (name, d) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const secretFile = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--verify'));
const key = process.env.RESEND_API_KEY || '';
const domain = String(flag('--domain', process.env.MAIL_DOMAIN || 'middistance.com')).toLowerCase();
const endpoint = flag('--endpoint', 'https://iscolinfree.com/theoffice/api/mail/inbound');
const region = flag('--region', 'us-east-1');
const EVENTS = ['email.received', 'email.bounced', 'email.complained'];
const hide = (s) => (key ? String(s).split(key).join('[redacted]') : String(s)).replace(/whsec_[A-Za-z0-9+/=]+/g, 'whsec_[redacted]');
const die = (m) => { console.error(hide(m)); process.exit(1); };

if (!key) die('Set RESEND_API_KEY in the environment first (it is read from there and never printed).');
if (!secretFile) die('Usage: node scripts/mail-setup.mjs <secret-file> [--domain middistance.com] [--endpoint URL] [--region us-east-1] [--verify]');
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) die(`"${domain}" is not a domain.`);
if (!/^https:\/\//.test(endpoint)) die('The webhook endpoint must be https.');
const api = createResend({ apiKey: key, base: (process.env.RESEND_API_BASE || RESEND_API).replace(/\/+$/, '') });

try {
  // 1. The domain, with receiving on.
  const list = (await api.listDomains())?.data || [];
  let d = list.find((x) => String(x.name).toLowerCase() === domain);
  if (!d) {
    d = await api.createDomain({ name: domain, region, capabilities: { sending: 'enabled', receiving: 'enabled' }, open_tracking: false, click_tracking: false });
    console.log(`Created ${domain} in Resend (${region}).`);
  } else console.log(`Found ${domain} in Resend (status: ${d.status}).`);
  if (d.capabilities?.receiving !== 'enabled') { await api.updateDomain(d.id, { capabilities: { receiving: 'enabled' } }); console.log('Switched receiving on.'); }
  const full = await api.getDomain(d.id);
  console.log(`\nDNS records for ${domain} (add these at the DNS host; names are relative to ${domain}, "@" is the domain itself):`);
  for (const r of full.records || []) console.log(`  ${String(r.type).padEnd(5)} ${String(r.name).padEnd(22)} ${r.priority !== undefined ? `priority ${r.priority}  ` : ''}${r.value}   [${r.record}, ${r.status}]`);
  console.log('Receiving needs the MX record on the domain itself. If the domain already has MX records for other mail, read docs/MAIL.md first.');
  if (args.includes('--verify')) { await api.verifyDomain(d.id); console.log('Asked Resend to check the records now. Run again later to see their status.'); }

  // 2. The webhook, and its signing secret into the file.
  const hooks = (await api.listWebhooks())?.data || [];
  let hook = hooks.find((w) => w.endpoint === endpoint);
  let secret = '';
  if (hook) {
    const got = await api.getWebhook(hook.id);
    secret = got.signing_secret || '';
    const missing = EVENTS.filter((e) => !(got.events || []).includes(e));
    if (missing.length || got.status === 'disabled') { await api.updateWebhook(hook.id, { events: [...new Set([...(got.events || []), ...EVENTS])], status: 'enabled' }); console.log(`\nUpdated the webhook to send ${EVENTS.join(', ')}.`); } else console.log('\nFound the webhook.');
  } else {
    if (hooks.length) console.log(`\nNote: the account already has ${hooks.length} other webhook(s). The free plan allows one endpoint.`);
    hook = await api.createWebhook({ endpoint, events: EVENTS });
    secret = hook.signing_secret || '';
    console.log(`\nCreated the webhook to ${endpoint} for ${EVENTS.join(', ')}.`);
  }
  if (!/^whsec_/.test(secret)) die('Resend did not return a signing secret.');
  const existed = existsSync(secretFile);
  writeFileSync(secretFile, `${secret}\n`, { mode: 0o600 });
  chmodSync(secretFile, 0o600);
  console.log(`${existed ? 'Replaced' : 'Wrote'} the webhook signing secret in ${secretFile} (mode 600). Set RESEND_WEBHOOK_SECRET from it in the server's environment.`);
} catch (e) { die(`Resend: ${e?.message || e}`); }
