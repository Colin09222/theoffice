// Paint the Dark: a glowing snail leaves a fading trail of light that reveals hidden coins.
(function () {
  'use strict';

  // ---- Tuning (world units: the shorter screen side is about 600 units, a bit less on phones) ----
  var TRAIL_LIFE = 4.0;      // seconds until a trail point is fully gone
  var BRIGHT_AGE = 2.2;      // trail younger than this is "bright" and deadly
  var NECK_AGE = 0.3;        // ignore the very newest trail right behind the head
  var BASE_SPEED = 130;
  var BASE_TURN = 3.2;       // radians per second
  var SNAIL_R = 9;
  var HIT_R = 7;             // distance to a bright trail point that counts as a crash
  var COIN_R = 11;
  var COIN_LIT_TIME = 3.2;   // seconds a lit coin stays before vanishing
  var COIN_COUNT = 6;
  var GLOW_R = 52;           // light around the snail itself
  var TRAIL_LIGHT_R = 42;    // light around fresh trail points
  var EDGE = 4;
  var START_GRACE = 1.5;     // seconds at the start of a run with no edge or trail deaths
  var BOARD = 'coins';
  var BEST_KEY = 'paint-the-dark.best';
  var NAME_KEY = 'paint-the-dark.name';
  var SOUND_KEY = 'paint-the-dark.sound';

  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var $ = function (id) { return document.getElementById(id); };
  var hud = $('hud'), scoreEl = $('score'), bestEl = $('best');
  var tipEl = $('tip');
  var titleEl = $('title'), overEl = $('over'), pauseEl = $('pause');

  var W = 0, H = 0, DPR = 1, U = 1, WW = 600, WH = 600; // css px, device ratio, px per unit, world size

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    U = Math.max(Math.min(W, H) / 600, Math.max(W, H) / 1000); // phones get a slightly zoomed-in field
    var oldW = WW, oldH = WH;
    WW = W / U; WH = H / U;
    if (game && (oldW !== WW || oldH !== WH)) {
      // Rescale everything into the new world so a rotation or window resize never drops the snail outside it.
      var sx = WW / oldW, sy = WH / oldH, m = 60;
      var fit = function (p) { p.x *= sx; p.y *= sy; };
      fit(game); game.trail.forEach(fit); game.fx.forEach(fit);
      game.x = Math.min(WW - m, Math.max(m, game.x));
      game.y = Math.min(WH - m, Math.max(m, game.y));
      game.coins.forEach(function (c) { fit(c); if (c.x < 30 || c.y < 30 || c.x > WW - 30 || c.y > WH - 30) placeCoin(c); });
      game.graceUntil = Math.max(game.graceUntil || 0, game.t + 1.0);
    }
  }

  // ---- Local best ----
  function readBest() { try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; } }
  function writeBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* private mode */ } }
  var best = readBest();

  // ---- Sound (tiny Web Audio blips) ----
  var audio = null;
  var soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { /* default on */ }
  function ensureAudio() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; } }
    if (audio && audio.state === 'suspended') audio.resume();
  }
  function tone(freq, dur, type, vol, slide) {
    if (!soundOn || !audio) return;
    var t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol || 0.15, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function updateSoundBtn() { $('sound').textContent = soundOn ? 'Sound on' : 'Sound off'; }
  $('sound').addEventListener('click', function (e) {
    soundOn = !soundOn; updateSoundBtn();
    try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch (err) { /* ignore */ }
    e.currentTarget.blur();
  });
  updateSoundBtn();

  // ---- Game state ----
  var state = 'title'; // title | play | dying | over | paused
  var game = null;
  var overShownAt = 0;

  function newGame() {
    var g = {
      x: WW / 2, y: WH / 2, a: 0, t: 0, score: 0, graceUntil: START_GRACE,
      trail: [], lastDrop: null, coins: [], fx: [], deathT: 0, speedF: 1
    };
    // Start near one end of the long side, heading along it, so there is plenty of room ahead.
    if (WW >= WH) { g.x = WW * 0.18; g.y = WH / 2; g.a = 0; }
    else { g.x = WW / 2; g.y = WH * 0.82; g.a = -Math.PI / 2; }
    game = g;
    for (var i = 0; i < COIN_COUNT; i++) { var c = { }; placeCoin(c); g.coins.push(c); }
    // One coin a little way straight ahead, so the first find comes quickly.
    var first = g.coins[0];
    var side = Math.random() * 24 - 12; // close enough to the line that going straight collects it
    first.x = g.x + Math.cos(g.a) * 190 - Math.sin(g.a) * side;
    first.y = g.y + Math.sin(g.a) * 190 + Math.cos(g.a) * side;
    return g;
  }

  function placeCoin(c) {
    var tries = 0, x, y, ok;
    do {
      x = 40 + Math.random() * (WW - 80); y = 40 + Math.random() * (WH - 80); ok = true;
      if (game && Math.hypot(x - game.x, y - game.y) < 140) ok = false;
      if (ok && game) for (var i = 0; i < game.coins.length; i++) {
        var o = game.coins[i]; if (o !== c && o.state !== 'gone' && Math.hypot(x - o.x, y - o.y) < 70) { ok = false; break; }
      }
    } while (!ok && ++tries < 40);
    c.x = x; c.y = y; c.state = 'hidden'; c.timer = 0; c.spin = Math.random() * 6.28;
  }

  // ---- Input ----
  var keys = { left: false, right: false };
  var pointers = {}; // pointerId -> 'left' | 'right'
  function steer() {
    var l = keys.left, r = keys.right;
    for (var id in pointers) { if (pointers[id] === 'left') l = true; else r = true; }
    return (r ? 1 : 0) - (l ? 1 : 0);
  }
  var LEFT_KEYS = { ArrowLeft: 1, a: 1, A: 1 }, RIGHT_KEYS = { ArrowRight: 1, d: 1, D: 1 };
  var START_KEYS = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, ' ': 1, Enter: 1, a: 1, A: 1, d: 1, D: 1 };

  window.addEventListener('keydown', function (e) {
    var inInput = e.target && e.target.tagName === 'INPUT';
    if (LEFT_KEYS[e.key] && !inInput) keys.left = true;
    if (RIGHT_KEYS[e.key] && !inInput) keys.right = true;
    if (inInput) return;
    if (state === 'title' && START_KEYS[e.key]) { e.preventDefault(); start(); }
    else if (state === 'paused') { e.preventDefault(); resume(); }
    else if (state === 'over' && (e.key === ' ' || e.key === 'Enter') && performance.now() - overShownAt > 600) {
      if (e.target && e.target.tagName === 'BUTTON' && e.target.id !== 'againBtn') return;
      e.preventDefault(); start();
    }
    else if (state === 'play' && (e.key === 'p' || e.key === 'P' || e.key === 'Escape')) pause();
    if (e.key.indexOf('Arrow') === 0 || e.key === ' ') e.preventDefault();
  });
  window.addEventListener('keyup', function (e) {
    if (LEFT_KEYS[e.key]) keys.left = false;
    if (RIGHT_KEYS[e.key]) keys.right = false;
  });
  window.addEventListener('blur', function () { keys.left = keys.right = false; pointers = {}; if (state === 'play') pause(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && state === 'play') pause(); });

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    ensureAudio();
    if (state === 'title') { start(); }
    if (state === 'play') pointers[e.pointerId] = e.clientX < W / 2 ? 'left' : 'right';
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
  });
  canvas.addEventListener('pointermove', function (e) {
    if (pointers[e.pointerId]) pointers[e.pointerId] = e.clientX < W / 2 ? 'left' : 'right';
  });
  function lift(e) { delete pointers[e.pointerId]; }
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  titleEl.addEventListener('pointerdown', function (e) { if (e.target.id !== 'playBtn') { ensureAudio(); start(); } });
  pauseEl.addEventListener('pointerdown', function (e) { e.preventDefault(); resume(); });
  $('playBtn').addEventListener('click', function () { start(); });
  $('againBtn').addEventListener('click', function () { start(); });

  function start() {
    ensureAudio();
    pointers = {};
    newGame();
    state = 'play';
    titleEl.hidden = true; overEl.hidden = true; pauseEl.hidden = true; hud.hidden = false;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    scoreEl.textContent = '0'; bestEl.textContent = 'Best ' + best;
    tipEl.hidden = false; tipEl.style.opacity = '1';
    tone(520, 0.12, 'triangle', 0.08, 780);
  }
  function pause() { state = 'paused'; pauseEl.hidden = false; keys.left = keys.right = false; pointers = {}; }
  function resume() { state = 'play'; pauseEl.hidden = true; last = performance.now(); }

  // ---- Simulation ----
  function update(dt) {
    var g = game;
    g.t += dt;
    if (g.t > 6 && !tipEl.hidden) { tipEl.style.opacity = '0'; if (g.t > 7) tipEl.hidden = true; }
    g.speedF = Math.min(1.9, 1 + g.t * 0.008 + g.score * 0.01);
    var speed = BASE_SPEED * g.speedF;
    var turn = BASE_TURN + 0.9 * (g.speedF - 1);
    g.a += steer() * turn * dt;
    g.x += Math.cos(g.a) * speed * dt;
    g.y += Math.sin(g.a) * speed * dt;

    // Lay trail every few units.
    if (!g.lastDrop || Math.hypot(g.x - g.lastDrop.x, g.y - g.lastDrop.y) >= 4) {
      g.lastDrop = { x: g.x, y: g.y, t: g.t };
      g.trail.push(g.lastDrop);
    }
    while (g.trail.length && g.t - g.trail[0].t > TRAIL_LIFE) g.trail.shift();

    var grace = g.t < g.graceUntil;
    if (grace) {
      // Safe for a moment: stay inside the field instead of crashing.
      var mm = SNAIL_R + EDGE + 1;
      g.x = Math.min(WW - mm, Math.max(mm, g.x)); g.y = Math.min(WH - mm, Math.max(mm, g.y));
    }
    // Crash into the edge.
    if (!grace && (g.x < SNAIL_R + EDGE || g.y < SNAIL_R + EDGE || g.x > WW - SNAIL_R - EDGE || g.y > WH - SNAIL_R - EDGE)) return die('edge');
    // Crash into the bright part of the trail.
    for (var i = 0; !grace && i < g.trail.length; i++) {
      var p = g.trail[i], age = g.t - p.t;
      if (age > BRIGHT_AGE) continue;
      if (age < NECK_AGE) break;
      if (Math.hypot(g.x - p.x, g.y - p.y) < HIT_R) return die('trail');
    }

    // Coins: light, collect, expire.
    for (var j = 0; j < g.coins.length; j++) {
      var c = g.coins[j];
      c.spin += dt * 3;
      if (c.state === 'gone') { c.timer -= dt; if (c.timer <= 0) placeCoin(c); continue; }
      var d = Math.hypot(g.x - c.x, g.y - c.y);
      if (d < SNAIL_R + COIN_R) { collect(c); continue; }
      if (c.state === 'hidden') {
        var lit = d < GLOW_R;
        for (var k = g.trail.length - 1; !lit && k >= 0; k--) {
          var q = g.trail[k], f = 1 - (g.t - q.t) / TRAIL_LIFE;
          if (f > 0.25 && Math.hypot(q.x - c.x, q.y - c.y) < TRAIL_LIGHT_R * f) lit = true;
        }
        if (lit) { c.state = 'lit'; c.timer = COIN_LIT_TIME; burst(c.x, c.y, '#ffd25a', 8, 40); tone(880, 0.08, 'sine', 0.05); }
      } else if (c.state === 'lit') {
        c.timer -= dt;
        if (c.timer <= 0) { c.state = 'gone'; c.timer = 0.6; burst(c.x, c.y, '#8a7a50', 10, 30); tone(240, 0.15, 'sine', 0.04, 160); }
      }
    }
    updateFx(dt);
  }

  function collect(c) {
    var g = game;
    g.score++;
    scoreEl.textContent = String(g.score);
    if (g.score > best) bestEl.textContent = 'Best ' + g.score;
    burst(c.x, c.y, '#ffe9a0', 18, 120);
    g.fx.push({ kind: 'ring', x: c.x, y: c.y, life: 0.45, max: 0.45 });
    tone(990, 0.09, 'square', 0.05, 1480);
    setTimeout(function () { tone(1480, 0.1, 'triangle', 0.05); }, 60);
    c.state = 'gone'; c.timer = 0.4;
  }

  function burst(x, y, color, n, spd) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random() * 0.8);
      game.fx.push({ kind: 'spark', x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.4, max: 0.9, color: color });
    }
  }
  function updateFx(dt) {
    var fx = game.fx;
    for (var i = fx.length - 1; i >= 0; i--) {
      var f = fx[i]; f.life -= dt;
      if (f.kind === 'spark') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.94; f.vy *= 0.94; }
      if (f.life <= 0) fx.splice(i, 1);
    }
  }

  function die(why) {
    var g = game;
    g.why = why;
    state = 'dying'; g.deathT = 0; tipEl.hidden = true;
    keys.left = keys.right = false; pointers = {};
    burst(g.x, g.y, '#7ff6ff', 40, 160);
    tone(300, 0.5, 'sawtooth', 0.07, 60);
  }

  // ---- Game over + leaderboard ----
  var lastSubmitted = false;
  function showOver() {
    var g = game;
    state = 'over'; overShownAt = performance.now();
    hud.hidden = true;
    var isNew = g.score > best;
    if (isNew) { best = g.score; writeBest(best); }
    $('finalScore').textContent = String(g.score);
    $('coinWord').textContent = g.score === 1 ? 'coin' : 'coins';
    var bl = $('bestLine');
    bl.textContent = isNew && g.score > 0 ? 'New personal best!' : 'Your best ' + best;
    bl.className = isNew && g.score > 0 ? 'newbest' : '';
    var form = $('nameForm'), msg = $('formMsg'), btn = $('saveBtn'), input = $('nameInput');
    lastSubmitted = false;
    msg.className = ''; msg.textContent = '';
    if (g.score > 0) {
      form.hidden = false; btn.disabled = false; input.disabled = false;
      msg.textContent = 'Save your score to the shared top 10.';
    } else {
      form.hidden = true;
      msg.textContent = 'Collect a coin to get on the board.';
    }
    try { input.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* ignore */ }
    overEl.hidden = false;
    loadBoard();
  }

  function renderBoard(entries) {
    var ol = $('board');
    ol.textContent = '';
    if (!entries || !entries.length) {
      var li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No scores yet. Be the first!'; ol.appendChild(li); return;
    }
    entries.slice(0, 10).forEach(function (e, i) {
      var li = document.createElement('li'); if (e.you) li.className = 'you';
      var r = document.createElement('span'); r.className = 'r'; r.textContent = (e.rank || i + 1) + '.';
      var n = document.createElement('span'); n.className = 'n'; n.textContent = e.name || 'Anonymous';
      var s = document.createElement('span'); s.className = 's'; s.textContent = String(e.score);
      li.appendChild(r); li.appendChild(n); li.appendChild(s); ol.appendChild(li);
    });
  }
  function loadBoard() {
    if (!window.Office) { renderBoard([]); return Promise.resolve(); }
    return window.Office.leaderboard(BOARD, { limit: 10 }).then(renderBoard, function () {
      var ol = $('board'); ol.textContent = '';
      var li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Leaderboard unavailable right now.'; ol.appendChild(li);
    });
  }

  $('nameForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (lastSubmitted || !game || game.score <= 0) return;
    var input = $('nameInput'), btn = $('saveBtn'), msg = $('formMsg');
    if (this.website && this.website.value) return; // spam trap
    var name = input.value.replace(/\s+/g, ' ').trim().slice(0, 12);
    if (!name) { msg.className = 'err'; msg.textContent = 'Type a name first (up to 12 letters).'; input.focus(); return; }
    try { localStorage.setItem(NAME_KEY, name); } catch (err) { /* ignore */ }
    btn.disabled = true; msg.className = ''; msg.textContent = 'Saving…';
    if (!window.Office) { msg.className = 'err'; msg.textContent = 'Leaderboard unavailable right now.'; btn.disabled = false; return; }
    window.Office.submitScore(BOARD, name, game.score).then(function () {
      lastSubmitted = true; input.disabled = true;
      msg.textContent = 'Saved! Thanks, ' + name + '.';
      input.blur();
      return loadBoard();
    }).catch(function (err) {
      btn.disabled = false; msg.className = 'err';
      msg.textContent = (err && err.message) ? err.message : 'Could not save the score. Try again.';
    });
  });

  // ---- Rendering ----
  function drawTrail(g) {
    var tr = g.trail;
    if (tr.length < 2) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    // Soft light pool
    for (var i = 1; i < tr.length; i++) {
      var p0 = tr[i - 1], p1 = tr[i], age = g.t - p1.t, f = Math.max(0, 1 - age / TRAIL_LIFE);
      ctx.strokeStyle = 'rgba(60,150,200,' + (0.055 * f) + ')';
      ctx.lineWidth = TRAIL_LIGHT_R * 1.6 * f + 6;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    // Ribbon: bright (deadly) part is white-cyan, fading part turns deep blue/violet.
    for (i = 1; i < tr.length; i++) {
      p0 = tr[i - 1]; p1 = tr[i]; age = g.t - p1.t; f = Math.max(0, 1 - age / TRAIL_LIFE);
      if (age < BRIGHT_AGE) {
        ctx.strokeStyle = 'rgba(127,246,255,' + (0.45 + 0.15 * Math.sin(g.t * 10)) + ')'; ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        ctx.strokeStyle = 'rgba(235,255,255,0.95)'; ctx.lineWidth = 3.5;
      } else {
        ctx.strokeStyle = 'rgba(130,110,255,' + (0.18 + 0.55 * f) + ')'; ctx.lineWidth = 4;
      }
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawCoin(c, t) {
    if (c.state !== 'lit') return;
    var k = c.timer / COIN_LIT_TIME;               // 1 -> 0
    var pop = Math.min(1, (COIN_LIT_TIME - c.timer) / 0.15);
    var blink = k < 0.3 ? (Math.sin(t * 30) > 0 ? 1 : 0.45) : 1;
    var r = COIN_R * pop;
    ctx.save();
    ctx.translate(c.x, c.y);
    var glow = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 3.2);
    glow.addColorStop(0, 'rgba(255,210,90,' + 0.45 * blink + ')'); glow.addColorStop(1, 'rgba(255,210,90,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, r * 3.2, 0, 6.283); ctx.fill();
    ctx.globalAlpha = blink;
    var sx = Math.max(0.25, Math.abs(Math.cos(c.spin)));
    ctx.fillStyle = '#ffd25a'; ctx.beginPath(); ctx.ellipse(0, 0, r * sx, r, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.ellipse(0, 0, r * sx * 0.55, r * 0.55, 0, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
    // Countdown ring
    ctx.strokeStyle = k < 0.3 ? 'rgba(255,120,120,0.9)' : 'rgba(255,230,160,0.8)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, r + 7, -Math.PI / 2, -Math.PI / 2 + 6.283 * k); ctx.stroke();
    ctx.restore();
  }

  function drawSnail(g, t) {
    ctx.save();
    if (g.graceUntil && g.t < g.graceUntil) ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(t * 9));
    ctx.translate(g.x, g.y);
    var glow = ctx.createRadialGradient(0, 0, 4, 0, 0, GLOW_R);
    glow.addColorStop(0, 'rgba(127,246,255,0.35)'); glow.addColorStop(1, 'rgba(127,246,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, GLOW_R, 0, 6.283); ctx.fill();
    ctx.rotate(g.a);
    // body (foot)
    ctx.fillStyle = '#bffcff';
    ctx.beginPath(); ctx.ellipse(1, 0, 13, 5.5, 0, 0, 6.283); ctx.fill();
    // eye stalks
    var wob = Math.sin(t * 8) * 0.12;
    ctx.strokeStyle = '#bffcff'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(10, -2); ctx.lineTo(18, -6 + wob * 10); ctx.moveTo(10, 2); ctx.lineTo(18, 6 - wob * 10); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(18, -6 + wob * 10, 2, 0, 6.283); ctx.arc(18, 6 - wob * 10, 2, 0, 6.283); ctx.fill();
    // shell with spiral
    ctx.fillStyle = '#1fb6c9';
    ctx.beginPath(); ctx.arc(-3, 0, 8.5, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (var s = 0; s < 16; s++) { var ang = s * 0.75, rr = 7.5 * (1 - s / 17); var px = -3 + Math.cos(ang) * rr, py = Math.sin(ang) * rr; if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.stroke();
    ctx.restore();
  }

  function drawFx(g) {
    ctx.globalCompositeOperation = 'lighter';
    g.fx.forEach(function (f) {
      var k = Math.max(0, f.life / f.max);
      if (f.kind === 'spark') {
        ctx.fillStyle = f.color; ctx.globalAlpha = k;
        ctx.beginPath(); ctx.arc(f.x, f.y, 2 + 2 * k, 0, 6.283); ctx.fill();
      } else if (f.kind === 'ring') {
        ctx.strokeStyle = 'rgba(255,230,150,' + k + ')'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.x, f.y, COIN_R + (1 - k) * 40, 0, 6.283); ctx.stroke();
      }
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawEdge() {
    // A faint frame so the deadly edge is visible on black.
    ctx.strokeStyle = 'rgba(255,90,130,0.5)'; ctx.lineWidth = 2.5; ctx.setLineDash([10, 8]);
    ctx.strokeRect(EDGE, EDGE, WW - EDGE * 2, WH - EDGE * 2);
    ctx.setLineDash([]);
  }

  // Title backdrop: a demo snail drawing lazy curves.
  var demo = null;
  function demoTick(dt) {
    if (!demo) {
      demo = { x: WW * 0.2, y: WH * 0.8, a: -0.4, t: 0, trail: [], lastDrop: null, coins: [], fx: [] };
    }
    demo.t += dt;
    demo.a += Math.sin(demo.t * 0.7) * 1.9 * dt + 0.6 * dt;
    demo.x += Math.cos(demo.a) * 110 * dt; demo.y += Math.sin(demo.a) * 110 * dt;
    // keep the demo on screen by steering toward the centre when near an edge
    var cx = WW / 2 - demo.x, cy = WH / 2 - demo.y;
    var nx = Math.abs(cx) / (WW / 2), ny = Math.abs(cy) / (WH / 2), want, diff;
    if (nx > 0.8 || ny > 0.8) want = Math.atan2(cy, cx);            // too close to an edge: head inwards
    else if (nx < 0.45 && ny < 0.5) want = Math.atan2(-cy, -cx);     // behind the title card: head outwards
    if (want !== undefined) { diff = Math.atan2(Math.sin(want - demo.a), Math.cos(want - demo.a)); demo.a += Math.sign(diff) * 2.5 * dt; }
    if (!demo.lastDrop || Math.hypot(demo.x - demo.lastDrop.x, demo.y - demo.lastDrop.y) >= 4) {
      demo.lastDrop = { x: demo.x, y: demo.y, t: demo.t }; demo.trail.push(demo.lastDrop);
    }
    while (demo.trail.length && demo.t - demo.trail[0].t > TRAIL_LIFE) demo.trail.shift();
  }

  function render(t) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(DPR * U, 0, 0, DPR * U, 0, 0);
    if (state === 'title' || !game) {
      if (demo) { drawTrail(demo); drawSnail(demo, t); }
      return;
    }
    var g = game;
    drawEdge();
    drawTrail(g);
    g.coins.forEach(function (c) { drawCoin(c, t); });
    if (state !== 'dying' && state !== 'over') drawSnail(g, t);
    drawFx(g);
  }

  // ---- Main loop ----
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    var t = now / 1000;
    if (state === 'title') demoTick(dt);
    else if (state === 'play') update(dt);
    else if (state === 'dying') {
      game.deathT += dt; game.t += dt * 0.5;
      while (game.trail.length && game.t - game.trail[0].t > TRAIL_LIFE) game.trail.shift();
      updateFx(dt);
      if (game.deathT > 0.9) showOver();
    }
    render(t);
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  bestEl.textContent = 'Best ' + best;
  requestAnimationFrame(frame);

  // Read-only hook so automated play tests can see what is happening.
  window.__paintTheDark = {
    get state() { return state; },
    get score() { return game ? game.score : 0; },
    get best() { return best; },
    snapshot: function () {
      if (!game) return null;
      return { grace: game.t < game.graceUntil, x: game.x, y: game.y, a: game.a, ww: WW, wh: WH, t: game.t, why: game.why || null,
        coins: game.coins.map(function (c) { return { x: c.x, y: c.y, state: c.state, timer: c.timer }; }),
        trail: game.trail.map(function (p) { return { x: p.x, y: p.y, age: game.t - p.t }; }) };
    }
  };
})();
