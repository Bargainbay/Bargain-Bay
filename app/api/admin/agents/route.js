// The agent roster + autonomy dial. Admin-only. GET returns every agent with its
// current autonomy level; POST { agentKey, level } moves one agent's dial.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { listAgents, getAgent } from '../../../../lib/agents/registry';
import { getAutonomyMap, setAutonomy, AUTONOMY_LEVELS } from '../../../../lib/agents/autonomy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const agents = listAgents();
  let autonomy = {};
  try { autonomy = await getAutonomyMap(agents); } catch { /* defaults below */ }
  return NextResponse.json({
    levels: AUTONOMY_LEVELS,
    agents: agents.map((a) => ({ ...a, autonomy: autonomy[a.key] || a.defaultAutonomy }))
  });
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const agentKey = getAgent(body.agentKey).key;
  if (!body.agentKey || agentKey !== String(body.agentKey)) {
    return NextResponse.json({ error: 'Unknown agent.' }, { status: 400 });
  }
  try {
    const level = await setAutonomy(agentKey, body.level);
    return NextResponse.json({ ok: true, agentKey, level });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not update autonomy.' }, { status: 400 });
  }
}
