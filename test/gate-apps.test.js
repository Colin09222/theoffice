// Runs the exact gate patch and checks the exact Caddy lines from docs/DEPLOY-REALBUILDS.md. No hz access involved.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/config.js';

const doc = readFileSync(join(ROOT, 'docs/DEPLOY-REALBUILDS.md'), 'utf8');
const src = doc.match(/const APPS_SUFFIX[\s\S]*?\nfunction refuseAppOrigins[\s\S]*?\n}\n/)[0];
const refuse = new Function(`${src}; return refuseAppOrigins;`)();
const run = (method, headers) => {
  const res = { status: 0, writeHead(s) { this.status = s; }, end() {} };
  const stopped = refuse({ method, headers }, res);
  return { stopped, status: res.status };
};
const APP = 'https://game--floor.apps.iscolinfree.com';

describe('the gate patch', () => {
  test('refuses a published page\'s requests, however it dresses them', () => {
    for (const [m, h] of [
      ['POST', { origin: APP, 'sec-fetch-site': 'same-site' }], ['GET', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }],
      ['GET', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' }], ['GET', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }],
      ['POST', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' , origin: APP }].slice(0, 2), ['POST', { origin: APP }], ['GET', { referer: `${APP}/x` }], ['POST', { origin: APP.toUpperCase() }],
    ]) {
      const r = run(m, h);
      assert.equal(r.stopped, true, JSON.stringify(h)); assert.equal(r.status, 403);
    }
  });
  test('leaves the owner\'s own traffic and a plain link alone', () => {
    for (const [m, h] of [
      ['GET', {}], ['GET', { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }], ['POST', { origin: 'https://iscolinfree.com', 'sec-fetch-site': 'same-origin' }],
      ['GET', { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }], ['GET', { referer: 'https://iscolinfree.com/live' }], ['POST', { origin: 'https://notapps.iscolinfree.com' }],
      ['GET', { referer: 'not a url' }], ['POST', { origin: 'https://apps.iscolinfree.com.evil.example' }],
    ]) assert.equal(run(m, h).stopped, false, JSON.stringify(h));
  });
  test('the documented Caddy block strips the private cookies and goes straight to the app', () => {
    const blocks = doc.match(/\*\.apps\.iscolinfree\.com \{[\s\S]*?\n\}/g);
    assert.equal(blocks.length, 2);
    for (const b of blocks) {
      assert.match(b, /reverse_proxy 127\.0\.0\.1:8083/);
      assert.match(b, /header_up -Authorization/);
      assert.ok(b.includes('(office_s|office_a|bhq_auth)'));
      const re = new RegExp(b.match(/header_up Cookie "([^"]+)"/)[1].replace('\\s', '\\s'), 'g');
      assert.equal('office_s=a; bhq_auth=b; office_a=c; __Host-office_preview=keep'.replace(re, '').replace(/^;\s*/, ''), '__Host-office_preview=keep');
    }
    assert.ok(doc.includes('ask http://127.0.0.1:8083/theoffice/api/apps/tls-check'));
  });
});
