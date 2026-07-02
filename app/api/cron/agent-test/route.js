import { NextResponse } from 'next/server';
import { runAgent } from '../../../../lib/sarah';
import { executeTool } from '../../../../lib/agent-tools';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Temporary: reproduce Sarah's ACTUAL agent behaviour (sales agent, admin context)
// for a prompt, so we can see which tools she calls + what she replies — vs the
// raw tool result. Secret-gated.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  const q = new URL(req.url).searchParams.get('q') || 'Do we have any Blomberg in stock? Give me the SKUs.';
  try {
    const directSearch = await executeTool('search_inventory', { query: 'blomberg' }, {});
    // readOnly:true — only lookup tools are exposed (no writes). This is a lookup
    // diagnostic; never expose the write-capable agent on an open endpoint.
    const agent = await runAgent({ agentKey: 'sales', messages: [{ role: 'user', content: q }], readOnly: true });
    return NextResponse.json({
      ok: true,
      directSearchCount: directSearch?.count ?? directSearch,
      agentReply: agent?.reply,
      agentActions: agent?.actions,
      stopReason: agent?.stopReason
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}
export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
