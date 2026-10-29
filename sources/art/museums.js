// Museum exhibitions, one parser per site. Each returns the shared exhibit shape
// from lib/exhibit-dates.js. Sites that sit behind bot walls (MoMA, the Met,
// Brooklyn Museum, the Morgan) aren't here: they refuse automated requests.
const cheerio = require('cheerio');
const { getText } = require('../../lib/http');
const { parseExhibitDates, makeExhibit } = require('../../lib/exhibit-dates');

const abs = (base, href) => { try { return new URL(href, base).href; } catch { return ''; } };
const txt = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Guggenheim: exhibitions ride along in an inline `const appConfig = {...}` blob.
function parseGuggenheim(html) {
  const out = [];
  const dec = (s, i) => { try { return JSON.parse(s.slice(i, matchBrace(s, i) + 1)); } catch { return null; } };
  const re = /(?:const|var|let)\s+\w+\s*=\s*\{/g;
  let m;
  const found = new Map();
  while ((m = re.exec(html))) {
    const obj = dec(html, m.index + m[0].length - 1);
    if (obj) walk(obj, (o) => { if (o.dates && o.title && o.slug) found.set(o.slug, o); });
  }
  const MON = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const iso = (d) => (d && d.year && d.month ? `${d.year}-${String(MON.indexOf(String(d.month).toLowerCase()) + 1).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}` : '');
  for (const o of found.values()) {
    const ongoing = /ongoing/i.test(o.dates.label || '');
    out.push(makeExhibit({
      title: cheerio.load(String(o.title).replace(/<br\s*\/?>/gi, ' ')).text(),
      venue: 'Guggenheim', start: iso(o.dates.start), end: ongoing ? '' : iso(o.dates.end),
      url: `https://www.guggenheim.org/exhibition/${o.slug}`,
    }));
  }
  return out;
}

function matchBrace(s, i) {
  let depth = 0, inStr = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j;
  }
  return -1;
}

function walk(o, fn) {
  if (Array.isArray(o)) o.forEach((v) => walk(v, fn));
  else if (o && typeof o === 'object') { fn(o); Object.values(o).forEach((v) => walk(v, fn)); }
}

// New Museum: Next.js page data lists every Exhibition with ISO dates and a link.
function parseNewMuseum(html) {
  const $ = cheerio.load(html);
  const data = JSON.parse($('#__NEXT_DATA__').text() || '{}');
  const found = new Map();
  // "First Look" items are online-only commissions, not shows in the building.
  walk(data, (o) => { if (o.__typename === 'Exhibition' && o.title && o.link && !/^First Look\b/i.test(o.title)) found.set(o.link, o); });
  return [...found.values()].map((o) => makeExhibit({
    title: o.title, venue: 'New Museum',
    start: (o.startDate || '').slice(0, 10), end: (o.endDate || '').slice(0, 10), url: o.link,
  }));
}

// Whitney: <li class="exhibition-list-item"><a><h3>Title</h3><p>Through Jan 18, 2027</p></a>
function parseWhitney(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('li.exhibition-list-item a').each((_, a) => {
    const title = txt($(a).find('h3').text());
    const dates = parseExhibitDates(txt($(a).find('p').first().text()));
    if (!title || !dates) return;
    out.push(makeExhibit({ title, venue: 'Whitney', ...dates, url: abs('https://whitney.org', $(a).attr('href')) }));
  });
  return out;
}

// Frick: <p><em><strong>Title</strong></em><br>October 15, 2026 to January 18, 2027</p>
function parseFrick(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.paragraph-card__body-text').each((_, el) => {
    const first = $(el).find('p').first();
    const title = txt(first.find('strong').first().text() || first.find('em').first().text());
    const dateText = txt(first.text()).replace(title, '');
    const dates = parseExhibitDates(dateText);
    const href = $(el).find('a[href*="/exhibitions/"]').first().attr('href');
    if (!title || !dates) return;
    out.push(makeExhibit({ title, venue: 'The Frick Collection', ...dates, url: href ? abs('https://www.frick.org', href) : 'https://www.frick.org/exhibitions' }));
  });
  return out;
}

// Jewish Museum: each card link carries "Status, Title, Dates" in aria-label.
function parseJewishMuseum(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('a[href*="/exhibitions/"][aria-label]').each((_, a) => {
    const label = $(a).attr('aria-label');
    const m = label.match(/^(?:On View|Upcoming|Coming Soon|Opening Soon|Past),\s*(.+?),\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d.*)$/i);
    if (!m) return;
    const dates = parseExhibitDates(m[2]);
    if (!dates) return;
    out.push(makeExhibit({ title: m[1], venue: 'The Jewish Museum', ...dates, url: abs('https://thejewishmuseum.org', $(a).attr('href')) }));
  });
  return out;
}

// ICP: <h1 class="cards__title">Title</h1> then the date range in .field__item.
function parseICP(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.cards__info').each((_, el) => {
    const title = txt($(el).find('.cards__title').text());
    const dates = parseExhibitDates(txt($(el).find('.field--name-field-text .field__item').first().text()));
    const href = $(el).find('a.cards__anchor').attr('href') || $(el).find('a').attr('href');
    if (!title || !dates) return;
    out.push(makeExhibit({ title, venue: 'ICP', ...dates, url: abs('https://www.icp.org', href) }));
  });
  return out;
}

// Neue Galerie: EventTile cards with a title link and a date line.
function parseNeueGalerie(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('[class*="EventTile_title"]').each((_, el) => {
    const a = $(el).find('a').first();
    const title = txt(a.text() || $(el).text());
    const tile = $(el).closest('[class*="EventTile_"]').parent();
    const dateText = txt(tile.find('[class*="EventTile_date"], [class*="EventTile_subtitle"], [class*="EventTile_eventDate"]').first().text());
    const dates = parseExhibitDates(dateText);
    if (!title || !dates || /anniversary/i.test(title) && !dates.start && !dates.end) return;
    out.push(makeExhibit({ title, venue: 'Neue Galerie', ...dates, url: abs('https://www.neuegalerie.org', a.attr('href')) }));
  });
  return out;
}

// Studio Museum in Harlem: Next.js page data with dateStart/dateEnd per show.
function parseStudioMuseum(html) {
  const $ = cheerio.load(html);
  const data = JSON.parse($('#__NEXT_DATA__').text() || '{}');
  const found = new Map();
  walk(data, (o) => { if (o.slug && o.title && (o.dateStart || o.dateEnd)) found.set(o.slug, o); });
  return [...found.values()].map((o) => makeExhibit({
    title: o.title, venue: 'Studio Museum in Harlem',
    start: (o.dateStart || '').slice(0, 10),
    end: /ongoing/i.test(o.dateText || '') ? '' : (o.dateEnd || '').slice(0, 10),
    url: `https://studiomuseum.org/exhibitions/${o.slug}`,
  }));
}

// Pioneer Works (Red Hook): titles come from the page data; each card reads
// title, artist, then the date range, so the date is the first range after the title.
function parsePioneerWorks(html) {
  const $ = cheerio.load(html);
  const data = JSON.parse($('#__NEXT_DATA__').text() || '{}');
  const shows = new Map();
  walk(data, (o) => { if (o._type === 'exhibition' && o.slug?.current && o.title) shows.set(o.slug.current, o); });
  $('script, style, svg').remove();
  const lines = cheerio.load(($('body').html() || '').replace(/<[^>]+>/g, '\n')).text().split(/\n+/).map(txt).filter(Boolean);
  const RANGE = /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\s*[–—-]\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?\d{1,2},?\s*\d{4}$/;
  const out = [];
  for (const [slug, o] of shows) {
    const name = txt(o.exhibitionTitle || o.title);
    const i = lines.findIndex((l) => l === name || l === txt(o.title));
    if (i < 0) continue;
    const dateLine = lines.slice(i + 1, i + 4).find((l) => RANGE.test(l));
    const dates = dateLine && parseExhibitDates(dateLine);
    if (!dates) continue;
    out.push(makeExhibit({ title: o.title, venue: 'Pioneer Works', borough: 'Brooklyn', ...dates, url: `https://pioneerworks.org/exhibitions/${slug}` }));
  }
  return out;
}

const MUSEUMS = [
  ['Guggenheim', 'https://www.guggenheim.org/exhibitions', parseGuggenheim],
  ['Whitney', 'https://whitney.org/exhibitions', parseWhitney],
  ['New Museum', 'https://www.newmuseum.org/exhibitions/', parseNewMuseum],
  ['The Frick Collection', 'https://www.frick.org/exhibitions', parseFrick],
  ['The Jewish Museum', 'https://thejewishmuseum.org/exhibitions/', parseJewishMuseum],
  ['ICP', 'https://www.icp.org/exhibitions', parseICP],
  ['Neue Galerie', 'https://www.neuegalerie.org/exhibitions', parseNeueGalerie],
  ['Studio Museum in Harlem', 'https://studiomuseum.org/exhibitions', parseStudioMuseum],
  ['Pioneer Works', 'https://pioneerworks.org/exhibitions', parsePioneerWorks],
];

module.exports = { MUSEUMS, parseGuggenheim, parseNewMuseum, parseWhitney, parseFrick, parseJewishMuseum, parseICP, parseNeueGalerie, parseStudioMuseum, parsePioneerWorks };
