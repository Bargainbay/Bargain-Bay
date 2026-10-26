// Affiliates: applications, approval, the code, and the commission they are owed.
// ADMIN - it sets what the storefront gives away and what we pay out.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { listAffiliates, affiliateDetail, approveAffiliate, setAffiliateStatus, recordPayout } from '../../../../lib/affiliates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() { const s = await getSession(); return s && isAdmin(s) ? s : null; }

export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (Number.isInteger(id) && id > 0) return NextResponse.json((await affiliateDetail(id)) || { error: 'Not found' });
    return NextResponse.json({ affiliates: await listAffiliates() });
  } catch (e) { return NextResponse.json({ error: e?.message || 'Could not load.' }, { status: 500 }); }
}

export async function POST(req) {
  const s = await admin();
  if (!s) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Which affiliate?' }, { status: 400 });
  try {
    if (b.action === 'approve') return NextResponse.json({ ok: true, affiliate: await approveAffiliate(id, b, s) });
    if (['suspend', 'reinstate', 'reject'].includes(b.action)) return NextResponse.json({ ok: true, affiliate: await setAffiliateStatus(id, b.action, s) });
    if (b.action === 'payout') return NextResponse.json({ ok: true, ...(await recordPayout(id, b, s)) });
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 400 }); }
}
