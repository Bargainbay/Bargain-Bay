// When to buy more of a part.
//
// The parts shelf could always tell you it was empty. Nothing told you it was
// ABOUT to be — so the first anybody knew was a tech on a doorstep with a
// machine open and no igniter, and the part then arrives in three days instead
// of having been there all along.
//
// Three rules decide everything in this file:
//
//   1. IT COMPARES WHAT IS AVAILABLE, NOT WHAT IS ON THE SHELF. A part held by
//      an open request is spoken for — somebody is coming for it. Counting it as
//      stock means the last igniter, already promised to a tech, reads as one in
//      hand and the reorder never fires. `available = on_hand - held` is already
//      how lib/parts describes a part; this is the same number.
//   2. NULL IS NOT ZERO. A part with no reorder point is not watched, and is
//      reported as unwatched rather than being given a default. Zero would say
//      every part is fine; one would say every part is urgent. Same rule as a
//      supplier's terms.
//   3. IT PROPOSES; A PERSON ORDERS. Nothing here raises a purchase order, and
//      the suggested point is arithmetic off real usage that is shown with the
//      figures it came from — a number nobody can check is a number nobody uses.
import { hasDb, query } from './db';

// How far back usage is measured. Long enough that one busy fortnight doesn't
// set the level for the year, short enough to follow what the floor actually
// works on now.
export const USAGE_WINDOW_DAYS = 90;

// A reason that is CONSUMPTION. `adjust` is a correction to a miscount and
// `harvest` is stock arriving; counting either as usage would have a tidy-up
// look like demand and order more of something nobody used.
const CONSUMED = `(m.qty < 0 AND m.reason <> 'adjust')`;

// The part of a purchase order still owed on a part: ordered minus received,
// on an order that is neither cancelled nor fully in.
const ON_ORDER = `(
  SELECT COALESCE(SUM(GREATEST(l.qty - l.qty_received, 0)), 0)::int
    FROM purchase_order_lines l
    JOIN purchase_orders o ON o.id = l.po_id
   WHERE l.part_id = p.id AND o.cancelled_at IS NULL
)`;

const int = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

/**
 * Set (or clear) a part's reorder point.
 *
 * Passing null for the point stops watching the part — which is a decision
 * somebody may want to make, so it is allowed and is not the same as never
 * having set one. Both read back as "not watched"; neither is a silent zero.
 */
export async function setReorderPoint(partId, { point, qty, supplierId } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const id = int(partId);
  if (!id) throw new Error('Which part?');

  const pt = point === undefined ? undefined : int(point);
  const q = qty === undefined ? undefined : int(qty);
  const sup = supplierId === undefined ? undefined : int(supplierId);
  if (pt !== undefined && (Number.isNaN(pt) || (pt !== null && pt < 0))) {
    throw new Error('A reorder point is a whole number of pieces, or blank.');
  }
  if (q !== undefined && (Number.isNaN(q) || (q !== null && q < 1))) {
    throw new Error('Order at least one, or leave it blank.');
  }

  const { rows } = await query(
    `UPDATE parts SET
       reorder_point = CASE WHEN $2::text = 'keep' THEN reorder_point ELSE $3::int END,
       reorder_qty   = CASE WHEN $4::text = 'keep' THEN reorder_qty   ELSE $5::int END,
       preferred_supplier_id = CASE WHEN $6::text = 'keep' THEN preferred_supplier_id ELSE $7::int END
     WHERE id = $1 RETURNING id, reorder_point, reorder_qty, preferred_supplier_id`,
    [id,
     pt === undefined ? 'keep' : 'set', pt === undefined ? null : pt,
     q === undefined ? 'keep' : 'set', q === undefined ? null : q,
     sup === undefined ? 'keep' : 'set', sup === undefined ? null : sup]
  );
  if (!rows.length) throw new Error('No such part.');
  return {
    ok: true,
    reorderPoint: rows[0].reorder_point,
    reorderQty: rows[0].reorder_qty,
    supplierId: rows[0].preferred_supplier_id
  };
}

/**
 * How long a supplier actually takes, in days, measured from their own orders.
 *
 * Ordered to FIRST receipt, because the first delivery is when the shelf stops
 * being empty. Returns null when there is nothing to measure — a lead time
 * guessed at seven days looks exactly like one that was observed, and it is the
 * number a reorder point is built on.
 */
export async function supplierLeadTimes() {
  if (!hasDb()) return new Map();
  const { rows } = await query(
    `SELECT o.supplier_id,
            COUNT(*)::int AS orders,
            ROUND(AVG(f.first_on - o.ordered_on))::int AS days
       FROM purchase_orders o
       JOIN (SELECT po_id, MIN(received_at)::date AS first_on
               FROM purchase_order_receipts GROUP BY po_id) f ON f.po_id = o.id
      WHERE o.supplier_id IS NOT NULL AND o.ordered_on IS NOT NULL
        AND o.cancelled_at IS NULL AND f.first_on >= o.ordered_on
      GROUP BY o.supplier_id`
  ).catch(() => ({ rows: [] }));
  return new Map(rows.map((r) => [r.supplier_id, { days: r.days, orders: r.orders }]));
}

/**
 * Every part, with what it is doing and whether it needs buying.
 *
 * One query rather than N: the screen wants the whole shelf, and the usage
 * window is the same for all of them.
 */
export async function reorderReport({ windowDays = USAGE_WINDOW_DAYS } = {}) {
  if (!hasDb()) return { below: [], watched: [], unwatched: [], counts: {}, windowDays };
  const days = Math.min(Math.max(Number(windowDays) || USAGE_WINDOW_DAYS, 7), 730);

  const { rows } = await query(
    `SELECT p.id, p.part_number, p.name, p.brand, p.category,
            p.reorder_point, p.reorder_qty, p.preferred_supplier_id,
            s.name AS supplier_name, s.contact_name, s.email, s.phone,
            COALESCE(oh.on_hand, 0)::int AS on_hand,
            COALESCE(hd.held, 0)::int    AS held,
            COALESCE(u.used, 0)::int     AS used,
            ${ON_ORDER}                  AS on_order,
            COALESCE(sp.spots, '')       AS spots
       FROM parts p
       LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
       LEFT JOIN LATERAL (SELECT SUM(qty)::int AS on_hand FROM part_moves WHERE part_id = p.id) oh ON true
       LEFT JOIN LATERAL (
         SELECT SUM(qty)::int AS held FROM part_requests
          WHERE part_id = p.id AND status IN ('pending','approved')
       ) hd ON true
       LEFT JOIN LATERAL (
         SELECT SUM(-m.qty)::int AS used FROM part_moves m
          WHERE m.part_id = p.id AND ${CONSUMED}
            AND m.at >= now() - ($1 || ' days')::interval
       ) u ON true
       LEFT JOIN LATERAL (
         SELECT string_agg(g.location || ' x' || g.qty, ', ' ORDER BY g.qty DESC) AS spots
           FROM (SELECT location, SUM(qty)::int AS qty FROM part_moves
                  WHERE part_id = p.id AND location IS NOT NULL
                  GROUP BY location HAVING SUM(qty) > 0) g
       ) sp ON true
      ORDER BY p.name`,
    [String(days)]
  ).catch(() => ({ rows: [] }));

  const leads = await supplierLeadTimes();

  const parts = rows.map((r) => {
    const onHand = r.on_hand;
    const held = r.held;
    const available = Math.max(0, onHand - held);
    const onOrder = r.on_order;
    const used = r.used;
    // Per day over the window. Null when nothing was used: a rate of zero and
    // "we have never taken one of these" are different facts, and only the
    // second one means the shelf level is untested.
    const perDay = used > 0 ? used / days : null;
    const lead = r.preferred_supplier_id ? leads.get(r.preferred_supplier_id) : null;

    return {
      id: r.id,
      partNumber: r.part_number || '',
      name: r.name,
      brand: r.brand || '',
      category: r.category || '',
      spots: r.spots || '',
      onHand, held, available, onOrder, used,
      usedPerDay: perDay === null ? null : Math.round(perDay * 1000) / 1000,
      // How long what is available lasts at the rate it has been going. Null
      // when there is no rate — never Infinity, and never a large number that
      // reads like a measurement.
      daysOfCover: perDay ? Math.floor(available / perDay) : null,
      reorderPoint: r.reorder_point,
      reorderQty: r.reorder_qty,
      supplier: r.supplier_name || null,
      supplierId: r.preferred_supplier_id,
      supplierContact: [r.contact_name, r.email, r.phone].filter(Boolean).join(' · ') || null,
      leadDays: lead ? lead.days : null,
      leadFrom: lead ? lead.orders : 0,
      suggestedPoint: suggestReorderPoint({ perDay, leadDays: lead ? lead.days : null }),
      // Rule 1, and the reason this file exists.
      below: r.reorder_point !== null && available <= r.reorder_point,
      // Already handled. Still listed, in its own group, because "did somebody
      // order it" is the first question anybody asks about a part that is out.
      covered: r.reorder_point !== null && available <= r.reorder_point && onOrder > 0
    };
  });

  const watched = parts.filter((p) => p.reorderPoint !== null);
  const unwatched = parts.filter((p) => p.reorderPoint === null);
  const below = watched.filter((p) => p.below);

  return {
    windowDays: days,
    // To buy: below the point with nothing on the way. This is the list.
    below: below.filter((p) => !p.covered).map(withOrderQty),
    // Below the point but already ordered — so the list stops nagging without
    // pretending the part is in stock.
    onOrder: below.filter((p) => p.covered).map(withOrderQty),
    watched,
    // NOT a failure and NOT hidden. It is how much of the shelf this report
    // cannot speak for, and it is the number that makes the report honest on
    // the day it ships, when it is every part there is.
    unwatched,
    counts: {
      parts: parts.length,
      watched: watched.length,
      unwatched: unwatched.length,
      below: below.length,
      toBuy: below.filter((p) => !p.covered).length,
      // Worth acting on before it bites: not below yet, but would be within the
      // supplier's own observed lead time. Only where BOTH numbers are real.
      soon: watched.filter((p) => !p.below && p.leadDays !== null && p.daysOfCover !== null
                                  && p.daysOfCover <= p.leadDays).length
    }
  };
}

// How many to buy. The stated quantity, else enough to reach twice the point —
// the point is what we want left when the order lands, so refilling only to the
// point puts it back on this list the same afternoon.
function withOrderQty(p) {
  const target = p.reorderPoint * 2;
  return { ...p, orderQty: p.reorderQty || Math.max(1, target - p.available - p.onOrder) };
}

/**
 * A reorder point worth suggesting: what gets used while an order is in transit,
 * plus half again as cover.
 *
 * Returns null unless BOTH halves are real — a rate measured from actual takes
 * and a lead time measured from actual deliveries. A suggestion built on one of
 * them looks like arithmetic and is a guess, and somebody would set a shelf
 * level from it. Same rule as mileageReport's L/100km.
 */
export function suggestReorderPoint({ perDay, leadDays }) {
  if (!perDay || perDay <= 0) return null;
  if (leadDays === null || leadDays === undefined || !Number.isFinite(leadDays)) return null;
  return Math.max(1, Math.ceil(perDay * Math.max(leadDays, 0) * 1.5));
}
