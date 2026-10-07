import { NextResponse } from 'next/server';
import { dispatchAccess } from '../../../../lib/dispatch-access';
import { listBookings, setBookingStatus, convertToTicket } from '../../../../lib/bookings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Dispatch desk surface: admin, the dispatch coordinator, and sales (the same
// people who can put a stop on the board — see lib/dispatch-access.js).
async function gate() {
  const a = await dispatchAccess();
  return a.allowed ? a : null;
}

export async function GET(req) {
  if (!(await gate())) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  const status = new URL(req.url).searchParams.get('status') || 'open';
  try { return NextResponse.json(await listBookings({ status })); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

export async function POST(req) {
  const a = await gate();
  if (!a) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  let body; try { body = await req.json(); } catch { body = {}; }
  const by = { email: a.session.email, name: a.session.name };
  try {
    if (body.action === 'status') { await setBookingStatus(body.id, body.status, by.email); return NextResponse.json({ ok: true }); }
    if (body.action === 'ticket') { const t = await convertToTicket(body.id, by); return NextResponse.json({ ok: true, ticket: t.ticket_number }); }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
