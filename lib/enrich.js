// Show enrichment. Groups the calendar into unique shows (a run of nights counts
// once), asks Claude to research each new one with web search, and caches the
// result in the sheet's "Enrich" tab so each show is researched once, then
// refreshed every few weeks while it stays on the calendar.
//
// Each show gets a short description plus four 1-5 ratings:
//   reviews       critical reputation of the act or production
//   rarity        how seldom it plays NYC (5 = rare visit, 1 = here every week)
//   significance  premiere, debut, farewell, anniversary, new production, one-off
//   hype          current buzz: new album, sellouts, press, word of mouth
// The dashboard sorts by the combined score.
const { mapLimit, sleep } = require('./http');

const ENRICH_HEADERS = ['Key', 'Title', 'Description', 'Why', 'Press', 'FansOf', 'CantMiss', 'Reviews', 'Rarity', 'Significance', 'Hype', 'Score', 'Confidence', 'EnrichedAt', 'Model'];
const LAST_COL = 'O'; // column letter of the last header
// Sonnet: Haiku proved too timid on taste (it ranked Yuja Wang as filler).
const MODEL = process.env.ENRICH_MODEL || 'claude-sonnet-5-5';
const MAX_PER_RUN = Number(process.env.ENRICH_MAX || 300); // covers a full calendar on the first run
const REFRESH_DAYS = 21;                                    // hype moves; re-check now and then

// Same key the dashboard uses. Fixes the "???" that stands in for curly
// apostrophes in some Ticketmaster titles, strips accents and punctuation.
function fixText(s) {
  return String(s || '').replace(/\?{3}/g, '’');
}
function showKey(title) {
  return fixText(title).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Collapse dated events into one entry per show.
function groupShows(events) {
  const map = new Map();
  for (const e of events) {
    const key = showKey(e.title);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, title: fixText(e.title), artist: fixText(e.artist), genre: e.genre, venues: new Set(), dates: [] });
    const s = map.get(key);
    s.venues.add(e.venue);
    s.dates.push(e.date);
  }
  return [...map.values()].map((s) => ({ ...s, venues: [...s.venues], dates: [...new Set(s.dates)].sort() }));
}

function clamp(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(5, Math.max(1, v)) : 2;
}

// 0-100. Reviews and significance weigh most: a great act or a one-off night.
function combinedScore(r) {
  const w = 0.3 * r.reviews + 0.2 * r.rarity + 0.25 * r.significance + 0.25 * r.hype; // 1..5
  return Math.round(((w - 1) / 4) * 100);
}

// Pull the first {...} block out of the model's reply.
function parseReply(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in reply');
  const j = JSON.parse(m[0]);
  const r = {
    description: String(j.description || '').trim(),
    why: String(j.why || '').trim(),
    reviews: clamp(j.reviews), rarity: clamp(j.rarity),
    significance: clamp(j.significance), hype: clamp(j.hype),
    confidence: ['high', 'medium', 'low'].includes(j.confidence) ? j.confidence : 'low',
    press: String(j.press || '').trim(),
    fansOf: String(j.fans_of || '').trim(),
    cantMiss: j.cant_miss === true || j.cant_miss === 'true',
  };
  // Thin research can't earn a can't-miss flag.
  if (r.confidence === 'low') r.cantMiss = false;
  if (!r.description) throw new Error('empty description');
  return { ...r, score: combinedScore(r) };
}

function prompt(show) {
  const runs = show.dates.length > 1 ? `${show.dates.length} NYC dates between ${show.dates[0]} and ${show.dates.at(-1)}` : `one NYC date, ${show.dates[0]}`;
  return `You help two New Yorkers decide which concerts are worth their time and money.

Show: ${show.title}
Artist / company: ${show.artist}
Venue(s): ${show.venues.join(', ')}
Genre bucket: ${show.genre}
On the calendar: ${runs}

Search the web briefly (one to three searches) for reviews, touring history, and current buzz. Then rate. Rate the artist's or production's standing, not just whether this exact night has been reviewed yet. Calibration: a world-class soloist like Yuja Wang or Daniil Trifonov is reviews 5; a respected working jazz trio with a weekly local gig is reviews 3, rarity 1; an open jam session is 1 across the board; a major artist's first NYC date in years is rarity 5.
- reviews: critical reputation of this act or production (1 weak or unknown, 5 widely acclaimed)
- rarity: how seldom this plays New York (1 plays here weekly or a house residency, 5 rare visit or first time in years)
- significance: is this night special? premiere, debut, farewell, anniversary, new production, unusual collaboration (1 routine, 5 landmark)
- hype: current buzz, sellouts, new album, press attention (1 none, 5 the show everyone wants)
- confidence: high, medium, or low, based on how much you found

Write, in plain human language (no hype words, no em dashes, no "don't miss", no "electrifying"):
- description: two or three sentences. Who this is, what the music sounds like or what the program is, and what makes this particular night what it is.
- why: one short line on the single best reason to go, or the honest catch if there isn't one.
- press: one short line, under 120 characters, on where the acclaim comes from, naming a major outlet or award (NYT, New Yorker, Pitchfork, Gramophone, Grammy, DownBeat and the like; never ticket sellers or aggregators), e.g. "NYT Critic's Pick for this production" or "Pitchfork Best New Music for the 2025 album". Paraphrase; never quote more than a few words. Only include what you actually found in search. Empty string if nothing.
- fans_of: up to three artists whose fans would love this, comma separated. Empty string if it doesn't apply.
- cant_miss: true only for a night a serious NYC music lover would regret skipping: a rare visit by a major artist, a landmark or farewell performance, an acclaimed new production, or a once-in-years pairing. Most shows are false. Be strict: roughly one in ten at most. Never true for a weekly residency or a jam session.

If you find little, say so in the description, rate 2 across the board, set confidence to low and cant_miss to false. Never invent reviews, awards, or quotes.

Reply with only JSON: {"description":"","why":"","press":"","fans_of":"","cant_miss":false,"reviews":0,"rarity":0,"significance":0,"hype":0,"confidence":""}`;
}

async function askClaude(show, apiKey) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: prompt(show) }],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return parseReply(text);
    }
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    if (!retryable || attempt >= 6) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    // Respect the API's retry-after on rate limits; otherwise back off, capped at a minute.
    const after = Number(res.headers.get('retry-after'));
    await sleep(after > 0 ? after * 1000 + 500 : Math.min(60000, 5000 * 2 ** attempt));
  }
}

// Reads the Enrich tab into a Map keyed by show key. Creates the tab if missing.
async function readCache(sheets, sheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties.title' });
  if (!meta.data.sheets.some((s) => s.properties.title === 'Enrich')) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: [{ addSheet: { properties: { title: 'Enrich' } } }] } });
    return new Map();
  }
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `Enrich!A1:${LAST_COL}5000` });
  const [header = [], ...rows] = res.data.values || [];
  const col = Object.fromEntries(header.map((h, i) => [String(h).trim(), i]));
  const cache = new Map();
  for (const r of rows) {
    const key = r[col.Key];
    if (!key) continue;
    cache.set(key, Object.fromEntries(ENRICH_HEADERS.map((h) => [h, r[col[h]] ?? ''])));
  }
  return cache;
}

// Muted shows: anything typed in column A of a "Hidden" tab (a full title or
// just a word like "Wicked"). Matching shows are skipped by research and email.
const MUTE_IGNORE = new Set(['key', 'hide', 'hidden', 'title', 'show', 'shows']);
async function readMutes(sheets, sheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Hidden!A1:A1000' });
    return (res.data.values || []).map((r) => showKey(r[0])).filter((k) => k.length >= 3 && !MUTE_IGNORE.has(k));
  } catch {
    return []; // no Hidden tab
  }
}
function isMuted(key, mutes) { return mutes.some((m) => key.includes(m)); }

async function writeCache(sheets, sheetId, cache) {
  const rows = [...cache.values()]
    .sort((a, b) => Number(b.Score || 0) - Number(a.Score || 0))
    .map((r) => ENRICH_HEADERS.map((h) => r[h] ?? ''));
  await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `Enrich!A1:${LAST_COL}5000` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId, range: 'Enrich!A1', valueInputOption: 'RAW',
    requestBody: { values: [ENRICH_HEADERS, ...rows] },
  });
}

async function enrichShows(events, sheets, sheetId) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return console.log('Enrich: ANTHROPIC_API_KEY not set, skipping');
  const mutes = await readMutes(sheets, sheetId);
  const all = groupShows(events);
  const shows = all.filter((s) => !isMuted(s.key, mutes)); // don't pay to research what we've ruled out
  const cache = await readCache(sheets, sheetId);
  const cutoff = new Date(Date.now() - REFRESH_DAYS * 864e5).toISOString();

  // New shows first, soonest first, then stale ones.
  const fresh = shows.filter((s) => !cache.has(s.key));
  const stale = shows.filter((s) => cache.has(s.key) &&
    ((cache.get(s.key).EnrichedAt || '') < cutoff || cache.get(s.key).Model !== MODEL));
  const todo = [...fresh, ...stale].sort((a, b) => (cache.has(a.key) - cache.has(b.key)) || a.dates[0].localeCompare(b.dates[0])).slice(0, MAX_PER_RUN);
  if (all.length > shows.length) console.log(`Enrich: skipping ${all.length - shows.length} muted shows`);
  console.log(`Enrich: ${shows.length} unique shows, ${fresh.length} new, ${stale.length} stale, researching ${todo.length}`);

  let ok = 0;
  const failures = {};
  await mapLimit(todo, 2, async (show) => {
    try {
      const r = await askClaude(show, apiKey);
      cache.set(show.key, {
        Key: show.key, Title: show.title, Description: r.description, Why: r.why,
        Press: r.press, FansOf: r.fansOf, CantMiss: r.cantMiss ? 'yes' : '',
        Reviews: r.reviews, Rarity: r.rarity, Significance: r.significance, Hype: r.hype,
        Score: r.score, Confidence: r.confidence, EnrichedAt: new Date().toISOString(), Model: MODEL,
      });
      ok++;
    } catch (e) {
      const reason = e.message.slice(0, 60);
      failures[reason] = (failures[reason] || 0) + 1;
      console.error(`Enrich: ${show.title}: ${e.message}`);
    }
  });

  // Keep rows for shows still on the calendar, plus anything researched in the
  // last 90 days (a show can drop off one day and come back the next).
  const live = new Set(shows.map((s) => s.key));
  const keepAfter = new Date(Date.now() - 90 * 864e5).toISOString();
  for (const [k, r] of cache) if (!live.has(k) && (r.EnrichedAt || '') < keepAfter) cache.delete(k);

  await writeCache(sheets, sheetId, cache);
  console.log(`Enrich: researched ${ok}/${todo.length}, ${cache.size} rows in Enrich tab`);
  for (const [reason, n] of Object.entries(failures)) console.log(`Enrich: ${n} failed: ${reason}`);
}

module.exports = { enrichShows, readMutes, isMuted, groupShows, showKey, fixText, parseReply, combinedScore, ENRICH_HEADERS };
