// A scheduled job: office.json runs it on its schedule, and it stays awake only while it runs. Output goes to the job log the boss can read.
import { writeFile } from 'node:fs/promises';
import { office } from '../office-cloud.js';

const DATA = process.env.OFFICE_DATA_DIR || '/data';
try {
  const page = await office.scrape('https://example.com');
  await writeFile(`${DATA}/latest.json`, JSON.stringify({ title: page.title, at: new Date().toISOString() }));
  await office.db.collection('updates').add({ title: page.title, at: Date.now() });
  console.log('refreshed:', page.title);
} catch (e) { console.error('refresh failed:', e.message); process.exit(1); }
