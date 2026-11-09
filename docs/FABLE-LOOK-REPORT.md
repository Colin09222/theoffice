# The look pass (branch `cloud/fable-look`)

Started from `main` at `9f6e4f4`. Client files only: the scene, the lobby, the floor chrome and their CSS. No server, prompt or
business code, no new assets, no new dependencies, CSP unchanged. Not merged, no pull request.

The same commits are also on `claude/office-visual-polish-lft5rr`, the branch this session was set up to push to. The two are identical.

## What changed

### The two approved fixes
- **Smaller bottom panel on phones.** The sheet at rest was the handle, a "Right now" heading, a status line, a 44px last-word button and the
  tabs: about 180px. It is now one row and the tabs: **121px** at 390x844 (measured in the page, `__office.peekH`). The row shows who spoke
  last with their face, what they said, and what the floor is doing in small green type above it. Tapping it still opens the conversation,
  the step button and the handle work as before, and the owner's "Reply to … (n options)" button still appears under it when there are
  options waiting. Half and full sizes are untouched, so the chat is as roomy as it was.
- **The crop on tall phones.** The camera used to look across the room at an angle, so the row of desks ran corner to corner, people at
  each end were cut by the screen edge and the top right was empty terrace. A tall phone now looks *down* the row (`TALL_YAW` 1.02 to 1.42):
  the team runs top to bottom, each in their own office, the corridor and the meeting table fill the left, and the terrace is a sliver.
  The frame also leans so the desks sit right of centre. Bean size is unchanged (still about a sixth of the screen width).

### Rooms and props
- Under a floor there was a flat beige disc. It is now a **bank of cloud on blue**: the floor is up a tower, and a warm room on a cool
  ground reads far better. One 512px canvas, shared by every floor, same single draw call as the disc it replaces.
- The terrace has its planters, benches and tables on a floor page too (they were only drawn in the tower), in a pale stone rather than
  one flat colour. They bake into the terrace mesh, so no extra draw calls.
- Wall caps are a cool pale stone instead of a tint of the accent colour, which the warm light was turning the same tan as the furniture.
- Desks are pale, so screens, paper and people stand out on them and they no longer melt into timber floors.
- The meeting table has a meeting on it: two open laptops, papers, mugs, a plant. Baked in with the table.
- Spare offices were dark boxes with a grey chair. They are lit (a shade under the occupied rooms) and furnished as places: a reading
  chair and lamp, a store of boxes and a bookcase, two chairs and a plant. The "Free office" door sign for the boss is unchanged.
- Both ways of reaching a floor (a direct link, and flown in from the lobby) now give the same room. Before, the direct link had the bare
  terrace and the lobby route had the furnished one.

### Floor chrome
- **Desktop:** the lift's floor buttons are quiet paper discs with only the current floor lit, and a long list fades out at the ends
  instead of slicing a number in half. The whole team is kept in frame (a wide screen gives up a little bean size for it, and the margin
  allows for a bean's width so nobody sits under the lift). The demo note is a small pill.
- **Phone on its side (844x390):** the plaque is one row (back, floor, name, status) instead of a 190px card, and the demo note is one line.
- The demo note reads "Demo company: scripted and fictional".

### Lobby and the outside of the building
- The tower's glass reads as glass: cool against paler stone, deeper low down, sky blue toward the crown, a gold wash on the sunny side.
  Lit floors have warm lamps and a brighter colour band. It is still a real tower, not a cartoon.
- To Let is a small cream placard in one window per face, in a different bay each floor, not a red stripe on every empty floor.
- The crown sign is larger: cream letters on a dark band with brass trim.
- **Phones:** smaller sign, a 32px news strip, a slimmer To Let button and an 86px directory peek (handle and search). The bottom stack is
  about 200px, down from about 250, and the tower is framed in what is left, so it is bigger.
- **Desktop:** the tower is bigger (it filled about 69% of the height, now about 75%) and stands in the gap between the sign and the
  directory instead of leaning toward the directory.
- **Phone on its side:** the directory folds to its heading and search row, top right. Tapping the heading, the search, Launched or Top
  opens the list. Before, it covered more than a third of the screen and the tower was a sliver beside it.

## What I saw for myself

This machine has no GPU. Chrome rendered WebGL through SwiftShader, which works, so everything below is from real screenshots, but two
things follow from it:

- A software renderer starts on the **low** tier. I forced the tier a real device gets with `?q=mid` (phones) and `?q=high` (desktop) and
  looked at low as well. The post-processing on high (occlusion, bloom) ran, but slowly.
- Frames are slow enough that the fly-in was still going when early screenshots were taken. `test/browser/look-shots.mjs` now ends the
  fly-in before it takes the picture.

`test/browser/look-shots.mjs` is new: it boots a 30-floor building with the two demo companies and twelve others and saves the lobby and a
demo floor at 390x844, 360x640, 430x932, 844x390 and 1280x800 (`LOOK_Q`, `LOOK_ONLY`, `LOOK_VIA=lobby`, `LOOK_FLOORS`, `LOOK_SHOTS`).

My own harsh read of the final pictures, against the same pictures of `main`:

| Screen | Before | After | Notes |
| --- | --- | --- | --- |
| Floor, 390x844 and 430x932 | 5 | 7.5 | Whole team in a column, room fills the screen, panel is small. At this angle you see more sides of people than faces. |
| Floor, 360x640 | 5 | 7 | Three or four people at a good size; the rest are a drag away, as before. |
| Floor, 844x390 | 5 | 8 | The best floor picture: the whole team, the neon sign, the meeting table, one-row plaque. |
| Floor, 1280x800 | 6 | 8 | Sky, shadows, lit rooms, everyone in frame. |
| Lobby, phones | 7 | 8 | Tower is bigger and reads as glass and stone. |
| Lobby, 844x390 | 5 | 7.5 | Tower has the screen; directory folded. |
| Lobby, 1280x800 | 6.5 | 7.5 | Tower bigger and centred in its gap. The directory is still a heavy dark panel on the right. |

These are my scores, not the reviewers'. I would not be surprised by a 7 where I say 8.

## Tests

Being run as this draft is pushed; results follow in the next commit.

## What I couldn't check
- **A real GPU or a real phone.** Colour, sharpness and frame rate on real hardware are the integrator's call. On a real GPU the high tier's
  bloom and occlusion will look somewhat different from SwiftShader's.
- **First frame under 2.5 s on a phone over 4G.** `polish.mjs` measures it, but under software rendering the number means nothing.
  Nothing was added to the first load: no new files, no new models on the lobby, one 512px canvas texture and a few dozen boxes on a floor.
  The spare rooms now ask for a few more furniture models (reading chair, lamps, a low bookcase); those load after the first frame, as all
  furniture does, and most are already fetched for the occupied rooms.
- **The quality governor on a slow real device.** Its code is untouched. Here every unforced run simply started on `low`, because the
  stage recognises a software renderer, so I did not watch it step down on a struggling GPU.
- **Motion.** I judged stills. The fly-in, the sheet's slide and the walking were not reviewed as motion.
- **The owner's view on a phone at rest** with options waiting ("Reply to …" under the row) was covered by the phone suite's audits, not by my eye.

## What I'd do next
1. The desktop lobby directory is the heaviest thing left on any screen. A paler, narrower board (or one that opens from a tab) would give
   the tower the stage the way the folded one now does on a phone on its side.
2. On tall phones people at their desks are seen from the side. Turning each desk a little toward the camera on a phone, or having people
   glance at the camera when idle, would put more faces in the picture.
3. Wall caps and desks use fixed pale colours. They could take a hint of the company's palette on floors whose walls are pale, where the
   caps now read a little grey.
4. The lit-window glow on the tower is modest; at dusk a stronger glow on occupied floors would say "someone's in" from further away.
5. The phone plaque and sheet use the system font while the lobby uses the display face. One voice across both would feel more finished.
