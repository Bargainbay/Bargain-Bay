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
import { normalizeEmail, createPasswordResetToken } from './auth';
import { sendPartnerInvite } from './email';
import { audit } from './audit';
import { round2 } from './constants';
import { SALE } from './analytics';
import { ORDER_MATCH } from './customers';

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
    const { rows } = await query(
      `SELECT email, name, commission_pct::float8 AS pct FROM referral_partners WHERE email = $1 AND revoked_at IS NULL`, [norm(email)]);
    return rows[0] || null;
  } catch { return null; }
}

export async function listPartners() {
  if (!hasDb()) return [];
  await ensurePartnerSchema();
  const { rows } = await query(
    `SELECT p.email, p.name, p.commission_pct::float8 AS pct, p.granted_at, p.revoked_at,
            (SELECT COUNT(*)::int FROM customers c WHERE lower(c.partner_email) = p.email) AS clients
       FROM referral_partners p ORDER BY p.revoked_at NULLS FIRST, p.granted_at DESC`);
  return rows;
}

export async function savePartner({ email, name, pct }, by) {
  if (!hasDb()) throw new PartnerError('Database not configured.', 'nodb');
  const e = norm(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new PartnerError('That is not an email address.', 'email');
  const p = pct == null || pct === '' ? DEFAULT_PARTNER_PCT : Number(pct);
  if (!Number.isFinite(p) || p <= 0 || p > 50) throw new PartnerError('The percentage must be between 0 and 50.', 'pct');
  await ensurePartnerSchema();
  await query(
    `INSERT INTO referral_partners (email, name, commission_pct, granted_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, referral_partners.name),
       commission_pct = EXCLUDED.commission_pct, revoked_at = NULL, revoked_by = NULL`,
    [e, String(name || '').trim().slice(0, 120) || null, p, norm(by) || null]);
  await audit({ email: by }, { action: 'partner.save', entity: 'referral_partner', summary: `${e} is a referral partner at ${p}% of profit` });
  // The owner creates the account; the partner only chooses a password. A NEW account is emailed at once.
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

/**
 * Everything a partner sees: their clients, each client's orders (items, price before tax, live status),
 * the profit on each and the commission owed. Cost and profit are used to work out the commission but only
 * the commission is returned — the partner is never shown a unit's cost.
 */
export async function partnerReport(email) {
  const empty = { partner: null, clients: [], totals: { orders: 0, sales: 0, commission: 0, missingCost: 0 } };
  if (!hasDb()) return empty;
  await ensurePartnerSchema();
  const partner = await getPartner(email);
  if (!partner) return empty;
  const rate = partner.pct / 100;

  const accounts = (await query(
    `SELECT id, name, email, phone, partner_set_at FROM customers WHERE lower(partner_email) = $1 ORDER BY name NULLS LAST, id`,
    [partner.email])).rows;

  const { rows } = await query(`
    SELECT c.id AS cid, o.id, o.order_number, o.status, o.created_at, o.subtotal::float8 AS subtotal, o.delivery_method,
           string_agg(oi.title, '; ' ORDER BY oi.id) FILTER (WHERE COALESCE(oi.kind,'unit') = 'unit') AS items,
           COALESCE(SUM(oi.price - COALESCE(oi.cost, p.cost)) FILTER (WHERE COALESCE(oi.kind,'unit') = 'unit' AND COALESCE(oi.cost, p.cost) IS NOT NULL), 0)::float8
             + COALESCE(SUM(oi.price) FILTER (WHERE oi.kind IN ('discount','trade_in')), 0)::float8
             - COALESCE(MAX(o.discount), 0)::float8 AS gp,
           COUNT(*) FILTER (WHERE COALESCE(oi.kind,'unit') = 'unit' AND oi.sku IS NOT NULL AND COALESCE(oi.cost, p.cost) IS NULL)::int AS missing
      FROM customers c
      JOIN orders o ON ${ORDER_MATCH}
      LEFT JOIN order_items oi ON oi.order_id = o.id AND oi.vendor_id IS NULL
      LEFT JOIN products p ON p.sku = oi.sku
     WHERE lower(c.partner_email) = $1 AND ${SALE('o')}
     GROUP BY c.id, o.id
     ORDER BY o.created_at DESC`, [partner.email]);

  const byClient = new Map(accounts.map((a) => [a.id, { ...a, partner_set_at: undefined, orders: [], sales: 0, commission: 0 }]));
  const totals = { orders: 0, sales: 0, commission: 0, missingCost: 0 };
  for (const r of rows) {
    const cl = byClient.get(r.cid);
    if (!cl) continue;
    const commission = round2(Math.max(0, r.gp) * rate);
    cl.orders.push({
      number: r.order_number, at: r.created_at ? r.created_at.toISOString() : null, status: r.status,
      statusLabel: STATUS_LABEL[r.status] || r.status, items: r.items || '', subtotal: round2(r.subtotal || 0),
      delivery: r.delivery_method || null, commission, costMissing: r.missing > 0
    });
    cl.sales = round2(cl.sales + (r.subtotal || 0));
    cl.commission = round2(cl.commission + commission);
    totals.orders += 1; totals.sales = round2(totals.sales + (r.subtotal || 0));
    totals.commission = round2(totals.commission + commission); totals.missingCost += r.missing;
  }
  return { partner: { email: partner.email, name: partner.name, pct: partner.pct }, clients: [...byClient.values()], totals };
}
