// The building manager's view: every floor, spend, purchase requests, codes and the emergency stops.
import { h, api, modal, toast, money, session, refreshMe, ApiError, clear } from './dom.js';
import { recoveryBox } from './claim.js';
import { stage } from './stage.js';

let timer = null;
export async function showAdmin(root) {
  document.body.dataset.page = 'admin';
  // A direct load has no 3D stage (since the home page stopped starting one, job 14): setView would throw and leave the page blank
  // (found by job 26's check of the ranked view). Only a stage that is running has a view to drop.
  if (stage.ok) { stage.setView(null); stage.renderer?.setClearColor?.('#16172a'); stage.renderer?.clear?.(); }
  const wrap = h('main.admin');
  root.append(wrap);
  if (!session.admin) return renderLogin(wrap);
  return renderDash(wrap);
}
export function hideAdmin() { clearInterval(timer); timer = null; }

function renderLogin(wrap) {
  const pw = h('input', { type: 'password', name: 'password', required: true, autocomplete: 'current-password', autofocus: true });
  const err = h('p.form-error', { role: 'alert', hidden: true });
  clear(wrap).append(h('form.admin-login', { onsubmit: async (e) => {
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
  const metrics = h('section.metrics'); const floors = h('div.table-wrap'); const buys = h('section.buys'); const head = h('div.admin-actions'); const doms = h('section.buys'); const helpLine = h('section.buys.help-line'); const budget = h('section.budget'); const stuck = h('section.buys.stuck-jobs'); const ranked = h('div.table-wrap.ranked'); const library = h('section.buys.library');
  clear(wrap).append(h('header.admin-head', {}, h('h1', {}, 'Building manager'), head), metrics, h('h2', {}, 'Building budget'), budget, h('h2', {}, 'Floors'), floors, h('h2', {}, 'Ranked by real use per $100'), ranked, h('h2', {}, 'Stuck jobs'), stuck, h('h2', {}, 'Help line'), helpLine, h('h2', {}, 'Pending purchase requests'), buys, h('h2', {}, 'Domains'), doms, h('h2', {}, 'Building library'), library);
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
    clear(budget).append(...budgetRows(d.budget));
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
    // Colon's ranked view (redesign job 26): real use per $100 over 7 and 28 days. Each button asks first; none of them sets a budget.
    const rk = await api('/admin/ranked').catch(() => null);
    if (rk) {
      const press = (f, action, title, text) => confirm(title, text, () => post(`/admin/ranked/${f.id}/${action}`, { confirm: true }));
      const per = (w) => (w.perHundred === null ? (w.realUse ? 'no spend' : '-') : String(w.perHundred));
      const rrows = rk.floors.map((f) => h('tr', { 'data-ranked': f.slug, ...(f.priority ? { 'data-priority': '1' } : {}), ...(f.killed ? { 'data-killed': '1' } : {}) },
        h('td', {}, String(f.number)), h('td', {}, f.name, f.priority ? h('span.filler-badge', {}, 'Priority') : null, f.killed ? h('span.filler-badge', {}, 'Killed') : null),
        ...rk.windows.flatMap((n) => [h('td.num', {}, money(f.windows[n].spendUsd)), h('td.num', {}, String(f.windows[n].realUse)), h('td.num', { 'data-per': n }, per(f.windows[n]))]),
        h('td', {}, f.lastLaunch ? `${f.lastLaunch.title} · ${new Date(f.lastLaunch.at).toLocaleDateString()}` : 'None yet'),
        h('td.acts', {},
          f.priority ? h('button.btn.ghost.small', { type: 'button', 'data-act': 'undo-double-down', onclick: () => press(f, 'undo-double-down', 'Undo double down', `Take the priority mark off ${f.name}?`) }, 'Undo double down')
            : h('button.btn.primary.small', { type: 'button', 'data-act': 'double-down', onclick: () => press(f, 'double-down', 'Double down', `Mark ${f.name} as a priority, here and in your digest? It changes no cap.`) }, 'Double down'),
          f.killed ? null : f.paused ? h('button.btn.ghost.small', { type: 'button', 'data-act': 'resume', onclick: () => press(f, 'resume', 'Resume', `Let ${f.name}'s team work again?`) }, 'Resume')
            : h('button.btn.ghost.small', { type: 'button', 'data-act': 'pause', onclick: () => press(f, 'pause', 'Pause', `Pause ${f.name}'s team? Its boss can resume it.`) }, 'Pause'),
          f.killed ? h('button.btn.ghost.small', { type: 'button', 'data-act': 'unkill', onclick: () => press(f, 'unkill', 'Bring back', `Bring ${f.name} back as it was before Kill?`) }, 'Bring back')
            : h('button.btn.danger.small', { type: 'button', 'data-act': 'kill', onclick: () => press(f, 'kill', 'Kill', `Pause ${f.name}'s team and take it off the public lists? You can bring it back here.`) }, 'Kill'))));
      const heads = ['#', 'Company', ...rk.windows.flatMap((n) => [`Spent ${n}d`, `Real use ${n}d`, `Per $100 ${n}d`]), 'Last launch', ''];
      clear(ranked).append(h('table.admin-table', {}, h('thead', {}, h('tr', {}, ...heads.map((t) => h('th', {}, t)))), h('tbody', {}, ...rrows)),
        h('p.fineprint', {}, rk.log.length ? `Last presses: ${rk.log.slice(0, 5).map((l) => `${l.action} on floor ${l.floorNumber} by ${l.who}, ${new Date(l.at).toLocaleString()}`).join('; ')}.` : 'No presses yet.'));
    }
    // Stuck jobs, each with Send out: the only way a job reaches the outside contractor (redesign job 19). Titles were written by bots: text only.
    const sj = await api('/admin/stuck').catch(() => null);
    if (sj) clear(stuck).append(h('p.fineprint', {}, `Sent out this week: ${sj.sentOutThisWeek} of ${sj.mostAWeek}.`), ...(sj.jobs.length ? sj.jobs.map((j) => h('article.card.request', { 'data-stuck': j.task }, h('small', {}, `#${j.task} · Floor ${j.floorNumber} · ${j.role || ''} · ${j.status}`), h('p', {}, j.title), j.canSendOut ? h('div.row', {}, h('button.btn.primary.small', { type: 'button', 'data-send-out': j.task, onclick: () => confirm('Send out', `Send task #${j.task} to the outside contractor? ${sj.mostAWeek - sj.sentOutThisWeek} left this week.`, () => post(`/admin/tasks/${j.task}/send-out`)) }, 'Send out')) : null)) : [h('p.empty', {}, 'Nothing is stuck.')]));
    // Written by a bot or a friend, so it stays fenced exactly as the server sent it, and only ever as text.
    const hl = await api('/admin/help').catch(() => null);
    if (hl) clear(helpLine).append(...(hl.requests.length ? [h('p.fineprint', {}, hl.notice), ...hl.requests.map((r) => h('article.card.request', { 'data-help': r.id }, h('small', {}, `#${r.id} · Floor ${r.floorNumber} · expires ${new Date(r.expiresAt).toLocaleTimeString()}`), h('p.untrusted', {}, r.floorName), h('p.untrusted', {}, r.question), h('p.untrusted', {}, r.whatWasTried), h('div.row', {}, h('button.btn.primary.small', { type: 'button', 'data-answer': r.id, onclick: () => answerHelp(r.id) }, 'Answer'), h('button.btn.ghost.small', { type: 'button', 'data-decline': r.id, onclick: () => post(`/admin/help/${r.id}`, { decline: true }) }, 'Decline'))))] : [h('p.empty', {}, 'Nobody is waiting on buddehbot.')]));
    clear(buys).append(...(d.purchases.length ? d.purchases.map((p) => h('article.card.request', {}, h('div.row.spread', {}, h('b', {}, `${p.item}`), h('span.price', {}, money(p.price))), h('p', {}, p.why), h('small', {}, p.floor), h('div.row', {}, h('button.btn.primary.small', { type: 'button', 'data-bought': p.id, onclick: () => post(`/admin/purchases/${p.id}`, { status: 'bought' }) }, 'Mark bought'), h('button.btn.ghost.small', { type: 'button', 'data-rejected': p.id, onclick: () => post(`/admin/purchases/${p.id}`, { status: 'rejected' }) }, 'Reject')))) : [h('p.empty', {}, 'Nothing pending. Agents can only ask.')]));
    // The building library (r2-j69): nothing is shared until one tap here. Written by bots, so text only.
    const lib = await api('/admin/library').catch(() => null);
    if (lib) {
      const waiting = lib.entries.filter((e) => e.status === 'waiting'), approved = lib.entries.filter((e) => e.status === 'approved').length;
      clear(library).append(h('p.fineprint', {}, `${approved} approved. Only approved entries reach other floors.`), ...(waiting.length ? waiting.map((e) => h('article.card.request', { 'data-library': e.id },
        h('small', {}, `#${e.id} · ${e.seed ? 'Seed' : `Floor ${e.floorNumber}`} · ${e.lane}${e.removed ? ` · ${e.removed} private detail(s) taken out` : ''}`),
        h('p.untrusted', {}, e.title), h('p.untrusted', {}, e.lesson), e.code ? h('pre.untrusted', {}, e.code) : null,
        h('div.row', {}, h('button.btn.primary.small', { type: 'button', 'data-approve': e.id, onclick: () => post(`/admin/library/${e.id}`, { action: 'approve' }) }, 'Approve'), h('button.btn.ghost.small', { type: 'button', 'data-reject': e.id, onclick: () => post(`/admin/library/${e.id}`, { action: 'reject' }) }, 'Reject')))) : [h('p.empty', {}, 'Nothing waiting.')]));
    }
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
// The lifetime limits. This page is the only place in the building that shows them.
const PROVIDER_NAME = { anthropic: 'Claude API', openrouter: 'OpenRouter' };
function budgetRows(b) {
  const cards = Object.entries(b.providers).map(([p, x]) => h(`article.budget-card.flag-${x.flag.replace('%', '')}`, { 'data-provider': p, 'data-flag': x.flag },
    h('div.row.spread', {}, h('b', {}, PROVIDER_NAME[p] || p), x.flag === 'none' ? null : h('span.budget-flag', {}, x.stopped ? `${x.flag}, stopped` : x.flag)),
    h('p', {}, x.limitUsd === null ? `${money(x.spentUsd)} spent, no limit` : `${money(x.spentUsd)} of ${money(x.limitUsd)} spent, ${money(x.remainingUsd)} left`),
    x.limitUsd === null ? null : h('span.budget-track', {}, h('i', { css: { width: `${Math.min(100, x.percent)}%` } })),
    x.heldUsd > 0 ? h('small', {}, `${money(x.heldUsd)} held by running work`) : null));
  const rows = b.floors.slice(0, 60).map((f) => h('tr', {}, h('td', {}, f.floorNumber === null ? '-' : String(f.floorNumber)), h('td', {}, f.floorName), h('td.num', {}, money(f.anthropicUsd)), h('td.num', {}, money(f.openrouterUsd)), h('td.num', {}, money(f.totalUsd))));
  return [h('div.budget-cards', {}, ...cards), rows.length ? h('div.table-wrap', {}, h('table.admin-table', {}, h('thead', {}, h('tr', {}, ...['#', 'Spent by floor', 'Claude API', 'OpenRouter', 'Total'].map((t) => h('th', {}, t)))), h('tbody', {}, rows))) : h('p.empty', {}, 'Nothing spent yet.')];
}
