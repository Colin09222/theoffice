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
