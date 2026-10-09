// A vendor unit's PUBLIC photo, from the private Blob store, on our own domain. Serves only a
// `public` photo of a listing that is on sale — never a draft, never the rating-plate evidence.
// The photo id is unguessable only in the sense that nothing links to a hidden one; the check is
// the query, not the secrecy.
import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { publicPhotoPath } from '../../../../lib/marketplace-storefront';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req, { params }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new NextResponse('Not found', { status: 404 });
  try {
    const path = await publicPhotoPath(id);
    if (!path) return new NextResponse('Not found', { status: 404 });
    const res = await get(path, { access: 'private' });
    if (!res || res.statusCode !== 200 || !res.stream) return new NextResponse('Not found', { status: 404 });
    return new Response(res.stream, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400' }
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
