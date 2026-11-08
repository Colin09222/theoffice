#!/opt/office-runner/bin/node
// Deploys a local folder as an app through the control API (operator tool; Phase 2 sends the same
// request from the Office). Usage: deploy-dir.mjs <label> <folder> [standard|browser]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const [label, dir, tier] = process.argv.slice(2);
if (!label || !dir) {
  console.error('usage: deploy-dir.mjs <label> <folder> [standard|browser]');
  process.exit(2);
}
const files = [];
(function walk(rel) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name)) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(p);
    else if (e.isFile()) files.push({ path: p, data: fs.readFileSync(path.join(dir, p)).toString('base64') });
  }
})('');
const token = fs.readFileSync(process.env.RUNNER_TOKEN_FILE ?? '/opt/office-runner/secrets/api.token', 'utf8').trim();
const body = Buffer.from(JSON.stringify({ files, wait: true, ...(tier ? { tier } : {}) }));
const req = http.request({ host: '127.0.0.1', port: 8092, method: 'POST', path: `/v1/apps/${label}/deploy`, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': body.length } }, (res) => {
  let t = '';
  res.on('data', (c) => (t += c));
  res.on('end', () => {
    console.log(res.statusCode, t.slice(0, 2000));
    process.exit(res.statusCode < 300 ? 0 : 1);
  });
});
req.end(body);
