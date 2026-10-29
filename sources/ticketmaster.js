// Ticketmaster Discovery API. Free key from developer.ticketmaster.com.
// This also covers venues whose widgets are Ticketmaster-powered (e.g. Birdland,
// Mercury Lounge, Terminal 5, Brooklyn Bowl, Radio City), plus the Met Opera and
// the NY Phil, which list their performances on Ticketmaster.
//
// Two passes:
//  1. Everything in music, next 90 days. The API stops paging at about 1,000
//     results, so this pass mostly covers the next week or two.
//  2. Classical and opera only, next 12 months, so the season view isn't
//     crowded out by the general pass.
// Broadway, comedy and other theatre are skipped: this is a concert calendar.
const { getJson, sleep } = require('../lib/http');
const { makeEvent, mapGenre, todayNY } = require('../lib/normalize');

const MAX_PAGES = 5; // 200 events per page; the API refuses page*size past 1,000

// Ticketmaster genres that are theatre, not concerts.
const NOT_A_CONCERT = /\b(theat(re|er)|musical|broadway|comedy|magic|circus|ice shows?|family|spectacular|miscellaneous theatre)\b/i;

function classificationText(cls) {
  return [cls.segment?.name, cls.genre?.name, cls.subGenre?.name].filter((s) => s && s !== 'Undefined').join(' ');
}

// Classical and opera come from Ticketmaster's own labels first. The show's name
// is only a fallback, so a band called "... Orchestra" doesn't land in Classical.
function genreFor(ev) {
  const cls = ev.classifications?.[0] || {};
  const labels = [cls.genre?.name, cls.subGenre?.name].filter((s) => s && s !== 'Undefined').join(' ');
  const fromLabels = mapGenre(labels);
  if (fromLabels !== 'Other') return fromLabels;
  return mapGenre(ev.name);
}

function isConcert(ev) {
  const cls = ev.classifications?.[0] || {};
  const labels = [cls.genre?.name, cls.subGenre?.name].filter(Boolean).join(' ');
  if (/opera|classical/i.test(labels)) return true;          // Met Opera, NY Phil
  if (NOT_A_CONCERT.test(labels)) return false;              // Broadway, comedy
  if (cls.segment?.name === 'Arts & Theatre') return false;  // other stage shows
  return true;
}

function toEvent(ev) {
  const venue = ev._embedded?.venues?.[0]?.name || '';
  const range = ev.priceRanges?.[0];
  return makeEvent({
    title: ev.name,
    artist: ev._embedded?.attractions?.[0]?.name || ev.name,
    date: ev.dates?.start?.localDate || '',
    time: (ev.dates?.start?.localTime || '').slice(0, 5),
    venue,
    genre: genreFor(ev),
    price: range ? `$${Math.floor(range.min)}-$${Math.ceil(range.max)}` : '',
    url: ev.url || '',
    source: 'Ticketmaster',
    status: ev.dates?.status?.code || 'onsale',
  });
}

async function fetchPass(apiKey, { days, classificationName }) {
  const start = new Date();
  const end = new Date(Date.now() + days * 864e5);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const raw = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      apikey: apiKey, city: 'New York', stateCode: 'NY', countryCode: 'US',
      size: '200', page: String(page), sort: 'date,asc',
      startDateTime: iso(start), endDateTime: iso(end),
      classificationName,
    });
    const data = await getJson(`https://app.ticketmaster.com/discovery/v2/events.json?${qs}`);
    const batch = data._embedded?.events || [];
    raw.push(...batch);
    const totalPages = data.page?.totalPages ?? 1;
    if (page + 1 >= totalPages || batch.length === 0) break;
    await sleep(250); // stay well under the API's 5 requests/second
  }
  return raw;
}

async function scrapeTicketmaster({ apiKey, days = 90, seasonDays = 365 } = {}) {
  if (!apiKey) {
    console.warn('[Ticketmaster] TICKETMASTER_API_KEY not set, skipping');
    return [];
  }
  const general = await fetchPass(apiKey, { days, classificationName: 'music,arts & theatre' });
  let season = [];
  try {
    season = await fetchPass(apiKey, { days: seasonDays, classificationName: 'classical,opera' });
  } catch (e) {
    console.warn(`[Ticketmaster] classical/opera pass failed: ${e.message}`);
  }
  const seen = new Set();
  const out = [];
  for (const ev of [...general, ...season]) {
    if (!ev || seen.has(ev.id) || !isConcert(ev)) continue;
    seen.add(ev.id);
    out.push(toEvent(ev));
  }
  console.log(`[Ticketmaster] ${general.length} general + ${season.length} classical/opera fetched, ${out.length} concerts kept`);
  return out;
}

module.exports = { scrapeTicketmaster, toEvent, isConcert, genreFor, todayNY };
