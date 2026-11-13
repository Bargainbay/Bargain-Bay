// Referral partners — a person who sends us customers (resellers, trade clients) and is paid a
// percentage of the PROFIT on every order those customers place. Owner's rule (2026-11-09): Jayson
// gets 10% of the profit on every order brought via him.
//
// NOT A STAFF ROLE, NOT A SALES REP. A partner is on no staff list and no `isSales` / `isAdmin`
// path, so every other surface refuses them without knowing this exists; they get /partner and
// nothing else. A rep (lib/sales-commission.js) is paid on money collected under a tiered plan;
// that plan reads customers.owner_email. A partner's clients live in customers.partner_email, kept
// apart on purpose so one account can never earn on two plans.
//
// NOTHING DERIVABLE IS STORED. Orders, profit and commission are recomputed from the orders on every
// read. Only the grant (who is a partner, at what %) and the client link are stored.
//
// PROFIT is the Daily P&L's own: per order, unit lines at price less cost, plus credit lines
// (discounts, trade-ins), less a checkout coupon; a seller's lines left out. A unit with no cost counts
// as ZERO profit and is reported (`missingCost`) rather than as pure profit. An order that made a loss
// earns $0, never a negative: commission is not clawed back from other orders.
// Orders count from the SALE predicate (confirmed, ready, out for delivery, delivered, or an
// invoice-backed order still owing); cancelled and refunded orders drop out on their own.
import { query, hasDb } from './db';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { normalizeEmail, createPasswordResetToken } from './auth';
import { sendPartnerInvite } from './email';
import { audit } from './audit';
import { addTask } from './crm';
import { notifyOwner, esc, sendPartnerClientJoined } from './email';
import { round2, torontoToday } from './constants';
import { SALE } from './analytics';
import { ORDER_MATCH, upsertCustomer } from './customers';
import { SITE_URL } from './site';
import { saveCoupon, normalizeCode } from './coupons';

export const DEFAULT_PARTNER_PCT = 10;

let ensured = null;
function ensurePartnerSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!ensured) {
    ensured = query(`
      CREATE TABLE IF NOT EXISTS referral_partners (
        email text PRIMARY KEY, name text,
        commission_pct numeric(5,2) NOT NULL DEFAULT 10,
        granted_by text, granted_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz, revoked_by text
      );
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS partner_email text;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS partner_set_by text;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS partner_set_at timestamptz;
      ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS code text;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_partners_code ON referral_partners (lower(code)) WHERE code IS NOT NULL;
      CREATE TABLE IF NOT EXISTS partner_payments (
        id serial PRIMARY KEY, partner_email text NOT NULL, amount numeric(12,2) NOT NULL CHECK (amount > 0), paid_on date NOT NULL,
        method text, reference text, note text, recorded_by text, created_at timestamptz NOT NULL DEFAULT now(), voided_at timestamptz, voided_by text
      );
      CREATE INDEX IF NOT EXISTS idx_partner_payments_partner ON partner_payments (partner_email);
      ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS customer_pct numeric(5,2) NOT NULL DEFAULT 5;
      ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS commission_basis text NOT NULL DEFAULT 'profit';
      ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS price_pct numeric(5,2) NOT NULL DEFAULT 8;
      ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS price_pct_retail numeric(5,2) NOT NULL DEFAULT 6;
      ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS price_cap_pct numeric(5,2) NOT NULL DEFAULT 35;
      ALTER TABLE referral_partners ADD COLUMN IF NOT EXISTS customer_coupon_id integer;
      CREATE TABLE IF NOT EXISTS partner_members (
        member_email text PRIMARY KEY, partner_email text NOT NULL, name text, added_by text,
        added_at timestamptz NOT NULL DEFAULT now(), removed_at timestamptz, removed_by text
      );
      CREATE INDEX IF NOT EXISTS idx_partner_members_partner ON partner_members (partner_email);
      CREATE TABLE IF NOT EXISTS partner_code_aliases (alias text PRIMARY KEY, partner_email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS partner_visits (
        partner_email text NOT NULL, visitor text NOT NULL, day date NOT NULL, PRIMARY KEY (partner_email, visitor, day)
      );
    `).catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

export class PartnerError extends Error { constructor(m, code) { super(m); this.code = code; } }

const norm = (e) => normalizeEmail(e || '');

/** The active partner row for this login, or null. Built from the session email by the caller. */
export async function getPartner(email) {
  if (!hasDb() || !email) return null;
  try {
    await ensurePartnerSchema();
    // The primary login, or anyone on the partner's team. Everything downstream is keyed by the PRIMARY email,
    // so a teammate sees exactly what the organisation sees.
    const e = norm(email);
    const { rows } = await query(
      `SELECT p.email, p.name, p.code, p.commission_pct::float8 AS pct, p.customer_pct::float8 AS customer_pct, p.commission_basis AS basis, p.price_pct::float8 AS price_pct, p.price_pct_retail::float8 AS price_pct_retail, p.price_cap_pct::float8 AS price_cap_pct, p.email <> $1 AS teammate
         FROM referral_partners p
        WHERE p.revoked_at IS NULL
          AND (p.email = $1 OR EXISTS (SELECT 1 FROM partner_members m WHERE m.partner_email = p.email AND m.member_email = $1 AND m.removed_at IS NULL))
        ORDER BY (p.email = $1) DESC LIMIT 1`, [e]);
    return rows[0] || null;
  } catch { return null; }
}

export async function listPartners() {
  if (!hasDb()) return [];
  await ensurePartnerSchema();
  const { rows } = await query(
    `SELECT p.email, p.name, p.commission_pct::float8 AS pct, p.commission_basis AS basis, p.price_pct::float8 AS price_pct, p.price_pct_retail::float8 AS price_pct_retail, p.price_cap_pct::float8 AS price_cap_pct, p.customer_pct::float8 AS customer_pct, p.granted_at, p.revoked_at,
            (SELECT COUNT(*)::int FROM customers c WHERE lower(c.partner_email) = p.email) AS clients
       FROM referral_partners p ORDER BY p.revoked_at NULLS FIRST, p.granted_at DESC`);
  return rows;
}

const BASES = ['profit', 'price'];
const optPct = (v, max, what, min = 0) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new PartnerError(`${what} must be between ${min} and ${max}.`, 'pct');
  return n;
};

export async function savePartner({ email, name, pct, customerPct, basis, pricePct, pricePctRetail, capPct }, by) {
  if (!hasDb()) throw new PartnerError('Database not configured.', 'nodb');
  const e = norm(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new PartnerError('That is not an email address.', 'email');
  const p = pct == null || pct === '' ? DEFAULT_PARTNER_PCT : Number(pct);
  if (!Number.isFinite(p) || p <= 0 || p > 50) throw new PartnerError('The percentage must be between 0 and 50.', 'pct');
  const cp = customerPct == null || customerPct === '' ? null : Number(customerPct);
  if (cp != null && (!Number.isFinite(cp) || cp < 0 || cp > 30)) throw new PartnerError('The end-user discount must be between 0 and 30%.', 'customerpct');
  const bs = basis == null || basis === '' ? null : String(basis);
  if (bs && !BASES.includes(bs)) throw new PartnerError('Pay on profit or on price.', 'basis');
  const pp = optPct(pricePct, 30, 'The percentage of price'), ppr = optPct(pricePctRetail, 30, 'The end-user percentage of price');
  const cap = optPct(capPct, 100, 'The profit cap', 1);
  await ensurePartnerSchema();
  const taken = (await query(`SELECT partner_email FROM partner_members WHERE member_email = $1 AND removed_at IS NULL`, [e])).rows[0];
  if (taken) throw new PartnerError(`${e} is already on ${taken.partner_email}'s team.`, 'teammate');
  await query(
    `INSERT INTO referral_partners (email, name, commission_pct, granted_by, customer_pct, commission_basis, price_pct, price_pct_retail, price_cap_pct)
     VALUES ($1,$2,$3,$4,COALESCE($5, 5),COALESCE($6,'profit'),COALESCE($7,8),COALESCE($8,6),COALESCE($9,35))
     ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, referral_partners.name),
       commission_pct = EXCLUDED.commission_pct, customer_pct = COALESCE($5, referral_partners.customer_pct),
       commission_basis = COALESCE($6, referral_partners.commission_basis), price_pct = COALESCE($7, referral_partners.price_pct),
       price_pct_retail = COALESCE($8, referral_partners.price_pct_retail), price_cap_pct = COALESCE($9, referral_partners.price_cap_pct),
       revoked_at = NULL, revoked_by = NULL`,
    [e, String(name || '').trim().slice(0, 120) || null, p, norm(by) || null, cp, bs, pp, ppr, cap]);
  await audit({ email: by }, { action: 'partner.save', entity: 'referral_partner', summary: `${e} is a referral partner: ${bs || 'existing basis'}, ${p}% of profit, ${pp ?? 'existing'}% / ${ppr ?? 'existing'}% of price capped at ${cap ?? 'existing'}% of profit` });
  // The owner creates the account; the partner only chooses a password. A NEW account is emailed at once.
  await ensureCode(e);                                  // the links exist from the moment they are added
  await ensureCustomerCoupon(e);
  const acct = await ensurePartnerAccount(e, name);
  const invite = acct.created ? await invitePartner(e, by) : null;
  return { ok: true, accountCreated: acct.created, ...(invite || {}) };
}

/** Make the login if there is none: a password nobody knows, so it can only be reached by the invite link. */
async function ensurePartnerAccount(email, name) {
  const { rows } = await query(`SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`, [email]);
  if (rows[0]) return { id: rows[0].id, created: false };
  const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const ins = await query(
    `INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING RETURNING id`,
    [email, String(name || '').trim().slice(0, 120) || email.split('@')[0], unusable]);
  return { id: ins.rows[0]?.id, created: !!ins.rows[0] };
}

/** Email a 7-day, single-use link to choose a password. Returns the link too, so the owner can pass it on by hand. */
export async function invitePartner(email, by) {
  if (!hasDb()) throw new PartnerError('Database not configured.', 'nodb');
  const e = norm(email);
  const partner = await getPartner(e);
  if (!partner) throw new PartnerError('That person is not an active referral partner.', 'nopartner');
  const { rows } = await query(`SELECT id, name FROM users WHERE lower(email) = $1 LIMIT 1`, [e]);
  if (!rows[0]) throw new PartnerError('No account for that email.', 'noaccount');
  const token = await createPasswordResetToken(rows[0].id, { expires: '7d' });
  const base = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  let emailed = false;
  try { const r = await sendPartnerInvite({ to: e, name: rows[0].name || partner.name, url: link, pct: partner.pct }); emailed = r?.ok !== false; } catch { emailed = false; }
  await audit({ email: by }, { action: 'partner.invite', entity: 'referral_partner', summary: `Sign-in invite for ${e} (${emailed ? 'emailed' : 'email failed'})` });
  return { emailed, link };
}

export async function revokePartner(email, by) {
  if (!hasDb()) throw new PartnerError('Database not configured.', 'nodb');
  await ensurePartnerSchema();
  await query(`UPDATE referral_partners SET revoked_at = now(), revoked_by = $2 WHERE email = $1 AND revoked_at IS NULL`, [norm(email), norm(by) || null]);
  await audit({ email: by }, { action: 'partner.revoke', entity: 'referral_partner', summary: `${norm(email)} is no longer a referral partner` });
  return { ok: true };
}

/** Put a customer account under a partner (or take it off with partnerEmail = ''). A reason is required. */
export async function setClientPartner(customerId, partnerEmail, reason, by) {
  if (!hasDb()) throw new PartnerError('Database not configured.', 'nodb');
  const why = String(reason || '').trim();
  if (why.length < 3) throw new PartnerError('Say why — this decides whose commission the account earns.', 'reason');
  await ensurePartnerSchema();
  const pe = norm(partnerEmail) || null;
  if (pe && !(await getPartner(pe))) throw new PartnerError('That person is not an active referral partner.', 'nopartner');
  const { rows } = await query(
    `UPDATE customers SET partner_email = $2, partner_set_by = $3, partner_set_at = now() WHERE id = $1 RETURNING id, name, email`,
    [Number(customerId), pe, norm(by) || null]);
  if (!rows[0]) throw new PartnerError('Customer not found.', 'notfound');
  await audit({ email: by }, { action: 'partner.client', entity: 'customer', entityId: customerId,
    summary: `${rows[0].email || rows[0].name} → partner ${pe || 'nobody'}: ${why.slice(0, 200)}` });
  return { ok: true };
}

export async function searchCustomers(q) {
  const term = String(q || '').trim().toLowerCase();
  if (!hasDb() || term.length < 2) return [];
  await ensurePartnerSchema();
  const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
  const { rows } = await query(
    `SELECT id, name, email, phone, partner_email FROM customers
      WHERE lower(coalesce(email,'')) LIKE $1 OR lower(coalesce(name,'')) LIKE $1 OR coalesce(phone,'') LIKE $1
      ORDER BY id DESC LIMIT 15`, [like]);
  return rows;
}

const STATUS_LABEL = {
  pending_payment: 'Awaiting payment', confirmed: 'Confirmed', ready: 'Ready', out_for_delivery: 'Out for delivery', delivered: 'Delivered'
};
const TZ = 'America/Toronto';

/**
 * Everything a partner sees: their clients, each client's orders (items, price before tax, live status),
 * the commission on each, what has been paid, and the balance. Cost and profit are used to work out the
 * commission but only the commission is returned — the partner is never shown a unit's cost.
 *
 * EARNED vs PENDING: an order's commission is EARNED once it is delivered and nothing is still owing on
 * its invoice; until then it is PENDING (placed, but it can still be cancelled or refunded). The balance
 * owed is earned less payments recorded; it can go negative if a refund came after a payment.
 */
export async function partnerReport(email) {
  const zero = { orders: 0, sales: 0, commission: 0, earned: 0, pending: 0, paid: 0, balance: 0, missingCost: 0 };
  const empty = { partner: null, clients: [], totals: zero, payments: [], funnel: null, visits: null };
  if (!hasDb()) return empty;
  await ensurePartnerSchema();
  const partner = await getPartner(email);
  if (!partner) return empty;
  const rate = partner.pct / 100;
  // An order placed with the partner's END-USER code earns (rate - the discount that code gave): the customer's
  // discount comes out of the partner's share, so 20% on resellers is 15% on a retail sale that got 5% off.
  const retailRate = Math.max(0, partner.pct - (partner.customer_pct || 0)) / 100;
  const aliases = (await query(`SELECT alias FROM partner_code_aliases WHERE partner_email = $1`, [partner.email])).rows.map((x) => x.alias);
  const prefixes = [...new Set([...(partner.code ? [partner.code] : []), ...aliases])].map((x) => String(x).replace(/[^a-z0-9]/gi, '')).filter(Boolean);
  // How THIS partner is paid. 'profit': pct of the order's profit (retail: pct less the customer discount).
  // 'price': a share of the sale price after discount, but never more than price_cap_pct of the order's profit, so a
  // thin-margin sale cannot be paid more than it made.
  const byPrice = partner.basis === 'price';
  const priceRate = (partner.price_pct || 0) / 100, priceRateRetail = (partner.price_pct_retail || 0) / 100, capRate = (partner.price_cap_pct || 0) / 100;
  const retailCode = prefixes.length ? new RegExp(`^(${prefixes.join('|')})[0-9.]+$`, 'i') : null;
  const code = await ensureCode(partner.email);
  const coupon = await ensureCustomerCoupon(partner.email);

  const accounts = (await query(
    `SELECT c.id, c.name, c.email, c.phone, c.partner_set_by, c.partner_set_at,
            (SELECT u.member_status FROM users u WHERE lower(u.email) = c.email LIMIT 1) AS member_status
       FROM customers c WHERE lower(c.partner_email) = $1 ORDER BY c.name NULLS LAST, c.id`,
    [partner.email])).rows;

  const { rows } = await query(`
    SELECT c.id AS cid, o.id, o.order_number, o.coupon_code, COALESCE(o.vendor_subtotal, 0)::float8 AS vsub, o.status, o.created_at, o.subtotal::float8 AS subtotal, o.delivery_method,
           to_char(o.created_at AT TIME ZONE '${TZ}', 'YYYY-MM') AS month,
           EXISTS (SELECT 1 FROM invoices bi WHERE bi.order_id = o.id AND bi.status IN ('open','partial')) AS owing,
           string_agg(oi.title, '; ' ORDER BY oi.id) FILTER (WHERE COALESCE(oi.kind,'unit') = 'unit') AS items,
           COALESCE(SUM(oi.price - COALESCE(oi.cost, p.cost)) FILTER (WHERE COALESCE(oi.kind,'unit') = 'unit' AND COALESCE(oi.cost, p.cost) IS NOT NULL), 0)::float8
             + COALESCE(SUM(oi.price) FILTER (WHERE oi.kind IN ('discount','trade_in')), 0)::float8
             - COALESCE(MAX(o.discount), 0)::float8 AS gp,
           COALESCE(MAX(o.discount), 0)::float8 AS disc,
           COUNT(*) FILTER (WHERE COALESCE(oi.kind,'unit') = 'unit' AND oi.sku IS NOT NULL AND COALESCE(oi.cost, p.cost) IS NULL)::int AS missing
      FROM customers c
      JOIN orders o ON ${ORDER_MATCH}
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.vendor_id IS NULL
      LEFT JOIN products p ON p.sku = oi.sku
     WHERE lower(c.partner_email) = $1 AND ${SALE('o')}
     GROUP BY c.id, o.id
     ORDER BY o.created_at DESC`, [partner.email]);

  const byClient = new Map(accounts.map((a) => [a.id, {
    id: a.id, name: a.name, email: a.email, phone: a.phone,
    viaLink: a.partner_set_by === 'sign-up link' || a.partner_set_by === 'order link',
    membership: a.member_status === 'approved' ? 'approved' : a.member_status === 'pending' ? 'pending' : 'none',
    orders: [], sales: 0, commission: 0, earned: 0
  }]));
  const totals = { ...zero };
  for (const r of rows) {
    const cl = byClient.get(r.cid);
    if (!cl) continue;
    const retail = !!(retailCode && r.coupon_code && retailCode.test(String(r.coupon_code).trim()));
    const profit = Math.max(0, r.gp);
    const net = Math.max(0, (r.subtotal || 0) - (r.vsub || 0) - (r.disc || 0));       // our own goods, after any discount
    const useRate = byPrice ? (retail ? priceRateRetail : priceRate) : (retail ? retailRate : rate);
    let commission = byPrice ? Math.min(net * useRate, profit * capRate) : profit * useRate;
    const capped = byPrice && net * useRate > profit * capRate;
    commission = round2(commission);
    const earned = r.status === 'delivered' && !r.owing;
    cl.orders.push({
      number: r.order_number, at: r.created_at ? r.created_at.toISOString() : null, month: r.month, status: r.status,
      statusLabel: STATUS_LABEL[r.status] || r.status, items: r.items || '', subtotal: round2(r.subtotal || 0),
      delivery: r.delivery_method || null, commission, earned, retail,
      // What the commission was worked out from. Profit is the order's sale price less its discount and what the units cost
      // us; the unit cost itself is never sent, and a loss counts as $0.
      discount: round2(r.disc || 0), profit: round2(profit), ratePct: round2(useRate * 100), basis: byPrice ? 'price' : 'profit', capped, costMissing: r.missing > 0
    });
    cl.sales = round2(cl.sales + (r.subtotal || 0));
    cl.commission = round2(cl.commission + commission);
    if (earned) cl.earned = round2(cl.earned + commission);
    totals.orders += 1; totals.sales = round2(totals.sales + (r.subtotal || 0));
    totals.commission = round2(totals.commission + commission);
    if (earned) totals.earned = round2(totals.earned + commission);
    totals.missingCost += r.missing;
  }
  totals.pending = round2(totals.commission - totals.earned);

  const payments = await listPayments(partner.email);
  totals.paid = round2(payments.reduce((a, p) => a + p.amount, 0));
  totals.balance = round2(totals.earned - totals.paid);

  const clients = [...byClient.values()];
  const funnel = {
    signedUp: clients.filter((c) => c.viaLink).length,
    applied: clients.filter((c) => c.viaLink && c.membership !== 'none').length,
    approved: clients.filter((c) => c.viaLink && c.membership === 'approved').length
  };
  const v = (await query(
    `SELECT COUNT(DISTINCT visitor)::int AS total,
            COUNT(DISTINCT visitor) FILTER (WHERE day >= (now() AT TIME ZONE '${TZ}')::date - 30)::int AS recent
       FROM partner_visits WHERE partner_email = $1`, [partner.email])).rows[0] || {};
  return {
    partner: { email: partner.email, name: partner.name, pct: partner.pct, retailPct: Math.round(retailRate * 10000) / 100, basis: byPrice ? 'price' : 'profit', pricePct: partner.price_pct, pricePctRetail: partner.price_pct_retail, capPct: partner.price_cap_pct, code, link: code ? partnerLink(code) : null,
               customerLink: code && coupon ? customerLink(code) : null, customerCode: coupon, customerPct: partner.customer_pct },
    team: await listTeam(partner.email),
    clients, totals, payments, funnel, visits: { total: v.total || 0, recent: v.recent || 0 }
  };
}

// ---- what we have paid them ---------------------------------------------------------------------
export async function listPayments(email, { includeVoided = false } = {}) {
  if (!hasDb()) return [];
  await ensurePartnerSchema();
  const { rows } = await query(
    `SELECT id, amount::float8 AS amount, to_char(paid_on, 'YYYY-MM-DD') AS paid_on, method, reference, note, recorded_by, voided_at
       FROM partner_payments WHERE partner_email = $1 ${includeVoided ? '' : 'AND voided_at IS NULL'}
      ORDER BY paid_on DESC, id DESC`, [norm(email)]);
  return rows;
}

/** Record money that has ALREADY been sent to the partner. It moves no money itself. */
export async function recordPayment({ partnerEmail, amount, paidOn, method, reference, note }, by) {
  if (!hasDb()) throw new PartnerError('Database not configured.', 'nodb');
  await ensurePartnerSchema();
  const e = norm(partnerEmail);
  const exists = (await query(`SELECT 1 FROM referral_partners WHERE email = $1`, [e])).rows[0];
  if (!exists) throw new PartnerError('That person is not a referral partner.', 'nopartner');
  const amt = round2(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new PartnerError('Enter the amount that was paid.', 'amount');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(paidOn || '')) ? paidOn : torontoToday();
  const { rows } = await query(
    `INSERT INTO partner_payments (partner_email, amount, paid_on, method, reference, note, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [e, amt, day, String(method || '').trim().slice(0, 40) || null, String(reference || '').trim().slice(0, 80) || null,
     String(note || '').trim().slice(0, 300) || null, norm(by) || null]);
  await audit({ email: by }, { action: 'partner.payment', entity: 'referral_partner', entityId: rows[0].id, summary: `Paid ${e} $${amt.toFixed(2)} on ${day}` });
  return { ok: true, id: rows[0].id };
}

/** A mistaken entry is voided, never deleted: what was recorded, and who struck it out, stays. */
export async function voidPayment(id, by) {
  if (!hasDb()) throw new PartnerError('Database not configured.', 'nodb');
  await ensurePartnerSchema();
  const r = await query(`UPDATE partner_payments SET voided_at = now(), voided_by = $2 WHERE id = $1 AND voided_at IS NULL RETURNING partner_email, amount`, [Number(id), norm(by) || null]);
  if (!r.rows[0]) throw new PartnerError('Payment not found.', 'notfound');
  await audit({ email: by }, { action: 'partner.payment.void', entity: 'referral_partner', entityId: id, summary: `Voided payment of $${Number(r.rows[0].amount).toFixed(2)} to ${r.rows[0].partner_email}` });
  return { ok: true };
}

// ---- the monthly statement ----------------------------------------------------------------------
/** '20% of profit', or '8% of price (capped)' when the profit cap held the commission down. */
export const rateText = (o) => `${o.ratePct}% of ${o.basis === 'price' ? 'price' : 'profit'}${o.capped ? ' (capped)' : ''}`;

const csvCell = (v) => {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;          // a spreadsheet must never run a customer's text as a formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One month of a partner's orders and payments, cut from partnerReport so the two cannot disagree. */
export function statementFor(report, month) {
  const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : torontoToday().slice(0, 7);
  const orders = [];
  for (const c of report.clients) for (const o of c.orders) if (o.month === m) orders.push({ client: c.name || c.email, ...o });
  orders.sort((a, b) => (a.at < b.at ? -1 : 1));
  const payments = report.payments.filter((p) => String(p.paid_on).slice(0, 7) === m);
  const sum = (arr, f) => round2(arr.reduce((a, x) => a + f(x), 0));
  return {
    month: m, orders, payments,
    totals: { sales: sum(orders, (o) => o.subtotal), commission: sum(orders, (o) => o.commission),
              earned: sum(orders.filter((o) => o.earned), (o) => o.commission), paid: sum(payments, (p) => p.amount) },
    balance: report.totals.balance
  };
}

export function statementCsv(report, st) {
  const lines = [['Order', 'Date', 'Client', 'Items', 'Total before tax', 'Discount', 'Profit', 'Rate', 'Status', 'Commission', 'Earned']];
  for (const o of st.orders) lines.push([o.number, String(o.at || '').slice(0, 10), o.client, o.items, o.subtotal.toFixed(2), o.discount.toFixed(2), o.profit.toFixed(2), rateText(o), o.statusLabel, o.commission.toFixed(2), o.earned ? 'Yes' : 'Pending']);
  lines.push([]);
  lines.push(['Payments to you', 'Date', 'Method', 'Reference', 'Amount']);
  for (const p of st.payments) lines.push(['', p.paid_on, p.method || '', p.reference || '', p.amount.toFixed(2)]);
  lines.push([]);
  lines.push(['Commission this month', st.totals.commission.toFixed(2)]);
  lines.push(['Earned this month', st.totals.earned.toFixed(2)]);
  lines.push(['Paid this month', st.totals.paid.toFixed(2)]);
  lines.push([`Balance owed to date (${report.partner.name || report.partner.email})`, st.balance.toFixed(2)]);
  return lines.map((l) => l.map(csvCell).join(',')).join('\n');
}

// ---- a request for one of their clients ---------------------------------------------------------
/** The partner asks us to quote or order for a client of theirs. It becomes an unassigned follow-up and an email. */
export async function requestForClient(partnerEmail, customerId, note) {
  if (!hasDb()) throw new PartnerError('Database not configured.', 'nodb');
  await ensurePartnerSchema();
  const partner = await getPartner(partnerEmail);
  if (!partner) throw new PartnerError('Not a referral partner.', 'nopartner');
  const text = String(note || '').trim();
  if (text.length < 5) throw new PartnerError('Say what the client is looking for.', 'note');
  const { rows } = await query(`SELECT id, name, email, phone FROM customers WHERE id = $1 AND lower(partner_email) = $2`, [Number(customerId), partner.email]);
  const c = rows[0];
  if (!c) throw new PartnerError('That is not one of your clients.', 'notfound');
  const recent = (await query(`SELECT COUNT(*)::int AS n FROM customer_tasks WHERE lower(created_by) = $1 AND created_at > now() - interval '1 hour'`, [partner.email])).rows[0]?.n || 0;
  if (recent >= 10) throw new PartnerError('Too many requests in the last hour. Please try again later.', 'rate');
  await addTask({ customerId: c.id, title: `Partner request from ${partner.name || partner.email}`, note: text.slice(0, 1000), createdBy: partner.email });
  try {
    await notifyOwner(`Partner request: ${c.name || c.email}`,
      `<p><b>${esc(partner.name || partner.email)}</b> asked for a quote or order for their client <b>${esc(c.name || c.email)}</b>${c.phone ? ' (' + esc(c.phone) + ')' : ''}.</p><p style="white-space:pre-wrap">${esc(text)}</p><p>It is on the customer's follow-ups, unassigned.</p>`);
  } catch { /* the follow-up is the record; a mail hiccup must not lose the request */ }
  return { ok: true };
}

// ---- visits to the link ---------------------------------------------------------------------------
const BOT = /bot|crawl|spider|preview|facebookexternalhit|slurp|whatsapp|telegram|curl|wget|headless/i;
export async function recordVisit(code, visitor, userAgent = '') {
  try {
    if (!hasDb() || !visitor || BOT.test(userAgent || '')) return;
    const p = await partnerByCode(code);
    if (!p) return;
    await query(
      `INSERT INTO partner_visits (partner_email, visitor, day) VALUES ($1,$2,(now() AT TIME ZONE '${TZ}')::date) ON CONFLICT DO NOTHING`,
      [p.email, String(visitor).slice(0, 40)]);
  } catch (e) { console.error('partner visit failed', e.message); }
}


// ---- the sign-up link ---------------------------------------------------------------------------
// /join/<code> remembers the partner in a cookie; the account that then signs up (or applies for
// membership) is put under them. An account already under a partner is NEVER moved, and only an
// ACTIVE partner's code counts.
export const PARTNER_COOKIE = 'bb_partner';
const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);

/** The partner's link code, made from their first name the first time it is needed (jayson, jayson2...). */
export async function ensureCode(email) {
  if (!hasDb()) return null;
  await ensurePartnerSchema();
  const e = norm(email);
  const { rows } = await query(`SELECT name, code FROM referral_partners WHERE email = $1`, [e]);
  if (!rows[0]) return null;
  if (rows[0].code) return rows[0].code;
  const base = slug((rows[0].name || '').split(/\s+/)[0]) || slug(e.split('@')[0]) || 'partner';
  for (let i = 0; i < 50; i += 1) {
    const code = i === 0 ? base : `${base}${i + 1}`;
    const r = await query(
      `UPDATE referral_partners SET code = $2 WHERE email = $1 AND code IS NULL
         AND NOT EXISTS (SELECT 1 FROM referral_partners WHERE lower(code) = $2) RETURNING code`, [e, code]);
    if (r.rows[0]) return r.rows[0].code;
    const again = await query(`SELECT code FROM referral_partners WHERE email = $1`, [e]);
    if (again.rows[0]?.code) return again.rows[0].code;
  }
  return null;
}

/** The RESELLER link: sends people to the reseller application. */
export const partnerLink = (code) => `${SITE_URL}/join/${code}`;
/** The END-USER link: sends people to the shop with the partner's discount code ready to apply. */
export const customerLink = (code) => `${SITE_URL}/join/${code}/shop`;

/**
 * The partner's end-user discount code (SECONDSHOP5): a plain percent coupon, made the first time it is needed and
 * kept in step with `customer_pct`. 0% switches it off. It carries NO commission of its own (the partner's % of profit
 * is paid by this module, not by the coupon system) and it goes through checkout like any typed code, so the same
 * floors apply. Returns the code, or null when there is none.
 */
export async function ensureCustomerCoupon(email) {
  if (!hasDb()) return null;
  try {
    await ensurePartnerSchema();
    const e = norm(email);
    const row = (await query(`SELECT name, code, customer_pct::float8 AS pct, customer_coupon_id AS cid FROM referral_partners WHERE email = $1`, [e])).rows[0];
    if (!row || !row.code) return null;
    const current = row.cid ? (await query(`SELECT id, code, value::float8 AS value, active FROM coupons WHERE id = $1`, [row.cid])).rows[0] : null;
    if (!(row.pct > 0)) {
      if (current && current.active) await query(`UPDATE coupons SET active = false WHERE id = $1`, [current.id]);
      return null;
    }
    const wanted = normalizeCode(`${row.code}${row.pct}`);
    if (current && current.active && current.value === row.pct && String(current.code).toUpperCase() === wanted) return current.code;
    const c = await saveCoupon({ id: current ? current.id : undefined, code: wanted, commissionPct: 0, kind: 'percent', value: row.pct, active: true,
      note: `Referral partner ${row.name || e}: end-user link` });
    await query(`UPDATE referral_partners SET customer_coupon_id = $2 WHERE email = $1`, [e, c.id]);
    return c.code;
  } catch (err) { console.error('partner coupon failed', err.message); return null; }
}

/** The ACTIVE partner whose end-user code this is, or null. */
export async function partnerByCouponCode(code) {
  const c = normalizeCode(code);
  if (!hasDb() || !c) return null;
  try {
    await ensurePartnerSchema();
    const { rows } = await query(
      `SELECT p.email, p.name, p.code FROM referral_partners p JOIN coupons c ON c.id = p.customer_coupon_id
        WHERE upper(c.code) = $1 AND p.revoked_at IS NULL`, [c]);
    return rows[0] || null;
  } catch { return null; }
}

// ---- the team: everyone who may sign in to this partner's portal ---------------------------------
export async function listTeam(partnerEmail) {
  if (!hasDb()) return [];
  await ensurePartnerSchema();
  const e = norm(partnerEmail);
  const { rows } = await query(
    `SELECT member_email AS email, name, added_by, added_at FROM partner_members WHERE partner_email = $1 AND removed_at IS NULL ORDER BY added_at`, [e]);
  const p = (await query(`SELECT email, name FROM referral_partners WHERE email = $1`, [e])).rows[0];
  return p ? [{ email: p.email, name: p.name, primary: true }, ...rows] : rows;
}

/** Give another person a login to this partner's portal. A new account gets an emailed link to choose a password. */
export async function addTeamMember(partnerEmail, { email, name }, by) {
  if (!hasDb()) throw new PartnerError('Database not configured.', 'nodb');
  const pe = norm(partnerEmail), e = norm(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new PartnerError('That is not an email address.', 'email');
  await ensurePartnerSchema();
  const partner = (await query(`SELECT email, name FROM referral_partners WHERE email = $1 AND revoked_at IS NULL`, [pe])).rows[0];
  if (!partner) throw new PartnerError('That is not an active referral partner.', 'nopartner');
  if (e === pe) throw new PartnerError('That is already the main login.', 'primary');
  const other = (await query(`SELECT 1 FROM referral_partners WHERE email = $1`, [e])).rows[0];
  if (other) throw new PartnerError('That email is a referral partner in its own right.', 'primary');
  const clash = (await query(`SELECT partner_email FROM partner_members WHERE member_email = $1 AND removed_at IS NULL AND partner_email <> $2`, [e, pe])).rows[0];
  if (clash) throw new PartnerError(`That email is on ${clash.partner_email}'s team already.`, 'teammate');
  await query(
    `INSERT INTO partner_members (member_email, partner_email, name, added_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (member_email) DO UPDATE SET partner_email = EXCLUDED.partner_email, name = COALESCE(EXCLUDED.name, partner_members.name),
       added_by = EXCLUDED.added_by, added_at = now(), removed_at = NULL, removed_by = NULL`,
    [e, pe, String(name || '').trim().slice(0, 120) || null, norm(by) || null]);
  await audit({ email: by }, { action: 'partner.team.add', entity: 'referral_partner', summary: `${e} can sign in for ${pe}` });
  const acct = await ensurePartnerAccount(e, name);
  const invite = acct.created ? await invitePartner(e, by) : null;
  return { ok: true, accountCreated: acct.created, ...(invite || {}) };
}

export async function removeTeamMember(partnerEmail, email, by) {
  if (!hasDb()) throw new PartnerError('Database not configured.', 'nodb');
  await ensurePartnerSchema();
  const r = await query(`UPDATE partner_members SET removed_at = now(), removed_by = $3 WHERE partner_email = $1 AND member_email = $2 AND removed_at IS NULL RETURNING member_email`,
    [norm(partnerEmail), norm(email), norm(by) || null]);
  if (!r.rows[0]) throw new PartnerError('That person is not on the team.', 'notfound');
  await audit({ email: by }, { action: 'partner.team.remove', entity: 'referral_partner', summary: `${norm(email)} no longer signs in for ${norm(partnerEmail)}` });
  return { ok: true };
}

/** The ACTIVE partner who owns this code, or null. */
export async function partnerByCode(code) {
  const c = slug(code);
  if (!hasDb() || !c) return null;
  try {
    await ensurePartnerSchema();
    // The current code, or an old one that was replaced (links already sent must keep working).
    const { rows } = await query(
      `SELECT p.email, p.name, p.code FROM referral_partners p
        WHERE p.revoked_at IS NULL
          AND (lower(p.code) = $1 OR EXISTS (SELECT 1 FROM partner_code_aliases a WHERE a.alias = $1 AND a.partner_email = p.email))
        ORDER BY (lower(p.code) = $1) DESC LIMIT 1`, [c]);
    return rows[0] || null;
  } catch { return null; }
}

/**
 * Change a partner's link code (the end of /join/<code>). The old code is kept as an alias, so links already sent still
 * work, and the end-user discount code follows (JAYSON5 -> SECONDSHOP5). Refused if the new code is taken.
 */
export async function setPartnerCode(email, newCode, by) {
  if (!hasDb()) throw new PartnerError('Database not configured.', 'nodb');
  await ensurePartnerSchema();
  const e = norm(email);
  const c = slug(newCode);
  if (c.length < 2) throw new PartnerError('A code is 2-24 letters or digits.', 'code');
  const cur = (await query(`SELECT code, customer_pct::float8 AS pct FROM referral_partners WHERE email = $1 AND revoked_at IS NULL`, [e])).rows[0];
  if (!cur) throw new PartnerError('That is not an active referral partner.', 'nopartner');
  if ((cur.code || '').toLowerCase() === c) return { ok: true, code: c, unchanged: true };
  const taken = (await query(
    `SELECT 1 FROM referral_partners WHERE lower(code) = $1 AND email <> $2
     UNION ALL SELECT 1 FROM partner_code_aliases WHERE alias = $1 AND partner_email <> $2`, [c, e])).rows[0];
  if (taken) throw new PartnerError(`The code ${c} is already in use.`, 'taken');
  if (cur.pct > 0) {
    const wanted = normalizeCode(`${c}${cur.pct}`);
    const clash = (await query(`SELECT 1 FROM coupons WHERE upper(code) = $1 AND id IS DISTINCT FROM (SELECT customer_coupon_id FROM referral_partners WHERE email = $2)`, [wanted, e])).rows[0];
    if (clash) throw new PartnerError(`The discount code ${wanted} is already in use.`, 'taken');
  }
  if (cur.code) await query(`INSERT INTO partner_code_aliases (alias, partner_email) VALUES ($1,$2) ON CONFLICT (alias) DO UPDATE SET partner_email = EXCLUDED.partner_email`, [cur.code.toLowerCase(), e]);
  await query(`DELETE FROM partner_code_aliases WHERE alias = $1 AND partner_email = $2`, [c, e]);
  await query(`UPDATE referral_partners SET code = $2 WHERE email = $1`, [e, c]);
  await ensureCustomerCoupon(e);
  await audit({ email: by }, { action: 'partner.code', entity: 'referral_partner', summary: `${e} link code ${cur.code || '(none)'} -> ${c}` });
  return { ok: true, code: c };
}

/** Put this person's customer record under the partner who owns `code`, unless they already have one. */
export async function attachPartnerByCode(code, { email, name, phone, userId, via = 'sign-up link' } = {}) {
  try {
    const p = await partnerByCode(code);
    if (!p || !email) return { attached: false };
    const id = await upsertCustomer({ email, name, phone, userId });
    if (!id) return { attached: false };
    const r = await query(
      `UPDATE customers SET partner_email = $2, partner_set_by = $3, partner_set_at = now()
        WHERE id = $1 AND partner_email IS NULL RETURNING id`, [id, p.email, via]);
    if (r.rows[0]) {
      await audit({ email: 'sign-up link' }, { action: 'partner.client', entity: 'customer', entityId: id, summary: `${norm(email)} ${via === 'order link' ? 'ordered through' : 'signed up through'} ${p.email}'s link` });
      // Tell us and tell the partner. Best effort: a mail problem must never touch the signup that caused it.
      const who = String(name || '').trim() || norm(email);
      try { await notifyOwner(`New client through ${p.name || p.email}'s link: ${who}`, `<p><b>${esc(who)}</b> (${esc(norm(email))}) ${via === 'order link' ? 'placed an order through' : 'created an account through'} <b>${esc(p.name || p.email)}</b>'s referral link. They are now under that partner. Reseller pricing, if they apply for it, still needs your approval on the Resellers page.</p>`); } catch { /* ignore */ }
      try { await sendPartnerClientJoined({ to: p.email, partnerName: p.name, clientName: who }); } catch { /* ignore */ }
    }
    return { attached: !!r.rows[0], partner: p.email };
  } catch (e) { console.error('partner attach failed', e.message); return { attached: false }; }
}

/** The same, reading the code from the cookie the link left. Never throws; signup must not depend on it. */
export async function attachPartnerFromCookie(info) {
  try {
    const jar = await cookies();
    const code = jar.get(PARTNER_COOKIE)?.value;
    if (!code) return { attached: false };
    return await attachPartnerByCode(code, info);
  } catch { return { attached: false }; }
}

/** At checkout: the buyer used the partner's end-user code, or arrived by their link. Never moves a customer already under a partner. */
export async function attachPartnerForOrder({ couponCode, email, name, phone, userId } = {}) {
  try {
    let code = null;
    if (couponCode) { const p = await partnerByCouponCode(couponCode); if (p) code = p.code; }
    if (!code) { const jar = await cookies(); code = jar.get(PARTNER_COOKIE)?.value || null; }
    if (!code) return { attached: false };
    return await attachPartnerByCode(code, { email, name, phone, userId, via: 'order link' });
  } catch { return { attached: false }; }
}
