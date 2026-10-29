// Mercury Lounge calendar. The page server-renders a Ticketmaster widget, so
// this works without an API key. Overlaps with the Ticketmaster source; dedupe
// handles that.
const cheerio = require('cheerio');
const { getText } = require('../lib/http');
const { makeEvent, mapGenre, parseMonthDay } = require('../lib/normalize');

const PAGE_URL = 'https://www.mercuryloungenyc.com/calendar-mr';

function parseMercury(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.tw-section').each((_, el) => {
    const link = $(el).find('.tw-name a').first();
    const title = link.text().trim();
    const href = link.attr('href') || '';
    // The image link title reads "... | 14 October 6:00 PM"
    const label = $(el).find('.tw-image a').first().attr('title') || $(el).text();
    const m = label.match(/(\d{1,2} [A-Za-z]+)\s+(\d{1,2}:\d{2}\s?[AP]M)/);
    if (!title || !m) return;
    const soldOut = /SOLD OUT/i.test(label);
    const time24 = to24(m[2]);
    out.push(makeEvent({
      title: title.replace(/\*?SOLD OUT\*?/gi, '').trim(),
      date: parseMonthDay(m[1]) || '',
      time: time24,
      venue: 'Mercury Lounge',
      genre: mapGenre(title),
      url: href,
      source: 'Mercury Lounge',
      status: soldOut ? 'sold-out' : 'onsale',
    }));
  });
  return out;
}

function to24(t) {
  const m = t.match(/(\d{1,2}):(\d{2})\s?([AP]M)/i);
  if (!m) return '';
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

async function scrapeMercury() {
  return parseMercury(await getText(PAGE_URL));
}

module.exports = { scrapeMercury, parseMercury };
