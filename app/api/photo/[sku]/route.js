import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Public image proxy: streams a re-hosted product photo from the PRIVATE Blob
// store, giving storefront cards + the Merchant feed a stable public URL on our
// own domain without exposing the blob store. Path: /api/photo/<sku>.
export async function GET(req, { params }) {
  const resolvedParams = await params;
  const sku = String(resolvedParams?.sku || '').trim().replace(/[^\w.-]/g, '_');
  if (!sku) return new NextResponse('Not found', { status: 404 });
  try {
    const res = await get(`products/${sku}.jpg`, { access: 'private' });
    if (!res || res.statusCode !== 200 || !res.stream) {
      return new NextResponse('Not found', { status: 404 });
    }
    return new Response(res.stream, {
      headers: {
        'Content-Type': res.blob?.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch (e) {
    console.error('photo proxy failed', sku, e?.message || e);
    return new NextResponse('Not found', { status: 404 });
  }
}
