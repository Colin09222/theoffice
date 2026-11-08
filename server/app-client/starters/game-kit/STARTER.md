# Game starter

Already working, so spend your effort on the game itself:

- `kit.js` (shared, no engine): boot, menu, play, pause, settings, help, leaderboard and game-over screens; keyboard, touch (a stick
  under the left thumb, A and B on the right) and gamepad as one set of actions (`input.axis()`, `input.down('action')`,
  `input.pressed('alt')`); audio with mute (`audio.sfx('hit' | 'explode' | 'pickup' | 'power' | 'hurt' | 'dash' | 'win' | 'lose')` and a
  music loop); saves (`cloud.save`, `cloud.load`) and the shared leaderboard through Office Cloud; juice (`juice.shake(0..1)`,
  `juice.hitStop(ms)`, `juice.tween(obj, to, ms, ease.outBack)`, `juice.offset` for the camera); `choose(title, options)` for upgrades
  between waves; `gameOver({ score, won, stats })` ends a run, saves the best and posts the score.
- `game.js`: the demo game. 2D is Phaser 3 (`_office/phaser.min.js`, served by the building); 3D is three.js
  (`./_office/three.module.min.js`). Both show the pattern: `run({ title, pitch, howTo, boot, start, update(dt), render(dt), quit, state })`.
- `kit.css`: the screens' look. Change the variables at the top to give the game its own palette and type.

Keep these working, because the Tester's playtest uses them:
- `window.officeGame.state()` returns `{scene, score, lives, level, wave, player: {x, y}, ...}`. Add what matters for your game.
- `scene` goes `menu` -> `play` -> `pause` / `pick` -> `over`, and Enter or the Play button starts from the menu and restarts from game over.

Replace the demo's theme, art, enemies and rules with the design doc's. Credit any CC0 sound or art you add on the help screen.
