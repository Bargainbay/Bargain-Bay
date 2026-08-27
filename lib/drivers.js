// Delivery drivers + scheduling, layered on the existing users/orders tables.
// A driver is a normal user account with users.is_driver = true; they sign in
// via /login and work their stops at /driver.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, hasDb, withTransaction } from './db';
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
      -- Sign in by typing your own mobile and the 6 digits we text back. The
      -- texted LINK is for the first day; this is for every day after it, and
      -- needs nobody in the office.
      CREATE TABLE IF NOT EXISTS driver_codes (
        id serial PRIMARY KEY,
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash text NOT NULL,
        sent_to text,
        attempts int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        used_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_driver_codes_user ON driver_codes(user_id, created_at DESC);
    `).catch((e) => { _driverSchema = null; throw e; });
  }
  return _driverSchema;
}

// A link is good for two weeks — long enough for a driver who starts on Monday
// to be texted on Friday, short enough that an old text found on a lost phone
// is useless.
//
// It is REUSABLE inside that window. It used to be single-use, which read to
// drivers as "the link expires in fifteen minutes": they reopen the app the only
// way they remember — the text — and the second tap said expired. A stop list is
// not worth locking the person holding the van out of.
const LINK_DAYS = 14;
// A typed code is the everyday way in. Short-lived because it is six digits.
const CODE_MINUTES = 15;
const CODE_TRIES = 5;
const CODE_MAX_PER_HOUR = 5;
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// Digits only, then the last 10 — people write numbers as (647) 943-7714,
// 1-647-943-7714 and 6479437714 and mean the same driver.
export function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D+/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}
const e164 = (phone) => `+1${normalizePhone(phone)}`;

// The synthetic address a texted-in driver's account is filed under. There is
// no mailbox behind it — it exists because `users` needs a unique email and
// because it makes a driver account recognisable at a glance in the table.
const driverEmail = (digits) => `driver-${digits}@drivers.bargainbay.ca`;
const isDriverEmail = (email) => /^driver-\d{10}@drivers\.bargainbay\.ca$/.test(String(email || ''));

// Add (or re-activate) a driver from a name and a mobile number. Matching is by
// phone: re-adding somebody who already drives for us returns the same account
// rather than a second one with the same person's stops split across it.
//
// Matching by phone is also the trap. A driver who changes their number is not
// a new driver, but arriving here with a new number looks exactly like one — so
// a name we already have is refused rather than duplicated, and pointed at the
// change-number button. A second account for the same person splits their stops
// across two board columns, their pay across two rows of the report, and their
// history in half. `force` is how the office says "no, genuinely a different
// person with the same name".
export async function addDriverByPhone({ name, phone, force = false }) {
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
  if (!existing.length && !force) {
    const { rows: sameName } = await query(
      `SELECT id, name, phone FROM users
        WHERE is_driver = true AND lower(trim(COALESCE(name,''))) = lower($1)
        ORDER BY id LIMIT 1`,
      [clean]
    );
    if (sameName.length) {
      const err = new Error(
        `${sameName[0].name} already drives for us on ${sameName[0].phone || 'another number'}. `
        + 'If they have a new phone, change the number on their line instead — adding them again '
        + 'would split their stops and their pay across two accounts.'
      );
      err.code = 'DRIVER_NAME_TAKEN';
      err.driver = { id: sameName[0].id, name: sameName[0].name, phone: sameName[0].phone };
      throw err;
    }
  }
  if (existing.length) {
    const { rows } = await query(
      'UPDATE users SET is_driver = true, name = COALESCE(NULLIF($2,\'\'), name), phone = $3 WHERE id = $1 RETURNING id, name, email, phone',
      [existing[0].id, clean, digits]
    );
    return { ...rows[0], created: false };
  }

  // No account: make one that can only ever be reached by a texted link.
  const email = driverEmail(digits);
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

// ── A driver changes their number ────────────────────────────────────────────
// The one thing the office was told not to do. Everything about a driver hangs
// off `users.id` — their stops, their column on the board, their pay, their
// signed proof of delivery — but everything about SIGNING IN is looked up by
// phone number. So re-adding somebody on a new number built a second account,
// and from that moment the same human being had two columns on the board, two
// rows on the pay report, and half a history in each.
//
// This moves the number on the account they already have. The person, their
// work and their history stay exactly where they are; only the way in changes.
//
// Two things are deliberately torn down with the old number:
//   · unused codes, because a six-digit code was just texted to a handset that
//     is very often the reason the number is changing at all; and
//   · live links, for the same reason — a link in a text on a lost phone is a
//     working key to that driver's stop list until it expires.
// The driver's own signed-in phone is NOT touched: a new SIM in the same hand
// is the ordinary case, and signing them out of a van mid-run helps nobody.
export async function changeDriverPhone(userId, phone) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureDriverSchema();
  const id = Number(userId);
  const digits = normalizePhone(phone);
  if (digits.length !== 10) throw new Error('Enter their new 10-digit mobile number.');

  const { rows: cur } = await query('SELECT id, name, email, phone, is_driver FROM users WHERE id = $1', [id]);
  if (!cur.length) throw new Error('No such driver.');
  if (!cur[0].is_driver) throw new Error('That account is not a driver.');
  const was = normalizePhone(cur[0].phone);
  if (was === digits) return { ...cur[0], unchanged: true };

  // Somebody else already answers on that number. Almost always this IS the
  // duplicate: the office added them a second time before, and the fix is to
  // merge the two accounts, not to give one of them the other's number.
  const { rows: clash } = await query(
    `SELECT id, name, is_driver FROM users
      WHERE id <> $2 AND regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE '%' || $1
      ORDER BY id LIMIT 1`,
    [digits, id]
  );
  if (clash.length) {
    const err = new Error(
      `${clash[0].name || 'Another account'} is already on that number.`
      + (clash[0].is_driver
        ? ' If that is the same person added twice, merge the two accounts instead — merging keeps all their stops and pay on one of them.'
        : ' Use a different number.')
    );
    err.code = 'PHONE_TAKEN';
    err.driver = { id: clash[0].id, name: clash[0].name, isDriver: !!clash[0].is_driver };
    throw err;
  }

  // Keep the filed-under address in step with the number, but only when it is
  // one we generated. A driver who signed up with a real address of their own
  // keeps it — and so does one whose new synthetic address is already taken by
  // some older row, because a unique-constraint violation here would read as
  // "changing the number is broken" when the number is perfectly fine.
  let nextEmail = cur[0].email;
  if (isDriverEmail(cur[0].email)) {
    const wanted = driverEmail(digits);
    const { rows: taken } = await query('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [wanted, id]);
    if (!taken.length) nextEmail = wanted;
  }
  const { rows } = await query(
    'UPDATE users SET phone = $2, email = $3 WHERE id = $1 RETURNING id, name, email, phone',
    [id, digits, nextEmail]
  );
  await query('UPDATE driver_codes SET used_at = COALESCE(used_at, now()) WHERE user_id = $1 AND used_at IS NULL', [id]);
  await query('UPDATE driver_links SET expires_at = now() WHERE user_id = $1 AND expires_at > now()', [id]);
  return { ...rows[0], previousPhone: cur[0].phone || null, unchanged: false };
}

// Fold a duplicate driver into the real one. This is the repair for a person who
// was already added twice — before there was any way to change a number, that
// was the only way to keep driving after a new phone.
//
// Every reference to the duplicate is moved, not deleted: their stops (both
// seats), their orders, the money already recorded against them. What's left is
// switched off rather than removed, because a users row is referenced from
// places that have nothing to do with driving.
export async function mergeDrivers(keepId, dropId) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureDriverSchema();
  const keep = Number(keepId);
  const drop = Number(dropId);
  if (!keep || !drop || keep === drop) throw new Error('Pick two different accounts.');

  const { rows: both } = await query(
    'SELECT id, name, email, phone, is_driver FROM users WHERE id = ANY($1::int[])', [[keep, drop]]
  );
  const k = both.find((r) => r.id === keep);
  const d = both.find((r) => r.id === drop);
  if (!k || !d) throw new Error('One of those accounts no longer exists.');
  if (!k.is_driver) throw new Error('The account you are keeping is not a driver.');

  const moved = {};
  await withTransaction(async (client) => {
    // Second seat first: if the same stop had the duplicate in BOTH seats, the
    // merge would otherwise leave one person listed twice on one van.
    await client.query('UPDATE jobs SET driver2_id = NULL WHERE driver2_id = $1 AND driver_id = $2', [drop, keep]);
    await client.query('UPDATE jobs SET driver2_id = $1 WHERE driver2_id = $2', [keep, drop]);
    const j = await client.query('UPDATE jobs SET driver_id = $1 WHERE driver_id = $2', [keep, drop]);
    await client.query('UPDATE jobs SET driver2_id = NULL WHERE driver_id = driver2_id');
    moved.jobs = j.rowCount;
    // Orders carry a driver of their own (the Operations page assigns there).
    const o = await client.query('UPDATE orders SET driver_id = $1 WHERE driver_id = $2', [keep, drop]);
    moved.orders = o.rowCount;
    await client.query('UPDATE driver_links SET expires_at = now() WHERE user_id = $1', [drop]);
    await client.query('UPDATE driver_codes SET used_at = COALESCE(used_at, now()) WHERE user_id = $1', [drop]);
    await client.query('UPDATE users SET is_driver = false WHERE id = $1', [drop]);
  });
  return { keep: k, dropped: d, ...moved };
}

// Mint a single-use sign-in link. Only the HASH is stored, so a leaked database
// row can't be used to sign in as a driver.
export async function createDriverSignInLink(userId) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureDriverSchema();
  const { rows: u } = await query('SELECT id, name, phone, is_driver FROM users WHERE id = $1', [Number(userId)]);
  if (!u.length || !u[0].is_driver) throw new Error('That account is not a driver.');
  const token = crypto.randomBytes(32).toString('base64url');
  // Older links are LEFT ALIVE until they expire on their own. Killing them made
  // a re-send ("I lost the text") silently break the text the driver actually
  // still had, and a driver who can't get in is a van that doesn't move.
  await query(
    `INSERT INTO driver_links (user_id, token_hash, sent_to, expires_at)
     VALUES ($1,$2,$3, now() + make_interval(days => $4))`,
    [userId, hashToken(token), u[0].phone || null, LINK_DAYS]
  );
  return { token, driver: u[0], expiresInDays: LINK_DAYS };
}

// Look at a link WITHOUT spending it. The texted link is opened twice: once by
// the messaging app building its little preview card, and once by the driver's
// thumb. Only the second one may consume the token.
export async function peekDriverSignInLink(token) {
  if (!hasDb() || !token) return null;
  await ensureDriverSchema();
  const { rows } = await query(
    `SELECT u.id, u.name, u.email
       FROM driver_links l JOIN users u ON u.id = l.user_id
      WHERE l.token_hash = $1 AND l.expires_at > now()
        AND u.is_driver = true
      LIMIT 1`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

// Redeem a link: returns the user to sign in as, or null. Reusable until it
// expires — `used_at` records the FIRST tap (the roster shows it) and never
// blocks a later one.
export async function redeemDriverSignInLink(token) {
  if (!hasDb() || !token) return null;
  await ensureDriverSchema();
  const { rows } = await query(
    `UPDATE driver_links SET used_at = COALESCE(used_at, now())
      WHERE token_hash = $1 AND expires_at > now()
      RETURNING user_id`,
    [hashToken(token)]
  );
  if (!rows.length) return null;
  const { rows: u } = await query(
    'SELECT id, email, name, is_driver FROM users WHERE id = $1', [rows[0].user_id]
  );
  return u[0]?.is_driver ? u[0] : null;
}

// ── Signing in with your own phone number ────────────────────────────────────
// The everyday way in. A driver types the mobile the office already has for
// them, we text six digits, they type those. No link to lose, no office to ring,
// and it works on a phone that has been wiped or replaced.
//
// Deliberately quiet about who exists: an unknown number gets the same answer as
// a known one, so the form can't be used to find out who drives for us.
export async function startDriverCode(phone) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureDriverSchema();
  const digits = normalizePhone(phone);
  if (digits.length !== 10) throw new Error('Enter your 10-digit mobile number.');

  const { rows } = await query(
    `SELECT id, name, phone FROM users
      WHERE is_driver = true
        AND regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE '%' || $1
      ORDER BY id LIMIT 1`,
    [digits]
  );
  const driver = rows[0];
  // No such driver: say nothing, do nothing, and let the caller answer 'sent'.
  if (!driver) return { sent: false, quiet: true };

  const { rows: recent } = await query(
    `SELECT count(*)::int AS n FROM driver_codes
      WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
    [driver.id]
  );
  if ((recent[0]?.n || 0) >= CODE_MAX_PER_HOUR) {
    throw new Error('That is a lot of codes in an hour — wait a bit, or ask the office for a link.');
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  // A new code retires the old one, so only the most recent text works.
  await query('UPDATE driver_codes SET used_at = COALESCE(used_at, now()) WHERE user_id = $1 AND used_at IS NULL', [driver.id]);
  await query(
    `INSERT INTO driver_codes (user_id, code_hash, sent_to, expires_at)
     VALUES ($1,$2,$3, now() + make_interval(mins => $4))`,
    [driver.id, hashToken(code), driver.phone || digits, CODE_MINUTES]
  );
  return { sent: true, code, driver, minutes: CODE_MINUTES };
}

// Check the six digits. Returns the user to sign in as, or null.
export async function verifyDriverCode(phone, code) {
  if (!hasDb()) return null;
  await ensureDriverSchema();
  const digits = normalizePhone(phone);
  const typed = String(code || '').replace(/\D+/g, '');
  if (digits.length !== 10 || typed.length !== 6) return null;

  const { rows } = await query(
    `SELECT c.id, c.code_hash, c.attempts, u.id AS user_id, u.email, u.name
       FROM driver_codes c JOIN users u ON u.id = c.user_id
      WHERE u.is_driver = true
        AND regexp_replace(COALESCE(u.phone,''), '\\D', '', 'g') LIKE '%' || $1
        AND c.used_at IS NULL AND c.expires_at > now()
      ORDER BY c.created_at DESC LIMIT 1`,
    [digits]
  );
  const row = rows[0];
  if (!row) return null;
  // Five wrong guesses and the code is dead — six digits is not many to try.
  if (row.attempts >= CODE_TRIES) {
    await query('UPDATE driver_codes SET used_at = now() WHERE id = $1', [row.id]);
    return null;
  }
  if (row.code_hash !== hashToken(typed)) {
    await query('UPDATE driver_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    return null;
  }
  await query('UPDATE driver_codes SET used_at = now() WHERE id = $1', [row.id]);
  return { id: row.user_id, email: row.email, name: row.name };
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
            EXISTS (SELECT 1 FROM driver_links l WHERE l.user_id = u.id AND l.expires_at > now()) AS link_live
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
