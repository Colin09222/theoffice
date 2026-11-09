// Selling as a first-class kind of job. A shop is a site with a catalogue, shop.json: the page is drawn from it, the launch checklist holds it to
// "every product has a name, a price and a picture", and publishing it puts each product in front of the boss for approval. So a team that ships a shop
// has, by construction, asked the boss to put its products on sale: nobody has to remember propose_product. Only the boss's tap makes one real.
import { get } from './db.js';
import { checkCatalogue } from './launch-check.js';

export { checkCatalogue };
const textOf = (c) => (typeof c === 'string' ? c : Buffer.from(c).toString('utf8'));

/** The published catalogue of a project, or null when it isn't a shop. */
export function publishedCatalogue(db, floorId, slug) {
  const f = get(db, "SELECT content FROM published_files WHERE floor_id=? AND project=? AND path='shop.json'", floorId, slug);
  if (!f) return null;
  const has = (p) => !!get(db, 'SELECT 1 x FROM published_files WHERE floor_id=? AND project=? AND path=?', floorId, slug, p);
  const r = checkCatalogue(textOf(f.content), has);
  return r.problems.length ? null : r.catalogue;
}
/** True when the working copy of a project is a shop (it has a shop.json), published or not. */
export const isShop = (db, floorId, slug) => !!slug && !!get(db, 'SELECT 1 x FROM files WHERE floor_id=? AND path=?', floorId, `projects/${slug}/shop.json`);

export function installShop({ db, engine, log = () => {} }) {
  /** Called whenever a project goes live. Never throws: a publish is never undone by this. */
  engine.shopPublished = (floor, slug) => {
    try {
      const catalogue = publishedCatalogue(db, floor.id, slug);
      if (!catalogue || !engine.pay?.proposeCatalogue) return null;
      const r = engine.pay.proposeCatalogue(floor, slug, catalogue, 'The team');
      if (r.off) return r;
      const names = catalogue.products.filter((p) => r.proposed.includes(p.key)).map((p) => p.name);
      if (names.length) {
        engine.addMessage(floor.id, 'note', null, `${slug} is a shop, and publishing it asked the boss to put ${names.length === 1 ? 'its product' : `${names.length} products`} on sale: ${names.join(', ').slice(0, 400)}. They are waiting under Requests, where one tap approves them all. Nothing can be bought until the boss has connected Stripe on the Payments tab and approved them; until then the shop shows every product and takes order requests by email. Tell the boss exactly that, in plain words, with what to tap. You can't approve, charge or change a price yourself.`);
      }
      if (r.problems.length) engine.addMessage(floor.id, 'note', null, `${slug}: some products in shop.json could not be put in front of the boss: ${r.problems.join('; ').slice(0, 500)}. Have the Builder fix shop.json and publish again.`);
      return r;
    } catch (e) { log('warn', 'shop_publish', { err: String(e?.message || e).slice(0, 200) }); return null; }
  };
}
