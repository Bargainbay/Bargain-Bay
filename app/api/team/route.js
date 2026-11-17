// The team board for anyone signed in here: drivers, staff, dispatch, employees.
// Who they are comes from the session; the body never names a person.
import { NextResponse } from 'next/server';
import { getRequestSession } from '../../../lib/auth';
import { memberFromSession, handleTeamRequest } from '../../../lib/team-board';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function run(req, method, body) {
  const session = await getRequestSession(req);
  const member = await memberFromSession(session);
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const r = await handleTeamRequest(member, { method, params, body });
  return NextResponse.json(r.json, { status: r.status });
}

export const GET = (req) => run(req, 'GET');
export async function POST(req) {
  let body; try { body = await req.json(); } catch { body = {}; }
  return run(req, 'POST', body);
}
