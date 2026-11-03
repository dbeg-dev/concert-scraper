// "Not for us" endpoint for the Two Great Lakes dashboard.
// Paste this into the NYC Concert Calendar sheet: Extensions > Apps Script.
// Deploy > New deployment > Web app, execute as Me, access Anyone.
// Copy the web app URL into HIDE_ENDPOINT in index.html.
//
// Thumbs-downs land in a "Hidden" tab. The dashboard and the daily
// research step both skip anything listed there.

// Change this to your family passphrase. The dashboard asks for it once per device.
const PASSPHRASE = 'change-me';

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: 'bad request' }); }
  if (p.passphrase !== PASSPHRASE) return reply({ ok: false, error: 'wrong passphrase' });
  if (!p.key || !['hide', 'unhide'].includes(p.action)) return reply({ ok: false, error: 'bad request' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('Hidden') || ss.insertSheet('Hidden');
    if (sh.getLastRow() === 0) sh.appendRow(['Key', 'Title', 'Section', 'HiddenAt']);
    const keys = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map((r) => String(r[0]));
    const row = keys.indexOf(String(p.key)); // 0 is the header
    if (p.action === 'hide' && row < 0) sh.appendRow([String(p.key), String(p.title || ''), String(p.section || 'music'), new Date()]);
    if (p.action === 'unhide' && row > 0) sh.deleteRow(row + 1);
    return reply({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
