// Read / write owner settings (revenue goal, opening cash, etc.). Admin-only.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { getSetting, setSetting } from '../../../../lib/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const key = new URL(req.url).searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });
  return NextResponse.json({ value: await getSetting(key, null) });
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const key = String(body.key || '').trim();
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 });
  try {
    await setSetting(key, body.value);
    return NextResponse.json({ ok: true, value: body.value });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 500 });
  }
}
