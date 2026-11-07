// Filler companies: scripted fictional floors that look busy, make no model calls and have no owner. See docs/DEPLOY-PLUS.md.
// Everything on one of these floors is a scene: tasks, feed lines, states and the odd published note are all written here,
// driven by one cheap timer. Nothing on them ever reaches a model, the ledger, the registrar or a chat.
import { randomBytes } from 'node:crypto';
import { get, all, run, tx } from './db.js';
import { hashSecret } from './auth.js';
import { deleteFloorData } from './appdata.js';
import { seededLook, LOOK_FIELDS, DEFAULT_DECOR } from '../public/js/looks.js';

export const DISCLAIMER = 'A fictional demo company inside The Office. Nothing here is real.';
const MAX_DONE_KEPT = 30;
const IDLE_SLOWDOWN = 4;   // nobody watching: advance a quarter as often, so a 2-vCPU box barely notices

// ---- the companies ----
// Every name here is invented. No real brand, person or address appears anywhere, and no published note links out.
const look = (seed, over) => {
  const base = seededLook(seed);
  for (const [k, opts] of Object.entries(LOOK_FIELDS)) if (over?.[k] !== undefined && opts.includes(over[k])) base[k] = over[k];
  return base;
};
export const COMPANIES = [
  {
    key: 'mildly-haunted-candles', name: 'Mildly Haunted Candles', tagline: 'Every wick has a past.',
    banter: ['It only flickered twice.', 'The kiln said nothing. Unusual.', 'Something sighed, but it was probably the pipes.', 'Wax everywhere, ghosts nowhere.'],
    colors: { primary: '#6a4c93', accent: '#f4c95d' },
    boss: { name: 'Ottoline Grimm', look: look(701, { hair: 'long', hairColor: '#e8e2d6', outfit: 'dress', outfitColor: '#111318', glasses: 'round' }) },
    decor: { ...DEFAULT_DECOR, floor: 'carpet', wall: '#d9cfe8', plants: 1, neon: true, pet: 'cat' },
    staff: { manager: ['Percival', { outfit: 'suit', outfitColor: '#6a4c93', hat: 'tophat' }], researcher: ['Dusk', { glasses: 'shades' }], writer: ['Ivy', { hair: 'curly' }], builder: ['Rook', { outfit: 'overalls' }], designer: ['Mabel', { hat: 'beanie' }] },
    tasks: ['Taste-test the lavender-and-regret scent', 'Count how many wicks flickered on their own', 'Write a calmer label for the Bathroom Spectre line', 'Decide whether the warehouse groan is structural', 'Draft the autumn catalogue (no screaming this year)', 'Interview the candle that went out at 3:07 again', 'Measure the cold spot by the kiln', 'Rename "Whispering Tallow" to something you can say aloud', 'Photograph the display shelf while it is holding still', 'Check the complaints box for ectoplasm', 'Design a gift box that stays shut', 'Write the FAQ entry "Why does mine hum?"', 'Reorder soy wax, ask about the haunted discount', 'Test whether the new scent is haunted or just cinnamon', 'Sort the returns into "faulty" and "possessed"', 'Draft a politely worded note to the attic', 'Choose a font that does not look like a ransom note', 'Plan the Midnight Flicker seasonal range'],
    progress: ['is sniffing the test batch very carefully', 'is reading last year\'s incident log', 'found the cold spot again', 'is writing the label copy in a steady hand', 'has the kiln notes open', 'is comparing wick lengths', 'says the humming has stopped, probably', 'is laying out the gift box flat'],
    projects: [
      { slug: 'autumn-catalogue', title: 'Autumn Catalogue (Draft)', description: 'This season\'s scents, with the usual warnings.', body: ['## This season', '- **Lavender & Regret**: soft, floral, a little sorry.', '- **Bathroom Spectre**: eucalyptus and a faint sense of being watched.', '- **Midnight Flicker**: goes out at 3:07. Relights itself. We are looking into it.', '', 'All candles are tested for scent, burn time and unexplained activity before they leave the building.'] },
      { slug: 'wick-report', title: 'The Quarterly Wick Report', description: 'Flickers, groans and one apology.', body: ['## Numbers', '| Thing | Count |', '|---|---|', '| Candles sold | plenty |', '| Candles returned | 4 |', '| Candles returned twice | 1 |', '| Attic notes answered | 0 |', '', 'The groan has been reclassified as "probably the pipes".'] },
      { slug: 'care-guide', title: 'Candle Care Guide', description: 'How to keep a mildly haunted candle happy.', body: ['## Care', '1. Trim the wick to a quarter inch.', '2. Do not burn for longer than four hours, or after midnight.', '3. If the flame turns to face you, say good evening. It is only polite.', '', 'Store in a cool, dry, well-lit cupboard.'] },
    ],
    cheers: ['The attic sent a thank-you note. Nobody is sure how.', 'The Bathroom Spectre range is live and only slightly cold to the touch.'],
  },
  {
    key: 'soup-opinions-ltd', name: 'Soup Opinions Ltd', tagline: 'Strong views, served warm.',
    banter: ['I stand by every word about the leek.', 'It needed salt. They all need salt.', 'The minestrone people will write in.', 'I have tasted worse, and I said so.'],
    colors: { primary: '#c9772b', accent: '#2f6f62' },
    boss: { name: 'Bernadette Ladle', look: look(811, { hair: 'bun', outfit: 'shirt', outfitColor: '#c9772b' }) },
    decor: { ...DEFAULT_DECOR, floor: 'terrazzo', wall: '#f3e3c7', plants: 4, coffee: true, neon: false },
    staff: { manager: ['Gus', { outfit: 'shirt', outfitColor: '#2f6f62', glasses: 'round' }], researcher: ['Priya', { hair: 'long' }], writer: ['Hal', { hat: 'cap' }], builder: ['Nadia', { outfit: 'hoodie' }], designer: ['Teo', { hair: 'mohawk' }] },
    tasks: ['Taste-test the soup opinions', 'Rank the Tuesday broths by conviction', 'Write a firm but fair position on croutons', 'Settle the chowder question once and for all', 'Draft the "Is gazpacho a salad" white paper', 'Count how many people said "it needs salt" unprompted', 'Survey the office on bread-on-the-side', 'Decide the official stance on soup in a mug', 'Review the minestrone complaint (it has a point)', 'Write up the leek incident', 'Design the Soup Index for the quarterly', 'Compare spoon widths, scientifically this time', 'Draft a reply to the person who called it "stew"', 'Reheat the pumpkin opinion and see if it holds', 'Collect three dissenting views on noodles', 'Prepare the Great Broth Debate running order', 'Check whether the tomato stance has gone off', 'Write the opinion of the month: lentils'],
    progress: ['is stirring the argument', 'is taking notes with a spoon in the other hand', 'has found a very strong view on barley', 'is reading the crouton position aloud', 'is sketching the Soup Index', 'says the chowder question is bigger than it looks', 'has three bowls on the go', 'is tasting for conviction'],
    projects: [
      { slug: 'soup-manifesto', title: 'The Soup Manifesto', description: 'Where we stand on soup.', body: ['## Our position', '1. Soup is a meal when it says it is.', '2. Croutons are a privilege, not a right.', '3. Gazpacho is welcome here, in summer, with notice.', '', 'We revise these views once a quarter, or when someone brings in a very good bisque.'] },
      { slug: 'crouton-position', title: 'A Firm Position on Croutons', description: 'Twelve points, all crunchy.', body: ['## The crouton question', 'A crouton is bread that has made a decision.', '', '- Too many and the soup is a salad.', '- Too few and the bowl feels unattended.', '- The correct number is seven. We will not be taking questions.'] },
      { slug: 'broth-rankings', title: 'Tuesday Broth Rankings', description: 'By conviction, not by flavour.', body: ['## This week', '| Broth | Conviction |', '|---|---|', '| Chicken | steady |', '| Miso | quietly certain |', '| Beef | loud |', '| Mushroom | still deciding |', '', 'Rankings are opinions. That is the whole business.'] },
    ],
    cheers: ['The crouton position went out and nobody has written in yet.', 'Gus called it "the best broth ranking since the merger". There was no merger.'],
  },
  {
    key: 'slightly-longer-weekends', name: 'The Committee for Slightly Longer Weekends', tagline: 'Working towards Friday-and-a-half.',
    banter: ['Seconded, with minor amendments.', 'The motion carries, slowly.', 'I move we stop for the day.', 'Noted in the minutes, in small print.'],
    colors: { primary: '#2f7ec7', accent: '#a9c4ff' },
    boss: { name: 'Dorothy Lull', look: look(923, { hair: 'side', hairColor: '#6c7a89', outfit: 'suit', outfitColor: '#27324a', glasses: 'round' }) },
    decor: { ...DEFAULT_DECOR, floor: 'wood', wall: '#e4ecf7', plants: 5, rug: true, arcade: true, neon: false },
    staff: { manager: ['Clement', { outfit: 'suit', outfitColor: '#2f7ec7' }], researcher: ['Fern', { hair: 'pigtails' }], writer: ['Bartholomew', { hair: 'none', hat: 'cap' }], builder: ['Kit', { outfit: 'tee' }], designer: ['Rosalind', { hair: 'curly', glasses: 'shades' }] },
    tasks: ['Draft the motion for a 2:30 Friday', 'Count the minutes lost to Monday', 'Write a stirring speech about Sunday evenings', 'Survey the building on "half days: when?"', 'Design the "Nearly the Weekend" banner', 'Calculate the cost of one extra hour of Saturday', 'Minute last week\'s meeting (it overran)', 'Propose renaming Thursday "Friday Eve"', 'Review the petition for a longer lunch', 'Draft the response to "but what about Mondays"', 'Build the countdown-to-Friday widget', 'Choose a cheerful but serious typeface', 'Research whether anyone has tried this before', 'Plan the Long Weekend Awareness Week', 'Write the FAQ: "Does this apply to bank holidays?"', 'Prepare the quarterly report on naps', 'Agree the committee\'s position on Friday afternoon biscuits', 'Draft the gentle letter to Monday'],
    progress: ['is counting the minutes until Friday', 'is reading the petition for a third time', 'has drafted a stern paragraph about Mondays', 'is laying out the banner', 'is working out the cost of Saturday', 'says the motion needs one more "whereas"', 'is testing the countdown widget', 'is looking for a precedent'],
    projects: [
      { slug: 'motion-230-friday', title: 'Motion: The 2:30 Friday', description: 'Whereas, whereas, whereas.', body: ['## The motion', 'Whereas the weekend is good; and', 'whereas Friday afternoon is mostly waiting;', '', 'this Committee resolves that the weekend begin at 2:30 on Fridays, with immediate effect, pending the biscuits.', '', 'Carried, 4 votes to 1. The 1 was busy.'] },
      { slug: 'state-of-the-weekend', title: 'State of the Weekend', description: 'The annual report, slightly late.', body: ['## Findings', '- Saturdays remain popular.', '- Sunday evenings have been described as "a bit much".', '- Monday has not responded to our letter.', '', '## Recommendations', 'Add half a day. Review in a year. Have a sit down.'] },
      { slug: 'friday-eve', title: 'The Case for Friday Eve', description: 'Thursday, but with hope.', body: ['## Friday Eve', 'Renaming Thursday costs nothing and lifts morale by an amount we have chosen not to measure.', '', 'Objections so far: one person who likes Thursday as it is. Noted.'] },
    ],
    cheers: ['The motion passed. Clement rang the little bell.', 'Someone brought biscuits to mark the report. Minutes were taken.'],
  },
  {
    key: 'pigeon-logistics', name: 'Pigeon Logistics', tagline: 'Same-day delivery, weather permitting.',
    banter: ['Delivered, more or less.', 'The pigeon came back with a different parcel.', 'Weather permitting, it is there.', 'We lost a feather, not the shipment.'],
    colors: { primary: '#3b3f46', accent: '#37b679' },
    boss: { name: 'Marjorie Coo', look: look(1037, { hair: 'short', hairColor: '#1f1a17', outfit: 'labcoat', hat: 'headphones' }) },
    decor: { ...DEFAULT_DECOR, floor: 'concrete', wall: '#dfe6e1', plants: 2, art: false, coffee: true, neon: true, pet: 'dog' },
    staff: { manager: ['Stanley', { outfit: 'overalls', outfitColor: '#3b3f46', hat: 'hardhat' }], researcher: ['Dot', { glasses: 'round' }], writer: ['Winnie', { hair: 'bun' }], builder: ['Boris', { outfit: 'hoodie', outfitColor: '#37b679' }], designer: ['Lotte', { hair: 'side' }] },
    tasks: ['Reroute the 9:15 around the hawk', 'Count the crumbs in petty cash', 'Write the "no, we don\'t do parcels over 40g" policy', 'Plan the rooftop depot expansion (two more ledges)', 'Update the weather policy for "drizzle but keen"', 'Design the new leg-band tracking labels', 'Review the complaint about a late postcard (1987)', 'Draft the recruitment notice for the spring intake', 'Test the coop door sensor again', 'Map the shortcut over the bakery', 'Write up the seagull incident, calmly', 'Estimate the fleet\'s total wingspan for the brochure', 'Order more millet, the good kind', 'Build the delivery-status board for the lobby', 'Decide whether Gerald is retiring or just sulking', 'Draft the apology for the statue', 'Audit the nesting materials budget', 'Plan the Sunday no-fly schedule'],
    progress: ['is watching the sky, professionally', 'is counting the morning fleet back in', 'has the hawk map out again', 'is weighing a parcel that is clearly over 40g', 'is sketching the leg-band labels', 'says Gerald is definitely sulking', 'is testing the coop door for the fourth time', 'is drafting a firm paragraph about seagulls'],
    projects: [
      { slug: 'flight-plan', title: 'This Week\'s Flight Plan', description: 'Routes, ledges, and one hawk.', body: ['## Routes', '- **North loop**: over the bakery, not through it.', '- **River run**: suspended until the hawk moves on.', '- **Short hop**: ledge to ledge, for postcards only.', '', 'All flights are weather permitting. "Weather" includes mood.'] },
      { slug: 'parcel-policy', title: 'Parcel Policy', description: 'Forty grams is forty grams.', body: ['## Limits', '| Item | Carried? |', '|---|---|', '| Postcard | yes |', '| Letter | yes |', '| Key | yes, one |', '| Sandwich | no, and please stop asking |', '', 'The limit is 40g. It is not a negotiation; it is a wing.'] },
      { slug: 'fleet-report', title: 'Fleet Report', description: 'Who flew, who sulked.', body: ['## The fleet', 'Twelve birds on the books. Eleven flying. Gerald is "considering his options" on the ledge.', '', 'Average delivery time: before lunch. Average complaint: crumbs.'] },
    ],
    cheers: ['The 9:15 made it round the hawk. Stanley has stopped pacing.', 'Gerald flew today. The whole floor stood up.'],
  },
];
const byKey = (key) => COMPANIES.find((c) => c.key === key);
// The rest of what people say on these floors: scripted, as fictional as the companies, and never from a model.
const SCRIPTS = {
  'mildly-haunted-candles': {
    asks: [['Did the lavender batch hum at you too?', 'Only when I turned my back. I logged it under "ambient".'], ['Which wick length stops the 3:07 thing?', 'None so far. A quarter inch at least makes it apologise.'], ['Is the attic still not answering?', 'It answered once. We agreed not to discuss it.']],
    meetings: [['Right. The list. Nobody goes up to the attic alone.', 'I went alone last time. It was fine. It knew my name, but it was fine.', 'Noted, and I wish it weren\'t.'], ['Whoever has the cold spot, take a jumper.', 'That\'s me, and I am already wearing two.', 'Then the kiln notes can wait until you can feel your hands.']],
    pairs: [['Did you move the candle on the shelf?', 'No. I thought you had.'], ['That cinnamon batch is just cinnamon, right?', 'Mostly. I wouldn\'t leave it alone with the pipes.']],
  },
  'soup-opinions-ltd': {
    asks: [['Where do we stand on barley this quarter?', 'Firmly in favour, in small amounts, under protest.'], ['Is the crouton count still seven?', 'Seven. Any more and we would be a salad company.'], ['Did the minestrone people write back?', 'Twice, in capitals. They have a point about the beans.']],
    meetings: [['We need a position by lunch, and I mean a position, not a mood.', 'Lunch is the problem. I can\'t judge while hungry.', 'You can\'t judge while full either. We\'ve seen the rankings.'], ['Who took the chowder question?', 'I did, and it\'s bigger than it looks.', 'That is what you said about the leek.']],
    pairs: [['It needed salt.', 'It was a glass of water, Hal.'], ['I dreamt about bisque again.', 'Was it a good bisque?']],
  },
  'slightly-longer-weekends': {
    asks: [['Does Friday Eve need a second vote?', 'Only if someone turns up to oppose it, and it\'s nearly two.'], ['What do we have on half days before 1900?', 'One petition, mostly about biscuits.'], ['Should the banner say "nearly"?', '"Nearly" tested well. "Almost" made people sad.']],
    meetings: [['I call this meeting to order, briefly.', 'Seconded. Can it be briefer?', 'Motion to minute that it could not.'], ['Item one: Monday still hasn\'t replied.', 'I move we stop writing to it.', 'Carried, pending biscuits.']],
    pairs: [['Is it Friday yet?', 'It\'s Tuesday, but I admire the question.'], ['I\'ve drafted a whereas about the kettle.', 'Whereas what?']],
  },
  'pigeon-logistics': {
    asks: [['Is the river run open again?', 'Not while the hawk\'s there. Go over the bakery, not through it.'], ['What does a key weigh, for the 40g rule?', 'Depends on the key. Weigh it. Do not ask Gerald.'], ['Has Gerald said anything?', 'He looked at me and then at the sky. I took it as a no.']],
    meetings: [['Morning. Twelve birds, eleven flying, one considering.', 'Is that Gerald again?', 'It is always Gerald.'], ['Who\'s got the 9:15?', 'Me, weather permitting.', 'The weather says no. The bird says maybe.']],
    pairs: [['Someone left crumbs in petty cash.', 'That is petty cash.'], ['Drizzle but keen?', 'Keen but damp, I would call it.']],
  },
};

// What a staff member looks like they are doing, by role. State names are the ones the office scene animates.
const ACTIVITIES = {
  researcher: [['browsing', 'Looking something up'], ['reading', 'Reading the notes'], ['typing', 'Writing up findings'], ['thinking', 'Weighing it up']],
  writer: [['typing', 'Writing the first draft'], ['reading', 'Reading it back'], ['thinking', 'Looking for the word'], ['typing', 'Tightening the copy']],
  builder: [['typing', 'Building the page'], ['reading', 'Checking the layout'], ['browsing', 'Checking how it looks'], ['typing', 'Fixing a wobble']],
  designer: [['typing', 'Laying it out'], ['thinking', 'Choosing a colour'], ['reading', 'Reviewing the mockup'], ['typing', 'Drawing the header']],
  manager: [['thinking', 'Planning the next batch'], ['reading', 'Reviewing the work'], ['talking', 'Briefing the team'], ['typing', 'Writing up the plan']],
};
// Filler floors have no real words to quote, so their people read from this script. It's all as fictional as the companies.
const GIVE = ['Could you take this one?', 'This one has your name on it:', 'You drew the short straw:', 'When you have a minute:', 'Next on the list for you:'];
const SIGN_OFF = ['Lovely. Filed.', 'Good. On the pile it goes.', 'Approved, and nobody needs to know how long it took.', 'That will do nicely.', 'Fine work. Back to it.'];
const BANTER = ['Nothing caught fire.', 'It went better than last time.', 'I would not look too closely.', 'Ask me nothing further.'];
const QUIET = ['Kettle on.', 'A short break. Everyone is at their desks, mostly.', 'The office is quiet for a moment.', 'Someone watered the plants.'];

// ---- tables ----
export function ensureTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS filler_floors (floor_id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS filler_removed (key TEXT PRIMARY KEY, removed_at INTEGER NOT NULL, floor_number INTEGER);`);
}

// ---- seeding ----
// A free floor near the top, never floor 1, never one someone holds a code for, never one that exists already.
function pickFloor(db, cfg) {
  const taken = new Set(all(db, 'SELECT number FROM floors').map((f) => f.number));
  const reserved = new Set(all(db, 'SELECT floor_number n FROM codes WHERE claimed_at IS NULL AND floor_number IS NOT NULL').map((c) => c.n));
  for (let n = cfg.towerFloors - 3; n >= 2; n--) if (!taken.has(n) && !reserved.has(n)) return n;
  return null;
}
function freeSlug(db, base) {
  let slug = base;
  for (let i = 0; get(db, 'SELECT 1 x FROM floors WHERE slug=?', slug); i++) slug = i === 0 ? `${base.slice(0, 35)}-demo` : `${base.slice(0, 33)}-demo-${i + 1}`;
  return slug;
}
/**
 * Seed the filler companies. Idempotent: one row per company key, a company that was removed stays removed unless `revive`.
 * Works with a bare database (the CLI) or with the engine (the server). Returns what happened to each company.
 */
export function seedFillers(db, { cfg, models, engine = null, now = Date.now(), revive = false } = {}) {
  ensureTables(db);
  const t = typeof now === 'function' ? now() : now;
  const out = { seeded: [], skipped: [] };
  for (const c of COMPANIES) {
    const have = get(db, 'SELECT ff.floor_id, f.id fid FROM filler_floors ff LEFT JOIN floors f ON f.id=ff.floor_id WHERE ff.key=?', c.key);
    if (have?.fid) { out.skipped.push({ key: c.key, why: 'exists' }); continue; }
    if (have) {
      // The floor went through the ordinary Kill button. That counts as a removal, so it does not come back on its own.
      run(db, 'DELETE FROM filler_floors WHERE key=?', c.key);
      run(db, 'INSERT OR REPLACE INTO filler_removed (key,removed_at) VALUES (?,?)', c.key, t);
    }
    if (!revive && get(db, 'SELECT 1 x FROM filler_removed WHERE key=?', c.key)) { out.skipped.push({ key: c.key, why: 'removed' }); continue; }
    const number = pickFloor(db, cfg);
    if (!number) { out.skipped.push({ key: c.key, why: 'no_floor' }); continue; }
    // Nobody holds the recovery code: it is random bytes hashed and forgotten, so no login can ever succeed here.
    const recoveryHash = hashSecret(randomBytes(32).toString('hex'));
    const id = tx(db, () => {
      const slug = freeSlug(db, c.key);
      const r = run(db, 'INSERT INTO floors (slug,number,name,tagline,colors,boss,decor,recovery_hash,created_at,filler,public_chat,default_private) VALUES (?,?,?,?,?,?,?,?,?,1,0,0)',
        slug, number, c.name, c.tagline, JSON.stringify(c.colors), JSON.stringify(c.boss), JSON.stringify(c.decor), recoveryHash, t);
      const fid = Number(r.lastInsertRowid);
      if (engine) engine.seedStaff(fid);
      else {
        let i = fid * 7;
        for (const [role, rc] of Object.entries(models.roles)) { run(db, 'INSERT INTO agents (floor_id,role,title,name,look,created_at) VALUES (?,?,?,?,?,?)', fid, role, rc.title, role, JSON.stringify(seededLook(i * 13 + 2)), t); i++; }
      }
      for (const a of all(db, 'SELECT id,role,look FROM agents WHERE floor_id=? ORDER BY id', fid)) {
        const s = c.staff[a.role];
        if (s) run(db, 'UPDATE agents SET name=?, look=? WHERE id=?', s[0], JSON.stringify(look(fid * 31 + a.id, s[1])), a.id);
      }
      run(db, 'INSERT INTO filler_floors (floor_id,key,created_at) VALUES (?,?,?)', fid, c.key, t);
      run(db, 'DELETE FROM filler_removed WHERE key=?', c.key);
      run(db, 'INSERT INTO events (floor_id,type,project,data,created_at) VALUES (?,?,?,?,?)', fid, 'feed', '', JSON.stringify({ agent: null, name: 'Office', text: `${c.name} moved in on floor ${number}.`, ts: t }), t);
      return fid;
    });
    out.seeded.push({ key: c.key, id, number });
  }
  return out;
}

// Everything killFloor deletes, for when there is no engine (the CLI against a closed server's database).
function killRows(db, floorId) {
  deleteFloorData(db, floorId);
  tx(db, () => {
    for (const table of ['tasks', 'messages', 'events', 'files', 'projects', 'published_files', 'purchases', 'questions', 'agents', 'sessions', 'ios_requests']) run(db, `DELETE FROM ${table} WHERE floor_id=?`, floorId);
    run(db, 'DELETE FROM floors WHERE id=?', floorId);
  });
}
/** Remove one filler floor by id or number. Records the removal so seeding does not bring it back. Returns the floor removed, or null. */
export function removeFiller(db, { id, number } = {}, { engine = null, now = Date.now } = {}) {
  ensureTables(db);
  const f = id !== undefined ? get(db, 'SELECT * FROM floors WHERE id=? AND filler=1', Number(id)) : get(db, 'SELECT * FROM floors WHERE number=? AND filler=1', Number(number));
  if (!f) return null;
  const key = get(db, 'SELECT key FROM filler_floors WHERE floor_id=?', f.id)?.key || f.slug;
  if (engine) engine.killFloor(f.id); else killRows(db, f.id);
  run(db, 'DELETE FROM filler_floors WHERE floor_id=?', f.id);
  run(db, 'INSERT OR REPLACE INTO filler_removed (key,removed_at,floor_number) VALUES (?,?,?)', key, typeof now === 'function' ? now() : now, f.number);
  return { id: f.id, number: f.number, slug: f.slug, name: f.name, key };
}
/** Every filler floor in the building, and the companies that were removed. */
export function listFillers(db) {
  ensureTables(db);
  const floors = all(db, 'SELECT f.id,f.number,f.slug,f.name,f.status,ff.key FROM floors f LEFT JOIN filler_floors ff ON ff.floor_id=f.id WHERE f.filler=1 ORDER BY f.number DESC');
  const removed = all(db, 'SELECT key,removed_at removedAt,floor_number floorNumber FROM filler_removed ORDER BY key');
  return { floors, removed };
}

// ---- the scene ----
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const shuffled = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function installFiller(ext) {
  const { db, cfg, engine, bus, log, now, hooks, POST, json, readJson, limit, requireAdmin, HttpError } = ext;
  ensureTables(db);
  hooks.floorCard.push((f, card) => { if (f.filler) card.filler = true; });
  hooks.snapshot.push((f, viewer, out) => { if (f.filler) out.floor.filler = true; });
  hooks.adminFloor.push((f, row) => { if (f.filler) row.filler = true; });

  const scenes = new Map();   // floorId -> { key, phase, step, queue, nextAt, projectIdx }
  let timer = null, stopped = false;
  const tickMs = Math.max(5, Number(cfg.fillerTickMs) || 9000);
  const watched = (floorId) => (bus.floors?.get(floorId)?.size || 0) > 0;

  const floorRows = () => all(db, "SELECT f.*, ff.key FROM floors f JOIN filler_floors ff ON ff.floor_id=f.id WHERE f.filler=1 AND f.status='active'");
  const agentsOf = (fid) => all(db, 'SELECT * FROM agents WHERE floor_id=? ORDER BY id', fid);
  const feed = (f, agent, text, project = '') => engine.feed(f.id, agent, text, project);
  const act = (agent, [state, activity], taskId = null, project = '') => engine.setAgent(agent.id, { state, activity, task_id: taskId, project });
  const idle = (agent) => engine.setAgent(agent.id, { state: 'idle', activity: '', project: '', task_id: null });

  function scene(f) {
    let s = scenes.get(f.id);
    if (!s) {
      s = { key: f.key, phase: 'plan', step: 0, queue: shuffled(byKey(f.key).tasks), nextAt: 0, projectIdx: rnd(3), cycles: 0 };
      // Whatever a previous process left open is quietly closed: the scene starts clean.
      run(db, "UPDATE tasks SET status='done', updated_at=? WHERE floor_id=? AND status IN ('todo','doing','review','blocked')", now(), f.id);
      scenes.set(f.id, s);
    }
    return s;
  }
  // One line after another from a list, so nobody says the same thing twice running.
  const nextOf = (s, list, key) => { s[key] = ((s[key] ?? rnd(list.length)) + 1) % list.length; return list[s[key]]; };
  function saySome(f, people, lines, kind) { lines.forEach((text, i) => engine.talk(f.id, people[i % people.length], people[(i + 1) % people.length], text, { kind })); }
  function nextTitle(s, c) { if (!s.queue.length) s.queue = shuffled(c.tasks); return s.queue.pop(); }
  const openTasks = (fid) => all(db, "SELECT * FROM tasks WHERE floor_id=? AND status IN ('todo','doing','review') ORDER BY id", fid);

  // One beat of one floor's story. Each phase ends by naming the next, and the timer decides when that is.
  function advance(f, s) {
    const c = byKey(s.key); if (!c) return;
    const agents = agentsOf(f.id);
    const mgr = agents.find((a) => a.role === 'manager');
    const staff = agents.filter((a) => a.role !== 'manager');
    if (!mgr || !staff.length) return;
    const t = now();
    switch (s.phase) {
      case 'plan': {
        act(mgr, ['thinking', 'Planning the next batch']);
        feed(f, mgr, pick(['is planning the next batch', 'is going through the list', 'has the whiteboard out']));
        s.phase = 'assign'; break;
      }
      case 'assign': {
        act(mgr, ['typing', 'Writing up the plan']);
        const crew = shuffled(staff).slice(0, 2 + rnd(2));
        const batch = `Batch of ${new Date(t).toISOString().slice(11, 16)}`;  // its own name, so the pills count this batch and not last week's
        for (const a of crew) {
          const title = nextTitle(s, c);
          const r = run(db, 'INSERT INTO tasks (floor_id,plan,title,brief,agent_id,project,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', f.id, batch, title, '', a.id, '', t, t);
          engine.emitTask(Number(r.lastInsertRowid));
          feed(f, mgr, `gave ${a.name} a task: "${title}"`);
          engine.talk(f.id, mgr, a, `${pick(GIVE)} ${title}.`, { kind: 'assign' });
        }
        if (Math.random() < 0.5) engine.emit(f.id, 'meeting', { manager: mgr.id, staff: crew.map((a) => a.id) });
        { const script = SCRIPTS[s.key]; if (script) saySome(f, [mgr, ...crew], nextOf(s, script.meetings, 'meetingAt'), 'meeting'); }
        s.phase = 'start'; break;
      }
      case 'start': {
        act(mgr, ['talking', 'Briefing the team']);
        for (const task of openTasks(f.id).filter((x) => x.status === 'todo')) {
          const a = staff.find((x) => x.id === task.agent_id); if (!a) continue;
          run(db, "UPDATE tasks SET status='doing', updated_at=? WHERE id=?", t, task.id);
          engine.emitTask(task.id);
          act(a, pick(ACTIVITIES[a.role] || ACTIVITIES.writer), task.id);
          feed(f, a, `started "${task.title}"`);
        }
        s.phase = 'work'; s.step = 0; s.steps = 3 + rnd(4); break;
      }
      case 'work': {
        if (s.step === 0) idle(mgr);
        const doing = openTasks(f.id).filter((x) => x.status === 'doing');
        if (!doing.length) { s.phase = 'wrap'; break; }
        for (const task of doing) {
          const a = staff.find((x) => x.id === task.agent_id); if (!a) continue;
          if (Math.random() < 0.7) act(a, pick(ACTIVITIES[a.role] || ACTIVITIES.writer), task.id);
          if (Math.random() < 0.35) feed(f, a, pick(c.progress));
        }
        // Now and then someone stops by a colleague's desk.
        if (staff.length > 1 && SCRIPTS[s.key] && Math.random() < 0.3) {
          const [asker, other] = shuffled(staff); const [q, a] = nextOf(s, SCRIPTS[s.key].asks, 'askAt');
          engine.talk(f.id, asker, other, q, { kind: 'ask' }); engine.talk(f.id, other, asker, a, { kind: 'answer' });
        }
        if (++s.step >= s.steps) s.phase = 'wrap';
        break;
      }
      case 'wrap': {
        // One finishes per beat, then the manager looks it over and signs it off on the next.
        const review = openTasks(f.id).find((x) => x.status === 'review');
        if (review) {
          run(db, "UPDATE tasks SET status='done', result=?, updated_at=? WHERE id=?", 'Done, and filed.', t, review.id);
          engine.emitTask(review.id);
          feed(f, mgr, `approved "${review.title}"`);
          { const who = staff.find((x) => x.id === review.agent_id); if (who) engine.talk(f.id, mgr, who, pick(SIGN_OFF), { kind: 'review' }); }
          idle(mgr);
          break;
        }
        const doing = openTasks(f.id).find((x) => x.status === 'doing');
        if (doing) {
          const a = staff.find((x) => x.id === doing.agent_id);
          run(db, "UPDATE tasks SET status='review', updated_at=? WHERE id=?", t, doing.id);
          engine.emitTask(doing.id);
          if (a) { idle(a); feed(f, a, `finished "${doing.title}"`); engine.talk(f.id, a, mgr, `${doing.title}: done. ${pick(c.banter || BANTER)}`, { kind: 'handoff' }); engine.emit(f.id, 'handoff', { from: a.id, to: mgr.id, kind: 'paper' }); }
          act(mgr, ['reading', 'Reviewing the work']);
          break;
        }
        // The board is clear. Keep it short: old finished work drops off the bottom.
        run(db, `DELETE FROM tasks WHERE floor_id=? AND status='done' AND id NOT IN (SELECT id FROM tasks WHERE floor_id=? AND status='done' ORDER BY id DESC LIMIT ${MAX_DONE_KEPT})`, f.id, f.id);
        s.cycles++;
        s.phase = s.cycles % 2 === 0 ? 'publish' : 'quiet';
        break;
      }
      case 'publish': {
        const p = c.projects[s.projectIdx % c.projects.length]; s.projectIdx++;
        const author = staff.find((a) => a.role === 'writer') || staff[0];
        const had = get(db, 'SELECT published_at FROM projects WHERE floor_id=? AND slug=?', f.id, p.slug);
        const md = [`# ${p.title}`, '', `*${DISCLAIMER}*`, '', ...p.body, '', `_${had ? 'Revised' : 'Published'} by ${author.name}, ${c.name}._`].join('\n');
        act(author, ['typing', 'Getting it ready to publish'], null, p.slug);
        tx(db, () => {
          run(db, 'INSERT OR REPLACE INTO published_files (floor_id,project,path,content,size) VALUES (?,?,?,?,?)', f.id, p.slug, 'index.md', md, Buffer.byteLength(md));
          engine.upsertProject(f, p.slug, { title: p.title, description: p.description, kind: 'doc', sources: [], published: true });
        });
        feed(f, author, `published ${p.slug}`, p.slug);
        engine.emitProject(f.id, p.slug);
        s.phase = 'cheer'; break;
      }
      case 'cheer': {
        for (const a of staff) idle(a);
        act(mgr, ['talking', 'Saying well done']);
        feed(f, null, pick(c.cheers));
        s.phase = 'quiet'; break;
      }
      default: {
        for (const a of agents) idle(a);
        if (Math.random() < 0.5) feed(f, null, pick(QUIET));
        if (staff.length > 1 && SCRIPTS[s.key]) saySome(f, shuffled(staff).slice(0, 2), nextOf(s, SCRIPTS[s.key].pairs, 'pairAt'), 'banter');
        s.phase = 'plan'; break;
      }
    }
  }

  function tick() {
    if (stopped) return;
    try {
      const rows = floorRows();
      const live = new Set(rows.map((f) => f.id));
      for (const id of scenes.keys()) if (!live.has(id)) scenes.delete(id);   // removed by the CLI or an admin: forgotten, no fuss
      const t = now();
      for (const f of rows) {
        const s = scene(f);
        if (s.nextAt > t) continue;
        advance(f, s);
        const wait = tickMs * (0.8 + Math.random() * 0.7) * (watched(f.id) ? 1 : IDLE_SLOWDOWN);
        s.nextAt = t + wait;
      }
    } catch (e) { log('error', 'filler', { err: String(e?.message || e).slice(0, 200) }); }
    schedule();
  }
  function schedule() {
    if (stopped || timer) return;
    timer = setTimeout(() => { timer = null; tick(); }, tickMs * (0.7 + Math.random() * 0.9));
    timer.unref?.();
  }
  const ensureTimer = () => { if (!stopped && !timer && get(db, 'SELECT 1 x FROM floors WHERE filler=1 LIMIT 1')) schedule(); };

  POST('/api/admin/filler/:action', async ({ req, res, p, ip }) => {
    requireAdmin(req); limit('mutate', ip);
    const b = await readJson(req, 1024);
    if (p.action === 'remove') {
      const id = Number(b.id);
      if (!Number.isInteger(id)) throw new HttpError(400, 'bad_id');
      const r = removeFiller(db, { id }, { engine, now });
      if (!r) throw new HttpError(404, 'not_found', 'That is not a filler floor.');
      scenes.delete(id);
      log('info', 'filler removed', { floor: r.number });
      return json(res, 200, { ok: true, removed: r });
    }
    if (p.action === 'seed') {
      const r = seedFillers(db, { cfg, models: engine.models, engine, now, revive: b.revive === true });
      ensureTimer();
      return json(res, 200, { ok: true, ...r });
    }
    throw new HttpError(400, 'bad_action');
  });

  return {
    start() {
      if (cfg.fillerCompanies) {
        const r = seedFillers(db, { cfg, models: engine.models, engine, now });
        if (r.seeded.length) log('info', 'filler seeded', { floors: r.seeded.map((x) => x.number) });
      }
      ensureTimer();
    },
    stop() { stopped = true; clearTimeout(timer); timer = null; },
    scenes,
  };
}
