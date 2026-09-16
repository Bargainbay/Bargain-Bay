// Parts — the shelf, and everything that moves on or off it. See lib/parts.js.
//
// Staff-level, like the warehouse: finding a part for the machine on the bench
// is the work, not a permission. Two things are ADMIN, both following the gate
// rule in CLAUDE.md — what a part COST us, and answering a tech's request, which
// is the owner's call by his own instruction.
import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import {
  partsOverview, searchParts, getPart, addPart, receiveParts, usePart,
  partOutState, harvestPart, removeHarvested, finishPartOut,
  requestPart, listRequests, decideRequest, pickRequest, cancelRequest
} from '../../../../lib/parts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function staff() { const s = await getSession(); return s && isStaff(s) ? s : null; }
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const who = (s) => ({ by: s.email || null, byName: s.name || s.email || null });

function fail(e) {
  if (e?.code) console.error('parts route failed', e);
  return NextResponse.json({ error: e?.code ? 'Something went wrong saving that.' : (e?.message || 'Something went wrong.') },
    { status: e?.code ? 500 : 400 });
}

// Cost is the one thing sales never see (CLAUDE.md gate rule), so it is stripped
// on the way OUT rather than hidden in the browser — a hidden field is not a
// permission.
const stripCost = (part) => (part && { ...part, valueAtCost: undefined });

export async function GET(req) {
  const s = await staff();
  if (!s) return denied();
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (POSTGRES_URL).' }, { status: 503 });
  const sp = new URL(req.url).searchParams;
  const admin = isAdmin(s);
  try {
    switch (sp.get('view')) {
      case 'search': {
        const parts = await searchParts(sp.get('q') || '');
        return NextResponse.json({ parts: admin ? parts : parts.map(stripCost) });
      }
      case 'part': {
        const part = await getPart(Number(sp.get('id')));
        return NextResponse.json({
          part: admin ? part : { ...stripCost(part), moves: part.moves.map((m) => ({ ...m, cost: undefined })) }
        });
      }
      case 'part_out':
        return NextResponse.json(await partOutState(sp.get('sku') || ''));
      case 'requests':
        return NextResponse.json({ requests: await listRequests({ status: sp.get('status') || 'open' }) });
      default: {
        const overview = await partsOverview();
        return NextResponse.json(admin ? overview : { ...overview, valueAtCost: undefined });
      }
    }
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req) {
  const s = await staff();
  if (!s) return denied();
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (POSTGRES_URL).' }, { status: 503 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }); }
  const admin = isAdmin(s);
  // What a part cost is admin's. A rep booking in a box of parts records what
  // arrived; the price goes on afterwards by somebody who sees cost anyway.
  const cost = admin ? body.cost : undefined;
  try {
    switch (body.action) {
      case 'add_part':
        return NextResponse.json({ ok: true, part: await addPart({ ...body, ...who(s) }) });
      case 'receive':
        return NextResponse.json({ ok: true, ...(await receiveParts({ ...body, cost, ...who(s) })) });
      case 'use':
        return NextResponse.json({ ok: true, ...(await usePart({ ...body, reason: 'use_unit', ...who(s) })) });
      case 'count':
        return NextResponse.json({ ok: true, ...(await receiveParts({ ...body, cost, reason: 'count', ...who(s) })) });
      case 'harvest':
        return NextResponse.json({ ok: true, ...(await harvestPart({ ...body, ...who(s) })) });
      case 'harvest_remove':
        return NextResponse.json({ ok: true, ...(await removeHarvested(body.moveId)) });
      case 'finish_part_out':
        return NextResponse.json({ ok: true, ...(await finishPartOut({ salvageSku: body.sku, ...who(s) })) });
      case 'request':
        return NextResponse.json({ ok: true, ...(await requestPart({ ...body, ...who(s) })) });
      case 'decide':
        // The owner's rule: a tech asks, an ADMIN answers.
        if (!admin) return denied();
        return NextResponse.json({ ok: true, ...(await decideRequest({ id: body.id, approve: !!body.approve, ...who(s) })) });
      case 'pick':
        return NextResponse.json({ ok: true, ...(await pickRequest({ id: body.id, location: body.location, ...who(s) })) });
      case 'cancel_request':
        return NextResponse.json({ ok: true, ...(await cancelRequest({ id: body.id, by: s.email || null })) });
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return fail(e);
  }
}
