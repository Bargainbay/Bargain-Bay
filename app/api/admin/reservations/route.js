import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

export async function DELETE(req) {
  const session = await getSession();
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const sku = String(body.sku || '').trim();
  if (!sku) return NextResponse.json({ error: 'sku required' }, { status: 400 });
  try {
    const { rowCount } = await query('DELETE FROM reservations WHERE sku = $1', [sku]);
    return NextResponse.json({ ok: true, released: rowCount });
  } catch (e) {
    console.error('release reservation failed', e);
    return NextResponse.json({ error: 'Release failed' }, { status: 500 });
  }
}
