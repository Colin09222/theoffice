// A stub of Namecheap's real XML API, using the response shapes from their documentation, with its sandbox-style failures. Nothing here talks to Namecheap.
import http from 'node:http';

const wrap = (command, inner) => `<?xml version="1.0" encoding="utf-8"?>\n<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK"><Errors/><Warnings/><RequestedCommand>${command}</RequestedCommand><CommandResponse Type="${command}">${inner}</CommandResponse><Server>STUB</Server><GMTTimeDifference>--4:00</GMTTimeDifference><ExecutionTime>0.1</ExecutionTime></ApiResponse>`;
const fail = (number, text) => `<?xml version="1.0" encoding="utf-8"?>\n<ApiResponse Status="ERROR" xmlns="http://api.namecheap.com/xml.response"><Errors><Error Number="${number}">${text}</Error></Errors><Warnings/><RequestedCommand/><Server>STUB</Server><GMTTimeDifference>--4:00</GMTTimeDifference><ExecutionTime>0</ExecutionTime></ApiResponse>`;
const person = (who) => `<OrganizationName>Secret Org</OrganizationName><JobTitle/><FirstName>${who}</FirstName><LastName>Registrantson</LastName><Address1>1 Private Lane</Address1><Address2/><City>Hiddenville</City><StateProvince>CA</StateProvince><StateProvinceChoice/><PostalCode>90001</PostalCode><Country>US</Country><Phone>+1.5550001234</Phone><PhoneExt/><Fax/><EmailAddress>hidden.owner@private.example</EmailAddress>`;

export const CONTACT_SECRETS = ['Registrantson', '1 Private Lane', 'Hiddenville', 'hidden.owner@private.example', '+1.5550001234', 'Secret Org'];

export async function startNamecheapStub({ host = '127.0.0.1' } = {}) {
  const state = {
    balance: 100, price: { com: 11.28, xyz: 2.5, io: 60 }, premium: new Set(), taken: new Set(), owned: new Set(), hosts: new Map(), creates: [], calls: [], icann: 0.18,
    // Tests set these: failNext[command] = {number, text} | 'timeout' | 'garbage' | 'html' | 'charged-then-timeout' (the registrar took the money, the answer was lost)
    failNext: {}, failAlways: {}, chargedAmount: null, whoisguard: true, registeredFalse: false, delayMs: 0,
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const p = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
      const command = p.Command;
      state.calls.push({ command, params: p, remote: req.socket.remoteAddress, method: req.method, url: req.url });
      const send = (body, status = 200) => { res.writeHead(status, { 'content-type': 'text/xml' }); res.end(body); };
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (!p.ApiKey || p.ApiKey === 'bad-key') return send(fail(1011102, 'API Key is invalid or API access has not been enabled'));
      if (p.ClientIp !== '203.0.113.7') return send(fail(1011150, `RequestIP is invalid ${p.ClientIp}`));
      const planned = state.failNext[command] || state.failAlways[command];
      delete state.failNext[command];
      if (planned === 'timeout') return req.socket.destroy();
      if (planned === 'garbage') return send('<ApiResponse Status="OK"><oops');
      if (planned === 'html') return send('<html><body>Bad gateway</body></html>', 502);
      if (planned?.number) return send(fail(planned.number, planned.text.replace('{CONTACT}', `${p.RegistrantPhone} ${p.RegistrantAddress1}`)));
      const dot = (d) => d.split('.').pop();
      switch (command) {
        case 'namecheap.domains.check':
          return send(wrap(command, p.DomainList.split(',').map((d) => {
            const premium = state.premium.has(d);
            return `<DomainCheckResult Domain="${d}" Available="${!state.taken.has(d) && !state.owned.has(d)}" ErrorNo="0" Description="" IsPremiumName="${premium}" PremiumRegistrationPrice="${premium ? '13000.0000' : '0'}" PremiumRenewalPrice="0" PremiumRestorePrice="0" PremiumTransferPrice="0" IcannFee="${state.icann}" EapFee="0"/>`;
          }).join('')));
        case 'namecheap.users.getPricing': {
          const tld = p.ProductName.toLowerCase(); const usd = state.price[tld];
          return send(wrap(command, `<UserGetPricingResult><ProductType Name="DOMAIN"><ProductCategory Name="REACTIVATE"><Product Name="${tld}"><Price Duration="1" DurationType="YEAR" Price="99" RegularPrice="99" YourPrice="99" CouponPrice="" Currency="USD"/></Product></ProductCategory><ProductCategory Name="REGISTER">${usd === undefined ? '' : `<Product Name="${tld}"><Price Duration="2" DurationType="YEAR" Price="${usd * 2}" RegularPrice="${usd * 2}" YourPrice="${usd * 2}" CouponPrice="" Currency="USD"/><Price Duration="1" DurationType="YEAR" Price="${usd}" RegularPrice="${usd}" YourPrice="${usd}" CouponPrice="" Currency="USD"/></Product>`}</ProductCategory></ProductType></UserGetPricingResult>`));
        }
        case 'namecheap.users.getBalances':
          return send(wrap(command, `<UserGetBalancesResult Currency="USD" AvailableBalance="${state.balance}" AccountBalance="${state.balance}" EarnedAmount="0" WithdrawableAmount="0" FundsRequiredForAutoRenew="0.00"/>`));
        case 'namecheap.domains.getContacts':
          return send(wrap(command, `<DomainContactsResult Domain="${p.DomainName}" domainnameid="1"><Registrant ReadOnly="false">${person('Rita')}</Registrant><Tech ReadOnly="false">${person('Rita')}</Tech><Admin ReadOnly="false">${person('Rita')}</Admin><AuxBilling ReadOnly="false">${person('Rita')}</AuxBilling><WhoisGuardContact><Registrant ReadOnly="true">${person('MASKED')}</Registrant></WhoisGuardContact></DomainContactsResult>`));
        case 'namecheap.domains.create': {
          state.creates.push(p);
          const d = p.DomainName;
          if (state.owned.has(d) || state.taken.has(d)) return send(fail(3019166, 'Domain not available'));
          if (state.premium.has(d) && p.IsPremiumDomain !== 'True') return send(fail(2515623, 'Domain is premium while considered regular'));
          const usd = state.chargedAmount ?? state.price[dot(d)] + state.icann;
          if (state.balance < usd) return send(fail(2528166, 'Insufficient funds in your account'));
          if (state.registeredFalse) return send(wrap(command, `<DomainCreateResult Domain="${d}" Registered="false" ChargedAmount="0" DomainID="0" OrderID="0" TransactionID="0" WhoisguardEnable="false" NonRealTimeDomain="false"/>`));
          state.balance -= usd; state.owned.add(d);
          if (planned === 'charged-then-timeout') return req.socket.destroy();
          return send(wrap(command, `<DomainCreateResult Domain="${d}" Registered="true" ChargedAmount="${usd.toFixed(4)}" DomainID="${100 + state.creates.length}" OrderID="${2000 + state.creates.length}" TransactionID="${5000 + state.creates.length}" WhoisguardEnable="${state.whoisguard}" NonRealTimeDomain="false"/>`));
        }
        case 'namecheap.domains.getList': {
          const rows = [...state.owned].filter((d) => d.includes(p.SearchTerm || '')).map((d, i) => `<Domain ID="${i}" Name="${d}" User="owner" Created="11/07/2026" Expires="11/07/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>`).join('');
          return send(wrap(command, `<DomainGetListResult>${rows}</DomainGetListResult><Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>100</PageSize></Paging>`));
        }
        case 'namecheap.domains.dns.setDefault':
          return send(wrap(command, `<DomainDNSSetDefaultResult Domain="${p.SLD}.${p.TLD}" Updated="true"/>`));
        case 'namecheap.domains.dns.setHosts': {
          const d = `${p.SLD}.${p.TLD}`; const rec = [];
          for (let i = 1; p[`HostName${i}`]; i++) rec.push({ host: p[`HostName${i}`], type: p[`RecordType${i}`], address: p[`Address${i}`] });
          state.hosts.set(d, rec);
          return send(wrap(command, `<DomainDNSSetHostsResult Domain="${d}" IsSuccess="true"/>`));
        }
        default: return send(fail(1010999, 'unknown command'));
      }
    });
  });
  await new Promise((r) => server.listen(0, host, r));
  const port = server.address().port;
  return { state, port, url: `http://localhost:${port}/xml.response`, count: (c) => state.calls.filter((x) => x.command === c).length, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }) };
}
