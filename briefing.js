// Prints the buy-now shortlist from concerts.json for the daily briefing.
// Buy-now window: 10-21 days out (best seats/prices before the rush), or
// last chance if the show is within 3 days.
const fs = require('fs');
const path = require('path');
const { todayNY } = require('./lib/normalize');

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
}

function recommend(e, today) {
  if (e.status === 'sold-out') return null;
  const d = daysBetween(today, e.date);
  if (d >= 10 && d <= 21) return { label: 'Buy now', days: d };
  if (d >= 0 && d <= 3) return { label: 'Last chance', days: d };
  if (d > 21 && d <= 60) return { label: 'Wait', days: d };
  return null;
}

function main() {
  const file = path.join(__dirname, 'concerts.json');
  if (!fs.existsSync(file)) return console.log('No concerts.json yet. Run npm start first.');
  const { updatedAt, events } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const today = todayNY();
  const picks = events
    .map((e) => ({ e, r: recommend(e, today) }))
    .filter((x) => x.r && x.r.label !== 'Wait')
    .sort((a, b) => a.e.date.localeCompare(b.e.date));
  console.log(`NYC live music, buy-ticket picks as of ${today} (data updated ${updatedAt})`);
  if (!picks.length) return console.log('No buy-now or last-chance shows right now.');
  for (const { e, r } of picks.slice(0, 15)) {
    console.log(`- [${r.label}] ${e.artist || e.title} @ ${e.venue}, ${e.date}${e.time ? ' ' + e.time : ''} (${r.days}d) ${e.url}`);
  }
}

main();
