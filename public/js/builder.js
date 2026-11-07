// The character builder: a live 3D preview plus option pickers. Used when claiming a floor and in the customiser.
import { h, clear } from './dom.js';
import { createPreview } from './character.js';
import { SKIN, HAIR, HAIR_COLOR, OUTFIT, OUTFIT_COLOR, HAT, GLASSES } from './looks.js';

const LABEL = { wood: 'Wood', carpet: 'Carpet', terrazzo: 'Terrazzo', concrete: 'Concrete', dog: 'Dog', cat: 'Cat', none: 'None', short: 'Short', side: 'Swept', long: 'Long', bun: 'Bun', curly: 'Curls', mohawk: 'Mohawk', pigtails: 'Pigtails', suit: 'Suit', shirt: 'Shirt', hoodie: 'Hoodie', tee: 'Tee', dress: 'Dress', labcoat: 'Lab coat', overalls: 'Overalls', cap: 'Cap', beanie: 'Beanie', tophat: 'Top hat', crown: 'Crown', party: 'Party', hardhat: 'Hard hat', headphones: 'Headset', round: 'Round', shades: 'Shades' };

export function swatches(options, value, onPick, label) {
  const row = h('div.swatches', { role: 'radiogroup', 'aria-label': label });
  const paint = (v) => { for (const b of row.children) b.setAttribute('aria-checked', String(b.dataset.v === v)); };
  for (const c of options) row.append(h('button.swatch', { type: 'button', role: 'radio', 'data-v': c, 'aria-label': `${label} ${c}`, css: { '--c': c }, onclick: () => { paint(c); onPick(c); } }));
  paint(value);
  return row;
}
export function chips(options, value, onPick, label) {
  const row = h('div.chips', { role: 'radiogroup', 'aria-label': label });
  const paint = (v) => { for (const b of row.children) b.setAttribute('aria-checked', String(b.dataset.v === v)); };
  for (const o of options) row.append(h('button.chip', { type: 'button', role: 'radio', 'data-v': o, onclick: () => { paint(o); onPick(o); } }, LABEL[o] || o));
  paint(value);
  return row;
}

/** Builds into `root`. Returns { look, dispose }; `look` is mutated in place as options change. */
export function characterBuilder(root, startLook, accent) {
  const look = { ...startLook };
  const canvas = h('canvas.char-preview', { width: 220, height: 260 });
  const form = h('div.char-options');
  clear(root).append(h('div.char-builder', {}, h('div.char-stage', {}, canvas), form));
  const preview = createPreview(canvas, look, accent);
  const change = (k) => (v) => { look[k] = v; preview.update({ ...look }); };
  const row = (title, node) => h('div.opt-row', {}, h('span.opt-label', {}, title), node);
  form.append(
    row('Skin', swatches(SKIN, look.skin, change('skin'), 'Skin')),
    row('Hair', chips(HAIR, look.hair, change('hair'), 'Hair')),
    row('Hair colour', swatches(HAIR_COLOR, look.hairColor, change('hairColor'), 'Hair colour')),
    row('Outfit', chips(OUTFIT, look.outfit, change('outfit'), 'Outfit')),
    row('Outfit colour', swatches(OUTFIT_COLOR, look.outfitColor, change('outfitColor'), 'Outfit colour')),
    row('Hat', chips(HAT, look.hat, change('hat'), 'Hat')),
    row('Glasses', chips(GLASSES, look.glasses, change('glasses'), 'Glasses')),
  );
  return { look, dispose: () => preview.dispose() };
}
