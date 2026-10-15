// A vendor's own team: who can act for the business, in what role. The OWNER manages it from
// the portal (lib/vendor-session.js gates every call with `team.manage` + a fresh second
// factor); an admin can also do it from Admin > Marketplace. Roles and what they allow:
// lib/vendor-permissions.js. Grants, revokes and the last-owner rule: lib/vendors.js.
//
// Team members are vendor_users rows. They are NEVER on ADMIN_EMAILS / SALES_EMAILS /
// staff_access — nothing here touches those, and no function here may.
import { query } from './db';
import {
  grantVendorUser, revokeVendorUser, changeVendorUserRole, logVendorEvent
} from './vendors';
import { clearMfa } from './vendor-mfa';
import { audit } from './audit';
import { roleNeedsMfa } from './vendor-permissions';

const clean = (s) => String(s ?? '').trim();
const lc = (s) => clean(s).toLowerCase();

/** Everyone who has acted for this vendor (revoked ones last, kept for the record), with their MFA state. */
export async function listTeam(vendorId) {
  const { rows } = await query(
    `SELECT vu.email, vu.name, vu.role, vu.granted_by, vu.granted_at, vu.revoked_at, vu.revoked_by, vu.mfa_grace_until,
            (m.confirmed_at IS NOT NULL) AS mfa_enrolled, (u.id IS NOT NULL) AS has_account
       FROM vendor_users vu
       LEFT JOIN LATERAL (SELECT id FROM users WHERE lower(email) = lower(vu.email) ORDER BY id LIMIT 1) u ON true
       LEFT JOIN vendor_mfa m ON m.user_id = u.id
      WHERE vu.vendor_id = $1
      ORDER BY (vu.revoked_at IS NOT NULL), vu.granted_at`, [vendorId]);
  return rows.map((r) => ({
    email: r.email, name: r.name, role: r.role, grantedBy: r.granted_by, grantedAt: r.granted_at,
    revokedAt: r.revoked_at, revokedBy: r.revoked_by, graceUntil: r.mfa_grace_until,
    hasAccount: r.has_account, mfa: r.mfa_enrolled ? 'enrolled' : roleNeedsMfa(r.role) ? 'required' : 'off'
  }));
}

/** The owner invites someone. They sign up (or sign in) with this address — no password is shared. */
export async function inviteTeamMember(vendorId, { email, name, role, by }) {
  if (!by) throw new Error('Who is inviting?');
  try {
    return await grantVendorUser(vendorId, { email, name, role, by });
  } catch (e) {
    // Never tell an owner which OTHER vendor an address belongs to.
    if (/different vendor/.test(e.message)) throw new Error('That email address cannot be added to this team.');
    throw e;
  }
}

export const changeTeamRole = (vendorId, email, role, { by }) => changeVendorUserRole(vendorId, email, role, { by });
export const removeTeamMember = (vendorId, email, { by }) => revokeVendorUser(vendorId, email, { by });

/**
 * ADMIN ONLY (the route enforces it; `session` is the admin's, for the audit trail): a team
 * member lost their phone and their recovery codes. Wipes their second factor and signs them
 * out everywhere; they must enrol again. A reason is required, and both the vendor's own event
 * log and the change log record it. Staff (non-admin) have no route to this.
 */
export async function resetMemberMfa(vendorId, mail, { session, reason }) {
  const by = session?.email;
  if (!by) throw new Error('Who is doing this?');
  if (!clean(reason)) throw new Error('Resetting someone\'s two-factor sign-in needs a reason.');
  const e = lc(mail);
  const { rows: member } = await query(
    'SELECT 1 FROM vendor_users WHERE vendor_id = $1 AND lower(email) = $2 LIMIT 1', [vendorId, e]);
  if (!member.length) throw new Error('That person is not on this vendor\'s team.'); // other vendors' users are out of reach
  const { rows: u } = await query('SELECT id FROM users WHERE lower(email) = $1 ORDER BY id LIMIT 1', [e]);
  if (!u.length) throw new Error('That person has not created their account yet — there is nothing to reset.');
  await clearMfa(u[0].id);
  await logVendorEvent(query, vendorId, 'mfa_reset', by, { email: e, reason: clean(reason) });
  await audit(session, {
    action: 'vendor.mfa_reset', entity: 'vendor', entityId: vendorId,
    summary: `Reset two-factor sign-in for ${e}: ${clean(reason)}`.slice(0, 480), detail: { email: e }
  });
  return { ok: true };
}
