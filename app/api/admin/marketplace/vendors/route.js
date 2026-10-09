// Vendors, from the staff side. Onboarding (approve/reject, a staff-role user) is the selling side
// and open to staff; anything about performance, tiers, strikes, commission or the OWNER login is
// the business's decision and admin only. Money (balance, bank) is admin only.
import { NextResponse } from 'next/server';
import { getSession, isStaff, isAdmin } from '../../../../../lib/auth';
import { listVendors, vendorDetail, setTier } from '../../../../../lib/vendor-admin';
import {
  decideApplication, grantVendorUser, revokeVendorUser, setCommission, issueStrike, reviseStrike,
  markStrikeReviewed, reinstateVendor, strikesAwaitingReview
} from '../../../../../lib/vendors';
import { STRIKE_REASONS } from '../../../../../lib/marketplace-rules';

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
      case 'approve': return NextResponse.json(await decideApplication(vendorId, { approve: true, by, hstStatus: b.hstStatus }));
      case 'reject': return NextResponse.json(await decideApplication(vendorId, { approve: false, by, reason: b.reason }));
      case 'grant_user': {
        const role = b.role === 'owner' ? 'owner' : 'staff';
        if (role === 'owner' && !admin) return NextResponse.json({ error: 'Only an admin can give someone the owner login (it controls the bank account).' }, { status: 403 });
        return NextResponse.json(await grantVendorUser(vendorId, { email: b.email, name: b.name, role, by }));
      }
      case 'revoke_user': return NextResponse.json(await revokeVendorUser(vendorId, b.email, { by }));
      default: break;
    }
    if (!admin) return denied();
    switch (b?.action) {
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
