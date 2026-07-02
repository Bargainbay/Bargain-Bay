import { NextResponse } from 'next/server';
import { executeTool } from '../../../../lib/agent-tools';
import { getAll } from '../../../../lib/inventory';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Diagnostic: run Sarah's exact search_inventory tool for ?q= and also report
// whether the units exist in the live catalog at all. Secret-gated.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  const q = new URL(req.url).searchParams.get('q') || 'blomberg';
  try {
    const search = await executeTool('search_inventory', { query: q }, {});
    const all = await getAll();
    const inCatalog = all.filter((u) => `${u.make || ''} ${u.model || ''} ${u.title || ''} ${u.id || ''}`.toLowerCase().includes(q.toLowerCase()))
      .map((u) => ({ sku: u.id, make: u.make, model: u.model, price: u.price }));
    return NextResponse.json({ ok: true, query: q, catalogSize: all.length, inCatalog, sarahSearch: search });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
