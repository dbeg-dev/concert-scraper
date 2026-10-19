// SmallsLIVE (jazz, Greenwich Village). The homepage lists upcoming events as
// /events/<id>-<slug>/ links; each event page carries the full date.
const cheerio = require('cheerio');
const { getText, mapLimit } = require('../lib/http');
const { makeEvent, parseMonthDay } = require('../lib/normalize');

const BASE = 'https://www.smallslive.com';
const MAX_EVENTS = 40;

function parseSmallsDetail(html, url) {
  const $ = cheerio.load(html);
  const pageTitle = $('title').first().text().replace(/\s*-\s*SmallsLIVE\s*$/i, '').trim();
  const desc = $('meta[property="og:description"]').attr('content') || html;
  const dateMatch = desc.match(/(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s+([A-Za-z]+ \d{1,2}, \d{4})/) || html.match(/(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s+([A-Za-z]+ \d{1,2}, \d{4})/);
  const date = dateMatch ? parseMonthDay(dateMatch[1]) : '';
  return makeEvent({
    title: pageTitle,
    venue: 'SmallsLIVE',
    genre: 'Jazz',
    date: date || '',
    url: url,
    source: 'SmallsLIVE',
  });
}

async function scrapeSmalls() {
  const home = await getText(BASE + '/');
  const $ = cheerio.load(home);
  const links = [...new Set(
    $('a[href^="/events/"]').map((_, a) => $(a).attr('href')).get().filter((h) => /^\/events\/\d+-/.test(h))
  )].slice(0, MAX_EVENTS);
  const details = await mapLimit(links, 5, async (href) => {
    try {
      return parseSmallsDetail(await getText(BASE + href), BASE + href);
    } catch (e) {
      console.warn(`[SmallsLIVE] skip ${href}: ${e.message}`);
      return null;
    }
  });
  return details.filter(Boolean);
}

module.exports = { scrapeSmalls, parseSmallsDetail };
