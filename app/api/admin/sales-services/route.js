// The service catalog editor's API. ADMIN ONLY: a service's internal cost is what the
// business pays, and the prices here are what reps quote from.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { listServices, saveService, addStarterServices } from '../../../../lib/sales-services';
import { getSetting, setSetting } from '../../../../lib/settings';
import { LOW_PROFIT_DEFAULT } from '../../../../lib/quote-profit';
import { audit } from '../../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const admin = async () => { const s = await getSession(); return s && isAdmin(s) ? s : null; };

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const threshold = Number(await getSetting('low_profit_threshold', LOW_PROFIT_DEFAULT));
  return NextResponse.json({ services: await listServices({ includeInactive: true }), threshold });
}

export async function POST(req) {
  const session = await admin();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'starter') {
      const r = await addStarterServices();
      await audit(session, { action: 'sales.services.starter', entity: 'services', summary: `Added ${r.added} starter services` });
      return NextResponse.json(r);
    }
    if (body.action === 'threshold') {
      const n = Number(body.value);
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'Enter a dollar amount.' }, { status: 400 });
      await setSetting('low_profit_threshold', n);
      await audit(session, { action: 'sales.profit.threshold', entity: 'settings', summary: `Low-profit line set to $${n}` });
      return NextResponse.json({ ok: true });
    }
    const r = await saveService(body.service || {});
    await audit(session, { action: 'sales.services.save', entity: 'services', entityId: r.id, summary: `Saved service ${body.service?.name || r.id}` });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e.message || 'That did not work.' }, { status: 400 });
  }
}
