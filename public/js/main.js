// Router and app shell. Pages: lobby, floor, admin. Everything else is a dialog.
// No 3D code is imported here (docs/redesign, jobs 14 and 16): the home page is plain DOM, and the stage starts when a page needs it.
import { BASE, refreshMe, clear, toast, isPhone, $ } from './dom.js';
import { showLobby, hideLobby } from './lobby-ui.js';
import { wireSounds } from './sfx.js';

// A direct link to a floor names every module the floor page needs here, so a slow line fetches them together rather than discovering them one import at a time.
const FLOOR_MODULES = ['floor-ui', 'office-scene', 'character', 'cast', 'looks', 'models', 'toon', 'layouts', 'offices', 'textures', 'life', 'labels', 'cutaway', 'framing', 'markdown', 'customise', 'builder', 'numbers-ui', 'claim', 'floor-chrome', 'portrait', 'floorcache', 'attach', 'party', 'business-ui', 'mail-ui', 'chat-ui', 'server-panel', 'pay-ui', 'legal-ui', 'launch-ui', 'setup-ui'];
// Not on a phone: there a floor opens as plain DOM, and its room's code is only fetched once someone taps Watch the room (docs/redesign, job 16).
if (location.pathname.includes('/floor/') && !window.matchMedia('(max-width: 760px)').matches) {
  const stamp = new URL(import.meta.url).search;
  for (const m of FLOOR_MODULES) document.head.append(Object.assign(document.createElement('link'), { rel: 'modulepreload', href: new URL(`./${m}.js${stamp}`, import.meta.url).href }));
}

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
  // Stepping out of an office goes through the lift doors, the same ones that opened it.
  const fade = $('#fade');
  const leavingFloor = document.body.dataset.page === 'floor' && !path.startsWith('/floor/');
  const doors = leavingFloor;
  if (doors) { fade.dataset.title = 'The Office'; fade.classList.add('in'); await new Promise((r) => setTimeout(r, 240)); }
  current?.({ next: path });
  current = null;
  clear(ui);
  document.body.dataset.page = '';
  const floorMatch = path.match(/^\/floor\/([a-z0-9-]+)$/);
  try {
    if (path === '/admin') { const { showAdmin, hideAdmin } = await import('./admin-ui.js'); current = hideAdmin; await showAdmin(ui); return; }
    if (floorMatch) {
      // A phone gets the floor without its room first: no 3D code until Watch the room (docs/redesign, job 16).
      const lite = await import('./floor-lite.js');
      if (lite.liteFloor(floorMatch[1])) { current = lite.hideFloorLite; await lite.showFloorLite(ui, floorMatch[1], { onRoom: () => route() }); return; }
      // The doors shut straight away, so a slow line never holds up on a frozen close-up of the glass. The floor opens them when its room is ready.
      (await import('./stage-start.js')).startStage();
      const { showFloor, hideFloor } = await import('./floor-ui.js'); current = hideFloor; await showFloor(ui, floorMatch[1]);
      return;
    }
    // Everything the building has launched, on one page (docs/redesign, jobs 14 and 24).
    const launched = path.match(/^\/launched(?:\/([a-z0-9-]+))?$/);
    if (launched) { const { showLaunched, hideLaunched } = await import('./launched-ui.js'); current = hideLaunched; await showLaunched(ui, { floor: launched[1] || null }); return; }
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
      document.documentElement.style.setProperty('--vvt', `${Math.max(0, Math.round(vv.offsetTop))}px`);  // what iOS has scrolled the page up by to show the field
      document.body.classList.toggle('kb-open', kb > 80);
      window.dispatchEvent(new CustomEvent('office:kb'));
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
  trackKeyboard();
  wireSounds();
  // Fonts first, because canvas signs draw with them and the headline shouldn't reflow in front of anyone.
  await Promise.race([Promise.all([document.fonts?.load('700 64px "Bricolage Grotesque"'), document.fonts?.load('600 64px Fraunces'), document.fonts?.load('400 16px "DM Sans"')]).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  try { await refreshMe(); } catch { /* still browsable */ }
  window.addEventListener('popstate', route);
  try { await route(); } catch (e) { console.error(e); toast('Something broke on the way in. Try reloading.'); }
  // One clean reveal: the curtain lifts on the finished picture, not on a half-built one that then changes.
  // The admin page has no scene to wait for, so its curtain has nothing to hold out for.
  // A floor's curtain lifts on the room's first picture: its furniture and people fill in from there, with nothing in the way.
  // The home page waits for nothing 3D: its content is the picture. A floor waits for its room's first frame, as before.
  if (document.body.dataset.page === 'floor') {
    const { stage } = await import('./stage-start.js');
    await Promise.race([stage.ok ? stage.whenPainted(2600) : null, new Promise((r) => setTimeout(r, 3400))]);
  }
  lift();
  // Once things are quiet, fetch the floor's code in the background, so the first walk in is instant. Not on a data-saving connection, and never
  // on a phone, where no 3D code loads until someone asks for the room (docs/redesign, job 16).
  if (document.body.dataset.page === 'lobby' && !navigator.connection?.saveData && !isPhone()) {
    setTimeout(() => (window.requestIdleCallback || setTimeout)(() => import('./floor-ui.js').catch(() => {}), { timeout: 4000 }), 2500);
  }
}
boot().catch((e) => { console.error(e); toast('Something broke on the way in. Try reloading.'); lift(); });
