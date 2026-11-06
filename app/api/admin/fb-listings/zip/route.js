// Download every photo of one unit as a zip, for posting on Facebook Marketplace.
// Server-side because manufacturer CDNs send no CORS headers, so the browser cannot save them itself.
// Staff-level: it is the selling side's catalogue. Reads only; nothing is sent to Facebook.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../../lib/auth';
import { getById } from '../../../../../lib/inventory';
import { fbPhotos } from '../../../../../lib/fb-kit';
import { zipStore } from '../../../../../lib/zip-lite';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

export async function GET(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const sku = (new URL(req.url).searchParams.get('sku') || '').trim();
  const unit = sku ? await getById(sku) : null;
  if (!unit) return NextResponse.json({ error: 'Unknown unit' }, { status: 404 });
  const photos = fbPhotos(unit);
  const files = [];
  const skipped = [];
  let n = 0;
  await Promise.all(photos.map(async (p, i) => {
    try {
      const r = await fetch(p.url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!r.ok || !type.startsWith('image/')) throw new Error(String(r.status));
      files.push({ i, name: `${unit.id}-${String(i + 1).padStart(2, '0')}-${p.kind}.${EXT[type] || 'jpg'}`, data: Buffer.from(await r.arrayBuffer()) });
      n++;
    } catch { skipped.push(i + 1); }
  }));
  if (!files.length) return NextResponse.json({ error: 'None of the photos could be fetched. Use "Open" on each photo and save it from there.' }, { status: 502 });
  files.sort((a, b) => a.i - b.i);
  const zip = zipStore(files);
  return new Response(zip, { status: 200, headers: {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${String(unit.id).replace(/[^\w.-]/g, '_')}-photos.zip"`,
    'X-Photos-Skipped': skipped.sort((a, b) => a - b).join(','),
    'Cache-Control': 'no-store',
  } });
}
