// An employee's own clock. Whoever is signed in is looked up by EMAIL in the
// employees table; nothing in the request body says who is clocking, so one
// person cannot clock another in.
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { openQuestion, answerQuestion } from '../../../lib/work-presence';
import { employeeByEmail, openStaffShift, recentStaffShifts, clockIn, clockOut } from '../../../lib/team-clock';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function who() {
  const s = await getSession();
  if (!s || !hasDb()) return { error: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) };
  const employee = await employeeByEmail(s.email);
  if (!employee) {
    return { error: NextResponse.json({ error: `${s.email} isn't on the team list yet. Ask the office to add this email.` }, { status: 403 }) };
  }
  return { employee };
}

export async function GET() {
  const w = await who();
  if (w.error) return w.error;
  const shift = await openStaffShift(w.employee.id);
  return NextResponse.json({
    employee: { name: w.employee.name, roleLabel: w.employee.roleLabel },
    shift,
    question: shift ? await openQuestion('staff', shift.id) : null,
    recent: await recentStaffShifts(w.employee.id)
  });
}

export async function POST(req) {
  const w = await who();
  if (w.error) return w.error;
  let body; try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === 'answer') {
      const open = await openStaffShift(w.employee.id);
      if (open) {
        await answerQuestion('staff', open.id, body.answer);
        if (body.answer === 'no') await clockOut(w.employee, { note: 'Ended after the evening check' });
      }
      const shift = body.answer === 'no' ? null : open;
      return NextResponse.json({ ok: true, shift, question: null, recent: await recentStaffShifts(w.employee.id) });
    }
    const r = body.action === 'out' ? await clockOut(w.employee, body) : body.action === 'in' ? await clockIn(w.employee, body) : null;
    if (!r) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    return NextResponse.json({ ok: true, ...r, recent: await recentStaffShifts(w.employee.id) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That didn\'t work.' }, { status: 400 });
  }
}
