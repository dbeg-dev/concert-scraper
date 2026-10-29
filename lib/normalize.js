// Shared event shape, date helpers, genre mapping, and dedupe.

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

// Today's date in New York as YYYY-MM-DD (the calendar's reference day).
function todayNY() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Current New York time as HH:MM, for dropping same-day shows that already started.
function nowTimeNY() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('hour')}:${get('minute')}`;
}

// "October 14" or "14 October" (+ optional year) -> YYYY-MM-DD, rolling the year
// forward if the date has already passed (listings often omit the year).
function parseMonthDay(text, { year } = {}) {
  const m = text.match(/([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?|(\d{1,2})\s+([A-Za-z]+)(?:,?\s*(\d{4}))?/);
  if (!m) return null;
  const monthName = (m[1] || m[5] || '').toLowerCase();
  const day = parseInt(m[2] || m[4], 10);
  const explicitYear = m[3] || m[6];
  const month = MONTHS.indexOf(monthName);
  if (month < 0 || !day) return null;
  const today = todayNY();
  let y = explicitYear ? parseInt(explicitYear, 10) : year || parseInt(today.slice(0, 4), 10);
  let iso = `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Only roll to next year when the date is far in the past (a January date seen in
  // December). A date a few days back is a recent show, not next year's.
  const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - 180 * 864e5).toISOString().slice(0, 10);
  if (!explicitYear && !year && iso < cutoff) {
    y += 1;
    iso = `${y}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return iso;
}

// Ticketmaster and Dice classifications -> the four genres the dashboard filters on.
const GENRE_RULES = [
  [/jazz/i, 'Jazz'],
  [/\bopera\b/i, 'Opera'],
  [/classical|orchestra|symphon|philharmonic|chamber|choral|concerto|sonata|string quartet/i, 'Classical'],
  [/rock|indie|alternative|punk|metal|pop|hip[- ]?hop|r&b|folk|electronic|dance/i, 'Rock'],
];
function mapGenre(...candidates) {
  const text = candidates.filter(Boolean).join(' ');
  for (const [re, label] of GENRE_RULES) if (re.test(text)) return label;
  return 'Other';
}

function makeEvent(partial) {
  return {
    title: (partial.title || '').trim(),
    artist: (partial.artist || partial.title || '').trim(),
    date: partial.date || '',         // YYYY-MM-DD, New York local
    time: partial.time || '',         // HH:MM 24h, may be blank
    venue: (partial.venue || '').trim(),
    genre: partial.genre || 'Other',
    price: partial.price || '',
    url: partial.url || '',
    source: partial.source || '',
    status: partial.status || '',     // e.g. onsale, sold-out, cancelled
    scrapedAt: new Date().toISOString(),
  };
}

// Drop events with no title/date, past events, and cancelled shows.
function clean(events) {
  const today = todayNY();
  const now = nowTimeNY();
  return events.filter((e) => {
    if (!e.title || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || e.date < today || e.status === 'cancelled') return false;
    if (e.date === today && e.time && e.time < now) return false; // already started today
    return true;
  });
}

function dedupeKey(e) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `${norm(e.artist || e.title)}|${e.date}`;
}

// Same act, same night, from several sources -> keep one row, prefer the entry
// that has a price and a direct ticket URL.
function dedupe(events) {
  const byKey = new Map();
  for (const e of events) {
    const key = dedupeKey(e);
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, e); continue; }
    const score = (x) => (x.price ? 1 : 0) + (x.url ? 1 : 0) + (x.time ? 1 : 0);
    if (score(e) > score(existing)) byKey.set(key, { ...e, venue: existing.venue || e.venue });
  }
  return [...byKey.values()];
}

module.exports = { todayNY, nowTimeNY, parseMonthDay, mapGenre, makeEvent, clean, dedupe, MONTHS };
