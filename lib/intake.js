// Inventory intake — the MASTER GOOGLE TRACKER is the source of truth. Adding a
// unit (vendor purchase or haul-away) appends a row to the Main tab with the
// yellow input cells filled and Status='Untested', so the tracker's formulas
// (Condition %, Suggested Price, Total Cost) auto-fill and the unit stays OFF the
// storefront. Confirming tested-working flips Status='Tested Working' and syncs,
// so the website live-updates. Requires the tracker shared with the sync service
// account as EDITOR (SHEET_ID = the native Google Sheet).
import { appendTrackerUnits, setTrackerStatus, readByStatus, sheetsConfigured } from './sheets';
import { syncInventoryFromTracker } from './catalog-sync';
import { hasDb, query } from './db';
import { recordConsignmentUnit } from './consignment';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PENDING_STATUS = 'Untested';
const LIVE_STATUS = 'Tested Working';
const REJECT_STATUS = 'Tested Not Working - Needs Diagnosis';

function notConfigured() {
  return new Error('The master tracker isn’t connected for writing yet — set SHEET_ID to the native Google Sheet and share it with the sync service account as Editor.');
}

// Add one or more pending units to the tracker. Returns the new Item IDs.
export async function addIntakeUnits({ make, model, category, condition, cost, retail, source, vendor, invoice, lot, sku, serial, description, qty = 1 }) {
  if (!sheetsConfigured()) throw notConfigured();
  const count = Math.max(1, Math.min(50, Math.round(Number(qty) || 1)));
  const isHaul = String(source || '').toLowerCase() === 'haulaway' || String(vendor || '').toLowerCase() === 'haulaway';
  const base = String(sku || lot || `IN-${Date.now().toString(36).toUpperCase()}`).trim();
  const lotNum = String(lot || base).trim();
  const units = [];
  for (let i = 0; i < count; i++) {
    units.push({
      lot: lotNum, sku: count > 1 ? `${base}-${String(i + 1).padStart(3, '0')}` : base,
      category, make, model,
      // Prefer a full, searchable description; fall back to brand + model + type
      // so a unit is always findable by appliance type (not just model number).
      description: String(description || '').trim() || [make, model, category].filter(Boolean).join(' '),
      // A serial identifies ONE physical unit — never stamp it on qty>1 copies.
      serial: count === 1 && serial ? String(serial).trim() : null,
      vendor: isHaul ? 'Haulaway' : (vendor || source || ''),
      invoice, retail, condition, cost: isHaul ? 0 : cost,
      status: PENDING_STATUS
    });
  }
  await appendTrackerUnits(units);
  return { created: units.map((u) => u.sku), count: units.length };
}

// Add a whole reviewed invoice (many lines) in ONE batched tracker write —
// looping addIntakeUnits per line costs a full sheet read per unit and times out
// the request on big invoices. All units share one lot (the invoice batch).
export async function addIntakeLines(lines, { vendor, invoice } = {}) {
  if (!sheetsConfigured()) throw notConfigured();
  const list = (Array.isArray(lines) ? lines : [])
    .filter((l) => l && (String(l.make || '').trim() || String(l.model || '').trim()));
  if (!list.length) return { created: [], count: 0 };
  const base = `IN-${Date.now().toString(36).toUpperCase()}`;
  const units = [];
  for (const l of list) {
    const qty = Math.max(1, Math.min(50, Math.round(Number(l.qty) || 1)));
    for (let i = 0; i < qty; i++) {
      units.push({
        lot: base, sku: `${base}-${String(units.length + 1).padStart(3, '0')}`,
        category: l.category, make: l.make, model: l.model,
        description: String(l.description || '').trim() || [l.make, l.model, l.category].filter(Boolean).join(' '),
        serial: qty === 1 && l.serial ? String(l.serial).trim() : null,
        vendor: l.vendor || vendor || '',
        invoice: l.invoice || invoice || null,
        retail: l.retail, cost: l.cost
        // Status and Condition deliberately unset: RS Ops writes the first one
        // (Untested, condition cleared) the moment it receives this manifest, and
        // owns both columns from then on. See lib/rsops-push.js.
      });
    }
  }
  if (units.length > 300) throw new Error(`That's ${units.length} units in one commit — split the invoice into smaller batches.`);
  await appendTrackerUnits(units);
  // `lot` and `units` come back so the caller can hand the same manifest to
  // RS Ops — re-deriving the SKUs there would be a second place to get them
  // wrong, and they are the thing both systems have to agree on.
  return { created: units.map((u) => u.sku), count: units.length, lot: base, units };
}

// ── Vendor drop-off: a unit that never goes near the refurb floor ───────────
// Some vendors simply drop appliances here — no invoice, a cost agreed verbally,
// and we pay them once the unit sells. They arrive KNOWN WORKING, so there is
// nothing for RS Ops to test, and routing them through Untested would park live,
// sellable stock in a queue waiting on an inspection nobody is going to do.
//
// So this is the one path that writes Status itself. Condition and Status
// otherwise belong to RS Ops (see setTrackerStatuses) precisely because a
// machine's state should come from the thing that tested it — and here the
// person filling the form IS the person who took it in and looked at it. It is
// deliberately a SEPARATE function rather than a flag on addIntakeUnits: an
// invoice manifest must never be able to reach this by passing an extra field.
//
// Two things are REQUIRED that are optional everywhere else, both because the
// unit is going straight on sale:
//   * condition — the tracker's price is Retail × Condition%; with no condition
//     there is no price, and lib/csv.js silently skips a priceless row. The unit
//     would be added, synced, and simply never appear, with nothing saying why.
//   * retail    — the other half of that multiplication.
// Quantity is always ONE. Every unit here is a specific machine somebody
// photographed; stamping one set of photos onto five SKUs would show a buyer a
// different appliance than the one they get.
export async function addConsignmentUnit({ make, model, category, condition, cost, retail, vendor, serial, description, note, createdBy }) {
  if (!sheetsConfigured()) throw notConfigured();
  const cond = String(condition || '').trim();
  if (!cond) throw new Error('Pick a condition — the tracker prices the unit from it, and without one it will never reach the site.');
  const price = Number(retail);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Enter the retail price — the sale price is worked out from it.');
  if (!String(make || '').trim() && !String(model || '').trim()) throw new Error('Enter at least a make or model.');

  // Millisecond clock plus three random characters. SKU is the primary key on
  // both sides, two reps can be booking a drop-off in the same breath, and a
  // collision here would silently overwrite somebody else's unit.
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  const sku = `VD-${Date.now().toString(36).toUpperCase()}${rand}`;
  await appendTrackerUnits([{
    lot: sku, sku,
    category, make, model,
    description: String(description || '').trim() || [make, model, category].filter(Boolean).join(' '),
    serial: serial ? String(serial).trim() : null,
    vendor: String(vendor || '').trim() || null,
    // There is no invoice number, and an empty Invoice cell reads as one nobody
    // has typed in yet. Say what the arrangement actually is, so whoever settles
    // up with this vendor can see from the tracker that the money is owed on
    // sale rather than already paid.
    invoice: String(note || '').trim() ? `CONSIGNMENT — ${String(note).trim()}`.slice(0, 200) : 'CONSIGNMENT',
    retail: price, condition: cond, cost,
    status: LIVE_STATUS
  }]);

  // Book it as stock we HOLD but do not OWN (lib/consignment.js). Without that
  // row the unit's cost sits on the balance sheet as an asset nobody paid for,
  // and the day it sells the ledger credits Inventory for something that was
  // never debited into it — so inventory drifts negative and the money we now
  // owe the vendor appears nowhere.
  //
  // Best-effort on purpose: the tracker row is the record of the APPLIANCE, and
  // a bookkeeping write that fails must not lose it. The tracker's CONSIGNMENT
  // marker is enough to repair this from; a rep re-typing the whole unit is not.
  let booked = true;
  try {
    await recordConsignmentUnit({ sku, vendor, cost, note, createdBy });
  } catch (e) {
    booked = false;
    console.error('consignment row not written', sku, e?.message || e);
  }
  return { sku, status: LIVE_STATUS, booked };
}

// Units sitting at 'Untested' — the intake queue awaiting a tested-working call.
export async function listIntakePending() {
  if (!sheetsConfigured()) return [];
  try {
    const units = await readByStatus(PENDING_STATUS);
    return units.map((u) => ({
      sku: u.id, make: u.make, model: u.model, category: u.category, title: u.title,
      condition: u.condition, cost: u.cost, retail: u.compareAt, source: null
    }));
  } catch { return []; }
}

// Confirm tested-working → set Condition (drives the price formula) + flip Status
// to 'Tested Working', then sync so it goes live on the site.
export async function markIntakeTested(sku, { condition } = {}) {
  if (!sheetsConfigured()) throw notConfigured();
  await setTrackerStatus(sku, { status: LIVE_STATUS, condition });

  // The tracker's Condition% / Suggested-price cells are FORMULAS that recalc a
  // beat after we write the condition — sync too soon and it reads a blank price
  // and skips the unit (it silently never goes live). Give the formulas a moment,
  // sync, and verify the unit actually landed active; retry once if not.
  const isLive = async () => {
    if (!hasDb()) return true;
    try {
      const { rows } = await query('SELECT active FROM products WHERE sku = $1', [sku]);
      return rows[0]?.active === true;
    } catch { return false; }
  };
  let live = false;
  for (let attempt = 0; attempt < 2 && !live; attempt++) {
    await sleep(attempt === 0 ? 2500 : 3500);
    try { await syncInventoryFromTracker(); } catch (e) { console.error('intake sync after publish', e?.message || e); }
    live = await isLive();
  }
  return { sku, live };
}

// Not tested-working — park it (off the storefront) for repair/diagnosis.
export async function rejectIntake(sku) {
  if (!sheetsConfigured()) throw notConfigured();
  await setTrackerStatus(sku, { status: REJECT_STATUS });
  return { sku, rejected: true };
}

// Did the units a rep just added actually reach the site?
//
// Publishing can fail in total silence: the tracker's Condition% / Suggested
// Price cells are formulas that recalculate a beat after the row lands, and
// lib/csv.js drops a row with no price without comment. Pressing Sync a second
// later therefore imports nothing and reports a cheerful "Synced 43 units".
// The intake screen asks this afterwards so the answer is per-unit and visible.
export async function intakeLiveStatus(skus = []) {
  const list = [...new Set((skus || []).map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 50);
  if (!list.length || !hasDb()) return [];
  try {
    const { rows } = await query(
      'SELECT sku, active, price FROM products WHERE sku = ANY($1)', [list]
    );
    const found = new Map(rows.map((r) => [r.sku, r]));
    return list.map((sku) => {
      const r = found.get(sku);
      return { sku, live: r?.active === true, price: r?.price == null ? null : Number(r.price) };
    });
  } catch (e) {
    console.error('intake live check failed', e?.message || e);
    return [];
  }
}
