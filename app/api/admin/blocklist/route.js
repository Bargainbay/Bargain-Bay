import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';
import { listBlocklist, addToBlocklist, removeFromBlocklist, ensureAbuseSchema } from '../../../../lib/antifraud';

export const dynamic = 'force-dynamic';

async function gate() {
  const session = await getSession();
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  return null;
}

export async function GET() {
  const bad = await gate();
  if (bad) return bad;
  return NextResponse.json({ entries: await listBlocklist() });
}

// Add a block entry. `cancelOrders: true` also does the cleanup the owner
// actually wants in one click: cancel every unpaid order matching the value and
// relist its units. Reuses the same cancel+release path as the order board, so
// there is exactly one way a reservation gets freed.
export async function POST(req) {
  const bad = await gate();
  if (bad) return bad;
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const kind = String(body.kind || '');
  const value = String(body.value || '').trim();
  if (!['email', 'domain', 'ip', 'phone'].includes(kind)) {
    return NextResponse.json({ error: 'kind must be one of email, domain, ip, phone' }, { status: 400 });
  }
  if (!value) return NextResponse.json({ error: 'A value is required.' }, { status: 400 });

  try {
    const entry = await addToBlocklist(kind, value, body.note || null);
    let cancelled = 0;
    if (body.cancelOrders) cancelled = await cancelUnpaidMatching(kind, value);
    return NextResponse.json({ entry, cancelledOrders: cancelled });
  } catch (e) {
    console.error('blocklist add failed', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const bad = await gate();
  if (bad) return bad;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  return NextResponse.json({ ok: await removeFromBlocklist(id) });
}

// Cancel every still-unpaid order matching this identifier and free its units.
// Scoped to 'pending_payment' on purpose: a confirmed/delivered order is real
// money and real stock movement, and must never be swept by a block action.
async function cancelUnpaidMatching(kind, value) {
  await ensureAbuseSchema();
  const v = kind === 'phone' ? String(value).replace(/\D/g, '') : String(value).trim().toLowerCase();
  const where = {
    email: "lower(email) = $1",
    domain: "lower(email) LIKE '%@' || $1",
    ip: "ip = $1",
    phone: "regexp_replace(coalesce(phone,''), '\\D', '', 'g') = $1"
  }[kind];
  const { rows } = await query(
    `UPDATE orders SET status = 'cancelled'
      WHERE status = 'pending_payment' AND ${where}
      RETURNING id`,
    [v]
  );
  if (rows.length) {
    await query('DELETE FROM reservations WHERE order_id = ANY($1)', [rows.map((r) => r.id)]);
  }
  return rows.length;
}
