// Google Sheets read/write for the master tracker.
// Read: pull available units for the sync job.
// Write: mark a unit "Sold" after a successful Clover payment.
import { google } from 'googleapis';

export function sheetsConfigured() {
  return !!(
    (process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON) &&
    (process.env.SHEET_ID || process.env.GOOGLE_SHEETS_ID)
  );
}

function sheetId() {
  return process.env.SHEET_ID || process.env.GOOGLE_SHEETS_ID;
}

function auth() {
  const raw = process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS not set');
  const creds = raw.trim().startsWith('{') ? JSON.parse(raw) : require(raw);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
}

export async function sheetsClient() {
  return google.sheets({ version: 'v4', auth: await auth().getClient() });
}

// Main tab columns (1-indexed): B Item ID, C Category, D Make, E Model,
// F Description, N Suggested Price, O Status.
export async function readAvailable() {
  const sheets = await sheetsClient();
  const id = sheetId();
  const tab = process.env.GOOGLE_SHEETS_TAB || 'Main';
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: `${tab}!A4:O500`
  });
  const rows = data.values || [];
  return rows
    .filter((r) => r[14] === 'Tested Working') // O = Status
    .map((r) => ({
      id: r[1], lot: r[0], category: r[2], make: r[3], model: r[4],
      description: r[5], condition: 'Tested & Working',
      price: Math.round(parseFloat((r[13] || '0').toString().replace(/[$,]/g, '')) || 0)
    }))
    .filter((u) => u.id && u.price > 0);
}

// Find a unit's row by Item ID (col B) and write Sold + price + date.
export async function writeSold(unitId, soldPrice) {
  const sheets = await sheetsClient();
  const id = sheetId();
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
// Keeps accidental writes out of the master tracker until explicitly enabled.
export function writebackEnabled() {
  return process.env.SHEET_WRITEBACK === '1' && sheetsConfigured();
}
