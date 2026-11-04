import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { listStoreCredits, storeCreditHistory, storeCreditOutstanding } from '../../../../lib/store-credit';

export const dynamic = 'force-dynamic';

// A code is spendable money, so reading the list is admin-only. Staff still issue
// credit (refund screen) and apply it (invoice), which show the one code involved.
export async function GET(req) {
  const session = await getSession();
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (code) return NextResponse.json({ history: await storeCreditHistory(code) });
  return NextResponse.json({
    outstanding: await storeCreditOutstanding(),
    credits: await listStoreCredits({ q: url.searchParams.get('q') || '' })
  });
}
