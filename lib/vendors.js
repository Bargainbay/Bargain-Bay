// Vendors — who sells on the marketplace, who may act for them, their commission
// and their strikes. See docs/marketplace/PLAN.md and db/migrations/0016.
//
// THE ONE RULE OF THIS FILE: a vendor-facing caller learns which vendor it is
// from the SESSION (`vendorAccess(email)`), never from a request parameter.
// Anything that takes a vendorId is staff-side.
import { query, withTransaction } from './db';
import {
  STRIKE_LIMIT, STRIKE_REASONS, STRIKE_REVIEW_DAYS, DEFAULT_COMMISSION_BPS, standing
} from './marketplace-rules';
import { VENDOR_ROLES, MFA_GRACE_DAYS, roleNeedsMfa } from './vendor-permissions';
import { checkBusinessIds, normBn, normHst, namesAgree } from './business-ids';

const clean = (s) => String(s ?? '').trim();
const email = (s) => clean(s).toLowerCase();

export const slugify = (s) =>
  clean(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

async function uniqueSlug(base, q = query) {
  const root = slugify(base) || 'vendor';
  for (let i = 0; i < 50; i++) {
    const s = i === 0 ? root : `${root}-${i + 1}`;
    const { rows } = await q('SELECT 1 FROM vendors WHERE slug = $1', [s]);
    if (!rows.length) return s;
  }
  throw new Error('Could not find a free vendor slug.');
}

export async function logVendorEvent(q, vendorId, event, actor, detail = null) {
  await q('INSERT INTO vendor_events (vendor_id, event, actor, detail) VALUES ($1,$2,$3,$4)',
    [vendorId, event, actor || null, detail ? JSON.stringify(detail) : null]);
}

/** A vendor applies. Nothing about this grants access to anything. */
export async function createApplication(a, { by } = {}) {
  const legal = clean(a.legalName);
  const mail = email(a.contactEmail);
  if (!legal) throw new Error('Legal business name is required.');
  if (!/^\S+@\S+\.\S+$/.test(mail)) throw new Error('A valid contact email is required.');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const slug = await uniqueSlug(a.tradeName || legal, q);
    const { rows } = await q(
      `INSERT INTO vendors (slug, legal_name, trade_name, business_no, hst_no, hst_status, source_of_goods,
                            contact_name, contact_email, contact_phone, address, city, postal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, slug`,
      [slug, legal, clean(a.tradeName) || null, normBn(a.businessNo) || clean(a.businessNo) || null, normHst(a.hstNo) || clean(a.hstNo) || null,
       a.hstStatus || null, clean(a.sourceOfGoods) || null, clean(a.contactName) || null, mail,
       clean(a.contactPhone) || null, clean(a.address) || null, clean(a.city) || null, clean(a.postal) || null]);
    await logVendorEvent(q, rows[0].id, 'applied', by || mail);
    return rows[0];
  });
}

/** Other, still-live applications/vendors carrying the same BN or HST account. */
async function sharedIdentity(q, vendorId, bn, hst) {
  const { rows } = await q(
    `SELECT id, legal_name, status FROM vendors
      WHERE id <> $1 AND status <> 'rejected'
        AND ( ($2::text IS NOT NULL AND substr(regexp_replace(coalesce(business_no,''), '\\D', '', 'g'), 1, 9) = $2)
           OR ($3::text IS NOT NULL AND upper(regexp_replace(coalesce(hst_no,''), '[^0-9A-Za-z]', '', 'g')) = $3) )`,
    [vendorId, bn, hst]);
  return rows;
}

/** Everything that must be true of a vendor's identity before it can be approved. [] means clear. */
export async function identityProblems(vendorId, q = query) {
  const { rows } = await q('SELECT * FROM vendors WHERE id = $1', [vendorId]);
  if (!rows.length) return ['No such vendor.'];
  const v = rows[0];
  const chk = checkBusinessIds({ businessNo: v.business_no, hstNo: v.hst_no });
  const problems = [...chk.problems];
  if (chk.ok) {
    for (const o of await sharedIdentity(q, vendorId, chk.bn, chk.hst)) {
      problems.push(`The same Business Number / HST account is already on another ${o.status} vendor (${o.legal_name}, #${o.id}).`);
    }
  }
  if (!v.identity_verified_at) problems.push('Nobody has checked this business in the CRA registry yet. Record that check first.');
  return problems;
}

/**
 * A person has looked the business up in the CRA GST/HST registry and typed what it showed. The
 * registry name must agree with the application — a mismatch is a refusal, not a warning: correct
 * the application or reject it. This is the step that proves the business exists; the format and
 * match checks in lib/business-ids.js only prove the numbers are coherent.
 */
export async function recordIdentityCheck(vendorId, { by, registryName, active, note }) {
  if (!by) throw new Error('Who is recording this check?');
  if (!clean(registryName)) throw new Error('Type the business name exactly as the CRA registry shows it.');
  if (active !== true) throw new Error('The registry must show the GST/HST account as active. If it does not, reject the application.');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q('SELECT * FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
    if (!rows.length) throw new Error('No such vendor.');
    const v = rows[0];
    if (v.status !== 'applied') throw new Error(`This vendor is already ${v.status}.`);
    const chk = checkBusinessIds({ businessNo: v.business_no, hstNo: v.hst_no });
    if (!chk.ok) throw new Error(chk.problems[0]);
    if (!namesAgree(registryName, v.legal_name, v.trade_name)) {
      throw new Error(`The registry name "${clean(registryName)}" does not match the application ("${v.legal_name}"). Do not approve a business whose name differs from its registration — ask the applicant, or reject.`);
    }
    const dupes = await sharedIdentity(q, vendorId, chk.bn, chk.hst);
    if (dupes.length) throw new Error(`The same Business Number / HST account is already on another vendor (${dupes[0].legal_name}, #${dupes[0].id}).`);
    await q(`UPDATE vendors SET identity_verified_at = now(), identity_verified_by = $2, identity_registry_name = $3,
                                identity_note = $4, hst_status = 'registered' WHERE id = $1`,
      [vendorId, by, clean(registryName), clean(note) || null]);
    await logVendorEvent(q, vendorId, 'identity_verified', by, { bn: chk.bn, hst: chk.hst, registryName: clean(registryName) });
    return { ok: true };
  });
}

/**
 * Approve (tier 0, probation) or reject an application. Approval needs the Business Number and HST
 * account to be well-formed, to match each other, to be unique, and to have been checked against the
 * CRA registry by a person (`recordIdentityCheck`). "Nobody has looked" is a state, not an answer.
 */
export async function decideApplication(vendorId, { approve, by, reason, hstStatus }) {
  if (!by) throw new Error('Who is deciding this?');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows } = await q('SELECT status, hst_status FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
    if (!rows.length) throw new Error('No such vendor.');
    if (rows[0].status !== 'applied') throw new Error(`This vendor is already ${rows[0].status}.`);
    if (!approve) {
      if (!clean(reason)) throw new Error('A rejection needs a reason.');
      await q(`UPDATE vendors SET status='rejected', status_reason=$2 WHERE id=$1`, [vendorId, clean(reason)]);
      await logVendorEvent(q, vendorId, 'rejected', by, { reason: clean(reason) });
      return { ok: true, status: 'rejected' };
    }
    const problems = await identityProblems(vendorId, q);
    if (problems.length) throw new Error(`Cannot approve: ${problems[0]}`);
    // Every seller is HST-registered (the number above is mandatory); small suppliers are not accepted.
    const hst = 'registered';
    await q(`UPDATE vendors SET status='approved', tier=0, hst_status=$2, approved_at=now(), approved_by=$3 WHERE id=$1`,
      [vendorId, hst, by]);
    await logVendorEvent(q, vendorId, 'approved', by, { tier: 0 });
    return { ok: true, status: 'approved' };
  });
}

// The pre-roles list was owner / staff. 'staff' could do everything but the bank account and the
// policies, which is what 'manager' is; migration 0034 converts the rows and this the callers.
const normRole = (r) => (r === 'staff' ? 'manager' : r);

/**
 * Let an email act for a vendor, in a role (lib/vendor-permissions.js). Used by staff (first
 * owner login, an admin decision) and by an owner inviting their own team (lib/vendor-team.js).
 * Access is by EMAIL, like dispatch_access: they sign up or sign in with that address, in any
 * order. A new grant has MFA_GRACE_DAYS before a role that needs a second factor must enrol.
 */
export async function grantVendorUser(vendorId, { email: mail, name, role = 'viewer', by }) {
  const e = email(mail);
  if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error('A valid email is required.');
  const r = normRole(role);
  if (!VENDOR_ROLES.includes(r)) throw new Error(`Role must be one of: ${VENDOR_ROLES.join(', ')}.`);
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows: v } = await q('SELECT status FROM vendors WHERE id = $1', [vendorId]);
    if (!v.length) throw new Error('No such vendor.');
    if (['rejected', 'terminated'].includes(v[0].status)) throw new Error(`A ${v[0].status} vendor cannot be given access.`);
    const { rows: held } = await q(
      `SELECT vendor_id FROM vendor_users WHERE lower(email) = $1 AND revoked_at IS NULL`, [e]);
    if (held.length) {
      if (held[0].vendor_id === vendorId) return { ok: true, already: true };
      throw new Error('That email already acts for a different vendor.');
    }
    await q(`INSERT INTO vendor_users (vendor_id, email, name, role, granted_by, mfa_grace_until)
             VALUES ($1,$2,$3,$4,$5, now() + make_interval(days => $6))`,
      [vendorId, e, clean(name) || null, r, by || null, MFA_GRACE_DAYS]);
    await logVendorEvent(q, vendorId, 'user_granted', by, { email: e, role: r });
    return { ok: true };
  });
}

/** Active owners other than this email — the last-owner rule needs the count under a lock. */
async function otherOwners(q, vendorId, e) {
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM vendor_users WHERE vendor_id = $1 AND role = 'owner' AND revoked_at IS NULL AND lower(email) <> $2`,
    [vendorId, e]);
  return rows[0].n;
}

/**
 * Take someone's access away. The row is KEPT (revoked_at / revoked_by): who could act for this
 * business, between which dates, and who let them in, is what gets asked afterwards. The LAST
 * owner cannot be removed — a vendor with nobody who can accept the policies or change the bank
 * account is stuck; make someone else an owner first.
 */
export async function revokeVendorUser(vendorId, mail, { by }) {
  const e = email(mail);
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    await q('SELECT id FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
    const { rows } = await q(
      `SELECT role FROM vendor_users WHERE vendor_id = $1 AND lower(email) = $2 AND revoked_at IS NULL`, [vendorId, e]);
    if (!rows.length) return { ok: true, revoked: false };
    if (rows[0].role === 'owner' && (await otherOwners(q, vendorId, e)) === 0) {
      throw new Error('That is the last owner. Make someone else an owner first.');
    }
    await q(`UPDATE vendor_users SET revoked_at = now(), revoked_by = $3
              WHERE vendor_id = $1 AND lower(email) = $2 AND revoked_at IS NULL`, [vendorId, e, by || null]);
    await logVendorEvent(q, vendorId, 'user_revoked', by, { email: e });
    return { ok: true, revoked: true };
  });
}

/** Change an active member's role. The last owner cannot be demoted. Promoting to a role that needs MFA starts a new grace period. */
export async function changeVendorUserRole(vendorId, mail, role, { by }) {
  const e = email(mail);
  const r = normRole(role);
  if (!VENDOR_ROLES.includes(r)) throw new Error(`Role must be one of: ${VENDOR_ROLES.join(', ')}.`);
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    await q('SELECT id FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
    const { rows } = await q(
      `SELECT role FROM vendor_users WHERE vendor_id = $1 AND lower(email) = $2 AND revoked_at IS NULL`, [vendorId, e]);
    if (!rows.length) throw new Error('No such team member.');
    const from = rows[0].role;
    if (from === r) return { ok: true, unchanged: true };
    if (from === 'owner' && (await otherOwners(q, vendorId, e)) === 0) {
      throw new Error('That is the last owner. Make someone else an owner first.');
    }
    const newGrace = roleNeedsMfa(r) && !roleNeedsMfa(from);
    await q(`UPDATE vendor_users SET role = $3, role_changed_by = $4, role_changed_at = now(),
                    mfa_grace_until = CASE WHEN $5::boolean THEN now() + make_interval(days => $6) ELSE mfa_grace_until END
              WHERE vendor_id = $1 AND lower(email) = $2 AND revoked_at IS NULL`,
      [vendorId, e, r, by || null, newGrace, MFA_GRACE_DAYS]);
    await logVendorEvent(q, vendorId, 'user_role_changed', by, { email: e, from, to: r });
    return { ok: true, from, to: r };
  });
}

/**
 * THE vendor-side door. Given the signed-in email, which vendor (if any) do they
 * act for? Everything a vendor screen loads must start here and use the id it
 * returns — never an id from the request.
 *
 * Returns null for: no grant, a revoked grant, or a vendor that is rejected,
 * terminated or merely applied (an applicant has no portal yet). Restricted and
 * suspended vendors still get in — they must see their strikes and fulfil orders
 * already paid — and `canSell` says what they may no longer do.
 */
export async function vendorAccess(mail) {
  const e = email(mail);
  if (!e) return null;
  const { rows } = await query(
    `SELECT v.id, v.slug, v.legal_name, v.trade_name, v.status, v.tier, v.hst_status,
            u.role, u.email AS user_email, u.granted_at, u.mfa_grace_until
       FROM vendor_users u JOIN vendors v ON v.id = u.vendor_id
      WHERE lower(u.email) = $1 AND u.revoked_at IS NULL
        AND v.status IN ('approved','restricted','suspended')`, [e]);
  return rows[0] || null;
}

// --- commission ------------------------------------------------------------

/** The rate in force for a vendor on a date: their own newest row at or before it, else the platform's. */
export async function commissionBpsFor(vendorId, onDate) {
  const d = onDate || new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await query(
      `SELECT rate_bps FROM commission_rates
        WHERE effective_from <= $2::date AND (vendor_id = $1 OR vendor_id IS NULL)
        ORDER BY (vendor_id IS NOT NULL) DESC, effective_from DESC LIMIT 1`, [vendorId, d]);
    return rows.length ? Number(rows[0].rate_bps) : DEFAULT_COMMISSION_BPS;
  } catch (e) {
    console.error('commissionBpsFor failed', e.message);
    return DEFAULT_COMMISSION_BPS; // degrade to the published rate rather than lose a sale
  }
}

/** Admin: a new rate from a date. Past dates are refused — a past sale was already judged at its rate. */
export async function setCommission({ vendorId = null, rateBps, effectiveFrom, by }) {
  const bps = Number(rateBps);
  if (!Number.isInteger(bps) || bps < 0 || bps > 5000) throw new Error('Rate must be 0–50% (in basis points).');
  const today = new Date().toISOString().slice(0, 10);
  const from = clean(effectiveFrom) || today;
  if (from < today) throw new Error('A rate cannot start in the past.');
  await query(
    `INSERT INTO commission_rates (vendor_id, rate_bps, effective_from, set_by) VALUES ($1,$2,$3::date,$4)
     ON CONFLICT (COALESCE(vendor_id, 0), effective_from) DO UPDATE SET rate_bps = EXCLUDED.rate_bps, set_by = EXCLUDED.set_by, set_at = now()`,
    [vendorId, bps, from, by || null]);
  if (vendorId) await logVendorEvent(query, vendorId, 'commission_set', by, { rateBps: bps, from });
  return { ok: true };
}

// --- strikes ---------------------------------------------------------------

export async function activeStrikeCount(vendorId, q = query) {
  const { rows } = await q('SELECT count(*)::int AS n FROM vendor_strikes WHERE vendor_id = $1 AND revised_at IS NULL', [vendorId]);
  return rows[0].n;
}

/**
 * Issue a strike. The third ACTIVE strike restricts the vendor — no new sales;
 * orders already paid must still be fulfilled.
 */
export async function issueStrike(vendorId, { reason, orderRef, note, by }) {
  if (!STRIKE_REASONS[reason]) throw new Error('Choose a reason from the list.');
  if (reason === 'other' && !clean(note)) throw new Error('"Other" needs an explanation.');
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const { rows: v } = await q('SELECT status FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
    if (!v.length) throw new Error('No such vendor.');
    const { rows } = await q(
      `INSERT INTO vendor_strikes (vendor_id, reason_code, order_ref, note, issued_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`, [vendorId, reason, orderRef || null, clean(note) || null, by || null]);
    const active = await activeStrikeCount(vendorId, q);
    await logVendorEvent(q, vendorId, 'strike_issued', by, { strikeId: rows[0].id, reason, orderRef: orderRef || null, active });
    let restricted = false;
    if (active >= STRIKE_LIMIT && v[0].status === 'approved') {
      await q(`UPDATE vendors SET status='restricted', status_reason=$2 WHERE id=$1`,
        [vendorId, `${active} active strikes`]);
      await logVendorEvent(q, vendorId, 'restricted', 'system', { active });
      // Restricted means no new sales: whatever is on sale comes down. Units already reserved or
      // sold are untouched — a paid order must still be fulfilled.
      const { rows: down } = await q(`UPDATE marketplace_listings SET status='paused', updated_at=now()
                                       WHERE vendor_id = $1 AND status = 'live' RETURNING id`, [vendorId]);
      for (const d of down) {
        await q(`INSERT INTO listing_events (listing_id, event, actor, detail) VALUES ($1,'paused','system',$2)`,
          [d.id, JSON.stringify({ because: 'vendor restricted' })]);
      }
      restricted = true;
    }
    return { ok: true, strikeId: rows[0].id, active, restricted };
  });
}

/**
 * Management revises (removes) a strike. Needs a written reason and a name, and
 * the strike is KEPT, marked revised. Revising does not reinstate a restricted
 * vendor — that is a separate, deliberate decision (`reinstateVendor`).
 */
export async function reviseStrike(strikeId, { reason, by }) {
  if (!clean(reason)) throw new Error('Removing a strike needs a written reason.');
  if (!by) throw new Error('Who is revising this strike?');
  const { rows } = await query(
    `UPDATE vendor_strikes SET revised_at = now(), revised_by = $2, revised_reason = $3
      WHERE id = $1 AND revised_at IS NULL RETURNING vendor_id`, [strikeId, by, clean(reason)]);
  if (!rows.length) throw new Error('That strike does not exist or is already revised.');
  await logVendorEvent(query, rows[0].vendor_id, 'strike_revised', by, { strikeId, reason: clean(reason) });
  return { ok: true };
}

/** "Keep it" in the periodic review: it resurfaces again after another STRIKE_REVIEW_DAYS. */
export async function markStrikeReviewed(strikeId, { by }) {
  const { rows } = await query(
    `UPDATE vendor_strikes SET last_review_at = now() WHERE id = $1 AND revised_at IS NULL RETURNING vendor_id`, [strikeId]);
  if (!rows.length) throw new Error('That strike does not exist or is already revised.');
  await logVendorEvent(query, rows[0].vendor_id, 'strike_kept', by, { strikeId });
  return { ok: true };
}

/** Restricted → approved, back on probation. Deliberate and logged. */
export async function reinstateVendor(vendorId, { by, reason }) {
  if (!clean(reason)) throw new Error('Reinstating a vendor needs a reason.');
  const { rowCount } = await query(
    `UPDATE vendors SET status='approved', tier=0, status_reason=NULL WHERE id=$1 AND status='restricted'`, [vendorId]);
  if (!rowCount) throw new Error('Only a restricted vendor can be reinstated.');
  await logVendorEvent(query, vendorId, 'reinstated', by, { reason: clean(reason) });
  return { ok: true };
}

/** Admin queue: every unrevised strike that is due for its periodic look. Oldest first. */
export async function strikesAwaitingReview(now = new Date()) {
  const { rows } = await query(
    `SELECT s.id, s.vendor_id, v.trade_name, v.legal_name, v.status, s.reason_code, s.order_ref, s.note,
            s.issued_at, s.last_review_at
       FROM vendor_strikes s JOIN vendors v ON v.id = s.vendor_id
      WHERE s.revised_at IS NULL AND s.last_review_at <= $1::timestamptz - make_interval(days => $2)
      ORDER BY s.last_review_at`, [now.toISOString(), STRIKE_REVIEW_DAYS]);
  return rows;
}

/** The vendor's own strike meter. Takes the id from vendorAccess(), never from a request. */
export async function strikeMeter(vendorId) {
  const { rows } = await query(
    `SELECT id, reason_code, order_ref, note, issued_at, revised_at, revised_reason
       FROM vendor_strikes WHERE vendor_id = $1 ORDER BY issued_at DESC`, [vendorId]);
  const active = rows.filter((r) => !r.revised_at).length;
  const { rows: v } = await query('SELECT status FROM vendors WHERE id = $1', [vendorId]);
  return { active, limit: STRIKE_LIMIT, standing: standing({ status: v[0]?.status, activeStrikes: active }), strikes: rows };
}
