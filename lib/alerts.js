// Email alerts for the dashboard.
//
// Cadence:
//   Weekly digest (Thursday morning by default): new can't-miss and highly
//   reviewed shows, picks whose last date is coming up, and exhibitions about to
//   close. Thursday gives time to plan the weekend and catch Friday on-sales.
//   Same-morning alert, any other day: only when a new can't-miss show appears.
//
// Every alert is logged in the sheet's "Alerts" tab, so nothing is sent twice.
const { showKey, fixText, readMutes, isMuted } = require('./enrich');

const DASHBOARD = 'https://dbeg-dev.github.io/concert-scraper/';
const DIGEST_DAY = process.env.ALERT_DIGEST_DAY || 'Thursday';
const LAST_CALL_DAYS = 10;   // a pick's final date within this many days
const CLOSING_DAYS = 14;     // an exhibition closing within this many days
const CAP = { newRated: 12, lastCall: 8, closing: 8, firstRunRated: 10 };

// Same tiers as the dashboard (index.html tierOf). Keep the two in step.
function tierOf(r) {
  if (!r) return 'rest';
  const score = Number(r.Score) || 0;
  if ((r.CantMiss === 'yes' && score >= 65) || score >= 82) return 'must';
  if (Number(r.Reviews) >= 4 || score >= 62) return 'rated';
  return 'rest';
}

function nyDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d); // YYYY-MM-DD
}
function nyWeekday(d = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(d);
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function artKey(e) { return 'art:' + showKey(`${e.title} ${e.venue}`); }

// One entry per show, with what an email needs.
function buildShows(events, research) {
  const map = new Map();
  for (const e of events) {
    const key = showKey(e.title);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, title: fixText(e.title), nights: [] });
    map.get(key).nights.push(e);
  }
  return [...map.values()].map((s) => {
    s.nights.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const r = research.get(s.key);
    return {
      ...s, r, tier: tierOf(r), score: r ? Number(r.Score) || 0 : 0,
      first: s.nights[0].date, last: s.nights.at(-1).date,
      venues: [...new Set(s.nights.map((e) => e.venue))],
      url: (s.nights.find((e) => e.url) || {}).url || DASHBOARD,
    };
  });
}

// Pure planning step: what to send today, and what to log as sent.
function planAlerts({ shows, exhibits, sent, today, digest, firstRun }) {
  const seen = (k) => sent.has(k);
  const picks = shows.filter((s) => s.tier === 'must' || s.tier === 'rated');
  const byScore = (a, b) => b.score - a.score || a.first.localeCompare(b.first);

  const newMust = picks.filter((s) => s.tier === 'must' && !seen(`new:${s.key}`)).sort(byScore);
  let newRated = picks.filter((s) => s.tier === 'rated' && !seen(`new:${s.key}`)).sort(byScore);

  if (!digest && !firstRun) {
    if (!newMust.length) return null;
    return {
      kind: 'instant',
      subject: newMust.length === 1 ? `Can’t miss: ${newMust[0].title}` : `${newMust.length} new can’t-miss shows`,
      sections: [{ title: 'New can’t miss', items: newMust }],
      marks: newMust.map((s) => [`new:${s.key}`, s.title]),
    };
  }

  const inThisEmail = new Set([...newMust, ...newRated.slice(0, firstRun ? CAP.firstRunRated : CAP.newRated)].map((s) => s.key));
  const lastCall = picks
    .filter((s) => !inThisEmail.has(s.key) && s.last >= today && s.last <= addDays(today, LAST_CALL_DAYS) && !seen(`lastcall:${s.key}`))
    .sort((a, b) => a.last.localeCompare(b.last)).slice(0, CAP.lastCall);
  const closing = exhibits
    .filter((e) => e.end && e.end >= today && e.end <= addDays(today, CLOSING_DAYS) && !seen(`closing:${artKey(e)}`))
    .sort((a, b) => a.end.localeCompare(b.end)).slice(0, CAP.closing);

  // The first email is a starting snapshot. Everything current counts as seen,
  // so later emails only carry what's actually new.
  const marks = [];
  if (firstRun) {
    for (const s of picks) marks.push([`new:${s.key}`, s.title]);
    newRated = newRated.slice(0, CAP.firstRunRated);
  } else {
    const shown = newRated.slice(0, CAP.newRated);
    for (const s of [...newMust, ...shown]) marks.push([`new:${s.key}`, s.title]);
    newRated = shown;
  }
  for (const s of lastCall) marks.push([`lastcall:${s.key}`, s.title]);
  for (const e of closing) marks.push([`closing:${artKey(e)}`, e.title]);

  const sections = [
    { title: firstRun ? 'Can’t miss right now' : 'New can’t miss', items: newMust },
    { title: firstRun ? 'Highly reviewed, top of the list' : 'New and highly reviewed', items: newRated },
    { title: 'Leaving soon: last dates', items: lastCall, lastCall: true },
    { title: 'Exhibitions closing soon', items: closing, art: true },
  ].filter((x) => x.items.length);
  if (!sections.length) return null;

  const counts = [
    newMust.length && `${newMust.length} can’t miss`,
    newRated.length && `${newRated.length} highly reviewed`,
    (lastCall.length + closing.length) && `${lastCall.length + closing.length} leaving soon`,
  ].filter(Boolean).join(', ');
  return { kind: firstRun ? 'first' : 'digest', subject: `${firstRun ? 'Your NYC picks' : 'This week'}: ${counts}`, sections, marks };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderEmail(plan, today) {
  const item = (s) => {
    const dates = s.nights.length > 1 ? `${fmtDate(s.first)} to ${fmtDate(s.last)} (${s.nights.length} dates)` : fmtDate(s.first);
    const badge = s.tier === 'must' ? '<span style="background:#b4361f;color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:3px;letter-spacing:.04em">CAN’T MISS</span> ' : '';
    return `<div style="margin:0 0 18px">
      <div style="font-size:16px;font-weight:700">${badge}<a href="${esc(s.url)}" style="color:#1a1a1a">${esc(s.title)}</a></div>
      <div style="font-size:13px;color:#666;margin:2px 0 6px">${esc(s.venues.join(' / '))} · ${dates}</div>
      ${s.r && s.r.Description ? `<div style="font-size:14px;line-height:1.45">${esc(s.r.Description)}</div>` : ''}
      ${s.r && s.r.Press ? `<div style="font-size:13px;margin-top:4px"><b style="color:#1f7a3d">Press:</b> ${esc(s.r.Press)}</div>` : ''}
      ${s.r && s.r.Why ? `<div style="font-size:13px;color:#555;font-style:italic;margin-top:4px">${esc(s.r.Why)}</div>` : ''}
    </div>`;
  };
  const lastItem = (s) => `<div style="margin:0 0 10px;font-size:14px"><a href="${esc(s.url)}" style="color:#1a1a1a;font-weight:600">${esc(s.title)}</a>
      <span style="color:#666"> · ${esc(s.venues.join(' / '))} · last date ${fmtDate(s.last)}</span></div>`;
  const artItem = (e) => `<div style="margin:0 0 10px;font-size:14px"><a href="${esc(e.url || DASHBOARD + '#art')}" style="color:#1a1a1a;font-weight:600">${esc(e.title)}</a>
      <span style="color:#666"> · ${esc(e.venue)} · closes ${fmtDate(e.end)}</span></div>`;
  const body = plan.sections.map((sec) => `
    <h2 style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#b4361f;margin:26px 0 12px">${esc(sec.title)}</h2>
    ${sec.items.map(sec.art ? artItem : sec.lastCall ? lastItem : item).join('')}`).join('');
  const intro = plan.kind === 'instant' ? 'A new can’t-miss show just landed on the calendar.'
    : plan.kind === 'first' ? 'Alerts are on. Here’s where things stand. From now on you’ll get a Thursday digest, plus a same-morning note when a new can’t-miss show appears.'
    : `Your weekly picks for ${fmtDate(today)}.`;
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f5f2;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;padding:24px 26px">
    <div style="font-size:20px;font-weight:700">Two Great Lakes’ Art &amp; Music</div>
    <p style="font-size:14px;color:#555;margin:6px 0 0">${intro}</p>
    ${body}
    <p style="margin:28px 0 0;font-size:13px"><a href="${DASHBOARD}" style="color:#1a1a1a;font-weight:700">Open the full calendar →</a></p>
  </div></body></html>`;
}

async function readTab(sheets, sheetId, range) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
    return res.data.values || [];
  } catch {
    return null; // tab doesn't exist
  }
}

async function runAlerts({ events, exhibits, sheets, sheetId, now = new Date() }) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD, to = process.env.ALERT_TO;
  const dryRun = process.env.ALERT_DRY_RUN === '1';
  if (!dryRun && !(user && pass && to)) return console.log('Alerts: email not configured, skipping');

  const enrichRows = (await readTab(sheets, sheetId, 'Enrich!A1:O5000')) || [];
  const [eh = [], ...er] = enrichRows;
  const research = new Map(er.filter((r) => r[0]).map((r) => [r[0], Object.fromEntries(eh.map((h, i) => [h, r[i] ?? '']))]));
  const alertRows = await readTab(sheets, sheetId, 'Alerts!A2:A20000');
  const firstRun = alertRows === null || alertRows.length === 0;
  const sent = new Set((alertRows || []).map((r) => r[0]));

  const today = nyDate(now);
  const digest = firstRun || nyWeekday(now) === DIGEST_DAY || process.env.ALERT_FORCE_DIGEST === '1';
  const mutes = await readMutes(sheets, sheetId);
  const shows = buildShows(events, research).filter((s) => !isMuted(s.key, mutes));
  const art = exhibits.filter((e) => !isMuted(showKey(e.title), mutes));
  const plan = planAlerts({ shows, exhibits: art, sent, today, digest, firstRun });
  if (!plan) return console.log(`Alerts: nothing to send (${digest ? 'digest day' : 'checked for new can’t-miss'})`);

  const html = renderEmail(plan, today);
  if (dryRun) {
    require('fs').writeFileSync('alerts-preview.html', html);
    return console.log(`Alerts (dry run): "${plan.subject}" written to alerts-preview.html, nothing sent or logged`);
  }

  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await transport.sendMail({ from: `"Two Great Lakes" <${user}>`, to, subject: plan.subject, html });
  console.log(`Alerts: sent "${plan.subject}" to ${to.split(',').length} recipient(s)`);

  // Log only after a successful send.
  if (alertRows === null) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: [{ addSheet: { properties: { title: 'Alerts' } } }] } });
  }
  const stamp = new Date().toISOString();
  const rows = plan.marks.map(([key, title]) => [key, title, plan.kind, stamp]);
  if (alertRows === null) rows.unshift(['Key', 'Title', 'Email', 'SentAt']);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: 'Alerts!A1', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

module.exports = { runAlerts, planAlerts, buildShows, renderEmail, tierOf };
