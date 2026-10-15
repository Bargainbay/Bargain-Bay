// Bulk upload of marketplace listings. See docs/marketplace/PLAN.md §7.5.
//
// A vendor with forty units should not click "+ New listing" forty times. They fill in a
// spreadsheet, we show them every row and every problem, and only then are DRAFTS created.
//
// What this module is NOT: a second set of rules. Every row goes through the same
// `normalizeFields` / `validateForSubmit` / `tierProblem` the single-listing path uses, so the
// two cannot disagree about what a listing needs. The only thing left out is the photo check:
// photos cannot ride a spreadsheet, and a draft with none cannot be submitted anyway.
import { createHash } from 'node:crypto';
import { query } from './db';
import { sniffDelimiter, cell as cleanCell } from './stop-import';
import { readXlsx } from './xlsx-lite';
import { canSell } from './marketplace-rules';
import { mustAccept } from './policy-acceptance';
import { createDraft } from './marketplace-listings';
import {
  normalizeFields, validateForSubmit, tierProblem, MARKET_CATEGORIES, LISTING_CONDITIONS, OCCUPYING_STATUSES
} from './listing-rules';

export const BULK_MAX_ROWS = 100;
export const BULK_MAX_CHARS = 1_000_000;
export const EXAMPLE_SERIAL = 'EXAMPLE-SERIAL-DELETE-THIS-ROW';

// key (the camelCase field normalizeFields takes) <- template heading and the other names
// people type. Matching ignores case and punctuation.
export const BULK_COLUMNS = [
  { key: 'category', head: 'category', required: true, text: true, aliases: ['type', 'appliance type'] },
  { key: 'make', head: 'make', required: true, text: true, aliases: ['brand', 'manufacturer'] },
  { key: 'model', head: 'model', required: true, text: true, aliases: ['model number', 'model no'] },
  { key: 'serial', head: 'serial', required: true, text: true, aliases: ['serial number', 'serial no', 'sn'] },
  { key: 'condition', head: 'condition', required: true, text: true },
  { key: 'title', head: 'title', required: true, text: true },
  { key: 'description', head: 'description', required: true, text: true },
  { key: 'price', head: 'price', required: true, num: true, aliases: ['your price', 'price cad'] },
  { key: 'compareAt', head: 'compare_at', num: true, aliases: ['retail price', 'retail', 'msrp'] },
  { key: 'compareAtSource', head: 'compare_at_source', text: true, aliases: ['retail source', 'retail price source'] },
  { key: 'widthIn', head: 'width_in', required: true, num: true, aliases: ['width', 'width in'] },
  { key: 'depthIn', head: 'depth_in', required: true, num: true, aliases: ['depth', 'depth in'] },
  { key: 'heightIn', head: 'height_in', required: true, num: true, aliases: ['height', 'height in'] },
  { key: 'weightLb', head: 'weight_lb', required: true, num: true, aliases: ['weight', 'weight lb', 'weight lbs'] },
  { key: 'warrantyMonths', head: 'warranty_months', required: true, num: true, aliases: ['warranty'] },
  { key: 'lane', head: 'lane', required: true, text: true, aliases: ['fulfilment', 'fulfillment'] },
  { key: 'testedWorking', head: 'tested_working', required: true, bool: true, aliases: ['tested', 'working'] },
  { key: 'testNotes', head: 'test_notes', required: true, text: true, aliases: ['how tested'] },
  { key: 'testedOn', head: 'tested_on', date: true, aliases: ['date tested'] },
  { key: 'refurbNotes', head: 'refurb_notes', text: true, aliases: ['refurbishment notes', 'work done'] },
  { key: 'deliveryNotes', head: 'delivery_notes', text: true, aliases: ['handover notes'] },
  { key: 'pickupAddress', head: 'pickup_address', text: true },
  { key: 'pickupCity', head: 'pickup_city', text: true },
  { key: 'pickupPostal', head: 'pickup_postal', text: true, aliases: ['pickup postal code'] }
];

const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const BY_HEAD = new Map();
for (const c of BULK_COLUMNS) {
  BY_HEAD.set(fold(c.head), c);
  for (const a of c.aliases || []) BY_HEAD.set(fold(a), c);
}

// --- the template -------------------------------------------------------------

const EXAMPLE = {
  category: 'Refrigerator', make: 'Whirlpool', model: 'WRF535SWHZ', serial: EXAMPLE_SERIAL, condition: 'Refurbished',
  title: 'Whirlpool WRF535SWHZ — French door fridge, 36", stainless',
  description: 'Deep cleaned, new door gasket fitted, cools to temperature. Small scratch on the left side panel.',
  price: 899, compareAt: 1799, compareAtSource: 'https://example.com/whirlpool-wrf535',
  widthIn: 36, depthIn: 34, heightIn: 70, weightLb: 280, warrantyMonths: 12, lane: 'A', testedWorking: 'yes',
  testNotes: 'Ran 24 hours; freezer -18C, fridge 3C', testedOn: '2026-10-01', refurbNotes: 'Deep cleaned, replaced door gasket',
  deliveryNotes: 'Ground floor, double doors, no steps', pickupAddress: '', pickupCity: '', pickupPostal: ''
};

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The downloadable template: every column, and one worked example row to delete. */
export function bulkTemplateCsv() {
  const head = BULK_COLUMNS.map((c) => c.head).join(',');
  const row = BULK_COLUMNS.map((c) => csvCell(EXAMPLE[c.key])).join(',');
  return `﻿${head}\r\n${row}\r\n`;
}

/** Plain-language help for each column, shown beside the template link. */
export function bulkColumnHelp() {
  return {
    category: `One of: ${MARKET_CATEGORIES.join(', ')}.`,
    condition: `One of: ${LISTING_CONDITIONS.join(', ')}.`,
    lane: 'A (we hold it), B (we collect it from you) or C (you ship it).',
    tested_working: 'yes, once the unit has been tested and works.',
    price: 'CAD, before tax. Numbers only.',
    tested_on: 'YYYY-MM-DD (optional).',
    serial: 'Private. Never shown to customers.'
  };
}

// --- reading a file -----------------------------------------------------------

/**
 * Text -> grid of cells. A quote only OPENS a field when it is the field's first character
 * (36" is inches, not a quote — the stop importer's landmine), a quoted field may contain
 * the delimiter and line breaks, and Excel error literals are blanked.
 */
export function parseGrid(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = src.split('\n').find((l) => l.trim() !== '') || '';
  const delim = sniffDelimiter(first);
  const grid = [];
  let row = []; let cur = ''; let quoted = false; let atStart = true; let wasQuoted = false;
  const endField = () => { row.push(cleanCell(wasQuoted ? cur : cur.trim())); cur = ''; atStart = true; wasQuoted = false; };
  const endRow = () => {
    endField();
    if (row.some((c) => c !== '')) grid.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && atStart) {
      quoted = true; wasQuoted = true; atStart = false;
    } else if (ch === delim) {
      endField();
    } else if (ch === '\n') {
      endRow();
    } else {
      cur += ch; if (ch.trim() !== '') atStart = false;
    }
  }
  if (cur !== '' || row.length) endRow();
  return grid;
}

/** An .xlsx, as the same text a paste would be, so preview and confirm share one path. */
export function xlsxToText(buffer) {
  const { rows } = readXlsx(buffer);
  return rows.map((r) => r.map((c) => String(c ?? '').replace(/[\t\r\n]+/g, ' ').trim()).join('\t')).join('\n');
}

// Formula characters at the front of a text cell are removed: a spreadsheet that later opens an
// export of this data would run them (CSV injection). Numbers are parsed, never passed through.
const FORMULA = /^[=+@\t\r]+/;

function parseNumber(raw) {
  const s = String(raw).replace(/[$,\s]/g, '').replace(/(lbs?|in|inch(es)?|"|cad)$/i, '');
  if (s === '') return { value: null };
  const n = Number(s);
  return Number.isFinite(n) ? { value: n } : { bad: true };
}

const YES = /^(y|yes|true|1|x|✓)$/i;
const NO = /^(n|no|false|0)$/i;

/**
 * Parsed table -> { columns, ignored, fileProblems, rows[{ row, cells, input, problems, warnings }] }.
 * `row` is the spreadsheet row number (the heading is row 1), so "row 7" means row 7 in Excel.
 */
export function parseBulk(text) {
  const out = { columns: [], ignored: [], fileProblems: [], rows: [] };
  if (String(text || '').length > BULK_MAX_CHARS) {
    out.fileProblems.push('That file is too large. Upload at most 100 rows at a time.');
    return out;
  }
  const grid = parseGrid(text);
  if (grid.length < 2) {
    out.fileProblems.push(grid.length ? 'The file has a heading row but no units under it.' : 'The file is empty.');
    return out;
  }
  const heads = grid[0];
  const colOf = new Map();
  heads.forEach((h, i) => {
    const c = BY_HEAD.get(fold(h));
    if (!c) { if (String(h).trim()) out.ignored.push(String(h).trim()); return; }
    if (colOf.has(c.key)) { out.fileProblems.push(`The column "${c.head}" appears twice.`); return; }
    colOf.set(c.key, i);
  });
  out.columns = [...colOf.keys()];
  const missing = BULK_COLUMNS.filter((c) => c.required && !colOf.has(c.key)).map((c) => c.head);
  if (missing.length) out.fileProblems.push(`The heading row is missing these columns: ${missing.join(', ')}. Download the template for the exact headings.`);
  const dataRows = grid.slice(1);
  if (dataRows.length > BULK_MAX_ROWS) {
    out.fileProblems.push(`This file has ${dataRows.length} units; the limit is ${BULK_MAX_ROWS} per upload. Split it into smaller files.`);
  }
  if (out.fileProblems.length) return out;

  dataRows.forEach((cells, idx) => {
    const problems = []; const warnings = [];
    const raw = {};
    for (const c of BULK_COLUMNS) {
      if (!colOf.has(c.key)) continue;
      let v = cleanCell(cells[colOf.get(c.key)] ?? '');
      if (c.text && FORMULA.test(v)) { v = v.replace(FORMULA, '').trim(); warnings.push({ field: c.head, text: `Leading formula characters were removed from ${c.head}.` }); }
      if (c.num) {
        const p = parseNumber(v);
        if (p.bad) { problems.push({ field: c.key, text: `"${v}" is not a number in ${c.head}.` }); v = ''; } else v = p.value == null ? '' : p.value;
      } else if (c.bool) {
        if (YES.test(v)) v = true; else if (v === '' || NO.test(v)) v = false;
        else { problems.push({ field: c.key, text: `${c.head} must be yes or no.` }); v = false; }
      } else if (c.date && v) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) { problems.push({ field: c.key, text: `${c.head} must look like 2026-10-01.` }); v = ''; }
      }
      raw[c.key] = v;
    }
    // Names that differ only in case or spacing are the same thing.
    if (raw.category) raw.category = MARKET_CATEGORIES.find((m) => m.toLowerCase() === String(raw.category).toLowerCase()) || raw.category;
    if (raw.condition) raw.condition = LISTING_CONDITIONS.find((m) => m.toLowerCase() === String(raw.condition).toLowerCase()) || raw.condition;
    if (raw.lane) raw.lane = String(raw.lane).trim().toUpperCase().slice(0, 1) || raw.lane;
    if (raw.serial === EXAMPLE_SERIAL) problems.push({ field: 'serial', text: 'This is the example row from the template. Delete it, or replace it with a real unit.' });
    out.rows.push({ row: idx + 2, cells: raw, input: normalizeFields(raw), problems, warnings });
  });
  // A row of nothing but blanks was already dropped by parseGrid.
  return out;
}

// --- checking rows ------------------------------------------------------------

const serialKey = (s) => String(s || '').trim().toLowerCase();

/** The hash a preview hands back and a confirm must repeat: this vendor, these exact rows. */
export function batchToken(vendorId, rows) {
  const h = createHash('sha256');
  h.update(`v${vendorId}\n`);
  for (const r of rows) h.update(JSON.stringify([r.row, r.input]) + '\n');
  return h.digest('hex').slice(0, 32);
}

async function vendorRow(vendorId) {
  const { rows } = await query('SELECT status, tier FROM vendors WHERE id = $1', [vendorId]);
  if (!rows.length) throw new Error('No such vendor.');
  return rows[0];
}

/** Whether this vendor may start listings at all — the same two gates createDraft applies. */
async function gate(vendorId) {
  const v = await vendorRow(vendorId);
  if (!canSell(v.status)) throw new Error('Your account cannot list new units right now.');
  await mustAccept(vendorId);
  return v;
}

/**
 * Add every problem to every row. Never writes. Serial clashes are reported without saying who
 * holds the serial: with another vendor only "already listed"; with the vendor's own listing,
 * their own SKU (that is theirs to know).
 */
export async function checkRows(vendorId, parsed, { tier } = {}) {
  const rows = parsed.rows;
  const t = tier ?? (await vendorRow(vendorId)).tier;
  const keys = [...new Set(rows.map((r) => serialKey(r.input.serial)).filter(Boolean))];
  const mine = new Map(); const others = new Set();
  if (keys.length) {
    const { rows: hit } = await query(
      `SELECT vendor_id, sku, status, lower(btrim(serial_private)) AS k FROM marketplace_listings
        WHERE lower(btrim(serial_private)) = ANY($1) AND status NOT IN ('sold','withdrawn','rejected')`, [keys]);
    for (const h of hit) {
      if (Number(h.vendor_id) === Number(vendorId)) mine.set(h.k, h.sku);
      else if (OCCUPYING_STATUSES.includes(h.status)) others.add(h.k); // another vendor's draft is not "listed"
    }
  }
  const firstSeen = new Map();
  for (const r of rows) {
    const photoless = validateForSubmit(r.input, []).filter((p) => p.field !== 'photos');
    r.problems.push(...photoless);
    const tp = tierProblem(t, r.input.lane, 0);
    if (tp && ['A', 'B', 'C'].includes(r.input.lane)) r.problems.push({ field: 'lane', text: tp });
    const k = serialKey(r.input.serial);
    if (k) {
      if (firstSeen.has(k)) r.problems.push({ field: 'serial', text: `This serial number is also on row ${firstSeen.get(k)} of your file. Each unit has its own serial.` });
      else firstSeen.set(k, r.row);
      if (mine.has(k)) r.problems.push({ field: 'serial', text: `You already have this serial number on listing ${mine.get(k)}.` });
      if (others.has(k)) r.problems.push({ field: 'serial', text: 'This serial number is already listed. If you think that is a mistake, contact us — we do not say who else has it.' });
    }
    // The parser's own findings can duplicate the validator's ("price" empty -> "Enter a price"); keep one.
    r.problems = r.problems.filter((p, i, a) => a.findIndex((q) => q.field === p.field && q.text === p.text) === i);
    r.ok = r.problems.length === 0;
  }
  return parsed;
}

const SHOW = ['category', 'make', 'model', 'serial', 'condition', 'title', 'price', 'lane'];

/** What the browser needs to draw the preview — never the vendor id, nothing of anyone else's. */
export async function previewBulk(vendorId, text) {
  const v = await gate(vendorId);
  const parsed = parseBulk(text);
  if (parsed.fileProblems.length) {
    return { ok: false, fileProblems: parsed.fileProblems, ignored: parsed.ignored, rows: [], max: BULK_MAX_ROWS };
  }
  await checkRows(vendorId, parsed, { tier: v.tier });
  return {
    ok: true, max: BULK_MAX_ROWS, ignored: parsed.ignored, fileProblems: [],
    token: batchToken(vendorId, parsed.rows),
    counts: { rows: parsed.rows.length, ready: parsed.rows.filter((r) => r.ok).length, blocked: parsed.rows.filter((r) => !r.ok).length },
    rows: parsed.rows.map((r) => ({
      row: r.row, ok: r.ok, problems: r.problems, warnings: r.warnings,
      values: Object.fromEntries(SHOW.map((k) => [k, r.input[k] ?? null]))
    }))
  };
}

/**
 * Create drafts for the rows that pass. Per-row, not all-or-nothing: one bad serial must not
 * strand thirty good units, and the report says which rows did not go in and why.
 * Everything is re-parsed and re-checked here; the preview is only ever a courtesy.
 * Repeating the same confirm creates nothing new: each row is marked with the batch token.
 */
export async function confirmBulk(vendorId, text, token, { by } = {}) {
  const v = await gate(vendorId);
  const parsed = parseBulk(text);
  if (parsed.fileProblems.length) throw new Error(parsed.fileProblems[0]);
  const expect = batchToken(vendorId, parsed.rows);
  if (!token || token !== expect) throw new Error('This file is not the one you previewed. Preview it again before confirming.');

  // Rows an earlier confirm of this very batch already made are reported, not redone — and are
  // not re-checked, or their own serials would now read as clashes.
  const { rows: prior } = await query(
    `SELECT (e.detail->>'row')::int AS row, l.id, l.sku FROM listing_events e JOIN marketplace_listings l ON l.id = e.listing_id
      WHERE l.vendor_id = $1 AND e.event = 'bulk_row' AND e.detail->>'batch' = $2`, [vendorId, token]);
  const done = new Map(prior.map((p) => [p.row, p]));
  const todo = { rows: parsed.rows.filter((r) => !done.has(r.row)) };
  await checkRows(vendorId, todo, { tier: v.tier });

  const created = []; const already = prior.map((p) => ({ row: p.row, id: p.id, sku: p.sku })); const failed = [];
  for (const r of todo.rows) {
    if (!r.ok) { failed.push({ row: r.row, problems: r.problems }); continue; }
    try {
      const d = await createDraft(vendorId, r.input, { by, bulk: { batch: token, row: r.row } });
      (d.already ? already : created).push({ row: r.row, id: d.id, sku: d.sku });
    } catch (e) {
      failed.push({ row: r.row, problems: [{ field: 'row', text: e?.message || 'Could not create this draft.' }] });
    }
  }
  const byRow = (a, b) => a.row - b.row;
  return { ok: true, created: created.sort(byRow), already: already.sort(byRow), failed: failed.sort(byRow) };
}
