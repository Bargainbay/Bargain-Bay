// The refurb floor's parts shelf, driven from RS Ops.
//
// The parts live HERE (lib/parts.js) because the spots they sit in, the salvage
// units they come out of and the books they are costed in all live here. The
// floor works in RS Ops, so RS Ops reads and writes through this route — same
// shape and same shared key (RSOPS_INTAKE_KEY) as /api/ops/warehouse.
//
// What the floor can do is deliberately narrow: find a part, book one in, put
// more on the shelf, take some off. NOT here: cost (never sent, never accepted —
// what a part cost is the office's), and answering a road tech's request (the
// owner's call). Both stay on /admin/parts, which is admin-only.
//
// The name arrives in the body and is recorded as "<name> (RS Ops)". The key
// proves the request came from RS Ops, not which person was holding the phone.
import { NextResponse } from 'next/server';
import { hasDb } from '../../../../lib/db';
import { listAreas, listLocations } from '../../../../lib/locations';
import { bookInPart, describeParts, getPart, receiveParts, searchParts, usePart } from '../../../../lib/parts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function keyProblem(req) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return NextResponse.json({ error: 'Parts are not switched on here — set RSOPS_INTAKE_KEY.' }, { status: 503 });
  const sent = req.headers.get('x-rsops-key') || '';
  if (sent.length !== key.length || sent !== key) return NextResponse.json({ error: 'Bad or missing key' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (POSTGRES_URL).' }, { status: 503 });
  return null;
}

function fail(e) {
  if (e?.code) console.error('ops parts route failed', e);
  return NextResponse.json({ error: e?.code ? 'Something went wrong saving that.' : (e?.message || 'Something went wrong.') },
    { status: e?.code ? 500 : 400 });
}

// Cost never leaves this building. Stripped here rather than trusted to the other
// app to hide: a hidden field is not a permission.
const floorPart = (p) => {
  if (!p) return p;
  const { valueAtCost, unpriced, ...rest } = p;
  return rest.moves ? { ...rest, moves: rest.moves.map(({ cost, ...m }) => m), requests: undefined } : rest;
};

const spotList = async () => (await listLocations())
  .filter((s) => s.active)
  .map(({ code, area, kind, purpose }) => ({ code, area, kind, purpose }));

export async function GET(req) {
  const problem = keyProblem(req);
  if (problem) return problem;
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get('id')) return NextResponse.json({ part: floorPart(await getPart(Number(sp.get('id')))) });
    // Several parts at once, for RS Ops' label sheet. One call, not one per
    // sticker: a roll is printed a shelf at a time.
    if (sp.get('ids')) {
      const ids = sp.get('ids').split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 300);
      return NextResponse.json({ parts: (await describeParts(ids)).map(floorPart) });
    }
    if (sp.get('spots')) {
      const [spots, areas] = await Promise.all([spotList(), listAreas()]);
      return NextResponse.json({ spots, areas });
    }
    const parts = await searchParts(sp.get('q') || '', { limit: 40 });
    return NextResponse.json({ parts: parts.map(floorPart) });
  } catch (e) {
    return fail(e);
  }
}

// Only these two words reach the ledger from the floor. "Was already here" is a
// count, not a purchase — stocking the shelf from what was lying about must not
// read as bought in.
const IN_REASONS = { count: 'count', purchase: 'purchase' };
const OUT_REASONS = { repair: 'use_unit', correction: 'adjust' };

export async function POST(req) {
  const problem = keyProblem(req);
  if (problem) return problem;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }
  const name = String(body.by || '').trim().slice(0, 80);
  const who = { by: null, byName: name ? `${name} (RS Ops)` : 'RS Ops' };
  // A part with no spot is a part nobody can find. The office screen allows it;
  // the floor, which is standing at the shelf, must say where it went.
  const spot = String(body.location || '').trim();
  try {
    switch (body.action) {
      case 'book_in': {
        if (!spot) return NextResponse.json({ error: 'Which spot is it going into?' }, { status: 400 });
        if (!['new', 'used'].includes(body.condition)) return NextResponse.json({ error: 'Is it new or used?' }, { status: 400 });
        const p = body.part || {};
        const out = await bookInPart({
          part: { partNumber: p.partNumber, name: p.name, brand: p.brand, category: p.category, fits: p.fits },
          qty: body.qty, condition: body.condition, location: spot,
          reason: IN_REASONS[body.reason] || 'count', note: body.note, ...who
        });
        return NextResponse.json({ ok: true, existed: out.existed, part: floorPart(out.part) });
      }
      case 'put_more': {
        if (!spot) return NextResponse.json({ error: 'Which spot is it going into?' }, { status: 400 });
        if (!['new', 'used'].includes(body.condition)) return NextResponse.json({ error: 'Is it new or used?' }, { status: 400 });
        const out = await receiveParts({
          partId: body.partId, qty: body.qty, condition: body.condition, location: spot,
          reason: IN_REASONS[body.reason] || 'count', note: body.note, ...who
        });
        return NextResponse.json({ ok: true, part: floorPart(out.part) });
      }
      case 'take': {
        const why = OUT_REASONS[body.reason];
        if (!why) return NextResponse.json({ error: 'Is it for a repair, or a correction?' }, { status: 400 });
        // Taken from a SPOT, always: a take with no spot comes off the part's total
        // but out of no bin, and every spot list after it overstates what is there.
        if (!spot) return NextResponse.json({ error: 'Which spot are you taking it from?' }, { status: 400 });
        const out = await usePart({
          partId: body.partId, qty: body.qty, location: spot,
          reason: why, ref: body.ref, note: body.note, ...who
        });
        return NextResponse.json({ ok: true, part: floorPart(out.part) });
      }
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return fail(e);
  }
}
