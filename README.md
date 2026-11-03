# NYC Concert Calendar

Pulls upcoming NYC live music from several sources into a Google Sheet, shows
them on a simple dashboard, and prints a buy-tickets shortlist for the daily
briefing.

## What's wired up

| Source | Method | Notes |
| --- | --- | --- |
| Village Vanguard | WordPress REST API for event posts, then each event page for run dates | No key. Four to five upcoming runs. Dates have no year, so the year is inferred. |
| Dice (dice.fm) | Reads the event list embedded in the NYC browse page | No key. About 30 events. Dice's own site, not dice.com (a job board). |
| Ohmyrockness | Reads the featured-shows list on ohmyrockness.com/shows | No key. Only about 14 shows. The per-venue listings load from a token-gated API, so they aren't pulled. |
| Mercury Lounge | Parses the calendar page | No key. About 20 events. Overlaps with Ticketmaster; dedupe handles it. |
| SmallsLIVE (jazz) | Reads the homepage, then each event page for the date | No key. About 18 events, a few nights ahead. |
| Lincoln Center | Parses the upcoming-events block | No key. The public list only shows the next few events. |
| Ticketmaster | Discovery API | Needs a free key. Covers Ticketmaster-sold shows, including Birdland and Mercury Lounge. Not yet verified live. |

Not pulled yet, and why:

- **AXS** (Webster Hall, Brooklyn Steel, Music Hall of Williamsburg, Terminal 5): axs.com returns 403 to automated requests.
- **Blue Note**: the calendar is JavaScript-rendered.
- **Carnegie Hall and the Met Opera**: both return 403 from server IPs.
- **Ohmyrockness per-venue listings**: token-gated API. Access request is the unlock. Their About page lists the founders and a contact email.

The fastest way to widen coverage is the Ticketmaster key. Asking Ohmyrockness for API access would be the other big unlock. `npm run scan-venues` lists every NYC venue in the Ohmyrockness directory and how each could be pulled. See `venue-scan.md`.

## Setup

1. **Sheet.** Create a Google Sheet. Rename the first tab to `Sheet1`. Make it
   "Anyone with the link: Viewer" so the dashboard can read it. (The scraper
   writes its own headers.)
2. **Service account.** In Google Cloud, enable the Sheets API, create a
   service account, download its JSON key as `credentials.json`, and share the
   sheet with the service account's email as **Editor**.
3. **Ticketmaster key.** Sign up at developer.ticketmaster.com and copy the
   Consumer Key.
4. **Local config.** `cp .env.example .env` and fill in the three values.
5. **Install and run.**
   ```bash
   npm install
   npm start          # scrape, write concerts.json, update the Sheet
   npm run briefing   # print buy-now and last-chance picks
   npm test           # offline parser tests
   ```
6. **Dashboard.** Open `concert-dashboard.html` and set `SHEET_ID` near the top.
   Open the file in a browser. To host it, drop it in a GitHub Pages folder.

## Show research (descriptions and priority)

After each scrape, `lib/enrich.js` collapses the calendar into unique shows (a
six-night run counts once) and asks Claude, with web search, to research each
new one. It writes a two-sentence description, a one-line reason to go, and four
1-5 ratings to the sheet's `Enrich` tab:

| Rating | What it measures |
| --- | --- |
| Reviews | Critical reputation of the act or production |
| Rarity | How seldom it plays NYC (5 = rare visit, 1 = here every week) |
| Significance | Premiere, debut, farewell, anniversary, new production, one-off |
| Hype | Current buzz: new album, sellouts, press |

Score = 30% reviews, 20% rarity, 25% significance, 25% hype, scaled to 0-100.
The research also writes a press line (outlet or award, only when found), a
"for fans of" line, and a strict can't-miss flag (roughly one show in ten).

The dashboard groups shows into three tiers:

- **Can't miss**: flagged can't miss with a score of 65+, or any score of 82+.
  Featured card with press, why, and fans-of lines.
- **Highly reviewed**: reviews 4/5 or better, or a score of 62+.
- **Also playing**: everything else, shown compact.

"Can't miss only" filters to the top tier. "By date" drops the sections.

Each show is researched once, then refreshed every 21 days while it stays on
the calendar. Setup: add an `ANTHROPIC_API_KEY` repo secret. Optional:
`ENRICH_MODEL` (default `claude-haiku-5-5`) and `ENRICH_MAX` (default 300 per
run). To backfill without re-scraping: `npm run enrich`.

## Not for us (thumbs-down)

Every show and exhibition has a "Not for us" button. It hides the item at once
(with Undo), and a "Hidden" view brings things back. Multi-night runs hide as
one, so a long run like Wicked is gone for good with one tap.

To share the hidden list across the family, paste `apps-script/hide.gs` into the
sheet (Extensions > Apps Script), set its passphrase, deploy it as a web app
(execute as Me, access Anyone), and put the web app URL in `HIDE_ENDPOINT` in
`index.html`. Thumbs-downs then land in a `Hidden` tab, each device asks for the
passphrase once, and the daily research step skips hidden shows. Without the
endpoint, thumbs-downs still work on each device separately.

## Email alerts

The daily run emails a **weekly digest every Thursday morning**: new can't-miss
and highly reviewed shows, picks whose last date is within 10 days, and
exhibitions closing within 14 days. On other days it emails only when a **new
can't-miss** show appears. The very first email is a snapshot of what's on now.
Every alert is logged in the sheet's `Alerts` tab, so nothing repeats.

Setup, as repo secrets: `GMAIL_USER` (the Gmail address that sends),
`GMAIL_APP_PASSWORD` (a Google app password, not your login password), and
`ALERT_TO` (comma-separated recipients). Optional `ALERT_DIGEST_DAY` changes
the day. To send a test digest, run the workflow with "Send the weekly digest
now" ticked.

To keep something out of emails and research, type its title, or just a word
like `Wicked`, in column A of a sheet tab named `Hidden`.

## Daily run

`.github/workflows/scrape.yml` runs at 6 AM Eastern. Add these repo secrets:
`GOOGLE_SHEET_ID`, `GOOGLE_CREDENTIALS_JSON` (paste the full JSON key), and
`TICKETMASTER_API_KEY`. Trigger it once by hand from the Actions tab to check.

## Buy-now rules

- **Buy now:** 10 to 21 days before the show.
- **Last chance:** 0 to 3 days before.
- Sold-out shows are never flagged.
- Shows that already started today are dropped.

These live in `briefing.js` and in the dashboard script. Change both if you
change the window.

## Files

- `index.js`: runs all sources, dedupes, writes the Sheet and `concerts.json`
- `sources/`: one adapter per source
- `lib/`: HTTP helper with retry and backoff, date and genre normalization, dedupe, NYC venue directory (cached a day)
- `briefing.js`: prints the buy-now shortlist
- `scripts/scan-venues.js`: scans NYC venues and classifies how each could be pulled
- `concert-dashboard.html`: read-only dashboard that loads the Sheet
- `test/`: offline tests with saved fixtures
