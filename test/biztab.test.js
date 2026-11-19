// The boss's Business tab (docs/redesign, job 22): Numbers, Orders, Payments, Inbox and Launch under one tab, no feature removed. The real
// browser check is test/browser/biztab.mjs; this one reads the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../public/js/floor-ui.js', import.meta.url), 'utf8');
test('one Business tab for the boss, holding the panels that were tabs of their own', () => {
  assert.match(ui, /tabs\.push\(\['biz', unread \? `Business \$\{unread\}` : 'Business'\]\)/);
  assert.match(ui, /\[\.\.\.\(businessActive\(this\) \? \[\['business', 'Journey'\]\] : \[\]\), \['numbers', 'Numbers'\], \['orders', 'Orders'\], \['pay', 'Payments'\], mailTab\(this\), \['launch', 'Launch'\]\]/);
  // The row of tabs no longer lists them one by one.
  assert.doesNotMatch(ui, /tabs\.push\(\['numbers', 'Numbers'\]\)|tabs\.push\(\['orders', 'Orders'\]\)|tabs\.push\(payTab\(this\)\)|tabs\.push\(mailTab\(this\)\)/);
  // Every panel is still drawn when its section is open: nothing removed.
  for (const r of ["this.tab === 'numbers') renderNumbers(this)", "this.tab === 'orders') this.renderOrders()", "this.tab === 'pay') renderPay(this)", "this.tab === 'inbox') renderInbox(this)", "this.tab === 'launch') this.renderLaunch()"]) assert.ok(ui.includes(r), r);
  // A visitor never gets it.
  assert.match(ui, /bizSections\(\) \{\s+if \(!this\.owner\) return \[\];/);
});
