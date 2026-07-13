// Public "Accept quote" endpoint for the hosted quote page. Authorization is
// the same proof the page itself accepts: the tokenized link (?t=) from the
// quote email, or knowing the email on the quote. No stock moves here — the
// owner still converts to an invoice to commit units.
import { NextResponse } from 'next/server';
import { hasDb, query } from '../../../lib/db';
import { verifyLinkToken } from '../../../lib/links';
import { acceptQuote } from '../../../lib/quotes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  if (!hasDb()) return NextResponse.json({ error: 'Quotes are unavailable right now.' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const number = String(body.number || '').trim();
  if (!number) return NextResponse.json({ error: 'Missing quote number.' }, { status: 400 });

  const byToken = verifyLinkToken('quote', number, body.t);
  let byEmail = false;
  if (!byToken && body.email) {
    const { rows } = await query('SELECT 1 FROM quotes WHERE number = $1 AND lower(email) = lower($2)', [number, String(body.email).trim()]);
    byEmail = rows.length > 0;
  }
  if (!byToken && !byEmail) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });

  try {
    const result = await acceptQuote(number);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not accept the quote.' }, { status: 400 });
  }
}
