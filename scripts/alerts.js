// Run only the alert step against the last scrape (concerts.json, exhibitions.json).
// ALERT_DRY_RUN=1 writes alerts-preview.html instead of sending.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sendAlerts } = require('../index');

const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
sendAlerts(read('concerts.json').events, read('exhibitions.json').exhibits).catch((e) => { console.error(e); process.exit(1); });
