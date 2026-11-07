// The character builder: a live 3D preview plus option pickers. Used when claiming a floor and in the customiser.
import { h, clear } from './dom.js';
import { createPreview } from './character.js';
import { SKIN, HAIR, HAIR_COLOR, OUTFIT, OUTFIT_COLOR, HAT, GLASSES, WEAR, BODY, CHARACTER_PRESETS, randomLook } from './looks.js';

const LABEL = { wood: 'Wood', carpet: 'Carpet', terrazzo: 'Terrazzo', concrete: 'Concrete', parquet: 'Parquet', checker: 'Checker', tile: 'Tile', rubber: 'Rubber', dog: 'Dog', cat: 'Cat', bunny: 'Bunny', duck: 'Duck', tortoise: 'Tortoise', robot: 'Robot', none: 'None', short: 'Short', side: 'Swept', long: 'Long', bun: 'Bun', curly: 'Curls', mohawk: 'Mohawk', pigtails: 'Pigtails', suit: 'Suit', shirt: 'Shirt', hoodie: 'Hoodie', tee: 'Tee', dress: 'Dress', labcoat: 'Lab coat', overalls: 'Overalls', cap: 'Cap', beanie: 'Beanie', tophat: 'Top hat', crown: 'Crown', party: 'Party', hardhat: 'Hard hat', headphones: 'Headset', cowboy: 'Cowboy', wizard: 'Wizard', chef: 'Chef', viking: 'Viking', pirate: 'Pirate', beret: 'Beret', propeller: 'Propeller', halo: 'Halo', round: 'Round', shades: 'Shades', monocle: 'Monocle', eyepatch: 'Eyepatch', beard: 'Beard', moustache: 'Moustache', scarf: 'Scarf', bowtie: 'Bow tie', tie: 'Tie', badge: 'Badge', cape: 'Cape', backpack: 'Backpack', wings: 'Wings', auto: 'Match my outfit', 'male-a': 'Specs', 'male-b': 'Big beard', 'male-c': 'Cop', 'male-d': 'Exec', 'male-e': 'Engineer', 'male-f': 'Scowler', 'female-a': 'Crutches', 'female-b': 'Space buns', 'female-c': 'Hairclip', 'female-d': 'Director', 'female-e': 'Ponytail', 'female-f': 'Backpacker', paint: 'Paint', brick: 'Brick', panels: 'Panels', shapes: 'Shapes', skyline: 'Skyline', posters: 'Posters', logo: 'Our logo' };

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

/** Builds into `root`. Returns { look, dispose }; `look` is mutated in place as options change. `onChange` hears every change. */
export function characterBuilder(root, startLook, accent, { onChange } = {}) {
  const look = { wear: 'none', body: 'auto', ...startLook };
  const canvas = h('canvas.char-preview', { width: 220, height: 260 });
  const form = h('div.char-options');
  clear(root).append(h('div.char-builder', {}, h('div.char-stage', {}, canvas), form));
  const preview = createPreview(canvas, look, accent);
  const rows = {};
  const refresh = () => { preview.update({ ...look }); onChange?.(look); };
  const change = (k) => (v) => { look[k] = v; refresh(); };
  const apply = (next) => { Object.assign(look, next); for (const [k, r] of Object.entries(rows)) r.setValue(look[k]); refresh(); };
  const row = (title, node) => h('div.opt-row', {}, h('span.opt-label', {}, title), node);
  const pick = (k, title, fn, list) => { rows[k] = fn(list, look[k], change(k), title); return row(title, rows[k]); };
  form.append(
    h('div.opt-row', {}, h('span.opt-label', {}, 'Quick looks'), h('div.chips.look-presets', { role: 'group', 'aria-label': 'Quick looks' },
      h('button.chip.surprise', { type: 'button', 'data-surprise': '', onclick: () => apply(randomLook()) }, 'Surprise me'),
      ...Object.entries(CHARACTER_PRESETS).map(([id, p]) => h('button.chip', { type: 'button', 'data-preset': id, onclick: () => apply(p.look) }, p.label)))),
    pick('body', 'Person', chips, BODY),
    pick('skin', 'Skin', swatches, SKIN),
    pick('hair', 'Hair', chips, HAIR),
    pick('hairColor', 'Hair colour', swatches, HAIR_COLOR),
    pick('outfit', 'Outfit', chips, OUTFIT),
    pick('outfitColor', 'Outfit colour', swatches, OUTFIT_COLOR),
    pick('hat', 'Hat', chips, HAT),
    pick('glasses', 'Glasses', chips, GLASSES),
    pick('wear', 'Extras', chips, WEAR),
  );
  return { look, dispose: () => preview.dispose() };
}
