// The building manager's view: every floor, spend, purchase requests, codes and the emergency stops.
import { h, api, modal, toast, money, session, refreshMe, ApiError, clear } from './dom.js';
import { recoveryBox } from './claim.js';
import { stage } from './stage.js';

let timer = null;
export async function showAdmin(root) {
  document.body.dataset.page = 'admin';
  stage.setView(null);
  stage.renderer?.setClearColor?.('#16172a'); stage.renderer?.clear?.();
  const wrap = h('main.admin');
  root.append(wrap);
  if (!session.admin) return renderLogin(wrap);
  return renderDash(wrap);
}
export function hideAdmin() { clearInterval(timer); timer = null; }

function renderLogin(wrap) {
  const pw = h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password', autofocus: true });
  const err = h('p.form-error', { role: 'alert', hidden: true });
  clear(wrap).append(h('form.admin-login.glass', { onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    try {
      const r = await api('/admin/login', { method: 'POST', body: { password: pw.value } });
      session.adminCsrf = r.csrf; session.admin = true;
      renderDash(wrap);
    } catch (x) { err.textContent = x instanceof ApiError ? x.message : 'Could not sign in.'; err.hidden = false; }
  } }, h('h1', {}, 'Building manager'), h('label.field', {}, h('span', {}, 'Password'), pw), err, h('button.btn.primary.wide', { type: 'submit' }, 'Sign in')));
  pw.focus();
}

async function renderDash(wrap) {
  const metrics = h('section.metrics'); const floors = h('div.table-wrap'); const buys = h('section.buys'); const head = h('div.admin-actions'); const doms = h('section.buys'); const helpLine = h('section.buys.help-line');
  clear(wrap).append(h('header.admin-head', {}, h('h1', {}, 'Building manager'), head), metrics, h('h2', {}, 'Floors'), floors, h('h2', {}, 'Help line'), helpLine, h('h2', {}, 'Pending purchase requests'), buys, h('h2', {}, 'Domains'), doms);
  const post = async (path, body) => { try { const r = await api(path, { method: 'POST', body, admin: true }); await draw(); return r; } catch (e) { toast(e.message, 'bad'); return null; } };
  const confirm = (title, text, go) => modal(title, (b, close) => b.append(h('div.stack', {}, h('p.lede', {}, text), h('div.row', {}, h('button.btn.ghost.grow', { type: 'button', onclick: () => close() }, 'Cancel'), h('button.btn.danger.grow', { type: 'button', 'data-confirm': true, onclick: () => { close(); go(); } }, title)))));
  async function draw() {
    let d;
    try { d = await api('/admin/overview'); } catch (e) { if (e.status === 401) { session.admin = false; clearInterval(timer); renderLogin(wrap); } return; }
    clear(head).append(
      h('button.btn.primary', { type: 'button', onclick: issue }, 'Issue a code'),
      h(`button.btn.${d.globalPause ? 'primary' : 'danger'}`, { type: 'button', onclick: () => post('/admin/pause', { on: !d.globalPause }) }, d.globalPause ? 'Resume the building' : 'Pause the building'),
      h('button.btn.ghost', { type: 'button', onclick: async () => { await api('/admin/logout', { method: 'POST', admin: true }); await refreshMe(); clearInterval(timer); renderLogin(wrap); } }, 'Sign out'),
      h('a.btn.ghost', { href: '/theoffice', onclick: (e) => { e.preventDefault(); window.officeGo('/'); } }, 'Lobby'));
    clear(metrics).append(metric('Spent today', d.globalCap == null ? money(d.spendToday) : `${money(d.spendToday)} of ${money(d.globalCap)}`), metric('Floors', String(d.floors.length)), metric('Unclaimed codes', String(d.unclaimedCodes)), metric('LLM calls now', `${d.liveLLM} running, ${d.queuedLLM} queued`), metric('Mode', d.aiMode === 'mock' ? 'Mock (no spend)' : 'Live'), metric('Status', d.globalPause ? 'Paused' : 'Running'), metric('Domains bought', money(d.domainsSpent || 0)));
    // A filler floor is a scripted demo company with no owner: one button takes it down and frees the floor for a real code.
    const rows = d.floors.map((f) => h('tr', { 'data-floor': f.slug, ...(f.filler ? { 'data-filler': '1' } : {}) }, h('td', {}, String(f.number)),
      h('td', {}, h('a', { href: `/theoffice/floor/${f.slug}`, onclick: (e) => { e.preventDefault(); window.officeGo(`/floor/${f.slug}`); } }, f.name), f.filler ? h('span.filler-badge', { title: 'A scripted demo company. Nobody owns it and it never calls a model.' }, 'filler') : null),
      h('td', {}, f.status === 'active' ? (f.paused ? 'Paused' : 'Open') : 'Suspended'), h('td.num', {}, money(f.spendToday)), h('td.num', {}, money(f.spendTotal)), h('td.num', {}, String(f.running)), h('td.num', {}, String(f.projects)), h('td.num', {}, `${(f.bytes / 1048576).toFixed(1)} MB`),
      f.filler ? h('td.acts', {}, h('button.btn.danger.small.filler-remove', { type: 'button', onclick: () => confirm('Remove filler', `Take ${f.name} out of the building? It is a demo company, so nothing of anyone's is lost, and it stays gone until you seed fillers again.`, () => post('/admin/filler/remove', { id: f.id })) }, 'Remove filler'))
        : h('td.acts', {},
          f.status === 'active' ? h('button.btn.ghost.small', { type: 'button', onclick: () => post(`/admin/floors/${f.id}/suspend`) }, 'Suspend') : h('button.btn.ghost.small', { type: 'button', onclick: () => post(`/admin/floors/${f.id}/unsuspend`) }, 'Unsuspend'),
          h('button.btn.ghost.small', { type: 'button', onclick: () => confirm('Reset', `Wipe all work on ${f.name}, keeping the owner and their look?`, () => post(`/admin/floors/${f.id}/reset`)) }, 'Reset'),
          h('button.btn.danger.small', { type: 'button', onclick: () => confirm('Kill', `Delete ${f.name} and everything on it? This can't be undone, and the floor goes back on the market.`, () => post(`/admin/floors/${f.id}/kill`)) }, 'Kill'))));
    clear(floors).append(h('table.admin-table', {}, h('thead', {}, h('tr', {}, ...['#', 'Company', 'Status', 'Today', 'Total', 'Running', 'Projects', 'Storage', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 9 }, 'No floors yet. Issue a code to get someone started.')))));
    // Written by a bot or a friend, so it stays fenced exactly as the server sent it, and only ever as text.
    const hl = await api('/admin/help').catch(() => null);
    if (hl) clear(helpLine).append(...(hl.requests.length ? [h('p.fineprint', {}, hl.notice), ...hl.requests.map((r) => h('article.card.request', { 'data-help': r.id }, h('small', {}, `#${r.id} · Floor ${r.floorNumber} · expires ${new Date(r.expiresAt).toLocaleTimeString()}`), h('p.untrusted', {}, r.floorName), h('p.untrusted', {}, r.question), h('p.untrusted', {}, r.whatWasTried), h('div.row', {}, h('button.btn.primary.small', { type: 'button', 'data-answer': r.id, onclick: () => answerHelp(r.id) }, 'Answer'), h('button.btn.ghost.small', { type: 'button', 'data-decline': r.id, onclick: () => post(`/admin/help/${r.id}`, { decline: true }) }, 'Decline'))))] : [h('p.empty', {}, 'Nobody is waiting on buddehbot.')]));
    clear(buys).append(...(d.purchases.length ? d.purchases.map((p) => h('article.card.request', {}, h('div.row.spread', {}, h('b', {}, `${p.item}`), h('span.price', {}, money(p.price))), h('p', {}, p.why), h('small', {}, p.floor))) : [h('p.empty', {}, 'Nothing pending. Agents can only ask.')]));
    clear(doms).append(...(d.domainOrders?.length ? d.domainOrders.map((o) => h('article.card.request', {}, h('div.row.spread', {}, h('b', {}, o.domain), h('span.price', {}, money(o.chargedUsd ?? o.priceUsd))), h('small', {}, `${o.floor} · ${o.status}${o.estimated ? ' · amount estimated' : ''}${o.orderId ? ` · order ${o.orderId}` : ''}`), o.note ? h('p', {}, o.note) : null)) : [h('p.empty', {}, d.domainsOn ? 'No domains asked for yet.' : 'Domain buying is not set up.')]));
  }
  // In a dialog, because the dashboard redraws itself every few seconds and would eat a half-written answer.
  function answerHelp(id) {
    modal(`Answer request #${id}`, (body, close) => {
      const text = h('textarea', { rows: 6, maxlength: 4000, required: true, autofocus: true, 'aria-label': 'Your answer', placeholder: 'Advice for that floor\'s manager. It gets no new powers from this.' });
      body.append(h('form.stack', { onsubmit: async (e) => { e.preventDefault(); if (!text.value.trim()) return; if (await post(`/admin/help/${id}`, { text: text.value })) close(); } }, text, h('button.btn.primary.wide', { type: 'submit' }, 'Send to the manager')));
    });
  }
  function issue() {
    modal('Issue an office code', (body) => {
      const floor = h('input', { type: 'number', min: 1, max: 99, placeholder: 'Any free floor', 'aria-label': 'Floor number (optional)' });
      body.append(h('form.stack', { onsubmit: async (e) => {
        e.preventDefault();
        const r = await post('/admin/codes', floor.value ? { floor: Number(floor.value) } : {});
        if (r) body.replaceChildren(h('div.stack', {}, h('p.lede', {}, 'Send this to your friend. It works once and won\'t be shown again.'), recoveryBox(r.code)));
      } }, h('label.field', {}, h('span', {}, 'Reserve a floor (optional)'), floor), h('button.btn.primary.wide', { type: 'submit' }, 'Issue the code')));
    });
  }
  await draw();
  timer = setInterval(draw, 8000);
}
const metric = (label, value) => h('div.metric', {}, h('small', {}, label), h('b', {}, value));
