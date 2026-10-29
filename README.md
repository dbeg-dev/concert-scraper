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
