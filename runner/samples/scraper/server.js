// office-runner sample scraper: GET /scrape?url=https://... renders the page in headless Chromium.
const http = require('http');
const fs = require('fs');
const { scrape } = require('./browser');
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (u.pathname === '/scrape') {
    try { res.end(JSON.stringify(await scrape(u.searchParams.get('url') || 'https://example.com'))); }
    catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message.split('\n')[0] })); }
    return;
  }
  let last = null;
  try { last = JSON.parse(fs.readFileSync(`${process.env.OFFICE_DATA_DIR || '/data'}/last-scrape.json`, 'utf8')); } catch {}
  res.end(JSON.stringify({ app: process.env.OFFICE_APP, lastScheduledScrape: last }));
}).listen(Number(process.env.PORT || 8080), () => console.log('scraper listening'));
