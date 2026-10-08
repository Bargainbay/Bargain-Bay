// Staff, not admin: this is what a rep does with a customer on the phone.
// Nothing here is cost-derived, and nothing here sends anything.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { abandonedCarts, raiseAbandonedCartTasks, DEFAULT_QUIET_HOURS } from '../../../../lib/abandoned-carts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const hours = Number(new URL(req.url).searchParams.get('hours')) || DEFAULT_QUIET_HOURS;
  // Raising is idempotent, so the first rep to open the dashboard after a cart
  // goes quiet is what puts it on everyone's list — no waiting for the nightly.
  await raiseAbandonedCartTasks({ hours }).catch(() => {});
  return NextResponse.json({ hours, carts: await abandonedCarts({ hours }) });
}
