// The rep's shop clock: clock in when you start the day at the shop, clock out when you leave.
// A day with a shop clock-in is an In-house Day. Identity is the session, never the body.
import { NextResponse } from 'next/server';
import { requireHub } from '../../../../lib/sales-access';
import { openShift, clockIn, clockOut, recentShifts, CommissionError } from '../../../../lib/sales-commission';
import { employeeByEmail, openStaffShift, clockIn as staffClockIn, clockOut as staffClockOut } from '../../../../lib/team-clock';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const fail = (e) => {
  if (e instanceof CommissionError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
  console.error('sales clock failed', e.message);
  return NextResponse.json({ error: 'That did not work.' }, { status: 500 });
};

export async function GET() {
  const v = await requireHub();
  if (!v) return deny();
  return NextResponse.json({ open: await openShift(v.email), recent: await recentShifts(v.email, 14) });
}

// The shop clock is for commission days only; PAY comes from the staff clock (/clock, staff_shifts).
// A rep who is on the team list is clocked in/out on both with one tap. A failure on the pay
// clock never fails the shop clock, but it is SAID, because a silent miss is an unpaid shift.
async function payClock(email, action) {
  try {
    const emp = await employeeByEmail(email);
    if (!emp) return { status: 'not-on-team-list', note: 'Not on the team list, so no pay hours were recorded. Ask the office.' };
    if (action === 'in') {
      const r = await staffClockIn(emp, { ref: 'sales-hub' });
      return { status: r.already ? 'already' : 'clocked' };
    }
    if (!(await openStaffShift(emp.id))) return { status: 'none-open' };
    await staffClockOut(emp);
    return { status: 'clocked' };
  } catch (e) {
    console.error('sales clock: pay clock failed', e.message);
    return { status: 'failed', note: String(e.message || '').slice(0, 200) || 'The pay clock did not update.' };
  }
}

export async function POST(req) {
  const v = await requireHub();
  if (!v) return deny();
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'in') {
      let shift = null;
      try { shift = await clockIn(v.email); } catch (e) { if (!(e instanceof CommissionError && e.code === 'open')) throw e; }
      // Already at the shop is fine: still make sure the pay clock is running.
      return NextResponse.json({ ok: true, shift, pay: await payClock(v.email, 'in') });
    }
    if (body.action === 'out') {
      let shift = null;
      try { shift = await clockOut(v.email); } catch (e) { if (!(e instanceof CommissionError && e.code === 'closed')) throw e; }
      return NextResponse.json({ ok: true, shift, pay: await payClock(v.email, 'out') });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) { return fail(e); }
}
