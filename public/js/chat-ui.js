// The boss's view of the website chat, at the top of the Inbox: what visitors asked that the assistant couldn't answer, every conversation, the FAQ and the on/off switch.
// Only the boss's page ever asks for it, and the server answers nobody else. Visitors' words are shown as plain text.
import { h, api, clear, toast, timeAgo } from './dom.js';

export const chatWaiting = (page) => page.state?.sitechat?.waiting || 0;
const PLURAL = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A word from the server: something new is waiting, or the count changed. The event carries no words. Never sent to a visitor. */
export function onChatEvent(page, d) {
  if (!page.owner) return;
  page.state.sitechat = { ...(page.state.sitechat || {}), waiting: d.waiting };
  if (d.question) toast('A visitor asked something the chat couldn\'t answer. It\'s in your Inbox.');
  page.renderTabs();
  if (page.tab === 'inbox' && page.chatBox?.isConnected && page.chatBox.dataset.open === 'yes') loadChat(page);
}

function reply(page, conversationId, done) {
  const text = h('textarea.sc-reply', { rows: 2, maxlength: 2000, placeholder: 'Write a reply. The visitor sees it in the chat.' });
  const go = h('button.btn.primary.small', { type: 'button', 'data-chat-reply': '', onclick: async () => {
    const v = text.value.trim();
    if (!v) { text.focus(); return; }
    go.disabled = true;
    try {
      const r = await api(`/floors/${page.slug}/sitechat/conversations/${conversationId}/reply`, { method: 'POST', body: { text: v } });
      toast(r.emailed ? 'Sent to the chat, and by email' : r.note ? `Sent to the chat. ${r.note}` : 'Sent to the chat');
      done?.();
    } catch (e) { toast(e.message, 'bad'); } finally { go.disabled = false; }
  } }, 'Send reply');
  return h('div.sc-replybox', {}, text, go);
}

function waitingView(page, wrap, v) {
  if (!v.waiting.length) { wrap.append(h('p.sc-empty', {}, 'Nothing waiting. Questions the assistant can\'t answer show up here.')); return; }
  for (const q of v.waiting) {
    wrap.append(h('article.sc-q', { 'data-chat-question': q.id },
      h('header', {}, h('b', {}, q.projectTitle), h('small', {}, ` ${timeAgo(q.at)}`)),
      h('p.sc-text', {}, q.question),
      q.email ? h('p.sc-email', {}, `Wants a reply at ${q.email}`) : h('p.sc-email', {}, 'No email left: your reply shows in the chat if they are still there.'),
      reply(page, q.conversation, () => { toastReload(page); })));
  }
}
const toastReload = (page) => { page.chatTab = page.chatTab || 'waiting'; loadChat(page); };

function conversationsView(page, wrap, v) {
  if (!v.conversations.length) { wrap.append(h('p.sc-empty', {}, 'No conversations yet.')); return; }
  for (const c of v.conversations) {
    const open = h('button.sc-row', { type: 'button', 'data-chat-conversation': c.id, onclick: () => showConversation(page, wrap, v, c.id) },
      h('b', {}, c.projectTitle), h('small', {}, ` ${timeAgo(c.at)}${c.status === 'waiting' ? ' · waiting' : ''}`), h('span', {}, c.preview || '(nothing yet)'));
    wrap.append(open);
  }
}
async function showConversation(page, wrap, v, id) {
  clear(wrap).append(h('p.sc-empty', {}, 'Opening…'));
  let c;
  try { c = await api(`/floors/${page.slug}/sitechat/conversations/${id}`); } catch (e) { clear(wrap).append(h('p.sc-empty', {}, e.message)); return; }
  clear(wrap);
  wrap.append(h('button.btn.ghost.small', { type: 'button', onclick: () => loadChat(page) }, 'Back'));
  if (c.email) wrap.append(h('p.sc-email', {}, `Left an address: ${c.email}`));
  const names = { visitor: 'Visitor', ai: 'AI assistant', boss: 'You' };
  for (const m of c.messages) wrap.append(h(`div.sc-msg.${m.role}`, {}, h('small', {}, names[m.role] || m.role), h('span', {}, m.text)));
  wrap.append(reply(page, c.id, () => showConversation(page, wrap, v, id)));
}

function faqView(page, wrap, v) {
  if (!v.projects.length) { wrap.append(h('p.sc-empty', {}, 'Nothing launched yet.')); return; }
  for (const p of v.projects) {
    const switched = h('input', { type: 'checkbox', checked: p.wanted, 'data-chat-switch': p.slug, disabled: p.private, onchange: async () => {
      try { await api(`/floors/${page.slug}/sitechat/${p.slug}/settings`, { method: 'POST', body: { on: switched.checked } }); toast(switched.checked ? 'Chat is on for this project' : 'Chat is off for this project'); } catch (e) { toast(e.message, 'bad'); switched.checked = !switched.checked; }
    } });
    const rows = h('div.sc-faq');
    const addRow = (q = '', a = '') => rows.append(h('div.sc-faqrow', {}, h('input.sc-faqq', { value: q, maxlength: 160, placeholder: 'Question' }), h('textarea.sc-faqa', { rows: 2, maxlength: 500, placeholder: 'Answer' }, a), h('button.btn.ghost.small', { type: 'button', onclick: (e) => e.target.closest('.sc-faqrow').remove() }, 'Remove')));
    (p.faq.length ? p.faq : [{ q: '', a: '' }]).forEach((x) => addRow(x.q, x.a));
    const add = h('button.btn.ghost.small', { type: 'button', onclick: () => addRow() }, 'Add a question');
    const save = h('button.btn.primary.small', { type: 'button', 'data-chat-faq-save': p.slug, onclick: async () => {
      const faq = [...rows.querySelectorAll('.sc-faqrow')].map((r) => ({ q: r.querySelector('.sc-faqq').value.trim(), a: r.querySelector('.sc-faqa').value.trim() })).filter((x) => x.q && x.a);
      save.disabled = true;
      try { await api(`/floors/${page.slug}/sitechat/${p.slug}/settings`, { method: 'POST', body: { faq } }); toast('FAQ saved'); } catch (e) { toast(e.message, 'bad'); } finally { save.disabled = false; }
    } }, 'Save FAQ');
    const note = p.stopped ? 'Paused for now by the building manager.' : p.private ? 'Private projects have no chat.' : p.kind === 'game' || p.kind === 'simulation' ? 'A chat bubble over a game is off unless you turn it on.' : '';
    wrap.append(h('section.sc-project', {}, h('header', {}, h('b', {}, p.title), h('label.sc-switch', {}, switched, ' Chat on')), note ? h('p.sc-email', {}, note) : null, rows, h('div.row', {}, add, save)));
  }
}

const TABS = [['waiting', 'Questions'], ['conversations', 'Conversations'], ['faq', 'FAQ and switches']];
async function loadChat(page) {
  const box = page.chatBox;
  if (!box) return;
  const body = box.querySelector('.sc-body');
  let v;
  try { v = await api(`/floors/${page.slug}/sitechat`); } catch (e) { clear(body).append(h('p.sc-empty', {}, e.message)); return; }
  if (!body.isConnected) return;
  page.state.sitechat = { ...(page.state.sitechat || {}), waiting: v.waiting.length };
  box.querySelector('.sc-count').textContent = v.waiting.length ? `· ${v.waiting.length} waiting` : '';
  page.renderTabs();
  const tab = page.chatTab || 'waiting';
  clear(body);
  const nav = h('div.sc-tabs', {}, TABS.map(([id, label]) => h(`button.chip${tab === id ? '.on' : ''}`, { type: 'button', 'data-chat-tab': id, onclick: () => { page.chatTab = id; loadChat(page); } }, id === 'waiting' && v.waiting.length ? `${label} (${v.waiting.length})` : label)));
  const wrap = h('div.sc-view');
  body.append(nav, wrap);
  if (tab === 'waiting') waitingView(page, wrap, v);
  else if (tab === 'conversations') conversationsView(page, wrap, v);
  else faqView(page, wrap, v);
}

/** The block at the top of the Inbox. Folded unless something is waiting. */
export function chatBox(page) {
  const open = page.chatOpen ?? chatWaiting(page) > 0;
  const body = h('div.sc-body');
  const box = h('section.sc-box', { 'data-chat-box': '', 'data-open': open ? 'yes' : 'no' },
    h('button.sc-head', { type: 'button', 'data-chat-head': '', onclick: () => {
      page.chatOpen = box.dataset.open !== 'yes';
      box.dataset.open = page.chatOpen ? 'yes' : 'no';
      if (page.chatOpen) loadChat(page);
    } }, h('b', {}, 'Website chat'), h('span.sc-count', {}, chatWaiting(page) ? `· ${PLURAL(chatWaiting(page), 'question')} waiting` : ''), h('small', {}, 'Open')),
    body);
  page.chatBox = box;
  if (open) loadChat(page);
  return box;
}
