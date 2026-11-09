// A partner's monthly statement as a CSV. The partner comes from the session; an admin may name one with ?as=.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { partnerReport, statementFor, statementCsv } from '../../../../lib/referral-partners';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const url = new URL(req.url);
  const as = url.searchParams.get('as') || '';
  const email = isAdmin(s) && as ? as : s.email;
  const report = await partnerReport(email);
  if (!report.partner) return NextResponse.json({ error: 'Not a referral partner.' }, { status: 403 });
  const st = statementFor(report, url.searchParams.get('month'));
  return new NextResponse(statementCsv(report, st), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="commission-${st.month}.csv"` }
  });
}
