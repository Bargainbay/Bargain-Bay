import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { getSession, isAdmin } from '../../../../lib/auth';
import { podPhotoPath, orderSignaturePath } from '../../../../lib/pod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin-only proxy that streams a PRIVATE POD blob (photo by id, or an order's
// signature). The blob URLs are never exposed; only an admin session can read.
export async function GET(req) {
  const s = await getSession();
  if (!s || !isAdmin(s)) return new NextResponse('Not authorized', { status: 403 });

  const url = new URL(req.url);
  const photoId = url.searchParams.get('photo');
  const sigOrder = url.searchParams.get('sig');
  let pathname = null;
  if (photoId) pathname = await podPhotoPath(Number(photoId));
  else if (sigOrder) pathname = await orderSignaturePath(Number(sigOrder));
  if (!pathname) return new NextResponse('Not found', { status: 404 });

  try {
    const res = await get(pathname, { access: 'private' });
    if (!res || res.statusCode !== 200 || !res.stream) return new NextResponse('Not found', { status: 404 });
    return new Response(res.stream, {
      headers: {
        'Content-Type': res.blob?.contentType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=60'
      }
    });
  } catch (e) {
    console.error('admin pod get failed', e.message);
    return new NextResponse('Error', { status: 500 });
  }
}
