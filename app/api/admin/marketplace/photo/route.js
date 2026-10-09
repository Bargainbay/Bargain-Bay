// Staff view of a listing photo, evidence (rating plate) included. Evidence is never served
// to a customer or to the vendor's public gallery.
import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { getSession, isStaff } from '../../../../../lib/auth';
import { query } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get('id'));
  const { rows } = await query('SELECT blob_path FROM listing_photos WHERE id = $1', [id]);
  if (!rows.length) return new NextResponse('Not found', { status: 404 });
  try {
    const res = await get(rows[0].blob_path, { access: 'private' });
    if (!res || res.statusCode !== 200 || !res.stream) return new NextResponse('Not found', { status: 404 });
    return new Response(res.stream, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' } });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
