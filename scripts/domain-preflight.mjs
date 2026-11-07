#!/usr/bin/env node
// Checks the Namecheap setup without buying anything: read-only calls. It prints yes/no about the registrant, never the details. Run it on hz, in the container, before the first real click.
import { loadConfig } from '../server/config.js';
import { createNamecheapClient, NamecheapError } from '../server/namecheap.js';
import { domainsConfigured } from '../server/domains.js';

const cfg = loadConfig();
const line = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); if (!ok) process.exitCode = 1; };
line('all settings present', domainsConfigured(cfg), domainsConfigured(cfg) ? '' : 'needs NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_CLIENT_IP, DOMAIN_CONTACT_SOURCE, SERVER_IP and APPS_BASE_DOMAIN');
if (!cfg.namecheapKey) process.exit(1);
const nc = createNamecheapClient(cfg);
const say = (e) => (e instanceof NamecheapError ? `${e.kind} ${e.number || ''} ${e.safeText || ''}`.trim() : 'network error');
const step = async (name, fn) => { try { const r = await fn(); line(name, true, r); } catch (e) { line(name, false, say(e)); } };
await step('API reachable over IPv4, key and allow-list accepted; balance', async () => `$${await nc.balance()}`);
await step('.com price', async () => `$${await nc.price('com')}`);
await step('availability check', async () => { const [r] = await nc.check([`office-preflight-${Date.now()}.com`]); return `available=${r?.available}`; });
await step('registrant readable from DOMAIN_CONTACT_SOURCE, all required fields present', async () => { const c = await nc.contacts(cfg.domainContactSource); return `${Object.keys(c).filter((k) => k.startsWith('Registrant')).length} registrant fields, values not shown`; });
