// Photos on one of the vendor's listings. Every upload is decoded, checked and
// RE-ENCODED (lib/image-checks.js) before it is stored — the original bytes, with
// their EXIF and GPS, are never kept. Files only: we never fetch a URL a vendor gives us.
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { put, del } from '@vercel/blob';
import { requireVendor } from '../../../../../../lib/vendor-session';
import { getVendorListing, attachPhoto, removePhoto } from '../../../../../../lib/marketplace-listings';
import { processListingImage } from '../../../../../../lib/image-checks';
import { PHOTO_ROLES } from '../../../../../../lib/listing-rules';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function POST(req, { params }) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: 'Photo storage is not configured.' }, { status: 503 });
  const id = Number((await params).id);
  if (!(await getVendorListing(ctx.vendor.id, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  let form;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 }); }
  const role = String(form.get('role') || 'other');
  if (!PHOTO_ROLES.includes(role)) return NextResponse.json({ error: 'Choose what the photo shows.' }, { status: 400 });
  const files = form.getAll('photos').filter((f) => f && typeof f === 'object' && f.size > 0).slice(0, 6);
  if (!files.length) return NextResponse.json({ error: 'No photos in that upload.' }, { status: 400 });

  const saved = []; const refused = []; let flagged = false;
  for (const file of files) {
    const out = await processListingImage(Buffer.from(await file.arrayBuffer()));
    if (!out.ok) { refused.push({ name: file.name || 'photo', problems: out.problems }); continue; }
    const path = `marketplace/${id}/${randomUUID()}.jpg`;
    try {
      await put(path, out.buffer, { access: 'private', addRandomSuffix: false, contentType: 'image/jpeg' });
      const r = await attachPhoto(ctx.vendor.id, id, {
        role, blobPath: path, width: out.width, height: out.height, bytes: out.bytes,
        phash: out.phash, blur: out.blur, warnings: out.warnings
      });
      if (r.similarElsewhere) flagged = true;
      saved.push({ id: r.id, warnings: out.warnings });
    } catch (e) {
      // the row failed after the blob went up: take the blob back down so nothing is orphaned
      try { await del(path); } catch { /* best effort */ }
      refused.push({ name: file.name || 'photo', problems: [e?.message || 'Could not save that photo.'] });
    }
  }
  // `flagged` is for staff, not the vendor — telling a thief which photo tripped the check helps them.
  void flagged;
  return NextResponse.json({ ok: saved.length > 0, saved, refused });
}

export async function DELETE(req, { params }) {
  const ctx = await requireVendor();
  if (!ctx) return denied();
  const id = Number((await params).id);
  const photoId = Number(new URL(req.url).searchParams.get('photoId'));
  if (!photoId) return NextResponse.json({ error: 'Missing photoId' }, { status: 400 });
  try {
    const { blobPath } = await removePhoto(ctx.vendor.id, id, photoId);
    try { await del(blobPath); } catch { /* the row is the record */ }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not remove that photo.' }, { status: 400 });
  }
}
