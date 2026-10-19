// NYC venue directory from Ohmyrockness (public JSON, 10 venues per page).
// Used by the Ohmyrockness source and by scripts/scan-venues.js.
const { getJson } = require('./http');

const MAX_DIRECTORY_PAGES = 200;

// The directory lists city subdomains (e.g. losangeles.ohmyrockness.com). NYC pages live on www.
function toMainSitePath(u) {
  if (!u) return '';
  try {
    return `https://www.ohmyrockness.com${new URL(u).pathname}`;
  } catch {
    return '';
  }
}

// NYC ZIPs: Manhattan 100-102, Bronx 104, Brooklyn 112, Queens 111/113/114/116, Staten Island 103
const NYC_ZIP = /NY\s+(10[0-4]|11[1-6]|112)\d{2}/;

const fs = require('fs');
const path = require('path');
const { sleep } = require('./http');

const CACHE_FILE = path.join(__dirname, '..', '.cache', 'nyc-venues.json');
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// The directory is 200 small pages, so cache it for a day instead of re-walking it each run.
async function loadNycVenues({ force = false } = {}) {
  if (!force && fs.existsSync(CACHE_FILE) && Date.now() - fs.statSync(CACHE_FILE).mtimeMs < CACHE_MAX_AGE_MS) {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
  const venues = await fetchNycVenues();
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(venues));
  return venues;
}

async function fetchNycVenues() {
  const seen = new Map();
  for (let page = 1; page <= MAX_DIRECTORY_PAGES; page++) {
    const batch = await getJson(`https://www.ohmyrockness.com/venues.json?region_id=1&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const v of batch) seen.set(v.id, v);
    await sleep(150); // be polite: the directory is paged
  }
  return [...seen.values()]
    .filter((v) => NYC_ZIP.test(v.full_address || ''))
    .map((v) => ({
      id: v.id,
      name: (v.name || '').trim(),
      url: toMainSitePath(v.url),
      website: v.website || '',
      address: (v.full_address || '').replace(/\s+/g, ' ').trim(),
      showsCount: v.shows_count || 0,
    }));
}

module.exports = { loadNycVenues, NYC_ZIP };
