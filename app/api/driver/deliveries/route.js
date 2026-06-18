import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { isDriver, driverDeliveries } from '../../../../lib/drivers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ deliveries: [] });
  if (!(await isDriver(s))) return NextResponse.json({ error: 'Not a driver account' }, { status: 403 });
  try {
    return NextResponse.json({ deliveries: await driverDeliveries(s.userId) });
  } catch (e) {
    return NextResponse.json({ deliveries: [], error: e?.message || 'Load failed' }, { status: 200 });
  }
}
