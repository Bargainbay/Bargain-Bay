// Minimal RFC4180 CSV parser + master-tracker → units mapping (keyless inventory
// import). Mirrors lib/sheets.readAvailable: only sellable rows (see
// isSellableStatus), same condition normalization and money parsing.

// What the storefront sells: ANY status the tracker spells as Tested Working,
// whatever follows it (owner, 2026-09-28). "Tested Working", "Tested Working -
// Needs Cleaning", "Tested Working - Refurbished" all go on sale, all go green
// on the tracker and all reach the Available Inventory tab. The trailing part is
// the shop telling itself what is left to do to the machine; it is not a second
// opinion about whether the machine works.
//
// It used to be a fixed list of three, and the list is what this replaces. A
// status is typed by a person under a dropdown that does not offer every
// wording, so the list could only ever be behind reality — and being behind it
// is SILENT: `parseTrackerCsv` counts the row as not-tested and drops it, the
// sheet's AvailRank formula skips it, and the unit is simply absent with nothing
// anywhere saying why. That is how one Frigidaire (SS-114238-008, "Tested
// Working - Refurbished") sat off the site for a day looking like a bug in the
// sync.
//
// The prefix is what makes this safe, not a list: "Tested Not Working - Needs
// Parts" does not start with "Tested Working", so the whole not-working family
// is still excluded by the same test. Matching stays case- and
// whitespace-tolerant, and the boundary check stops a word that merely BEGINS
// with it from counting.
//
// The real gate on publishing was never this string anyway — it is the PRICE. A
// row with no Condition has no Condition % and therefore no Suggested Sale
// Price, and a priceless row is dropped whatever its status says. A unit nobody
// has graded cannot reach the website through this.
export const LIVE_STATUS = 'tested working';

// The two statuses that mean "sellable, but the floor has not finished with it".
// They are NOT what decides publishing — every Tested Working row publishes —
// they exist so the sync's diagnostics can tell a unit nobody has graded YET
// (normal, `skippedUngraded`) from a finished unit that has somehow lost its
// price (`skippedNoPrice`, the warning that exists because renaming the Settings
// tab's pricing tiers silently delisted 61 units on 2026-09-10).
export const IN_PROGRESS_STATUSES = ['tested working - needs cleaning', 'tested working - needs qa'];

// Case-insensitive, runs of whitespace collapsed. "tested working",
// "Tested  Working" and "TESTED WORKING" are one status.
export const normStatus = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Does this status put the unit on sale? See LIVE_STATUS above.
export function isSellableStatus(v) {
  const s = normStatus(v);
  if (!s.startsWith(LIVE_STATUS)) return false;
  const rest = s.slice(LIVE_STATUS.length);
  // A separator or nothing — so "Tested Working - Refurbished" counts and a
  // hypothetical "Tested Workingish" does not.
  return rest === '' || !/^[a-z0-9]/.test(rest);
}

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
// Parse a percentage cell ("70.0%", "70", "0.7") into a 0..1 multiplier.
const percent = (v) => {
  const s = String(v == null ? '' : v).replace(/[%\s,]/g, '');
  let n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (n > 1.5) n = n / 100; // "70" -> 0.70, "80" -> 0.80; "0.7" stays 0.7
  return n > 0 ? n : null;
};
const mapCondition = (v) => {
  const c = String(v || '').trim();
  if (!c) return 'Tested & Working';
  // ONE word for cosmetic-damage stock. The tracker's wording has drifted over
  // time — the pricing sheet says "Scratch and Dent", older rows say
  // "Scratch & Dent" — and this used to collapse anything containing "scratch"
  // onto the retired term, which would have quietly rewritten the current one on
  // its way to the website. Every spelling now lands on the term we actually use.
  if (/scratch/i.test(c)) return 'New Scratch & Dent';
  // "Used" is retired: the machine is the same, the word was wrong. Doing it here
  // migrates every live listing on the next sync, including any whose tracker row
  // nobody edits.
  if (/^used$/i.test(c)) return 'Refurbished';
  return c;
};

// Parse a CSV export of the master tracker's Main tab into units.
// opts.status: which Status(es) to keep — a string or a list, matched EXACTLY
// (callers that pass one mean one: 'salvage for parts only', 'Untested'). Left
// out, the storefront rule applies: isSellableStatus, i.e. anything Tested
// Working. opts.requirePrice: drop rows without a Suggested Sale Price (default
// true — set false for salvage).
export function parseTrackerCsv(text, opts = {}) {
  const asked = opts.status ? [opts.status].flat().filter(Boolean) : null;
  const wanted = asked ? new Set(asked.map(normStatus)) : null;
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
    conditionPct: find(/condition\s*%/i),
    price: find(/suggested/i),
    status: find(/^status/i),
    cost: find(/total cost/i),
    image: find(/photo|image|picture|img|^link$|photo ?link/i)
  };
  if (col.sku < 0 || col.status < 0 || (requirePrice && col.price < 0)) {
    throw new Error('CSV is missing required columns (need Item ID / SKU, Status' + (requirePrice ? ', and Suggested Sale Price' : '') + ').');
  }
  const at = (r, idx) => (idx >= 0 && idx < r.length ? (r[idx] || '').trim() : '');
  const norm = normStatus;
  const isWantedStatus = wanted ? (v) => wanted.has(norm(v)) : isSellableStatus;

  const units = [];
  // Diagnostics so the importer can explain exactly what it kept and skipped.
  // skippedNoPrice is the warning that matters: a row the shop considers
  // FINISHED that the site will not show. A unit still in cleaning or QA with no
  // Condition is simply not graded yet, which is normal — it is counted as
  // skippedUngraded instead, or the one warning worth reading becomes noise.
  // stillFinishing: imported units that are on sale while in cleaning or QA.
  const report = { dataRows: 0, imported: 0, byStatus: {}, skippedNotTested: 0, skippedNoPrice: 0, skippedUngraded: 0, skippedNoId: 0, stillFinishing: 0 };
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    report.dataRows++;
    const statusRaw = at(r, col.status) || '(blank)';
    report.byStatus[statusRaw] = (report.byStatus[statusRaw] || 0) + 1;

    if (!isWantedStatus(at(r, col.status))) { report.skippedNotTested++; continue; }
    const id = at(r, col.sku);
    if (!id) { report.skippedNoId++; continue; }
    // Price = Retail Price × Condition % — the tracker's own pricing rule
    // ("Condition % and Suggested Sale Price auto-fill from the Settings tab
    // pricing tiers"). We derive it ourselves instead of trusting the
    // "Suggested Sale Price" cell, because that formula can be (and was)
    // overwritten with a flat value that ignores the condition tier — which
    // made every unit of a model price identically regardless of condition.
    // For correctly-filled rows this equals the Suggested cell exactly. When a
    // row has no usable Condition %, fall back to the Suggested Sale Price cell.
    const retail = money(at(r, col.compareAt));
    const pct = col.conditionPct >= 0 ? percent(at(r, col.conditionPct)) : null;
    const computed = retail > 0 && pct ? Math.round(retail * pct * 100) / 100 : 0;
    const price = computed > 0 ? computed : money(at(r, col.price));
    // Deliberately the two in-progress statuses only, NOT "has a suffix": a
    // "Tested Working - Refurbished" unit is finished, so a missing price on it
    // is the alarm, not the normal state of an ungraded row.
    const finishing = IN_PROGRESS_STATUSES.includes(norm(at(r, col.status)));
    if (requirePrice && price <= 0) {
      if (finishing) report.skippedUngraded++; else report.skippedNoPrice++;
      continue;
    }
    if (finishing) report.stillFinishing++;
    units.push({
      id,
      make: at(r, col.make),
      model: at(r, col.model),
      category: at(r, col.category),
      title: at(r, col.title),
      condition: mapCondition(at(r, col.condition)),
      price,
      compareAt: retail,
      cost: money(at(r, col.cost)),
      uid: at(r, col.uid) || null,
      imageUrl: at(r, col.image) || null
    });
  }
  report.imported = units.length;
  return { units, report };
}
