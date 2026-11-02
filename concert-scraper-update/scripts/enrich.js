// Re-run only the enrichment step against the last scrape (concerts.json),
// without scraping again. Handy for the first backfill: `npm run enrich`.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { runEnrich } = require('../index');

const file = path.join(__dirname, '..', 'concerts.json');
if (!fs.existsSync(file)) {
  console.error('concerts.json not found. Run `npm start` first.');
  process.exit(1);
}
const { events } = JSON.parse(fs.readFileSync(file, 'utf8'));
runEnrich(events).catch((e) => { console.error(e); process.exit(1); });
