import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { giveawayOverview, drawWinner, resolveWinner, reviewVideo, reviewCostume, setBestCostume, clearBestCostume, entriesCsv } from '../../../../lib/giveaway';
import { GIVEAWAY, GIVEAWAYS } from '../../../../lib/deals-config';

// Which giveaway a request is about: the live one unless it names another we
// know. An unknown id is the live one, never a free-text table key.
const pick = (id) => (GIVEAWAYS[id] || GIVEAWAY).id;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin only. A draw decides who gets a prize and the entries are customers'
// personal details; neither is a selling-surface permission.
async function admin() {
  const s = await getSession();
  return s && isAdmin(s) ? s : null;
}

export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const gid = pick(sp.get('g'));
  const o = await giveawayOverview(gid);
  if (sp.get('format') === 'csv') {
    return new Response(entriesCsv(o.entries), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${gid}-entries.csv"`,
        'Cache-Control': 'private, no-store'
      }
    });
  }
  return NextResponse.json(o);
}

export async function POST(req) {
  const s = await admin();
  if (!s) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (set POSTGRES_URL).' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const gid = pick(body.giveaway);
  try {
    if (body.action === 'draw') {
      const r = await drawWinner(gid, s.email);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === 'resolve') {
      await resolveWinner(gid, Number(body.id), body.outcome, body.note, s.email);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'review_video') {
      await reviewVideo(gid, Number(body.id), body.outcome, s.email);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'review_costume') {
      await reviewCostume(gid, Number(body.id), body.outcome, s.email);
      return NextResponse.json({ ok: true });
    }
    // The ONE best costume (+5 entries). Naming a new one takes the title off the old.
    if (body.action === 'best_costume') {
      await setBestCostume(gid, Number(body.id), s.email);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'clear_best_costume') {
      await clearBestCostume(gid);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Failed.' }, { status: 400 });
  }
}
