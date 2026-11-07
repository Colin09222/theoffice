// Router and app shell. Pages: lobby, floor, admin. Everything else is a dialog.
import { stage } from './stage.js';
import { BASE, refreshMe, clear, $ } from './dom.js';
import { showLobby, hideLobby } from './lobby-ui.js';
import { showFloor, hideFloor } from './floor-ui.js';
import { showAdmin, hideAdmin } from './admin-ui.js';

const ui = $('#ui');
let current = null;

export function go(path, { replace = false } = {}) {
  const url = `${BASE}${path}`;
  if (replace) history.replaceState({}, '', url); else history.pushState({}, '', url);
  route();
}
window.officeGo = go;

async function route() {
  const path = location.pathname.replace(/\/+$/, '').slice(BASE.length) || '/';
  // Stepping out of an office goes through a short flash of light, the same one that opened it.
  const fade = $('#fade');
  const leavingFloor = document.body.dataset.page === 'floor' && !path.startsWith('/floor/');
  if (leavingFloor) { fade.classList.add('in'); await new Promise((r) => setTimeout(r, 240)); }
  current?.();
  current = null;
  clear(ui);
  document.body.dataset.page = '';
  const floorMatch = path.match(/^\/floor\/([a-z0-9-]+)$/);
  try {
    if (path === '/admin') { current = hideAdmin; await showAdmin(ui); return; }
    if (floorMatch) { current = hideFloor; await showFloor(ui, floorMatch[1]); return; }
    current = hideLobby;
    await showLobby(ui);
  } finally {
    if (leavingFloor) requestAnimationFrame(() => fade.classList.remove('in'));
  }
}

async function boot() {
  stage.init($('#scene'));
  // Fonts first, because canvas signs draw with them.
  await Promise.race([document.fonts?.load('600 64px Fraunces').catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  try { await refreshMe(); } catch { /* still browsable */ }
  window.addEventListener('popstate', route);
  await route();
  document.documentElement.classList.add('ready');
}
boot();
