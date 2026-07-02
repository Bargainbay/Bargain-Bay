// Inventory intake — the MASTER GOOGLE TRACKER is the source of truth. Adding a
// unit (vendor purchase or haul-away) appends a row to the Main tab with the
// yellow input cells filled and Status='Untested', so the tracker's formulas
// (Condition %, Suggested Price, Total Cost) auto-fill and the unit stays OFF the
// storefront. Confirming tested-working flips Status='Tested Working' and syncs,
// so the website live-updates. Requires the tracker shared with the sync service
// account as EDITOR (SHEET_ID = the native Google Sheet).
import { appendTrackerUnit, setTrackerStatus, readByStatus, sheetsConfigured } from './sheets';
import { syncInventoryFromTracker } from './catalog-sync';
import { hasDb, query } from './db';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PENDING_STATUS = 'Untested';
const LIVE_STATUS = 'Tested Working';
const REJECT_STATUS = 'Tested Not Working - Needs Diagnosis';

function notConfigured() {
  return new Error('The master tracker isn’t connected for writing yet — set SHEET_ID to the native Google Sheet and share it with the sync service account as Editor.');
}

// Add one or more pending units to the tracker. Returns the new Item IDs.
export async function addIntakeUnits({ make, model, category, condition, cost, retail, source, vendor, invoice, lot, sku, description, qty = 1 }) {
  if (!sheetsConfigured()) throw notConfigured();
  const count = Math.max(1, Math.min(50, Math.round(Number(qty) || 1)));
  const isHaul = String(source || '').toLowerCase() === 'haulaway' || String(vendor || '').toLowerCase() === 'haulaway';
  const base = String(sku || lot || `IN-${Date.now().toString(36).toUpperCase()}`).trim();
  const lotNum = String(lot || base).trim();
  const created = [];
  for (let i = 0; i < count; i++) {
    const itemId = count > 1 ? `${base}-${String(i + 1).padStart(3, '0')}` : base;
    await appendTrackerUnit({
      lot: lotNum, sku: itemId, category, make, model,
      // Prefer a full, searchable description; fall back to brand + model + type
      // so a unit is always findable by appliance type (not just model number).
      description: String(description || '').trim() || [make, model, category].filter(Boolean).join(' '),
      vendor: isHaul ? 'Haulaway' : (vendor || source || ''),
      invoice, retail, condition, cost: isHaul ? 0 : cost,
      status: PENDING_STATUS
    });
    created.push(itemId);
  }
  return { created, count };
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
