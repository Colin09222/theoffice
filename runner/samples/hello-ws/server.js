// office-runner sample app: HTTP + WebSocket echo, with a counter kept on the /data volume.
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const counterFile = `${process.env.OFFICE_DATA_DIR || '/data'}/visits.txt`;
const server = http.createServer((req, res) => {
  if (req.url === '/health') return res.end('ok\n');
  let visits = 0;
  try { visits = Number(fs.readFileSync(counterFile, 'utf8')) || 0; } catch {}
  fs.writeFileSync(counterFile, String(++visits));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ app: process.env.OFFICE_APP, visits, uptime: process.uptime(), secrets: Object.keys(process.env).filter((k) => k.startsWith('DEMO_')) }));
});
new WebSocketServer({ server, path: '/ws' }).on('connection', (ws) => {
  ws.send('hello from ' + process.env.OFFICE_APP);
  ws.on('message', (m) => ws.send('echo: ' + m));
});
server.listen(Number(process.env.PORT || 8080), () => console.log('hello-ws listening on', process.env.PORT));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
