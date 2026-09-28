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
import { hasDb, query, withTransaction } from './db';
import { phoneKey } from './constants';

let _schema = null;
export function ensureCustomerSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS customers (
        id serial PRIMARY KEY,
        email text,
        name text, phone text, phone_key text,
        address text, city text, postal text,
        notes text,
        user_id int,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      -- Mirrors db/migrations/0003_customer_identity.sql for a database that
      -- has not had the migrations run. Email is NOT unique-by-column any more:
      -- it is nullable, so the uniqueness has to be partial.
      ALTER TABLE customers ALTER COLUMN email DROP NOT NULL;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_key text;
      ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_email_key;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_live
        ON customers (email) WHERE email IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_key_live
        ON customers (phone_key) WHERE email IS NULL AND phone_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_customers_phone_key ON customers (phone_key);
      CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (lower(name));
      -- Mirrors db/migrations/0004_customer_aliases.sql.
      CREATE TABLE IF NOT EXISTS customer_aliases (
        id               serial PRIMARY KEY,
        customer_id      int NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        kind             text NOT NULL CHECK (kind IN ('email', 'phone')),
        value            text NOT NULL,
        from_customer_id int,
        note             text,
        merged_by        text,
        created_at       timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_alias_value ON customer_aliases (kind, value);
      CREATE INDEX IF NOT EXISTS idx_customer_alias_customer ON customer_aliases (customer_id);
      -- Mirrors db/migrations/0005_customer_activity.sql. Provisioned HERE and
      -- not only in lib/crm because mergeCustomers has to move their rows, and
      -- a merge that dies on a missing table is worse than no timeline.
      CREATE TABLE IF NOT EXISTS customer_activity (
        id serial PRIMARY KEY,
        customer_id int NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        kind text NOT NULL, body text NOT NULL,
        by_email text, by_name text,
        at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_customer_activity_customer ON customer_activity (customer_id, at DESC);
      CREATE TABLE IF NOT EXISTS customer_tasks (
        id serial PRIMARY KEY,
        customer_id int NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        title text NOT NULL, note text, due_on date,
        owner_email text, created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        done_at timestamptz, done_by text, outcome text
      );
      CREATE INDEX IF NOT EXISTS idx_customer_tasks_open ON customer_tasks (due_on, owner_email) WHERE done_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_customer_tasks_customer ON customer_tasks (customer_id, created_at DESC);
    `).then(ensureCrmIndexes).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// The CRM's join key is lower(email) — a FUNCTION of the column, which a plain
// index on the column itself cannot answer. Without these, the customer list
// (joining across up to 500 customers), every profile page, the repeat-buyer
// analytics and the checkout fraud check are each a sequential scan of the
// whole table. The expression has to match the queries character for character
// or the planner ignores the index.
//
// EACH ONE RUNS ON ITS OWN AND SWALLOWS ITS OWN FAILURE, deliberately. `orders`
// comes from db/migrations/0001_baseline.sql but `invoices` and `quotes` are self-provisioned by
// their own modules, so on a fresh database they may not exist yet. Folded into
// the schema string above they would be one implicit transaction, and the
// missing table would roll back the customers table with it — the CRM would
// fail to provision because an index on somebody else's table couldn't be
// built. An index is an optimisation; never let one hold a table hostage.
async function ensureCrmIndexes() {
  const idx = [
    'CREATE INDEX IF NOT EXISTS idx_orders_email_lower   ON orders   (lower(email))',
    'CREATE INDEX IF NOT EXISTS idx_invoices_email_lower ON invoices (lower(email))',
    'CREATE INDEX IF NOT EXISTS idx_quotes_email_lower   ON quotes   (lower(email))',
    'CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders (status, created_at DESC)'
  ];
  await Promise.all(idx.map((sql) => query(sql).catch(() => {})));
}

// How an ORDER is matched to a CUSTOMER, in one place because the list and the
// profile must agree or a customer's spend disagrees with their order history.
//
// Email when the customer has one; otherwise the phone. A phone-only customer —
// a walk-in, or one of Sarah's phone orders — has real orders against their
// number and would otherwise show a profile with no history at all, which is
// worse than not having the record.
//
// The phone arm is deliberately NOT applied to a customer who has an email:
// that is the same rule as identity (see upsertCustomer), and without it two
// people sharing a landline would each be credited with the other's orders.
const ORDER_KEY = `'+1' || right(regexp_replace(coalesce(o.phone,''), '\\D', '', 'g'), 10)`;
const ORDER_MATCH = `(
  (c.email IS NOT NULL AND lower(o.email) = c.email)
  OR (c.email IS NULL AND c.phone_key IS NOT NULL AND ${ORDER_KEY} = c.phone_key)
  -- ...and anything this customer absorbed by a merge. Without this arm a merge
  -- would drop the other record's order history on the floor, which is the one
  -- outcome a merge must never have.
  OR EXISTS (
    SELECT 1 FROM customer_aliases a
     WHERE a.customer_id = c.id
       AND ((a.kind = 'email' AND a.value = lower(o.email))
         OR (a.kind = 'phone' AND a.value = ${ORDER_KEY}))
  )
)`;

const normEmail = (e) => String(e || '').trim().toLowerCase();
const clean = (v, max = 200) => {
  const s = String(v == null ? '' : v).trim().slice(0, max);
  return s || null;
};

// Merge a contact sighting into the customer record. Newest NON-EMPTY value
// wins per field (a fresh delivery address replaces the old one; a checkout
// without a phone never blanks a phone we already know). Safe to call from
// hot paths — callers should .catch() so a CRM failure never blocks a sale.
//
// IDENTITY, in order of how much it can be trusted:
//   1. the email address, when there is one;
//   2. the phone, but only against a record that has NO email.
//
// That second rule is what lets a walk-in exist. It is also what makes the
// upgrade below work: somebody booked in at the counter with a phone number,
// who later buys online and gives an email, should become the SAME customer
// rather than a second one. The phone is deliberately not an identity for a
// record that already has an email — two family members share a landline, and
// merging them would be worse than the duplicate that mergeCustomers exists to
// clean up.
export async function upsertCustomer({ email, name, phone, address, city, postal, userId } = {}) {
  if (!hasDb()) return null;
  const mail = normEmail(email);
  const validMail = mail && mail.includes('@') ? mail : null;
  const key = phoneKey(phone);
  // Neither an address nor a number is not a customer; it is a name somebody
  // typed. Previously this returned null for EVERYONE without an email, which
  // is why Sarah's phone orders created no customer at all.
  if (!validMail && !key) return null;

  await ensureCustomerSchema();

  const fields = [clean(name), clean(phone, 40), key, clean(address), clean(city, 100), clean(postal, 20), Number(userId) || null];
  const SET = `
       name    = COALESCE($1, customers.name),
       phone   = COALESCE($2, customers.phone),
       phone_key = COALESCE($3, customers.phone_key),
       address = COALESCE($4, customers.address),
       city    = COALESCE($5, customers.city),
       postal  = COALESCE($6, customers.postal),
       user_id = COALESCE($7, customers.user_id),
       updated_at = now()`;

  return withTransaction(async (client) => {
    if (validMail) {
      // 1. Known by email → update in place.
      const hit = await client.query(
        `UPDATE customers SET ${SET} WHERE email = $8 RETURNING id`, [...fields, validMail]
      );
      if (hit.rows.length) return hit.rows[0].id;

      // 1b. AN ADDRESS ABSORBED BY A MERGE still belongs to whoever absorbed
      //     it. Without this the next order from that address recreates the
      //     duplicate and quietly undoes the merge — the merge would last until
      //     the customer next bought something.
      const alias = await client.query(
        `UPDATE customers SET ${SET}
          WHERE id = (SELECT customer_id FROM customer_aliases
                       WHERE kind = 'email' AND value = $8)
        RETURNING id`, [...fields, validMail]
      );
      if (alias.rows.length) return alias.rows[0].id;

      // 2. THE UPGRADE. A phone-only record for this number becomes this
      //    person: their email is filled in rather than a second row created.
      if (key) {
        const up = await client.query(
          `UPDATE customers SET email = $8, ${SET.replace(/^\s*/, '')}
            WHERE id = (SELECT id FROM customers
                         WHERE phone_key = $9 AND email IS NULL
                         ORDER BY updated_at DESC LIMIT 1)
          RETURNING id`,
          [...fields, validMail, key]
        );
        if (up.rows.length) return up.rows[0].id;
      }

      const made = await client.query(
        `INSERT INTO customers (email, name, phone, phone_key, address, city, postal, user_id)
         VALUES ($8,$1,$2,$3,$4,$5,$6,$7) RETURNING id`, [...fields, validMail]
      );
      return made.rows[0].id;
    }

    // A number absorbed by a merge, same reasoning as the email arm above.
    const aliased = await client.query(
      `UPDATE customers SET ${SET}
        WHERE id = (SELECT customer_id FROM customer_aliases
                     WHERE kind = 'phone' AND value = $8)
      RETURNING id`, [...fields, key]
    );
    if (aliased.rows.length) return aliased.rows[0].id;

    // No email at all — the walk-in and the phone order. Matched on the number,
    // and only against other records that have no email either.
    const hit = await client.query(
      `UPDATE customers SET ${SET}
        WHERE id = (SELECT id FROM customers
                     WHERE phone_key = $8 AND email IS NULL
                     ORDER BY updated_at DESC LIMIT 1)
      RETURNING id`, [...fields, key]
    );
    if (hit.rows.length) return hit.rows[0].id;

    const made = await client.query(
      `INSERT INTO customers (name, phone, phone_key, address, city, postal, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, fields
    );
    return made.rows[0].id;
  }).catch((e) => {
    console.error('customer upsert failed', e.message);
    return null;
  });
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
       LEFT JOIN orders o ON ${ORDER_MATCH}
      WHERE $1 = '' OR lower(coalesce(c.name,'')) LIKE $2 OR coalesce(c.email,'') LIKE $2
            OR coalesce(c.phone,'') LIKE $2 OR coalesce(c.phone_key,'') LIKE $2
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
    // The matching key, which getCustomerProfile needs to find a phone-only
    // customer's orders. Not shown anywhere — `phone` is what a person reads.
    phoneKey: r.phone_key || null,
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
       LEFT JOIN orders o ON ${ORDER_MATCH}
      WHERE c.id = $1
      GROUP BY c.id, u.member_status, u.business_name`,
    [Number(id)]
  );
  if (!rows.length) return null;
  const customer = shapeCustomer(rows[0]);

  // $1 = their email (may be null), $2 = their phone in E.164 (may be null).
  // The phone arm only applies to a customer with NO email — same rule as
  // identity and as ORDER_MATCH — so a shared landline never shows one person
  // the other's invoices. A customer with neither matches nothing, which is
  // correct and cannot happen (the CHECK refuses such a row).
  // $1 their email, $2 their phone key, $3 their id (for absorbed identities).
  //
  // The alias arm is why this takes an id at all: ORDER_MATCH above gained one
  // when merging arrived, and this expression is the profile's own copy — if
  // only one of them learns about aliases, a merged customer's rollup and their
  // order list disagree, which is precisely the bug ORDER_MATCH was extracted
  // to prevent.
  const KEY = (t) => `'+1' || right(regexp_replace(coalesce(${t}.phone,''), '\\D', '', 'g'), 10)`;
  const BY = (t) => `(
    ($1::text IS NOT NULL AND lower(${t}.email) = $1)
    OR ($1::text IS NULL AND $2::text IS NOT NULL AND ${KEY(t)} = $2)
    OR EXISTS (
      SELECT 1 FROM customer_aliases a
       WHERE a.customer_id = $3::int
         AND ((a.kind = 'email' AND a.value = lower(${t}.email))
           OR (a.kind = 'phone' AND a.value = ${KEY(t)}))
    )
  )`;
  const args = [customer.email || null, customer.email ? null : (customer.phoneKey || null), customer.id];

  const [orders, invoices, quotes] = await Promise.all([
    query(
      `SELECT o.id, o.order_number, o.status, o.total, o.delivery_method, o.created_at,
              COALESCE(json_agg(json_build_object('title', oi.title, 'sku', oi.sku, 'price', oi.price)
                                ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
         FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE ${BY('o')} GROUP BY o.id ORDER BY o.created_at DESC LIMIT 100`,
      args
    ),
    query(
      `SELECT id, number, status, total, refund_total, created_at
         FROM invoices i WHERE ${BY('i')} ORDER BY created_at DESC LIMIT 100`,
      args
    ).catch(() => ({ rows: [] })),
    query(
      // quotes has no phone column, so a phone-only customer simply has none.
      // quotes has no phone column, so only the email arms apply.
      `SELECT id, number, status, total, created_at
         FROM quotes q
        WHERE ($1::text IS NOT NULL AND lower(q.email) = $1)
           OR EXISTS (SELECT 1 FROM customer_aliases a
                       WHERE a.customer_id = $3::int AND a.kind = 'email'
                         AND a.value = lower(q.email))
        ORDER BY created_at DESC LIMIT 100`,
      args
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

// ---------------------------------------------------------------------------
// Merging two records that are one person.
//
// 2.1 made duplicates possible deliberately: the phone is an identity only for
// a record with no email, so two family members sharing a landline stay two
// customers. This is the other half of that decision.
//
// NOTHING MOVES, because nothing points at a customer. Orders, invoices and
// quotes are matched by email address, so the survivor ABSORBS the other
// record's identities and every lookup sees through them (ORDER_MATCH above,
// and upsertCustomer, or the next order would recreate the duplicate).
//
// The survivor's own values always win; the other record only fills BLANKS. A
// merge must never overwrite something somebody typed with something older.
export async function mergeCustomers(keepId, dropId, { by = null } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureCustomerSchema();
  const keep = Number(keepId), drop = Number(dropId);
  if (!keep || !drop) throw new Error('Pick two customers.');
  if (keep === drop) throw new Error('That is the same customer.');

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM customers WHERE id = ANY($1::int[])', [[keep, drop]]
    );
    const k = rows.find((r) => r.id === keep);
    const d = rows.find((r) => r.id === drop);
    if (!k) throw new Error('The customer you are keeping no longer exists.');
    if (!d) throw new Error('The customer you are merging no longer exists.');

    // THE ORDER OF THE NEXT FOUR STEPS IS LOAD-BEARING, and getting it wrong is
    // a unique-constraint violation rather than a silent mess, which is the
    // good kind of wrong. Same family of trap as mergeDrivers' three UPDATEs.
    //
    // 1. Move anything the OTHER record had itself absorbed. This MUST come
    //    before the delete: customer_aliases is ON DELETE CASCADE, so deleting
    //    first would take a previous merge's trail with it and orphan that
    //    record's history.
    const { rowCount: moved } = await client.query(
      'UPDATE customer_aliases SET customer_id = $1 WHERE customer_id = $2', [keep, drop]
    );

    // 1b. The timeline and the follow-ups, for the same reason and with the
    //     same urgency: both are ON DELETE CASCADE, so deleting the other
    //     record first destroys every note anybody ever wrote on it and every
    //     follow-up still owed. Silently — the merge would report success.
    const { rowCount: notesMoved } = await client.query(
      'UPDATE customer_activity SET customer_id = $1 WHERE customer_id = $2', [keep, drop]
    );
    const { rowCount: tasksMoved } = await client.query(
      'UPDATE customer_tasks SET customer_id = $1 WHERE customer_id = $2', [keep, drop]
    );

    // 2. Delete the other record BEFORE filling the survivor's blanks. Email is
    //    uniquely indexed, so giving the survivor an address the other record
    //    still holds violates it — which is exactly what happened the first time
    //    this was written.
    //
    //    Nothing references a customer, so the row goes rather than being
    //    marked: a `merged_into` column would have to be filtered by every
    //    query forever, and the alias rows are the trail.
    await client.query('DELETE FROM customers WHERE id = $1', [drop]);

    // 3. Fill the survivor's blanks. COALESCE is survivor-first throughout: the
    //    record being kept is the one somebody chose to keep, and a merge must
    //    never replace something typed with something older.
    const notes = [k.notes, d.notes && `— merged from ${d.email || d.phone || `#${d.id}`}: ${d.notes}`]
      .filter(Boolean).join('\n');
    await client.query(
      `UPDATE customers SET
         email     = COALESCE(email, $2),
         name      = COALESCE(name, $3),
         phone     = COALESCE(phone, $4),
         phone_key = COALESCE(phone_key, $5),
         address   = COALESCE(address, $6),
         city      = COALESCE(city, $7),
         postal    = COALESCE(postal, $8),
         user_id   = COALESCE(user_id, $9),
         notes     = NULLIF($10, ''),
         -- The earlier of the two first-sightings. Merging must not make a
         -- long-standing customer look new.
         created_at = LEAST(created_at, $11),
         updated_at = now()
       WHERE id = $1`,
      [keep, d.email, d.name, d.phone, d.phone_key, d.address, d.city, d.postal, d.user_id, notes, d.created_at]
    );

    // 4. Record what was absorbed, now that the survivor's own identities are
    //    settled.
    const { rows: after } = await client.query('SELECT email, phone_key FROM customers WHERE id = $1', [keep]);
    const mine = after[0];

    // WHICH IDENTITIES STILL NEED AN ALIAS, and the two kinds differ:
    //
    //   email — an address the survivor now owns is findable by the ordinary
    //           email lookup, so it needs no alias.
    //   phone — a number is only an identity for a record with NO email
    //           (2.1's rule, so a shared landline never merges two people). So
    //           on a survivor that HAS an email, the absorbed number is
    //           findable only as an alias, and skipping it there loses the
    //           number the merge was often performed because of.
    const absorbed = [];
    const note = `merged from #${d.id}${d.name ? ` (${d.name})` : ''}`;
    const needsAlias = {
      email: d.email && d.email !== mine.email,
      phone: d.phone_key && !(mine.email === null && mine.phone_key === d.phone_key)
    };
    for (const [kind, value] of [['email', d.email], ['phone', d.phone_key]]) {
      if (!value || !needsAlias[kind]) continue;
      // ON CONFLICT: the identity may already be an alias from an earlier
      // merge. Re-pointing it at the survivor is right either way.
      await client.query(
        `INSERT INTO customer_aliases (customer_id, kind, value, from_customer_id, note, merged_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (kind, value) DO UPDATE SET customer_id = EXCLUDED.customer_id`,
        [keep, kind, value, d.id, note, by]
      );
      absorbed.push(`${kind}:${value}`);
    }

    return { ok: true, keptId: keep, droppedId: drop, absorbed, aliasesMoved: moved, notesMoved, tasksMoved };
  });
}

/** Everything this customer has absorbed — shown on their profile. */
export async function customerAliases(customerId) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT kind, value, note, merged_by, created_at FROM customer_aliases
      WHERE customer_id = $1 ORDER BY created_at DESC`, [Number(customerId)]
  ).catch(() => ({ rows: [] }));
  return rows;
}

/**
 * Records that look like the same person, for the merge screen to propose.
 *
 * SUGGESTS, never merges. Two people can share a name, a household shares a
 * phone, and an automatic merge is unpickable — the aliases move and the
 * original row is gone. A human confirms.
 */
export async function duplicateCandidates({ limit = 50 } = {}) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT a.id AS a_id, a.name AS a_name, a.email AS a_email, a.phone AS a_phone,
            b.id AS b_id, b.name AS b_name, b.email AS b_email, b.phone AS b_phone,
            CASE WHEN a.phone_key IS NOT NULL AND a.phone_key = b.phone_key THEN 'same phone'
                 ELSE 'same name' END AS why
       FROM customers a JOIN customers b ON a.id < b.id
      WHERE (a.phone_key IS NOT NULL AND a.phone_key = b.phone_key)
         OR (a.name IS NOT NULL AND length(trim(a.name)) > 3
             AND lower(trim(a.name)) = lower(trim(b.name)))
      ORDER BY a.id DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)]
  ).catch(() => ({ rows: [] }));
  return rows.map((r) => ({
    why: r.why,
    a: { id: r.a_id, name: r.a_name, email: r.a_email, phone: r.a_phone },
    b: { id: r.b_id, name: r.b_name, email: r.b_email, phone: r.b_phone }
  }));
}
