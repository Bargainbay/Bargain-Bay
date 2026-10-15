// A vendor's monthly statement, from their own ledger. The vendor id comes from the session.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../lib/vendor-session';
import { monthlyStatement, statementCsv } from '../../../../lib/vendor-ledger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const ctx = await requireVendor('money.view');
  if (!ctx) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  try {
    const st = await monthlyStatement(ctx.vendor.id, sp.get('month'));
    if (sp.get('format') === 'csv') {
      return new NextResponse(statementCsv(st), { headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="statement-${st.month}.csv"`
      } });
    }
    return NextResponse.json(st);
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not build that statement.' }, { status: 400 });
  }
}
