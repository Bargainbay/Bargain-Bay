// Vendors, from the staff side. Onboarding (approve/reject, a staff-role user) is the selling side
// and open to staff; anything about performance, tiers, strikes, commission or the OWNER login is
// the business's decision and admin only. Money (balance, bank) is admin only.
import { NextResponse } from 'next/server';
import { getSession, isStaff, isAdmin } from '../../../../../lib/auth';
import { listVendors, vendorDetail, setTier } from '../../../../../lib/vendor-admin';
import {
  decideApplication, recordIdentityCheck, grantVendorUser, revokeVendorUser, setCommission, issueStrike, reviseStrike,
  markStrikeReviewed, reinstateVendor, strikesAwaitingReview
} from '../../../../../lib/vendors';
import { STRIKE_REASONS } from '../../../../../lib/marketplace-rules';
import { query } from '../../../../../lib/db';
import { notifyApplicantDecision } from '../../../../../lib/vendor-mail';
import { VENDOR_ROLES, VENDOR_ROLE_LABELS } from '../../../../../lib/vendor-permissions';
import { resetMemberMfa } from '../../../../../lib/vendor-team';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return denied();
  const sp = new URL(req.url).searchParams;
  const id = Number(sp.get('id'));
  if (id) {
    const d = await vendorDetail(id, { money: isAdmin(s) });
    return d ? NextResponse.json({ ...d, strikeReasons: STRIKE_REASONS }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (sp.get('view') === 'strike_review') {
    if (!isAdmin(s)) return denied();
    return NextResponse.json({ due: await strikesAwaitingReview() });
  }
  return NextResponse.json({ vendors: await listVendors({ status: sp.get('status') || undefined }) });
}

export async function POST(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return denied();
  let b;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const by = s.email;
  const admin = isAdmin(s);
  const vendorId = Number(b?.vendorId);
  try {
    switch (b?.action) {
      // staff
      case 'approve': {
        const r = await decideApplication(vendorId, { approve: true, by, hstStatus: b.hstStatus });
        // The owner login controls the bank account, so only an admin's approval hands it over. A staff
        // approval stands, and an admin gives access afterwards ("Give access" on the vendor).
        let access = false;
        let accessError = null;
        if (admin) {
          const { rows } = await query('SELECT contact_name, contact_email FROM vendors WHERE id = $1', [vendorId]);
          try {
            await grantVendorUser(vendorId, { email: rows[0]?.contact_email, name: rows[0]?.contact_name, role: 'owner', by });
            access = true;
          } catch (e) { accessError = e?.message || 'Could not give access.'; }
        }
        const mail = await notifyApplicantDecision(vendorId, true, { accessGranted: access });
        return NextResponse.json({ ...r, emailed: mail.ok, access, accessError });
      }
      case 'verify_identity': return NextResponse.json(await recordIdentityCheck(vendorId, { by, registryName: b.registryName, active: b.active === true, note: b.note }));
      case 'reject': {
        const r = await decideApplication(vendorId, { approve: false, by, reason: b.reason });
        return NextResponse.json({ ...r, emailed: (await notifyApplicantDecision(vendorId, false)).ok });
      }
      case 'grant_user': {
        const role = VENDOR_ROLES.includes(b.role) ? b.role : 'viewer';
        if (role === 'owner' && !admin) return NextResponse.json({ error: 'Only an admin can give someone the owner login (it controls the bank account).' }, { status: 403 });
        return NextResponse.json(await grantVendorUser(vendorId, { email: b.email, name: b.name, role, by }));
      }
      case 'revoke_user': return NextResponse.json(await revokeVendorUser(vendorId, b.email, { by }));
      default: break;
    }
    if (!admin) return denied();
    switch (b?.action) {
      // A locked-out team member (lost phone AND recovery codes). ADMIN only, with a reason; audited.
      case 'reset_mfa': return NextResponse.json(await resetMemberMfa(vendorId, b.email, { session: s, reason: b.reason }));
      case 'set_tier': return NextResponse.json(await setTier(vendorId, b.tier, { by, reason: b.reason }));
      case 'set_commission': return NextResponse.json(await setCommission({ vendorId: vendorId || null, rateBps: b.rateBps, effectiveFrom: b.effectiveFrom, by }));
      case 'strike': return NextResponse.json(await issueStrike(vendorId, { reason: b.reason, orderRef: b.orderRef, note: b.note, by }));
      case 'revise_strike': return NextResponse.json(await reviseStrike(Number(b.strikeId), { by, reason: b.reason }));
      case 'keep_strike': return NextResponse.json(await markStrikeReviewed(Number(b.strikeId), { by }));
      case 'reinstate': return NextResponse.json(await reinstateVendor(vendorId, { by, reason: b.reason }));
      default: return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
