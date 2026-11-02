// The Agent Floor's data: what every scheduled job and assistant last did. ADMIN only,
// the same audience as the daily health email it mirrors.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { loadAgentFloor } from '../../../../lib/agent-floor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try { return NextResponse.json(await loadAgentFloor()); }
  catch (e) { return NextResponse.json({ error: e?.message || 'Could not read.' }, { status: 500 }); }
}
