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
const { getText, getTextCurl } = require('./lib/http');
const { cleanExhibits, makeExhibit } = require('./lib/exhibit-dates');
const { MUSEUMS } = require('./sources/art/museums');

const SOURCES = [
  ['Ohmyrockness', () => scrapeOhmyrockness()],
  ['Village Vanguard', () => scrapeVillageVanguard()],
  ['Dice', () => scrapeDice()],
  ['Ticketmaster', () => scrapeTicketmaster({ apiKey: process.env.TICKETMASTER_API_KEY })],
  ['Mercury Lounge', () => scrapeMercury()],
  ['SmallsLIVE', () => scrapeSmalls()],
  ['Lincoln Center', () => scrapeLincolnCenter()],
  // Not yet parseable without a browser: Blue Note (JS calendar). Carnegie Hall and
  // the Met Opera site sit behind a Queue-it waiting room (the Met's performances
  // still arrive through Ticketmaster). AXS venues return 403.
];

const ART_HEADERS = ['Title', 'Venue', 'Borough', 'Start', 'End', 'URL', 'Source', 'ScrapedAt'];

// Museum exhibitions. Each museum runs on its own, so one site changing its
// layout never stops the others.
async function runArt() {
  const results = {};
  const all = [];
  for (const [name, url, parse] of MUSEUMS) {
    try {
      const html = await getText(url).catch(() => getTextCurl(url));
      const shows = cleanExhibits(parse(html));
      results[name] = shows.length;
      all.push(...shows);
      console.log(`[Art: ${name}] ${shows.length} exhibitions`);
    } catch (e) {
      results[name] = `ERROR: ${e.message}`;
      console.error(`[Art: ${name}] failed: ${e.message}`);
    }
  }
  // Closing soonest first; open-ended shows last.
  all.sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999') || a.venue.localeCompare(b.venue));
  return { exhibits: all, results };
}

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

// Shows typed into the sheet's "Manual" tab (museums that block scrapers, or
// anything spotted by hand). Columns: Title, Venue, Borough, Start, End, URL, Note.
async function readManualExhibits() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const credPath = process.env.GOOGLE_CREDENTIALS || './credentials.json';
  if (!sheetId || !fs.existsSync(credPath)) return [];
  const auth = new google.auth.GoogleAuth({ keyFile: credPath, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });
  let res;
  try {
    res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Manual!A1:G500' });
  } catch {
    return []; // no Manual tab yet
  }
  const [header = [], ...rows] = res.data.values || [];
  const col = (name) => header.findIndex((h) => String(h).trim().toLowerCase() === name);
  const at = (r, name) => (col(name) >= 0 ? String(r[col(name)] || '').trim() : '');
  const isoOrBlank = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  return rows
    .filter((r) => at(r, 'title') && at(r, 'venue'))
    .map((r) => makeExhibit({
      title: at(r, 'title'), venue: at(r, 'venue'), borough: at(r, 'borough') || 'Manhattan',
      start: isoOrBlank(at(r, 'start')), end: isoOrBlank(at(r, 'end')), url: at(r, 'url'), source: 'Manual',
    }));
}

async function writeArtSheet(exhibits) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const credPath = process.env.GOOGLE_CREDENTIALS || './credentials.json';
  if (!sheetId || !fs.existsSync(credPath)) return;
  const auth = new google.auth.GoogleAuth({ keyFile: credPath, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });
  // Create the Art tab the first time.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === 'Art')) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: [{ addSheet: { properties: { title: 'Art' } } }] } });
  }
  const rows = exhibits.map((e) => [e.title, e.venue, e.borough, e.start, e.end, e.url, e.source, e.scrapedAt]);
  await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: 'Art!A1:H1000' });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId, range: 'Art!A1', valueInputOption: 'RAW',
    requestBody: { values: [ART_HEADERS, ...rows] },
  });
  console.log(`Sheets: wrote ${rows.length} exhibitions to Art`);
}

async function main() {
  console.log(`NYC concert scrape ${new Date().toISOString()}`);
  const { unique, results } = await runSources();
  console.log(`Unique upcoming events after dedupe: ${unique.length}`);
  fs.writeFileSync(path.join(__dirname, 'concerts.json'), JSON.stringify({ updatedAt: new Date().toISOString(), sources: results, events: unique }, null, 2));
  console.log('Saved concerts.json');
  await writeSheet(unique);

  const { exhibits: scraped, results: artResults } = await runArt();
  let manual = [];
  try {
    manual = cleanExhibits(await readManualExhibits());
    console.log(`[Art: Manual tab] ${manual.length} exhibitions`);
  } catch (e) {
    console.error(`[Art: Manual tab] failed: ${e.message}`);
  }
  const exhibits = cleanExhibits([...scraped, ...manual])
    .sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999') || a.venue.localeCompare(b.venue));
  console.log(`Exhibitions on view or coming up: ${exhibits.length}`);
  fs.writeFileSync(path.join(__dirname, 'exhibitions.json'), JSON.stringify({ updatedAt: new Date().toISOString(), sources: artResults, exhibits }, null, 2));
  try {
    await writeArtSheet(exhibits);
  } catch (e) {
    console.error(`Sheets (Art): ${e.message}`);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}

module.exports = { main, runSources, runArt };
