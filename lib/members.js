// Member / reseller tier on top of the existing users table.
// A user is a paying "member" (wholesale pricing) only when
// role='member' AND member_status='approved'. Everyone else is a 'client'.
import { query, hasDb } from './db';

export async function getMembership(userId) {
  if (!userId || !hasDb()) return null;
  try {
    const { rows } = await query(
      `SELECT role, member_status, business_name, member_note FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] || null;
  } catch (e) {
    console.error('getMembership failed:', e.message);
    return null;
  }
}

// The columns that record which version of the Member Agreement was accepted. Migration 0041 adds them; this adds them
// too (once per process) so a request made before anybody has run the migration button still works.
let _termsCols = null;
function ensureTermsColumns() {
  if (!_termsCols) {
    _termsCols = query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS member_terms_version text;
                        ALTER TABLE users ADD COLUMN IF NOT EXISTS member_terms_accepted_at timestamptz;`)
      .catch((e) => { _termsCols = null; throw e; });
  }
  return _termsCols;
}

// User-initiated: request wholesale/member access. Moves to 'pending' for admin review. `termsVersion` is the version of
// the Member Agreement they accepted; it is stored with the time.
export async function requestMembership(userId, businessName, note, { termsVersion = null } = {}) {
  if (!hasDb()) throw new Error('Database not configured');
  await ensureTermsColumns();
  await query(
    `UPDATE users
        SET member_status = 'pending', business_name = $2, member_note = $3, member_requested_at = now(),
            member_terms_version = $4, member_terms_accepted_at = CASE WHEN $4::text IS NULL THEN NULL ELSE now() END
      WHERE id = $1 AND (member_status IS NULL OR member_status IN ('none','rejected'))`,
    [userId, businessName || null, note || null, termsVersion]
  );
}

// Admin: list everyone who has requested or holds member status (pending first).
export async function listMembers() {
  if (!hasDb()) return [];
  const { rows } = await query(
    `SELECT id, email, name, phone, role, member_status, business_name, member_note,
            member_requested_at, member_approved_at, created_at
       FROM users
      WHERE member_status IS NOT NULL AND member_status <> 'none'
      ORDER BY (member_status = 'pending') DESC, member_requested_at DESC NULLS LAST`
  );
  const iso = (d) => (d ? d.toISOString() : null);
  // What each member has bought. A separate, soft-failing read: the list (and the Approve button) must
  // work even if the orders query ever cannot, so a failure here just leaves the columns empty.
  const stats = await memberOrderStats(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r,
    member_requested_at: iso(r.member_requested_at),
    member_approved_at: iso(r.member_approved_at),
    created_at: iso(r.created_at),
    orders: stats.get(r.id)?.orders || 0,
    spent: stats.get(r.id)?.spent || 0,
    last_order_at: stats.get(r.id)?.last || null }));
}

// Admin: approve | reject | revoke a member.
export async function setMembership(userId, decision) {
  if (!hasDb()) throw new Error('Database not configured');
  if (decision === 'approve')
    await query(`UPDATE users SET role='member', member_status='approved', member_approved_at=now() WHERE id=$1`, [userId]);
  else if (decision === 'reject')
    await query(`UPDATE users SET role='client', member_status='rejected' WHERE id=$1`, [userId]);
  else if (decision === 'revoke')
    await query(`UPDATE users SET role='client', member_status='none', member_approved_at=NULL WHERE id=$1`, [userId]);
  else throw new Error('Unknown decision');
}

// Orders placed while signed in to the member's account: count, goods total (pre-tax, cancelled orders
// left out) and the date of the latest. Orders placed as a guest or raised on an invoice are not tied
// to the account and are not counted here.
async function memberOrderStats(ids) {
  const out = new Map();
  if (!ids.length) return out;
  try {
    const { rows } = await query(
      `SELECT user_id, COUNT(*)::int AS orders, COALESCE(SUM(subtotal),0)::float AS spent, MAX(created_at) AS last
         FROM orders WHERE user_id = ANY($1::int[]) AND status <> 'cancelled' GROUP BY user_id`,
      [ids]
    );
    for (const r of rows) out.set(r.user_id, { orders: r.orders, spent: r.spent, last: r.last ? r.last.toISOString() : null });
  } catch (e) { console.error('memberOrderStats failed:', e.message); }
  return out;
}

// How many applications are waiting for an answer. The nav badge reads this, so it is one cheap
// count and never the full list. Returns 0 when it cannot be read: a badge must never break a page.
export async function pendingMemberCount() {
  if (!hasDb()) return 0;
  try {
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM users WHERE member_status = 'pending'`);
    return rows[0]?.n || 0;
  } catch (e) {
    console.error('pendingMemberCount failed:', e.message);
    return 0;
  }
}

// Accounts that exist but never applied (or were never answered): the people an admin can make a reseller from the
// back end instead of asking them to apply again. Newest first. Driver accounts are not customers and are left out.
export async function listUnappliedAccounts({ q = '', limit = 25 } = {}) {
  if (!hasDb()) return [];
  const p = [];
  let search = '';
  const term = String(q || '').trim();
  if (term) {
    p.push('%' + term.replace(/[%_\\]/g, '\\$&') + '%');
    search = `AND (email ILIKE $1 OR name ILIKE $1 OR COALESCE(business_name,'') ILIKE $1 OR COALESCE(phone,'') ILIKE $1)`;
  }
  const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const { rows } = await query(
    `SELECT id, email, name, phone, business_name, created_at
       FROM users
      WHERE (member_status IS NULL OR member_status = 'none')
        AND NOT COALESCE(is_driver, false)
        AND email NOT LIKE 'driver-%@drivers.bargainbay.ca'
        ${search}
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT ${lim}`,
    p
  );
  return rows.map((r) => ({ ...r, created_at: r.created_at ? r.created_at.toISOString() : null }));
}

// Admin: make an existing account a reseller without them applying. Approves straight away (the admin IS the decision)
// and records that it was done this way. Returns the account, or null when it is not eligible (a driver, already a
// member, or no such user).
export async function addAsReseller(userId, businessName, { by = '' } = {}) {
  if (!hasDb()) throw new Error('Database not configured');
  const biz = String(businessName || '').trim();
  if (!biz) throw new Error('Business name is required.');
  const { rows } = await query(
    `UPDATE users
        SET role = 'member', member_status = 'approved', business_name = $2,
            member_approved_at = now(), member_requested_at = COALESCE(member_requested_at, now()),
            member_note = COALESCE(NULLIF(member_note, ''), 'Added by ' || $3 || ' (no application)')
      WHERE id = $1 AND NOT COALESCE(is_driver, false)
        AND (member_status IS NULL OR member_status IN ('none', 'pending', 'rejected'))
      RETURNING id, email, name, business_name`,
    [userId, biz, String(by || 'an admin')]
  );
  return rows[0] || null;
}
