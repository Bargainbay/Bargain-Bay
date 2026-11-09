// The rep's own numbers: today's tracker and a weekly statement. Read-only, and ALWAYS the signed-in
// person's own — the rep is taken from the session, never from the request, so one rep can never ask
// for another's statement.
import { NextResponse } from 'next/server';
import { requireHub } from '../../../../lib/sales-access';
import { repToday, statementFor, listStatements } from '../../../../lib/sales-commission';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const v = await requireHub();
  if (!v) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const url = new URL(req.url);
  if (url.searchParams.get('view') === 'week') {
    return NextResponse.json({ statement: await statementFor(v.email, url.searchParams.get('week') || ''), history: await listStatements(v.email) });
  }
  return NextResponse.json({ today: await repToday(v.email) });
}
