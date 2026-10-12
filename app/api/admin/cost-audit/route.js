// READ-ONLY report of sold units costed at $0 while the product has a real cost.
// ADMIN only: it exposes cost.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { zeroCostLines } from '../../../../lib/cost-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try { return NextResponse.json(await zeroCostLines()); }
  catch (e) { return NextResponse.json({ error: e?.message || 'Could not read.' }, { status: 500 }); }
}
