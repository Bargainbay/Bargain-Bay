import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { syncVesta } from '../../../../lib/vesta';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// "Sync Vesta now" — the same function the daily cron runs.
export async function POST() {
  const session = await getSession();
  if (!session || !isStaff(session)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  try {
    return NextResponse.json({ ok: true, ...(await syncVesta()) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Sync failed' }, { status: 502 });
  }
}
