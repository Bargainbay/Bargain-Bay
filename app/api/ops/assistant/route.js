// The assistant for the RS Ops crew. RS Ops signs people in by PIN and they have
// no account here, so — like /api/ops/warehouse — RS Ops authenticates with
// RSOPS_INTAKE_KEY and names the person in the request (`name`, `role`). They get
// the warehouse team's tools only: spots, units, parts, repair walkthroughs.
import { NextResponse } from 'next/server';
import { hasDb } from '../../../../lib/db';
import { personFromRsops } from '../../../../lib/assistant/people';
import { readTurn, handleTurn, handleHistory, failure } from '../../../../lib/assistant/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function keyProblem(req) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return NextResponse.json({ error: 'RS Ops is not connected here — set RSOPS_INTAKE_KEY.' }, { status: 503 });
  const sent = req.headers.get('x-rsops-key') || '';
  if (sent.length !== key.length || sent !== key) return NextResponse.json({ error: 'Bad or missing key' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (POSTGRES_URL).' }, { status: 503 });
  return null;
}

export async function GET(req) {
  const bad = keyProblem(req);
  if (bad) return bad;
  try {
    const url = new URL(req.url);
    const person = personFromRsops({ name: url.searchParams.get('name'), role: url.searchParams.get('role') });
    if (!person) return NextResponse.json({ error: 'Say who is asking (name).' }, { status: 400 });
    return handleHistory(person, url.searchParams.get('threadId'));
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req) {
  const bad = keyProblem(req);
  if (bad) return bad;
  try {
    const turn = await readTurn(req);
    const person = personFromRsops({ name: turn.name, role: turn.role });
    if (!person) return NextResponse.json({ error: 'Say who is asking (name).' }, { status: 400 });
    return handleTurn(person, turn);
  } catch (e) {
    return failure(e);
  }
}
