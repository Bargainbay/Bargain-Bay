// Who is on the team, what they are paid, and fixing a forgotten clock-out.
// ADMIN only: an hourly rate is pay.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { saveEmployee, endEmployee, fixStaffShift } from '../../../../lib/team-clock';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    if (b.action === 'save_employee') return NextResponse.json({ ok: true, employee: await saveEmployee(b, s.email) });
    if (b.action === 'end_employee') return NextResponse.json({ ok: true, done: await endEmployee(Number(b.id)) });
    if (b.action === 'fix_shift') return NextResponse.json({ ok: true, shift: await fixStaffShift(Number(b.id), b, s.email) });
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That didn\'t work.' }, { status: 400 });
  }
}
