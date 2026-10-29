// Village Vanguard (jazz, Greenwich Village). The site is WordPress. Event posts
// are in category 17, and each event page has the run dates in an h3 (no year),
// e.g. "October 20 - October 25". Each run is listed once, starting on its first night.
const cheerio = require('cheerio');
const { getJson, getText, mapLimit } = require('../lib/http');
const { makeEvent, parseMonthDay } = require('../lib/normalize');

const BASE = 'https://villagevanguard.com';
const EVENT_CATEGORY = 17;

function parseVanguardEvent(html, url) {
  const $ = cheerio.load(html);
  const title = $('.event-details h2').first().text().replace(/\s+/g, ' ').trim();
  // The first h3 is an empty tagline, so take the one with a month and day.
  const dateText = $('.event-details h3').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get()
    .find((t) => /[A-Za-z]+\s+\d{1,2}/.test(t)) || ''; // "October 20 - October 25"
  if (!title || !dateText) return null;
  const [startPart, endPart] = dateText.split(/\s*[-–]\s*/);
  const date = parseMonthDay(startPart);
  if (!date) return null;
  const endDate = endPart ? parseMonthDay(endPart, { year: date.slice(0, 4) }) : null;
  const runsThrough = endDate && endDate > date ? endDate : null;
  return makeEvent({
    title: runsThrough ? `${title} (through ${shortDate(runsThrough)})` : title,
    artist: title,
    date,
    venue: 'Village Vanguard',
    genre: 'Jazz',
    url,
    source: 'Village Vanguard',
    status: 'onsale',
  });
}

function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

async function scrapeVillageVanguard() {
  const posts = await getJson(`${BASE}/wp-json/wp/v2/posts?categories=${EVENT_CATEGORY}&per_page=100`);
  const links = posts.map((p) => p.link).filter(Boolean);
  const events = await mapLimit(links, 4, async (url) => {
    try {
      return parseVanguardEvent(await getText(url), url);
    } catch (e) {
      console.warn(`[Village Vanguard] skip ${url}: ${e.message}`);
      return null;
    }
  });
  return events.filter(Boolean);
}

module.exports = { scrapeVillageVanguard, parseVanguardEvent };
