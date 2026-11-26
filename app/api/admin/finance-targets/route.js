// Set the monthly targets on the Financial dashboard. ADMIN only: a target is the owner's decision, and an
// accountant who can read the page does not move it.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { setFinanceTargets } from '../../../../lib/finance-insights';
import { audit } from '../../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  try {
    const targets = await setFinanceTargets(body);
    await audit(s, { action: 'finance.targets', entity: 'settings', entityId: 'finance_targets', summary: 'Monthly targets changed', detail: targets });
    return NextResponse.json({ ok: true, targets });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 400 });
  }
}
