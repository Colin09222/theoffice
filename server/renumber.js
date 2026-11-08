// Moving companies between floor numbers. A floor's number is only where it sits in the tower: its id carries its links, published apps,
// domains, mail, data and staff, so none of those notice. Every step here is one transaction and safe to run again.
import { get, all, run, tx } from './db.js';

export class RenumberError extends Error {}

/**
 * The hidden floors numbered from..to, moved up out of the building to at, at+1, ... keeping their order. Floors that aren't hidden are
 * left where they are. Run twice, the second run finds nothing in the range. A clash anywhere means nothing moves at all.
 */
export function parkHiddenFloors(db, cfg, { from, to, at }) {
  if (![from, to, at].every(Number.isInteger) || from < 1 || to < from) throw new RenumberError('Give the range and where to put it, such as --from 1 --to 6 --at 101.');
  if (at <= cfg.towerFloors) throw new RenumberError(`--at must be above the building (over ${cfg.towerFloors}).`);
  return tx(db, () => {
    const moved = [];
    for (const f of all(db, "SELECT id,number FROM floors WHERE hidden=1 AND status!='killed' AND number BETWEEN ? AND ? ORDER BY number", from, to)) {
      const number = at + (f.number - from);
      if (get(db, 'SELECT 1 x FROM floors WHERE number=?', number)) throw new RenumberError(`Floor ${number} is already taken, so nothing was moved.`);
      run(db, 'UPDATE floors SET number=? WHERE id=?', number, f.id);
      moved.push({ from: f.number, to: number });
    }
    return moved;
  });
}

/** One company to an empty number inside the building. A floor already there just says so. */
export function moveFloor(db, cfg, { slug, to }) {
  if (!Number.isInteger(to) || to < 1 || to > cfg.towerFloors) throw new RenumberError(`--to must be 1 to ${cfg.towerFloors}.`);
  return tx(db, () => {
    const f = get(db, "SELECT id,number FROM floors WHERE slug=? AND status!='killed'", slug);
    if (!f) throw new RenumberError('No company has that slug.');
    if (f.number === to) return { from: f.number, to, moved: false };
    if (get(db, 'SELECT 1 x FROM floors WHERE number=?', to)) throw new RenumberError(`Floor ${to} is taken, so nothing was moved.`);
    if (get(db, 'SELECT 1 x FROM codes WHERE claimed_at IS NULL AND floor_number=?', to)) throw new RenumberError(`A code is holding floor ${to}, so nothing was moved.`);
    run(db, 'UPDATE floors SET number=? WHERE id=?', to, f.id);
    return { from: f.number, to, moved: true };
  });
}

/** Make one unused code hold a floor. It is picked out by the moment it was issued and never appears here, so neither it nor its hash is printed. */
export function holdFloorForCode(db, cfg, { issuedAt, floor }) {
  if (!Number.isSafeInteger(issuedAt)) throw new RenumberError('--issued-at must be the moment the code was issued, in milliseconds.');
  if (!Number.isInteger(floor) || floor < 1 || floor > cfg.towerFloors) throw new RenumberError(`--floor must be 1 to ${cfg.towerFloors}.`);
  return tx(db, () => {
    const rows = all(db, 'SELECT hash,floor_number,claimed_at FROM codes WHERE created_at=?', issuedAt);
    if (rows.length !== 1) throw new RenumberError(rows.length ? 'More than one code was issued at that moment. Nothing changed.' : 'No code was issued at that moment.');
    const [c] = rows;
    if (c.claimed_at) throw new RenumberError('That code has already opened an office. Nothing changed.');
    if (c.floor_number === floor) return { floor, changed: false };
    if (get(db, 'SELECT 1 x FROM floors WHERE number=?', floor)) throw new RenumberError(`Floor ${floor} has a company on it. Nothing changed.`);
    if (get(db, 'SELECT 1 x FROM codes WHERE claimed_at IS NULL AND floor_number=? AND hash!=?', floor, c.hash)) throw new RenumberError(`Another code already holds floor ${floor}. Nothing changed.`);
    run(db, 'UPDATE codes SET floor_number=? WHERE hash=? AND claimed_at IS NULL', floor, c.hash);
    return { floor, changed: true };
  });
}
