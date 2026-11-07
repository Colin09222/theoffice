# Paint the Dark: playtest report (Margot, Tester)

Served from the **project root** (no build step, per Arlo's notes) with `python3 -m http.server 8123`, driven with Playwright Chromium at desktop 1280×800 and phone 390×844 (touch, isMobile, DPR 3), plus an 844×390 landscape-to-portrait rotation. All input was real: keyboard down/up, `page.tap`, and CDP touch events on the canvas halves. Scripts are in `notes/tests/` (`play2.cjs`, `bot.cjs`, `vanish2.cjs`, `misc.cjs`, `rot.cjs`, `probe.cjs`). Run them with `NODE_PATH=$(npm root -g) node notes/tests/<file>`. Following the Office Manager's instructions, I changed no game code and published nothing.

Note: BUILD-NOTES.md mentions `notes/tests/play.cjs`, `trail.cjs` and `shot.cjs`, but those files were not in the bundle. My scripts take their place.

## What works (and how I know)
- **Title screen**: loads in about 0.45 s with no JS errors. The demo snail draws curves behind the card. The only console errors are 404/501s on `_data/v1/...`, which is expected with no backend on a static server (client.js falls back to local storage).
- **Fast start**: Space, Enter, an arrow key, the Play button, or a tap on the title overlay goes to `play` straight away.
- **Keyboard steering**: holding → for 0.4 s turned the snail +1.3 rad, and ← turned it −1.3 rad.
- **Touch steering (phone)**: holding the right half turned it +1.28 rad and the left half −1.28 rad. It stopped turning on release (0 change).
- **Trail**: glows bright cyan, turns violet after 2.2 s, and is gone by 4 s (screenshot `d-play-lit.png`).
- **Coins**: hidden until lit, then shown with a countdown ring. When ignored, a lit coin vanished after 3.21–3.22 s with no score change, seen many times across 3 runs. They respawn.
- **First coin**: it sits straight ahead, so going straight collects it at about 1.4 s.
- **Crashes**: hitting the edge ends the run (`why: edge`). Holding one turn ends the run on your own bright trail at about 1.93 s (`why: trail`).
- **Score**: a bot run collected 7 coins. The HUD matched the internal score on every sample (0 mismatches). The game-over screen showed 7 and "New personal best!".
- **Restart**: works with the Play again button (score and HUD reset to 0) and with Space (after the 600 ms guard). On the phone, tapping Play again also works.
- **Leaderboard**: entering the name `<i>Margot</i>xyz` (cut to 12 characters by maxlength) showed "Saved! Thanks, …". The board showed `1. <i>Margot</i 7` highlighted as you, rendered as text, not HTML (0 `<i>` elements). The Save button disables after saving, and `Office.leaderboard('coins')` returns the entry after a reload. The top-10 limit is applied in code (`limit:10` plus `slice(0,10)`). I could not fill a shared board with more than 10 real players locally.
- **Local best**: survives a reload (`paint-the-dark.best` = 7, and the HUD shows "Best 7").
- **Pause**: P pauses and an arrow key resumes. Window blur auto-pauses, and clicking the pause overlay resumes.
- **Launch check**: `node launch-check.mjs . game` gives: `OK: page title, search description, works on phones (viewport), language set, social preview text, social preview image, favicon, no invented claims or contact details found.`
- **Claims**: there are no invented claims, prices, reviews or contact details on the page.

## Bugs
1. **minor: the "Save score" form shows on a 0-coin game over.** `showOver()` sets `nameForm.hidden = true`, but the CSS rule `#nameForm { display:flex }` overrides the `hidden` attribute. To reproduce: start, hold → until you die with 0 coins. The name box and Save button are still visible (`d-over.png`, `p-over.png`), and typing a name and clicking Save does nothing at all. Fix: add `#nameForm[hidden]{display:none}`.
2. **minor: rotating a phone mid-run can kill you instantly.** `resize()` rescales the world but doesn't move the snail. To reproduce: at 844×390 landscape, tap Play and rotate to 390×844 portrait. The snail at x=500 is now outside the 462-wide world, so it dies with `edge` at t=0.45 s. Resizing a desktop window narrower does the same.
3. **minor (fairness, first 10 s): the top wall arrives fast.** On desktop the snail starts 0.62 of the way down, heading up. Going straight hits the top edge at about 2.7 s, only about 1.3 s after the free first coin. A first-timer who is still reading the tip dies almost immediately. Holding one turn also kills you in about 1.9 s (by design, but it surprises players). Suggestion: start lower or more central, or give a short grace period.
4. **minor (cosmetic):** the HUD "Best" doesn't update during a run that beats it. It shows Best 0 with Coins 5, and updates only at game over.
5. **minor (polish, from design review):** the title card covers most of the screen and shows no coins, so the reveal mechanic isn't shown before play. This is not a functional problem.

There are no blockers.
