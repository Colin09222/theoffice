// The boss's Inbox: the company's own email, read, answered and written from the floor. Only the boss's page ever asks for it, and the
// server answers nobody else. Messages show as plain text; the formatted version opens in a sandboxed frame, without outside pictures until asked.
import { h, api, clear, toast, timeAgo, modal, BASE } from './dom.js';
import { icon } from './icons.js';
import { chatBox, chatWaiting } from './chat-ui.js';

const STATUS = { awaiting_boss: 'Waiting for your OK', queued: 'Sending', sending: 'Sending', sent: 'Sent', delivered: 'Delivered', failed: 'Not sent', declined: 'You said no', bounced: 'Bounced', complained: 'Marked as spam' };
const SETUP = 'Email is being set up for the building. Your address is saved; mail starts arriving and sending as soon as the building manager switches it on.';

export const mailUnread = (page) => (page.state?.mail?.unread || 0) + chatWaiting(page);
export const mailPending = (page) => (page.state?.mail?.waiting || []).length;
export const mailTab = (page) => { const n = mailUnread(page); return ['inbox', n ? `Inbox ${n}` : 'Inbox']; };

/** A word from the server: new mail, something waiting for the boss, or the floor's sending paused. Never sent to a visitor. */
export function onMailEvent(page, d) {
  if (!page.owner) return;
  page.state.mail ||= {};
  if (typeof d.unread === 'number') page.state.mail.unread = d.unread;
  if (d.waiting || d.paused) { page.reload(); if (d.waiting) toast('An email from the team is waiting for your OK under Requests'); return; }
  if (d.form) toast('A message came in from your website form');
  else if (d.from) toast(`New email from ${d.from}`);
  page.renderTabs();
  if (page.tab === 'inbox' && (page.mailView?.mode || 'list') === 'list') { clear(page.bodyEl); renderInbox(page); }
}

export async function renderInbox(page) {
  page.mailView ||= { mode: 'list', folder: 'inbox', thread: null };
  page.bodyEl.append(chatBox(page));  // the website chat: chat-ui.js
  const box = h('div.mail', { 'data-mail': page.mailView.mode });
  page.bodyEl.append(box);
  box.append(h('p.empty', {}, 'Opening the inbox…'));
  let v;
  try { v = await api(`/floors/${page.slug}/mail`); } catch (e) { clear(box).append(h('p.empty', {}, e.message)); return; }
  if (!box.isConnected) return;  // the boss went to another tab meanwhile
  page.state.mail = { ...(page.state.mail || {}), unread: v.unread, ready: v.ready, address: v.address, waiting: v.waiting };
  page.renderTabs();
  clear(box);
  const go = (patch) => { Object.assign(page.mailView, patch); clear(page.bodyEl); renderInbox(page); };
  if (page.mailView.mode === 'thread' && page.mailView.thread) return threadView(page, box, v, go);
  if (page.mailView.mode === 'compose') return composeView(page, box, v, go);
  listView(page, box, v, go);
}

function head(page, v, go) {
  const change = () => modal('Change your email address', (body, close) => {
    let pick = v.suggestions[0];
    body.append(h('p.lede', {}, 'You can change it once. Mail sent to the old address still reaches you.'));
    const opts = h('div.mail-picks', { role: 'radiogroup' });
    v.suggestions.forEach((s, i) => opts.append(h('label.mail-pick', {}, h('input', { type: 'radio', name: 'mail-pick', value: s, checked: i === 0, onchange: () => { pick = s; } }), h('span', {}, s))));
    body.append(opts, h('div.row', {}, h('button.btn.primary', { type: 'button', 'data-mail-change': '', onclick: async () => {
      try { const r = await api(`/floors/${page.slug}/mail/address`, { method: 'POST', body: { address: pick } }); toast(`Your address is now ${r.address}`); close(); go({}); } catch (e) { toast(e.message, 'bad'); }
    } }, 'Use this address'), h('button.btn.ghost', { type: 'button', onclick: () => close() }, 'Keep mine')));
  });
  return h('div.mail-head', {},
    h('div.mail-address', {}, icon('envelope-simple'), v.address ? h('b', { 'data-mail-address': '' }, v.address) : h('b', {}, 'Your address arrives when the company has a name'),
      v.canChange ? h('button.btn.ghost.small', { type: 'button', onclick: change }, 'Change') : null),
    !v.ready ? h('p.mail-banner', { 'data-mail-setup': '' }, SETUP) : v.paused ? h('p.mail-banner.bad', {}, 'Sending is paused for now. Mail still arrives here.') : null);
}

const DOMAIN_WORD = { creating: 'Setting up', dns: 'Setting up', verifying: 'Confirming', records: 'Needs your records', verified: 'Live', conflict: 'Left as it is', full: 'Waiting for a place', failed: 'Not finished' };
const copyText = (text) => async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast(text); } };

/** One DNS record for the boss to add where the domain is managed: what kind, its name and its value, each ready to copy. */
function dnsRow(r) {
  return h('div.mail-dns', { 'data-mail-dns': r.type },
    h('b.mail-dns-kind', {}, r.priority === null || r.priority === undefined ? r.type : `${r.type} ${r.priority}`),
    h('span.mail-dns-name', {}, r.name),
    r.ok ? h('small.mail-dns-ok', {}, 'Found') : h('button.btn.ghost.small', { type: 'button', onclick: copyText(r.value) }, 'Copy'),
    h('code.mail-dns-value', {}, r.value));
}

/** The company's own domain for email, with where it has got to. Until it says Live, mail keeps going from the building's address. */
function domainCard(page, v, go) {
  const own = v.ownDomain;
  if (!own || (!own.domains.length && !own.canAddDomain)) return null;
  const say = (path, body) => async () => {
    try { await api(`/floors/${page.slug}/mail/domain${path}`, { method: 'POST', body }); go({}); } catch (e) { toast(e.message, 'bad'); go({}); }
  };
  const add = () => modal('Send from your own domain', (body, close) => {
    const input = h('input', { type: 'text', name: 'mail-domain', placeholder: 'yourcompany.com', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const send = async (name) => {
      try { await api(`/floors/${page.slug}/mail/domain`, { method: 'POST', body: { domain: name } }); close(); go({}); } catch (e) { toast(e.message, 'bad'); }
    };
    body.append(h('p.lede', {}, 'Email can go out from a domain you own, like hello@yourcompany.com. It takes a little setting up; your email carries on as it is until it\'s ready.'));
    if (own.domainChoices.length) body.append(h('div.mail-picks', {}, ...own.domainChoices.map((d) => h('button.mail-pick', { type: 'button', 'data-mail-domain-pick': d, onclick: () => send(d) }, d))));
    body.append(h('form.row', { onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) send(input.value); } }, input, h('button.btn.primary', { type: 'submit', 'data-mail-domain-add': '' }, 'Use it')));
  });
  const cards = own.domains.map((d) => h(`section.mail-domain.${d.status}`, { 'data-mail-domain': d.domain, 'data-status': d.status },
    h('div.row.spread.mail-domain-top', {}, h('b.mail-domain-name', {}, icon('globe'), h('span', {}, d.domain)), h('span.mail-domain-pill', {}, DOMAIN_WORD[d.status] || d.status)),
    h('p.mail-domain-line', { 'data-mail-domain-line': '' }, d.line),
    d.ready && v.buildingAddress ? h('p.fineprint', {}, `Mail to ${v.buildingAddress} still reaches you.`) : null,
    d.records.length ? h('div.mail-dns-list', {}, ...d.records.map(dnsRow)) : null,
    ['creating', 'dns', 'records', 'verifying', 'verified'].includes(d.status) ? h('label.mail-domain-from', {}, h('span', {}, 'Send as'),
      h('select', { name: 'mail-domain-local', 'data-mail-domain-local': '', onchange: (e) => say('/local', { domain: d.domain, local: e.target.value })() },
        ...own.localChoices.map((l) => h('option', { value: l, selected: l === d.local }, `${l}@${d.domain}`)))) : null,
    h('div.row.mail-domain-actions', {},
      d.canCheck ? h('button.btn.ghost.small', { type: 'button', 'data-mail-domain-check': '', onclick: say('/check', { domain: d.domain }) }, 'Check again') : null,
      h('button.btn.ghost.small', { type: 'button', 'data-mail-domain-remove': '', onclick: () => modal(`Stop using ${d.domain} for email?`, (body, close) => {
        body.append(h('p.lede', {}, `Your email goes back to ${v.buildingAddress || 'your building address'}.`), h('div.row', {},
          h('button.btn.primary', { type: 'button', onclick: async () => { close(); await say('/remove', { domain: d.domain })(); } }, 'Stop using it'), h('button.btn.ghost', { type: 'button', onclick: () => close() }, 'Keep it')));
      }) }, 'Stop using it'))));
  return h('div.mail-domains', { 'data-mail-domains': '' }, ...cards,
    own.canAddDomain ? h('button.btn.ghost.small.mail-domain-add', { type: 'button', 'data-mail-domain-open': '', onclick: add }, icon('globe'), 'Send from your own domain') : null);
}

function listView(page, box, v, go) {
  box.append(head(page, v, go));
  const dom = domainCard(page, v, go);
  if (dom) box.append(dom);
  const folder = page.mailView.folder;
  const tabs = h('div.mail-folders', { role: 'tablist' });
  for (const [id, label] of [['inbox', v.unread ? `Inbox (${v.unread})` : 'Inbox'], ['sent', 'Sent by the team'], ['waiting', v.waiting.length ? `Waiting (${v.waiting.length})` : 'Waiting']]) {
    tabs.append(h(`button.chip${folder === id ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-checked': String(folder === id), 'data-mail-folder': id, onclick: () => go({ folder: id }) }, label));
  }
  box.append(h('div.row.spread.mail-bar', {}, tabs, h('button.btn.primary.small', { type: 'button', 'data-mail-compose': '', disabled: !v.ready || v.paused || !v.address, onclick: () => go({ mode: 'compose' }) }, icon('pencil-simple'), 'Write')));
  const list = h('div.mail-list');
  if (folder === 'inbox') {
    if (!v.threads.length) list.append(h('p.empty', {}, v.address ? `Nothing yet. Mail to ${v.address} and messages from your website's contact form land here.` : 'Nothing yet.'));
    for (const t of v.threads) {
      list.append(h(`button.mail-row${t.unread ? '.unread' : ''}`, { type: 'button', 'data-thread': String(t.id), onclick: () => go({ mode: 'thread', thread: t.id }) },
        h('span.mail-who', {}, t.unread ? h('i.mail-dot', { 'aria-label': 'unread' }) : null, t.peerName || t.peer || 'Website form', t.form ? h('small.mail-tag', {}, 'form') : null, t.count > 1 ? h('small', {}, ` ${t.count}`) : null),
        h('span.mail-when', {}, timeAgo(t.lastAt)),
        h('span.mail-subject', {}, t.subject || '(no subject)'),
        h('span.mail-snippet', {}, t.snippet)));
    }
  } else {
    const rows = folder === 'sent' ? v.sent : v.waiting;
    if (!rows.length) list.append(h('p.empty', {}, folder === 'sent' ? 'The team hasn\'t sent any email yet.' : 'Nothing is waiting for you.'));
    for (const m of rows) {
      if (m.status === 'awaiting_boss') { list.append(approvalCard(page, m, () => go({}))); continue; }
      list.append(h(`button.mail-row.out.${m.status}`, { type: 'button', 'data-sent': String(m.id), onclick: () => go({ mode: 'thread', thread: m.threadId }) },
        h('span.mail-who', {}, `To ${m.to.join(', ')}`), h('span.mail-when', {}, timeAgo(m.sentAt || m.createdAt)),
        h('span.mail-subject', {}, m.subject), h('span.mail-snippet', {}, `${STATUS[m.status] || m.status} · ${m.byBoss ? 'you wrote it' : m.agentName ? `${m.agentName} wrote it` : 'the team wrote it'}${m.note ? ` · ${m.note}` : ''}`)));
    }
  }
  box.append(list, bossEmail(page, v));
}

function bossEmail(page, v) {
  const input = h('input', { type: 'email', name: 'boss-email', placeholder: 'you@example.com', value: v.bossEmail || '', autocomplete: 'email' });
  return h('form.mail-settings', { onsubmit: async (e) => {
    e.preventDefault();
    try { await api(`/floors/${page.slug}/mail/settings`, { method: 'POST', body: { bossEmail: input.value } }); toast(input.value ? 'Saved. The team can email you there.' : 'Removed.'); } catch (err) { toast(err.message, 'bad'); }
  } }, h('label', { for: 'boss-email' }, 'Your own email'), h('div.row', {}, input, h('button.btn.ghost.small', { type: 'submit' }, 'Save')),
  h('p.fineprint', {}, 'The team can email you there straight away. Mail to anyone new waits for your OK under Requests. Visitors never see any of this.'));
}

/** A message the team wants to send to someone new: one tap sends it, and "trust" lets the next ones through without asking. */
export function approvalCard(page, m, after) {
  const trust = h('input', { type: 'checkbox', name: 'trust' });
  const answer = (approve) => async () => {
    try {
      const r = await api(`/floors/${page.slug}/mail/messages/${m.id}/${approve ? 'approve' : 'decline'}`, { method: 'POST', body: { trust: approve && trust.checked } });
      toast(approve ? (r.status === 'sent' ? 'Sent' : `Not sent: ${r.note || r.status}`) : 'Not sent', approve && r.status !== 'sent' ? 'bad' : '');
      after?.();
    } catch (e) { toast(e.message, 'bad'); after?.(); }
  };
  return h('article.card.request.mail-approve', { 'data-mail-approve': String(m.id) },
    h('b', {}, `Email to ${m.to.join(', ')}`),
    h('small', {}, `${m.agentName || 'The team'} wrote it · ${m.reason}`),
    h('p.mail-approve-subject', {}, m.subject),
    h('p.mail-text.mail-preview', {}, m.text.length > 700 ? `${m.text.slice(0, 700)}…` : m.text),
    h('label.row.mail-trust', {}, trust, h('span', {}, 'Trust this address from now on')),
    h('div.row', {}, h('button.btn.primary', { type: 'button', 'data-mail-send': '', onclick: answer(true) }, 'Send it'), h('button.btn.ghost', { type: 'button', onclick: answer(false) }, 'Don\'t send')));
}
/** The Requests tab's share: whatever the team's email is waiting on. */
export function renderMailRequests(page, list) {
  for (const m of page.state?.mail?.waiting || []) list.append(approvalCard(page, m, () => page.reload()));
}

async function threadView(page, box, v, go) {
  let t;
  try { t = await api(`/floors/${page.slug}/mail/threads/${page.mailView.thread}`); } catch (e) { box.append(h('p.empty', {}, e.message)); return; }
  if (!box.isConnected) return;
  page.state.mail.unread = Math.max(0, (page.state.mail.unread || 0) - t.messages.filter((m) => m.direction === 'in' && !m.read).length);
  page.renderTabs();
  box.append(h('div.row.mail-bar', {}, h('button.btn.ghost.small', { type: 'button', 'data-mail-back': '', onclick: () => go({ mode: 'list', thread: null }) }, icon('arrow-left'), 'Inbox'), h('b.mail-thread-subject', {}, t.subject)));
  const list = h('div.mail-list.mail-thread');
  for (const m of t.messages) list.append(messageEl(page, m));
  box.append(list);
  if (t.canReply && t.replyTo) {
    const text = h('textarea', { name: 'mail-reply', rows: 4, maxlength: 20000, placeholder: `Reply to ${t.replyTo}` });
    const sendBtn = h('button.btn.primary', { type: 'submit', 'data-mail-reply': '', disabled: !v.ready || v.paused }, icon('paper-plane-tilt'), 'Send reply');
    box.append(h('form.mail-reply', { onsubmit: async (e) => {
      e.preventDefault();
      if (!text.value.trim()) return;
      sendBtn.disabled = true;
      try { const r = await api(`/floors/${page.slug}/mail/threads/${t.id}/reply`, { method: 'POST', body: { text: text.value } }); toast(r.status === 'sent' ? `Sent to ${r.to.join(', ')}` : `Not sent: ${r.note || r.status}`, r.status === 'sent' ? '' : 'bad'); go({}); } catch (err) { toast(err.message, 'bad'); sendBtn.disabled = false; }
    } }, text, h('div.row.spread', {}, h('small.fineprint', {}, v.ready ? `Signed as ${page.state.floor?.name || 'the company'}` : SETUP), sendBtn)));
  }
}

function messageEl(page, m) {
  const flags = [];
  if (m.direction === 'in' && m.source === 'form') flags.push('From your website form: the address was typed in, not checked');
  else if (m.direction === 'in' && !m.verified) flags.push('The sender could not be checked');
  if (m.machine) flags.push('Automatic mail: the team never answers it');
  if (m.direction === 'out') flags.push(`${STATUS[m.status] || m.status}${m.byBoss ? ' · you wrote it' : m.agentName ? ` · ${m.agentName} wrote it` : ''}${m.note ? ` · ${m.note}` : ''}`);
  const body = h('div.mail-body');
  const showText = () => { clear(body).append(h('div.mail-text', {}, m.text || '(no text)')); };
  const showHtml = (images) => {
    const src = `${BASE}/api/floors/${page.slug}/mail/messages/${m.id}/html${images ? '?images=1' : ''}`;
    clear(body).append(h('iframe.mail-frame', { src, title: m.subject || 'Email', sandbox: 'allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer', loading: 'lazy' }),
      h('div.row', {}, images ? null : h('button.btn.ghost.small', { type: 'button', onclick: () => showHtml(true) }, 'Load pictures'), h('button.btn.ghost.small', { type: 'button', onclick: showText }, 'Plain text')));
  };
  showText();
  return h(`article.mail-msg.${m.direction}`, { 'data-mail-msg': String(m.id) },
    h('header.row.spread', {}, h('b', {}, m.direction === 'in' ? (m.fromName ? `${m.fromName} <${m.from || 'form'}>` : m.from || 'Website form') : `To ${m.to.join(', ')}`), h('small', {}, timeAgo(m.createdAt))),
    flags.length ? h('p.mail-flags', {}, flags.join(' · ')) : null,
    body,
    m.hasHtml ? h('div.row', {}, h('button.btn.ghost.small', { type: 'button', 'data-mail-html': '', onclick: () => showHtml(false) }, 'Show formatted')) : null,
    m.attachments.length ? h('p.mail-files', {}, icon('paperclip'), ...m.attachments.map((a) => h('a', { href: `${BASE}/api/floors/${page.slug}/attachments/${a.id}`, download: a.name }, a.name))) : null,
    m.skipped?.length ? h('p.fineprint', {}, `Not kept: ${m.skipped.map((s) => `${s.name} (${s.why})`).join(', ')}`) : null);
}

function composeView(page, box, v, go) {
  box.append(h('div.row.mail-bar', {}, h('button.btn.ghost.small', { type: 'button', onclick: () => go({ mode: 'list' }) }, icon('arrow-left'), 'Inbox'), h('b.mail-thread-subject', {}, 'New email')));
  const to = h('input', { type: 'text', name: 'mail-to', placeholder: 'name@example.com', autocomplete: 'email', required: true });
  const subject = h('input', { type: 'text', name: 'mail-subject', placeholder: 'Subject', maxlength: 200, required: true });
  const text = h('textarea', { name: 'mail-text', rows: 8, maxlength: 20000, placeholder: 'Write it here', required: true });
  const sendBtn = h('button.btn.primary', { type: 'submit', 'data-mail-send-new': '' }, icon('paper-plane-tilt'), 'Send');
  box.append(h('form.mail-compose', { onsubmit: async (e) => {
    e.preventDefault(); sendBtn.disabled = true;
    try { const r = await api(`/floors/${page.slug}/mail/send`, { method: 'POST', body: { to: to.value, subject: subject.value, text: text.value } }); toast(r.status === 'sent' ? `Sent to ${r.to.join(', ')}` : `Not sent: ${r.note || r.status}`, r.status === 'sent' ? '' : 'bad'); go({ mode: 'list', folder: 'sent' }); } catch (err) { toast(err.message, 'bad'); sendBtn.disabled = false; }
  } }, h('label', {}, 'To'), to, h('label', {}, 'Subject'), subject, h('label', {}, 'Message'), text,
  h('div.row.spread', {}, h('small.fineprint', {}, `From ${v.address}, signed as ${page.state.floor?.name || 'the company'}. Up to ${v.caps?.recipients || 5} people.`), sendBtn)));
}
