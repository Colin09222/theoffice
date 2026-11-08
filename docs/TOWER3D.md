# The building

The lobby shows the tower from the street: one `three.js` scene (`public/js/lobby-scene.js`), the whole building in frame, ground to mast, whatever its height. Drag to spin it round. Nothing rides up or down on scroll, in the lobby or on a floor. Pick a lit floor and a short swoop to its glass brings you to its floor page; a floor that's empty and to let opens Open an office instead. **Back to building** returns to the lobby. Without WebGL, the lobby is the strip stack (`public/js/stack.js`, no switch).

## On a floor: up and down

The lift panel (`public/js/floor-chrome.js`) is the way between floors: up, down, one button per open floor, and PageUp/PageDown on a keyboard. It only ever stops at floors that are open and in the building, and skips everything else (empty floors, hidden floors, floors a code is holding). A hidden floor's own link still opens its page, and its lift goes down to the real floors; touching and dragging only moves the room. `public/js/floorcache.js` keeps the rooms either side warm, so there are no doors between floors.

## How tall is it

The building is **1 to `TOWER_FLOORS`** (default 10). **To add floors later, raise `TOWER_FLOORS` in `.env` and restart: no data changes.** New floors are empty and to let. The camera, the shadows on the ground and the mast all work from the real floor count, so the tower looks right at any height. The tests prove 10 to 14.

Only floors 1 to `TOWER_FLOORS` are the building: the lobby, the lift, the counts and the To Let list only look at those. A company can sit above it, numbered over `TOWER_FLOORS`, as the hidden test floors do: it keeps its links, published apps, domains, mail, data and staff, and every admin command that names a floor still reaches it. Claiming a code takes the next free floor inside the building.

## Who is on which floor (now)

| Floors | |
| --- | --- |
| 1 and 2 | the two demo companies, Pigeon Logistics and Mildly Haunted Candles. `server/filler.js` only ever seeds demos on the bottom two floors |
| 3 | held for LabStackr by its one-time code |
| 4 to 10 | to let |
| 101 to 106 | the six hidden test companies |

## Moving floors

A floor's number is only where it sits: its id carries everything else. All of these are safe to run again and print no codes.

- `node scripts/admin.mjs floors park --from 1 --to 6 --at 101` moves the hidden floors in that range up out of the building, keeping their order.
- `node scripts/admin.mjs floors move --slug SLUG --to N` puts a company on an empty floor inside the building.
- `node scripts/admin.mjs code hold --issued-at MS --floor N` makes the one unused code issued at that moment hold a floor.

## Testing

`node --test test/tower10.test.js` covers the building's height, the demos, the code hold, moving floors and hidden floors above the building. `node test/browser/tower.mjs` is the lobby on a desktop and a phone profile: no Building switch, the framing, nothing riding on scroll, To Let, picking floors, the lift and Back (TOWER_SHOTS=dir keeps screenshots, TOWER_ONLY=desktop|phone runs one profile). `node test/browser/polish.mjs` is the floor pages: the lift's timing, turning a floor, a cold direct link, the governor. `node test/browser/stack.mjs` is the no-WebGL strips. Use Node 22 and AI_MODE=mock.
