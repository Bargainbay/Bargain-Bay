// The team board for RS Ops crew (repair, cleaning, techs). They sign in there by
// PIN and have no account here, so this authenticates with RSOPS_INTAKE_KEY and
// takes the person's NAME, recorded as "<name> (RS Ops)" like the warehouse scan.
// They get General and Warehouse only; the key can never reach Sales or Delivery.
import { NextResponse } from 'next/server';
import { memberFromRsops, handleTeamRequest } from '../../../../lib/team-board';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function run(req, method, body) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return NextResponse.json({ error: 'Team board is not switched on here — set RSOPS_INTAKE_KEY.' }, { status: 503 });
  const sent = req.headers.get('x-rsops-key') || '';
  if (sent.length !== key.length || sent !== key) return NextResponse.json({ error: 'Bad or missing key' }, { status: 401 });
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const name = body?.name || params.name;
  const member = await memberFromRsops(name);
  if (!member) return NextResponse.json({ error: 'Send the name of the person.' }, { status: 400 });
  const r = await handleTeamRequest(member, { method, params, body });
  return NextResponse.json(r.json, { status: r.status });
}

export const GET = (req) => run(req, 'GET');
export async function POST(req) {
  let body; try { body = await req.json(); } catch { body = {}; }
  return run(req, 'POST', body);
}
