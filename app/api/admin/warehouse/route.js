// The warehouse — where units are, and moving them. See lib/locations.js.
//
// Staff-level. Putting a fridge in a lane and finding it again for a customer
// standing at the counter is the selling side's own work. Adding and retiring
// spots is the one admin action: it changes the map everybody else scans against.
import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import {
  listLocations, locationContents, unitWhere, findUnits, unplacedUnits,
  moveUnits, moveSpotContents, countSpot, addSpots, updateSpot, listAreas, addArea
} from '../../../../lib/locations';
import { stockByVendor, withoutCost } from '../../../../lib/stock-vendors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function staff() { const s = await getSession(); return s && isStaff(s) ? s : null; }
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const who = (s) => ({ by: s.email || null, byName: s.name || s.email || null });

// Our own refusals are sentences meant for the person holding the scanner; a
// database error carries a code and is ours to fix.
function fail(e) {
  if (e?.code) console.error('warehouse route failed', e);
  return NextResponse.json({ error: e?.code ? 'Something went wrong saving that.' : (e?.message || 'Something went wrong.') },
    { status: e?.code ? 500 : 400 });
}

export async function GET(req) {
  const session = await staff();
  if (!session) return denied();
  const sp = new URL(req.url).searchParams;

  // Stock by vendor is read from the TRACKER, so it answers with no database —
  // it is the one view here that says nothing about where a unit is standing.
  // Cost is stripped for a non-admin on the server, never hidden in the browser.
  if (sp.get('view') === 'vendors') {
    try {
      const report = await stockByVendor();
      return NextResponse.json(isAdmin(session) ? report : withoutCost(report));
    } catch (e) {
      return NextResponse.json({ error: e?.message || 'Could not read the tracker.' }, { status: 502 });
    }
  }

  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (POSTGRES_URL).' }, { status: 503 });
  try {
    switch (sp.get('view')) {
      case 'location': return NextResponse.json(await locationContents(sp.get('code') || ''));
      case 'unit': return NextResponse.json({ unit: await unitWhere(sp.get('sku') || '') });
      case 'find': return NextResponse.json({ units: await findUnits(sp.get('q') || '') });
      case 'unplaced': return NextResponse.json(await unplacedUnits());
      default: {
        const [locations, areas] = await Promise.all([listLocations(), listAreas()]);
        return NextResponse.json({ locations, areas });
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
  const skus = Array.isArray(body.skus) ? body.skus : body.sku ? [body.sku] : [];
  try {
    switch (body.action) {
      case 'move':
        if (!String(body.code || '').trim()) throw new Error('Pick a spot to move it to.');
        return NextResponse.json({ ok: true, ...(await moveUnits({ skus, code: body.code, note: body.note, via: 'scan', ...who(s) })) });
      case 'move_all':
        // One spot emptied into another. `from` is the spot being cleared.
        return NextResponse.json({ ok: true, ...(await moveSpotContents({ from: body.from, to: body.code, ...who(s) })) });
      case 'out':
        return NextResponse.json({ ok: true, ...(await moveUnits({ skus, code: null, note: body.note, via: 'out', ...who(s) })) });
      case 'count':
        return NextResponse.json({ ok: true, ...(await countSpot({ code: body.code, skus, ...who(s) })) });
      case 'add_area':
        if (!isAdmin(s)) return denied();
        return NextResponse.json({ ok: true, ...(await addArea({ label: body.label, by: s.email || null })) });
      case 'add':
        if (!isAdmin(s)) return denied();
        return NextResponse.json({ ok: true, ...(await addSpots(body)) });
      case 'update': {
        const patch = {};
        for (const k of ['purpose', 'note', 'active']) if (k in body) patch[k] = body[k];
        return NextResponse.json({ ok: true, spot: await updateSpot(body.code, patch, { admin: isAdmin(s) }) });
      }
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return fail(e);
  }
}
