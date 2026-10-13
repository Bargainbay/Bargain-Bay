// "Check now": the same pass the schedule runs, on demand, for the owner. It
// fixes what it can (marks units with money paid as Sold, fills costs from the
// tracker) and returns what is left. ADMIN: it can write to the tracker.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { runSaleIntegrity } from '../../../../lib/sale-integrity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try { return NextResponse.json({ ok: true, ...(await runSaleIntegrity()) }); }
  catch (e) { return NextResponse.json({ error: e?.message || 'The check failed.' }, { status: 500 }); }
}
