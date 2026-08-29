// Abuse controls for the two public write paths: /api/checkout and /api/auth/signup.
//
// WHY THIS EXISTS: card payments are off (CARD_PAYMENTS_ENABLED, pending the
// Stripe appeal), so an order is created with no payment step at all. Every unit
// is qty-1, and placing an order reserves the SKU — so a junk order takes real,
// sellable stock off the storefront and can block a genuine buyer. These checks
// are the gate that used to be "you must complete a card payment".
//
// DESIGN RULES:
//  - Nothing here may add friction for a legitimate customer. No captcha, no
//    extra step: a honeypot field humans never see, plus limits set well above
//    real-world buying behaviour.
//  - Every check degrades OPEN. With no database, or on a query error, we let
//    the order through. Losing a real sale is worse than letting a fake one in;
//    the reservation lock and the owner's admin board are the backstop.
//  - Limits are env-tunable so thresholds can be tightened without a deploy.
import { query, hasDb } from './db';

// ---- tunables -------------------------------------------------------------
// Orders one IP may place per hour. A household or office sharing an IP will
// never legitimately place 4 separate appliance orders in 60 minutes.
export const MAX_ORDERS_PER_IP_HOUR = Number(process.env.ABUSE_MAX_ORDERS_PER_IP || 3);
// Orders one email may place per hour. Guards rapid-fire with a single address.
export const MAX_ORDERS_PER_EMAIL_HOUR = Number(process.env.ABUSE_MAX_ORDERS_PER_EMAIL || 2);
// Units one buyer may hold unpaid at once (owner's call: 5). A full-kitchen
// package is 4-5 units, so this clears every realistic genuine order.
export const MAX_UNPAID_UNITS = Number(process.env.ABUSE_MAX_UNPAID_UNITS || 5);
// Signups allowed per IP per hour.
export const MAX_SIGNUPS_PER_IP_HOUR = Number(process.env.ABUSE_MAX_SIGNUPS_PER_IP || 3);

// The hidden form field. Real browsers leave it empty because the input is
// visually hidden and skipped by tab order; naive form-filling bots populate
// every input they find. Keep this name plausible — bots skip fields named
// "honeypot" — and keep it identical in the checkout and signup forms.
export const HONEYPOT_FIELD = 'website';

// Throwaway-inbox domains, the classic signature of scripted order spam. This
// is a starting set; the owner extends it at runtime by adding kind='domain'
// rows to the blocklist table rather than editing code.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com',
  'yopmail.com', 'yopmail.fr', 'trashmail.com', 'temp-mail.org', 'tempmail.com',
  '10minutemail.com', 'throwawaymail.com', 'maildrop.cc', 'getnada.com',
  'dispostable.com', 'fakeinbox.com', 'mailnesia.com', 'spamgourmet.com',
  'mytemp.email', 'moakt.com', 'emailondeck.com', 'tempmailo.com', 'mail.tm'
]);

// Best-effort client IP. Vercel always sets x-forwarded-for; the first entry is
// the real client. 'unknown' when we genuinely can't tell — callers must treat
// that as "don't rate limit" rather than lumping every unknown caller together.
export function clientIp(req) {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = (fwd ? fwd.split(',')[0] : '').trim() || req.headers.get('x-real-ip') || '';
  return ip || 'unknown';
}

export function userAgent(req) {
  return (req.headers.get('user-agent') || '').slice(0, 500) || null;
}

// True when a bot filled the invisible field. The only hard block that fires
// before any database work — it costs nothing and never hits a real customer.
export function honeypotTripped(body) {
  return String(body?.[HONEYPOT_FIELD] || '').trim().length > 0;
}

export function emailDomain(email) {
  const at = String(email || '').lastIndexOf('@');
  return at === -1 ? '' : String(email).slice(at + 1).toLowerCase();
}

export function isDisposableEmail(email) {
  return DISPOSABLE_DOMAINS.has(emailDomain(email));
}

// Self-provisioning schema for the abuse columns + blocklist, mirroring
// db/schema.sql. Same pattern as ensureOrderEditSchema in lib/orders.js: the
// site must keep working if nobody has run the admin migration yet. Cached per
// process; a failure clears the cache so the next request retries.
let _schema = null;
export function ensureAbuseSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS ip text;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_agent text;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS verify_token text;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_at timestamptz;
      CREATE INDEX IF NOT EXISTS idx_orders_ip ON orders(ip);
      CREATE INDEX IF NOT EXISTS idx_orders_verify_token ON orders(verify_token);
      CREATE TABLE IF NOT EXISTS blocklist (
        id         serial PRIMARY KEY,
        kind       text NOT NULL CHECK (kind IN ('email','domain','ip','phone')),
        value      text NOT NULL,
        note       text,
        created_at timestamptz DEFAULT now(),
        UNIQUE (kind, value)
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip text;
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// ---- blocklist ------------------------------------------------------------

// Is this buyer on the owner's block list? Matches the email exactly, its
// domain, the IP, or the phone (digits only, so formatting can't dodge it).
export async function isBlocked({ email, ip, phone } = {}) {
  if (!hasDb()) return false;
  const candidates = [];
  if (email) candidates.push(['email', String(email).toLowerCase()]);
  const domain = emailDomain(email);
  if (domain) candidates.push(['domain', domain]);
  if (ip && ip !== 'unknown') candidates.push(['ip', ip]);
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits) candidates.push(['phone', digits]);
  if (!candidates.length) return false;
  try {
    const { rows } = await query(
      `SELECT 1 FROM blocklist
        WHERE (kind, lower(value)) IN (
          SELECT * FROM unnest($1::text[], $2::text[])
        ) LIMIT 1`,
      [candidates.map((c) => c[0]), candidates.map((c) => c[1])]
    );
    return rows.length > 0;
  } catch (e) {
    // Table may not exist yet on an un-migrated DB — never block a real sale.
    console.error('blocklist check failed (allowing):', e.message);
    return false;
  }
}

export async function addToBlocklist(kind, value, note = null) {
  await ensureAbuseSchema();
  const v = kind === 'phone' ? String(value).replace(/\D/g, '') : String(value).trim().toLowerCase();
  if (!v) throw new Error('A value is required.');
  const { rows } = await query(
    `INSERT INTO blocklist (kind, value, note) VALUES ($1,$2,$3)
     ON CONFLICT (kind, value) DO UPDATE SET note = EXCLUDED.note
     RETURNING *`,
    [kind, v, note]
  );
  return rows[0];
}

export async function removeFromBlocklist(id) {
  await ensureAbuseSchema();
  const { rowCount } = await query('DELETE FROM blocklist WHERE id = $1', [Number(id)]);
  return rowCount > 0;
}

export async function listBlocklist() {
  if (!hasDb()) return [];
  try {
    await ensureAbuseSchema();
    const { rows } = await query('SELECT * FROM blocklist ORDER BY created_at DESC');
    return rows;
  } catch { return []; }
}

// ---- rate limits ----------------------------------------------------------

// Counts real orders rather than keeping an in-memory window: serverless gives
// every instance its own memory, so an in-process counter (as used in
// /api/chat) only throttles a burst that happens to land on one instance.
// Counting the orders table is global and survives cold starts.
//
// Returns { ok: true } or { ok: false, reason } — callers turn that into a
// 429. Cancelled orders are excluded so the owner cancelling a customer's
// mistake doesn't count against them.
export async function checkOrderRate({ ip, email }) {
  if (!hasDb()) return { ok: true };
  try {
    const { rows } = await query(
      `SELECT
         count(*) FILTER (WHERE ip = $1 AND $1 <> 'unknown'
                            AND created_at > now() - interval '1 hour') AS ip_hour,
         count(*) FILTER (WHERE lower(email) = $2
                            AND created_at > now() - interval '1 hour') AS email_hour
         FROM orders
        WHERE status <> 'cancelled' AND created_at > now() - interval '1 hour'`,
      [ip || 'unknown', String(email || '').toLowerCase()]
    );
    const r = rows[0] || {};
    if (Number(r.ip_hour) >= MAX_ORDERS_PER_IP_HOUR) return { ok: false, reason: 'ip' };
    if (Number(r.email_hour) >= MAX_ORDERS_PER_EMAIL_HOUR) return { ok: false, reason: 'email' };
    return { ok: true };
  } catch (e) {
    console.error('order rate check failed (allowing):', e.message);
    return { ok: true };
  }
}

// How many units this buyer already holds on unpaid orders. The cap is what
// stops the highest-damage case: one actor reserving a dozen units at once.
// Matches on email OR phone so swapping one field doesn't reset the count.
export async function unpaidUnitsHeld({ email, phone }) {
  if (!hasDb()) return 0;
  const digits = String(phone || '').replace(/\D/g, '');
  try {
    const { rows } = await query(
      `SELECT count(oi.id)::int AS n
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
        WHERE o.status = 'pending_payment'
          AND oi.sku IS NOT NULL
          AND (lower(o.email) = $1
               OR ($2 <> '' AND regexp_replace(coalesce(o.phone,''), '\\D', '', 'g') = $2))`,
      [String(email || '').toLowerCase(), digits]
    );
    return Number(rows[0]?.n || 0);
  } catch (e) {
    console.error('unpaid unit count failed (allowing):', e.message);
    return 0;
  }
}

export async function checkSignupRate({ ip }) {
  if (!hasDb() || !ip || ip === 'unknown') return { ok: true };
  try {
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM users
        WHERE signup_ip = $1 AND created_at > now() - interval '1 hour'`,
      [ip]
    );
    return Number(rows[0]?.n || 0) >= MAX_SIGNUPS_PER_IP_HOUR ? { ok: false, reason: 'ip' } : { ok: true };
  } catch (e) {
    console.error('signup rate check failed (allowing):', e.message);
    return { ok: true };
  }
}
