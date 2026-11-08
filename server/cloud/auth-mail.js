// Email for app accounts: a welcome note on sign-up, and a real "forgot password" flow. See docs/OFFICE-CLOUD.md, "Email for accounts".
// Every email goes out through the company's own mail path (engine.mail.send in server/mail.js), so it comes from the company's own address
// and counts against the floor's and the building's daily caps. On top of those, each project has its own small daily allowance.
// A reset link carries a random token; only its SHA-256 is kept, it works once, and it dies after RESET_MINUTES.
// "Forgot password" answers the same whether or not the address has an account, and the email is sent after the answer, so timing can't tell either.
import { createHash, randomBytes } from 'node:crypto';
import { get, run, tx } from '../db.js';
import { CloudError } from './store.js';

export const RESET_MINUTES = 30;
export const APP_MAIL_DAILY = 30;
// [requests, window ms], merged into the cloud's own rates.
export const AUTH_MAIL_RATES = { forgotIp: [5, 3600000], forgotProject: [60, 3600000], forgotAccount: [3, 3600000], resetIp: [20, 3600000], resetProject: [200, 3600000], emailChange: [10, 3600000] };
export const FORGOT_SENT = 'If that address has an account here, a link to choose a new password is on its way. It works for 30 minutes.';
export const MAIL_OFF = 'This site can\'t send email right now, so a reset link can\'t go out. Try again later, or ask the site\'s team for help.';
export const MAIL_FULL = 'This site has sent all the email it can for today. Try again tomorrow.';
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s.]{2,}$/;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

export function createAuthMail({ db, cfg, engine, log, now, limit }) {
  const daily = () => { const n = Number(cfg.appMailDaily); return Number.isFinite(n) && n >= 0 ? n : APP_MAIL_DAILY; };
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const used = (F, p) => get(db, 'SELECT sent FROM cloud_mail_days WHERE floor_id=? AND project=? AND day=?', F, p, day())?.sent || 0;
  /** Takes one of today's places for this project, or says no. Given back if the email never left. */
  const take = (F, p) => tx(db, () => {
    if (used(F, p) >= daily()) return false;
    run(db, 'INSERT INTO cloud_mail_days (floor_id,project,day,sent) VALUES (?,?,?,1) ON CONFLICT(floor_id,project,day) DO UPDATE SET sent=sent+1', F, p, day());
    return true;
  });
  const giveBack = (F, p) => run(db, 'UPDATE cloud_mail_days SET sent=MAX(0,sent-1) WHERE floor_id=? AND project=? AND day=?', F, p, day());
  /** Whether this project can send an email at all right now: the building's email is on, nothing is paused, and today's allowance isn't spent. */
  function status(f, p) {
    if (!engine.mail?.ready?.()) return { available: false, reason: 'off' };
    if (used(f.id, p) >= daily()) return { available: false, reason: 'full' };
    return { available: true };
  }

  /** One email to one person, through the company's normal path. Never throws: the answer is {sent, why}. */
  async function deliver(f, p, to, subject, text, hidden) {
    if (!engine.mail?.ready?.()) return { sent: false, why: 'off' };
    if (!take(f.id, p)) return { sent: false, why: 'full' };
    try {
      const r = await engine.mail.send(f, { to: [to], subject, text, ...(hidden ? { secretText: hidden } : {}), by: 'app' });
      if (r.status !== 'sent' && r.status !== 'queued' && r.status !== 'sending') { giveBack(f.id, p); return { sent: false, why: r.note || r.status }; }
      return { sent: true };
    } catch (e) {
      giveBack(f.id, p);
      log('warn', 'app_mail', { floorId: f.id, project: p, err: String(e?.message || e).slice(0, 160) });
      return { sent: false, why: e?.code || 'failed' };
    }
  }
  const siteName = (pr) => String(pr.title || pr.slug).slice(0, 80);

  /** After sign-up with an email: a short welcome. Never holds up or fails the sign-up. */
  function welcome(f, pr, user, origin) {
    if (!user.email) return { welcome: 'none' };
    const st = status(f, pr.slug);
    if (!st.available) return { welcome: st.reason };
    const name = siteName(pr);
    const text = `Hi ${user.name},\n\nWelcome to ${name}. Your account is ready${user.username ? ` (username: ${user.username})` : ''}.\n\nSign in any time at ${origin}/\n\nIf you didn't make this account, ignore this email.`;
    deliver(f, pr.slug, user.email, `Welcome to ${name}`, text).catch(() => {});
    return { welcome: 'sending' };
  }

  /** The "forgot password" request. The answer never depends on whether the address has an account. */
  function forgot(f, pr, { ip, email, origin }) {
    const F = f.id, p = pr.slug, pk = `${F}:${p}`;
    limit('forgotIp', `${pk}:${ip}`, 'Too many reset requests. Try again in an hour.'); limit('forgotProject', pk, 'Too many reset requests on this site. Try again in an hour.');
    const e = String(email ?? '').trim().toLowerCase();
    if (!e || e.length > 254 || !EMAIL.test(e)) throw new CloudError(400, 'bad_email', 'Give the email address on your account.');
    const st = status(f, p);
    if (!st.available) return { ok: false, emailAvailable: false, message: st.reason === 'full' ? MAIL_FULL : MAIL_OFF };
    const user = get(db, 'SELECT * FROM cloud_users WHERE floor_id=? AND project=? AND email=?', F, p, e);
    // Per account too, quietly: a crowd of addresses can't fill one person's inbox, and the answer stays the same.
    let ok = !!user;
    if (user) { try { limit('forgotAccount', `${pk}:${user.uid}`); } catch { ok = false; } }
    if (ok) {
      const token = randomBytes(32).toString('base64url');
      const t = now();
      tx(db, () => {
        // Only the newest link works.
        run(db, 'DELETE FROM cloud_resets WHERE user_id=?', user.id);
        run(db, 'INSERT INTO cloud_resets (hash,user_id,floor_id,project,created_at,expires_at) VALUES (?,?,?,?,?,?)', sha(token), user.id, F, p, t, t + RESET_MINUTES * 60000);
      });
      const name = siteName(pr);
      const link = `${origin}/_office/reset#t=${token}`;
      const body = (l) => `Hi ${user.name},\n\nTo choose a new password for ${name}, open this link within ${RESET_MINUTES} minutes. It works once.\n\n${l}\n\nIf you didn't ask for this, ignore this email.`;
      // The copy kept in the company's mail shows no working link, so nobody reading the outbox can use it.
      setImmediate(() => deliver(f, p, user.email, `Reset your ${name} password`, body('[link left out of this copy]'), body(link)).catch(() => {}));
    }
    return { ok: true, emailAvailable: true, message: FORGOT_SENT };
  }

  /** Sets a new password from a reset link. The token is spent in the same step that checks it, so it works once. */
  async function reset(f, pr, { ip, token, password, hashPassword, store }) {
    const F = f.id, p = pr.slug, pk = `${F}:${p}`;
    limit('resetIp', `${pk}:${ip}`); limit('resetProject', pk);
    const bad = () => new CloudError(400, 'bad_token', 'That reset link has expired or was already used. Ask for a new one.');
    if (typeof token !== 'string' || !TOKEN.test(token)) throw bad();
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 512) throw new CloudError(400, 'bad_password', 'A password is at least 8 characters.');
    const h = sha(token);
    const row = get(db, 'SELECT * FROM cloud_resets WHERE hash=? AND floor_id=? AND project=? AND used_at IS NULL AND expires_at>?', h, F, p, now());
    if (!row) throw bad();
    const hash = await hashPassword(password);
    const user = tx(db, () => {
      if (!run(db, 'UPDATE cloud_resets SET used_at=? WHERE hash=? AND used_at IS NULL AND expires_at>?', now(), h, now()).changes) return null;
      const u = get(db, 'SELECT * FROM cloud_users WHERE id=? AND floor_id=? AND project=?', row.user_id, F, p);
      if (!u) return null;
      run(db, 'UPDATE cloud_users SET hash=? WHERE id=?', hash, u.id);
      // Everyone holding the old password's sessions is signed out, and any other link dies too.
      run(db, 'DELETE FROM cloud_sessions WHERE user_id=?', u.id);
      run(db, 'DELETE FROM cloud_resets WHERE user_id=? AND hash!=?', u.id, h);
      return u;
    });
    if (!user) throw bad();
    return { user: store.publicUser(user, true), session: store.users.startSession(user) };
  }

  /** Adds or changes the email on a signed-in account (an older account may have none). Needs the password, so a stolen session can't redirect resets. */
  function setEmail(user, email) {
    const e = email === null || email === '' ? null : String(email ?? '').trim().toLowerCase();
    if (e !== null && (e.length > 254 || !EMAIL.test(e))) throw new CloudError(400, 'bad_email', 'That email address does not look right.');
    if (e === null && !user.username) throw new CloudError(400, 'need_login', 'This account signs in with its email, so it has to keep one.');
    if (e && get(db, 'SELECT 1 x FROM cloud_users WHERE floor_id=? AND project=? AND email=? AND id!=?', user.floor_id, user.project, e, user.id)) throw new CloudError(409, 'email_taken', 'That email address already has an account.');
    tx(db, () => { run(db, 'UPDATE cloud_users SET email=? WHERE id=?', e, user.id); run(db, 'DELETE FROM cloud_resets WHERE user_id=?', user.id); });
    return get(db, 'SELECT * FROM cloud_users WHERE id=?', user.id);
  }

  const sweep = () => { run(db, 'DELETE FROM cloud_resets WHERE expires_at<? OR used_at IS NOT NULL', now() - 86400000); run(db, 'DELETE FROM cloud_mail_days WHERE day<?', new Date(now() - 3 * 86400000).toISOString().slice(0, 10)); };
  return { status, welcome, forgot, reset, setEmail, sweep, used, daily };
}

// ---- the reset page, served on every project's own origin at /_office/reset ----
export const RESET_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex">
<title>Choose a new password</title><link rel="stylesheet" href="reset.css"></head>
<body><main class="box">
<h1>Choose a new password</h1>
<form id="f" novalidate>
<label>New password <input id="pw" type="password" autocomplete="new-password" minlength="8" required></label>
<label>Type it again <input id="pw2" type="password" autocomplete="new-password" minlength="8" required></label>
<p id="msg" role="alert"></p>
<button id="go" type="submit">Save new password</button>
</form>
<p><a href="/">Back to the site</a></p>
</main>
<script src="office.js"></script><script src="reset.js"></script></body></html>`;
export const RESET_CSS = `body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f5f6f8;color:#1f2430}
.box{max-width:380px;margin:12vh auto;padding:28px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 16px}label{display:block;margin:0 0 12px}input{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;font:inherit;border:1px solid #c7cbd3;border-radius:8px}
button{padding:10px 16px;font:inherit;border:0;border-radius:8px;background:#2f5bea;color:#fff;cursor:pointer}button:disabled{opacity:.6}
#msg{min-height:1.5em;margin:0 0 12px}#msg.bad{color:#b3261e}#msg.good{color:#1b7f3b}a{color:#2f5bea}
@media (prefers-color-scheme:dark){body{background:#15171c;color:#e7e9ee}.box{background:#1f2229}input{background:#15171c;color:inherit;border-color:#3a3f4a}}`;
export const RESET_JS = `(function () {
  'use strict';
  var m = /[#&]t=([A-Za-z0-9_-]{40,60})/.exec(location.hash);
  var token = m ? m[1] : '';
  // The link's secret leaves the address bar at once.
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* fine */ }
  var msg = document.getElementById('msg'), go = document.getElementById('go'), form = document.getElementById('f');
  function say(t, cls) { msg.textContent = t; msg.className = cls || ''; }
  if (!token) { say('This link is not complete. Ask for a new one from the sign-in page.', 'bad'); go.disabled = true; }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var a = document.getElementById('pw').value, b = document.getElementById('pw2').value;
    if (a.length < 8) return say('Use at least 8 characters.', 'bad');
    if (a !== b) return say('The two passwords are not the same.', 'bad');
    go.disabled = true; say('Saving...');
    Office.connect().auth.resetPassword(token, a).then(function () {
      say('Done. Your password is changed and you are signed in. Taking you back...', 'good');
      setTimeout(function () { location.href = '/'; }, 1500);
    }, function (x) { go.disabled = false; say((x && x.message) || 'That did not work. Try again.', 'bad'); });
  });
})();`;
