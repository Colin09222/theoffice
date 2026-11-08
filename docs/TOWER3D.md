# The Building in 3D

The lobby's **Building** view is the tower cut away: every floor's office in one three.js scene, ridden up and down with the wheel, a drag
or a swipe (with momentum, settling on a floor), the arrow keys or PageUp/PageDown. Tap a floor, or its plaque, and the camera flies into
it; the floor page carries on with that very room, people mid-stride, with no lift doors. **Back to building** flies out again to the
same spot. **Outside** is the tower from the street, as before. Without WebGL, Building falls back to the strip stack.

## How it is put together

- `public/js/tower-scene.js` is the view. Floors stack 10.5 units apart (an exploded drawing), and the floors above the one in the middle
  of the screen rise out of its way, so a camera looking well down (as a floor page does) sees over desks and screens into the room.
- **Real floors** are the floor page's own `OfficeView` (`office-scene.js`), built with `host: tower`: the room, furniture and people live
  under `view.root`, placed at the floor's height in the tower's scene, under the tower's camera and lights. Each one listens to its
  floor's public SSE stream while it is on show, so people type, walk, meet and talk from live data, with their name tags.
  The floor in the middle and its neighbours are real: two either side on a desktop, one on a phone, and only the middle one when the
  stage has dropped to its lowest tier.
- **Stand-ins** are every other floor: its walls in its wall colour, its finish, the company's colour round the edge, sky in the windows,
  desks where its plan has them, a lit screen where someone is at work, and the people in their own colours. Five instanced meshes for the
  whole building. An empty floor is dark with a To Let board. Hidden floors, and floors a code is holding, aren't in the stack at all.
- **No pop, no hitch.** A real floor is built only while the building stands still, one at a time, and then a step a frame (the bake,
  the furniture, each person's model) through `OfficeView.turn()`, paused the moment anyone scrolls. Its shaders are compiled with
  `compileAsync` before it is shown, then it appears behind its stand-in, which dissolves (an ordered dither, no transparency).
- **Seamless hand-over.** The tower already wears the floor page's materials and shaders (the same lights, a shadow map that is drawn once
  and holds nothing, the shared room panorama from `textures.js`), so nothing compiles or bakes at the landing. The flight ends exactly on
  the floor page's first picture: the same camera, its real panel insets, and the city carried to where the floor page has it. The stage
  then holds that frame and cross-fades it into the floor page (`stage.freezeFrame`). `handoff.js` passes the room each way;
  `OfficeView.promote()` and `demote()` move it between the two without rebuilding it.
- `/api/building/staff` also returns each open floor's room (`decor`) and boss (`name`, `look`) for the stand-ins. Both are on every floor
  page already; hidden and suspended floors are left out.

## Going round it, in and out (polish3d)

- **All the way round.** The camera turns a full 360° about the tower's axis, with damping and a little momentum after a flick. Desktop:
  the wheel rides the floors (as before), a drag turns (sideways) or rides (up and down; a drag takes the way it set off), a sideways
  two-finger trackpad swipe turns, ctrl+wheel or a trackpad pinch zooms (Safari's own pinch too), the arrow keys ride and turn, + and −
  zoom. Phone: a vertical swipe rides with momentum, a sideways drag turns, a pinch zooms, a tap goes in. A drag or a pinch is never a tap.
- **Buttons** by the building (`.tower-ctrl`): up, down, turn left, turn right, zoom in, zoom out and **Whole building** (which says
  **Back to the floor** once the whole building is in view). On a phone they are a column on the right, under the top bar.
- **Zoom** runs from the whole building, ground to mast, in view (worked out per screen, the gap over the floor in the middle closing a
  little and the haze moving back) down to desk height (the camera comes within 23 units and drops to a low angle). Name tags stay away
  when the floors are too small to read.
- **The cutaway follows the camera** (`cutaway.js`). Each room has a back and a left wall; the floor page only ever looks from the front.
  In the tower, the walls facing the camera are cut down to their window sills, a dither at a time as it turns, and the room's front and
  right walls (built by `OfficeView.buildFarWalls`, and as stand-in pieces for the far floors) come up as they go. It is all in the shaders,
  from the camera's own position, so it costs nothing per frame and a room in the tower still draws with its floor page's programs. A
  floor page turns all the way round too (drag sideways, or shift-drag when zoomed in); from the front, where it starts, nothing is cut. The corner pillar in front of a diagonal view fades too. Plaques sit on the slab edge facing the camera, and a tag is
  hidden when the line from the camera to it passes through the slab above.
- **Flights** go round the axis, not through the building: a floor entered from behind is flown round to its front.
- **No loading screens.** The lift has no doors: the floors either side are fetched while a floor is looked at, and their rooms are built
  ahead in a quiet spell (both on a desktop, the one the lift was last heading towards on a phone), with their shaders compiled and the
  baked floor uploaded; a floor the lift has just left is kept, room and people, for a minute and a half (`floorcache.js`). Each floor's
  stream replays from where its data left off, so nothing kept goes stale. A direct link lifts its curtain on the room's first picture,
  and the furniture and people come in as they load.
- **Job titles** sit small and muted above every name (tower and floor page), the same title the staff list now puts above the name.
- **Screens at work glow** a little past white, outside the tone curve, so the bloom picks them out.
- **The governor**: under about 28fps for two seconds a whole tier goes at once (fewer real floors in the tower, fewer pixels, no
  occlusion, no shadows at the lowest); slower than a desktop should be but above that, it steps as before (occlusion, pixels, tier).
  Every step is recorded in `stage.steps`. Rendering stops in a hidden tab (as before), and a page nobody has touched for six seconds,
  with nothing moving but the people, is drawn every other frame.

## Measured (headless Chrome on the M4's GPU)

`node test/browser/tower.mjs` builds a 30-floor building with 22 companies (110 staff) and measures frame times while still, riding,
flying in and flying out. The phone profile is 390x844 at a device pixel ratio of 2 with the CPU slowed four times. The GPU is not slowed:
a real mid-range phone's GPU is far weaker than an M4's, so the phone numbers are an upper bound on what a phone will manage. The draw call
and triangle counts below are what a phone's GPU would have to carry.

| | desktop 1440x900 | phone profile, 4x CPU |
| --- | --- | --- |
| holding still | 60 fps, 368 draw calls, 373k triangles | 60 fps, 225 draw calls, 249k triangles |
| riding | 59 fps, worst frame 33 ms, no long tasks | 58 fps, worst frame 67 ms (a floor being built while at rest) |
| flying in | 60 fps, worst frame 33 ms | 59 fps, worst frame 83 ms (the landing) |
| flying out | 59 fps, worst frame 33 ms | 57-59 fps, worst frame 33-67 ms |
| JS heap | 48-76 MB | 42-86 MB |

On a device that keeps missing its frame time the stage steps down by itself: the occlusion goes, then pixels, then the tier, and at the
lowest tier the tower keeps only the floor in the middle real.

## Testing

At 7d8a0b0: node suite 878/878 (Node 22, AI_MODE=mock); `tower.mjs` 18/18 on both profiles; `e2e.mjs` 53/70, against 40/70 for origin/main
on the same machine. Every e2e failure left is there on main too: the CSP note below, and on a phone the customise sheet covering its own
Decor tab (`[data-custom=decor] is covered by DIV.color-row`), which leaves the sheet open over the later phone steps.

- `node test/browser/tower.mjs` (TOWER_SHOTS=dir keeps screenshots, TOWER_ONLY=desktop|phone runs one profile).
- `node test/browser/stack.mjs` is now the no-WebGL Building (the strips). Its phone flick step fails on this machine on main too.
- The CSP note "Evaluating a string as JavaScript violates..." appears on every floor page on main as well; the tower test ignores only that.
