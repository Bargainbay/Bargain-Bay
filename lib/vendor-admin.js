// The staff/admin view of vendors, and the public way to apply. See docs/marketplace/PLAN.md §5, §12.
//
// Everything here takes a vendor id and is STAFF-SIDE. A vendor-facing caller must never reach
// these with an id from a request (they use lib/vendors.js vendorAccess instead).
import { query } from './db';
import { logVendorEvent, createApplication, commissionBpsFor } from './vendors';
import { activeStrikeCount } from './vendors';
import { bankSummary } from './vendor-bank';
import { vendorBalance } from './vendor-ledger';
import { standing } from './marketplace-rules';
import { acceptanceStatus } from './policy-acceptance';

const asInt = (v) => Number(v ?? 0);

/** Every vendor with the numbers a reviewer scans: strikes, what is on sale, what is waiting. */
export async function listVendors({ status } = {}) {
  const { rows } = await query(
    `SELECT v.id, v.slug, v.legal_name, v.trade_name, v.status, v.tier, v.hst_status, v.contact_email,
            v.contact_name, v.contact_phone, v.source_of_goods, v.created_at, v.approved_at,
            (SELECT count(*) FROM vendor_strikes s WHERE s.vendor_id = v.id AND s.revised_at IS NULL)::int AS strikes,
            (SELECT count(*) FROM marketplace_listings l WHERE l.vendor_id = v.id AND l.status = 'live')::int AS live,
            (SELECT count(*) FROM marketplace_listings l WHERE l.vendor_id = v.id AND l.status = 'in_review')::int AS in_review
       FROM vendors v WHERE ($1::text IS NULL OR v.status = $1) ORDER BY v.created_at DESC LIMIT 500`, [status || null]);
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.trade_name || r.legal_name, legalName: r.legal_name, status: r.status,
    tier: r.tier, hstStatus: r.hst_status, email: r.contact_email, contact: r.contact_name, phone: r.contact_phone,
    sourceOfGoods: r.source_of_goods, createdAt: r.created_at, approvedAt: r.approved_at,
    strikes: r.strikes, live: r.live, inReview: r.in_review,
    standing: standing({ status: r.status, activeStrikes: r.strikes })
  }));
}

/**
 * One vendor in full. Money (balance, bank) is included only when `money` is true — the caller
 * passes that for an admin, never for staff: it is the business's books.
 */
export async function vendorDetail(vendorId, { money = false } = {}) {
  const { rows } = await query('SELECT * FROM vendors WHERE id = $1', [vendorId]);
  if (!rows.length) return null;
  const v = rows[0];
  const [users, strikes, events, listings] = await Promise.all([
    query(`SELECT email, name, role, granted_by, granted_at, revoked_at, revoked_by FROM vendor_users WHERE vendor_id = $1 ORDER BY revoked_at NULLS FIRST, granted_at`, [vendorId]),
    query(`SELECT id, reason_code, order_ref, note, issued_by, issued_at, revised_at, revised_by, revised_reason FROM vendor_strikes WHERE vendor_id = $1 ORDER BY issued_at DESC`, [vendorId]),
    query(`SELECT event, actor, detail, at FROM vendor_events WHERE vendor_id = $1 ORDER BY at DESC, id DESC LIMIT 60`, [vendorId]),
    query(`SELECT status, count(*)::int AS n FROM marketplace_listings WHERE vendor_id = $1 GROUP BY status`, [vendorId])
  ]);
  const out = {
    vendor: {
      id: v.id, slug: v.slug, legalName: v.legal_name, tradeName: v.trade_name, businessNo: v.business_no, hstNo: v.hst_no,
      hstStatus: v.hst_status, sourceOfGoods: v.source_of_goods, contactName: v.contact_name, contactEmail: v.contact_email,
      contactPhone: v.contact_phone, address: v.address, city: v.city, postal: v.postal, status: v.status, tier: v.tier,
      statusReason: v.status_reason, approvedAt: v.approved_at, approvedBy: v.approved_by, createdAt: v.created_at,
      firstPayoutClearedAt: v.first_payout_cleared_at
    },
    users: users.rows, strikes: strikes.rows, events: events.rows,
    listingCounts: Object.fromEntries(listings.rows.map((r) => [r.status, r.n])),
    activeStrikes: strikes.rows.filter((s) => !s.revised_at).length
  };
  // Has the owner accepted the policies in force? A seller who hasn't cannot list new units.
  try {
    const a = await acceptanceStatus(vendorId);
    out.policies = { pending: a.pending.map((p) => p.title), acceptedAt: a.accepted[0]?.at || null, acceptedBy: a.accepted[0]?.by || null };
  } catch { out.policies = null; }
  if (money) {
    out.commissionBps = await commissionBpsFor(vendorId);
    out.balance = await vendorBalance(vendorId);
    out.bank = await bankSummary(vendorId);
    // the order refs a deduction can be tied to (and a warranty reserve drawn from)
    out.settledRefs = (await query(`SELECT DISTINCT order_ref FROM vendor_ledger WHERE vendor_id = $1 AND kind = 'sale' AND order_ref IS NOT NULL ORDER BY 1 DESC LIMIT 100`, [vendorId])).rows.map((r) => r.order_ref);
  }
  return out;
}

/** Change a vendor's trust tier by hand. Tiers are meant to be computed from performance; this override is logged. */
export async function setTier(vendorId, tier, { by, reason }) {
  const t = Number(tier);
  if (![0, 1, 2].includes(t)) throw new Error('Tier must be 0, 1 or 2.');
  if (!by) throw new Error('Who is changing this?');
  if (!String(reason || '').trim()) throw new Error('A tier change needs a reason.');
  const { rows } = await query(`UPDATE vendors SET tier = $2 WHERE id = $1 RETURNING id`, [vendorId, t]);
  if (!rows.length) throw new Error('No such vendor.');
  await logVendorEvent(query, vendorId, 'tier_set', by, { tier: t, reason: String(reason).trim() });
  return { ok: true };
}

// --- the public application ----------------------------------------------------

const HOURLY_GLOBAL = 40;     // applications from anyone, per hour
const DAILY_PER_EMAIL = 2;    // from one email address, per day

/**
 * A stranger applies. Throttled in Postgres rather than in memory (serverless instances don't share
 * memory) and nothing about applying grants any access. Staff are told once it is in.
 */
export async function submitPublicApplication(input) {
  const email = String(input?.contactEmail || '').trim().toLowerCase();
  const { rows: g } = await query(`SELECT count(*)::int AS n FROM vendor_events WHERE event = 'applied' AND at > now() - interval '1 hour'`);
  if (g[0].n >= HOURLY_GLOBAL) throw new Error('We are receiving a lot of applications right now — please try again in an hour.');
  const { rows: e } = await query(
    `SELECT count(*)::int AS n FROM vendors WHERE lower(contact_email) = $1 AND created_at > now() - interval '1 day'`, [email]);
  if (e[0].n >= DAILY_PER_EMAIL) throw new Error('We already have your application. We will be in touch.');
  if (!String(input?.contactName || '').trim()) throw new Error('Your name is required.');
  if (!String(input?.sourceOfGoods || '').trim()) throw new Error('Tell us where your stock comes from.');
  if (!input?.acceptsTerms) throw new Error('Please confirm you have read the seller guidelines.');
  const v = await createApplication({
    legalName: input.legalName, tradeName: input.tradeName, businessNo: input.businessNo, hstNo: input.hstNo,
    hstStatus: input.hstNo ? 'registered' : null, sourceOfGoods: input.sourceOfGoods, contactName: input.contactName,
    contactEmail: email, contactPhone: input.contactPhone, address: input.address, city: input.city, postal: input.postal
  }, { by: 'applicant' });
  return { ok: true, id: v.id };
}
