// A part's photo, from the private Blob store, on our own domain. Public on
// purpose (a parts website will use it); it carries nothing but the picture.
import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { partPhotoPath } from '../../../../lib/part-photos';
import { downloadHeaders } from '../../../../lib/image-download';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new NextResponse('Not found', { status: 404 });
  const found = await partPhotoPath(id);
  if (!found) return new NextResponse('Not found', { status: 404 });
  try {
    const res = await get(found.path, { access: 'private' });
    if (!res || res.statusCode !== 200 || !res.stream) return new NextResponse('Not found', { status: 404 });
    const type = res.blob?.contentType || 'image/jpeg';
    return new Response(res.stream, {
      headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600, s-maxage=3600', ...downloadHeaders(req, found.label, type) }
    });
  } catch { return new NextResponse('Not found', { status: 404 }); }
}
