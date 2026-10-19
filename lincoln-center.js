// Lincoln Center "upcoming events" block (server-rendered). Dates omit the year.
const cheerio = require('cheerio');
const { getText } = require('../lib/http');
const { makeEvent, mapGenre, parseMonthDay } = require('../lib/normalize');

const PAGE_URL = 'https://www.lincolncenter.org/calendar';

function parseLincolnCenter(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.upcoming-events-list .event-with-image-and-description').each((_, el) => {
    const dateText = $(el).find('.event-date').text().replace(/\s+/g, ' ').trim(); // "October 14 at 1:00 pm"
    const [dayPart, timePart = ''] = dateText.split(/\s+at\s+/i);
    const title = $(el).find('h2').first().text().replace(/\s+/g, ' ').trim();
    const url = $(el).find('h2 a').first().attr('href') || $(el).find('a').first().attr('href') || '';
    if (!title) return;
    out.push(makeEvent({
      title,
      date: parseMonthDay(dayPart) || '',
      time: parseTime(timePart),
      venue: 'Lincoln Center',
      genre: mapGenre(title, 'classical'),
      url: url.startsWith('http') ? url : url ? `https://www.lincolncenter.org${url}` : '',
      source: 'Lincoln Center',
    }));
  });
  return out;
}

function parseTime(t) {
  const m = t.match(/(\d{1,2}):?(\d{2})?\s*([ap])\.?m/i);
  if (!m) return '';
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
}

async function scrapeLincolnCenter() {
  return parseLincolnCenter(await getText(PAGE_URL));
}

module.exports = { scrapeLincolnCenter, parseLincolnCenter };
