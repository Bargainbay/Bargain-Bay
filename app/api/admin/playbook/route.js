// Load / save the company playbook (Sarah's training). Admin-only.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { getPlaybook, setPlaybook } from '../../../../lib/playbook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const dept = new URL(req.url).searchParams.get('dept') || undefined;
  try {
    return NextResponse.json({ content: await getPlaybook({ fresh: true, dept }) });
  } catch (e) {
    return NextResponse.json({ content: '', error: e?.message || 'Could not load.' });
  }
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  try {
    await setPlaybook(String(body.content || ''), { dept: body.dept || undefined });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save the playbook.' }, { status: 500 });
  }
}
