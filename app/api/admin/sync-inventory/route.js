import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { syncInventoryFromTracker } from '../../../../lib/catalog-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // the tracker read (copy temp Sheet) can take a few seconds

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

export async function POST() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try {
    const result = await syncInventoryFromTracker();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('inventory sync failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Sync failed.' }, { status: 500 });
  }
}
