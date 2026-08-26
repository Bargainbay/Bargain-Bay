// Coupon codes, and the affiliates they belong to.
//
// One code, one owner. A coupon carries the affiliate it was cut for (the
// influencer, the trade partner, the radio spot), so "what did Dave's code do
// for us last month" is a query and not a guess — that is the whole reason the
// affiliate lives on the coupon rather than in a spreadsheet beside it.
//
// The code is only ever *applied* server-side. The storefront asks
// `/api/coupon` what a code is worth so it can show the customer, but the
// discount that reaches an order is recomputed in the checkout route from the
// authoritative prices — same rule as `lib/pricing.js`: never trust the client.
import { query, hasDb, withTransaction } from './db';
import { round2 } from './constants';

export const COUPON_KINDS = { percent: '% off', amount: '$ off' };
const CODE_RE = /^[A-Z0-9][A-Z0-9._-]{1,23}$/;

let _schema = null;
export function ensureCouponSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id                serial PRIMARY KEY,
        code              text NOT NULL,
        affiliate         text,                       -- who the code belongs to
        commission_pct    numeric(5,2) NOT NULL DEFAULT 0, -- what they earn on it (reporting only)
        kind              text NOT NULL DEFAULT 'percent' CHECK (kind IN ('percent','amount')),
        value             numeric(10,2) NOT NULL,
        active            boolean NOT NULL DEFAULT true,
        starts_at         date,
        ends_at           date,
        min_subtotal      numeric(10,2) NOT NULL DEFAULT 0,
        max_uses          int,                        -- null = unlimited
        per_email_limit   int,                        -- null = unlimited per customer
        exclude_clearance boolean NOT NULL DEFAULT false,
        note              text,
        used_count        int NOT NULL DEFAULT 0,
        created_at        timestamptz NOT NULL DEFAULT now()
      );
      -- The code is the identity, case-insensitively: 'dave10' and 'DAVE10' are
      -- the same coupon or the affiliate report splits in two.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_code ON coupons(upper(code));
      -- One row per use. Keeps the affiliate report honest even after a coupon is
      -- edited or retired, so the affiliate is snapshotted here, not joined.
      CREATE TABLE IF NOT EXISTS coupon_redemptions (
        id         serial PRIMARY KEY,
        coupon_id  int NOT NULL,
        code       text NOT NULL,
        affiliate  text,
        order_id   int,
        email      text,
        subtotal   numeric(10,2),
        discount   numeric(10,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id);
      CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_order  ON coupon_redemptions(order_id);
      -- What the storefront charged. Stored on the order so every downstream
      -- reader (order page, packing slip, dashboards) sees the same number
      -- without re-deriving it — the delivery fee is otherwise inferred from
      -- total − subtotal − hst, which a discount would silently corrupt.
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount numeric(10,2) NOT NULL DEFAULT 0;
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

const asDate = (v) => {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const asMoney = (v, dflt = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? round2(n) : dflt;
};
const asCount = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function shape(r) {
  return {
    id: r.id,
    code: r.code,
    affiliate: r.affiliate || '',
    commissionPct: Number(r.commission_pct) || 0,
    kind: r.kind,
    value: Number(r.value) || 0,
    active: !!r.active,
    startsAt: r.starts_at ? r.starts_at.toISOString().slice(0, 10) : null,
    endsAt: r.ends_at ? r.ends_at.toISOString().slice(0, 10) : null,
    minSubtotal: Number(r.min_subtotal) || 0,
    maxUses: r.max_uses == null ? null : Number(r.max_uses),
    perEmailLimit: r.per_email_limit == null ? null : Number(r.per_email_limit),
    excludeClearance: !!r.exclude_clearance,
    note: r.note || '',
    usedCount: Number(r.used_count) || 0,
    createdAt: r.created_at ? r.created_at.toISOString() : null,
    // Rolled up by listCoupons; absent on a bare row.
    ...(r.redeemed === undefined ? {} : { redeemed: Number(r.redeemed) || 0 }),
    ...(r.discount_given === undefined ? {} : { discountGiven: Number(r.discount_given) || 0 }),
    ...(r.revenue === undefined ? {} : { revenue: Number(r.revenue) || 0 })
  };
}

// ---- admin ---------------------------------------------------------------

// Every coupon with its lifetime performance. `revenue` is what the orders that
// used it actually came to, ex-HST — the number that decides whether the code
// is worth its discount.
export async function listCoupons() {
  if (!hasDb()) return [];
  await ensureCouponSchema();
  const { rows } = await query(`
    SELECT c.*,
           (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id) AS redeemed,
           (SELECT COALESCE(SUM(r.discount), 0) FROM coupon_redemptions r WHERE r.coupon_id = c.id) AS discount_given,
           (SELECT COALESCE(SUM(o.total - COALESCE(o.hst, 0)), 0)
              FROM coupon_redemptions r JOIN orders o ON o.id = r.order_id
             WHERE r.coupon_id = c.id AND o.status <> 'cancelled') AS revenue
      FROM coupons c
     ORDER BY c.active DESC, lower(COALESCE(c.affiliate, '')), upper(c.code)`);
  return rows.map(shape);
}

// Create or update a coupon. `id` present = update. Validation lives here so the
// API route, and anything that grows later, can't diverge from it.
export async function saveCoupon(input = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureCouponSchema();
  const code = normalizeCode(input.code);
  if (!CODE_RE.test(code)) {
    throw new Error('A code is 2–24 characters: letters, digits, and . _ - (no spaces).');
  }
  const kind = input.kind === 'amount' ? 'amount' : 'percent';
  const value = asMoney(input.value, 0);
  if (!(value > 0)) throw new Error('Enter a discount greater than zero.');
  if (kind === 'percent' && value > 100) throw new Error('A percentage discount can’t be more than 100%.');
  const startsAt = asDate(input.startsAt);
  const endsAt = asDate(input.endsAt);
  if (startsAt && endsAt && endsAt < startsAt) throw new Error('The end date is before the start date.');
  const commission = Math.min(100, asMoney(input.commissionPct, 0));

  const args = [
    code,
    String(input.affiliate || '').trim().slice(0, 120) || null,
    commission, kind, value,
    input.active === false ? false : true,
    startsAt, endsAt,
    asMoney(input.minSubtotal, 0),
    asCount(input.maxUses),
    asCount(input.perEmailLimit),
    !!input.excludeClearance,
    String(input.note || '').trim().slice(0, 300) || null
  ];

  const id = parseInt(input.id, 10);
  try {
    if (Number.isFinite(id)) {
      const { rows } = await query(
        `UPDATE coupons SET code=$1, affiliate=$2, commission_pct=$3, kind=$4, value=$5, active=$6,
                starts_at=$7, ends_at=$8, min_subtotal=$9, max_uses=$10, per_email_limit=$11,
                exclude_clearance=$12, note=$13
          WHERE id=$14 RETURNING *`, [...args, id]);
      if (!rows.length) throw new Error('That coupon no longer exists.');
      return shape(rows[0]);
    }
    const { rows } = await query(
      `INSERT INTO coupons (code, affiliate, commission_pct, kind, value, active, starts_at, ends_at,
                            min_subtotal, max_uses, per_email_limit, exclude_clearance, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, args);
    return shape(rows[0]);
  } catch (e) {
    if (e.code === '23505') throw new Error(`The code ${code} is already in use.`);
    throw e;
  }
}

export async function setCouponActive(id, active) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureCouponSchema();
  const { rows } = await query('UPDATE coupons SET active = $2 WHERE id = $1 RETURNING *', [id, !!active]);
  if (!rows.length) throw new Error('That coupon no longer exists.');
  return shape(rows[0]);
}

// Delete a coupon that never went anywhere. One that has been redeemed is
// switched off instead — deleting it would orphan the affiliate's numbers.
export async function deleteCoupon(id) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureCouponSchema();
  const { rows: used } = await query('SELECT COUNT(*) AS c FROM coupon_redemptions WHERE coupon_id = $1', [id]);
  if (Number(used[0]?.c) > 0) {
    const c = await setCouponActive(id, false);
    return { deleted: false, deactivated: true, coupon: c };
  }
  const { rows } = await query('DELETE FROM coupons WHERE id = $1 RETURNING code', [id]);
  if (!rows.length) throw new Error('That coupon no longer exists.');
  return { deleted: true, deactivated: false, code: rows[0].code };
}

// Per-affiliate rollup over a date window. Orders that were later cancelled
// (abandoned checkouts, refunds that cancelled the order) drop out of revenue
// but stay in the redemption count — the code was still used.
export async function affiliateReport({ from = null, to = null } = {}) {
  if (!hasDb()) return [];
  await ensureCouponSchema();
  const where = ['1=1'];
  const args = [];
  if (from) { args.push(from); where.push(`r.created_at >= $${args.length}::date`); }
  if (to) { args.push(to); where.push(`r.created_at < ($${args.length}::date + 1)`); }
  const { rows } = await query(`
    SELECT COALESCE(NULLIF(r.affiliate, ''), '— unassigned —') AS affiliate,
           COUNT(*) AS uses,
           COUNT(DISTINCT r.code) AS codes,
           COALESCE(SUM(r.discount), 0) AS discount,
           COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN o.total - COALESCE(o.hst, 0) ELSE 0 END), 0) AS revenue,
           COALESCE(SUM(CASE WHEN o.status <> 'cancelled'
                             THEN (o.total - COALESCE(o.hst, 0)) * COALESCE(c.commission_pct, 0) / 100
                             ELSE 0 END), 0) AS commission
      FROM coupon_redemptions r
      LEFT JOIN orders  o ON o.id = r.order_id
      LEFT JOIN coupons c ON c.id = r.coupon_id
     WHERE ${where.join(' AND ')}
     GROUP BY 1 ORDER BY revenue DESC, uses DESC`, args);
  return rows.map((r) => ({
    affiliate: r.affiliate,
    uses: Number(r.uses) || 0,
    codes: Number(r.codes) || 0,
    discount: round2(Number(r.discount) || 0),
    revenue: round2(Number(r.revenue) || 0),
    commission: round2(Number(r.commission) || 0)
  }));
}

// ---- applying a coupon ---------------------------------------------------

// What a coupon takes off a given eligible amount. Percentages round to the
// cent; a flat amount can never exceed what's being discounted (a $200 code on
// a $150 cart is $150 off, never a $50 credit).
export function discountFor(coupon, eligible) {
  const base = round2(Math.max(0, Number(eligible) || 0));
  if (!coupon || base <= 0) return 0;
  const v = Number(coupon.value) || 0;
  return coupon.kind === 'amount' ? round2(Math.min(v, base)) : round2(base * (v / 100));
}

// Check a code against a real cart. Returns { ok, coupon, discount } or
// { ok:false, error } with a message written for the shopper.
//
// `subtotal` is the goods total (delivery is never discounted — it's a
// third-party cost we pass through). `eligibleSubtotal` is the part of it the
// coupon may touch, which differs only when the code excludes clearance units.
export async function validateCoupon(code, { subtotal = 0, eligibleSubtotal = null, email = '' } = {}) {
  const wanted = normalizeCode(code);
  if (!wanted) return { ok: false, error: 'Enter a promo code.' };
  if (!hasDb()) return { ok: false, error: 'Promo codes are briefly unavailable — your order is unaffected.' };
  await ensureCouponSchema();

  const { rows } = await query('SELECT * FROM coupons WHERE upper(code) = $1', [wanted]);
  if (!rows.length) return { ok: false, error: `We don’t recognise the code ${wanted}.` };
  const c = shape(rows[0]);

  const notValid = `${c.code} isn’t valid right now.`;
  if (!c.active) return { ok: false, error: notValid };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  if (c.startsAt && today < c.startsAt) return { ok: false, error: `${c.code} isn’t active until ${c.startsAt}.` };
  if (c.endsAt && today > c.endsAt) return { ok: false, error: `${c.code} expired on ${c.endsAt}.` };
  if (c.maxUses != null && c.usedCount >= c.maxUses) return { ok: false, error: `${c.code} has been fully redeemed.` };

  const goods = round2(Number(subtotal) || 0);
  if (c.minSubtotal > 0 && goods < c.minSubtotal) {
    return { ok: false, error: `${c.code} needs an order of $${c.minSubtotal.toFixed(2)} or more.` };
  }
  const eligible = eligibleSubtotal == null ? goods : round2(Number(eligibleSubtotal) || 0);
  if (c.excludeClearance && eligible <= 0) {
    return { ok: false, error: `${c.code} can’t be used on clearance units.` };
  }

  if (c.perEmailLimit != null && email) {
    const { rows: mine } = await query(
      'SELECT COUNT(*) AS c FROM coupon_redemptions WHERE coupon_id = $1 AND lower(email) = lower($2)',
      [c.id, email]
    );
    if (Number(mine[0]?.c) >= c.perEmailLimit) {
      return { ok: false, error: `You’ve already used ${c.code}.` };
    }
  }

  const discount = discountFor(c, eligible);
  if (discount <= 0) return { ok: false, error: `${c.code} takes nothing off this order.` };
  return { ok: true, coupon: c, discount };
}

// Book a redemption. Called INSIDE the checkout transaction with its client, so
// a coupon can never be counted against an order that failed to be created.
// The affiliate is copied onto the row rather than joined, so retiring or
// reassigning the code later doesn't rewrite history.
export async function redeemCouponWithClient(client, coupon, { orderId, email, subtotal, discount }) {
  await client.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [coupon.id]);
  await client.query(
    `INSERT INTO coupon_redemptions (coupon_id, code, affiliate, order_id, email, subtotal, discount)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [coupon.id, coupon.code, coupon.affiliate || null, orderId, email || null,
     round2(Number(subtotal) || 0), round2(Number(discount) || 0)]
  );
}

// Undo a redemption when its order is cancelled, so a code isn't burned by an
// abandoned checkout. Best-effort and idempotent-ish: it only ever gives back
// what this order actually took.
export async function releaseCouponForOrder(orderId) {
  if (!hasDb() || !orderId) return false;
  try {
    await ensureCouponSchema();
    return await withTransaction(async (client) => {
      const { rows } = await client.query('DELETE FROM coupon_redemptions WHERE order_id = $1 RETURNING coupon_id', [orderId]);
      for (const r of rows) {
        await client.query('UPDATE coupons SET used_count = GREATEST(0, used_count - 1) WHERE id = $1', [r.coupon_id]);
      }
      return rows.length > 0;
    });
  } catch (e) {
    console.error('releaseCouponForOrder failed', e.message);
    return false;
  }
}
