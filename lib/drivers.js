// Delivery drivers + scheduling, layered on the existing users/orders tables.
// A driver is a normal user account with users.is_driver = true; they sign in
// via /login and work their stops at /driver.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, hasDb } from './db';
import { balancesForOrders } from './jobs';

// True if the logged-in session belongs to a driver account.
export async function isDriver(session) {
  if (!session?.userId || !hasDb()) return false;
  try {
    const { rows } = await query('SELECT is_driver FROM users WHERE id = $1', [session.userId]);
    return !!rows[0]?.is_driver;
  } catch {
    return false;
  }
}

export async function listDrivers() {
  if (!hasDb()) return [];
  const { rows } = await query(
    'SELECT id, name, email, phone FROM users WHERE is_driver = true ORDER BY name NULLS LAST, email'
  );
  return rows;
}

// Owner action: flip a user's driver flag by email. The person must already have
// an account (signed up) — returns { ok:false, reason } if no user matches.
export async function setDriverByEmail(email, on) {
  if (!hasDb()) throw new Error('Database not configured');
  const { rows } = await query(
    'UPDATE users SET is_driver = $2 WHERE email = $1 RETURNING id, name, email',
    [String(email || '').trim().toLowerCase(), !!on]
  );
  if (!rows.length) return { ok: false, reason: 'No account with that email — have them sign up first.' };
  return { ok: true, user: rows[0] };
}

// Owner action: assign a delivery date and/or driver to a delivery order.
//
// The driver's phone shows JOBS, so an order assigned here has to reach the
// board too — otherwise the office assigns a delivery from the Operations page,
// sees a driver's name against it, and the driver never sees the stop. Whichever
// screen the assignment is made on, the same job comes out.
export async function assignDelivery(orderId, { deliveryDate, driverId }) {
  if (!hasDb()) throw new Error('Database not configured');
  const { rows } = await query(
    `UPDATE orders
        SET delivery_date = $2,
            driver_id     = $3
      WHERE id = $1 AND delivery_method = 'delivery'
      RETURNING id, order_number, delivery_date, driver_id`,
    [orderId, deliveryDate || null, driverId || null]
  );
  const order = rows[0];
  if (!order) return null;

  // Best-effort and never fatal: the assignment above is what the office asked
  // for, and a dispatch hiccup must not swallow it.
  try {
    // Imported lazily: lib/jobs imports nothing from here today, and a static
    // import would be one more edge in a graph that already has a cycle scar
    // (see lib/web-invoices.js).
    const { importOneBargainBayOrder, assignJob } = await import('./jobs');
    const { rows: existing } = await query(
      `SELECT id FROM jobs WHERE order_id = $1 AND status <> 'cancelled' ORDER BY id LIMIT 1`,
      [orderId]
    );
    let jobId = existing[0]?.id || null;
    if (!jobId) {
      const made = await importOneBargainBayOrder(order.order_number, { by: { name: 'Operations' } });
      const num = made?.created?.[0]?.job;
      if (num) jobId = (await query('SELECT id FROM jobs WHERE job_number = $1', [num])).rows[0]?.id || null;
    }
    if (jobId) {
      await assignJob(jobId, { driverId: driverId || null, jobDate: deliveryDate || null }, { name: 'Operations' });
    }
  } catch (e) {
    console.error('order assignment did not reach the board', e.message);
  }
  return order;
}

// A driver's active stops: assigned delivery orders not yet delivered/cancelled,
// soonest first. Includes the items for each order.
export async function driverDeliveries(driverId) {
  if (!hasDb() || !driverId) return [];
  const { rows } = await query(
    `SELECT id, order_number, name, email, phone, address, city, postal,
            status, delivery_date, total
       FROM orders
      WHERE driver_id = $1 AND delivery_method = 'delivery'
        AND status NOT IN ('delivered','cancelled')
      ORDER BY delivery_date ASC NULLS LAST, id ASC`,
    [driverId]
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const { rows: items } = await query(
    'SELECT order_id, sku, title FROM order_items WHERE order_id = ANY($1) ORDER BY id',
    [ids]
  );
  const byOrder = new Map();
  for (const it of items) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push(it);
  }
  // What the customer still owes. The shop's flow is deposit now, balance on
  // delivery — so the stop list has to say what to come back with, or the driver
  // hands the appliance over and the office chases the money by phone.
  const balances = await balancesForOrders(ids);
  return rows.map((o) => {
    const bal = balances.get(o.id) || null;
    return {
      ...o,
      delivery_date: o.delivery_date ? o.delivery_date.toISOString().slice(0, 10) : null,
      items: byOrder.get(o.id) || [],
      balance_due: bal ? bal.balanceDue : 0,
      invoice_number: bal ? bal.invoiceNumber : null
    };
  });
}

// Verify an order is assigned to this driver (guards driver-only mutations).
export async function orderBelongsToDriver(orderId, driverId) {
  if (!hasDb()) return false;
  const { rows } = await query('SELECT 1 FROM orders WHERE id = $1 AND driver_id = $2', [orderId, driverId]);
  return rows.length > 0;
}

// ── Activation by text ───────────────────────────────────────────────────────
// Five or six drivers, every one on a different phone, none of whom should be
// asked to create an account. The office types a name and a mobile number; the
// driver gets a text, taps it once, and is signed in on that phone for good.
//
// A driver is still a users row (jobs.driver_id points at it, and the board and
// pay report already read it) — it just gets there without a signup. The email
// is synthetic and the password hash is deliberately unusable: there is no
// password to guess and nothing to phish, and the account is NOT on any staff
// list, so a driver's phone can only ever see driver surfaces.

let _driverSchema = null;
function ensureDriverSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_driverSchema) {
    _driverSchema = query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_driver boolean NOT NULL DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS driver_last_seen timestamptz;
      CREATE TABLE IF NOT EXISTS driver_links (
        id serial PRIMARY KEY,
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        sent_to text,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        used_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_driver_links_user ON driver_links(user_id);
    `).catch((e) => { _driverSchema = null; throw e; });
  }
  return _driverSchema;
}

// A link is good for two weeks — long enough for a driver who starts on Monday
// to be texted on Friday, short enough that an old text found on a lost phone
// is useless.
const LINK_DAYS = 14;
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Digits only, then the last 10 — people write numbers as (647) 943-7714,
// 1-647-943-7714 and 6479437714 and mean the same driver.
export function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D+/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}
const e164 = (phone) => `+1${normalizePhone(phone)}`;

// Add (or re-activate) a driver from a name and a mobile number. Matching is by
// phone: re-adding somebody who already drives for us returns the same account
// rather than a second one with the same person's stops split across it.
export async function addDriverByPhone({ name, phone }) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureDriverSchema();
  const digits = normalizePhone(phone);
  if (digits.length !== 10) throw new Error('Enter a 10-digit mobile number — that is where the sign-in link goes.');
  const clean = String(name || '').trim().slice(0, 120);
  if (!clean) throw new Error("Enter the driver's name.");

  const { rows: existing } = await query(
    `SELECT id, name, email, phone, is_driver FROM users
      WHERE regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE '%' || $1
      ORDER BY id LIMIT 1`,
    [digits]
  );
  if (existing.length) {
    const { rows } = await query(
      'UPDATE users SET is_driver = true, name = COALESCE(NULLIF($2,\'\'), name), phone = $3 WHERE id = $1 RETURNING id, name, email, phone',
      [existing[0].id, clean, digits]
    );
    return { ...rows[0], created: false };
  }

  // No account: make one that can only ever be reached by a texted link.
  const email = `driver-${digits}@drivers.bargainbay.ca`;
  const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const { rows } = await query(
    `INSERT INTO users (email, name, phone, password_hash, is_driver)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT (email) DO UPDATE SET is_driver = true, name = EXCLUDED.name, phone = EXCLUDED.phone
     RETURNING id, name, email, phone`,
    [email, clean, digits, unusable]
  );
  return { ...rows[0], created: true };
}

// Mint a single-use sign-in link. Only the HASH is stored, so a leaked database
// row can't be used to sign in as a driver.
export async function createDriverSignInLink(userId) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureDriverSchema();
  const { rows: u } = await query('SELECT id, name, phone, is_driver FROM users WHERE id = $1', [Number(userId)]);
  if (!u.length || !u[0].is_driver) throw new Error('That account is not a driver.');
  const token = crypto.randomBytes(32).toString('base64url');
  // Outstanding links for the same driver are killed: the newest text is the
  // one that works, so a re-send after "I lost it" leaves exactly one live link.
  await query('UPDATE driver_links SET used_at = COALESCE(used_at, now()) WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await query(
    `INSERT INTO driver_links (user_id, token_hash, sent_to, expires_at)
     VALUES ($1,$2,$3, now() + make_interval(days => $4))`,
    [userId, hashToken(token), u[0].phone || null, LINK_DAYS]
  );
  return { token, driver: u[0], expiresInDays: LINK_DAYS };
}

// Redeem a link: returns the user to sign in as, or null. Single use.
export async function redeemDriverSignInLink(token) {
  if (!hasDb() || !token) return null;
  await ensureDriverSchema();
  const { rows } = await query(
    `UPDATE driver_links SET used_at = now()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [hashToken(token)]
  );
  if (!rows.length) return null;
  const { rows: u } = await query(
    'SELECT id, email, name, is_driver FROM users WHERE id = $1', [rows[0].user_id]
  );
  return u[0]?.is_driver ? u[0] : null;
}

export async function touchDriverSeen(userId) {
  if (!hasDb() || !userId) return;
  await query('UPDATE users SET driver_last_seen = now() WHERE id = $1', [userId]).catch(() => {});
}

// The roster the office sees: who drives, on what number, and whether they have
// ever opened the app (a driver who never tapped the link is the failure this
// whole flow exists to make visible).
export async function listDriversForOffice() {
  if (!hasDb()) return [];
  await ensureDriverSchema();
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.phone, u.driver_last_seen,
            (SELECT max(created_at) FROM driver_links l WHERE l.user_id = u.id) AS link_sent_at,
            EXISTS (SELECT 1 FROM driver_links l WHERE l.user_id = u.id AND l.used_at IS NULL AND l.expires_at > now()) AS link_live
       FROM users u WHERE u.is_driver = true
      ORDER BY u.name NULLS LAST, u.email`
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, phone: r.phone,
    lastSeen: r.driver_last_seen ? r.driver_last_seen.toISOString() : null,
    linkSentAt: r.link_sent_at ? r.link_sent_at.toISOString() : null,
    linkLive: !!r.link_live
  }));
}

export { e164 as driverSmsNumber };
