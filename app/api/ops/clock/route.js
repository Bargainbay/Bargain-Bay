// Clock in / out for the RS Ops crew. The button lives in RS Ops; the hours land
// in staff_shifts here, beside everybody else's, so /admin/team-clock shows both
// companies together.
//
// Machine-to-machine on RSOPS_INTAKE_KEY, like /api/ops/warehouse. The key proves
// the request came from RS Ops, not which person was holding the phone, so the
// name is the one RS Ops took from its own signed-in session. Nobody is on this
// clock unless an admin added them to Team clock as an RS Solutions employee.
import { NextResponse } from 'next/server';
import { hasDb } from '../../../../lib/db';
import { employeeByRsOpsName, openStaffShift, recentStaffShifts, clockIn, clockOut } from '../../../../lib/team-clock';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function keyProblem(req) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return NextResponse.json({ error: 'Clock sync is not switched on here — set RSOPS_INTAKE_KEY.' }, { status: 503 });
  const sent = req.headers.get('x-rsops-key') || '';
  if (sent.length !== key.length || sent !== key) return NextResponse.json({ error: 'Bad or missing key' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (POSTGRES_URL).' }, { status: 503 });
  return null;
}

const view = async (emp) => ({
  employee: true,
  open: await openStaffShift(emp.id),
  recent: (await recentStaffShifts(emp.id, 5)).filter((s) => s.endedAt)
});

export async function GET(req) {
  const problem = keyProblem(req);
  if (problem) return problem;
  try {
    const emp = await employeeByRsOpsName(new URL(req.url).searchParams.get('name'));
    // Not on the list is an answer, not an error: RS Ops hides the button.
    if (!emp) return NextResponse.json({ employee: false });
    return NextResponse.json(await view(emp));
  } catch (e) {
    console.error('ops clock status failed', e);
    return NextResponse.json({ error: 'Could not read the clock.' }, { status: 500 });
  }
}

export async function POST(req) {
  const problem = keyProblem(req);
  if (problem) return problem;
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    const emp = await employeeByRsOpsName(b.name);
    if (!emp) return NextResponse.json({ error: 'The office has not added you to the clock yet.' }, { status: 403 });
    if (b.action === 'in') await clockIn(emp, { ref: b.ref });
    else if (b.action === 'out') await clockOut(emp, { note: b.note });
    else return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    return NextResponse.json(await view(emp));
  } catch (e) {
    console.error('ops clock failed', e);
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 });
  }
}
