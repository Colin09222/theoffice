// Router and app shell. Pages: lobby, floor, admin. Everything else is a dialog.
import { stage } from './stage.js';
import { BASE, refreshMe, clear, toast, $ } from './dom.js';
import { showLobby, hideLobby } from './lobby-ui.js';
import { wireSounds } from './sfx.js';

const ui = $('#ui');
let current = null;

export function go(path, { replace = false } = {}) {
  const url = `${BASE}${path}`;
  if (replace) history.replaceState({}, '', url); else history.pushState({}, '', url);
  route();
}
window.officeGo = go;

async function route() {
  performance.mark('office:route');
  const path = location.pathname.replace(/\/+$/, '').slice(BASE.length) || '/';
  // Stepping out of an office goes through the lift doors, the same ones that opened it.
  const fade = $('#fade');
  const leavingFloor = document.body.dataset.page === 'floor' && !path.startsWith('/floor/');
  // Back to the 3D building: the room goes back into the stack and the camera flies out of it, so there are no doors to go through.
  const flyOut = leavingFloor && path === '/' && !!(await window.__office?.handBack?.());
  const doors = leavingFloor && !flyOut;
  if (doors) { fade.dataset.title = 'The Office'; fade.classList.add('in'); await new Promise((r) => setTimeout(r, 240)); }
  current?.({ next: path });
  current = null;
  clear(ui);
  document.body.dataset.page = '';
  const floorMatch = path.match(/^\/floor\/([a-z0-9-]+)$/);
  try {
    if (path === '/admin') { const { showAdmin, hideAdmin } = await import('./admin-ui.js'); current = hideAdmin; await showAdmin(ui); return; }
    if (floorMatch) {
      // The doors shut straight away, so a slow line never holds up on a frozen close-up of the glass. The floor opens them when its room is ready.
      // Flown in from the 3D building, the room is already on screen: no doors at all.
      const { showFloor, hideFloor } = await import('./floor-ui.js'); current = hideFloor; await showFloor(ui, floorMatch[1]);
      return;
    }
    current = hideLobby;
    await showLobby(ui);
  } finally {
    if (doors) requestAnimationFrame(() => fade.classList.remove('in'));
    if (floorMatch && !window.__office) fade.classList.remove('in');  // no such floor: nothing else will lift it
  }
}

// On a phone the keyboard covers the page without resizing it, in iOS Safari and in current Chrome alike. The sheets lift by its height, and the page is put back where it was when it closes.
function trackKeyboard() {
  const vv = window.visualViewport;
  if (vv) {
    const fit = () => {
      const kb = Math.max(0, Math.round(Math.max(window.innerHeight, document.documentElement.clientHeight) - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty('--kb', `${kb}px`);
      document.body.classList.toggle('kb-open', kb > 80);
    };
    vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (!/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) window.scrollTo(0, 0); }, 60));
}

/** The curtain lifts once, whatever happened on the way. */
function lift() {
  document.documentElement.classList.add('ready');
  const curtain = $('#boot');
  curtain?.classList.add('gone');
  setTimeout(() => curtain?.remove(), 700);
}

async function boot() {
  stage.init($('#scene'));
  stage.notice = (m) => toast(m);
  trackKeyboard();
  wireSounds();
  // Fonts first, because canvas signs draw with them and the headline shouldn't reflow in front of anyone.
  await Promise.race([Promise.all([document.fonts?.load('400 64px "Lilita One"'), document.fonts?.load('600 64px Fraunces'), document.fonts?.load('500 16px Barlow')]).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  try { await refreshMe(); } catch { /* still browsable */ }
  window.addEventListener('popstate', route);
  try { await route(); } catch (e) { console.error(e); toast('Something broke on the way in. Try reloading.'); }
  // One clean reveal: the curtain lifts on the finished picture, not on a half-built one that then changes.
  // The admin page has no scene to wait for, so its curtain has nothing to hold out for.
  // A floor's curtain lifts on the room's first picture: its furniture and people fill in from there, with nothing in the way.
  await Promise.race([stage.ok && document.body.dataset.page !== 'admin' ? stage.whenPainted(2600) : null, new Promise((r) => setTimeout(r, 3400))]);
  lift();
  // Once things are quiet, fetch the floor's code in the background, so the first walk in is instant. Not on a data-saving connection.
  if (document.body.dataset.page === 'lobby' && !navigator.connection?.saveData) {
    setTimeout(() => (window.requestIdleCallback || setTimeout)(() => import('./floor-ui.js').catch(() => {}), { timeout: 4000 }), 2500);
  }
}
boot().catch((e) => { console.error(e); toast('Something broke on the way in. Try reloading.'); lift(); });
