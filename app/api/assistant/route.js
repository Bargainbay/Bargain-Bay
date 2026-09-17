// The crew's AI manager — drivers, sales and warehouse staff signed in to this
// app (the web widget) or carrying its session token (the native app, as
// `Authorization: Bearer`). Who they are, and so which tools they get, comes
// from the sign-in alone. See lib/assistant/.
import { NextResponse } from 'next/server';
import { getRequestSession } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { personFromSession } from '../../../lib/assistant/people';
import { readTurn, handleTurn, handleHistory, failure } from '../../../lib/assistant/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function who(req) {
  if (!hasDb()) return { res: NextResponse.json({ error: 'Database not configured.' }, { status: 503 }) };
  const session = await getRequestSession(req);
  if (!session) return { res: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) };
  const channel = req.headers.get('x-assistant-channel') === 'app' ? 'app' : 'web';
  const person = await personFromSession(session, { channel });
  if (!person) return { res: NextResponse.json({ error: 'The assistant is for drivers, sales and warehouse staff.' }, { status: 403 }) };
  return { person };
}

export async function GET(req) {
  try {
    const { person, res } = await who(req);
    if (res) return res;
    return handleHistory(person, new URL(req.url).searchParams.get('threadId'));
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req) {
  try {
    const { person, res } = await who(req);
    if (res) return res;
    return handleTurn(person, await readTurn(req));
  } catch (e) {
    return failure(e);
  }
}
