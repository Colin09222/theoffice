// Account email in real Chrome on the App starter, against a mock Resend: sign up with an email (a welcome goes out), "Forgot password?",
// the link from the email opens the built-in reset page on the project's own origin, the new password works and the old one doesn't.
// Run: AI_MODE=mock node test/browser/signup-mail.mjs
import { launch } from './cdp.mjs';
import { get } from '../../server/db.js';
import { writeFile, publishSnapshot } from '../../server/workspace.js';
import { appLabel } from '../../server/apps.js';
import { boot, claim, until } from '../helpers.js';
import { starterFiles } from '../../server/makers.js';
import { startMockResend } from '../../server/mail-mock.js';

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };

const mock = await startMockResend();
const t = await boot({ appsBaseDomain: 'apps.localhost:1', appsScheme: 'http', resendApiKey: mock.apiKey, resendWebhookSecret: mock.webhookSecret, resendApiBase: mock.base, mailTickMs: 30 }, {});
t.app.engine.runManager = async () => {};
t.cfg.appsBaseDomain = `apps.localhost:${t.port}`;
const main = `http://localhost:${t.port}`;
t.cfg.publicOrigin = main; t.base = `${main}/theoffice`; t.host = `localhost:${t.port}`;
const c = await claim(t, 'Paper Co');
const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
for (const f of starterFiles('app')) writeFile(t.db, floor.id, `projects/notes/${f.path}`, f.data.replaceAll('{{TITLE}}', 'Pocket Notes').replaceAll('{{PITCH}}', 'Notes that stay with you.'), null, 1e8);
publishSnapshot(t.db, floor.id, 'notes', 1e8);
t.app.engine.upsertProject(floor, 'notes', { title: 'Pocket Notes', kind: 'game', published: true });
const app = `http://${appLabel(t.db, floor, 'notes')}.apps.localhost:${t.port}`;
const sentTo = (to) => mock.state.sent.filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(to));

const b = await launch();
try {
  const p = await b.newPage({ width: 420, height: 800 });
  await p.goto(`${app}/#/signup`);
  await p.until('!!document.querySelector(\'[data-office="email"]\') && !document.querySelector(\'[data-view="auth"]\').hidden', 'the sign-up form');
  check('the sign-up form has an optional email field', await p.ev('document.querySelector(\'[data-office="email"]\').type === "email" && !document.querySelector(\'[data-office="email"]\').required'));
  await p.type('[data-office="username"]', 'sam');
  await p.type('[data-office="email"]', 'sam@example.com');
  await p.type('[data-office="password"]', 'correct horse');
  await p.click('[data-office="auth-submit"]');
  await p.until('location.hash === "#/app"', 'signed in after sign-up');
  check('sign-up with an email signs in', true);
  const welcome = await until(() => sentTo('sam@example.com')[0], { what: 'the welcome email' }).catch(() => null);
  check('a welcome email goes out from the company\'s address', !!welcome && /Welcome to Pocket Notes/.test(welcome.subject) && /Paper Co/.test(welcome.from), welcome?.from);

  await p.click('[data-office="signout"]');
  await p.until('location.hash === "#/"', 'signed out');
  await p.goto(`${app}/#/signin`);
  await p.until('!document.querySelector(\'[data-office="forgot-link"]\').closest("[data-only]").hidden', 'the forgot link');
  check('sign-in shows "Forgot password?"', /Forgot password\?/.test(await p.ev('document.querySelector(\'[data-office="forgot-link"]\').textContent')));
  await p.click('[data-office="forgot-link"]');
  await p.until('!document.querySelector(\'[data-view="forgot"]\').hidden', 'the forgot form');
  await p.type('[data-office="forgot-email"]', 'sam@example.com');
  await p.click('[data-office="forgot-submit"]');
  await p.until('/If that address has an account/.test(document.querySelector(\'[data-office="forgot-status"]\').textContent)', 'the forgot answer');
  check('forgot password gives the same plain answer', true);
  const mail = await until(() => sentTo('sam@example.com').find((m) => /reset#t=/.test(m.text)), { what: 'the reset email' }).catch(() => null);
  const link = mail && /(http\S+\/_office\/reset#t=[A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
  check('the reset link is on the project\'s own origin', !!link && link.startsWith(`${app}/_office/reset#t=`), link?.slice(0, 80));

  await p.goto(link);
  await p.until('!!document.querySelector("#pw")', 'the reset page');
  check('the reset page takes the token out of the address bar', (await p.ev('location.hash')) === '');
  await p.type('#pw', 'battery staple');
  await p.type('#pw2', 'battery staple');
  await p.click('#go');
  await p.until('/password is changed/.test(document.querySelector("#msg").textContent)', 'the reset to finish');
  check('the reset page sets the new password', true);
  await p.until('location.pathname === "/"', 'back on the site', 10000);
  await p.until('location.hash === "#/app" || !!JSON.parse(localStorage.getItem("office.user") || "null")', 'signed in');
  check('the reset signs the person in on the app', await p.ev('!!JSON.parse(localStorage.getItem("office.user") || "null")'));

  // The link works once, and the old password is gone.
  const again = await p.ev(`fetch("/_office/cloud/auth/reset",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:${JSON.stringify(link.split('#t=')[1])},password:"third one!"})}).then(r=>r.status)`);
  check('the link works only once', again === 400, String(again));
  await p.ev('Office.connect().auth.logOut()');
  const old = await p.ev('Office.connect().auth.logIn({login:"sam",password:"correct horse"}).then(()=>"in",e=>e.code)');
  check('the old password no longer works', old === 'bad_login', old);
  const now = await p.ev('Office.connect().auth.logIn({login:"sam@example.com",password:"battery staple"}).then(()=>"in",e=>e.code)');
  check('the new password works, with the email as the login', now === 'in', now);
  // A browser's own favicon guess, and the refused second reset and old password above, are expected; nothing else is.
  const errs = p.errors.filter((e) => !/favicon\.ico|status of 40[01]/.test(e));
  check('no errors on the page', errs.length === 0, errs.join(' | ').slice(0, 200));
} catch (e) {
  failures++; console.log(`FAIL ${e.stack || e}`);
} finally {
  b.close(); await t.close(); await mock.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
