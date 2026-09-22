// Stock we hold but do not own.
//
// A vendor drops appliances here, we agree a cost out loud, and we pay them
// ONLY once the unit sells (lib/intake.js → addConsignmentUnit). Two things
// follow, and both of them are wrong by default:
//
//   * It is not our inventory. `inventoryAtCost()` counts every unsold
//     `products` row as an asset, which for these overstates what the business
//     owns — and, with no matching liability, overstates equity by the same
//     amount.
//   * When one sells, the ledger's COGS entry credits Inventory (1200) for
//     stock that was never debited into it, so inventory drifts NEGATIVE by the
//     unit's cost and the money we now owe the vendor appears nowhere at all.
//
// So a consigned unit's cost is booked against its own liability account —
// 2150, "Owed to consignment vendors" — on the day it SELLS, and cleared when
// the vendor is actually paid. Same shape as accounts payable (2100), for the
// same reason: the obligation and the cash leave on different days.
//
// Kept in its OWN table rather than a column on `products`, because a unit only
// reaches `products` after the tracker sync, which runs after intake and
// rewrites every column of the row it touches.
import { hasDb, query } from './db';
import { round2, money, consignmentFloor } from './constants';

const n = (v) => Number(v || 0);

let _schema = null;
export function ensureConsignmentSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS consignment_units (
        sku         text PRIMARY KEY,
        vendor      text,
        cost        numeric(10,2),
        taken_on    date NOT NULL DEFAULT current_date,
        paid_on     date,
        paid_amount numeric(10,2),
        note        text,
        created_by  text,
        created_at  timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_consignment_unpaid ON consignment_units(paid_on) WHERE paid_on IS NULL;
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// Booked at intake, before the unit exists in `products`.
export async function recordConsignmentUnit({ sku, vendor, cost, note, createdBy, takenOn }) {
  if (!hasDb()) return null;
  await ensureConsignmentSchema();
  const { rows } = await query(
    `INSERT INTO consignment_units (sku, vendor, cost, note, created_by, taken_on)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6::date, current_date))
     ON CONFLICT (sku) DO UPDATE SET
       vendor = EXCLUDED.vendor, cost = EXCLUDED.cost, note = EXCLUDED.note
     RETURNING sku`,
    [String(sku).trim(), String(vendor || '').trim() || null,
     Number.isFinite(Number(cost)) ? round2(Number(cost)) : null,
     String(note || '').trim() || null, createdBy || null,
     /^\d{4}-\d{2}-\d{2}$/.test(String(takenOn || '')) ? takenOn : null]
  );
  return rows[0]?.sku || null;
}

// Every SKU on consignment. The ledger needs this as a SET rather than a join,
// so that a missing table (nothing has ever been consigned) degrades to "none
// of them" instead of taking the whole COGS entry down with it.
export async function consignedSkus() {
  if (!hasDb()) return new Set();
  try {
    const { rows } = await query('SELECT sku FROM consignment_units');
    return new Set(rows.map((r) => r.sku));
  } catch { return new Set(); }
}

// What we owe right now: consigned units that have SOLD and not been paid for.
// The obligation starts at the sale, not at the drop-off — that is the whole
// arrangement.
export async function consignmentOwed() {
  if (!hasDb()) return [];
  try {
    const { rows } = await query(
      `SELECT c.sku, c.vendor, c.cost, c.taken_on, c.note,
              p.title, p.make, p.model, p.sold_at, p.sold_ref, p.sold_price
         FROM consignment_units c
         JOIN products p ON p.sku = c.sku
        WHERE c.paid_on IS NULL AND p.sold_at IS NOT NULL
        ORDER BY p.sold_at, c.sku`
    );
    return rows.map((r) => ({
      sku: r.sku, vendor: r.vendor, cost: round2(n(r.cost)),
      title: r.title || [r.make, r.model].filter(Boolean).join(' '),
      takenOn: r.taken_on ? new Date(r.taken_on).toISOString().slice(0, 10) : null,
      soldOn: r.sold_at ? new Date(r.sold_at).toISOString().slice(0, 10) : null,
      soldRef: r.sold_ref, soldPrice: r.sold_price == null ? null : round2(n(r.sold_price)),
      note: r.note
    }));
  } catch { return []; }
}

// Consigned stock still sitting here unsold — held, not owned, and owed for by
// nobody yet. Reported so the balance sheet can say what it is EXCLUDING.
export async function consignmentOnHand() {
  if (!hasDb()) return { value: 0, units: 0 };
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS c, COALESCE(SUM(c.cost),0) AS v
         FROM consignment_units c
         JOIN products p ON p.sku = c.sku
        WHERE p.sold_at IS NULL`
    );
    return { value: round2(n(rows[0]?.v)), units: Number(rows[0]?.c) || 0 };
  } catch { return { value: 0, units: 0 }; }
}

// Settled with the vendor. Dated to the day the money actually moved, which is
// routinely a different month from the sale — the same reason a supplier
// invoice carries its own paid date.
export async function markConsignmentPaid(skus, { paidOn, amount } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureConsignmentSchema();
  const list = [...new Set((Array.isArray(skus) ? skus : [skus]).map((s) => String(s || '').trim()).filter(Boolean))];
  if (!list.length) throw new Error('Nothing to pay.');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(paidOn || '')) ? paidOn : null;
  if (!d) throw new Error('Give the date it was paid, like 2026-09-10.');
  // A blank amount means "what was agreed". A typed one wins — a vendor settled
  // at a round number is the ordinary case, and the figure that left the bank is
  // the one the ledger has to carry.
  const amt = Number.isFinite(Number(amount)) && Number(amount) > 0 ? round2(Number(amount)) : null;
  const { rowCount } = await query(
    `UPDATE consignment_units
        SET paid_on = $2::date, paid_amount = COALESCE($3, cost)
      WHERE sku = ANY($1) AND paid_on IS NULL`,
    [list, d, amt]
  );
  return { paid: rowCount };
}

// Undo — the payment was recorded against the wrong unit, or never went out.
export async function unmarkConsignmentPaid(sku) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureConsignmentSchema();
  const { rowCount } = await query(
    'UPDATE consignment_units SET paid_on = NULL, paid_amount = NULL WHERE sku = $1', [String(sku).trim()]
  );
  return { reopened: rowCount };
}

// Payments to consignment vendors in a window — the ledger's "we settled up"
// entries. Soft-fails to none.
export async function consignmentPayments(from, to) {
  if (!hasDb()) return [];
  try {
    const { rows } = await query(
      `SELECT sku, vendor, paid_on, COALESCE(paid_amount, cost) AS amount
         FROM consignment_units
        WHERE paid_on IS NOT NULL AND paid_on >= $1 AND paid_on < $2
        ORDER BY paid_on, sku`, [from, to]
    );
    return rows.map((r) => ({
      sku: r.sku, vendor: r.vendor,
      paidOn: r.paid_on ? new Date(r.paid_on).toISOString().slice(0, 10) : null,
      amount: round2(n(r.amount))
    }));
  } catch { return []; }
}

// ── The floor: what a consigned unit may not be sold under ──────────────────
// sku -> { vendor, cost, floor }. The cost is the AGREED one recorded when the
// unit was taken in, not the tracker's copy: it is what we will actually hand
// the vendor. Soft-fails to an empty map — a database that can't be read must
// not stop a sale, and the invoice screen says when it couldn't check.
export async function consignmentFloors(skus = null) {
  if (!hasDb()) return new Map();
  try {
    const list = Array.isArray(skus) ? [...new Set(skus.map((s) => String(s || '').trim()).filter(Boolean))] : null;
    const { rows } = list
      ? await query('SELECT sku, vendor, cost FROM consignment_units WHERE sku = ANY($1)', [list])
      : await query('SELECT sku, vendor, cost FROM consignment_units');
    const out = new Map();
    for (const r of rows) {
      out.set(r.sku, { vendor: r.vendor || null, cost: n(r.cost), floor: consignmentFloor(r.cost) });
    }
    return out;
  } catch (e) {
    console.error('consignment floors unavailable', e?.message || e);
    return new Map();
  }
}

// A unit that turns out NOT to be consigned after all — booked in as a drop-off
// when it was ours all along (VD-MU7671R18FL, 2026-09-22: one of the RQ22A4CSD
// fridges from S-ORD115612 went in as a vendor drop-off, so the books said we
// owed a vendor for a fridge we had already paid SecondShop for). Deleting the
// row is right: the liability never existed. A unit already SETTLED is refused —
// money actually moved, and that is a refund conversation, not a typo.
export async function removeConsignmentUnit(sku) {
  if (!hasDb()) throw new Error('Database not configured.');
  const id = String(sku || '').trim();
  if (!id) throw new Error('Which unit?');
  const { rows } = await query('SELECT sku, vendor, cost, paid_on FROM consignment_units WHERE sku = $1', [id]);
  if (!rows.length) throw new Error(`${id} is not recorded as consigned stock.`);
  if (rows[0].paid_on) throw new Error(`${id} has already been settled with ${rows[0].vendor || 'the vendor'} — that payment has to be dealt with first.`);
  await query('DELETE FROM consignment_units WHERE sku = $1', [id]);
  return { sku: id, vendor: rows[0].vendor || null, cost: n(rows[0].cost) };
}

// What is wrong with these lines as far as consigned stock goes, or '' — the
// server half of "nothing from a drop-off vendor is sold under cost + 20%".
//
// The amounts handed in are ALWAYS PRE-TAX (normalizeLines has already backed
// HST out of a tax-inclusive invoice by the time this runs), which is the whole
// point: the vendor's cost is a tax-in figure we pay in full, so a tax-in
// selling price compared against it would flatter every line by 13%.
export async function consignmentFloorProblem(items = []) {
  const units = (items || []).filter((it) => String(it?.sku || '').trim() && Number(it?.amount) > 0);
  if (!units.length) return '';
  const floors = await consignmentFloors(units.map((it) => it.sku));
  if (!floors.size) return '';
  for (const it of units) {
    const f = floors.get(String(it.sku).trim());
    if (!f || !(f.floor > 0)) continue;
    if (Number(it.amount) + 0.005 < f.floor) {
      return `“${String(it.description || it.sku).trim()}” is ${f.vendor ? `${f.vendor}'s` : 'a vendor\u2019s'} drop-off stock: we owe ${money(f.cost)} for it the day it sells, so it can\u2019t go out under ${money(f.floor)} before tax. Raise the line, or ask an admin to approve the exception.`;
    }
  }
  return '';
}
