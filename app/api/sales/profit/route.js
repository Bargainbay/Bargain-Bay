// Unit costs and the service list for the live profit panel. The ONLY sales route that
// returns a cost, so it is gated on canSeeCost (admin or the business-development rep)
// and nothing else — a plain sales associate, a customer and a visitor are refused.
import { NextResponse } from 'next/server';
import { getSession, canSeeCost } from '../../../../lib/auth';
import { costsForSkus, listServices } from '../../../../lib/sales-services';
import { getSetting } from '../../../../lib/settings';
import { LOW_PROFIT_DEFAULT } from '../../../../lib/quote-profit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const session = await getSession();
  if (!session || !canSeeCost(session)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({ costs: await costsForSkus(body.skus || []) });
}

export async function GET() {
  const session = await getSession();
  if (!session || !canSeeCost(session)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const threshold = Number(await getSetting('low_profit_threshold', LOW_PROFIT_DEFAULT));
  return NextResponse.json({ services: await listServices(), threshold: Number.isFinite(threshold) ? threshold : LOW_PROFIT_DEFAULT });
}
