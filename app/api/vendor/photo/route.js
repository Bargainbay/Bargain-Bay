// Streams one of the vendor's OWN photos back to them (the blob store is private).
// Ownership is checked in the query, so another vendor's photo id is just a 404.
import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { requireVendor } from '../../../../lib/vendor-session';
import { query } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const ctx = await requireVendor();
  if (!ctx) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!id) return new NextResponse('Not found', { status: 404 });
  const { rows } = await query(
    `SELECT p.blob_path FROM listing_photos p JOIN marketplace_listings l ON l.id = p.listing_id
      WHERE p.id = $1 AND l.vendor_id = $2`, [id, ctx.vendor.id]);
  if (!rows.length) return new NextResponse('Not found', { status: 404 });
  try {
    const res = await get(rows[0].blob_path, { access: 'private' });
    if (!res || res.statusCode !== 200 || !res.stream) return new NextResponse('Not found', { status: 404 });
    return new Response(res.stream, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300' } });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
