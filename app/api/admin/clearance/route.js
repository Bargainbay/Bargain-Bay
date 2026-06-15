import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { listClearanceAdmin, searchCatalog, upsertClearance, removeClearance } from '../../../../lib/clearance';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getSession();
  if (!session || !isAdmin(session)) return false;
  return true;
}

// GET ?q=term  -> catalog search;  GET (no q) -> current clearance rows
export async function GET(req) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const q = new URL(req.url).searchParams.get('q');
  if (q) return NextResponse.json({ results: searchCatalog(q) });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  try {
    return NextResponse.json({ items: await listClearanceAdmin() });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST { sku, price, warrantyMonths, note, active } -> upsert
export async function POST(req) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body; try { body = await req.json(); } catch { body = {}; }
  const sku = String(body.sku || '').trim();
  const price = Number(body.price);
  if (!sku) return NextResponse.json({ error: 'sku required' }, { status: 400 });
  if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: 'valid price required' }, { status: 400 });
  try {
    await upsertClearance({ sku, price, warrantyMonths: body.warrantyMonths, note: body.note, active: body.active });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE { sku } -> remove markdown
export async function DELETE(req) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body; try { body = await req.json(); } catch { body = {}; }
  const sku = String(body.sku || '').trim();
  if (!sku) return NextResponse.json({ error: 'sku required' }, { status: 400 });
  try {
    const removed = await removeClearance(sku);
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
