// Booking requests, worked from RS Ops (ops.rssolutions.ca).
//
// The requests live HERE (lib/bookings.js) because the service tickets they
// become and the dispatch board those go on are here. RS Ops reads and answers
// them through this route — same shape and same shared key (RSOPS_INTAKE_KEY) as
// /api/ops/parts and /api/ops/warehouse.
//
// The name arrives in the body and is recorded as "<name> (RS Ops)": the key
// proves the request came from RS Ops, not which person was holding the phone.
import { NextResponse } from 'next/server';
import { hasDb } from '../../../../lib/db';
import { listBookings, setBookingStatus, convertToTicket } from '../../../../lib/bookings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function keyProblem(req) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return NextResponse.json({ error: 'Bookings are not switched on here — set RSOPS_INTAKE_KEY.' }, { status: 503 });
  const sent = req.headers.get('x-rsops-key') || '';
  if (sent.length !== key.length || sent !== key) return NextResponse.json({ error: 'Bad or missing key' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (POSTGRES_URL).' }, { status: 503 });
  return null;
}

export async function GET(req) {
  const problem = keyProblem(req);
  if (problem) return problem;
  const status = new URL(req.url).searchParams.get('status') || 'open';
  try { return NextResponse.json(await listBookings({ status })); }
  catch (e) { console.error('ops bookings list failed', e); return NextResponse.json({ error: 'Could not load bookings.' }, { status: 500 }); }
}

export async function POST(req) {
  const problem = keyProblem(req);
  if (problem) return problem;
  let body; try { body = await req.json(); } catch { body = {}; }
  const who = String(body.by || '').trim().slice(0, 80) || 'RS Ops';
  const by = { email: `${who} (RS Ops)`, name: `${who} (RS Ops)` };
  try {
    if (body.action === 'status') { await setBookingStatus(body.id, body.status, by.email); return NextResponse.json({ ok: true }); }
    if (body.action === 'ticket') { const t = await convertToTicket(body.id, by); return NextResponse.json({ ok: true, ticket: t.ticket_number }); }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
