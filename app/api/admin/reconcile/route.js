import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { listSold, markTrackerSynced } from '../../../../lib/catalog-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

// Units sold locally that still need marking Sold in the master tracker.
export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ items: [] });
  try {
    return NextResponse.json({ items: await listSold({ pendingOnly: true }) });
  } catch (e) {
    return NextResponse.json({ items: [], error: e?.message || 'Load failed' }, { status: 200 });
  }
}

// Check units off the list once they've been marked Sold in the tracker.
export async function PATCH(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const skus = Array.isArray(body.skus) ? body.skus : (body.sku ? [body.sku] : []);
  if (!skus.length) return NextResponse.json({ error: 'No SKUs supplied.' }, { status: 400 });
  try {
    const r = await markTrackerSynced(skus);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Update failed' }, { status: 500 });
  }
}
