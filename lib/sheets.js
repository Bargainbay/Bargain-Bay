// Google Sheets read/write for the master tracker (now a NATIVE Google Sheet).
//   The tracker used to be an uploaded .xlsx, which the Sheets API can't write —
//   so we downloaded its bytes (SheetJS) to read and couldn't write back. Now it's
//   a native Sheet, so we read AND write through the Sheets API: read the Main tab
//   values, turn them into CSV, and reuse lib/csv.parseTrackerCsv (shared with the
//   keyless CSV import). Writing (append a unit / set Status) needs the sheet
//   shared with the service account as Editor.
import { google } from 'googleapis';
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

function trackerTab() {
  return process.env.GOOGLE_SHEETS_TAB || 'Main';
}

// Turn a 2D array of cell values into a CSV string (RFC4180 quoting), so the
// shared parseTrackerCsv can consume it unchanged.
function rowsToCsv(rows) {
  return (rows || [])
    .map((r) => (r || [])
      .map((cell) => {
        const s = cell == null ? '' : String(cell);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(','))
    .join('\n');
}

// Read the tracker's Main tab via the Sheets API and return it as CSV. Computed
// (formula) cells come back as their values. Needs Viewer access for the SA.
export async function trackerTabCsv() {
  const sheets = await sheetsClient();
  const tab = trackerTab();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sourceFileId(),
    range: tab,
    valueRenderOption: 'FORMATTED_VALUE',
    majorDimension: 'ROWS'
  });
  const rows = res.data.values || [];
  if (!rows.length) {
    throw new Error(`Tracker tab "${tab}" came back empty — check SHEET_ID and that the sheet is shared with the sync service account.`);
  }
  return rowsToCsv(rows);
}

// Tested-Working, priced units for the storefront catalog.
export async function readAvailable() {
  const { units } = parseTrackerCsv(await trackerTabCsv());
  return units;
}

// "Salvage For Parts Only" units (no price required) for the salvage workflow.
export async function readSalvage() {
  const { units } = parseTrackerCsv(await trackerTabCsv(), { status: 'salvage for parts only', requirePrice: false });
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
export function writebackEnabled() {
  return process.env.SHEET_WRITEBACK === '1' && sheetsConfigured();
}

// ── Intake: append units & flip Status, in the tracker's Main tab ────────────
// We only ever WRITE the YELLOW (input) cells — Condition %, Suggested Price and
// Total Cost are formulas and are never written as values. New rows get those
// formulas copy-pasted from the template row instead (see MAIN_FORMULA_COLS),
// because a values write alone does not extend a table's formulas.
const colA1 = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// ── Main-tab formula columns ─────────────────────────────────────────────────
// A values write through the Sheets API does NOT extend a table's formulas the
// way a row typed in the UI does, so every row this app appends is born with all
// of its white (formula) cells empty. Two things break silently as a result:
//   * M/N (Condition %, Suggested Sale Price) — the unit has no price, so
//     parseTrackerCsv drops it and it never reaches the storefront;
//   * AF (AvailRank) — the tracker's own "Available Inventory" and
//     "Shopify Export" tabs INDEX/MATCH on this running counter, so a row with a
//     blank AF is invisible to them. That is what made the tracker report fewer
//     available units than the site was syncing.
// Column B (Item ID / SKU) is deliberately NOT in this list: the intake path
// writes real SKUs there as literal values and the sheet's own fill-down formula
// (lot number + sequence) would clobber them.
const MAIN_FORMULA_COLS = [
  12, 13,          // M Condition %              N Suggested Sale Price
  21, 22,          // V Labor Cost               W Total Cost
  25, 26, 27, 28,  // Z Days in Inventory  AA Profit  AB Margin %  AC Markup %
  31               // AF AvailRank — the "Available Inventory" tab's spine
];
// A..AF — the span carrying the Condition / Status / Tested? / Cleaned? /
// Repaired? dropdowns. API-appended rows fall outside the existing validation
// ranges, which matters because the storefront sync matches Status as the exact
// string "Tested Working" and a hand-typed variant silently delists the unit.
const MAIN_VALIDATION_SPAN = [0, 32];

// Resolve a tab's numeric sheetId — copyPaste addresses sheets by id, not name.
async function mainSheetId(sheets, tab) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sourceFileId(),
    fields: 'sheets.properties(sheetId,title)'
  });
  const hit = (meta.data.sheets || []).find((s) => s.properties?.title === tab);
  if (!hit) throw new Error(`Tracker tab "${tab}" not found in the spreadsheet.`);
  return hit.properties.sheetId;
}

// [1,2,3,7,8] -> [[1,3],[7,8]] — collapse row numbers into contiguous runs so a
// repair spanning N scattered rows costs a handful of requests, not N.
function rowRuns(list) {
  const out = [];
  for (const n of [...new Set(list)].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}

const copyPasteReq = (sheetId, templateRow, [from, to], c0, c1, pasteType) => ({
  copyPaste: {
    source: { sheetId, startRowIndex: templateRow - 1, endRowIndex: templateRow, startColumnIndex: c0, endColumnIndex: c1 },
    destination: { sheetId, startRowIndex: from - 1, endRowIndex: to, startColumnIndex: c0, endColumnIndex: c1 },
    pasteType
  }
});

// Carry the template row's formulas (and, for `validationRows`, its dropdowns)
// onto the given 1-based sheet rows. copyPaste tiles the one-row source across
// the destination and rewrites each relative reference per row — which is
// exactly what a plain values write cannot do.
// rowsByCol: { [columnIndex]: rowNumber[] }.
async function pasteMainFormulas(sheets, sheetId, templateRow, rowsByCol, validationRows = []) {
  const requests = [];
  for (const [col, rowList] of Object.entries(rowsByCol || {})) {
    const c = Number(col);
    for (const run of rowRuns(rowList)) requests.push(copyPasteReq(sheetId, templateRow, run, c, c + 1, 'PASTE_FORMULA'));
  }
  for (const run of rowRuns(validationRows)) {
    requests.push(copyPasteReq(sheetId, templateRow, run, MAIN_VALIDATION_SPAN[0], MAIN_VALIDATION_SPAN[1], 'PASTE_DATA_VALIDATION'));
  }
  if (!requests.length) return 0;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: sourceFileId(), requestBody: { requests } });
  return requests.length;
}

// Backfill every formula cell that a past API append left empty, across all rows
// that hold a unit, and re-apply the dropdowns over the same rows. Idempotent and
// safe to re-run: an EMPTY cell is filled, a cell already holding a formula is
// left alone, and a cell holding a literal is treated as a deliberate manual
// override (a hand-typed Suggested Sale Price, for one) and preserved.
export async function repairTrackerFormulas() {
  const { sheets, sheetId, rows, headerIdx, idx, templateRow } = await loadMain({ render: 'FORMULA' });
  const at = (r, c) => String(r && r[c] != null ? r[c] : '').trim();

  let lastUnitRow = headerIdx;
  for (let i = headerIdx + 1; i < rows.length; i++) if (at(rows[i], idx.sku)) lastUnitRow = i;
  if (lastUnitRow <= headerIdx) return { rows: 0, cells: 0, requests: 0, unitRows: 0, byColumn: {} };

  const rowsByCol = {};
  const unitRows = [];
  for (let i = headerIdx + 1; i <= lastUnitRow; i++) {
    if (!at(rows[i], idx.sku)) continue; // never seed formulas onto an empty row
    unitRows.push(i + 1);
    for (const c of MAIN_FORMULA_COLS) {
      if (at(rows[i], c) !== '') continue;
      (rowsByCol[c] = rowsByCol[c] || []).push(i + 1);
    }
  }
  const requests = await pasteMainFormulas(sheets, sheetId, templateRow, rowsByCol, unitRows);
  const byColumn = {};
  let cells = 0;
  for (const [c, list] of Object.entries(rowsByCol)) { byColumn[colA1(Number(c))] = list.length; cells += list.length; }
  return {
    rows: new Set(Object.values(rowsByCol).flat()).size,
    cells,
    requests,
    unitRows: unitRows.length,
    byColumn
  };
}

// Read the Main tab and locate the header row + the columns we write/match.
// `render` maps to the API's valueRenderOption — pass 'FORMULA' to see which
// cells actually hold a formula (the default returns a formula's *result*, which
// makes an empty formula cell and a missing one indistinguishable).
async function loadMain({ render } = {}) {
  const sheets = await sheetsClient();
  const tab = trackerTab();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sourceFileId(),
    range: tab,
    majorDimension: 'ROWS',
    ...(render ? { valueRenderOption: render } : {})
  });
  const rows = res.data.values || [];
  const headerIdx = rows.findIndex((r) => r.some((c) => /item id|sku/i.test(c || '')) && r.some((c) => /status/i.test(c || '')));
  if (headerIdx < 0) throw new Error('Could not find the tracker header row (need "Item ID / SKU" and "Status").');
  const header = rows[headerIdx].map((h) => (h || '').trim());
  const find = (re, notRe) => header.findIndex((h) => re.test(h) && (!notRe || !notRe.test(h)));
  const idx = {
    lot: find(/lot/i), sku: find(/item id|sku/i), category: find(/^category/i), make: find(/^make/i),
    model: find(/^model/i), description: find(/description/i), serial: find(/serial/i),
    vendor: find(/vendor|supplier/i), invoice: find(/invoice/i), dateReceived: find(/date received/i),
    retail: find(/retail/i), condition: find(/condition/i, /%/), status: find(/^status/i),
    cost: find(/cost of product/i), soldPrice: find(/sold price/i), dateSold: find(/date sold/i)
  };
  // Formula/validation pastes address the tab by numeric sheetId, not by name.
  const sheetId = await mainSheetId(sheets, tab);
  return { sheets, tab, sheetId, rows, headerIdx, idx, templateRow: headerIdx + 2 };
}

// Mark a batch of units Sold by Item ID — Status='Sold', Sold Price, Date Sold.
// Columns are detected by header (robust to where the data starts). Best-effort:
// items not found are skipped. items = [{ sku, price }].
export async function writeSoldRows(items = []) {
  const list = (items || []).filter((it) => it && it.sku);
  if (!list.length) return { written: 0 };
  const { sheets, tab, rows, headerIdx, idx } = await loadMain();
  const today = new Date().toISOString().slice(0, 10);
  const data = [];
  let written = 0;
  for (const it of list) {
    let target = -1;
    for (let i = headerIdx + 1; i < rows.length; i++) if ((rows[i][idx.sku] || '').trim() === String(it.sku).trim()) { target = i; break; }
    if (target < 0) continue;
    const row = target + 1;
    data.push({ range: `${tab}!${colA1(idx.status)}${row}`, values: [['Sold']] });
    if (idx.soldPrice >= 0 && it.price != null && it.price !== '') data.push({ range: `${tab}!${colA1(idx.soldPrice)}${row}`, values: [[it.price]] });
    if (idx.dateSold >= 0) data.push({ range: `${tab}!${colA1(idx.dateSold)}${row}`, values: [[it.dateSold || today]] });
    written++;
  }
  if (!data.length) return { written: 0 };
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sourceFileId(),
    requestBody: { valueInputOption: 'USER_ENTERED', data }
  });
  return { written };
}

// Update a unit's Cost of Product by Item ID (e.g. a consignment cost correction).
export async function setTrackerCost(sku, amount) {
  const { sheets, tab, rows, headerIdx, idx } = await loadMain();
  if (idx.cost < 0) throw new Error('No "Cost of Product" column found in the tracker.');
  let target = -1;
  for (let i = headerIdx + 1; i < rows.length; i++) if ((rows[i][idx.sku] || '').trim() === String(sku).trim()) { target = i; break; }
  if (target < 0) throw new Error(`Unit ${sku} not found in the tracker.`);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sourceFileId(),
    requestBody: { valueInputOption: 'USER_ENTERED', data: [{ range: `${tab}!${colA1(idx.cost)}${target + 1}`, values: [[amount]] }] }
  });
  return { sku, cost: amount };
}

// Append a unit as a new row of yellow cells, Status defaulting to 'Untested'
// (so it stays off the storefront until tested-working). Returns the row number.
export async function appendTrackerUnit(u = {}) {
  const { created } = await appendTrackerUnits([u]);
  return created[0];
}

// Append many units with ONE sheet read + ONE batched write. Going through
// appendTrackerUnit re-reads the whole grid per row, so committing a 60-line
// purchase invoice that way takes 60+ round-trips and times out the request.
export async function appendTrackerUnits(units = []) {
  const list = (Array.isArray(units) ? units : []).filter(Boolean);
  if (!list.length) return { created: [] };
  const { sheets, tab, sheetId, rows, headerIdx, idx, templateRow } = await loadMain();
  let last = headerIdx;
  for (let i = headerIdx + 1; i < rows.length; i++) if ((rows[i][idx.sku] || '').trim()) last = i;
  let row = last + 2; // 1-based sheet row just after the last filled unit
  const firstRow = row;
  const today = new Date().toISOString().slice(0, 10);
  const data = [];
  const created = [];
  for (const u of list) {
    const set = {
      lot: u.lot, sku: u.sku, category: u.category, make: u.make, model: u.model,
      description: u.description || [u.make, u.model].filter(Boolean).join(' '),
      serial: u.serial, vendor: u.vendor, invoice: u.invoice,
      dateReceived: u.dateReceived || today,
      retail: u.retail, condition: u.condition, status: u.status || 'Untested', cost: u.cost
    };
    for (const [field, val] of Object.entries(set)) {
      if (val === undefined || val === null || val === '') continue;
      if (idx[field] < 0) continue;
      data.push({ range: `${tab}!${colA1(idx[field])}${row}`, values: [[val]] });
    }
    created.push({ sku: set.sku, row });
    row++;
  }
  // Seed the formula columns and the dropdowns on the new rows BEFORE the values
  // land, so the row is a complete table row rather than a bare set of inputs.
  // Without this a value-only append leaves Condition %/Suggested Sale Price
  // empty (the unit gets no price and the storefront sync silently skips it) and
  // AvailRank empty (the tracker's own "Available Inventory" tab can't see it, so
  // the sheet under-reports what is in stock). Best-effort: if the paste fails the
  // append still goes through and repairTrackerFormulas() can backfill it.
  const newRows = [];
  for (let r = firstRow; r < row; r++) newRows.push(r);
  const rowsByCol = {};
  for (const c of MAIN_FORMULA_COLS) rowsByCol[c] = newRows;
  try {
    await pasteMainFormulas(sheets, sheetId, templateRow, rowsByCol, newRows);
  } catch (e) {
    console.error('tracker formula seed failed (rows appended without formulas)', e?.message || e);
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sourceFileId(),
    requestBody: { valueInputOption: 'USER_ENTERED', data }
  });
  return { created };
}

// Flip a unit's Status (and optionally Condition) by its Item ID / SKU.
export async function setTrackerStatus(sku, { status, condition } = {}) {
  const { sheets, tab, rows, headerIdx, idx } = await loadMain();
  let target = -1;
  for (let i = headerIdx + 1; i < rows.length; i++) if ((rows[i][idx.sku] || '').trim() === String(sku).trim()) { target = i; break; }
  if (target < 0) throw new Error(`Unit ${sku} not found in the tracker.`);
  const row = target + 1;
  const data = [];
  if (status) data.push({ range: `${tab}!${colA1(idx.status)}${row}`, values: [[status]] });
  if (condition && idx.condition >= 0) data.push({ range: `${tab}!${colA1(idx.condition)}${row}`, values: [[condition]] });
  if (!data.length) return { sku, changed: false };
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sourceFileId(),
    requestBody: { valueInputOption: 'USER_ENTERED', data }
  });
  return { sku, changed: true };
}

// Units at a given Status (no price required) — used to list pending intake.
export async function readByStatus(status) {
  const { units } = parseTrackerCsv(await trackerTabCsv(), { status, requirePrice: false });
  return units;
}
