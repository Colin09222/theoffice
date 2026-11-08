// Scheduled job: scrape a page and keep the result on /data.
const fs = require('fs');
require('./browser').scrape(process.argv[2] || 'https://example.com').then((r) => {
  fs.writeFileSync(`${process.env.OFFICE_DATA_DIR || '/data'}/last-scrape.json`, JSON.stringify({ ...r, at: new Date().toISOString() }));
  console.log('scraped', JSON.stringify(r));
}, (e) => { console.error('scrape failed:', e.message); process.exit(1); });
