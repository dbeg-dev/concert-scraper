// Ohmyrockness (indie and rock). Public pages only expose the site's featured
// shows (a handful at a time). Per-venue listings load from a token-gated API,
// so they aren't pulled. One request covers the featured list.
const cheerio = require('cheerio');
const { getText } = require('../lib/http');
const { makeEvent, mapGenre } = require('../lib/normalize');

const SHOWS_URL = 'https://www.ohmyrockness.com/shows';

// Ticketmaster links on the site go through an affiliate redirect. Unwrap to the
// direct ticket page, which is what the buyer should land on.
function cleanTicketUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u);
    if (url.hostname.endsWith('evyy.net') && url.searchParams.get('u')) return url.searchParams.get('u');
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

function parseOhmyrocknessShows(html) {
  const $ = cheerio.load(html);
  const seen = new Map();
  $('[data-shows]').each((_, el) => {
    try { for (const s of JSON.parse($(el).attr('data-shows'))) seen.set(s.id, s); } catch { /* skip malformed block */ }
  });
  return [...seen.values()].map((s) => {
    const bands = (s.cached_bands || []).map((b) => b.name).filter(Boolean);
    const starts = s.starts_at || '';            // local New York time with offset
    return makeEvent({
      title: bands.join(', ') || 'Live music',
      artist: bands[0] || '',
      date: starts.slice(0, 10),
      time: starts.slice(11, 16),
      venue: s.venue?.name || '',
      genre: genreFor(bands),
      price: s.price_abbr || '',
      url: cleanTicketUrl(s.tickets_url) || s.url || '',
      source: 'Ohmyrockness',
      status: s.sold_out ? 'sold-out' : 'onsale',
    });
  });
}

async function scrapeOhmyrockness() {
  return parseOhmyrocknessShows(await getText(SHOWS_URL));
}

module.exports = { scrapeOhmyrockness, parseOhmyrocknessShows, cleanTicketUrl };
