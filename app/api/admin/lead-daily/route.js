// The daily call list's settings. Admin only: it decides whose list leads land on.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { getDailyConfig, saveDailyConfig, assignDailyLeads, poolSize } from '../../../../lib/lead-daily';
import { audit } from '../../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return s && isAdmin(s) ? s : null;
}
const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  if (!(await admin())) return deny();
  return NextResponse.json({ config: await getDailyConfig(), pool: await poolSize().catch(() => 0) });
}

export async function POST(req) {
  const session = await admin();
  if (!session) return deny();
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'save') {
      const config = await saveDailyConfig(body.config || {});
      await audit(session, { action: 'lead_daily.save', entity: 'setting', entityId: 'lead_daily', summary: `Daily call list ${config.enabled ? 'on' : 'off'}: ${config.perRep} each for ${config.reps.length} rep(s)` });
      return NextResponse.json({ config, pool: await poolSize() });
    }
    if (body.action === 'assign-now') return NextResponse.json(await assignDailyLeads());
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That did not work.' }, { status: 400 });
  }
}
