// Inventory intake.
//
// TWO paths with two different gates, deliberately kept apart:
//
//  * ADMIN — the purchase / haul-away path. A unit lands Untested and RS Ops
//    tests, grades and publishes it. Publishing and rejecting live here too.
//  * STAFF — the vendor drop-off path (`mode: 'consignment'`). A vendor leaves
//    appliances with us, no invoice, paid when they sell; they arrive working,
//    the rep photographs them and lists them. Sales can do the whole thing.
//
// A non-admin can reach NOTHING but the consignment POST. In particular they
// cannot publish an Untested unit — deciding a machine off the refurb floor is
// fit to sell is RS Ops's call, and this route must not become a way round it.
import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff } from '../../../../lib/auth';
import {
  listIntakePending, addIntakeUnits, addConsignmentUnit,
  markIntakeTested, rejectIntake, intakeLiveStatus
} from '../../../../lib/intake';
import { addUnitPhotos, MAX_PHOTOS } from '../../../../lib/unit-photos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // a tracker append plus up to 8 photo uploads

async function admin() { const s = await getSession(); return s && isAdmin(s) ? s : null; }
async function staff() { const s = await getSession(); return s && isStaff(s) ? s : null; }
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const s = await staff();
  if (!s) return denied();
  // "Did the units I just added make it onto the site?" — staff-level, because
  // it is the answer to the button they were just told to press.
  const skus = (new URL(req.url).searchParams.get('skus') || '').split(',').filter(Boolean);
  if (skus.length) return NextResponse.json({ units: await intakeLiveStatus(skus) });
  if (!isAdmin(s)) return denied(); // the Untested queue is RS Ops's, not sales'
  return NextResponse.json({ units: await listIntakePending() });
}

export async function POST(req) {
  const s = await staff();
  if (!s) return denied();

  // The vendor drop-off arrives as multipart, because it carries the photos.
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('multipart/form-data')) {
    let form;
    try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 }); }
    if (String(form.get('mode') || '') !== 'consignment') {
      return NextResponse.json({ error: 'Unknown intake mode.' }, { status: 400 });
    }
    const f = (k) => String(form.get(k) || '').trim();
    let sku;
    let booked = true; // did the consignment liability get recorded?
    try {
      const r = await addConsignmentUnit({
        make: f('make'), model: f('model'), category: f('category'), condition: f('condition'),
        retail: f('retail'), cost: f('cost'), vendor: f('vendor'), serial: f('serial'),
        description: f('description'), note: f('note'),
        createdBy: s.email || null
      });
      sku = r.sku;
      booked = r.booked;
    } catch (e) {
      return NextResponse.json({ error: e?.message || 'Could not add.' }, { status: 400 });
    }
    // The tracker row exists from here on. A photo failure must therefore be
    // REPORTED against a real SKU, never turned into an error that makes the rep
    // think nothing happened and add the unit a second time.
    let photos = [];
    let failed = 0;
    let photoError = '';
    const files = form.getAll('photos').filter((p) => p && typeof p === 'object' && p.size > 0).slice(0, MAX_PHOTOS);
    if (files.length) {
      try {
        const r = await addUnitPhotos(sku, files, { createdBy: s.email || null });
        photos = r.photos; failed = r.failed;
      } catch (e) {
        photoError = e?.message || 'Photos could not be saved.';
        console.error('consignment photos failed', sku, photoError);
      }
    }
    return NextResponse.json({ ok: true, sku, booked, photosSaved: photos.length, photosFailed: failed, photoError });
  }

  // Everything else is the RS Ops path: admin only.
  if (!isAdmin(s)) return denied();
  let b; try { b = await req.json(); } catch { b = {}; }
  if (!b.make && !b.model) return NextResponse.json({ error: 'Enter at least a make or model.' }, { status: 400 });
  try {
    const r = await addIntakeUnits(b);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not add.' }, { status: 500 });
  }
}

export async function PATCH(req) {
  if (!(await admin())) return denied();
  let b; try { b = await req.json(); } catch { b = {}; }
  const sku = String(b.sku || '');
  if (!sku) return NextResponse.json({ error: 'Missing sku' }, { status: 400 });
  try {
    if (b.action === 'reject') return NextResponse.json({ ok: true, ...(await rejectIntake(sku)) });
    return NextResponse.json({ ok: true, ...(await markIntakeTested(sku, { condition: b.condition })) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not update.' }, { status: 500 });
  }
}
