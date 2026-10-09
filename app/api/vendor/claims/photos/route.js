// Photos on a seller's own warranty claim: the repair or replacement as they show it, and any photo of that
// claim back. The vendor id comes from the session; another seller's claim or photo is simply "not found".
// Every upload is decoded and re-encoded — no EXIF, no GPS.
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { put, del, get } from '@vercel/blob';
import { requireVendor } from '../../../../../lib/vendor-session';
import { processListingImage } from '../../../../../lib/image-checks';
import { attachClaimPhoto, claimPhotoPath } from '../../../../../lib/warranty-claims';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  const path = await claimPhotoPath(Number(new URL(req.url).searchParams.get('id')), { vendorId: ctx.vendor.id });
  if (!path) return new NextResponse('Not found', { status: 404 });
  try {
    const res = await get(path, { access: 'private' });
    if (!res || res.statusCode !== 200 || !res.stream) return new NextResponse('Not found', { status: 404 });
    return new Response(res.stream, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300' } });
  } catch { return new NextResponse('Not found', { status: 404 }); }
}

export async function POST(req) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: 'Photo storage is not configured.' }, { status: 503 });
  let form;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 }); }
  const claimId = Number(form.get('claimId'));
  if (!claimId) return NextResponse.json({ error: 'Which claim?' }, { status: 400 });
  const files = form.getAll('photos').filter((f) => f && typeof f === 'object' && f.size > 0).slice(0, 6);
  if (!files.length) return NextResponse.json({ error: 'No photos in that upload.' }, { status: 400 });
  const saved = []; const refused = [];
  for (const file of files) {
    const out = await processListingImage(Buffer.from(await file.arrayBuffer()), { lenient: true });
    if (!out.ok) { refused.push({ name: file.name || 'photo', problems: out.problems }); continue; }
    const path = `claims/${claimId}/${randomUUID()}.jpg`;
    try {
      await put(path, out.buffer, { access: 'private', addRandomSuffix: false, contentType: 'image/jpeg' });
      const r = await attachClaimPhoto(claimId, { vendorId: ctx.vendor.id, by: ctx.session.email, blobPath: path, caption: form.get('caption'), width: out.width, height: out.height, bytes: out.bytes });
      saved.push({ id: r.id });
    } catch (e) {
      try { await del(path); } catch { /* best effort */ }
      refused.push({ name: file.name || 'photo', problems: [e?.message || 'Could not save that photo.'] });
    }
  }
  return NextResponse.json({ ok: saved.length > 0, saved, refused });
}
