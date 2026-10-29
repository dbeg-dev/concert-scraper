// NYC concert aggregator. Runs every source independently (one failing site
// never stops the others), dedupes, and writes the result to Google Sheets and
// concerts.json.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { clean, dedupe } = require('./lib/normalize');
const { scrapeDice } = require('./sources/dice');
const { scrapeTicketmaster } = require('./sources/ticketmaster');
const { scrapeMercury } = require('./sources/mercury');
const { scrapeSmalls } = require('./sources/smalls');
const { scrapeLincolnCenter } = require('./sources/lincoln-center');
const { scrapeOhmyrockness } = require('./sources/ohmyrockness');
const { scrapeVillageVanguard } = require('./sources/village-vanguard');

const SOURCES = [
  ['Ohmyrockness', () => scrapeOhmyrockness()],
  ['Village Vanguard', () => scrapeVillageVanguard()],
  ['Dice', () => scrapeDice()],
  ['Ticketmaster', () => scrapeTicketmaster({ apiKey: process.env.TICKETMASTER_API_KEY })],
  ['Mercury Lounge', () => scrapeMercury()],
  ['SmallsLIVE', () => scrapeSmalls()],
  ['Lincoln Center', () => scrapeLincolnCenter()],
  // Not yet parseable without a browser: Blue Note (JS calendar). Carnegie Hall and
  // Met Opera return 403 from server IPs. AXS venues also return 403.
];

const HEADERS = ['Title', 'Artist', 'Date', 'Time', 'Venue', 'Genre', 'Price', 'URL', 'Source', 'Status', 'ScrapedAt'];

async function runSources() {
  const results = {};
  const all = [];
  for (const [name, fn] of SOURCES) {
    try {
      const events = clean(await fn());
      results[name] = events.length;
      all.push(...events);
      console.log(`[${name}] ${events.length} upcoming events`);
    } catch (e) {
      results[name] = `ERROR: ${e.message}`;
      console.error(`[${name}] failed: ${e.message}`);
    }
  }
  const unique = dedupe(all).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return { unique, results };
}

async function writeSheet(events) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const credPath = process.env.GOOGLE_CREDENTIALS || './credentials.json';
  if (!sheetId) return console.log('Sheets: GOOGLE_SHEET_ID not set, skipping');
  if (!fs.existsSync(credPath)) return console.log(`Sheets: ${credPath} not found, skipping`);

  const auth = new google.auth.GoogleAuth({ keyFile: credPath, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const rows = events.map((e) => [e.title, e.artist, e.date, e.time, e.venue, e.genre, e.price, e.url, e.source, e.status, e.scrapedAt]);

  await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: 'Sheet1!A1:K2000' });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS, ...rows] },
  });
  console.log(`Sheets: wrote ${rows.length} rows`);
}

async function main() {
  console.log(`NYC concert scrape ${new Date().toISOString()}`);
  const { unique, results } = await runSources();
  console.log(`Unique upcoming events after dedupe: ${unique.length}`);
  fs.writeFileSync(path.join(__dirname, 'concerts.json'), JSON.stringify({ updatedAt: new Date().toISOString(), sources: results, events: unique }, null, 2));
  console.log('Saved concerts.json');
  await writeSheet(unique);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}

module.exports = { main, runSources };
