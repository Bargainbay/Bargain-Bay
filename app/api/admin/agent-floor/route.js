// The Agent village's data, and the one thing it can do: wake a job. ADMIN only, the same
// audience as the daily health email it mirrors.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { audit } from '../../../../lib/audit';
import { loadAgentFloor, wakeProblem } from '../../../../lib/agent-floor';
import { wakeAgent } from '../../../../lib/agent-wake';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  const s = await getSession();
  if (!(s && isAdmin(s))) return deny();
  try { return NextResponse.json(await loadAgentFloor()); }
  catch (e) { return NextResponse.json({ error: e?.message || 'Could not read.' }, { status: 500 }); }
}

// { action: 'wake', id }. Runs that job once, now. Logged in the change log with who did it.
export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return deny();
  let b; try { b = await req.json(); } catch { b = {}; }
  if (b?.action !== 'wake' || typeof b.id !== 'string') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  try {
    const before = await loadAgentFloor();
    const agent = before.agents.find((a) => a.id === b.id);
    const problem = wakeProblem({ id: b.id, lastRunAt: agent?.lastRunAt });
    if (!agent || problem) return NextResponse.json({ ok: false, error: problem || 'Unknown agent.' }, { status: 409 });
    const result = await wakeAgent(b.id, new URL(req.url).origin);
    await audit(s, { action: 'agent.wake', entity: 'cron', entityId: b.id, summary: `Woke ${agent.name} by hand: ${result.ok ? 'ran fine' : `failed (${result.error})`}` });
    return NextResponse.json({ ...result, floor: await loadAgentFloor() }, { status: result.ok ? 200 : 502 });
  } catch (e) { return NextResponse.json({ ok: false, error: e?.message || 'Could not wake it.' }, { status: 500 }); }
}
