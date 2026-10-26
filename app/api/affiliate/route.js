// An affiliate's own dashboard data, and the application itself. Everything is
// keyed on the signed-in account; no id or email is ever taken from the request.
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { dashboardFor, applyAsAffiliate, setPayoutEmail } from '../../../lib/affiliates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  try { return NextResponse.json(await dashboardFor(s)); }
  catch (e) { return NextResponse.json({ error: e?.message || 'Could not load.' }, { status: 500 }); }
}

export async function POST(req) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  let body; try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === 'payout_email') {
      await setPayoutEmail(s, body.payoutEmail);
      return NextResponse.json({ ok: true });
    }
    // Honeypot, same as signup/checkout: a bot fills the invisible field.
    if (body.website) return NextResponse.json({ ok: true });
    const r = await applyAsAffiliate(s, body);
    return NextResponse.json({ ok: true, status: r.affiliate.status, created: r.created });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 400 });
  }
}
