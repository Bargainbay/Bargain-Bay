// Rep holds: hold a unit for a customer for up to 48 hours, and let go of it.
// Identity is the session; a rep can only release their own, an admin any.
import { NextResponse } from 'next/server';
import { requireHub } from '../../../../lib/sales-access';
import { holdForRep, releaseRepHold, listRepHolds, HoldError } from '../../../../lib/rep-holds';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const fail = (e) => {
  if (e instanceof HoldError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.code === 'notfound' ? 404 : 400 });
  console.error('sales holds failed', e.message);
  return NextResponse.json({ error: 'That did not work.' }, { status: 500 });
};

export async function GET() {
  const viewer = await requireHub();
  if (!viewer) return deny();
  return NextResponse.json({ holds: await listRepHolds(viewer) });
}

export async function POST(req) {
  const viewer = await requireHub();
  if (!viewer) return deny();
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'hold') return NextResponse.json(await holdForRep(body.sku, { hours: body.hours, note: body.note }, viewer));
    if (body.action === 'release') return NextResponse.json(await releaseRepHold(body.sku, viewer));
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) { return fail(e); }
}
