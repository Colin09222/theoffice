// The Customise panel. One draft and one Save for everything on it. Changes to the office show straight away in the real room behind
// the panel, and Cancel puts the room back. Hiring and letting go are the only things that happen at once, because they are real events.
import { h, api, clear, modal, toast, refreshMe } from './dom.js';
import { characterBuilder, swatches, chips } from './builder.js';
import { FLOOR_STYLES, PETS, LAYOUTS, WALL_MATS, ART_STYLES, VIBES, TONES, PERSONALITIES, WORK_KINDS, OUTFIT_COLOR, DEFAULT_DECOR } from './looks.js';
import { PLANS, planBlocks, deskRect, ROOM_W, ROOM_D } from './layouts.js';

const LIMITS = { about: 300, rules: 600, avoid: 300, notes: 200, focus: 120, title: 32, name: 24 };
const TABS = [['vibe', 'Vibe'], ['company', 'Company'], ['hours', 'Hours'], ['boss', 'You'], ['staff', 'Staff'], ['decor', 'Office']];
// Work modes: when the team works on its own. The sign reads the way the floor's door sign does.
const WORK_MODES = [['ask', 'When I ask', 'The team works on what you ask for, and waits for you.'], ['hours', 'Set hours', 'On the days and hours you pick, the team keeps going on its own.'], ['nonstop', 'Nonstop', 'Around the clock: whenever the floor is quiet, the next job starts.']];
const DAY_ORDER = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const clock12 = (hhmm) => { const [hr, mi] = String(hhmm).split(':').map(Number); return `${hr % 12 || 12}${mi ? `:${String(mi).padStart(2, '0')}` : ''}`; };
function signText(w) {
  if (w.mode === 'nonstop') return ['Open 24/7', 'Every day'];
  if (w.mode !== 'hours') return ['On call', 'When the boss calls'];
  const d = [...w.days].sort((a, b) => a - b); const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = d.length === 7 ? 'Every day' : d.join() === '1,2,3,4,5' ? 'Mon–Fri' : d.join() === '0,6' ? 'Weekends' : d.length >= 3 && d.every((x, i) => !i || x === d[i - 1] + 1) ? `${names[d[0]]}–${names[d.at(-1)]}` : d.map((x) => names[x]).join(', ');
  return [`Open ${clock12(w.start)}–${clock12(w.end)}`, days || 'No days picked'];
}
const zones = () => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } };
const SHORT = new Set(['vibe', 'decor']);  // tabs where the room above is the point, so the sheet leaves it in view on a phone
const COMPANY_COLOURS = ['#d9774a', '#27324a', '#c8643c', '#e0559b', '#d3264f', '#1f5fa8', '#7a6fd0', '#2f6f62', '#111318', '#f4c95d', '#c9a24b', '#27e6a4', '#9ec5e8', '#f6b6c8', '#ffd23f', '#f0c068'];

/** A little map of a floor plan: what the card shows, drawn from the same data the room is built from. */
function planThumb(id, primary) {
  const c = h('canvas.plan-thumb', { width: 132, height: 82, 'aria-hidden': 'true' });
  const x = c.getContext('2d'); const k = 132 / ROOM_W; const px = (v) => (v + ROOM_W / 2) * k, pz = (v) => (v + ROOM_D / 2) * (82 / ROOM_D);
  const plan = PLANS[id];
  x.fillStyle = 'rgba(255,255,255,.1)'; x.fillRect(0, 0, 132, 82);
  x.fillStyle = 'rgba(255,255,255,.34)'; x.fillRect(0, 0, 132, 2.5); x.fillRect(0, 0, 2.5, 82);
  x.fillStyle = 'rgba(160,210,255,.8)'; for (const [a, b] of plan.windows) x.fillRect(px(a), 0, (b - a) * k, 2.5);
  const box = ([bx, bz, w, d], fill) => { x.fillStyle = fill; x.fillRect(px(bx - w / 2), pz(bz - d / 2), w * k, d * (82 / ROOM_D)); };
  for (const b of planBlocks(plan, { coffee: true, arcade: false, plants: 0, staffCount: 4 })) box(b, 'rgba(255,255,255,.38)');
  for (const d of plan.desks.slice(0, 8)) box(deskRect(d), primary);
  return c;
}

// The owner's own settings for a person. `persona` became a public sentence, and the settings moved to `customise`; an older server still sends the object.
const settings = (a) => a.customise || (a.persona && typeof a.persona === 'object' ? a.persona : {});

export function openCustomisePanel(page, tab = 'vibe', agentId) {
  const s = page.state;
  let cleanup = () => {}, saved = false, timer = null;
  const staffDraft = (a) => ({ id: a.id, role: a.role, name: a.name, title: a.title, persona: { vibe: settings(a).vibe || '', notes: settings(a).notes || '', focus: settings(a).focus || '' }, look: { ...a.look } });
  const draft = {
    name: s.floor.name, tagline: s.floor.tagline, colors: { ...s.floor.colors }, decor: { ...DEFAULT_DECOR, ...s.floor.decor }, publicChat: s.floor.publicChat, defaultPrivate: s.floor.defaultPrivate,
    boss: { name: s.floor.boss.name, look: { ...s.floor.boss.look } },
    identity: { about: '', tone: '', rules: '', avoid: '', routing: {}, ...(s.identity || {}) },
    staff: s.agents.map(staffDraft),
  };
  const wp = s.workPlan || { mode: 'ask', dayList: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', tz: 'UTC', goal: '' };
  let ownTz = 'UTC'; try { ownTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* UTC */ }
  const work = { mode: wp.mode, days: [...wp.dayList], start: wp.start, end: wp.end, tz: wp.tzSet ? wp.tz : (wp.tz !== 'UTC' ? wp.tz : ownTz), goal: wp.goal || '' };
  const workBefore = JSON.stringify(work);
  const withoutStaff = () => JSON.stringify({ ...draft, staff: null, work });
  const before = withoutStaff();
  const changedStaff = () => draft.staff.filter((a) => JSON.stringify(a) !== JSON.stringify(page.state.agents.map(staffDraft).find((x) => x.id === a.id)));
  const showRoom = (now) => {
    clearTimeout(timer);
    const go = () => page.previewRoom({ ...draft.decor }, { ...draft.colors });
    if (now) go(); else timer = setTimeout(go, 140);
  };

  const m = modal('Customise', (body, close) => {
    const pane = h('div.custom-pane');
    const tabs = h('nav.tabs.custom-tabs');
    let currentAgent = agentId;
    const card = body.parentElement;
    const save = async (e) => {
      e?.preventDefault();
      const staff = changedStaff().map(({ role: _r, ...a }) => a);
      try {
        // The hours have their own route: they start or stop the team working on its own, and the chat gets a line about it.
        if (JSON.stringify(work) !== workBefore) await api(`/floors/${page.slug}/work-mode`, { method: 'POST', body: work });
        await api(`/floors/${page.slug}/customise`, { method: 'POST', body: { name: draft.name, tagline: draft.tagline, colors: draft.colors, decor: draft.decor, publicChat: draft.publicChat, defaultPrivate: draft.defaultPrivate, boss: draft.boss, identity: draft.identity, staff } });
        saved = true; toast('Saved'); close();
      } catch (x) { toast(x.message, 'bad'); }
    };
    const field = (label, node, hint) => h('label.field', {}, h('span', {}, label), node, hint ? h('small.field-hint', {}, hint) : null);
    const text = (value, max, onInput, attrs = {}) => h('input', { value, maxlength: max, oninput: (e) => onInput(e.target.value), ...attrs });
    const area = (value, max, rows, onInput, attrs = {}) => h('textarea', { rows, maxlength: max, oninput: (e) => onInput(e.target.value), ...attrs }, value);
    const colorRow = (label, get, set) => {
      const wheel = h('input.color-wheel', { type: 'color', value: get(), 'aria-label': `${label}: any colour`, oninput: (e) => { set(e.target.value); row.setValue(e.target.value); showRoom(); } });
      const row = swatches(COMPANY_COLOURS, get(), (v) => { set(v); wheel.value = v; showRoom(); }, label);
      return h('div.field', {}, h('span', {}, label), h('div.color-row', {}, row, wheel));
    };

    const tabVibe = () => {
      const say = h('p.tone-sample', {});
      const showSay = () => { const t = TONES[draft.identity.tone]; say.hidden = !t; if (t) say.textContent = `Your manager: "${t.say}"`; };
      const grid = h('div.vibes', { role: 'radiogroup', 'aria-label': 'Pick a vibe' });
      const mark = (id) => { for (const b of grid.children) b.setAttribute('aria-checked', String(b.dataset.v === id)); };
      const isCurrent = (v) => v.tone === draft.identity.tone && v.colors.primary === draft.colors.primary && v.decor.layout === draft.decor.layout && v.decor.floor === draft.decor.floor;
      for (const [id, v] of Object.entries(VIBES)) {
        grid.append(h('button.vibe', { type: 'button', role: 'radio', 'data-v': id, css: { '--a': v.colors.primary, '--b': v.colors.accent }, onclick: () => {
          Object.assign(draft.decor, v.decor); draft.colors = { ...v.colors }; draft.identity.tone = v.tone;
          mark(id); showSay(); showRoom(true); paintColours();
        } }, h('i.vibe-swatch', {}), h('b', {}, v.label), h('small', {}, v.blurb)));
      }
      mark(Object.entries(VIBES).find(([, v]) => isCurrent(v))?.[0]);
      const colours = h('div.stack');
      const paintColours = () => clear(colours).append(colorRow('Main colour', () => draft.colors.primary, (v) => { draft.colors.primary = v; mark(''); }), colorRow('Accent colour', () => draft.colors.accent, (v) => { draft.colors.accent = v; mark(''); }));
      paintColours(); showSay();
      pane.append(h('div.stack', {}, h('p.lede', {}, 'Pick a vibe. It sets the room, the colours and how your staff talk. You can change any of it afterwards.'), grid, say, colours));
    };

    const tabCompany = () => {
      const say = h('p.tone-sample', {});
      const showSay = () => { const t = TONES[draft.identity.tone]; say.hidden = !t; if (t) say.textContent = `Your manager: "${t.say}"`; };
      showSay();
      const toneRow = chips(['', ...Object.keys(TONES)], draft.identity.tone, (v) => { draft.identity.tone = v; showSay(); }, 'Tone of voice', { '': 'Default', ...Object.fromEntries(Object.entries(TONES).map(([k, t]) => [k, t.label])) });
      const onFloor = (role) => page.state.agents.some((a) => a.role === role);
      const routes = Object.entries(WORK_KINDS).filter(([, w]) => w.roles.every(onFloor));
      const titleOf = (role) => page.state.hiring?.roles.find((r) => r.role === role)?.title || role;
      pane.append(h('div.stack', {},
        field('Company name', text(draft.name, 60, (v) => { draft.name = v; }, { name: 'company' })),
        field('Tagline', text(draft.tagline, 120, (v) => { draft.tagline = v; })),
        h('section.private-box', {},
          h('h3', {}, 'What your staff are told', h('small', {}, 'Private: visitors never see this')),
          field('What the company does', area(draft.identity.about, LIMITS.about, 2, (v) => { draft.identity.about = v; }, { name: 'about', placeholder: 'We make tiny games about pigeons.' })),
          h('div.field', {}, h('span', {}, 'Tone of voice'), toneRow, say),
          field('House rules', area(draft.identity.rules, LIMITS.rules, 3, (v) => { draft.identity.rules = v; }, { name: 'rules', placeholder: 'Always say who a thing is for. Metric units only.' })),
          field('Always avoid', text(draft.identity.avoid, LIMITS.avoid, (v) => { draft.identity.avoid = v; }, { name: 'avoid', placeholder: 'synergy, exclamation marks' })),
          routes.length ? h('div.stack', {}, ...routes.map(([k, w]) => h('div.field', {}, h('span', {}, `${w.label} go to`), chips(w.roles, draft.identity.routing[k] || w.roles[0], (v) => { draft.identity.routing[k] = v; }, `${w.label} go to`, Object.fromEntries(w.roles.map((r) => [r, titleOf(r)])))))) : h('small.field-hint', {}, 'Hire a Marketer, Analyst or Illustrator and you can choose who gets the words, facts and looks.'),
          h('small.field-hint', {}, 'These shape how your staff write. They can\'t change the building\'s rules, what anyone can buy, or anything on another floor.')),
        h('label.toggle', {}, h('input', { type: 'checkbox', checked: draft.publicChat, onchange: (e) => { draft.publicChat = e.target.checked; } }), h('span', {}, 'Visitors can read my chat with the manager. Private project names are hidden, but anything else said about them isn\'t')),
        h('label.toggle', {}, h('input', { type: 'checkbox', checked: draft.defaultPrivate, onchange: (e) => { draft.defaultPrivate = e.target.checked; } }), h('span', {}, 'New projects start private')),
        h('button.btn.ghost.wide', { type: 'button', onclick: async () => { try { await api('/logout', { method: 'POST' }); await refreshMe(); close(); window.officeGo('/'); } catch (e) { toast(e.message, 'bad'); } } }, 'Sign out of this floor')));
    };

    const tabHours = () => {
      const plate = h('div.hours-plate', { 'aria-live': 'polite' }, h('small', {}, 'On the door'), h('b'), h('span'));
      const paintPlate = () => { const [big, small] = signText(work); plate.children[1].textContent = big; plate.children[2].textContent = small; plate.dataset.mode = work.mode; };
      const when = h('div.stack.hours-when');
      const days = h('div.chips.day-chips', { role: 'group', 'aria-label': 'Days' });
      for (const [n, label] of DAY_ORDER) {
        days.append(h('button.chip', { type: 'button', 'data-day': String(n), 'aria-pressed': String(work.days.includes(n)), onclick: (e) => {
          work.days = work.days.includes(n) ? work.days.filter((x) => x !== n) : [...work.days, n].sort((a, b) => a - b);
          e.currentTarget.setAttribute('aria-pressed', String(work.days.includes(n))); paintPlate();
        } }, label));
      }
      const time = (key, label) => h('label.field', {}, h('span', {}, label), h('input', { type: 'time', value: work[key], name: `hours-${key}`, step: 900, oninput: (e) => { if (e.target.value) { work[key] = e.target.value; paintPlate(); } } }));
      const list = zones();
      const tz = list.length
        ? h('select', { name: 'hours-tz', onchange: (e) => { work.tz = e.target.value; } }, ...[...new Set([work.tz, ...list])].map((z) => h('option', { value: z, selected: z === work.tz }, z.replace(/_/g, ' '))))
        : h('input', { name: 'hours-tz', value: work.tz, oninput: (e) => { work.tz = e.target.value.trim(); } });
      when.append(h('div.field', {}, h('span', {}, 'Days'), days), h('div.time-row', {}, time('start', 'From'), time('end', 'Until')), field('Time zone', tz, 'Overnight works too: 22:00 until 06:00 belongs to the day it starts.'));
      const paintWhen = () => { when.hidden = work.mode !== 'hours'; };
      const modes = h('div.mode-pick', { role: 'radiogroup', 'aria-label': 'When the team works' });
      const markMode = () => { for (const b of modes.children) b.setAttribute('aria-checked', String(b.dataset.v === work.mode)); };
      for (const [id, label, blurb] of WORK_MODES) modes.append(h('button.mode-card', { type: 'button', role: 'radio', 'data-v': id, 'data-work-mode': id, onclick: () => { work.mode = id; markMode(); paintWhen(); paintPlate(); } }, h('b', {}, label), h('small', {}, blurb)));
      markMode(); paintWhen(); paintPlate();
      pane.append(h('div.stack', {},
        h('p.lede', {}, 'When does the team work? On call is how it has always been. With set hours or nonstop, your manager picks the next most useful job toward the goal whenever the floor is quiet, and posts a line in the chat after each one.'),
        plate, modes, when,
        field('The goal', area(work.goal, 300, 2, (v) => { work.goal = v; }, { name: 'hours-goal', placeholder: 'Get the game to 1,000 plays.' }), 'Something you can tell has been reached. It shows under Work, above the next-up list. Leave it empty and your manager will ask you for one in the chat, or suggest a few to pick from: nothing starts on its own until there is a goal. Once it is reached, they say so, suggest the next one and keep going.'),
        h('small.field-hint', {}, 'The team makes most calls itself. Anything that costs money still waits for your Buy click, and while a question waits for you they get on with something else. Outside set hours everyone goes home, but you can still call your manager.')));
    };

    const tabBoss = () => {
      const holder = h('div');
      pane.append(h('div.stack', {}, field('Your name', text(draft.boss.name, 30, (v) => { draft.boss.name = v; }, { name: 'boss' })), holder));
      const builder = characterBuilder(holder, draft.boss.look, draft.colors.accent, { onChange: (look) => { draft.boss.look = { ...look }; } });
      cleanup = () => builder.dispose();
    };

    const tabStaff = () => {
      const list = h('div.chips.staff-pick', { role: 'radiogroup', 'aria-label': 'Who to edit' });
      const editor = h('div.stack');
      const pick = (a) => {
        currentAgent = a.id;
        for (const b of list.children) b.setAttribute('aria-checked', String(b.dataset.v === String(a.id)));
        cleanup();
        const holder = h('div');
        const leave = h('div.let-go');
        const paintLeave = (asking) => {
          clear(leave);
          if (a.role === 'manager') { leave.append(h('small.field-hint', {}, 'The office manager runs the floor, so they always stay.')); return; }
          if (!asking) { leave.append(h('button.btn.ghost', { type: 'button', 'data-let-go': a.id, onclick: () => paintLeave(true) }, `Let ${a.name} go`)); return; }
          leave.append(h('span', {}, `Let ${a.name} go? Their desk goes with them.`), h('div.row', {},
            h('button.btn.danger', { type: 'button', 'data-let-go-yes': a.id, onclick: async () => {
              try { await api(`/floors/${page.slug}/staff/${a.id}/let-go`, { method: 'POST', body: {} }); toast(`${a.name} has left`); currentAgent = null; await page.reloadSettled(); syncStaff(); render('staff'); } catch (x) { toast(x.message, 'bad'); paintLeave(false); }
            } }, 'Yes, let them go'),
            h('button.btn.ghost', { type: 'button', onclick: () => paintLeave(false) }, 'Keep them')));
        };
        paintLeave(false);
        clear(editor).append(
          field('Name', text(a.name, LIMITS.name, (v) => { a.name = v; const chip = [...list.children].find((x) => x.dataset.v === String(a.id)); if (chip) chip.textContent = v.trim() || '...'; }, { 'aria-label': 'Name', name: 'staff-name' })),
          field('Job title', text(a.title, LIMITS.title, (v) => { a.title = v; }, { name: 'staff-title', placeholder: page.state.hiring?.roles.find((r) => r.role === a.role)?.title || 'Office Manager' }), `Real job: ${a.role === 'manager' ? 'office manager' : a.role}. The title is what they go by and how they sign their work.`),
          h('div.field', {}, h('span', {}, 'Personality'), chips(['', ...Object.keys(PERSONALITIES)], a.persona.vibe, (v) => { a.persona.vibe = v; }, 'Personality', { '': 'None', ...Object.fromEntries(Object.entries(PERSONALITIES).map(([k, p]) => [k, p.label])) })),
          field('More about them', area(a.persona.notes, LIMITS.notes, 2, (v) => { a.persona.notes = v; }, { name: 'staff-notes', placeholder: 'Obsessed with trains. Thinks everything could be shorter.' }), 'Private: visitors see the label above, never this.'),
          field('Their focus', text(a.persona.focus, LIMITS.focus, (v) => { a.persona.focus = v; }, { name: 'staff-focus', placeholder: 'Headlines first. Pixel art only.' }), 'The manager reads this when deciding who does what.'),
          holder, leave);
        const b = characterBuilder(holder, a.look, draft.colors.accent, { onChange: (look) => { a.look = { ...look }; } });
        cleanup = () => b.dispose();
      };
      for (const a of draft.staff) list.append(h('button.chip', { type: 'button', 'data-v': String(a.id), role: 'radio', onclick: () => pick(a) }, a.name));
      const hiring = page.state.hiring;
      const staffN = draft.staff.filter((a) => a.role !== 'manager').length;
      const free = hiring ? hiring.roles.filter((r) => !draft.staff.some((a) => a.role === r.role)) : [];
      const hire = hiring ? h('section.hire-box', { 'data-hire': '' },
        h('h3', {}, 'Hire', h('small', {}, hiring.cap === null ? `${staffN} desks taken` : `${staffN} of ${hiring.cap} desks taken`)),
        hiring.cap !== null && staffN >= hiring.cap ? h('small.field-hint', {}, 'Every desk is taken. Let someone go to hire someone new.') : free.length ? h('div.chips', {}, ...free.map((r) => h('button.chip', { type: 'button', 'data-hire-role': r.role, onclick: async (e) => {
          e.target.disabled = true;
          try { await api(`/floors/${page.slug}/hire`, { method: 'POST', body: { role: r.role } }); toast(`A new ${r.title} is on the way up`); await page.reloadSettled(); syncStaff(); currentAgent = page.state.agents.find((x) => x.role === r.role)?.id; render('staff'); } catch (x) { toast(x.message, 'bad'); e.target.disabled = false; }
        } }, r.title))) : h('small.field-hint', {}, 'You have one of everyone.')) : null;
      pane.append(list, editor, hire);
      pick(draft.staff.find((a) => a.id === currentAgent) || draft.staff[0]);
    };
    // After a hire or a departure: the people change, but edits already made to everyone else stay in the draft.
    const syncStaff = () => {
      const had = new Map(draft.staff.map((a) => [a.id, a]));
      draft.staff = page.state.agents.map((a) => had.get(a.id) || staffDraft(a));
    };

    const tabOffice = () => {
      const d = draft.decor;
      const change = (k) => (v) => { d[k] = v; showRoom(); };
      const toggle = (k, label) => h('label.toggle', {}, h('input', { type: 'checkbox', checked: d[k], onchange: (e) => { d[k] = e.target.checked; showRoom(); } }), h('span', {}, label));
      const plans = h('div.plans', { role: 'radiogroup', 'aria-label': 'Floor plan' });
      const markPlan = () => { for (const b of plans.children) b.setAttribute('aria-checked', String(b.dataset.v === d.layout)); };
      for (const id of LAYOUTS) plans.append(h('button.plan', { type: 'button', role: 'radio', 'data-v': id, onclick: () => { d.layout = id; markPlan(); showRoom(true); } }, planThumb(id, draft.colors.primary), h('b', {}, PLANS[id].label), h('small', {}, PLANS[id].blurb)));
      markPlan();
      const wallColour = h('input.color-wheel', { type: 'color', value: d.wall, 'aria-label': 'Wall colour', oninput: (e) => { d.wall = e.target.value; showRoom(); } });
      const plants = h('input', { type: 'range', min: 0, max: 8, value: d.plants, 'aria-label': 'Plants', oninput: (e) => { d.plants = Number(e.target.value); showRoom(); } });
      pane.append(h('div.stack', {},
        h('div.field', {}, h('span', {}, 'Floor plan'), plans),
        h('div.field', {}, h('span', {}, 'Floor'), chips(FLOOR_STYLES, d.floor, change('floor'), 'Floor')),
        h('div.field', {}, h('span', {}, 'Walls'), h('div.color-row', {}, chips(WALL_MATS, d.wallMat, change('wallMat'), 'Walls'), wallColour)),
        h('div.field', {}, h('span', {}, 'Wall art'), chips(ART_STYLES, d.artStyle, change('artStyle'), 'Wall art')),
        h('small.field-hint', {}, s.floor.logoUrl ? '"Our logo" hangs the logo from your published work.' : '"Our logo" draws one from your name, until your staff publish a picture with "logo" in its file name.'),
        h('div.field', {}, h('span', {}, 'Office pet'), chips(PETS, d.pet, change('pet'), 'Pet')),
        h('label.field', {}, h('span', {}, 'Plants'), plants),
        h('div.toggle-grid', {}, toggle('rug', 'Rugs'), toggle('art', 'Art'), toggle('coffee', 'Coffee bar'), toggle('arcade', 'Arcade cabinet'), toggle('neon', 'Neon sign'))));
    };

    const render = (id) => {
      cleanup(); cleanup = () => {};
      clear(tabs);
      for (const [k, label] of TABS) tabs.append(h(`button.tab${k === id ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(k === id), 'data-custom': k, onclick: () => render(k) }, label));
      clear(pane);
      pane.scrollTop = 0;
      card.classList.toggle('short', SHORT.has(id));
      ({ vibe: tabVibe, company: tabCompany, hours: tabHours, boss: tabBoss, staff: tabStaff, decor: tabOffice })[id]();
    };

    body.append(h('form.custom-form', { onsubmit: save }, tabs, pane,
      h('div.custom-foot', {}, h('button.btn.ghost', { type: 'button', 'data-custom-cancel': '', onclick: () => close() }, 'Cancel'), h('button.btn.primary.grow', { type: 'submit' }, 'Save'))));
    render(tab);
  }, { wide: true, onClose: () => {
    clearTimeout(timer);
    cleanup();
    // On Save the room already shows what was saved, and the reload that follows brings the state into line with it.
    if (saved) page.clearPreview({ rebuild: false }); else {
      const unsaved = before !== withoutStaff() || changedStaff().length;
      page.clearPreview();
      if (unsaved) toast('Not saved');
    }
  } });
  m.el.classList.add('customise'); m.el.parentElement.classList.add('customise-back');
  return m;
}
