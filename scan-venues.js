// Discovers NYC venues from the Ohmyrockness venue directory and classifies each
// venue's website by how its events could be pulled into the aggregator.
// Output: venue-scan.json and venue-scan.md in the project root.
//
// Usage: node scripts/scan-venues.js [maxVenues=300]
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { getJson, getText, mapLimit } = require('../lib/http');

const MAX_DIRECTORY_PAGES = 200; // 10 venues per page
const MAX_VENUES = parseInt(process.argv[2] || '300', 10);

// NYC proper ZIP prefixes: Manhattan 100-102, Bronx 104, Brooklyn 112, Queens 111/113/114/116, Staten Island 103
const NYC_ZIP = /NY\s+(10[0-4]|11[1-6]|112)\d{2}/;

async function loadDirectory() {
  const seen = new Map();
  for (let page = 1; page <= MAX_DIRECTORY_PAGES; page++) {
    const batch = await getJson(`https://www.ohmyrockness.com/venues.json?region_id=1&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const v of batch) seen.set(v.id, v);
  }
  return [...seen.values()].filter((v) => NYC_ZIP.test(v.full_address || ''));
}

// Platforms we can pull from through a documented API or a structured feed.
const PLATFORM_SIGNALS = [
  ['Ticketmaster', /ticketmaster\.com|ticketm\.net|class="tw-|tm-event/i],
  ['AXS', /axs\.com|axs-event/i],
  ['Dice', /dice\.fm/i],
  ['Eventbrite', /eventbrite\.com/i],
  ['Songkick', /songkick\.com/i],
  ['Bandsintown', /bandsintown\.com/i],
  ['Resident Advisor', /ra\.co\//i],
  ['Tixr', /tixr\.com/i],
  ['Etix', /etix\.com/i],
];

function classify(html, website) {
  const $ = cheerio.load(html);
  const platforms = PLATFORM_SIGNALS.filter(([, re]) => re.test(html)).map(([name]) => name);
  const hasJsonLdEvent = /"@type"\s*:\s*"(MusicEvent|Event)"/.test(html);
  const calendarHref = $('a[href]').map((_, a) => $(a).attr('href')).get()
    .find((h) => /\/(calendar|events?|shows?|schedule|tickets|lineup)(\/|$|\?)/i.test(h || ''));
  const hasNextData = /id="__NEXT_DATA__"/.test(html);

  let approach;
  if (platforms.length) approach = `Ticketing link found: ${platforms[0]} (verify shows are sold there)`;
  else if (hasJsonLdEvent) approach = 'Parse JSON-LD events';
  else if (hasNextData) approach = 'Parse __NEXT_DATA__ payload';
  else if (calendarHref) approach = 'Scrape calendar page (custom parser)';
  else approach = 'Unclear: JS-rendered or no public listing; check manually';

  return { platforms, hasJsonLdEvent, calendarHref: calendarHref || '', approach };
}

async function probe(venue) {
  const base = { name: venue.name.trim(), website: venue.website, shows_count: venue.shows_count || 0, address: venue.full_address.replace(/\s+/g, ' ').trim() };
  if (!venue.website) return { ...base, status: 'no website', approach: 'Add website to directory first' };
  const url = venue.website.startsWith('http') ? venue.website : `http://${venue.website}`;
  try {
    const html = await getText(url, { timeoutMs: 15000 });
    return { ...base, status: 'ok', ...classify(html, url) };
  } catch (e) {
    const blocked = /403|429/.test(e.message);
    return { ...base, status: blocked ? 'blocked (403/429)' : `unreachable: ${e.message.slice(0, 60)}`, approach: blocked ? 'Blocked from this server; try a browser or the venue directly' : 'Unreachable' };
  }
}

function toMarkdown(rows, generatedAt) {
  const count = (pred) => rows.filter(pred).length;
  const lines = [
    `# NYC venue scan`,
    ``,
    `Generated ${generatedAt}. Source: Ohmyrockness venue directory (NYC ZIP codes). Venues probed: ${rows.length}, sorted by show activity.`,
    ``,
    `## Summary`,
    ``,
    `- Ticketing platform linked (Ticketmaster, AXS, Dice, Eventbrite, etc.): ${count((r) => (r.approach || '').startsWith('Ticketing link'))}`,
    `- Structured data (JSON-LD or __NEXT_DATA__): ${count((r) => /JSON-LD|__NEXT_DATA__/.test(r.approach || ''))}`,
    `- Custom calendar page to scrape: ${count((r) => (r.approach || '').startsWith('Scrape calendar'))}`,
    `- Note: includes non-music venues (museums, Apple Stores). Filter by hand before building parsers.`,
    `- Unclear, check manually: ${count((r) => (r.approach || '').startsWith('Unclear'))}`,
    `- Blocked or unreachable: ${count((r) => /blocked|unreachable/.test(r.status))}`,
    `- No website listed: ${count((r) => r.status === 'no website')}`,
    ``,
    `## Venues`,
    ``,
    `| Venue | Shows (directory) | Approach | Platform detected | Calendar link | Website |`,
    `| --- | ---: | --- | --- | --- | --- |`,
  ];
  for (const r of rows) {
    lines.push(`| ${r.name} | ${r.shows_count} | ${r.approach} | ${(r.platforms || []).join(', ') || '-'} | ${r.calendarHref ? 'yes' : '-'} | ${r.website || '-'} |`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  console.log('Loading NYC venue directory...');
  const venues = (await loadDirectory()).sort((a, b) => (b.shows_count || 0) - (a.shows_count || 0)).slice(0, MAX_VENUES);
  console.log(`Probing ${venues.length} venues...`);
  const rows = await mapLimit(venues, 8, async (v, i) => {
    const r = await probe(v);
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${venues.length}`);
    return r;
  });
  const generatedAt = new Date().toISOString();
  const root = path.join(__dirname, '..');
  fs.writeFileSync(path.join(root, 'venue-scan.json'), JSON.stringify({ generatedAt, count: rows.length, venues: rows }, null, 2));
  fs.writeFileSync(path.join(root, 'venue-scan.md'), toMarkdown(rows, generatedAt));
  console.log('Wrote venue-scan.json and venue-scan.md');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
