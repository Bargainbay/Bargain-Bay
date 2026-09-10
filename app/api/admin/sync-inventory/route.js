import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { syncInventoryFromTracker } from '../../../../lib/catalog-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // the tracker read (copy temp Sheet) can take a few seconds

// Staff, not admin. A rep who has just booked in a vendor drop-off has to be
// able to put it on the site — sending them to find the owner to press a button
// is what keeps stock sitting in the warehouse unlisted. The sync only ever
// COPIES the tracker into the products table: it prices nothing, decides
// nothing, and publishes nothing the tracker doesn't already say is for sale.
async function staff() {
  const s = await getSession();
  return !!(s && isStaff(s));
}

export async function POST() {
  if (!(await staff())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try {
    const result = await syncInventoryFromTracker();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('inventory sync failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Sync failed.' }, { status: 500 });
  }
}
