import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { listCoupons, saveCoupon, setCouponActive, deleteCoupon, affiliateReport } from '../../../../lib/coupons';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Coupons decide what the storefront charges, so this stays ADMIN — not staff.
// (The gate rule: isStaff is only for the three selling surfaces plus dispatch.)
async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

function noDb() {
  return NextResponse.json({ error: 'Database not configured (set POSTGRES_URL).' }, { status: 503 });
}

export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ coupons: [], affiliates: [] });
  const sp = new URL(req.url).searchParams;
  try {
    const [coupons, affiliates] = await Promise.all([
      listCoupons(),
      affiliateReport({ from: sp.get('from') || null, to: sp.get('to') || null })
    ]);
    return NextResponse.json({ coupons, affiliates });
  } catch (e) {
    return NextResponse.json({ coupons: [], affiliates: [], error: e?.message || 'Could not load coupons.' }, { status: 200 });
  }
}

// Create or update (an `id` in the body means update).
export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();
  let body;
  try { body = await req.json(); } catch { body = {}; }
  try {
    const coupon = await saveCoupon(body);
    return NextResponse.json({ ok: true, coupon });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save that coupon.' }, { status: 400 });
  }
}

// Switch a coupon on or off. Turning one off is the normal way to retire it —
// the affiliate's history stays intact.
export async function PATCH(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const id = parseInt(body.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  try {
    const coupon = await setCouponActive(id, !!body.active);
    return NextResponse.json({ ok: true, coupon });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not update that coupon.' }, { status: 400 });
  }
}

// Delete a coupon that was never used; one that has been redeemed is switched
// off instead, so nobody can erase an affiliate's numbers by tidying up.
export async function DELETE(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const id = parseInt(body.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  try {
    const r = await deleteCoupon(id);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not delete that coupon.' }, { status: 400 });
  }
}
