// Affiliates — people who promote our stock their own way and earn a percentage of
// the goods on every sale made with their code (owner, 2026-10-26: 5%; a $10,000
// stove pays $500). See migration 0037 and lib/commission-rules.js.
//
// THE CODE IS A COUPON. The checkout, the redemption booking inside its
// transaction and the release of an abandoned checkout all already run through
// `coupons`, and rebuilding that path for affiliates would be a second way to
// price an order. So approving an affiliate CREATES a coupon, and a sale made with
// the code is a `coupon_redemptions` row. This module is the person around it.
//
// WHAT AN AFFILIATE HAS EARNED IS NEVER STORED. It is read off the redemptions
// and the orders they point at on every load (same rule as the general ledger, a
// part's stock and a unit's location), so it cannot disagree with the sales and a
// cancelled or refunded order takes its commission with it.
//
// Rules that must hold:
//  * The base is the GOODS the customer paid for, before tax and without
//    delivery, after any discount their code took off (orders.subtotal -
//    orders.discount). Seller (marketplace) lines are not ours to commission.
//  * Commission is PAYABLE only after the return window (AFFILIATE_HOLD_DAYS)
//    closes on a DELIVERED order. Before that it is shown, as pending.
//  * A sale placed with the affiliate's own email or payout address is void:
//    nobody earns commission on their own purchase.
//  * What is paid is a separate append-only ledger; the balance is
//    payable - paid, and it can go negative (a refund after payout), which is
//    reported, never hidden.
import { query, hasDb, withTransaction } from './db';
import { saveCoupon, setCouponActive, normalizeCode } from './coupons';
import { audit } from './audit';
import { sendApprovalEmail, sendPayoutEmail, sendApplicationNotice } from './affiliate-mail';
import { round2 } from './constants';
import {
  AFFILIATE_DEFAULT_PCT, AFFILIATE_CUSTOMER_PCT, AFFILIATE_MIN_PAYOUT, AFFILIATE_HOLD_DAYS, affiliateCommission, affiliateSaleState
} from './commission-rules';

export const TERMS_VERSION = '2026-10-26';
const TZ = "AT TIME ZONE 'America/Toronto'";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v) => Number(v) || 0;

function shape(r) {
  return {
    id: r.id, email: r.email, name: r.name, phone: r.phone || '', payoutEmail: r.payout_email || '',
    audience: r.audience || '', status: r.status, code: r.code || '', couponId: r.coupon_id,
    commissionPct: num(r.commission_pct), termsAcceptedAt: r.terms_accepted_at,
    approvedBy: r.approved_by || '', approvedAt: r.approved_at, note: r.note || '', createdAt: r.created_at
  };
}

export async function affiliateByEmail(email) {
  if (!hasDb() || !email) return null;
  const { rows } = await query('SELECT * FROM affiliates WHERE lower(email) = lower($1)', [email]);
  return rows[0] ? shape(rows[0]) : null;
}

export async function affiliateById(id) {
  if (!hasDb()) return null;
  const { rows } = await query('SELECT * FROM affiliates WHERE id = $1', [id]);
  return rows[0] ? shape(rows[0]) : null;
}

/**
 * Someone applies. The email comes from their signed-in account (never the body),
 * so an application can only ever be made by, and for, the person logged in.
 * Re-applying returns the existing record rather than a second one; a rejected
 * applicant may re-apply, which puts it back to pending.
 */
export async function applyAsAffiliate(session, input = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const email = clean(session?.email, 200).toLowerCase();
  if (!email) throw new Error('Sign in first.');
  const name = clean(input.name || session?.name, 120);
  if (name.length < 2) throw new Error('Tell us your name.');
  const payout = clean(input.payoutEmail, 200).toLowerCase();
  if (!EMAIL_RE.test(payout)) throw new Error('Enter the email address we should e-transfer your commission to.');
  const audience = clean(input.audience, 600);
  if (audience.length < 10) throw new Error('Tell us in a sentence or two how you plan to promote Bargain Bay.');
  if (!input.acceptTerms) throw new Error('Please accept the affiliate terms.');

  const existing = await affiliateByEmail(email);
  if (existing && existing.status !== 'rejected') return { affiliate: existing, created: false };
  const { rows } = await query(
    `INSERT INTO affiliates (email, name, phone, payout_email, audience, status, terms_version, terms_accepted_at)
     VALUES ($1,$2,$3,$4,$5,'pending',$6, now())
     ON CONFLICT (lower(email)) DO UPDATE
        SET name = EXCLUDED.name, phone = EXCLUDED.phone, payout_email = EXCLUDED.payout_email,
            audience = EXCLUDED.audience, status = 'pending', terms_version = EXCLUDED.terms_version,
            terms_accepted_at = now()
     RETURNING *`,
    [email, name, clean(input.phone, 40) || null, payout, audience, TERMS_VERSION]);
  const affiliate = shape(rows[0]);
  await sendApplicationNotice({ name: affiliate.name, email: affiliate.email, audience });
  return { affiliate, created: true };
}

/** The affiliate can change where they are paid, and nothing else about themselves. */
export async function setPayoutEmail(session, payoutEmail) {
  const a = await affiliateByEmail(session?.email);
  if (!a) throw new Error('You are not an affiliate yet.');
  const payout = clean(payoutEmail, 200).toLowerCase();
  if (!EMAIL_RE.test(payout)) throw new Error('That does not look like an email address.');
  await query('UPDATE affiliates SET payout_email = $2 WHERE id = $1', [a.id, payout]);
  return { ...a, payoutEmail: payout };
}

// A code a person would be glad to say aloud: their name, stripped to letters, plus
// a number if it is taken. Admin can type their own instead.
async function freeCode(wanted) {
  const base = normalizeCode(wanted).replace(/[^A-Z0-9]/g, '').slice(0, 16) || 'PARTNER';
  for (let i = 0; i < 50; i += 1) {
    const c = i === 0 ? base : `${base}${i + 1}`;
    const { rows } = await query('SELECT 1 FROM coupons WHERE upper(code) = $1', [c]);
    if (!rows.length) return c;
  }
  throw new Error('Could not find a free code - type one in.');
}

/**
 * Approve (or re-approve) an affiliate: cut their code as a coupon that gives the
 * customer `customerPct` off and records `pct` commission against every use.
 */
export async function approveAffiliate(id, { code, pct, customerPct, by } = {}, session = null) {
  const a = await affiliateById(id);
  if (!a) throw new Error('That application no longer exists.');
  const rate = Math.min(50, Math.max(0, pct == null || pct === '' ? AFFILIATE_DEFAULT_PCT : num(pct)));
  const give = Math.min(30, Math.max(0.5, customerPct == null || customerPct === '' ? AFFILIATE_CUSTOMER_PCT : num(customerPct)));

  let couponId = a.couponId, finalCode = a.code;
  if (couponId) {
    // Already has a code: keep it, re-open it and apply the new rates.
    const wanted = normalizeCode(code) || a.code;
    const c = await saveCoupon({ id: couponId, code: wanted, affiliate: a.name, commissionPct: rate, kind: 'percent', value: give, active: true,
                                 note: `Affiliate: ${a.name}` });
    finalCode = c.code;
  } else {
    const wanted = normalizeCode(code) || await freeCode(a.name.split(/\s+/)[0]);
    const c = await saveCoupon({ code: wanted, affiliate: a.name, commissionPct: rate, kind: 'percent', value: give, active: true,
                                 note: `Affiliate: ${a.name}` });
    couponId = c.id; finalCode = c.code;
  }
  await query(
    `UPDATE affiliates SET status='approved', coupon_id=$2, code=$3, commission_pct=$4, approved_by=$5, approved_at=now() WHERE id=$1`,
    [id, couponId, finalCode, rate, by || session?.email || null]);
  await audit(session, { action: 'affiliate.approve', entity: 'affiliate', entityId: id, summary: `${a.name}: code ${finalCode}, ${rate}% commission, ${give}% off for the customer` });
  // Told once, when they MOVE into approved. Editing a rate or code on somebody already approved
  // must not send the welcome again.
  if (a.status !== 'approved') {
    await sendApprovalEmail({ name: a.name, email: a.email, code: finalCode, commissionPct: rate, customerPct: give, holdDays: AFFILIATE_HOLD_DAYS });
  }
  return affiliateById(id);
}

/** suspend (code stops working, history stays) | reinstate | reject */
export async function setAffiliateStatus(id, action, session = null) {
  const a = await affiliateById(id);
  if (!a) throw new Error('That affiliate no longer exists.');
  if (action === 'suspend') {
    if (a.couponId) await setCouponActive(a.couponId, false);
    await query(`UPDATE affiliates SET status='suspended' WHERE id=$1`, [id]);
  } else if (action === 'reinstate') {
    if (!a.couponId) throw new Error('This applicant was never approved - approve them instead.');
    await setCouponActive(a.couponId, true);
    await query(`UPDATE affiliates SET status='approved' WHERE id=$1`, [id]);
  } else if (action === 'reject') {
    if (a.status === 'approved') throw new Error('Suspend an approved affiliate rather than rejecting them.');
    await query(`UPDATE affiliates SET status='rejected' WHERE id=$1`, [id]);
  } else throw new Error('Unknown action.');
  await audit(session, { action: `affiliate.${action}`, entity: 'affiliate', entityId: id, summary: a.name });
  return affiliateById(id);
}

// ---- what they have earned ------------------------------------------------

/** Every sale made with this affiliate's code, newest first, each with its state. */
export async function affiliateSales(affiliateId) {
  if (!hasDb()) return [];
  const { rows } = await query(`
    SELECT r.id AS rid, o.order_number, o.status, o.email AS buyer_email,
           to_char(o.created_at ${TZ}, 'YYYY-MM-DD') AS sold_on,
           to_char(o.delivered_at ${TZ}, 'YYYY-MM-DD') AS delivered_on,
           GREATEST(0, COALESCE(o.subtotal,0) - COALESCE(o.vendor_subtotal,0) - COALESCE(o.discount,0)) AS base,
           COALESCE(r.commission_pct, a.commission_pct) AS pct,
           lower(a.email) AS a_email, lower(COALESCE(a.payout_email,'')) AS a_payout,
           to_char(now() ${TZ}, 'YYYY-MM-DD') AS today,
           (SELECT string_agg(oi.title, ', ' ORDER BY oi.id) FROM order_items oi
             WHERE oi.order_id = o.id AND COALESCE(oi.kind,'unit') = 'unit' AND oi.vendor_id IS NULL) AS titles
      FROM affiliates a
      JOIN coupon_redemptions r ON r.coupon_id = a.coupon_id
      JOIN orders o ON o.id = r.order_id
     WHERE a.id = $1
     ORDER BY o.created_at DESC, r.id DESC`, [affiliateId]);
  return rows.map((r) => {
    const own = r.buyer_email && (String(r.buyer_email).toLowerCase() === r.a_email || String(r.buyer_email).toLowerCase() === r.a_payout);
    const st = own ? { state: 'void', payableOn: null } : affiliateSaleState({ status: r.status, deliveredOn: r.delivered_on, today: r.today });
    const base = round2(num(r.base));
    return {
      id: r.rid, orderNumber: r.order_number, soldOn: r.sold_on, deliveredOn: r.delivered_on || null,
      what: r.titles || '', base, pct: num(r.pct),
      commission: st.state === 'void' ? 0 : affiliateCommission(base, num(r.pct)),
      state: st.state, payableOn: st.payableOn, own: !!own
    };
  });
}

export async function affiliatePayouts(affiliateId) {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, amount, method, ref, note, paid_by, to_char(paid_at ${TZ}, 'YYYY-MM-DD') AS paid_on
       FROM affiliate_payouts WHERE affiliate_id = $1 ORDER BY paid_at DESC, id DESC`, [affiliateId]);
  return rows.map((r) => ({ id: r.id, amount: round2(num(r.amount)), method: r.method, ref: r.ref || '', note: r.note || '', paidBy: r.paid_by || '', paidOn: r.paid_on }));
}

export function summarise(sales, payouts) {
  const by = (s) => round2(sales.filter((x) => x.state === s).reduce((a, x) => a + x.commission, 0));
  const payable = by('payable'), hold = by('hold'), waiting = by('waiting');
  const paid = round2(payouts.reduce((a, p) => a + p.amount, 0));
  return {
    sales: sales.filter((x) => x.state !== 'void').length,
    sold: round2(sales.filter((x) => x.state !== 'void').reduce((a, x) => a + x.base, 0)),
    waiting, hold, payable, paid,
    // What is owed right now. Negative means we have paid more than has matured (a
    // refund after a payout): shown as it is, and it nets off the next one.
    balance: round2(payable - paid),
    minPayout: AFFILIATE_MIN_PAYOUT, holdDays: AFFILIATE_HOLD_DAYS
  };
}

/** Everything the affiliate's own dashboard shows. Their record only - the email comes from the session. */
export async function dashboardFor(session) {
  const a = await affiliateByEmail(session?.email);
  if (!a) return { affiliate: null };
  if (a.status !== 'approved') return { affiliate: a };
  const [sales, payouts, clicks] = await Promise.all([affiliateSales(a.id), affiliatePayouts(a.id), clickStats(a.id)]);
  return { affiliate: a, sales, payouts, summary: summarise(sales, payouts), clicks };
}

// ---- admin ----------------------------------------------------------------

export async function listAffiliates() {
  if (!hasDb()) return [];
  const { rows } = await query(`SELECT * FROM affiliates ORDER BY (status = 'pending') DESC, lower(name)`);
  const out = [];
  for (const r of rows) {
    const a = shape(r);
    if (a.status === 'approved' || a.status === 'suspended') {
      const [sales, payouts, clicks] = await Promise.all([affiliateSales(a.id), affiliatePayouts(a.id), clickStats(a.id)]);
      out.push({ ...a, summary: summarise(sales, payouts), recent: sales.slice(0, 5), clicks });
    } else out.push(a);
  }
  return out;
}

/** Full detail for one affiliate (the admin's drill-down and the payout screen). */
export async function affiliateDetail(id) {
  const a = await affiliateById(id);
  if (!a) return null;
  const [sales, payouts, clicks] = await Promise.all([affiliateSales(id), affiliatePayouts(id), clickStats(id)]);
  return { affiliate: a, sales, payouts, summary: summarise(sales, payouts), clicks };
}

/**
 * Record an e-transfer that has been SENT. It never moves money - a person sends the
 * transfer from the bank, then records it here. Capped at what is payable now, and
 * serialised per affiliate so two clicks cannot both pass the check.
 */
export async function recordPayout(id, { amount, ref, note } = {}, session = null) {
  const a = await affiliateById(id);
  if (!a) throw new Error('That affiliate no longer exists.');
  const amt = round2(num(amount));
  if (!(amt > 0)) throw new Error('Enter the amount you sent.');
  const reference = clean(ref, 80) || null;
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(7701, $1)', [id]);
    const [sales, payouts] = await Promise.all([affiliateSales(id), affiliatePayouts(id)]);
    const s = summarise(sales, payouts);
    if (amt > s.balance + 0.004) {
      throw new Error(`Only $${Math.max(0, s.balance).toFixed(2)} is payable right now (commission on delivered orders whose ${s.holdDays}-day return window has closed, less what was already paid).`);
    }
    try {
      await client.query(
        `INSERT INTO affiliate_payouts (affiliate_id, amount, ref, note, paid_by) VALUES ($1,$2,$3,$4,$5)`,
        [id, amt, reference, clean(note, 300) || null, session?.email || null]);
    } catch (e) {
      if (e.code === '23505') throw new Error('A payout with that reference is already recorded.');
      throw e;
    }
    await audit(session, { action: 'affiliate.payout', entity: 'affiliate', entityId: id, summary: `${a.name}: $${amt.toFixed(2)}${reference ? ` (${reference})` : ''}` });
    return { paid: amt, balance: round2(s.balance - amt), mail: { name: a.name, email: a.payoutEmail || a.email, amount: amt, ref: reference, balance: round2(s.balance - amt) } };
  }).then(async (r) => {
    // After the transaction commits, so a mail problem can never undo a recorded payout.
    await sendPayoutEmail(r.mail);
    const { mail, ...rest } = r;
    return rest;
  });
}

// ---- the payout run -------------------------------------------------------

/**
 * Who is owed enough to be worth a transfer right now: payable balance at or over the minimum, with a
 * payout address. PROPOSES only. Sending money is a person at the bank; recording it is `recordPayoutRun`.
 */
export async function payoutRun() {
  if (!hasDb()) return { rows: [], total: 0, minPayout: AFFILIATE_MIN_PAYOUT };
  const { rows: people } = await query(`SELECT * FROM affiliates WHERE status IN ('approved','suspended') ORDER BY lower(name)`);
  const rows = [];
  for (const r of people) {
    const a = shape(r);
    const [sales, payouts] = await Promise.all([affiliateSales(a.id), affiliatePayouts(a.id)]);
    const s = summarise(sales, payouts);
    if (s.balance >= AFFILIATE_MIN_PAYOUT && a.payoutEmail) {
      rows.push({ id: a.id, name: a.name, payoutEmail: a.payoutEmail, amount: s.balance, sales: sales.filter((x) => x.state === 'payable').length });
    }
  }
  return { rows, total: round2(rows.reduce((t, r) => t + r.amount, 0)), minPayout: AFFILIATE_MIN_PAYOUT };
}

// The run as a CSV the bank's bulk e-transfer screen (or a person) can work down. Cells are
// neutralised against formula injection: a name is typed by a stranger.
export function payoutRunCsv(rows) {
  const cell = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return ['Name,E-transfer email,Amount,Reference']
    .concat(rows.map((r) => [r.name, r.payoutEmail, r.amount.toFixed(2), r.ref || ''].map(cell).join(','))).join('\r\n');
}

/**
 * Record every row of the run as SENT. Each gets the reference RUN-<date>-<id>, so pressing the
 * button twice is refused row by row rather than paying anybody twice. Each row stands alone: one
 * that fails is reported and the others still record.
 */
export async function recordPayoutRun(session = null) {
  const run = await payoutRun();
  const today = (await query(`SELECT to_char(now() ${TZ}, 'YYYY-MM-DD') AS d`)).rows[0].d;
  const done = [], failed = [];
  for (const r of run.rows) {
    try { await recordPayout(r.id, { amount: r.amount, ref: `RUN-${today}-${r.id}` }, session); done.push({ id: r.id, name: r.name, amount: r.amount }); }
    catch (e) { failed.push({ id: r.id, name: r.name, error: e.message }); }
  }
  return { recorded: done, failed, total: round2(done.reduce((t, r) => t + r.amount, 0)) };
}

// ---- visits through the link -----------------------------------------------

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|python-requests|curl\//i;
const CLICK_CAP_PER_HOUR = 300;   // one code, one hour: more than that is a script, not an audience

/** A visit arrived through `code`. Best-effort and silent: it must never get in a shopper's way. */
export async function recordClick(code, visitor, userAgent = '') {
  if (!hasDb()) return false;
  const v = clean(visitor, 64);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(v)) return false;
  if (BOT.test(String(userAgent))) return false;
  const { rows } = await query(`SELECT id FROM affiliates WHERE upper(code) = upper($1) AND status = 'approved'`, [clean(code, 24)]);
  if (!rows.length) return false;
  const id = rows[0].id;
  const recent = await query(`SELECT COUNT(*)::int AS n FROM affiliate_clicks WHERE affiliate_id = $1 AND created_at > now() - interval '1 hour'`, [id]);
  if (recent.rows[0].n >= CLICK_CAP_PER_HOUR) return false;
  await query(
    `INSERT INTO affiliate_clicks (affiliate_id, day, visitor) VALUES ($1, (now() ${TZ})::date, $2) ON CONFLICT DO NOTHING`, [id, v]);
  return true;
}

/** Distinct visitors and visitor-days through the link, and how many of the visitors' days became sales. */
export async function clickStats(affiliateId) {
  if (!hasDb()) return { visitors: 0, visits: 0 };
  try {
    const { rows } = await query(
      `SELECT COUNT(DISTINCT visitor)::int AS visitors, COUNT(*)::int AS visits FROM affiliate_clicks WHERE affiliate_id = $1`, [affiliateId]);
    return { visitors: rows[0].visitors, visits: rows[0].visits };
  } catch { return { visitors: 0, visits: 0 }; }   // table not migrated yet: no number, not an error page
}
