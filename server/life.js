// A bit of building life: hidden floors, launch parties, the leaderboard. Public information only, like the ticker.
// A hidden floor is set from the admin CLI. Only its own boss is told, and it drops out of everything here.

export function installLife(ext) {
  const { hooks } = ext;
  // Whether a floor is hidden is between the building manager and that floor's boss.
  hooks.snapshot.push((f, viewer, out) => { if (viewer.owner && f.hidden) out.floor.hidden = true; });
  hooks.adminFloor.push((f, row) => { if (f.hidden) row.hidden = true; });
  return null;
}
