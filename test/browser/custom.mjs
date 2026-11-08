// Customising, in a real browser at desktop and phone sizes: the panel is easy to use on a phone, the room changes as you tap, Cancel
// puts it back, Save sticks, visitors see the result but not the private settings, and in every floor plan people really walk, sit
// the right way round and meet. Also reports draw calls per plan at both ends of the quality tiers. `CUSTOM_SHOTS=dir` saves pictures.
import { launch, sleep } from './cdp.mjs';
import { boot, claim, Client } from '../helpers.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { VIBES } from '../../public/js/looks.js';
import { PLANS } from '../../public/js/layouts.js';

const OUT = process.env.CUSTOM_SHOTS || ''; if (OUT) mkdirSync(OUT, { recursive: true });
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; console.log(results.at(-1)); };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, e.message); } };
const ONLY = process.env.CUSTOM_ONLY || '';
const t = await boot({ mockDelayMs: 150, rateScale: 50 });
const base = `http://localhost:${t.port}/theoffice`;
const enter = async (p, c, q) => {
  await p.goto(base);
  await p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  await p.goto(`${base}/floor/${c.slug}?q=${q}`);
  await p.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor');
};
const openPanel = async (p) => { await p.click('.controls .btn:nth-of-type(4)'); await p.until('document.querySelector(".modal.customise") !== null', 'panel'); await sleep(350); };
const roomIs = (p, layout, what = `room shows ${layout}`) => p.until(`window.__office.view.decor.layout === ${JSON.stringify(layout)} || (${JSON.stringify(layout)} === 'open' && !window.__office.view.decor.layout)`, what, 15000);
const panelClosed = (p) => p.until('document.querySelector(".modal") === null', 'panel closed');

for (const [label, opts, q] of [['desktop', { width: 1440, height: 900 }, 'low'], ['phone', { mobile: true }, 'low']]) {
  if (ONLY && ONLY !== label) continue;
  const c = await claim(t, `Panel ${label}`, { body: { colors: { primary: '#7a4bb5', accent: '#f4c95d' } } });
  const b = await launch(); const p = await b.newPage(opts);
  const tag = (s) => `${label}: ${s}`;
  const shot = async (n) => { if (OUT) { await sleep(500); await p.shot(join(OUT, `custom-${n}-${label}.jpg`)); } };
  await enter(p, c, q);

  await step(tag('the panel opens on Pick a vibe, fits the screen, and leaves the room in view'), async () => {
    await openPanel(p);
    const info = await p.ev(`(() => {
      const m = document.querySelector('.modal.customise').getBoundingClientRect(), pane = document.querySelector('.custom-pane');
      const inView = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1; };
      const tall = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect().height);
      return { w: innerWidth, h: innerHeight, top: m.top, left: m.left, vibes: document.querySelectorAll('.vibe').length, overflow: pane.scrollWidth - pane.clientWidth, save: inView('.custom-foot button[type=submit]'), cancel: inView('[data-custom-cancel]'),
        foot: tall('.custom-foot .btn'), vibeH: tall('.vibe'), tabs: tall('.custom-tabs .tab'), first: document.querySelector('.custom-tabs .tab.on').dataset.custom, labels: document.querySelectorAll('.char-name').length, back: getComputedStyle(document.querySelector('.customise-back')).backgroundColor };
    })()`);
    if (info.first !== 'vibe' || info.vibes !== Object.keys(VIBES).length) throw new Error(JSON.stringify(info));
    if (info.overflow > 1) throw new Error(`sideways scroll of ${info.overflow}px`);
    if (!info.save || !info.cancel) throw new Error('Save or Cancel is off screen');
    if (Math.min(...info.foot) < 44 || Math.min(...info.vibeH) < 44 || Math.min(...info.tabs) < 38) throw new Error(`small targets ${JSON.stringify(info)}`);
    if (label === 'phone' && info.top < info.h * 0.3) throw new Error(`the sheet covers the room: top ${info.top} of ${info.h}`);
    if (label === 'desktop' && info.left < info.w * 0.4) throw new Error(`the panel covers the room: left ${info.left}`);
    if (!/rgba?\(0, 0, 0, 0\)|transparent/.test(info.back)) throw new Error(`backdrop hides the room: ${info.back}`);
    await shot('vibe');
  });
  await step(tag('tapping a vibe changes the real room at once, and Cancel puts it back'), async () => {
    const original = await p.ev('window.__office.state.floor.decor.layout || "open"');
    await p.click('.vibe[data-v=punk]');
    await roomIs(p, 'garage');
    const st = await p.ev(`({ layout: window.__office.state.floor.decor.layout, wall: window.__office.view.decor.wallMat, pet: !!window.__office.view.pet, brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(), say: document.querySelector('.tone-sample')?.textContent, on: document.querySelector('.vibe[aria-checked=true]')?.dataset.v })`);
    if ((st.layout || 'open') !== original) throw new Error('the preview was saved');
    if (st.wall !== 'brick' || !st.pet || st.on !== 'punk' || st.brand !== VIBES.punk.colors.primary) throw new Error(JSON.stringify(st));
    if (!/no meetings/.test(st.say)) throw new Error(`sample line: ${st.say}`);
    await shot('vibe-punk');
    await p.click('[data-custom-cancel]');
    await panelClosed(p);
    await roomIs(p, original, 'the room going back');
    const after = await p.ev(`(async () => { const r = await fetch('/theoffice/api/floors/${c.slug}'); const j = await r.json(); return { saved: j.floor.decor.layout || 'open', tone: j.identity.tone, brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() }; })()`);
    if (after.saved !== original || after.tone !== '' || after.brand !== '#7a4bb5') throw new Error(JSON.stringify(after));
  });
  await step(tag('Save keeps it, and the manager then talks in that tone in the real chat'), async () => {
    await openPanel(p);
    await p.click('.vibe[data-v=silly]');
    await roomIs(p, 'lounge');
    await p.click('.custom-foot button[type=submit]');
    await panelClosed(p);
    await p.until('window.__office.state.floor.decor.layout === "lounge" && window.__office.state.identity.tone === "silly"', 'saved');
    await p.click('[data-tab=chat]');
    await p.type('.chat-input textarea', 'tell me something about ducks');
    await p.click('.send');
    await p.until('[...document.querySelectorAll(".msg.manager")].some((m) => /Honk honk/.test(m.textContent) && /Supreme Boss/.test(m.textContent))', 'a silly reply');
    await shot('silly-chat');
  });
  await step(tag('company settings: typed, limited, saved, and shown back only to the boss'), async () => {
    await openPanel(p);
    await p.click('[data-custom=company]');
    await p.until('document.querySelector(".modal [name=about]") !== null', 'company tab');
    const sizes = await p.ev(`[...document.querySelectorAll('.custom-pane input:not([type]), .custom-pane textarea')].map((e) => parseFloat(getComputedStyle(e).fontSize))`);
    if (sizes.some((s) => s < 16)) throw new Error(`text boxes under 16px make a phone zoom: ${sizes}`);
    await p.type('.modal [name=about]', 'PRIVATEABOUT We sell umbrellas to ducks.');
    await p.type('.modal [name=rules]', 'PRIVATERULE Never mention rain.');
    await p.type('.modal [name=avoid]', 'moisture');
    await p.click('.modal [aria-label="Tone of voice"] [data-v=serious]');
    const say = await p.ev('document.querySelector(".tone-sample").textContent');
    if (!/Understood/.test(say)) throw new Error(say);
    const maxes = await p.ev(`[...document.querySelectorAll('.custom-pane [maxlength]')].map((e) => [e.name, e.maxLength])`);
    if (!maxes.some(([n, m]) => n === 'rules' && m === 600)) throw new Error(JSON.stringify(maxes));
    await shot('company');
    await p.click('.custom-foot button[type=submit]');
    await panelClosed(p);
    await p.until('window.__office.state.identity.tone === "serious" && /Never mention rain/.test(window.__office.state.identity.rules)', 'identity saved');
    const v = new Client(t); const pub = await v.get(`/api/floors/${c.slug}`);
    if (JSON.stringify(pub.data).includes('PRIVATE')) throw new Error('a visitor got the private settings');
  });
  await step(tag('staff: rename, job title, personality; it shows in the strip and over their head'), async () => {
    const w = await p.ev('window.__office.state.agents.find((a) => a.role === "writer").id');
    await p.click(`.staff-chip[data-agent="${w}"]`);
    await p.click(`[data-profile-edit="${w}"]`);
    await p.until('document.querySelector(".modal .staff-pick") !== null', 'staff editor');
    await p.until('document.querySelector(".modal .char-preview") !== null', 'preview');
    await p.type('.modal [name=staff-name]', 'Sir Crumb');
    await p.type('.modal [name=staff-title]', 'Head of Buns');
    await p.click('.modal [aria-label=Personality] [data-v=pirate]');
    await p.type('.modal [name=staff-notes]', 'PRIVATENOTE fears ducks');
    await sleep(400);
    await shot('staff');
    await p.click('.custom-foot button[type=submit]');
    await panelClosed(p);
    await p.until('(() => { const a = window.__office.state.agents.find((x) => x.role === "writer"); return a.name === "Sir Crumb" && a.title === "Head of Buns" && a.vibe === "Pirate"; })()', 'saved');
    await p.until('[...document.querySelectorAll(".char-name")].some((e) => e.textContent === "Sir Crumb")', 'over their head');
    await p.until('[...document.querySelectorAll(".staff-chip")].some((e) => /Sir Crumb/.test(e.textContent) && /Head of Buns/.test(e.textContent))', 'in the strip');
  });
  await step(tag('a clash is refused in plain words and nothing is lost'), async () => {
    const w = await p.ev('window.__office.state.agents.find((a) => a.role === "writer").id');
    await p.click(`.staff-chip[data-agent="${w}"]`);
    await p.click(`[data-profile-edit="${w}"]`);
    await p.until('document.querySelector(".modal [name=staff-name]") !== null', 'staff editor');
    await p.type('.modal [name=staff-name]', 'builder');
    await p.click('.custom-foot button[type=submit]');
    await p.until('[...document.querySelectorAll("#toasts *")].some((e) => /is a job here/.test(e.textContent))', 'the reason');
    if (await p.ev('document.querySelector(".modal.customise") === null')) throw new Error('the panel closed on an error');
    await p.click('[data-custom-cancel]');
    await panelClosed(p);
  });
  await step(tag('hire from the panel, then let them go, with the manager always staying'), async () => {
    const before = await p.ev('window.__office.state.agents.length');
    await openPanel(p);
    await p.click('[data-custom=staff]');
    await p.until('document.querySelector("[data-hire-role=tester]") !== null', 'hire list');
    if (await p.ev('document.querySelector("[data-let-go]") !== null && document.querySelector(".staff-pick [aria-checked=true]").textContent === window.__office.state.agents.find((a) => a.role === "manager").name')) throw new Error('the manager can be let go');
    const box = await p.ev('document.querySelector("[data-hire] h3").textContent');
    // No cap on staff by default, so the box doesn't compare it with one: the browser would otherwise read a null cap as "every desk is taken".
    if (!/4 desks taken/.test(box) || /\bof\b/.test(box)) throw new Error(box);
    await p.click('[data-hire-role=tester]');
    await p.until(`window.__office.state.agents.length === ${before + 1}`, 'hired');
    await p.until('[...document.querySelectorAll(".staff-pick .chip")].length === window.__office.state.agents.length', 'new person listed');
    await p.until(`window.__office.view.actors.size === ${before + 2}`, 'a new person in the room');
    const testerId = await p.ev('window.__office.state.agents.find((a) => a.role === "tester").id');
    await p.until(`document.querySelector("[data-let-go='${testerId}']") !== null`, 'let go button');
    await p.click(`[data-let-go='${testerId}']`);
    await p.click(`[data-let-go-yes='${testerId}']`);
    await p.until(`window.__office.state.agents.length === ${before}`, 'gone');
    await p.until(`window.__office.view.actors.size === ${before + 1}`, 'gone from the room');
    await p.until(`document.querySelector("[data-hire-role=tester]") !== null`, 'can be hired again');
    await p.click('[data-custom-cancel]');
    await panelClosed(p);
  });
  await step(tag('the boss: quick looks and Surprise me change the preview, and it is saved on the real character'), async () => {
    await openPanel(p);
    await p.click('[data-custom=boss]');
    await p.until('document.querySelector("[data-preset=wizard]") !== null', 'builder');
    const box = await p.ev(`(() => { const r = document.querySelector('.char-preview').getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, bottom: r.bottom, ih: innerHeight }; })()`);
    if (box.w < 150 || box.h < 150 || box.top < 0 || box.bottom > box.ih) throw new Error(`preview: ${JSON.stringify(box)}`);
    await sleep(800);
    await p.click('[data-surprise]');
    await sleep(250);
    await p.click('[data-preset=wizard]');
    await p.until('document.querySelector(".modal [aria-label=Hat] [aria-checked=true]").dataset.v === "wizard"', 'the hat chip follows');
    await sleep(700);
    await shot('builder');
    await p.click('.custom-foot button[type=submit]');
    await panelClosed(p);
    await p.until('window.__office.state.floor.boss.look.hat === "wizard" && window.__office.state.floor.boss.look.wear === "cape"', 'saved');
    await p.until('window.__office.view.boss.char.look.hat === "wizard"', 'the boss in the room');
    await p.until('window.__office.view.boss.char.isModel === true', 'the real model');
  });
  await step(tag('a visitor sees the room and the titles, with no panel and nothing private'), async () => {
    const b2 = await launch(); const v = await b2.newPage(opts);
    await v.goto(`${base}/floor/${c.slug}?q=low`);
    await v.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'visitor floor');
    const st = await v.ev(`({ layout: window.__office.view.decor.layout, customise: [...document.querySelectorAll('.controls button')].some((b) => /Customise/.test(b.textContent)), titles: [...document.querySelectorAll('.staff-chip')].map((e) => e.textContent).join('|'), body: document.body.textContent, state: JSON.stringify(window.__office.state) })`);
    if (st.layout !== 'lounge' || st.customise) throw new Error(`layout ${st.layout}, panel ${st.customise}`);
    if (!/Head of Buns/.test(st.titles)) throw new Error(st.titles);
    if (/PRIVATE/.test(st.body + st.state)) throw new Error('a private setting reached the visitor');
    await v.ev('document.querySelector(".staff-chip:nth-child(2)").click(); true');
    await sleep(200);
    if (OUT) await v.shot(join(OUT, `custom-visitor-${label}.jpg`));
    v.close(); b2.close();
  });
  await step(tag('hostile text in the company name stays text'), async () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const r = await c.post(`/api/floors/${c.slug}/customise`, { name: evil, tagline: evil, boss: { name: evil }, identity: { about: evil } });
    if (r.status !== 200) throw new Error(`${r.status}`);
    await p.until(`window.__office.state.floor.name.includes('img')`, 'the name');
    await openPanel(p);
    await p.click('[data-custom=company]');
    await sleep(300);
    const st = await p.ev(`({ pwned: window.__pwned, imgs: document.querySelectorAll('img[src="x"]').length, title: document.querySelector('.floor-name').textContent })`);
    if (st.pwned || st.imgs) throw new Error(JSON.stringify(st));
    await p.click('[data-custom-cancel]');
    await panelClosed(p);
    await c.post(`/api/floors/${c.slug}/customise`, { name: `Panel ${label}`, tagline: 'Fine', boss: { name: 'Boss' } });
  });
  await step(tag('no console errors'), async () => {
    const errs = p.errors.filter((e) => !/status of 40[0-9]|status of 429/.test(e));
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ').slice(0, 800));
  });
  p.close(); b.close();
}

// ---- every plan, walked ----
if (!ONLY || ONLY === 'plans') {
  const b = await launch(); const p = await b.newPage({ mobile: true });
  const tag = (s) => `plans: ${s}`;
  const full = await claim(t, 'Full Crew', { body: { colors: { primary: '#2f6f62', accent: '#f4c95d' } } });
  for (const role of ['analyst', 'marketer', 'tester', 'illustrator']) await full.post(`/api/floors/${full.slug}/hire`, { role });
  await enter(p, full, 'low');
  for (const layout of Object.keys(PLANS)) {
    await step(tag(`${layout}: a full crew sits the right way round, walks to the meeting, runs errands and sits back down`), async () => {
      await full.post(`/api/floors/${full.slug}/customise`, { decor: { layout, plants: 8, arcade: true, coffee: true, pet: 'dog', art: true, rug: true } });
      await roomIs(p, layout);
      await p.until('window.__office.view.modelsOn === true && [...window.__office.view.actors.values()].every((a) => a.char.isModel)', 'models in', 45000);
      await sleep(300);
      // People run errands of their own when idle, so with ten of them someone is nearly always up. That is lovely, but not while counting chairs.
      await p.ev('for (const a of window.__office.view.actors.values()) a.idleTimer = 1e9; true');
      await p.until('[...window.__office.view.actors.values()].every((a) => a.seated)', 'everyone sitting at the start', 40000);
      // Seated: each person's legs point at their own desk, which is the proof they aren't sitting backwards.
      const seated = await p.ev(`(async () => {
        const T = await import('/theoffice/vendor/three/three.module.min.js');
        const v = window.__office.view; const bad = [];
        for (const a of v.actors.values()) {
          const c = a.char; c.update(0.2, 0); a.group.updateMatrixWorld(true);
          const hip = new T.Vector3(), foot = new T.Vector3(); c.limbs.legL.upper.getWorldPosition(hip); c.limbs.legL.lower.getWorldPosition(foot);  // the thigh, hip to knee
          const f = a.seat.face; const fx = Math.sin(f), fz = Math.cos(f);
          const legs = (foot.x - hip.x) * fx + (foot.z - hip.z) * fz;
          if (!a.seated || legs <= 0) bad.push(a.info.name + ' seated=' + a.seated + ' legs=' + legs.toFixed(3));
          if (Math.abs(Math.atan2(Math.sin(a.group.rotation.y - f), Math.cos(a.group.rotation.y - f))) > 0.05) bad.push(a.info.name + ' faces ' + a.group.rotation.y + ' not ' + f);
          if (!a.isBoss && !a.isManager && !a.deskPos) bad.push(a.info.name + ' has no desk');
        }
        return bad;
      })()`);
      if (seated.length) throw new Error(seated.join('; '));
      // The meeting: everyone heads for their spot, none of them through furniture, and they get there. The room's clock is stepped by
      // hand here, not left to the renderer, so a slow machine can't make this a test of patience. Listeners go back to their desks when
      // they've heard enough, so what counts is how close each of them got, and that all of them sat down again after.
      const sim = (body) => p.ev(`(() => { const v = window.__office.view; const st = window.__office.state; const staff = st.agents.filter((a) => a.role !== 'manager').map((a) => a.id); const spots = v.plan.meet.spots; const T = window.__sim;
        const seated = () => [...v.actors.values()].every((a) => a.seated && !a.action);
        const run = (done, most = 240) => { let t = 0; for (; t < most && !done(); t += 0.05) { v.update(0.05); staff.forEach((id, i) => { const a = v.actors.get(id); T.near[id] = Math.min(T.near[id], Math.hypot(a.group.position.x - spots[i % spots.length][0], a.group.position.z - spots[i % spots.length][1])); });
          for (const a of v.actors.values()) if (a.path.length) { T.seen++; if (v.nav.isBlocked(a.group.position.x, a.group.position.z) && Math.hypot(a.group.position.x - a.seat.at[0], a.group.position.z - a.seat.at[1]) > 1.3) T.cut++; } } return t; };
        ${body} })()`);
      await p.ev('window.__sim = { near: Object.fromEntries(window.__office.state.agents.filter((a) => a.role !== "manager").map((a) => [a.id, 99])), cut: 0, seen: 0 }; true');
      await sim(`v.meeting(st.agents.find((a) => a.role === 'manager').id, staff); run(() => staff.filter((id) => { const a = v.actors.get(id); return !a.path.length && !a.seated; }).length === staff.length || Object.values(T.near).filter((d) => d < 0.5).length >= 7); return true;`);
      if (OUT) { await sleep(400); await p.shot(join(OUT, `custom-meeting-${layout}-phone.jpg`)); }
      const after = await sim(`const took = run(() => Object.values(T.near).every((d) => d < 0.5) && seated()); return { took, seated: seated(), near: T.near, cut: T.cut, seen: T.seen, stuck: [...v.actors.values()].filter((a) => !a.seated).map((a) => a.info.name + ' ' + a.char.anim + ' path=' + a.path.length) };`);
      if (Object.values(after.near).some((d) => d >= 0.5)) throw new Error(`someone never reached their spot: ${JSON.stringify(after.near)}`);
      if (!after.seated) throw new Error(`still up after ${after.took}s: ${after.stuck.join('; ')}`);
      if (!after.seen) throw new Error('nobody was seen walking');
      // The grid blocks any cell furniture touches, so brushing a corner on the way past can land in one for a sample or two.
      if (after.cut > after.seen * 0.02) throw new Error(`people walked through furniture: ${after.cut} of ${after.seen} samples`);
      // Every kind of errand, the boss's visit and a handoff, on one person each.
      const back = await sim(`const list = [...v.actors.values()].filter((a) => !a.isBoss && !a.isManager);
        list.slice(0, 5).forEach((a, i) => { const realRandom = Math.random; Math.random = () => (i + 0.5) / 5; a.idleErrand(); Math.random = realRandom; });
        v.bossTalks(); v.handoff(list[6].id, v.manager.id); v.cheer();
        const took = run(() => seated()); return { took, seated: seated(), stuck: [...v.actors.values()].filter((a) => !a.seated || a.action).map((a) => a.info.name + ' ' + a.char.anim + ' path=' + a.path.length) };`);
      if (!back.seated) throw new Error(`still up after errands: ${back.stuck.join('; ')}`);
    });
  }
  await step(tag('switching the room again and again leaks nothing and loses nobody'), async () => {
    const counts = () => p.ev('(() => { const m = __stage.renderer.info.memory; return { g: m.geometries, t: m.textures, labels: document.querySelectorAll(".char-tag").length, actors: window.__office.view.actors.size }; })()');
    const ids = Object.keys(PLANS);
    for (const layout of ids) { await p.ev(`window.__office.previewRoom({ ...window.__office.state.floor.decor, layout: ${JSON.stringify(layout)} }, window.__office.state.floor.colors); true`); await sleep(350); }
    await sleep(1200);
    const first = await counts();
    for (let round = 0; round < 3; round++) for (const layout of ids) { await p.ev(`window.__office.previewRoom({ ...window.__office.state.floor.decor, layout: ${JSON.stringify(layout)} }, window.__office.state.floor.colors); true`); await sleep(350); }
    await sleep(1500);
    const last = await counts();
    console.log('  memory after a settling round', JSON.stringify(first), 'after three more', JSON.stringify(last));
    if (last.labels !== last.actors) throw new Error(`labels ${last.labels} actors ${last.actors}`);
    if (last.t > first.t + 8 || last.g > first.g + 40) throw new Error(`growing: ${JSON.stringify(first)} to ${JSON.stringify(last)}`);
    await p.ev('window.__office.clearPreview(); true');
  });
  await step(tag('a floor saved before any of this opens, renders and customises without an error'), async () => {
    const old = await claim(t, 'Saved Long Ago');
    const look = { skin: '#f6d7bd', hair: 'mohawk', hairColor: '#4a2f1d', outfit: 'hoodie', outfitColor: '#27324a', hat: 'crown', glasses: 'round' };
    const f = t.db.prepare('SELECT id FROM floors WHERE slug=?').get(old.slug).id;
    t.db.prepare('UPDATE floors SET decor=?, boss=? WHERE id=?').run(JSON.stringify({ floor: 'carpet', wall: '#ddeeff', plants: 5, rug: false, art: true, coffee: true, arcade: true, neon: true, pet: 'dog' }), JSON.stringify({ name: 'Old Boss', look }), f);
    t.db.prepare('UPDATE agents SET look=? WHERE floor_id=?').run(JSON.stringify(look), f);
    await enter(p, old, 'low');
    await p.until('window.__office.view.modelsOn === true', 'models', 45000);
    const st = await p.ev('({ plan: window.__office.view.plan.label, actors: window.__office.view.actors.size, seated: [...window.__office.view.actors.values()].every((a) => a.seated) })');
    if (st.plan !== 'Corridors' || st.actors !== 6 || !st.seated) throw new Error(JSON.stringify(st));
    await openPanel(p);
    await p.click('[data-custom=decor]');
    await p.until('document.querySelector(".plan[aria-checked=true]")?.dataset.v === "open"', 'plan shown');
    await p.click('[data-custom=staff]');
    await p.until('document.querySelector(".modal .char-preview") !== null', 'builder');
    await p.click('[data-custom-cancel]');
    await panelClosed(p);
  });
  await step(tag('the company logo goes on the wall when it has one, and a monogram when it has none'), async () => {
    const co = await claim(t, 'Logo Wall');
    const f = t.db.prepare('SELECT id FROM floors WHERE slug=?').get(co.slug).id;
    await co.post(`/api/floors/${co.slug}/customise`, { decor: { artStyle: 'logo', layout: 'studio', art: true } });
    await enter(p, co, 'low');
    await sleep(800);
    if (await p.ev('window.__office.view.logoLoaded === true')) throw new Error('a logo appeared from nowhere');
    t.db.prepare('INSERT INTO projects (floor_id,slug,title,private,published_at,created_at) VALUES (?,?,?,0,?,?)').run(f, 'brand', 'Brand', Date.now(), Date.now());
    t.db.prepare('INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?,?,?,?,?)').run(f, 'brand', 'logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="90" fill="#e0559b"/></svg>', 100);
    await enter(p, co, 'low');
    await p.until('window.__office.state.floor.logoUrl === `/theoffice/f/${window.__office.slug}/brand/logo.svg` && window.__office.view.logoLoaded === true', 'the logo on the wall', 20000);
  });
  await step(tag('no console errors'), async () => {
    const errs = p.errors.filter((e) => !/status of 40[0-9]|status of 429/.test(e));
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ').slice(0, 800));
  });
  p.close(); b.close();
}

// ---- draw calls per plan, with a full crew and everything on, at both ends of the tiers ----
if (!ONLY || ONLY === 'budgets') {
  const numbers = [];
  for (const [q, budget, opts] of [['low', 200, { mobile: true }], ['high', 350, { width: 1440, height: 900 }]]) {
    const c = await claim(t, `Budget ${q}`, { body: { colors: { primary: '#2f6f62', accent: '#f4c95d' } } });
    for (const role of ['analyst', 'marketer', 'tester', 'illustrator']) await c.post(`/api/floors/${c.slug}/hire`, { role });
    const staff = (await c.get(`/api/floors/${c.slug}`)).data.agents;
    // Everyone in a hat, glasses and something extra: the most any crew can cost.
    await c.post(`/api/floors/${c.slug}/customise`, { boss: { look: { hat: 'wizard', glasses: 'monocle', wear: 'cape' } }, staff: staff.map((a) => ({ id: a.id, look: { hat: 'cowboy', glasses: 'shades', wear: 'scarf', hair: 'bun' } })) });
    const b = await launch(); const p = await b.newPage(opts);
    await enter(p, c, q);
    for (const layout of Object.keys(PLANS)) {
      await step(`${q}: ${layout} with a full crew stays under ${budget} draw calls`, async () => {
        await c.post(`/api/floors/${c.slug}/customise`, { decor: { layout, plants: 8, arcade: true, coffee: true, pet: 'robot', art: true, rug: true, neon: true, wallMat: layout === 'garage' ? 'brick' : 'panels', artStyle: 'posters', floor: 'terrazzo' } });
        await roomIs(p, layout);
        await p.until('window.__office.view.modelsOn === true && [...window.__office.view.actors.values()].every((a) => a.char.isModel)', 'models in', 60000);
        await sleep(q === 'high' ? 3000 : 1200);
        const s = await p.ev('(() => { const r = []; for (let i = 0; i < 3; i++) r.push(0); return { calls: __stage.renderer.info.render.calls, tris: __stage.renderer.info.render.triangles, tier: __stage.tier }; })()');
        numbers.push({ q, layout, ...s });
        console.log(`  ${q} ${layout}: ${s.calls} calls, ${s.tris} triangles, tier ${s.tier}`);
        if (s.tier !== q) throw new Error(`tier stepped to ${s.tier}`);
        if (s.calls > budget) throw new Error(`${s.calls} calls`);
      });
    }
    p.close(); b.close();
  }
  console.log('  numbers', JSON.stringify(numbers));
}

console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${failures} failed`);
await t.close();
process.exit(failures ? 1 : 0);
