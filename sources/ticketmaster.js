// Ticketmaster Discovery API. Free key from developer.ticketmaster.com.
// This also covers venues whose widgets are Ticketmaster-powered (e.g. Birdland,
// Mercury Lounge, Terminal 5, Brooklyn Bowl, Radio City).
const { getJson } = require('../lib/http');
const { makeEvent, mapGenre, todayNY } = require('../lib/normalize');

const MAX_PAGES = 5; // 200 events per page

function toEvent(ev) {
  const venue = ev._embedded?.venues?.[0]?.name || '';
  const cls = ev.classifications?.[0] || {};
  const range = ev.priceRanges?.[0];
  return makeEvent({
    title: ev.name,
    artist: ev._embedded?.attractions?.[0]?.name || ev.name,
    date: ev.dates?.start?.localDate || '',
    time: (ev.dates?.start?.localTime || '').slice(0, 5),
    venue,
    genre: mapGenre(cls.genre?.name, cls.segment?.name, ev.name),
    price: range ? `$${Math.floor(range.min)}-$${Math.ceil(range.max)}` : '',
    url: ev.url || '',
    source: 'Ticketmaster',
    status: ev.dates?.status?.code || 'onsale',
  });
}

async function scrapeTicketmaster({ apiKey, days = 90 } = {}) {
  if (!apiKey) {
    console.warn('[Ticketmaster] TICKETMASTER_API_KEY not set, skipping');
    return [];
  }
  const start = new Date();
  const end = new Date(Date.now() + days * 864e5);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const events = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      apikey: apiKey, city: 'New York', stateCode: 'NY', countryCode: 'US',
      size: '200', page: String(page), sort: 'date,asc',
      startDateTime: iso(start), endDateTime: iso(end),
      classificationName: 'music,arts & theatre',
    });
    const data = await getJson(`https://app.ticketmaster.com/discovery/v2/events.json?${qs}`);
    const batch = data._embedded?.events || [];
    events.push(...batch.map(toEvent));
    const totalPages = data.page?.totalPages ?? 1;
    if (page + 1 >= totalPages || batch.length === 0) break;
  }
  return events;
}

module.exports = { scrapeTicketmaster, toEvent, todayNY };
