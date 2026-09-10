// Photos of one physical unit — add more, list, or remove one.
//
// The intake form uploads its photos with the unit in a single request, so this
// route is the AFTERWARDS: the rep took two more shots at the loading bay, or a
// picture went up sideways. Without it a photo mistake could only be fixed by
// deleting the unit and adding it again, which changes the SKU.
//
// Staff-level. A photo of an appliance is the selling side's own work — the same
// reasoning that puts the vendor drop-off form in their hands.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { addUnitPhotos, listUnitPhotos, deleteUnitPhoto, MAX_PHOTOS } from '../../../../lib/unit-photos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function staff() { const s = await getSession(); return s && isStaff(s) ? s : null; }
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  if (!(await staff())) return denied();
  const sku = (new URL(req.url).searchParams.get('sku') || '').trim();
  if (!sku) return NextResponse.json({ error: 'Missing sku' }, { status: 400 });
  return NextResponse.json({ sku, photos: await listUnitPhotos(sku) });
}

export async function POST(req) {
  const s = await staff();
  if (!s) return denied();
  let form;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 }); }
  const sku = String(form.get('sku') || '').trim();
  if (!sku) return NextResponse.json({ error: 'Missing sku' }, { status: 400 });
  const files = form.getAll('photos').filter((p) => p && typeof p === 'object' && p.size > 0).slice(0, MAX_PHOTOS);
  if (!files.length) return NextResponse.json({ error: 'No photos in that upload.' }, { status: 400 });
  try {
    const { photos, failed } = await addUnitPhotos(sku, files, { createdBy: s.email || null });
    return NextResponse.json({ ok: true, sku, photos, failed });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save those photos.' }, { status: 500 });
  }
}

export async function DELETE(req) {
  if (!(await staff())) return denied();
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await deleteUnitPhoto(id)) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not remove that photo.' }, { status: 500 });
  }
}
