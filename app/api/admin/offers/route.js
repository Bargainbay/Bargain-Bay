import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { listOffersAdmin, decideOffer, reactivateOffer, openOfferCount, getOfferModes, setOfferMode, OfferError } from '../../../../lib/member-offers';

export const dynamic = 'force-dynamic';

// ADMIN only: the queue shows cost and margin, which sales logins are not allowed to see.
async function gate() {
  const session = await getSession();
  if (!session) return { res: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  if (!isAdmin(session)) return { res: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) };
  if (!hasDb()) return { res: NextResponse.json({ error: 'Database not configured' }, { status: 503 }) };
  return { session };
}

export async function GET(req) {
  const g = await gate(); if (g.res) return g.res;
  const sp = new URL(req.url).searchParams;
  if (sp.get('modes')) return NextResponse.json({ modes: await getOfferModes() });
  if (sp.get('count')) return NextResponse.json({ pending: await openOfferCount() });
  return NextResponse.json({ offers: await listOffersAdmin({ status: sp.get('status') || 'open' }) });
}

export async function POST(req) {
  const g = await gate(); if (g.res) return g.res;
  let b; try { b = await req.json(); } catch { b = {}; }
  if (b.action === 'mode') {
    try { return NextResponse.json(await setOfferMode(b.sku, b.mode || null, g.session)); }
    catch (e) { return NextResponse.json({ error: e.message || 'Could not save.' }, { status: 400 }); }
  }
  const id = Number(b.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Which offer?' }, { status: 400 });
  try {
    if (b.action === 'reactivate') return NextResponse.json(await reactivateOffer(id, g.session));
    return NextResponse.json(await decideOffer(id, b.decision, { price: b.price, note: b.note }, g.session));
  } catch (e) {
    if (e instanceof OfferError) return NextResponse.json({ error: e.message, code: e.code }, { status: 409 });
    return NextResponse.json({ error: 'Could not save that decision.' }, { status: 500 });
  }
}
