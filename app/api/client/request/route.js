import { NextResponse } from 'next/server';
import { createClientRequest } from '../../../../lib/client-portal';
import { portalAccess } from '../../../../lib/client-portal-session';

export const dynamic = 'force-dynamic';

// A client adds a delivery to their own list. The token proves which company is
// asking; the stop lands unscheduled on the dispatch board for staff to assign.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  if ((await portalAccess(body?.c, body?.t)) !== 'ok') return NextResponse.json({ error: 'This link is not valid.' }, { status: 403 });
  try {
    const r = await createClientRequest(body.c, body);
    return NextResponse.json({ ok: true, jobNumber: r.jobNumber });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Could not add that delivery.' }, { status: 400 });
  }
}
