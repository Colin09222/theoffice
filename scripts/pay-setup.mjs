#!/usr/bin/env node
// One-time payments setup against Stripe (docs/PAYMENTS.md). Needs STRIPE_SECRET_KEY in the environment.
//   node scripts/pay-setup.mjs <secret-file> [--endpoint URL] [--rotate]
// Creates the Connect webhook endpoint for The Office and writes its signing secret to <secret-file> with mode 600. Stripe shows a secret only once,
// at creation, so an endpoint that already exists is left alone unless you pass --rotate, which makes a new one and removes the old one.
// It never prints the key or the signing secret.
import { writeFileSync, chmodSync, existsSync } from 'node:fs';
import { createStripe, keyMode, WEBHOOK_EVENTS, STRIPE_VERSION, STRIPE_API, hideKeys } from '../server/cloud/pay-provider.js';

const args = process.argv.slice(2);
const flag = (name, d) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const secretFile = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--rotate'));
const key = process.env.STRIPE_SECRET_KEY || '';
const endpoint = flag('--endpoint', 'https://iscolinfree.com/theoffice/api/pay/webhook');
const rotate = args.includes('--rotate');
const hide = (s) => hideKeys(key ? String(s).split(key).join('[redacted]') : String(s));
const die = (m) => { console.error(hide(m)); process.exit(1); };

if (!keyMode(key)) die('Set STRIPE_SECRET_KEY in the environment first (it is read from there and never printed).');
if (!secretFile) die('Usage: node scripts/pay-setup.mjs <secret-file> [--endpoint URL] [--rotate]');
if (!/^https:\/\//.test(endpoint) && !process.env.STRIPE_API_BASE) die('The webhook endpoint must be https.');
const stripe = createStripe({ apiKey: key, base: (process.env.STRIPE_API_BASE || STRIPE_API).replace(/\/+$/, '') });

try {
  const existing = ((await stripe.listWebhookEndpoints())?.data || []).filter((w) => w.url === endpoint && w.application);
  if (existing.length && !rotate) {
    console.log(`A Connect webhook endpoint for ${endpoint} already exists (${existing[0].id}). Stripe only shows a signing secret when it is created.`);
    if (existsSync(secretFile)) console.log(`${secretFile} is already there, so nothing was changed.`);
    else die(`Run again with --rotate to replace it and get a new signing secret in ${secretFile}.`);
    process.exit(0);
  }
  const made = await stripe.createWebhookEndpoint({ url: endpoint, enabled_events: WEBHOOK_EVENTS, connect: true, api_version: STRIPE_VERSION, description: 'The Office: payments from connected accounts' });
  if (!made.secret) die('Stripe did not return a signing secret, so nothing was written.');
  writeFileSync(secretFile, `${made.secret}\n`, { mode: 0o600 });
  chmodSync(secretFile, 0o600);
  for (const old of existing) await stripe.deleteWebhookEndpoint(old.id);
  const mode = keyMode(key);
  console.log(`Created the Connect webhook endpoint for ${endpoint} (${made.id}) in ${mode} mode, listening for ${WEBHOOK_EVENTS.length} events.`);
  console.log(`Its signing secret is in ${secretFile}, mode 600. Set STRIPE_WEBHOOK_SECRET from that file, then restart.`);
} catch (e) { die(`Stripe said no: ${e.message}`); }
