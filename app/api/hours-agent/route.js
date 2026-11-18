// A narrow, revocable key for the AI manager (RS Manager / Claude) to read and fix
// WORKING HOURS without the owner's two-step sign-in.
//
// WHY IT IS NOT UNDER /api/admin: the admin two-factor gate (proxy.js) stands in front of
// every /api/admin route, and the owner does not want hours to wait on their phone. But a
// second way into ADMIN would defeat the second factor, so this is not one. The key can do
// exactly three things and nothing else: read the hours report, add a missing shift, and
// correct a shift's times. It cannot reach pay rates, payroll payments, invoices, orders,
// the bank, or any other admin action.
//
// Off until HOURS_AGENT_KEY is set (>= 32 chars). Unset the variable to revoke it. Every
// write is an audit_log row ("hours-agent") and the shift itself records who edited it.
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { hasDb } from '../../../lib/db';
import { createShift, setShiftTimes } from '../../../lib/shifts';
import { hoursReport, presetRange } from '../../../lib/hours';
import { audit } from '../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ACTOR = { email: 'hours-agent', name: 'AI manager (hours key)' };

function keyOk(req) {
  const key = process.env.HOURS_AGENT_KEY || '';
  if (key.length < 32) return false;
  const sent = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(sent).digest();
  const b = crypto.createHash('sha256').update(key).digest();
  return crypto.timingSafeEqual(a, b);
}
const refuse = () => (((process.env.HOURS_AGENT_KEY || '').length < 32)
  ? NextResponse.json({ error: 'Not switched on — set HOURS_AGENT_KEY (32+ characters).' }, { status: 503 })
  : NextResponse.json({ error: 'Bad or missing key' }, { status: 401 }));

export async function GET(req) {
  if (!keyOk(req)) return refuse();
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  const sp = new URL(req.url).searchParams;
  const range = presetRange(sp.get('range')) || { from: sp.get('from') || undefined, to: sp.get('to') || undefined };
  return NextResponse.json(await hoursReport(range));
}

export async function POST(req) {
  if (!keyOk(req)) return refuse();
  let body; try { body = await req.json(); } catch { body = {}; }
  const by = ACTOR.name;
  try {
    if (body.action === 'shift_create') {
      const shift = await createShift(body, by);
      await audit(ACTOR, { action: 'shift.create', entity: 'driver_shift', entityId: shift?.id,
        summary: `Added a shift for driver ${body.driverId} on ${body.date}`, detail: { body } });
      return NextResponse.json({ ok: true, shift });
    }
    if (body.action === 'shift_times') {
      const shift = await setShiftTimes(body.shiftId, body, by);
      await audit(ACTOR, { action: 'shift.times', entity: 'driver_shift', entityId: body.shiftId,
        summary: `Corrected the times on shift ${body.shiftId}`, detail: { body } });
      return NextResponse.json({ ok: true, shift });
    }
    return NextResponse.json({ error: 'Only shift_create and shift_times are allowed here.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not do that.' }, { status: 400 });
  }
}
