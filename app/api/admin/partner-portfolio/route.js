// The owner's partner portfolio. ADMIN ONLY: it carries what we owe each partner.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { partnerPortfolio } from '../../../../lib/partner-portfolio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try { return NextResponse.json(await partnerPortfolio()); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
