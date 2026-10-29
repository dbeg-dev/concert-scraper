// Offline tests: run each parser against saved HTML/JSON captured from the live
// sites, and check the dashboard CSV parser on tricky quoting. No network needed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const { parseDice } = require('../sources/dice');
const { parseMercury } = require('../sources/mercury');
const { parseLincolnCenter } = require('../sources/lincoln-center');
const { parseOhmyrocknessShows, cleanTicketUrl } = require('../sources/ohmyrockness');
const { parseVanguardEvent } = require('../sources/village-vanguard');
const { parseSmallsDetail } = require('../sources/smalls');
const { toEvent } = require('../sources/ticketmaster');
const { parseMonthDay, dedupe, makeEvent, clean, todayNY } = require('../lib/normalize');

const results = [];
function test(name, fn) {
  try { fn(); results.push([name, true]); }
  catch (e) { results.push([name, false, e.message]); }
}

test('Dice: parses NYC events from __NEXT_DATA__', () => {
  const events = parseDice(fixture('dice-browse.html'));
  assert.ok(events.length >= 20, `expected 20+ events, got ${events.length}`);
  for (const e of events) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.title && e.url.startsWith('https://dice.fm/event/'));
  }
});

test('Mercury Lounge: parses widget rows with date and time', () => {
  const events = parseMercury(fixture('mercury-calendar.html'));
  assert.ok(events.length >= 10, `expected 10+ events, got ${events.length}`);
  const sample = events.find((e) => /Ian McConnell/.test(e.title));
  assert.ok(sample, 'Ian McConnell row missing');
  assert.strictEqual(sample.time, '18:00');
  assert.strictEqual(sample.status, 'sold-out');
});

test('Lincoln Center: parses upcoming events and infers year', () => {
  const events = parseLincolnCenter(fixture('lincoln-calendar.html'));
  assert.ok(events.length >= 1);
  assert.match(events[0].date, /^\d{4}-10-14$/);
  assert.strictEqual(events[0].time, '13:00');
});

test('Ohmyrockness: parses featured shows embedded in the page', () => {
  const events = parseOhmyrocknessShows(fixture('ohmyrockness-venue.html'));
  assert.strictEqual(events.length, 10);
  const btsq = events.find((e) => e.artist === 'Built to Spill');
  assert.ok(btsq, 'Built to Spill row missing');
  assert.strictEqual(btsq.date, '2026-10-21');
  assert.strictEqual(btsq.time, '20:00');
  assert.strictEqual(btsq.venue, 'Music Hall of Williamsburg');
  assert.ok(events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.url));
});

test('Ohmyrockness: unwraps affiliate redirect to the direct Ticketmaster page', () => {
  const aff = 'https://ticketmaster.evyy.net/c/255026/264167/4272?subId1=nyc&u=https%3A%2F%2Fwww.ticketmaster.com%2Fbeck-brooklyn-new-york-10-23-2026%2Fevent%2F00006483ADA3C789';
  assert.strictEqual(cleanTicketUrl(aff), 'https://www.ticketmaster.com/beck-brooklyn-new-york-10-23-2026/event/00006483ADA3C789');
  assert.strictEqual(cleanTicketUrl('https://www.axs.com/events/1/x'), 'https://www.axs.com/events/1/x');
});

test('Village Vanguard: reads run dates from the event page and notes the end date', () => {
  const e = parseVanguardEvent(fixture('village-vanguard-event.html'), 'https://villagevanguard.com/event/fred-hersch-trio-plus-2');
  assert.strictEqual(e.date, '2026-10-20');
  assert.strictEqual(e.venue, 'Village Vanguard');
  assert.strictEqual(e.genre, 'Jazz');
  assert.match(e.title, /FRED HERSCH TRIO \+ 2 \(through Oct 25\)/);
});

test('Village Vanguard: skips posts without a date', () => {
  const html = '<div class="event-details"><h2>COMING SOON!</h2><h3></h3></div>';
  assert.strictEqual(parseVanguardEvent(html, 'https://x'), null);
});

test('SmallsLIVE: reads date from og:description', () => {
  const html = `<html><head><title>David Lopato Trio - SmallsLIVE</title>
    <meta property="og:description" content="Wednesday, October 14, 2026 Wed 14 Oct 2026 - Wed 14 Oct 2026"/></head></html>`;
  const e = parseSmallsDetail(html, 'https://www.smallslive.com/events/1-x/');
  assert.strictEqual(e.title, 'David Lopato Trio');
  assert.strictEqual(e.date, '2026-10-14');
  assert.strictEqual(e.genre, 'Jazz');
});

test('Ticketmaster: maps Discovery API shape to the shared event format', () => {
  const e = toEvent({
    name: 'Test Act', dates: { start: { localDate: '2026-11-02', localTime: '20:00:00' }, status: { code: 'onsale' } },
    _embedded: { venues: [{ name: 'Brooklyn Bowl' }], attractions: [{ name: 'Test Act' }] },
    classifications: [{ genre: { name: 'Jazz' } }],
    priceRanges: [{ min: 25.5, max: 40 }], url: 'https://www.ticketmaster.com/x',
  });
  assert.deepStrictEqual([e.date, e.time, e.venue, e.genre, e.price], ['2026-11-02', '20:00', 'Brooklyn Bowl', 'Jazz', '$25-$40']);
});

test('Dates: a recent past date stays in the current year; a far-past one rolls forward', () => {
  const recent = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  const [, rm, rd] = recent.split('-').map(Number);
  const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][rm - 1];
  assert.strictEqual(parseMonthDay(`${monthName} ${rd}`), recent);
  const today = todayNY();
  const iso = parseMonthDay('January 3');
  assert.ok(iso >= today, `${iso} should not be before today ${today}`);
  assert.strictEqual(parseMonthDay('October 14, 2027'), '2027-10-14');
});

test('Dedupe: one row per act per night, keeps the richer record', () => {
  const sparse = makeEvent({ title: 'Ian McConnell', date: '2030-01-01', venue: 'Mercury Lounge', source: 'a' });
  const rich = makeEvent({ title: 'Ian McConnell', date: '2030-01-01', venue: 'Mercury Lounge', price: '$20', url: 'https://x', time: '18:00', source: 'b' });
  const out = dedupe([sparse, rich]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].source, 'b');
});

test('Clean: drops past events, already-started shows today, and cancelled shows', () => {
  const { nowTimeNY } = require('../lib/normalize');
  const startedToday = makeEvent({ title: 'Earlier', date: todayNY(), time: '00:01' });
  const laterToday = makeEvent({ title: 'Later', date: todayNY(), time: '23:59' });
  assert.ok(clean([startedToday]).length === (nowTimeNY() > '00:01' ? 0 : 1));
  assert.ok(clean([laterToday]).length === (nowTimeNY() > '23:59' ? 0 : 1));
  const past = makeEvent({ title: 'Old', date: '2001-01-01' });
  const cancelled = makeEvent({ title: 'Off', date: '2099-01-01', status: 'cancelled' });
  const ok = makeEvent({ title: 'On', date: '2099-01-01' });
  assert.deepStrictEqual(clean([past, cancelled, ok]).map((e) => e.title), ['On']);
});

test('Dashboard: CSV parser handles quoted commas and escaped quotes', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'concert-dashboard.html'), 'utf8');
  const src = html.match(/function parseCSV[\s\S]*?\n}\n/)[0];
  const parseCSV = new Function(src + '; return parseCSV;')();
  const rows = parseCSV('Title,Artist,Date\r\n"Tiki Disco, Ruins","Dj ""Q"" Smith",2026-10-18\r\nPlain,Band,2026-10-20\r\n');
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[1][0], 'Tiki Disco, Ruins');
  assert.strictEqual(rows[1][1], 'Dj "Q" Smith');
  assert.strictEqual(rows[2][2], '2026-10-20');
});

let failed = 0;
for (const [name, ok, msg] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${msg}`}`);
  if (!ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
