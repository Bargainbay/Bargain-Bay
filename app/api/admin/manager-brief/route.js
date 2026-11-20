// The Manager's morning brief as JSON. ADMIN only: it carries margin figures.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { buildMorningBrief } from '../../../../lib/manager-brief';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try { return NextResponse.json(await buildMorningBrief()); }
  catch (e) { return NextResponse.json({ error: e?.message || 'Could not build the brief.' }, { status: 500 }); }
}
