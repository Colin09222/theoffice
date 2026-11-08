// The Lawyer's cards under Requests: add him with one tap, give him the three facts he can't know, and approve each project's legal pages.
// Boss-only: the server sends state.legal to the floor's own boss and nobody else.
import { h, api, toast } from './dom.js';

const FEATURE_WORDS = { payments: 'takes payments', subscriptions: 'subscriptions', accounts: 'accounts', saves: 'saved data', scores: 'scores', forms: 'forms', emailCollected: 'collects emails', uploads: 'uploads', chat: 'site chat', ai: 'AI features', adScripts: 'ad scripts', adCampaign: 'ads', mailbox: 'company email' };

/** How many legal things are waiting for the boss: the facts, once asked, and each draft ready for a tap. */
export function legalPending(page) {
  const l = page.state?.legal;
  if (!l?.lawyer) return 0;
  const docs = l.docs || [];
  return docs.filter((d) => d.status === 'drafted').length + (l.facts.missing.length && docs.some((d) => d.status === 'needs_facts') ? 1 : 0);
}

const post = async (page, path, body, done) => {
  try { await api(`/floors/${page.slug}/legal${path}`, { method: 'POST', body: body || {} }); if (done) toast(done); } catch (e) { toast(e.message, 'bad'); }
  page.reload();
};

function factsCard(page, l) {
  const f = { ...l.facts };
  const field = (key, label, placeholder) => h('label.field', {}, h('span', {}, label),
    h('input', { type: 'text', name: `legal-${key}`, value: f[key] || '', maxlength: key === 'contact' ? 200 : 120, placeholder, oninput: (e) => { f[key] = e.target.value; } }));
  return h('article.card.request.legal-facts', { 'data-legal-facts': '' },
    h('b', {}, `${l.lawyer.name} needs three facts`),
    h('p', {}, 'He can\'t know these and won\'t make them up. Until they\'re in, nothing can be published.'),
    field('legalName', 'Legal or trading name', 'Night Owl Bakery Ltd'),
    field('region', 'Country or state', 'England, UK'),
    field('contact', 'Contact address for customers', 'hello@example.com'),
    h('div.row', {}, h('button.btn.primary', { type: 'button', 'data-legal-facts-save': '', onclick: () => post(page, '/facts', f, 'Saved') }, 'Save')));
}

function pageBlock(p) {
  return h('details.legal-page', {}, h('summary', {}, p.title), ...p.sections.map((s) => h('div', {}, h('h4', {}, s.h), ...s.p.map((x) => h('p', {}, x)))));
}

function docCard(page, l, d) {
  const on = Object.entries(d.features || {}).filter(([k, v]) => v && FEATURE_WORDS[k]).map(([k]) => FEATURE_WORDS[k]);
  const pages = Object.values(d.pages || {});
  const kids = [h('div.row.spread', {}, h('b', {}, `Legal pages for ${d.project}`), h('small', {}, { drafted: 'Waiting for you', needs_facts: 'Needs your facts', approved: 'Live', declined: 'You said no', regulated: 'Needs a real lawyer' }[d.status] || d.status))];
  if (d.status === 'regulated') {
    kids.push(h('p.legal-regulated', { 'data-legal-regulated': '' }, `This looks like ${d.regulated.map((r) => r.label.toLowerCase()).join(' and ')}. That needs a real lawyer before launch, so ${l.lawyer?.name || 'the Lawyer'} hasn't drafted it as if it were routine.`));
  } else {
    kids.push(h('small', {}, on.length ? `Written for what it really does: ${on.join(', ')}.` : 'Written for what it really does: no accounts, payments or forms found.'));
    kids.push(...pages.map(pageBlock));
  }
  if (d.flags?.length) kids.push(h('div.legal-flags', { 'data-legal-flags': '' }, h('h4', {}, 'Worth a look before launch'), h('ul', {}, ...d.flags.map((x) => h('li', {}, x.quote ? `${x.label}: "${x.quote}"` : x.label))), h('p.fineprint', {}, 'Flags only. They don\'t hold Launch.')));
  if (d.live && d.paths?.length) kids.push(h('p.fineprint', {}, d.status === 'approved' ? 'Live at ' : 'The approved version is still live at ', ...d.paths.flatMap((u, i) => [i ? ', ' : '', h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, u.split('/').pop())]), '.'));
  if (d.status === 'drafted') kids.push(h('div.row', {}, h('button.btn.primary', { type: 'button', 'data-legal-approve': d.project, onclick: () => post(page, `/${encodeURIComponent(d.project)}/approve`, { version: d.version }, 'The legal pages are up') }, 'Approve and publish'), h('button.btn.ghost', { type: 'button', onclick: () => post(page, `/${encodeURIComponent(d.project)}/decline`) }, 'Not now')));
  if (d.status === 'needs_facts') kids.push(h('p.fineprint', {}, 'Fill in the three facts above and this is ready for your tap.'));
  kids.push(h('p.fineprint.legal-honesty', { 'data-legal-honesty': '' }, l.honesty));
  return h(`article.card.request.legal.${d.status}`, { 'data-legal-doc': d.project }, ...kids);
}

/** The Requests tab's share. */
export function renderLegalRequests(page, list) {
  const l = page.state?.legal;
  if (!l) return;
  if (!l.lawyer) {
    if (l.canHire) list.append(h('article.card.request.legal-hire', { 'data-legal-hire': '' }, h('b', {}, 'Add a Lawyer'),
      h('p', {}, 'Hollis drafts your Terms, Privacy and Refund pages from what your projects really do, and flags risky claims. He only works when there is something to do. Not a real lawyer, and he says so.'),
      h('div.row', {}, h('button.btn.primary', { type: 'button', 'data-legal-hire-yes': '', onclick: () => post(page, '/hire', {}, 'Hollis joined as Lawyer') }, 'Add Hollis'))));
    return;
  }
  const docs = l.docs || [];
  if (l.facts.missing.length && docs.some((d) => d.status === 'needs_facts')) list.append(factsCard(page, l));
  for (const d of docs) list.append(docCard(page, l, d));
}
