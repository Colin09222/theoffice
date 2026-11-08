// The character builder: a live 3D preview plus option pickers. Used when claiming a floor and in the customiser.
// It offers only what really shows on a bean. An older look keeps its skin, hair and outfit in the data (looks.js), because who someone is still comes from them.
import { h, clear } from './dom.js';
import { createPreview } from './character.js';
import { specFor } from './cast.js';
import { BODY_COLOR, SUIT_COLOR, TIE_COLOR, HAT, GLASSES, CHARACTER_PRESETS, randomLook } from './looks.js';

const LABEL = { wood: 'Wood', carpet: 'Carpet', terrazzo: 'Terrazzo', concrete: 'Concrete', parquet: 'Parquet', checker: 'Checker', tile: 'Tile', rubber: 'Rubber', dog: 'Dog', cat: 'Cat', bunny: 'Bunny', duck: 'Duck', tortoise: 'Tortoise', robot: 'Robot', none: 'None', cap: 'Cap', beanie: 'Beanie', tophat: 'Top hat', crown: 'Crown', party: 'Party', hardhat: 'Hard hat', headphones: 'Headset', cowboy: 'Cowboy', wizard: 'Wizard', chef: 'Chef', viking: 'Viking', pirate: 'Pirate', beret: 'Beret', propeller: 'Propeller', halo: 'Halo', round: 'Round', shades: 'Shades', monocle: 'Monocle', eyepatch: 'Eyepatch', paint: 'Paint', brick: 'Brick', panels: 'Panels', shapes: 'Shapes', skyline: 'Skyline', posters: 'Posters', logo: 'Our logo' };

export function swatches(options, value, onPick, label) {
  const row = h('div.swatches', { role: 'radiogroup', 'aria-label': label });
  const paint = (v) => { for (const b of row.children) b.setAttribute('aria-checked', String(b.dataset.v === v)); };
  for (const c of options) row.append(h('button.swatch', { type: 'button', role: 'radio', 'data-v': c, 'aria-label': `${label} ${c}`, css: { '--c': c }, onclick: () => { paint(c); onPick(c); } }));
  paint(value);
  row.setValue = paint;
  return row;
}
export function chips(options, value, onPick, label, names = {}) {
  const row = h('div.chips', { role: 'radiogroup', 'aria-label': label });
  const paint = (v) => { for (const b of row.children) b.setAttribute('aria-checked', String(b.dataset.v === v)); };
  for (const o of options) row.append(h('button.chip', { type: 'button', role: 'radio', 'data-v': o, onclick: () => { paint(o); onPick(o); } }, names[o] || LABEL[o] || o));
  paint(value);
  row.setValue = paint;
  return row;
}

/** Builds into `root`. Returns { look, dispose }; `look` is mutated in place as options change. `onChange` hears every change. `role` is whose look this is: the preview shows them as the room will, and only what shows on them is offered. */
export function characterBuilder(root, startLook, accent, { onChange, role = 'boss' } = {}) {
  const look = { ...startLook };
  const canvas = h('canvas.char-preview', { width: 220, height: 260 });
  const form = h('div.char-options');
  clear(root).append(h('div.char-builder', {}, h('div.char-stage', {}, canvas), form));
  const preview = createPreview(canvas, look, accent, role);
  const rows = {};
  // A colour nobody has picked shows as the one they already have, which may move with the others: a new body colour can need a suit that stands apart from it.
  const paint = () => { const s = specFor(look, { role }); for (const [k, v] of Object.entries({ bodyColor: s.color, suitColor: s.suit, tieColor: s.tie, hat: s.hat, glasses: s.glasses || 'none' })) rows[k]?.setValue(v); };
  const refresh = () => { paint(); preview.update({ ...look }); onChange?.(look); };
  const change = (k) => (v) => { look[k] = v; refresh(); };
  const apply = (next) => { for (const k of Object.keys(rows)) if (k in next) look[k] = next[k]; refresh(); };
  const row = (title, node) => h('div.opt-row', {}, h('span.opt-label', {}, title), node);
  const pick = (k, title, fn, list) => { rows[k] = fn(list, look[k], change(k), title); return row(title, rows[k]); };
  // Asks the cast itself, so this can't drift from what the room really shows.
  const shows = (k, v) => specFor({ ...look, [k]: v }, { role })[k] === v;
  const dressUp = shows('hat', HAT[1]) && shows('glasses', GLASSES[1]);
  form.append(
    h('div.opt-row', {}, h('span.opt-label', {}, 'Quick looks'), h('div.chips.look-presets', { role: 'group', 'aria-label': 'Quick looks' },
      h('button.chip.surprise', { type: 'button', 'data-surprise': '', onclick: () => apply(randomLook()) }, 'Surprise me'),
      ...(dressUp ? Object.entries(CHARACTER_PRESETS).map(([id, p]) => h('button.chip', { type: 'button', 'data-preset': id, onclick: () => apply(p.look) }, p.label)) : []))),
    pick('bodyColor', 'Body colour', swatches, BODY_COLOR),
    pick('suitColor', 'Suit colour', swatches, SUIT_COLOR),
    pick('tieColor', 'Tie colour', swatches, TIE_COLOR),
    ...(dressUp ? [pick('hat', 'Hat', chips, HAT), pick('glasses', 'Glasses', chips, GLASSES)] : []),
  );
  paint();
  return { look, dispose: () => preview.dispose() };
}
