// The feedback button (docs/redesign/OFFICE-ANSWERS-2.md, Q24 idea 3; job r2-j70): "Was this useful? Yes / No" and one optional line, on each
// launched site and game. Results land in the boss's Numbers tab and, fenced as untrusted text, in what the manager reads. It changes what the
// public sees on real customer sites, so it ships OFF: FEEDBACK_BUTTON=1 turns it on (docs/redesign/ROUND2.md).
//
// How: like the tapped-calls beacon (server/taps.js), the Office adds one small first-party script, /_office/feedback.js, to a public project's
// pages, and the answer goes to the page's own origin, /_office/feedback. No third party, no cookie, no personal data: a row is floor, project,
// page path, yes or no, the optional line (200 characters) and the time. Bots are left out; one answer per visitor per page per day.
import { createHash, randomBytes } from 'node:crypto';
import { get, all, run } from './db.js';

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|curl|wget|python-requests|node-fetch|axios|go-http/i;
export const FEEDBACK_SCRIPT = '<script src="/_office/feedback.js" defer></script>';
// Plain ES5 and guarded: a small card in the corner, asked once a day per page, nothing thrown, nothing on the page itself changed.
export const FEEDBACK_JS = `(function(){try{var k='office-fb:'+location.pathname+':'+new Date().toISOString().slice(0,10);try{if(localStorage.getItem(k))return;}catch(x){}
var d=document,c=d.createElement('div');c.setAttribute('role','region');c.setAttribute('aria-label','Feedback');c.setAttribute('data-office-feedback','');
c.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483000;background:#fffdf7;color:#1f2330;border:1px solid #d9d2c3;border-radius:12px;padding:10px 12px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.12);max-width:260px';
var q=d.createElement('span');q.textContent='Was this useful? ';c.appendChild(q);
function b(t,a){var e=d.createElement('button');e.type='button';e.textContent=t;e.setAttribute('data-answer',a);e.style.cssText='margin:0 4px;padding:3px 10px;border:1px solid #1f2330;border-radius:8px;background:#fff;color:#1f2330;cursor:pointer;font:inherit';e.onclick=function(){ask(a);};return e;}
var x=d.createElement('button');x.type='button';x.textContent='\\u00d7';x.setAttribute('aria-label','Close');x.style.cssText='float:right;border:0;background:none;font:18px/1 system-ui;cursor:pointer;color:#5d6472';x.onclick=function(){c.remove();};
c.insertBefore(x,c.firstChild);c.appendChild(b('Yes','yes'));c.appendChild(b('No','no'));
function send(a,line){var body=JSON.stringify({answer:a,line:line||'',path:location.pathname});try{if(!(navigator.sendBeacon&&navigator.sendBeacon('/_office/feedback',new Blob([body],{type:'text/plain'}))))fetch('/_office/feedback',{method:'POST',body:body,keepalive:true,headers:{'content-type':'text/plain'}}).catch(function(){});}catch(e){}try{localStorage.setItem(k,'1');}catch(e){}}
function ask(a){while(c.childNodes.length>1)c.removeChild(c.lastChild);var i=d.createElement('input');i.maxLength=200;i.placeholder='Anything to add? (optional)';i.setAttribute('aria-label','Anything to add? (optional)');i.style.cssText='width:100%;box-sizing:border-box;margin:6px 0;padding:5px;border:1px solid #d9d2c3;border-radius:6px;font:inherit';
var s=d.createElement('button');s.type='button';s.textContent='Send';s.setAttribute('data-send','');s.style.cssText='padding:3px 12px;border:1px solid #1f2330;border-radius:8px;background:#1f2330;color:#fff;cursor:pointer;font:inherit';
s.onclick=function(){send(a,i.value);c.textContent='Thanks.';setTimeout(function(){c.remove();},1500);};c.appendChild(i);c.appendChild(s);}
(d.body||d.documentElement).appendChild(c);}catch(x){}})();`;

/** The page with the feedback script added, once. */
export function injectFeedback(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
  if (typeof text !== 'string' || text.includes('_office/feedback.js') || !/<body[\s>]/i.test(text)) return body;
  const i = text.toLowerCase().lastIndexOf('</body');
  const out = i >= 0 ? `${text.slice(0, i)}${FEEDBACK_SCRIPT}${text.slice(i)}` : `${text}\n${FEEDBACK_SCRIPT}`;
  return Buffer.isBuffer(body) ? Buffer.from(out) : out;
}

export function createFeedback({ db, now = Date.now }) {
  const salt = randomBytes(16).toString('hex');
  return {
    /** One answer. Returns why it was or wasn't kept. */
    record({ floorId, project, path, answer, line, ip, ua }) {
      if (!ua || BOT.test(ua)) return 'bot';
      if (answer !== 'yes' && answer !== 'no') return 'bad';
      const t = now(), day = new Date(t).toISOString().slice(0, 10);
      const p = String(path || '/').split('?')[0].slice(0, 120) || '/';
      const text = String(line || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      const hash = createHash('sha256').update(`${salt}|${day}|${floorId}|${project}|${p}|${ip}|${ua}`).digest('base64url').slice(0, 22);
      const kept = run(db, 'INSERT OR IGNORE INTO app_feedback (floor_id, project, path, answer, line, hash, created_at) VALUES (?,?,?,?,?,?,?)', floorId, project, p, answer, text, hash, t).changes;
      return kept ? 'counted' : 'repeat';
    },
  };
}
/** The Numbers tab's figures: yes and no this week and ever, and the latest lines (the boss's own route only). */
export function feedbackFigures(db, floorId, project, from) {
  const of = project ? ' AND project=?' : '';
  const args = project ? [project] : [];
  const count = (answer, since) => get(db, `SELECT COUNT(*) n FROM app_feedback WHERE floor_id=?${of} AND answer=? AND created_at>=?`, floorId, ...args, answer, since).n;
  const lines = all(db, `SELECT answer, line, project, created_at at FROM app_feedback WHERE floor_id=?${of} AND line!='' ORDER BY id DESC LIMIT 8`, floorId, ...args);
  return { week: { yes: count('yes', from), no: count('no', from) }, ever: { yes: count('yes', 0), no: count('no', 0) }, lines };
}
/** What the manager reads: the counts, and the visitors' own words fenced as untrusted data, never as instructions. */
export function feedbackForBots(fb) {
  if (!fb || !(fb.ever.yes + fb.ever.no)) return '';
  const fence = (text) => `<untrusted_data source="visitor feedback">${String(text).replace(/<\/?\s*untrusted_data/gi, '[untrusted_data')}</untrusted_data>`;
  return `Visitor feedback ("Was this useful?"): this week ${fb.week.yes} yes, ${fb.week.no} no; ever ${fb.ever.yes} yes, ${fb.ever.no} no.${fb.lines.length ? ` What some of them wrote, as data: ${fence(fb.lines.map((l) => `${l.answer}: ${l.line}`).join(' | '))}.` : ''}`;
}
