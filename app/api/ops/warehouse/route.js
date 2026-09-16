// RS Ops asks where a unit is, and records the moves made on the refurb floor.
//
// Machine-to-machine: RS Ops signs its crew in by PIN, and none of them have an
// account here. It authenticates with RSOPS_INTAKE_KEY — the shared secret both
// apps ALREADY hold, because Bargain Bay uses it to push invoice manifests the
// other way (lib/rsops-push.js). One secret between the two apps rather than a
// second one that has to be set up on both before anything works.
//
// The name of whoever scanned it arrives in the body and is recorded as
// "<name> (RS Ops)". We cannot verify it — the key proves the request came from
// RS Ops, not which person was holding the phone — so it is labelled for what it is.
import { NextResponse } from 'next/server';
import { hasDb } from '../../../../lib/db';
import { countSpot, listLocations, locationContents, moveSpotContents, moveUnits, unitWhere } from '../../../../lib/locations';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function keyProblem(req) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) return NextResponse.json({ error: 'Warehouse sync is not switched on here — set RSOPS_INTAKE_KEY.' }, { status: 503 });
  const sent = req.headers.get('x-rsops-key') || '';
  if (sent.length !== key.length || sent !== key) return NextResponse.json({ error: 'Bad or missing key' }, { status: 401 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (POSTGRES_URL).' }, { status: 503 });
  return null;
}

const spotList = async () => (await listLocations())
  .filter((s) => s.active)
  .map(({ code, area, kind, purpose, count }) => ({ code, area, kind, purpose, count }));

function fail(e) {
  if (e?.code) console.error('ops warehouse route failed', e);
  return NextResponse.json({ error: e?.code ? 'Something went wrong saving that.' : (e?.message || 'Something went wrong.') },
    { status: e?.code ? 500 : 400 });
}

export async function GET(req) {
  const problem = keyProblem(req);
  if (problem) return problem;
  const sp = new URL(req.url).searchParams;
  const sku = (sp.get('sku') || '').trim();
  const code = (sp.get('code') || '').trim();
  try {
    // What is standing in one spot — the refurb floor's put-away screen shows it
    // so somebody can see the shelf they are loading without walking to it.
    if (code) return NextResponse.json(await locationContents(code));
    if (!sku) return NextResponse.json({ spots: await spotList() });
    const [unit, spots] = await Promise.all([unitWhere(sku), spotList()]);
    return NextResponse.json({ unit, spots });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req) {
  const problem = keyProblem(req);
  if (problem) return problem;
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }
  if (!['move', 'count', 'move_all'].includes(body.action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  const skus = Array.isArray(body.skus) ? body.skus : body.sku ? [body.sku] : [];
  const name = String(body.by || '').trim().slice(0, 80);

  // Counting a spot is the same function the office's screen calls, so the two
  // can never disagree about what a count does: units found here are moved here,
  // and units recorded here and not found stay recorded and are reported.
  if (body.action === 'count') {
    try {
      const out = await countSpot({
        code: body.code, skus,
        by: null, byName: name ? `${name} (RS Ops)` : 'RS Ops'
      });
      return NextResponse.json({ ok: true, ...out });
    } catch (e) {
      return fail(e);
    }
  }

  // A whole bay going to one place. The floor carries them together; this is the
  // record catching up, which is why the screen there names the count and asks.
  if (body.action === 'move_all') {
    try {
      const out = await moveSpotContents({
        from: body.from, to: body.code,
        by: null, byName: name ? `${name} (RS Ops)` : 'RS Ops', via: 'rsops'
      });
      return NextResponse.json({ ok: true, ...out });
    } catch (e) {
      return fail(e);
    }
  }

  // A unit RS Ops knows and the site doesn't yet (untested, waiting on parts)
  // would otherwise show as a bare SKU on every screen here.
  const titles = body.titles && typeof body.titles === 'object'
    ? body.titles
    : (body.title && skus.length === 1 ? { [skus[0]]: body.title } : null);
  try {
    const out = await moveUnits({
      skus, code: body.code || null, note: body.note, titles,
      by: null, byName: name ? `${name} (RS Ops)` : 'RS Ops', via: 'rsops'
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return fail(e);
  }
}
