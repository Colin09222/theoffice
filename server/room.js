// The floor room's round 2 data (docs/redesign/OFFICE-ANSWERS-2.md, lane A): what the room shows besides its people, from rows the server already
// keeps. Every value here is a real record; nothing calls a model. The snapshot carries it as `room`, for the boss and visitors alike, so it must
// never hold money, private work or anything a visitor may not see.

import { all, get } from './db.js';
import { redactor } from './engine.js';
import { weekOf } from './weekplan.js';

const BASE = '/theoffice';
const FRAMES_MAX = 8;

/**
 * r2-j32: the framed launches on the wall. Every public launch of this floor, newest first, at most 8, with how many there are in all for the
 * "+N" tag. A frame carries the real launch photo (server/shots.js) when there is one; otherwise the room paints a plain card with the title.
 * A demo floor's made-up launches never hang (launch walls are for real work), and a hidden floor's photos are not served, so it hangs cards.
 */
export function roomFrames(db, f) {
  if (f.filler) return { list: [], total: 0 };
  const rows = all(db, `SELECT p.slug, p.title, p.published_at, s.taken_at shot_at FROM projects p
    LEFT JOIN launch_shots s ON s.floor_id = p.floor_id AND s.project = p.slug AND s.image IS NOT NULL
    WHERE p.floor_id = ? AND p.published_at IS NOT NULL AND p.private = 0 ORDER BY p.published_at DESC, p.slug`, f.id);
  const list = rows.slice(0, FRAMES_MAX).map((r) => ({
    slug: r.slug, title: r.title || r.slug, at: r.published_at,
    shot: r.shot_at && !f.hidden && f.status === 'active' ? `${BASE}/api/building/shot/${f.slug}/${r.slug}?v=${r.shot_at}` : null,
  }));
  return { list, total: rows.length };
}

/**
 * r2-j41: the whiteboard. The current plan's jobs, up to 5, each ticked when its task is done: this week's started plan (round 1 job 20) when
 * there is one, otherwise the plan of the newest open work (a goal's jobs share their plan name). Nothing is estimated or written by a model; a
 * visitor sees a private project's job as "Private task", and no private name in a public title. Null when there is no plan to show.
 */
export function roomWhiteboard(db, f, viewer, { now = Date.now() } = {}) {
  const hide = viewer?.owner ? (s) => s : redactor(db, f.id);
  const priv = viewer?.owner ? new Set() : new Set(all(db, 'SELECT slug FROM projects WHERE floor_id=? AND private=1', f.id).map((p) => p.slug));
  const row = (t) => ({ id: t.id, title: priv.has(t.project) ? 'Private task' : hide(String(t.title || '')).slice(0, 80), status: t.status, done: t.status === 'done' });
  const week = get(db, "SELECT * FROM weekly_plans WHERE floor_id=? AND week=? AND status='started' ORDER BY id DESC LIMIT 1", f.id, weekOf(now));
  if (week) {
    const ids = JSON.parse(week.task_ids || '[]').slice(0, 5);
    const tasks = ids.map((id) => get(db, 'SELECT id, title, status, project FROM tasks WHERE id=? AND floor_id=?', id, f.id)).filter(Boolean);
    if (tasks.length) {
      const allPriv = tasks.every((t) => priv.has(t.project));
      return { source: 'week', goal: allPriv ? 'This week' : hide(String(week.goal || 'This week')).slice(0, 60), jobs: tasks.map(row) };
    }
  }
  const open = get(db, "SELECT plan FROM tasks WHERE floor_id=? AND plan!='' AND status IN ('todo','doing','blocked','review') ORDER BY id DESC LIMIT 1", f.id)
    || get(db, "SELECT plan FROM tasks WHERE floor_id=? AND plan!='' AND status!='cancelled' ORDER BY id DESC LIMIT 1", f.id);
  if (!open) return null;
  const tasks = all(db, "SELECT id, title, status, project FROM tasks WHERE floor_id=? AND plan=? AND status!='cancelled' ORDER BY id LIMIT 5", f.id, open.plan);
  if (!tasks.length) return null;
  const goal = tasks.every((t) => priv.has(t.project)) ? 'The plan' : hide(String(open.plan).replace(/^This week:\s*/, '')).slice(0, 60);
  return { source: 'plan', goal, jobs: tasks.map(row) };
}

/**
 * r2-j42: the floor's real counts for its milestones: how many public launches it has made and the real visits to them, all time. Visits are the
 * launch cards' own count (app_visits.uniques: unique visitors a day, bots left out). A demo floor's made-up work earns nothing.
 */
export function roomMilestones(db, f) {
  if (f.filler) return { launches: 0, visits: 0 };
  const launches = get(db, 'SELECT COUNT(*) n FROM projects WHERE floor_id=? AND published_at IS NOT NULL AND private=0', f.id).n;
  const visits = get(db, `SELECT COALESCE(SUM(v.uniques), 0) n FROM app_visits v JOIN projects p ON p.floor_id = v.floor_id AND p.slug = v.project
    WHERE v.floor_id=? AND p.published_at IS NOT NULL AND p.private=0`, f.id).n;
  return { launches, visits };
}

/** The room's part of a floor's snapshot. Later jobs add their pieces here. */
export function roomView(db, cfg, f, viewer) {
  return {
    idleLife: cfg.idleLife !== false,
    frames: cfg.roomFrames === false ? null : roomFrames(db, f),
    whiteboard: cfg.roomWhiteboard === false ? null : roomWhiteboard(db, f, viewer),
    milestones: cfg.roomProps === false ? null : roomMilestones(db, f),
    props: cfg.roomProps !== false,
    phoneFit: cfg.phoneBudget !== false,
    camera: cfg.roomCamera !== false,
  };
}

export function installRoom(ext) {
  const { db, cfg, hooks } = ext;
  hooks.snapshot.push((f, viewer, out) => { out.room = roomView(db, cfg, f, viewer); });
  return null;
}
