import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { verifyClientToken, clientPhotoPath, clientSignaturePath } from '../../../../lib/client-portal';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Streams a private POD photo / signature to the client it belongs to. The link
// token proves WHICH client; the path lookup is scoped to that client, so a
// photo id from another company's stop is a plain 404.
export async function GET(req) {
  const url = new URL(req.url);
  const c = url.searchParams.get('c');
  if (!verifyClientToken(c, url.searchParams.get('t'))) return new NextResponse('Not authorized', { status: 403 });

  const photo = url.searchParams.get('photo');
  const sig = url.searchParams.get('sig');
  const pathname = photo ? await clientPhotoPath(c, photo) : sig ? await clientSignaturePath(c, sig) : null;
  if (!pathname) return new NextResponse('Not found', { status: 404 });

  try {
    const res = await get(pathname, { access: 'private' });
    if (!res || res.statusCode !== 200 || !res.stream) return new NextResponse('Not found', { status: 404 });
    const download = url.searchParams.get('download') === '1';
    const ext = (res.blob?.contentType || '').includes('png') ? 'png' : 'jpg';
    const label = String(url.searchParams.get('name') || '').replace(/[^\w.-]+/g, '-').slice(0, 60) || `pod-${photo || sig}`;
    return new Response(res.stream, {
      headers: {
        'Content-Type': res.blob?.contentType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=60',
        ...(download ? { 'Content-Disposition': `attachment; filename="${label}.${ext}"` } : {})
      }
    });
  } catch (e) {
    console.error('client pod get failed', e.message);
    return new NextResponse('Error', { status: 500 });
  }
}
