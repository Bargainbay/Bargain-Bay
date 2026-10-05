import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { giveawayOverview, drawWinner, resolveWinner } from '../../../../lib/giveaway';
import { GIVEAWAY } from '../../../../lib/deals-config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin only. A draw decides who gets a prize and the entries are customers'
// personal details; neither is a selling-surface permission.
async function admin() {
  const s = await getSession();
  return s && isAdmin(s) ? s : null;
}

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  return NextResponse.json(await giveawayOverview(GIVEAWAY.id));
}

export async function POST(req) {
  const s = await admin();
  if (!s) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (set POSTGRES_URL).' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === 'draw') {
      const r = await drawWinner(GIVEAWAY.id, s.email);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === 'resolve') {
      await resolveWinner(GIVEAWAY.id, Number(body.id), body.outcome, body.note, s.email);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed.' }, { status: 400 });
  }
}
