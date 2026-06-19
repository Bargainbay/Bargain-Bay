// Google Drive read for the master tracker (uploaded .xlsx).
//   We DOWNLOAD the .xlsx bytes and parse them in memory (SheetJS), then reuse
//   lib/csv.parseTrackerCsv so the Google sync and the keyless CSV import behave
//   identically. We do NOT copy the file into the service account's Drive — a
//   service account has zero Drive storage, so the old copy-to-temp-Sheet
//   approach failed with "storage quota exceeded". Reading bytes needs only
//   Viewer access and creates nothing.
// Write-back ("mark Sold") is intentionally NOT used here — rs-sold-sync owns that.
import { google } from 'googleapis';
import * as XLSX from 'xlsx';
import { parseTrackerCsv } from './csv';

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

// Download the tracker .xlsx bytes and parse the chosen tab in memory, reusing
// the same column-aware parser as the CSV import (header auto-detect, tolerant
// "Tested Working" match, price/cost mapping). No Drive file is created.
export async function readAvailable() {
  const drive = await driveClient();
  const tab = process.env.GOOGLE_SHEETS_TAB || 'Main';

  const res = await drive.files.get(
    { fileId: sourceFileId(), alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  const wb = XLSX.read(Buffer.from(res.data), { type: 'buffer' });
  const name = wb.SheetNames.find((n) => n.toLowerCase() === tab.toLowerCase()) || tab;
  const sheet = wb.Sheets[name];
  if (!sheet) {
    throw new Error(`Tab "${tab}" not found in the tracker (tabs: ${wb.SheetNames.join(', ')}).`);
  }
  const csv = XLSX.utils.sheet_to_csv(sheet);
  const { units } = parseTrackerCsv(csv);
  return units;
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
