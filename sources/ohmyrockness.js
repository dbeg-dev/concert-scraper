// Ohmyrockness (indie and rock). Public pages only expose the site's featured
// shows (a handful at a time). Per-venue listings load from a token-gated API,
// so they aren't pulled. One request covers the featured list.
//
// Cloudflare blocks the site from GitHub Actions IPs (HTTP 403). When the direct
// fetch fails, this falls back to the "OMR Cache" tab in the Google Sheet, which
// a small Apps Script attached to the sheet refreshes every morning from Google's
// servers (see apps-script/ohmyrockness-cache.gs).
const fs = require('fs');
const cheerio = require('cheerio');
const { getText } = require('../lib/http');
const { makeEvent, mapGenre } = require('../lib/normalize');

const SHOWS_URL = 'https://www.ohmyrockness.com/shows';
const CACHE_RANGE = 'OMR Cache!A1:B1';
const CACHE_MAX_AGE_DAYS = 3;

// Ticket links on the site often go through affiliate redirects (evyy.net,
// pxf.io). Unwrap to the direct ticket page, which is what the buyer should land on.
function cleanTicketUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u);
    const inner = url.searchParams.get('u');
    if (inner && /(^|\.)(evyy\.net|pxf\.io)$/.test(url.hostname)) return inner;
    return u;
  } catch {
    return u;
  }
}

// The site is rock and indie first, so unclassified bills default to Rock.
function genreFor(bands) {
  const g = mapGenre(bands.join(' '));
  return g === 'Other' ? 'Rock' : g;
}

// Placeholder venue names like "[untitled]" mean the site hasn't announced one.
function venueName(v) {
  const name = (v && v.name) || '';
  return /^\[.*\]$/.test(name.trim()) ? '' : name;
}

function mapShows(shows) {
  const seen = new Map();
  for (const s of shows) if (s && s.id != null) seen.set(s.id, s);
  return [...seen.values()].map((s) => {
    const bands = (s.cached_bands || []).map((b) => b.name).filter(Boolean);
    const starts = s.starts_at || '';            // local New York time with offset
    return makeEvent({
      title: bands.join(', ') || 'Live music',
      artist: bands[0] || '',
      date: starts.slice(0, 10),
      time: starts.slice(11, 16),
      venue: venueName(s.venue),
      genre: genreFor(bands),
      price: s.price_abbr || '',
      url: cleanTicketUrl(s.tickets_url) || s.url || '',
      source: 'Ohmyrockness',
      status: s.sold_out ? 'sold-out' : 'onsale',
    });
  });
}

function parseOhmyrocknessShows(html) {
  const $ = cheerio.load(html);
  const shows = [];
  $('[data-shows]').each((_, el) => {
    try { shows.push(...JSON.parse($(el).attr('data-shows'))); } catch { /* skip malformed block */ }
  });
  return mapShows(shows);
}

// Reads the shows the Apps Script saved to the sheet. Cell A1 holds the shows as
// JSON, B1 the time they were fetched.
async function readCache() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const credPath = process.env.GOOGLE_CREDENTIALS || './credentials.json';
  if (!sheetId || !fs.existsSync(credPath)) throw new Error('no sheet credentials for cache fallback');
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({ keyFile: credPath, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: CACHE_RANGE });
  const [json, fetchedAt] = (res.data.values && res.data.values[0]) || [];
  if (!json) throw new Error('OMR Cache tab is empty');
  const ageDays = (Date.now() - new Date(fetchedAt).getTime()) / 86400000;
  if (!(ageDays <= CACHE_MAX_AGE_DAYS)) throw new Error(`OMR Cache is stale (fetched ${fetchedAt})`);
  return mapShows(JSON.parse(json));
}

async function scrapeOhmyrockness() {
  try {
    return parseOhmyrocknessShows(await getText(SHOWS_URL));
  } catch (e) {
    console.log(`[Ohmyrockness] direct fetch failed (${e.message}); using sheet cache`);
    return readCache();
  }
}

module.exports = { scrapeOhmyrockness, parseOhmyrocknessShows, mapShows, cleanTicketUrl };
