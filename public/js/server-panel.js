// The boss's Servers tab and the slot requests in Requests: what each project's server is doing, its logs and jobs, its settings, and how to free a slot.
// Everything runs through the floor's own API, as the boss. Lives on its own so floor-ui.js only asks for the tab and the cards. Text from a server is only ever text.
import { h, api, clear, toast, timeAgo } from './dom.js';

const STATUS = { running: ['Running', 'on'], sleeping: ['Asleep', 'idle'], stopped: ['Stopped', 'off'], building: ['Building', 'busy'], build_failed: ['Build failed', 'bad'], killed: ['Switched off by the building', 'off'], unknown: ['Can\'t tell right now', 'off'] };

export const serversPending = (page) => (page.state.servers?.requests || []).length;
export const serverTab = (page) => (page.state.servers?.on ? ['servers', page.state.servers.count ? `Servers ${page.state.servers.count}` : 'Servers'] : null);

const slotLine = (s) => (s ? `${s.used} of ${s.max} server slots in the building are in use.` : '');
const full = (s) => !!s && s.used >= s.max;

async function answer(page, project, what) {
  try {
    await api(`/floors/${page.slug}/servers/${encodeURIComponent(project)}/${what}`, { method: 'POST', body: {} });
    if (what === 'approve') toast(`Building the server for ${project}`);
  } catch (e) { toast(e.message, 'bad'); }
  await page.reload?.();
}

/** One card per waiting request, in the same list as every other request. */
export function renderServerRequests(page, list) {
  const v = page.state.servers;
  if (!v?.on) return;
  for (const r of v.requests || []) {
    const room = !full(v.slots);
    list.append(h('article.card.request.server-request', { 'data-server-request': r.project },
      h('b', {}, `Give ${r.project} its own server?`),
      r.why ? h('p', {}, r.why) : null,
      h('small', {}, `It uses one of the building's server slots. ${v.slots ? `${Math.max(0, v.slots.max - v.slots.used)} of ${v.slots.max} free right now.` : ''}`),
      r.tier === 'browser' ? h('small', {}, 'It runs a real browser, so it uses one of the few places for that too.') : null,
      room ? null : h('p.domain-note', {}, 'The building is full right now. To make room, delete one of your own servers on the Servers tab: deleting frees its slot, stopping keeps it.'),
      h('div.row', {},
        h('button.btn.primary', { type: 'button', disabled: !room, 'data-server-approve': r.project, onclick: () => answer(page, r.project, 'approve') }, 'Allow it'),
        h('button.btn.ghost', { type: 'button', 'data-server-decline': r.project, onclick: () => answer(page, r.project, 'decline') }, 'No thanks'),
        room ? null : h('button.btn.ghost', { type: 'button', onclick: () => page.setTab('servers') }, 'See my servers'))));
  }
}

const every = (schedule) => {
  const m = String(schedule).trim().match(/^(\S+) (\S+) \* \* \*$/);
  if (!m) return schedule;
  const [, min, hour] = m;
  const n = (x, unit) => `every ${x === 1 ? unit : `${x} ${unit}s`}`;
  if (hour === '*') { const x = /^\*\/(\d+)$/.exec(min); return x ? n(Number(x[1]), 'minute') : min === '*' ? 'every minute' : /^\d+$/.test(min) ? `every hour at :${min.padStart(2, '0')}` : schedule; }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) return `every day at ${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`;
  const x = /^\*\/(\d+)$/.exec(hour);
  return x && /^\d+$/.test(min) ? n(Number(x[1]), 'hour') : schedule;
};

function logsBox(page, s) {
  const out = h('pre.server-log', {}, 'Opening…');
  const load = async () => {
    try {
      const l = await api(`/floors/${page.slug}/servers/${encodeURIComponent(s.project)}/logs`);
      out.textContent = [l.logs && `Output\n${l.logs}`, l.jobs && `Scheduled jobs\n${l.jobs}`, l.build && `Last build\n${l.build}`].filter(Boolean).join('\n\n') || 'Nothing yet.';
      out.scrollTop = out.scrollHeight;
    } catch (e) { out.textContent = e.message; }
  };
  const box = h('details.server-more', { 'data-open-key': `logs:${s.project}`, ontoggle: (e) => { if (e.target.open) load(); } },
    h('summary', {}, 'Recent logs'), out, h('button.btn.ghost.small', { type: 'button', onclick: load }, 'Refresh'));
  return box;
}

function jobsBox(page, s) {
  if (!s.cron?.length) return null;
  return h('details.server-more', { 'data-open-key': `jobs:${s.project}` }, h('summary', {}, `Scheduled jobs (${s.cron.length})`),
    h('ul.server-jobs', {}, s.cron.map((j) => h('li', {}, h('div', {}, h('b', {}, j.name), h('small', {}, `${every(j.schedule)}${s.jobsRunning?.includes(j.name) ? ' · running now' : ''}`)),
      h('button.btn.ghost.small', { type: 'button', 'data-job': j.name, onclick: async () => {
        try { await api(`/floors/${page.slug}/servers/${encodeURIComponent(s.project)}/jobs/${encodeURIComponent(j.name)}`, { method: 'POST', body: {} }); toast('Started. Its output will be in the logs.'); } catch (e) { toast(e.message, 'bad'); }
      } }, 'Run now')))));
}

function envBox(page, s, refresh) {
  const name = h('input', { placeholder: 'NAME', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'data-env-name': '', maxlength: 64 });
  const value = h('input', { type: 'password', placeholder: 'Value', autocomplete: 'off', 'data-env-value': '', maxlength: 4096 });
  const send = async (change) => {
    try { await api(`/floors/${page.slug}/servers/${encodeURIComponent(s.project)}/env`, { method: 'POST', body: change }); name.value = ''; value.value = ''; toast('Saved. The server picks it up on its next start.'); await refresh(); } catch (e) { toast(e.message, 'bad'); }
  };
  return h('details.server-more', { 'data-open-key': `env:${s.project}` }, h('summary', {}, `Settings (${s.env.length})`),
    h('p.fineprint', {}, 'Environment settings for this server, such as your own API keys. You can replace or remove them; nobody can read a value back. The building\'s own keys are never given to an app.'),
    s.env.length ? h('ul.server-env', {}, s.env.map((n) => h('li', {}, h('code', {}, n), h('button.btn.ghost.small', { type: 'button', 'data-env-remove': n, onclick: () => send({ unset: [n] }) }, 'Remove')))) : null,
    h('form.server-env-form', { onsubmit: (e) => { e.preventDefault(); const n = name.value.trim().toUpperCase(); if (n && value.value) send({ set: { [n]: value.value } }); } }, name, value, h('button.btn.primary.small', { type: 'submit' }, 'Save')));
}

function card(page, s, refresh) {
  const [word, tone] = STATUS[s.status] || [s.status, 'off'];
  const act = (what, ok) => async () => {
    try { await api(`/floors/${page.slug}/servers/${encodeURIComponent(s.project)}/${what}`, { method: 'POST', body: {} }); toast(ok); await refresh(); } catch (e) { toast(e.message, 'bad'); }
  };
  const busy = s.status === 'building';
  const del = async () => {
    if (!window.confirm(`Delete the server for ${s.project}? Its files on the server go with it, and the building gets its slot back. This can't be undone.`)) return;
    await act('delete', 'Deleted. The slot is free.')();
    page.reload?.();
  };
  return h('article.card.server', { 'data-server': s.project },
    h('div.row.spread', {}, h('b', {}, s.project), h(`span.server-status.${tone}`, { 'data-status': s.status }, word)),
    h('a.server-url', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.url),
    h('small', {}, `${s.tier === 'browser' ? 'With a real browser' : 'Standard'}${s.deployedAt ? ` · deployed ${timeAgo(s.deployedAt)}` : ''}${s.lastTraffic ? ` · last visit ${timeAgo(s.lastTraffic)}` : ''}`),
    s.status === 'build_failed' && s.build?.error ? h('p.domain-note', {}, `Build failed: ${s.build.error}`) : null,
    s.note ? h('p.domain-note', {}, s.note) : null,
    s.lastExit && s.status !== 'running' ? h('small', {}, `Last stopped with code ${s.lastExit.code}${s.lastExit.oomKilled ? ' (out of memory)' : ''}.`) : null,
    h('div.row.server-actions', {},
      h('button.btn.ghost.small', { type: 'button', disabled: busy, 'data-server-restart': s.project, onclick: act('restart', 'Restarted.') }, 'Restart'),
      s.status === 'stopped' ? h('button.btn.ghost.small', { type: 'button', onclick: act('start', 'Started.') }, 'Start') : h('button.btn.ghost.small', { type: 'button', disabled: busy || s.status === 'killed', 'data-server-stop': s.project, onclick: act('stop', 'Stopped. It keeps its slot.') }, 'Stop'),
      h('button.btn.danger.small', { type: 'button', disabled: busy, 'data-server-delete': s.project, onclick: del }, 'Delete to free the slot')),
    logsBox(page, s), jobsBox(page, s), envBox(page, s, refresh));
}

/** Re-renders only when something changed and nobody is typing, so a details box or a half-entered setting doesn't vanish under the boss. */
export async function renderServers(page) {
  const box = h('div.servers');
  page.bodyEl.append(box);
  let last = '';
  const open = new Set();
  const draw = async (force) => {
    let v;
    try { v = await api(`/floors/${page.slug}/servers`); } catch (e) { clear(box).append(h('p.empty', {}, e.message)); return; }
    const sig = JSON.stringify(v);
    if (page.tab !== 'servers' || (!force && (sig === last || box.querySelector('input:focus, form input[data-env-value]:not(:placeholder-shown)')))) return;
    last = sig;
    for (const d of box.querySelectorAll('details[open]')) open.add(d.dataset.openKey);
    clear(box);
    if (!v.on) { box.append(h('p.empty', {}, 'Server slots aren\'t available in this building right now.')); return; }
    box.append(h('p.fineprint', {}, `${slotLine(v.slots)} Most things run on Office Cloud without one.`));
    if (!v.servers.length && !v.requests.length) box.append(h('p.empty', {}, 'No servers yet. If an idea really needs one, the team will ask you here first.'));
    for (const r of v.requests) box.append(h('p.fineprint', {}, `${r.project} is waiting for your yes in Requests.`));
    for (const s of v.servers) box.append(card(page, s, () => draw(true)));
    for (const d of box.querySelectorAll('details')) if (open.has(d.dataset.openKey)) d.open = true;
    for (const d of box.querySelectorAll('details')) { const k = d.dataset.openKey; d.addEventListener('toggle', () => { if (d.open) open.add(k); else open.delete(k); }); }
  };
  box.append(h('p.empty', {}, 'Opening…'));
  await draw(true);
  const timer = setInterval(() => { if (page.dead || page.tab !== 'servers' || !box.isConnected) clearInterval(timer); else if (!document.hidden) draw(false); }, 8000);
}
