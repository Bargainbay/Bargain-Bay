// The client database — ONE consolidated record per email address, no matter
// how someone bought: storefront checkout (guest or account), owner-built
// invoice, or a quote. Before this table, customer identity was scattered
// across users + denormalized copies on every order/invoice/quote, so guests
// and invoiced clients never showed up anywhere as "customers".
//
// Kept current three ways, all convergent and idempotent:
//   1. upsertCustomer() fires on every checkout / invoice / quote / signup
//      (best-effort — a CRM hiccup must never block a sale).
//   2. backfillCustomers() sweeps all historical records (newest info wins);
//      runs nightly from the sync-inventory cron.
//   3. Reads bootstrap themselves: if the table is empty (first deploy), the
//      backfill runs inline so the CRM is populated on first look.
import { hasDb, query } from './db';

let _schema = null;
export function ensureCustomerSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS customers (
        id serial PRIMARY KEY,
        email text UNIQUE NOT NULL,
        name text, phone text,
        address text, city text, postal text,
        notes text,
        user_id int,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (lower(name));
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

const normEmail = (e) => String(e || '').trim().toLowerCase();
const clean = (v, max = 200) => {
  const s = String(v == null ? '' : v).trim().slice(0, max);
  return s || null;
};

// Merge a contact sighting into the customer record. Newest NON-EMPTY value
// wins per field (a fresh delivery address replaces the old one; a checkout
// without a phone never blanks a phone we already know). Safe to call from
// hot paths — callers should .catch() so a CRM failure never blocks a sale.
export async function upsertCustomer({ email, name, phone, address, city, postal, userId } = {}) {
  const mail = normEmail(email);
  if (!hasDb() || !mail || !mail.includes('@')) return null;
  await ensureCustomerSchema();
  const { rows } = await query(
    `INSERT INTO customers (email, name, phone, address, city, postal, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (email) DO UPDATE SET
       name    = COALESCE(EXCLUDED.name,    customers.name),
       phone   = COALESCE(EXCLUDED.phone,   customers.phone),
       address = COALESCE(EXCLUDED.address, customers.address),
       city    = COALESCE(EXCLUDED.city,    customers.city),
       postal  = COALESCE(EXCLUDED.postal,  customers.postal),
       user_id = COALESCE(EXCLUDED.user_id, customers.user_id),
       updated_at = now()
     RETURNING id`,
    [mail, clean(name), clean(phone, 40), clean(address), clean(city, 100), clean(postal, 20),
     Number(userId) || null]
  );
  return rows[0]?.id || null;
}

// Sweep every historical source into the customer database. Idempotent — each
// source upserts the NEWEST record per email with non-empty-wins merging, so
// re-running (nightly cron) only folds in whatever's new. Sources, oldest
// signal first so fresher ones overwrite: accounts → quotes → invoices → orders.
export async function backfillCustomers() {
  if (!hasDb()) return { ok: false, reason: 'no db' };
  await ensureCustomerSchema();

  // Each source is best-effort: quotes/invoices self-provision on first use, so
  // on a fresh DB a source may not exist yet — the others still sweep.
  const sweep = (sql) => query(sql).catch((e) => console.error('customer backfill sweep failed', e.message));

  // Registered accounts (name/phone; addresses don't live on users).
  await sweep(`
    INSERT INTO customers (email, name, phone, user_id, created_at)
    SELECT DISTINCT ON (lower(email)) lower(email), NULLIF(trim(name),''), NULLIF(trim(phone),''), id, created_at
      FROM users WHERE email IS NOT NULL AND position('@' in email) > 0
     ORDER BY lower(email), created_at DESC
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(customers.name, EXCLUDED.name),
      phone = COALESCE(customers.phone, EXCLUDED.phone),
      user_id = COALESCE(customers.user_id, EXCLUDED.user_id),
      created_at = LEAST(customers.created_at, EXCLUDED.created_at)`);

  // Quotes (name only — quote requests park the phone inside the memo).
  await sweep(`
    INSERT INTO customers (email, name, created_at)
    SELECT DISTINCT ON (lower(email)) lower(email), NULLIF(trim(name),''), created_at
      FROM quotes WHERE email IS NOT NULL AND position('@' in email) > 0
     ORDER BY lower(email), created_at DESC
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(customers.name, EXCLUDED.name),
      created_at = LEAST(customers.created_at, EXCLUDED.created_at)`);

  // Invoices and orders carry the full contact + delivery address. The newest
  // row per email wins over whatever the earlier sources had (empty never wins).
  for (const src of ['invoices', 'orders']) {
    await sweep(`
      INSERT INTO customers (email, name, phone, address, city, postal, created_at)
      SELECT DISTINCT ON (lower(email)) lower(email), NULLIF(trim(name),''), NULLIF(trim(phone),''),
             NULLIF(trim(address),''), NULLIF(trim(city),''), NULLIF(trim(postal),''), created_at
        FROM ${src} WHERE email IS NOT NULL AND position('@' in email) > 0
       ORDER BY lower(email), created_at DESC
      ON CONFLICT (email) DO UPDATE SET
        name    = COALESCE(EXCLUDED.name,    customers.name),
        phone   = COALESCE(EXCLUDED.phone,   customers.phone),
        address = COALESCE(EXCLUDED.address, customers.address),
        city    = COALESCE(EXCLUDED.city,    customers.city),
        postal  = COALESCE(EXCLUDED.postal,  customers.postal),
        created_at = LEAST(customers.created_at, EXCLUDED.created_at)`);
  }

  // Link any record whose email later got an account.
  await sweep(`
    UPDATE customers c SET user_id = u.id
      FROM users u WHERE c.user_id IS NULL AND lower(u.email) = c.email`);

  const { rows } = await query('SELECT COUNT(*)::int AS n FROM customers');
  return { ok: true, customers: rows[0].n };
}

// First-deploy bootstrap: if the table is empty, populate it from history so
// the CRM (and the invoice/quote autofill that reads it) works immediately.
let _bootstrapped = false;
async function ensureBackfilled() {
  await ensureCustomerSchema();
  if (_bootstrapped) return;
  const { rows } = await query('SELECT 1 FROM customers LIMIT 1');
  if (!rows.length) await backfillCustomers();
  _bootstrapped = true;
}

// Purchase rollups come from orders matched by EMAIL (not user_id), so guest
// and invoiced sales count — paid invoices bridge into orders, which keeps
// this the one non-double-counting revenue base (same SALE set as analytics).
const SALE = "('confirmed','ready','out_for_delivery','delivered')";

// Searchable customer list with purchase rollups. q matches name/email/phone.
export async function listCustomers({ q = '', limit = 500 } = {}) {
  if (!hasDb()) return [];
  await ensureBackfilled();
  const needle = String(q || '').trim().toLowerCase();
  const { rows } = await query(
    `SELECT c.*, u.member_status, u.business_name,
            COUNT(o.id)       FILTER (WHERE o.status IN ${SALE}) AS orders,
            COALESCE(SUM(o.total) FILTER (WHERE o.status IN ${SALE}), 0) AS spent,
            MAX(o.created_at) FILTER (WHERE o.status IN ${SALE}) AS last_order
       FROM customers c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN orders o ON lower(o.email) = c.email
      WHERE $1 = '' OR lower(coalesce(c.name,'')) LIKE $2 OR c.email LIKE $2 OR coalesce(c.phone,'') LIKE $2
      GROUP BY c.id, u.member_status, u.business_name
      ORDER BY spent DESC, c.created_at DESC
      LIMIT $3`,
    [needle, `%${needle}%`, Math.min(Math.max(Number(limit) || 500, 1), 2000)]
  );
  return rows.map(shapeCustomer);
}

function shapeCustomer(r) {
  return {
    id: r.id, email: r.email, name: r.name, phone: r.phone,
    address: r.address, city: r.city, postal: r.postal, notes: r.notes,
    hasAccount: !!r.user_id,
    memberStatus: r.member_status || null, business: r.business_name || null,
    createdAt: r.created_at ? r.created_at.toISOString() : null,
    orders: Number(r.orders || 0), spent: Number(r.spent || 0),
    lastOrder: r.last_order ? r.last_order.toISOString() : null
  };
}

// The customer 360: contact record + every order, invoice, and quote under
// their email, plus lifetime rollups. Powers /admin/customers/[id].
export async function getCustomerProfile(id) {
  if (!hasDb()) return null;
  await ensureCustomerSchema();
  const { rows } = await query(
    `SELECT c.*, u.member_status, u.business_name,
            COUNT(o.id)       FILTER (WHERE o.status IN ${SALE}) AS orders,
            COALESCE(SUM(o.total) FILTER (WHERE o.status IN ${SALE}), 0) AS spent,
            MAX(o.created_at) FILTER (WHERE o.status IN ${SALE}) AS last_order
       FROM customers c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN orders o ON lower(o.email) = c.email
      WHERE c.id = $1
      GROUP BY c.id, u.member_status, u.business_name`,
    [Number(id)]
  );
  if (!rows.length) return null;
  const customer = shapeCustomer(rows[0]);

  const [orders, invoices, quotes] = await Promise.all([
    query(
      `SELECT o.id, o.order_number, o.status, o.total, o.delivery_method, o.created_at,
              COALESCE(json_agg(json_build_object('title', oi.title, 'sku', oi.sku, 'price', oi.price)
                                ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
         FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE lower(o.email) = $1 GROUP BY o.id ORDER BY o.created_at DESC LIMIT 100`,
      [customer.email]
    ),
    query(
      `SELECT id, number, status, total, refund_total, created_at
         FROM invoices WHERE lower(email) = $1 ORDER BY created_at DESC LIMIT 100`,
      [customer.email]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT id, number, status, total, created_at
         FROM quotes WHERE lower(email) = $1 ORDER BY created_at DESC LIMIT 100`,
      [customer.email]
    ).catch(() => ({ rows: [] }))
  ]);

  return {
    ...customer,
    history: {
      orders: orders.rows.map((r) => ({
        id: r.id, number: r.order_number, status: r.status, total: Number(r.total),
        deliveryMethod: r.delivery_method, createdAt: r.created_at?.toISOString() || null,
        items: r.items
      })),
      invoices: invoices.rows.map((r) => ({
        id: r.id, number: r.number, status: r.status, total: Number(r.total),
        refunded: Number(r.refund_total || 0), createdAt: r.created_at?.toISOString() || null
      })),
      quotes: quotes.rows.map((r) => ({
        id: r.id, number: r.number, status: r.status, total: Number(r.total),
        createdAt: r.created_at?.toISOString() || null
      }))
    }
  };
}

// Admin edit from the profile page. Explicit values win here (unlike the merge
// in upsertCustomer) — clearing a field is intentional. Email is the identity
// key and can't be changed here (merge/reissue instead of silent re-keying).
export async function updateCustomerDetails(id, { name, phone, address, city, postal, notes } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureCustomerSchema();
  const { rowCount } = await query(
    `UPDATE customers SET name=$2, phone=$3, address=$4, city=$5, postal=$6, notes=$7, updated_at=now()
      WHERE id=$1`,
    [Number(id), clean(name), clean(phone, 40), clean(address), clean(city, 100), clean(postal, 20), clean(notes, 4000)]
  );
  if (!rowCount) throw new Error('Customer not found.');
  return { ok: true };
}

// Autofill feed for the invoice/quote builders — full contact including the
// last known delivery address, most recently active first.
export async function contactsForAutofill() {
  if (!hasDb()) return [];
  try {
    await ensureBackfilled();
    const { rows } = await query(
      `SELECT name, email, phone, address, city, postal
         FROM customers ORDER BY updated_at DESC LIMIT 1000`
    );
    return rows.map((r) => ({
      name: r.name || '', email: r.email || '', phone: r.phone || '',
      address: r.address || '', city: r.city || '', postal: r.postal || ''
    }));
  } catch { return []; }
}

// Checkout prefill for a logged-in returning customer: their last known
// phone + delivery address. Best-effort (checkout renders fine without it).
export async function contactForEmail(email) {
  const mail = normEmail(email);
  if (!hasDb() || !mail) return null;
  try {
    await ensureCustomerSchema();
    const { rows } = await query(
      'SELECT name, phone, address, city, postal FROM customers WHERE email = $1', [mail]
    );
    return rows[0] || null;
  } catch { return null; }
}
