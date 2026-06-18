// Google Sheets / Drive read-write for the master tracker.
// Read: pull available units for the catalog sync — WITHOUT modifying the master.
//   The master tracker is an uploaded .xlsx. To read it with the Sheets API we make
//   a TEMPORARY native-Sheet copy in the service account's own Drive, read it, then
//   delete the copy. The original .xlsx is never opened for write, so the five
//   nightly tracker syncs (invoice / sold / labor / auto-listing / social) are
//   completely unaffected.
// Write-back ("mark Sold") is intentionally NOT used here — rs-sold-sync owns that.
import { google } from 'googleapis';

export function sheetsConfigured() {
  return !!(
    (process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON) &&
    (process.env.DRIVE_FILE_ID || process.env.SHEET_ID || process.env.GOOGLE_SHEETS_ID)
  );
}

// Drive file ID of the master tracker .xlsx (share it with the service account as Viewer).
// Kept under SHEET_ID for backwards-compat with the existing workflow secret.
function sourceFileId() {
  return process.env.DRIVE_FILE_ID || process.env.SHEET_ID || process.env.GOOGLE_SHEETS_ID;
}

function auth() {
  const raw = process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS not set');
  const creds = raw.trim().startsWith('{') ? JSON.parse(raw) : require(raw);
  return new google.auth.GoogleAuth({
    credentials: creds,
    // drive: copy the shared .xlsx to a temp Sheet and delete it afterwards.
    // spreadsheets: read values from that temp Sheet.
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
}

export async function sheetsClient() {
  return google.sheets({ version: 'v4', auth: await auth().getClient() });
}

async function driveClient() {
  return google.drive({ version: 'v3', auth: await auth().getClient() });
}

// Main tab columns (1-indexed): B Item ID, C Category, D Make, E Model,
// F Description, G Serial Number (UID), K Retail Price, L Condition,
// N Suggested Price, O Status, W Total Cost.
export async function readAvailable() {
  const drive = await driveClient();
  const sheets = await sheetsClient();
  const tab = process.env.GOOGLE_SHEETS_TAB || 'Main';

  const num = (v) => parseFloat((v || '0').toString().replace(/[$,]/g, '')) || 0;
  const money = (v) => Math.round(num(v) * 100) / 100;
  const mapCondition = (val) => {
    const c = (val || '').toString().trim();
    if (!c) return 'Tested & Working';
    if (/scratch/i.test(c)) return 'Scratch & Dent';
    return c;
  };

  // Make a throwaway native-Sheet copy of the .xlsx so we can read it via the
  // Sheets API. The source file is only ever read, never written.
  let tempId = null;
  try {
    const copy = await drive.files.copy({
      fileId: sourceFileId(),
      requestBody: {
        name: `__catalog-sync-temp-${Date.now()}`,
        mimeType: 'application/vnd.google-apps.spreadsheet'
      },
      fields: 'id'
    });
    tempId = copy.data.id;

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: tempId,
      range: `${tab}!A4:Y500`
    });
    const rows = data.values || [];
    // Tolerant status match (case-insensitive + collapsed whitespace), mirroring
    // lib/csv.parseTrackerCsv so the Google path and CSV import behave identically.
    const isTestedWorking = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim() === 'tested working';
    return rows
      .filter((r) => isTestedWorking(r[14])) // O = Status
      .map((r) => ({
        id: r[1],
        make: r[3],
        model: r[4],
        category: r[2],
        title: (r[5] || '').toString().trim(),
        condition: mapCondition(r[11]), // L = Condition
        price: money(r[13]), // N = Suggested Sale Price
        compareAt: money(r[10]), // K = Retail Price
        uid: (r[6] || '').toString().trim() || null, // G = Serial Number (UID → inspection-app photos)
        cost: money(r[22]) // W = Total Cost (COGS basis for margins)
      }))
      .filter((u) => u.id && u.price > 0);
  } finally {
    if (tempId) {
      try {
        await drive.files.delete({ fileId: tempId });
      } catch (e) {
        console.warn('Temp sheet cleanup failed:', e?.message || e);
      }
    }
  }
}

// Legacy/optional write-back. NOT used for the .xlsx master (Sheets API can't write
// an uploaded .xlsx) — rs-sold-sync marks units Sold in the tracker instead.
// Left gated behind writebackEnabled() (off by default) so the payment path is untouched.
export async function writeSold(unitId, soldPrice) {
  const sheets = await sheetsClient();
  const id = sourceFileId();
  const tab = process.env.GOOGLE_SHEETS_TAB || 'Main';
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: id, range: `${tab}!B4:B500`
  });
  const idx = (data.values || []).findIndex((r) => r[0] === unitId);
  if (idx < 0) return false;
  const row = 4 + idx;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${tab}!O${row}`, values: [['Sold']] },
        { range: `${tab}!X${row}`, values: [[soldPrice]] },
        { range: `${tab}!Y${row}`, values: [[new Date().toISOString().slice(0, 10)]] }
      ]
    }
  });
  return true;
}

// Sold write-back is opt-in: requires credentials AND SHEET_WRITEBACK=1.
// Leave this OFF for the .xlsx master — rs-sold-sync owns sold-marking.
export function writebackEnabled() {
  return process.env.SHEET_WRITEBACK === '1' && sheetsConfigured();
}
