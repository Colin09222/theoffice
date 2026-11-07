// Making a floor your own: the company's identity, staff names, titles and personalities, hiring and letting go, and the logo on the wall.
// Everything typed here is cut to length and cleaned before it is stored, and it can only ever reach its own floor. Nothing here touches
// budgets, tools, rules or purchases, and the one route takes a fixed list of fields.
import { get, all, run, tx } from './db.js';
import { TONES, PERSONALITIES, WORK_KINDS } from '../public/js/looks.js';
import { BRIEF_LIMITS, settingText } from './brief.js';
import { capOrNull } from './config.js';
import { TONES as TONE_NAMES, VIBES } from '../public/js/looks.js';
import { readCharacter, readMemory, CHARACTER_LIMITS } from './people.js';
import { writeFile, publishSnapshot, WorkspaceError } from './workspace.js';
import { redactor } from './engine.js';

const IMAGE = /\.(png|jpe?g|webp|svg)$/i;
const LOGOISH = /(^|[\/_.-])(logo|logomark|brandmark|wordmark)([\/_.-]|$)/i;
// What a visitor may learn about a person: the fixed label of their personality. What the boss typed about them stays with the boss.
const parse = (raw, fallback) => { if (!raw) return fallback; try { return JSON.parse(raw) ?? fallback; } catch { return fallback; } };

export function validIdentity(input, base = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const out = { ...base };
  for (const [k, max] of [['about', BRIEF_LIMITS.about], ['rules', BRIEF_LIMITS.rules], ['avoid', BRIEF_LIMITS.avoid]]) if (typeof i[k] === 'string') out[k] = settingText(i[k], max);
  if (i.tone === '' || (typeof i.tone === 'string' && Object.hasOwn(TONES, i.tone))) out.tone = i.tone;
  if (i.routing && typeof i.routing === 'object') {
    out.routing = {};
    for (const [kind, spec] of Object.entries(WORK_KINDS)) if (spec.roles.includes(i.routing[kind])) out.routing[kind] = i.routing[kind];
  }
  return out;
}
export function validPersona(input, base = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const out = { ...base };
  if (i.vibe === '' || (typeof i.vibe === 'string' && Object.hasOwn(PERSONALITIES, i.vibe))) out.vibe = i.vibe;
  if (typeof i.notes === 'string') out.notes = settingText(i.notes, BRIEF_LIMITS.personality);
  if (typeof i.focus === 'string') out.focus = settingText(i.focus, BRIEF_LIMITS.focus);
  return out;
}

export function installCustomise(ext) {
  const { db, cfg, engine, hooks, POST, json, readJson, limit, requireOwner, HttpError, publicUrl, models, validLook, saveSettings } = ext;
  // Columns live with the feature, so the rest of the schema doesn't need to know about them. Both default to empty, so a saved floor reads as untouched.
  for (const [table, col] of [['floors', 'identity'], ['floors', 'crew'], ['agents', 'persona']]) {
    const have = new Set(all(db, `PRAGMA table_info(${table})`).map((c) => c.name));
    if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  }
  const roleKeys = () => new Set(Object.keys(models.all).map((k) => k.toLowerCase()));
  const roleTitles = () => new Set(Object.values(models.all).map((r) => String(r.title || '').toLowerCase()));

  /** The manager reads this for who is who. It is rewritten whenever a name, title or personality changes, so it can't go stale. */
  const refreshCrew = (floorId) => {
    const rows = all(db, 'SELECT id,role,name,title,persona FROM agents WHERE floor_id=? ORDER BY id', floorId);
    const crew = rows.map((a) => {
      const p = parse(a.persona, {});
      const custom = a.title !== (models.all[a.role]?.title || a.title);
      return { role: a.role, name: a.name, title: custom ? a.title : '', vibe: p.vibe || '', focus: p.focus || '' };
    }).filter((c) => c.title || c.vibe || c.focus);
    run(db, 'UPDATE floors SET crew=? WHERE id=?', crew.length ? JSON.stringify(crew) : '', floorId);
  };

  /** A name that nobody else on the floor has, and that can't be mistaken for a job when the manager assigns work. Throws what the boss needs to hear. */
  const checkName = (floorId, agent, wanted) => {
    const name = settingText(wanted, BRIEF_LIMITS.name);
    if (!name) return agent.name;
    if (roleKeys().has(name.toLowerCase()) || roleTitles().has(name.toLowerCase())) throw new HttpError(400, 'name_is_a_job', `"${name}" is a job here, so the manager would mix them up. Pick another name.`);
    const clash = get(db, 'SELECT 1 x FROM agents WHERE floor_id=? AND id!=? AND LOWER(name)=LOWER(?)', floorId, agent.id, name);
    if (clash) throw new HttpError(400, 'name_taken', `Someone here is already called ${name}.`);
    return name;
  };
  const checkTitle = (agent, wanted) => {
    if (typeof wanted !== 'string') return agent.title;
    const fallback = models.all[agent.role]?.title || agent.title;
    const title = settingText(wanted, BRIEF_LIMITS.title);
    if (!title) return fallback;
    // The manager can assign work by title. Another role's own job name would send it to the wrong desk.
    if (title.toLowerCase() !== fallback.toLowerCase() && (roleKeys().has(title.toLowerCase()) || roleTitles().has(title.toLowerCase()))) throw new HttpError(400, 'title_is_a_job', `"${title}" is someone else's job here. Pick another title.`);
    return title;
  };

  /** One person's changes, inside whichever transaction is open. */
  const saveStaff = (f, a, b) => {
    const name = checkName(f.id, a, b.name);
    const title = checkTitle(a, b.title);
    const persona = validPersona(b.persona, parse(a.persona, {}));
    persona.title = title !== (models.all[a.role]?.title || title) ? title : '';
    run(db, 'UPDATE agents SET name=?, title=?, look=?, persona=? WHERE id=?', name, title, JSON.stringify(validLook(b.look, JSON.parse(a.look))), JSON.stringify(persona), a.id);
  };

  // A logo is a picture the floor has really published in the open. A private project's files never reach this list.
  const findLogo = (f) => {
    const rows = all(db, `SELECT pf.project, pf.path FROM published_files pf JOIN projects p ON p.floor_id=pf.floor_id AND p.slug=pf.project
      WHERE pf.floor_id=? AND p.private=0 AND p.published_at IS NOT NULL ORDER BY p.published_at DESC, pf.path LIMIT 800`, f.id);
    const hit = rows.find((r) => IMAGE.test(r.path) && LOGOISH.test(r.path));
    return hit ? { project: hit.project, path: hit.path } : null;
  };

  hooks.snapshot.push((f, viewer, out) => {
    // The boss always gets it, so the panel can preview it; a visitor only on a floor that hangs it.
    if (viewer.owner || out.floor.decor?.artStyle === 'logo') {
      const logo = findLogo(f);
      if (logo) out.floor.logoUrl = `${publicUrl(f.slug, logo.project)}${logo.path.split('/').map(encodeURIComponent).join('/')}`;
    }
    const rows = new Map(all(db, 'SELECT id,persona,memory FROM agents WHERE floor_id=?', f.id).map((a) => [a.id, a]));
    const hide = viewer.owner ? (s) => s : redactor(db, f.id);
    for (const a of out.agents) {
      const row = rows.get(a.id);
      const p = parse(row?.persona, {});
      for (const k of ['persona', 'bio', 'quirk']) a[k] = hide(a[k]);
      // The personality's fixed label is part of how the floor looks to everyone. Everything the boss typed is the boss's.
      a.vibe = Object.hasOwn(PERSONALITIES, p.vibe || '') ? PERSONALITIES[p.vibe].label : '';
      // The panel's own settings and a person's notebook are the boss's. `persona` itself is who they are, and everyone can read that.
      if (viewer.owner) { a.customise = { vibe: p.vibe || '', notes: p.notes || '', focus: p.focus || '' }; a.memory = readMemory(row).map((n) => n.t); }
    }
    if (!viewer.owner) return;
    out.identity = validIdentity({}, { about: '', tone: '', rules: '', avoid: '', routing: {}, ...parse(f.identity, {}) });
    out.hiring = {
      cap: capOrNull(cfg.maxStaff),
      roles: Object.entries(models.all).filter(([k]) => k !== 'manager').map(([role, r]) => ({ role, title: r.title, hired: out.agents.some((a) => a.role === role) })),
    };
  });

  // The Save button. One request, one transaction: either the whole panel lands or nothing does.
  POST('/api/floors/:slug/customise', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    const b = await readJson(req, 64 * 1024);
    if (b.staff !== undefined && !Array.isArray(b.staff)) throw new HttpError(400, 'bad_staff');
    if ((b.staff || []).length > 16) throw new HttpError(400, 'bad_staff');
    tx(db, () => {
      saveSettings(f, b);
      if (b.identity !== undefined) run(db, 'UPDATE floors SET identity=? WHERE id=?', JSON.stringify(validIdentity(b.identity, parse(f.identity, {}))), f.id);
      for (const s of b.staff || []) {
        const a = get(db, 'SELECT * FROM agents WHERE id=? AND floor_id=?', Number(s?.id), f.id);
        if (!a) throw new HttpError(404, 'not_found');
        saveStaff(f, a, s);
      }
      refreshCrew(f.id);
    });
    engine.emit(f.id, 'reload', {}, { persist: false });
    engine.emitFloor(f.id);
    engine.people.castFloor(f.id);
    json(res, 200, { ok: true });
  });
  // Hire from the panel: the same path, cap and one-of-each rule as the manager's hire_staff tool.
  POST('/api/floors/:slug/hire', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    const b = await readJson(req, 1024);
    const role = typeof b.role === 'string' ? b.role.toLowerCase() : '';
    if (role === 'manager' || !Object.hasOwn(models.all, role)) throw new HttpError(400, 'bad_role', 'That is not a job here.');
    if (get(db, 'SELECT 1 x FROM agents WHERE floor_id=? AND role=?', f.id, role)) throw new HttpError(409, 'already_hired', `You already have a ${models.all[role].title}.`);
    const n = get(db, "SELECT COUNT(*) n FROM agents WHERE floor_id=? AND role!='manager'", f.id).n;
    if (n >= cfg.maxStaff) throw new HttpError(409, 'staff_full', `This floor is at its limit of ${cfg.maxStaff} staff. Let someone go first.`);
    engine.hireStaff(f, role, settingText(b.name, BRIEF_LIMITS.name));
    // The boss's own hire of a founding role stays through a floor reset, like the one they let go.
    if (Object.hasOwn(models.roles, role)) run(db, 'UPDATE agents SET hired=0 WHERE floor_id=? AND role=?', f.id, role);
    refreshCrew(f.id);
    engine.emit(f.id, 'reload', {}, { persist: false });
    json(res, 201, { ok: true });
  });
  // Let someone go. The manager never leaves, and nobody leaves in the middle of a job: an open task would otherwise wait for them forever.
  POST('/api/floors/:slug/staff/:id/let-go', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    await readJson(req, 1024);
    const a = get(db, 'SELECT * FROM agents WHERE id=? AND floor_id=?', Number(p.id), f.id);
    if (!a) throw new HttpError(404, 'not_found');
    if (a.role === 'manager') throw new HttpError(400, 'manager_stays', 'The office manager runs the floor, so they stay.');
    letGo(f, a);
    json(res, 200, { ok: true });
  });
  /** The same for the panel and the chat. */
  function letGo(f, a) {
    const open = get(db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND agent_id=? AND status IN ('todo','doing','blocked','review')", f.id, a.id).n;
    if (open) throw new HttpError(409, 'still_working', `${a.name} still has ${open === 1 ? 'a task' : `${open} tasks`} open. Wait until it's done, or use Stop all first.`);
    tx(db, () => { run(db, 'DELETE FROM agents WHERE id=? AND floor_id=?', a.id, f.id); refreshCrew(f.id); });
    engine.feed(f.id, null, `${a.name} has left the company`, '');
    engine.emit(f.id, 'reload', {}, { persist: false });
  }
  ext.refreshCrew = refreshCrew;

  // ---- the manager's side: the same rules as the panel, reached through tools. Anything refused comes back as what the manager should tell the boss. ----
  const told = (fn) => { try { return fn(); } catch (e) { if (e instanceof HttpError) throw new WorkspaceError(e.message); throw e; } };
  const whoIs = (floorId, who) => {
    const q = String(who).trim().toLowerCase();
    const a = all(db, 'SELECT * FROM agents WHERE floor_id=? ORDER BY id', floorId).find((x) => x.name.toLowerCase() === q || x.role === q || x.title.toLowerCase() === q);
    if (!a) throw new WorkspaceError(`nobody called ${String(who).slice(0, 40)} works here`);
    return a;
  };
  engine.company = {
    setCompany(floor, i) {
      const f = get(db, 'SELECT * FROM floors WHERE id=?', floor.id);
      const vibe = typeof i.vibe === 'string' && Object.hasOwn(VIBES, i.vibe) ? VIBES[i.vibe] : null;
      if (typeof i.name === 'string' && i.name.trim() && i.name.trim().length < 2) throw new WorkspaceError('a name needs at least 2 characters');
      const colors = { ...(vibe?.colors || {}), ...(typeof i.primary_color === 'string' ? { primary: i.primary_color } : {}), ...(typeof i.accent_color === 'string' ? { accent: i.accent_color } : {}) };
      const decor = { ...(vibe?.decor || {}), ...(typeof i.layout === 'string' ? { layout: i.layout } : {}) };
      const tone = typeof i.tone === 'string' && Object.hasOwn(TONE_NAMES, i.tone) ? i.tone : vibe?.tone;
      const about = typeof i.what_it_does === 'string' ? i.what_it_does : undefined;
      const bossName = typeof i.boss_name === 'string' ? settingText(i.boss_name, 30) : '';
      if (!i.name && !bossName && typeof i.tagline !== 'string' && !Object.keys(colors).length && !Object.keys(decor).length && !tone && about === undefined) throw new WorkspaceError('say what to change');
      tx(db, () => {
        saveSettings(f, { name: i.name, ...(bossName ? { boss: { name: bossName } } : {}), ...(typeof i.tagline === 'string' ? { tagline: i.tagline } : {}), ...(Object.keys(colors).length ? { colors } : {}), ...(Object.keys(decor).length ? { decor } : {}) });
        if (tone || about !== undefined) run(db, 'UPDATE floors SET identity=? WHERE id=?', JSON.stringify(validIdentity({ ...(tone ? { tone } : {}), ...(about !== undefined ? { about } : {}) }, parse(f.identity, {}))), f.id);
      });
      const now = get(db, 'SELECT name,tagline FROM floors WHERE id=?', f.id);
      if (now.name !== f.name) engine.feed(f.id, null, f.name ? `The company is now called ${now.name}` : `${now.name} opened its doors`, '');
      engine.emitFloor(f.id);
      engine.emit(f.id, 'reload', {}, { persist: false });
      engine.people.castFloor(f.id);
      return now.name ? `Done. The company is ${now.name}${now.tagline ? `: "${now.tagline}"` : ''}. The floor changed as you said it.` : 'Saved, but the company still has no name. Name it with set_company as soon as you can.';
    },
    updateStaff(floor, who, i) {
      const a = whoIs(floor.id, who);
      return told(() => {
        const look = i.look && typeof i.look === 'object' ? i.look : undefined;
        tx(db, () => {
          saveStaff(floor, a, { name: i.name, title: typeof i.title === 'string' ? i.title : undefined, look });
          const c = readCharacter(a);
          const text = (k) => (typeof i[k] === 'string' && settingText(i[k], CHARACTER_LIMITS[k])) || c[k];
          // Written by the boss's say-so, so casting leaves it alone from here on.
          if (['persona', 'bio', 'quirk'].some((k) => typeof i[k] === 'string')) run(db, 'UPDATE agents SET character=? WHERE id=?', JSON.stringify({ ...c, persona: text('persona'), bio: text('bio'), quirk: text('quirk'), cast: true }), a.id);
          refreshCrew(floor.id);
        });
        const now = get(db, 'SELECT name,title FROM agents WHERE id=?', a.id);
        engine.emit(floor.id, 'reload', {}, { persist: false });
        return `Done: ${now.name}, ${now.title}.`;
      });
    },
    letGo(floor, who) {
      const a = whoIs(floor.id, who);
      if (a.role === 'manager') throw new WorkspaceError('you run the floor, so you stay');
      told(() => letGo(floor, a));
      return `${a.name} has gone.`;
    },
    /** The logo goes up from a small public page of its own, which is the one place a floor's pictures reach visitors from. On a floor that keeps everything private, it stays with the boss. */
    hangLogo(floor) {
      const f = get(db, 'SELECT * FROM floors WHERE id=?', floor.id);
      const file = all(db, "SELECT path FROM files WHERE floor_id=? AND path LIKE 'projects/brand/images/logo.%'", f.id).at(-1);
      if (!file) return;
      writeFile(db, f.id, 'projects/brand/index.md', `# ${f.name || 'Our'} logo\n\n![The company logo](${file.path.slice('projects/brand/'.length)})\n`, null, cfg.quotaBytes);
      engine.upsertProject(f, 'brand', { title: 'Logo', description: 'The company logo.', kind: 'doc', sources: [], published: true });
      publishSnapshot(db, f.id, 'brand', cfg.quotaBytes, '');
      run(db, 'UPDATE floors SET decor=? WHERE id=?', JSON.stringify({ ...JSON.parse(f.decor), art: true, artStyle: 'logo' }), f.id);
      engine.emitProject(f.id, 'brand');
      engine.emitFloor(f.id);
      engine.emit(f.id, 'reload', {}, { persist: false });
    },
  };
  return {};
}
