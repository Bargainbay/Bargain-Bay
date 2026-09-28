// Who we buy from — terms, contact, spend and whether they turn up when they
// said they would.
//
// A supplier has been a string typed by hand on every path that touches one, so
// "SecondShop", "Second Shop" and "secondshop " are three suppliers on a report
// and one company in the driveway — and there has been nowhere to record their
// terms, who to ring, or whether they deliver on time.
//
// THE NAME STILL GOVERNS. The master tracker is the source of truth for stock,
// is not in this repo, and its Vendor column cannot carry a foreign key. So
// `supplier_id` is additive everywhere and the vendor NAME is still written
// down. Same shape as customers, where the email string is still on the order.
import { hasDb, query, withTransaction } from './db';
import { supplierKey, torontoToday } from './constants';

const clean = (v, max = 200) => {
  const s = String(v == null ? '' : v).trim().slice(0, max);
  return s || null;
};

export async function createSupplier({ name, contactName, email, phone, termsDays, note, by } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const n = clean(name);
  const key = supplierKey(n);
  if (!key) throw new Error('What is the supplier called?');
  const terms = termsDays === '' || termsDays === null || termsDays === undefined ? null : Number(termsDays);
  if (terms !== null && (!Number.isFinite(terms) || terms < 0)) throw new Error('Terms are a number of days.');

  const { rows } = await query(
    `INSERT INTO suppliers (name, name_key, contact_name, email, phone, terms_days, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (name_key) DO NOTHING
     RETURNING id`,
    [n, key, clean(contactName), clean(email), clean(phone, 40), terms, clean(note, 2000), clean(by)]
  );
  if (rows.length) return { id: rows[0].id, created: true };

  // Already on file under some spelling of this name. Returning it rather than
  // erroring is deliberate: the caller is usually a PO form, and refusing sends
  // somebody off to find out which of two near-identical names is the real one.
  const existing = await resolveSupplier(n);
  return { id: existing?.id || null, created: false };
}

export async function updateSupplier(id, { contactName, email, phone, termsDays, note, active } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const terms = termsDays === '' || termsDays === undefined ? undefined
    : termsDays === null ? null : Number(termsDays);
  const { rows } = await query(
    `UPDATE suppliers SET
       contact_name = COALESCE($2, contact_name),
       email        = COALESCE($3, email),
       phone        = COALESCE($4, phone),
       terms_days   = CASE WHEN $5::text = 'keep' THEN terms_days ELSE $6::int END,
       note         = COALESCE($7, note),
       active       = COALESCE($8, active)
     WHERE id = $1 RETURNING id`,
    [Number(id), clean(contactName), clean(email), clean(phone, 40),
     terms === undefined ? 'keep' : 'set', terms === undefined ? null : terms,
     clean(note, 2000), active === undefined ? null : !!active]
  );
  if (!rows.length) throw new Error('No such supplier.');
  return { ok: true };
}

/**
 * The supplier a typed name refers to — by its own name, or by an alias.
 *
 * Returns null rather than inventing one. A name NEVER creates a supplier
 * implicitly: the same rule client-match follows, and for the same reason — a
 * list full of typos is a list nobody can raise a purchase order from.
 */
export async function resolveSupplier(name) {
  if (!hasDb()) return null;
  const key = supplierKey(name);
  if (!key) return null;
  const { rows } = await query(
    `SELECT s.* FROM suppliers s WHERE s.name_key = $1
      UNION ALL
     SELECT s.* FROM suppliers s JOIN supplier_aliases a ON a.supplier_id = s.id
      WHERE a.alias_key = $1
      LIMIT 1`, [key]
  ).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

export async function addSupplierAlias(supplierId, alias, { by } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const a = clean(alias);
  const key = supplierKey(a);
  if (!key) throw new Error('What is the other name?');

  const existing = await resolveSupplier(a);
  if (existing && existing.id !== Number(supplierId)) {
    throw new Error(`"${a}" already belongs to ${existing.name}.`);
  }
  await query(
    `INSERT INTO supplier_aliases (supplier_id, alias, alias_key, created_by)
     VALUES ($1,$2,$3,$4) ON CONFLICT (alias_key) DO NOTHING`,
    [Number(supplierId), a, key, clean(by)]
  );
  return { ok: true };
}

/**
 * Attach a purchase order or invoice to its supplier, by the name already on
 * it. Silent and best-effort: failing to resolve a name must never stop a
 * purchase order being raised or an invoice being recorded.
 */
export async function linkByVendorName(table, id, vendorName) {
  if (!hasDb()) return null;
  if (!['purchase_orders', 'purchase_invoices'].includes(table)) return null;
  const s = await resolveSupplier(vendorName);
  if (!s) return null;
  await query(`UPDATE ${table} SET supplier_id = $2 WHERE id = $1 AND supplier_id IS NULL`, [Number(id), s.id])
    .catch(() => {});
  return s.id;
}

/**
 * Names that have been used on an order or an invoice and match no supplier.
 *
 * This is the working list: each row is either a supplier to add or an alias to
 * record, and answering it once stops the same name coming back.
 */
export async function unknownVendorNames({ limit = 50 } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT vendor, SUM(n)::int AS uses, MAX(last_seen) AS last_seen FROM (
        SELECT vendor, count(*) AS n, MAX(created_at) AS last_seen
          FROM purchase_orders WHERE supplier_id IS NULL AND vendor IS NOT NULL GROUP BY vendor
        UNION ALL
        SELECT vendor, count(*) AS n, MAX(created_at) AS last_seen
          FROM purchase_invoices WHERE supplier_id IS NULL AND vendor IS NOT NULL GROUP BY vendor
     ) t GROUP BY vendor ORDER BY uses DESC, last_seen DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)]
  ).catch(() => ({ rows: [] }));
  return rows;
}

/**
 * Every supplier with what we have spent and whether they turn up on time.
 *
 * ON-TIME is measured on ORDERS THAT ARRIVED, and only those with both an
 * expected date and a receipt — a supplier whose orders carry no dates has no
 * record, which is reported as "no data" rather than as 100%. A percentage
 * computed from nothing looks like a fact.
 */
export async function supplierPerformance({ days = 365 } = {}) {
  if (!hasDb()) return [];
  const since = Math.min(Math.max(Number(days) || 365, 1), 1825);

  const { rows } = await query(
    `WITH first_receipt AS (
       SELECT po_id, MIN(received_at)::date AS first_on
         FROM purchase_order_receipts GROUP BY po_id
     )
     SELECT s.id, s.name, s.contact_name, s.email, s.phone, s.terms_days, s.active,
            COUNT(DISTINCT p.id)::int AS orders,
            COALESCE(SUM(l.qty * COALESCE(l.unit_cost, 0)), 0) AS ordered_value,
            COUNT(DISTINCT p.id) FILTER (
              WHERE f.first_on IS NOT NULL AND p.expected_on IS NOT NULL
            )::int AS dated,
            COUNT(DISTINCT p.id) FILTER (
              WHERE f.first_on IS NOT NULL AND p.expected_on IS NOT NULL AND f.first_on <= p.expected_on
            )::int AS on_time
       FROM suppliers s
       LEFT JOIN purchase_orders p
              ON p.supplier_id = s.id AND p.cancelled_at IS NULL
             AND p.ordered_on >= (CURRENT_DATE - ($1 || ' days')::interval)
       LEFT JOIN purchase_order_lines l ON l.po_id = p.id
       LEFT JOIN first_receipt f ON f.po_id = p.id
      GROUP BY s.id ORDER BY ordered_value DESC, s.name`,
    [String(since)]
  ).catch(() => ({ rows: [] }));

  return rows.map((r) => ({
    ...r,
    orderedValue: Number(r.ordered_value) || 0,
    // null, not 0. "No orders with dates on them" is not "never on time".
    onTimePct: r.dated > 0 ? Math.round((r.on_time / r.dated) * 100) : null
  }));
}

/**
 * What is owed and when, using each supplier's terms.
 *
 * NULL TERMS ARE REPORTED AS UNKNOWN, never assumed to be zero. Assuming due-on-
 * receipt would show every unpaid invoice from a supplier nobody has set terms
 * for as overdue, which is the fastest way to make an aging report ignored.
 */
export async function payablesAging() {
  if (!hasDb()) return { buckets: [], unknownTerms: [], total: 0 };
  const { rows } = await query(
    `SELECT i.id, i.vendor, i.invoice_number, i.invoice_date, i.total, i.subtotal,
            s.name AS supplier_name, s.terms_days, s.contact_name, s.email,
            CASE WHEN s.terms_days IS NULL THEN NULL
                 ELSE (i.invoice_date + (s.terms_days || ' days')::interval)::date END AS due_on,
            CASE WHEN s.terms_days IS NULL THEN NULL
                 ELSE ($1::date - (i.invoice_date + (s.terms_days || ' days')::interval)::date) END AS days_over
       FROM purchase_invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.paid_at IS NULL
      ORDER BY due_on NULLS LAST, i.invoice_date`,
    [torontoToday()]
  ).catch(() => ({ rows: [] }));

  const bucket = (d) => (d === null ? 'unknown' : d > 30 ? 'over30' : d > 0 ? 'overdue' : d > -7 ? 'week' : 'later');
  const buckets = { overdue: [], over30: [], week: [], later: [], unknown: [] };
  for (const r of rows) buckets[bucket(r.days_over === null ? null : Number(r.days_over))].push(r);

  const sum = (list) => Math.round(list.reduce((a, r) => a + Number(r.total || 0), 0) * 100) / 100;
  return {
    over30: buckets.over30, overdue: buckets.overdue, week: buckets.week,
    later: buckets.later, unknownTerms: buckets.unknown,
    totals: {
      over30: sum(buckets.over30), overdue: sum(buckets.overdue),
      week: sum(buckets.week), later: sum(buckets.later), unknown: sum(buckets.unknown)
    },
    total: sum(rows)
  };
}

export async function listSuppliers({ includeInactive = false } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT s.*, (SELECT array_agg(a.alias ORDER BY a.alias) FROM supplier_aliases a WHERE a.supplier_id = s.id) AS aliases
       FROM suppliers s ${includeInactive ? '' : 'WHERE s.active'}
      ORDER BY s.active DESC, s.name`
  ).catch(() => ({ rows: [] }));
  return rows;
}

/** Fold every historical vendor name on orders and invoices onto its supplier. */
export async function relinkAll() {
  if (!hasDb()) return { linked: 0 };
  return withTransaction(async (client) => {
    let linked = 0;
    for (const table of ['purchase_orders', 'purchase_invoices']) {
      const { rows } = await client.query(
        `SELECT DISTINCT vendor FROM ${table} WHERE supplier_id IS NULL AND vendor IS NOT NULL`
      );
      for (const r of rows) {
        const key = supplierKey(r.vendor);
        if (!key) continue;
        const { rowCount } = await client.query(
          `UPDATE ${table} SET supplier_id = (
             SELECT id FROM (
               SELECT s.id FROM suppliers s WHERE s.name_key = $2
               UNION ALL
               SELECT s.id FROM suppliers s JOIN supplier_aliases a ON a.supplier_id = s.id WHERE a.alias_key = $2
               LIMIT 1
             ) x)
           WHERE supplier_id IS NULL AND vendor = $1
             AND EXISTS (
               SELECT 1 FROM suppliers s WHERE s.name_key = $2
               UNION ALL
               SELECT 1 FROM suppliers s JOIN supplier_aliases a ON a.supplier_id = s.id WHERE a.alias_key = $2
             )`,
          [r.vendor, key]
        );
        linked += rowCount;
      }
    }
    return { linked };
  });
}
