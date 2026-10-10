import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { isDriver } from '../../../../lib/drivers';
import { startShift, endShift, openShift, listVehicles } from '../../../../lib/shifts';
import { listDrivers } from '../../../../lib/drivers';
import { openQuestion, answerQuestion } from '../../../../lib/work-presence';

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
    // Names only — enough to say who they're riding with, and nothing a driver
    // couldn't already read off the "2 crew" line on a shared stop.
    const mates = (await listDrivers())
      .filter((d) => d.id !== s.userId)
      .map((d) => ({ id: d.id, name: d.name || d.email }));
    const shift = await openShift(s.userId);
    return NextResponse.json({
      shift, vehicles: await listVehicles(), mates,
      question: shift ? await openQuestion('driver', shift.id) : null
    });
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
    if (body.action === 'answer') {
      // 'no' only records the answer: ending a shift needs the odometer, and
      // the app moves them straight onto the End shift form.
      const open = await openShift(s.userId);
      if (open) await answerQuestion('driver', open.id, body.answer);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'end') {
      return NextResponse.json({ ok: true, shift: await endShift(s.userId, body) });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That didn\'t work.' }, { status: 400 });
  }
}
