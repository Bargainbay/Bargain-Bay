import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { isDriver } from '../../../../lib/drivers';
import { startShift, endShift, openShift, listVehicles } from '../../../../lib/shifts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function driver() {
  const s = await getSession();
  if (!s || !hasDb()) return null;
  return (await isDriver(s)) ? s : null;
}
const nope = () => NextResponse.json({ error: 'Not a driver account.' }, { status: 403 });

export async function GET() {
  const s = await driver();
  if (!s) return nope();
  try {
    return NextResponse.json({ shift: await openShift(s.userId), vehicles: await listVehicles() });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not load that.' }, { status: 400 });
  }
}

// Clocking on and off. PATCH rather than POST so it rides the offline queue's
// JSON path — a driver who starts in an underground loading bay must not have
// to find signal before their day begins.
export async function PATCH(req) {
  const s = await driver();
  if (!s) return nope();
  let body;
  try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === 'start') {
      return NextResponse.json({ ok: true, shift: await startShift(s.userId, body) });
    }
    if (body.action === 'end') {
      return NextResponse.json({ ok: true, shift: await endShift(s.userId, body) });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That didn\'t work.' }, { status: 400 });
  }
}
