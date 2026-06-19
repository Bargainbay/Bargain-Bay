// Minimal RFC4180 CSV parser + master-tracker → units mapping (keyless inventory
// import). Mirrors lib/sheets.readAvailable: only "Tested Working" rows, same
// condition normalization and money parsing.

export function parseCsv(text) {
  const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const money = (v) => {
  const n = parseFloat(String(v == null ? '' : v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const mapCondition = (v) => {
  const c = String(v || '').trim();
  if (!c) return 'Tested & Working';
  if (/scratch/i.test(c)) return 'Scratch & Dent';
  return c;
};

// Parse a CSV export of the master tracker's Main tab into units.
// opts.status: which Status to keep (default 'tested working'); opts.requirePrice:
// drop rows without a Suggested Sale Price (default true — set false for salvage).
export function parseTrackerCsv(text, opts = {}) {
  const wantStatus = String(opts.status || 'tested working').toLowerCase().replace(/\s+/g, ' ').trim();
  const requirePrice = opts.requirePrice !== false;
  const rows = parseCsv(text).filter((r) => r.some((c) => (c || '').trim()));
  const headerIdx = rows.findIndex(
    (r) => r.some((c) => /item id|sku/i.test(c)) && r.some((c) => /status/i.test(c))
  );
  if (headerIdx < 0) {
    throw new Error('Could not find the header row — make sure you exported the tracker tab with columns like "Item ID / SKU", "Model", "Status".');
  }
  const header = rows[headerIdx].map((h) => (h || '').trim());
  const find = (re, notRe) => header.findIndex((h) => re.test(h) && (!notRe || !notRe.test(h)));
  const col = {
    sku: find(/item id|sku/i),
    category: find(/^category/i),
    make: find(/^make/i),
    model: find(/^model/i),
    title: find(/description/i),
    uid: find(/serial/i),
    compareAt: find(/retail/i),
    condition: find(/condition/i, /%/),
    price: find(/suggested/i),
    status: find(/^status/i),
    cost: find(/total cost/i)
  };
  if (col.sku < 0 || col.status < 0 || (requirePrice && col.price < 0)) {
    throw new Error('CSV is missing required columns (need Item ID / SKU, Status' + (requirePrice ? ', and Suggested Sale Price' : '') + ').');
  }
  const at = (r, idx) => (idx >= 0 && idx < r.length ? (r[idx] || '').trim() : '');
  // Tolerant status match: case-insensitive + collapse runs of whitespace, so
  // "tested working", "Tested  Working", "TESTED WORKING" all count. Avoids
  // silently dropping units over cosmetic spelling in the tracker.
  const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const isWantedStatus = (v) => norm(v) === wantStatus;

  const units = [];
  // Diagnostics so the importer can explain exactly what it kept and skipped.
  const report = { dataRows: 0, imported: 0, byStatus: {}, skippedNotTested: 0, skippedNoPrice: 0, skippedNoId: 0 };
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    report.dataRows++;
    const statusRaw = at(r, col.status) || '(blank)';
    report.byStatus[statusRaw] = (report.byStatus[statusRaw] || 0) + 1;

    if (!isWantedStatus(at(r, col.status))) { report.skippedNotTested++; continue; }
    const id = at(r, col.sku);
    if (!id) { report.skippedNoId++; continue; }
    const price = money(at(r, col.price));
    if (requirePrice && price <= 0) { report.skippedNoPrice++; continue; }
    units.push({
      id,
      make: at(r, col.make),
      model: at(r, col.model),
      category: at(r, col.category),
      title: at(r, col.title),
      condition: mapCondition(at(r, col.condition)),
      price,
      compareAt: money(at(r, col.compareAt)),
      cost: money(at(r, col.cost)),
      uid: at(r, col.uid) || null
    });
  }
  report.imported = units.length;
  return { units, report };
}
