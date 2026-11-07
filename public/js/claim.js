// Dialogs for getting a floor: entering a code, setting up the company and boss, and signing back in with a recovery code.
import { h, api, modal, refreshMe, BASE, session, ApiError } from './dom.js';
import { characterBuilder, swatches } from './builder.js';
import { DEFAULT_LOOK, DEFAULT_COLORS, slugFrom } from './looks.js';

const BRAND = ['#d9774a', '#c8455a', '#7a4bb5', '#2f7ec7', '#23937f', '#6f8f3a', '#e0a526', '#3b3f4f'];
const ACCENT = ['#f4c95d', '#ff9f7a', '#8fd3c7', '#a9c4ff', '#f2a7c3', '#e8e0d0'];

const err = () => h('p.form-error', { role: 'alert', hidden: true });
const showErr = (el, e) => { el.textContent = e instanceof ApiError ? e.message : 'Something went wrong. Try again.'; el.hidden = false; };

export function openClaim({ code = '' } = {}) {
  let movedIn = null;
  modal('Open an office', (body, close) => {
    const state = { code, floor: null, name: '', tagline: '', colors: { ...DEFAULT_COLORS }, bossName: '', look: { ...DEFAULT_LOOK } };
    let builder = null;
    const stepCode = () => {
      const input = h('input.code-input', { name: 'code', placeholder: 'OFFICE-XXXX-XXXX-XXXX-XXXX', value: state.code, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', autofocus: true, 'aria-label': 'Your office code', maxlength: 64 });
      const e = err();
      const form = h('form.stack', { onsubmit: async (ev) => {
        ev.preventDefault();
        e.hidden = true;
        try {
          const r = await api('/claim/check', { method: 'POST', body: { code: input.value } }); state.code = input.value; state.floor = r.floor;
          // No form: the office manager gets the company's name out of you on the phone. A server that still wants the form says so with a 400.
          try {
            const made = await api('/claim', { method: 'POST', body: { code: state.code } });
            session.csrf = made.csrf;
            await refreshMe();
            stepRecovery(made);
          } catch (x) { if (x instanceof ApiError && x.status === 400) stepCompany(); else throw x; }
        } catch (x) { showErr(e, x); }
      } },
      h('p.lede', {}, 'Got a code from the building manager? It opens one office, once.'),
      input, e, h('button.btn.primary.wide', { type: 'submit' }, 'Unlock the door'),
      h('p.fineprint', {}, 'No code yet? They are handed out by hand, so ask whoever sent you here. Anyone can still walk in and watch.'),
      session.floor ? null : h('button.link', { type: 'button', onclick: () => { close(); openLogin(); } }, 'Already have a floor? Sign in'));
      body.replaceChildren(form);
      input.focus();
    };
    const stepCompany = () => {
      const name = h('input', { name: 'company', value: state.name, placeholder: 'Tiny Empire Ltd', maxlength: 60, required: true, autofocus: true });
      const tag = h('input', { name: 'tagline', value: state.tagline, placeholder: 'What this floor is for', maxlength: 120 });
      const form = h('form.stack', { onsubmit: (ev) => { ev.preventDefault(); state.name = name.value.trim(); state.tagline = tag.value.trim(); if (state.name.length >= 2) stepBoss(); } },
        h('p.step-kicker', {}, `Floor ${state.floor ?? ''} is yours. Step 1 of 2`),
        h('label.field', {}, h('span', {}, 'Company name'), name),
        h('label.field', {}, h('span', {}, 'Tagline'), tag),
        h('div.field', {}, h('span', {}, 'Main colour'), swatches(BRAND, state.colors.primary, (c) => { state.colors.primary = c; }, 'Main colour')),
        h('div.field', {}, h('span', {}, 'Accent colour'), swatches(ACCENT, state.colors.accent, (c) => { state.colors.accent = c; }, 'Accent colour')),
        h('button.btn.primary.wide', { type: 'submit' }, 'Next: who is the boss?'));
      body.replaceChildren(form);
      name.focus();
    };
    const stepBoss = () => {
      const name = h('input', { name: 'boss', value: state.bossName, placeholder: 'What the staff call you', maxlength: 30, required: true });
      const holder = h('div');
      const e = err();
      const form = h('form.stack', { onsubmit: async (ev) => {
        ev.preventDefault(); e.hidden = true;
        try {
          const r = await api('/claim', { method: 'POST', body: { code: state.code, name: state.name, tagline: state.tagline, colors: state.colors, bossName: name.value.trim(), look: builder.look } });
          session.csrf = r.csrf;
          builder.dispose(); builder = null;
          await refreshMe();
          stepRecovery(r);
        } catch (x) { showErr(e, x); }
      } },
      h('p.step-kicker', {}, 'Step 2 of 2. Make yourself the boss'),
      h('label.field', {}, h('span', {}, 'Your name'), name), holder, e,
      h('div.row.sticky-foot', {}, h('button.btn.ghost', { type: 'button', onclick: () => { builder.dispose(); stepCompany(); } }, 'Back'), h('button.btn.primary.grow', { type: 'submit' }, 'Move in')));
      body.replaceChildren(form);
      builder = characterBuilder(holder, state.look, state.colors.accent);
      state.look = builder.look;
      name.focus();
    };
    const stepRecovery = (r) => {
      movedIn = r.slug;
      body.replaceChildren(h('div.stack', {},
        h('p.lede', {}, 'The keys are yours. Keep this recovery code somewhere safe: it is the only way back in from another device, and it won\'t be shown again.'),
        recoveryBox(r.recoveryCode),
        h('p.fineprint', {}, `Your floor's address is ${location.origin}${BASE}/floor/${r.slug}`),
        h('button.btn.primary.wide', { type: 'button', onclick: () => close() }, 'Go up. Your manager is on the phone')));
    };
    stepCode();
  }, { wide: true, onClose: () => { if (movedIn) window.officeGo(`/floor/${movedIn}`); } });
}

export function recoveryBox(code) {
  const copy = h('button.btn.ghost', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy it'; } } }, 'Copy');
  return h('div.recovery', {}, h('code', { 'data-recovery': true }, code), copy);
}

export function openLogin(slugHint = '') {
  let back = null;
  modal('Back to my floor', (body, close) => {
    const slug = h('input', { name: 'slug', value: slugHint, placeholder: 'Your company name, or your floor\'s link', maxlength: 200, required: true, autocomplete: 'username', autocapitalize: 'off' });
    const code = h('input', { name: 'recovery', placeholder: 'RECOVER-XXXXX-XXXXX-...', maxlength: 64, required: true, autocomplete: 'off', autocapitalize: 'characters' });
    const e = err();
    body.append(h('form.stack', { onsubmit: async (ev) => {
      ev.preventDefault(); e.hidden = true;
      try {
        const r = await api('/login', { method: 'POST', body: { slug: slugFrom(slug.value), recoveryCode: code.value.trim() } });
        session.csrf = r.csrf;
        await refreshMe();
        back = r.slug;
        body.replaceChildren(h('div.stack', {},
          h('p.lede', {}, 'You\'re back in. Recovery codes work once, so here is your new one. Save it now: the old one has stopped working, and other devices have been signed out.'),
          recoveryBox(r.recoveryCode),
          h('button.btn.primary.wide', { type: 'button', onclick: () => close() }, 'Go to my floor')));
      } catch (x) { showErr(e, x); }
    } },
    h('label.field', {}, h('span', {}, 'Your floor'), slug), h('label.field', {}, h('span', {}, 'Recovery code'), code), e,
    h('button.btn.primary.wide', { type: 'submit' }, 'Sign in'),
    h('p.fineprint', {}, 'Lost the recovery code? Only the building manager can help, so ask them.')));
  }, { onClose: () => { if (back) window.officeGo(`/floor/${back}`); } });
}
