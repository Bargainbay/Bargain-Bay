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
  return rows.map((r) => ({ ...r,
    member_requested_at: iso(r.member_requested_at),
    member_approved_at: iso(r.member_approved_at),
    created_at: iso(r.created_at) }));
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
