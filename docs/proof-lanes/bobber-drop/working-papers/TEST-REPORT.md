# Bobber Drop: test report (Tess, task #11)

## How I tested it
I served the project folder with `python3 -m http.server` and played it in Playwright Chromium with real input:
- **Desktop, 1280×800:** a full run on the Space key, a full run on mouse clicks on the canvas, Fish again (button and Space), and a page reload.
- **Phone, 390×844 with touch:** tap to start, tap to drop, a full run, typing a name and saving, Fish again.
- **Miss-only run:** I dropped only when nothing was under the hook, to check that misses fray the line and end the run.

A bot read the game state to decide *when* to press. Every drop was a real key press, click or touch tap. I did the full set of playthroughs after the last fix.

## Results (after fixes)
| Check | Result |
|---|---|
| Start screen: title, how-to, fish table, board | OK |
| Starts with Space, click and touch tap | OK |
| Drops with Space, mouse and touch | OK |
| Catches add points (score went 0→146 in one keyboard run, 0→47 on phone) | OK |
| Tension meter and "load X kg of Y kg limit" go up with each catch; the bar turns green, then orange, then red | OK |
| Swing gets slower and wider as the weight goes up | OK (seen on screen) |
| Misses fray the line by 4 kg each (40→36→…→4), and the 10th miss snaps it | OK |
| Game over screen shows score, catches, misses and weight held | OK |
| Save score is turned off at 0 points, with a clear message | OK |
| Save score: "Saved!" appears and the name shows on the board, highlighted | OK (desktop and phone) |
| Name is filled in on the next run and after a reload; the board persists after a reload | OK (local mirror) |
| Fish again (button), Space on game over, Space after clicking Fish again | OK |
| Console | No JavaScript errors. The only console entries are 404/501 responses from `_data/v1/...`, which the local static server doesn't provide. The client falls back to its offline mirror. Expected locally, not a bug. |

## Bugs fixed
1. **The "+kg" label on the Spare line spool showed mirrored ("gk+") when the spool swam left.** The text is now drawn unmirrored. I checked it with a cropped screenshot.
2. **Leaderboard names sat centred between the rank and the score.** They are now left-aligned next to the rank.
3. **The rules text said "Past its limit, it snaps", but the line snaps when the load *reaches* the limit** (for example "40 kg of 40 kg", 0 misses). I changed the text to "When the load reaches its limit, it snaps." The rule itself is unchanged.
4. **On a slow frame (dt capped at 0.05 s), the falling hook moved 34 px in one step**, which is more than the 20 px catch window for a minnow, so it could pass straight through. The drop now moves in steps of 8 px or less.
5. **No in-game prompt.** The design review flagged this. "Tap, click or Space to drop" now pulses on the water until the first drop.

## Not fixed (bigger or design calls, for Otis or the boss)
- On desktop the game is a portrait column with wide empty navy margins on each side. The design review called this the biggest visual issue. It needs a layout decision, so I didn't treat it as a small bug.
- The game-over screen says "or press Space" on phones too. It's harmless.
- I could only test the shared leaderboard against the local offline mirror. The real shared board, with scores from other players, can only be checked on the published site.

## Launch checklist (`node /workspace/.office/launch-check.mjs . game`)
```
OK: page title, search description, works on phones (viewport), language set, social preview text, social preview image, favicon, no invented claims or contact details found.
```
Design review: no invented content found.
