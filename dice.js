// Dice (dice.fm) NYC listings. The browse page is a Next.js app that ships the
// full event list in __NEXT_DATA__, so no browser is needed.
const { getText } = require('../lib/http');
const { makeEvent, mapGenre } = require('../lib/normalize');

const PAGE_URL = 'https://dice.fm/browse/new-york';

function parseDice(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('__NEXT_DATA__ not found (Dice page layout may have changed)');
  const events = JSON.parse(m[1])?.props?.pageProps?.events || [];
  return events.map((ev) => {
    const start = ev.dates?.event_start_date || ''; // already NY local time with offset
    const venue = ev.venues?.[0]?.name || '';
    const price = ev.price?.amount != null ? `$${ev.price.amount}` : ev.price?.amount_from > 0 ? `from $${ev.price.amount_from}` : '';
    return makeEvent({
      title: ev.name,
      date: start.slice(0, 10),
      time: start.slice(11, 16),
      venue,
      genre: mapGenre(ev.name, venue),
      price,
      url: ev.id ? `https://dice.fm/event/${ev.id}` : '',
      source: 'Dice',
      status: ev.status === 'sold-out' ? 'sold-out' : ev.status === 'cancelled' ? 'cancelled' : 'onsale',
    });
  });
}

async function scrapeDice() {
  return parseDice(await getText(PAGE_URL));
}

module.exports = { scrapeDice, parseDice };
