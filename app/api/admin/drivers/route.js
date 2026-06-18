import { NextResponse } from 'next/server';
import { getSession, isAdmin, validEmail } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { listDrivers, setDriverByEmail } from '../../../../lib/drivers';

export const dynamic = 'force-dynamic';

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ drivers: [] });
  try {
    return NextResponse.json({ drivers: await listDrivers() });
  } catch (e) {
    return NextResponse.json({ drivers: [], error: e?.message || 'Load failed' }, { status: 200 });
  }
}

// Add or remove a driver by email. body: { email, on:boolean }
export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const email = String(body.email || '').trim().toLowerCase();
  if (!validEmail(email)) return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 });
  try {
    const r = await setDriverByEmail(email, body.on !== false);
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 404 });
    return NextResponse.json({ ok: true, user: r.user, drivers: await listDrivers() });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Update failed' }, { status: 500 });
  }
}
