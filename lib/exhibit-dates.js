// Parses museum date text into { start, end } as YYYY-MM-DD ('' when unknown).
// Handles "October 15, 2026 to January 18, 2027", "Sep. 18, 2026 – Feb. 7, 2027",
// "Jul. 17 – Nov. 15, 2026", "Feb 18 — May 24, 2027", "Through Jan 18, 2027",
// "Opens Nov 21", "Oct. 24, 2025 — Ongoing", "January 13, 2027 and Onward".
const { todayNY } = require('./normalize');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DATE_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/gi;

const pad = (n) => String(n).padStart(2, '0');

function parseExhibitDates(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
    // "Nov 9 – 23, 2014" -> "Nov 9, 2014 – Nov 23, 2014"
    .replace(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+)(\d{1,2})\s*[–—-]\s*(\d{1,2}),?\s*(\d{4})/i, '$1$2, $4 – $1$3, $4');
  if (!t) return null;
  const found = [...t.matchAll(DATE_RE)].map((m) => ({ m: MONTHS[m[1].toLowerCase().slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3)] || MONTHS[m[1].toLowerCase().slice(0, 3)], d: +m[2], y: m[3] ? +m[3] : null, at: m.index }));
  const ongoing = /ongoing|onward|indefinite|long-term/i.test(t);
  if (!found.length) return ongoing ? { start: '', end: '' } : null;
  const today = todayNY();
  const thisYear = +today.slice(0, 4);
  const hadYear = found.some((x) => x.y != null);
  // A missing year borrows the next date's year (Jul. 17 – Nov. 15, 2026), else this year.
  for (let i = found.length - 1; i >= 0; i--) {
    if (found[i].y == null) found[i].y = found[i + 1]?.y ?? thisYear;
  }
  // A range that would run backwards started the year before (Nov 3 – Feb 1, 2027).
  if (found.length >= 2 && found[0].y === found[1].y && found[0].m > found[1].m) found[0].y -= 1;
  const iso = (x) => `${x.y}-${pad(x.m)}-${pad(x.d)}`;
  // No year anywhere and the date is long past: it means next year ("Opens Feb 6" in October).
  if (!hadYear) {
    const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - 180 * 864e5).toISOString().slice(0, 10);
    for (const x of found) if (iso(x) < cutoff) x.y += 1;
  }
  if (/^\s*(through|thru|until|closes|on view through|now through)/i.test(t)) return { start: '', end: iso(found[0]) };
  if (found.length === 1 && /\b(opens?|opening|from|starting|begins)\b/i.test(t)) return { start: iso(found[0]), end: '' };
  if (found.length >= 2) return { start: iso(found[0]), end: iso(found[1]) };
  return ongoing ? { start: iso(found[0]), end: '' } : { start: iso(found[0]), end: iso(found[0]) };
}

function makeExhibit(p) {
  return {
    title: String(p.title || '').replace(/\s+/g, ' ').trim(),
    venue: p.venue,
    borough: p.borough || 'Manhattan',
    start: p.start || '',
    end: p.end || '',
    url: p.url || '',
    source: p.source || p.venue,
    scrapedAt: new Date().toISOString(),
  };
}

// Keep shows still on view or opening later; drop ones that already closed.
function cleanExhibits(list) {
  const today = todayNY();
  const seen = new Set();
  return list.filter((e) => {
    if (!e.title) return false;
    if (e.end && e.end < today) return false;
    const key = `${e.venue}|${e.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { parseExhibitDates, makeExhibit, cleanExhibits };
