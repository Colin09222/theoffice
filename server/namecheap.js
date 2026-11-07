// The Namecheap XML API. Nothing else in the building talks to it. The key travels in POST bodies only, IPv4 only (their allow-list holds one
// IPv4 address and hz prefers IPv6 otherwise). Responses are parsed by a strict little reader that refuses DTDs, so there are no entities to expand.
import http from 'node:http';
import https from 'node:https';

export class NamecheapError extends Error {
  constructor(kind, number = 0, safeText = '', opts = {}) {
    super(`Namecheap ${kind}${number ? ` ${number}` : ''}`);
    this.name = 'NamecheapError'; this.kind = kind; this.number = number; this.safeText = safeText; this.lowFunds = !!opts.lowFunds; this.numbers = opts.numbers || (number ? [number] : []);
  }
}

// ---- XML ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
  return ENT[e] ?? '';
});
export function parseXml(xml) {
  const s = String(xml);
  if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw new NamecheapError('bad_xml');
  const root = { name: '', attrs: {}, children: [], text: '' };
  const stack = [root]; let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { stack.at(-1).text += decode(s.slice(i)); break; }
    if (lt > i) stack.at(-1).text += decode(s.slice(i, lt));
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt); if (e < 0) throw new NamecheapError('bad_xml'); i = e + 2; continue; }
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt); if (e < 0) throw new NamecheapError('bad_xml'); i = e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt); if (e < 0) throw new NamecheapError('bad_xml'); stack.at(-1).text += s.slice(lt + 9, e); i = e + 3; continue; }
    const gt = s.indexOf('>', lt);
    if (gt < 0) throw new NamecheapError('bad_xml');
    let tag = s.slice(lt + 1, gt);
    if (tag[0] === '/') {
      const name = tag.slice(1).trim();
      if (stack.length < 2 || stack.at(-1).name !== name) throw new NamecheapError('bad_xml');
      stack.pop(); i = gt + 1; continue;
    }
    const selfClose = tag.endsWith('/');
    if (selfClose) tag = tag.slice(0, -1);
    const m = tag.match(/^([A-Za-z_][\w.:-]*)/);
    if (!m) throw new NamecheapError('bad_xml');
    const node = { name: m[1], attrs: {}, children: [], text: '' };
    for (const a of tag.slice(m[1].length).matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = decode(a[3] ?? a[4] ?? '');
    stack.at(-1).children.push(node);
    if (!selfClose) stack.push(node);
    i = gt + 1;
  }
  if (stack.length !== 1 || root.children.length !== 1) throw new NamecheapError('bad_xml');
  return root.children[0];
}
const child = (n, name) => n?.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
const children = (n, name) => (n?.children || []).filter((c) => c.name.toLowerCase() === name.toLowerCase());
const yes = (v) => String(v ?? '').toLowerCase() === 'true';
// An empty attribute is no answer, not zero dollars.
const money = (v) => { if (v === undefined || v === null || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// Numbers Namecheap documents as refusals, where nothing can have been charged. Anything else on a create call might have gone through, so it is treated as "not sure".
const CERTAIN_REFUSAL = new Set([1011102, 1011150, 1010101, 1010102, 1010104, 1017101, 1017410, 1017411, 2033409, 2033407, 2033270, 2015182, 2015267, 2011170, 2011280, 2015167, 2030280, 2011168, 2011322, 2010323, 3019166, 4019166, 2515610, 2515623, 2005, 500000]);
// Their words can echo what was sent, which on a registration is someone's home address. So only these fixed phrases ever leave this file.
const SAFE_TEXT = {
  1011150: 'the server\'s address is not on the Namecheap allow-list', 1011102: 'the Namecheap API key was refused', 1010102: 'the Namecheap API key was refused', 1011104: 'the Namecheap API key was refused', 3019166: 'that name was taken a moment ago', 4019166: 'that name was taken a moment ago',
  2515610: 'the price changed', 2515623: 'that name turned out to be premium', 2030280: 'that ending is not sold through the API', 2015182: 'the registrant phone number on file was refused', 2005: 'the registrant country on file was refused', 500000: 'Namecheap is rate limiting us',
};
// "Error in refunding funds" means money may have moved, so it must never read as a clean refusal.
const isLowFunds = (t) => /insufficient|not enough (funds|balance)|low balance|add funds/i.test(t) && !/refund/i.test(t);

export function createNamecheapClient(cfg, { request } = {}) {
  const base = new URL(cfg.namecheapBase);
  // The key is only ever sent over TLS. Plain http is for a stub on this machine, nothing else.
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('NAMECHEAP_BASE_URL must be https');
  const send = request || ((params, timeoutMs) => new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const lib = base.protocol === 'https:' ? https : http;
    const req = lib.request(base, { method: 'POST', family: 4, timeout: timeoutMs, headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body), accept: 'application/xml' } }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 4 * 1024 * 1024) { req.destroy(); reject(new NamecheapError('network')); } else chunks.push(c); });
      res.on('end', () => (res.statusCode >= 500 ? reject(new NamecheapError('network')) : resolve(Buffer.concat(chunks).toString('utf8'))));
      res.on('error', () => reject(new NamecheapError('network')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => reject(new NamecheapError('network')));
    req.end(body);
  }));

  async function call(command, params = {}, { timeoutMs = 30000 } = {}) {
    if (!cfg.namecheapKey || !cfg.namecheapUser || !cfg.namecheapClientIp) throw new NamecheapError('not_configured');
    const xml = await send({ ApiUser: cfg.namecheapUser, ApiKey: cfg.namecheapKey, UserName: cfg.namecheapUser, ClientIp: cfg.namecheapClientIp, Command: command, ...params }, timeoutMs);
    let doc;
    try { doc = parseXml(xml); } catch { throw new NamecheapError('network'); }
    if (doc.name !== 'ApiResponse') throw new NamecheapError('network');
    if (String(doc.attrs.Status).toUpperCase() !== 'OK') {
      const errs = children(child(doc, 'Errors'), 'Error');
      const numbers = errs.map((x) => Number(x.attrs.Number) || 0);
      const number = numbers[0] || 0;
      throw new NamecheapError('api', number, SAFE_TEXT[number] || '', { lowFunds: errs.some((x) => isLowFunds(x.text || '')), numbers });
    }
    return child(doc, 'CommandResponse') || { children: [], attrs: {} };
  }

  return {
    // By number only, and every error in the reply must qualify. Words can't turn an unknown error into a safe one.
    isCertainRefusal: (e) => e instanceof NamecheapError && e.kind === 'api' && e.numbers.length > 0 && e.numbers.every((n) => CERTAIN_REFUSAL.has(n)),
    async check(domains) {
      const r = await call('namecheap.domains.check', { DomainList: domains.join(',') });
      return children(r, 'DomainCheckResult').map((d) => ({ domain: String(d.attrs.Domain).toLowerCase(), available: yes(d.attrs.Available), premium: yes(d.attrs.IsPremiumName), premiumPrice: money(d.attrs.PremiumRegistrationPrice) ?? 0, icannFee: money(d.attrs.IcannFee) ?? 0, eapFee: money(d.attrs.EapFee) ?? 0 }));
    },
    /** One year's registration in this account's price, or null if they don't list one. */
    async price(tld) {
      const r = await call('namecheap.users.getPricing', { ProductType: 'DOMAIN', ProductCategory: 'DOMAINS', ActionName: 'REGISTER', ProductName: tld.toUpperCase() });
      for (const t of children(child(r, 'UserGetPricingResult'), 'ProductType')) {
        for (const c of children(t, 'ProductCategory')) {
          if (String(c.attrs.Name).toLowerCase() !== 'register') continue;
          for (const p of children(c, 'Product')) {
            if (String(p.attrs.Name).toLowerCase() !== tld) continue;
            for (const x of children(p, 'Price')) {
              if (String(x.attrs.Duration) !== '1' || String(x.attrs.DurationType).toUpperCase() !== 'YEAR') continue;
              const own = money(x.attrs.YourPrice); const extra = money(x.attrs.AdditionalCost) ?? 0;
              if (own !== null && own > 0) return own + extra;
            }
          }
        }
      }
      return null;
    },
    async balance() {
      const r = await call('namecheap.users.getBalances');
      return money(child(r, 'UserGetBalancesResult')?.attrs.AvailableBalance);
    },
    /** The registrant on an existing domain, for this one purchase. Held in memory for the length of the call, never stored. Never the privacy service's masked copy. */
    async contacts(domain) {
      const r = await call('namecheap.domains.getContacts', { DomainName: domain });
      const res = child(r, 'DomainContactsResult');
      const out = {};
      for (const role of ['Registrant', 'Tech', 'Admin', 'AuxBilling']) {
        const n = child(res, role);
        if (!n) throw new NamecheapError('bad_contacts');
        for (const f of ['OrganizationName', 'JobTitle', 'FirstName', 'LastName', 'Address1', 'Address2', 'City', 'StateProvince', 'StateProvinceChoice', 'PostalCode', 'Country', 'Phone', 'PhoneExt', 'Fax', 'EmailAddress']) {
          const v = child(n, f)?.text?.trim();
          if (v) out[`${role}${f}`] = v;
        }
      }
      for (const need of ['FirstName', 'LastName', 'Address1', 'City', 'StateProvince', 'PostalCode', 'Country', 'Phone', 'EmailAddress']) if (!out[`Registrant${need}`]) throw new NamecheapError('bad_contacts');
      return out;
    },
    /** Spends money. Sent once per decision by the broker, which records its intent first. Never retried from here. */
    async create(domain, contacts) {
      const r = await call('namecheap.domains.create', { DomainName: domain, Years: '1', AddFreeWhoisguard: 'yes', WGEnabled: 'yes', IsPremiumDomain: 'False', ...contacts }, { timeoutMs: 120000 });
      const d = child(r, 'DomainCreateResult');
      if (!d) throw new NamecheapError('network');
      return { domain: String(d.attrs.Domain).toLowerCase(), registered: yes(d.attrs.Registered), charged: money(d.attrs.ChargedAmount), domainId: String(d.attrs.DomainID ?? ''), orderId: String(d.attrs.OrderID ?? ''), transactionId: String(d.attrs.TransactionID ?? ''), privacy: yes(d.attrs.WhoisguardEnable) };
    },
    /** Does this account hold the name? The authority after any create call whose outcome is unclear. */
    async owned(domain) {
      const r = await call('namecheap.domains.getList', { ListType: 'ALL', SearchTerm: domain, PageSize: '100' });
      return children(child(r, 'DomainGetListResult'), 'Domain').find((d) => String(d.attrs.Name).toLowerCase() === domain) ? true : false;
    },
    async setHosts(domain, records) {
      const dot = domain.indexOf('.');
      const params = { SLD: domain.slice(0, dot), TLD: domain.slice(dot + 1) };
      records.forEach((h, i) => { const n = i + 1; params[`HostName${n}`] = h.host; params[`RecordType${n}`] = h.type; params[`Address${n}`] = h.address; params[`TTL${n}`] = String(h.ttl ?? 300); });
      const r = await call('namecheap.domains.dns.setHosts', params, { timeoutMs: 60000 });
      return yes(child(r, 'DomainDNSSetHostsResult')?.attrs.IsSuccess);
    },
    async setDefaultDns(domain) {
      const dot = domain.indexOf('.');
      await call('namecheap.domains.dns.setDefault', { SLD: domain.slice(0, dot), TLD: domain.slice(dot + 1) }, { timeoutMs: 60000 });
    },
  };
}
