import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { query } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Streams an entrant's video out of the PRIVATE store to an admin, for review.
// The file is never public: it holds a stranger's home and perhaps their family.
export async function GET(req) {
  const s = await getSession();
  if (!s || !isAdmin(s)) return new NextResponse('Not authorized', { status: 403 });
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id)) return new NextResponse('Not found', { status: 404 });
  const { rows } = await query('SELECT video_path FROM giveaway_entries WHERE id = $1', [id]);
  const path = rows[0]?.video_path;
  if (!path) return new NextResponse('Not found', { status: 404 });
  try {
    const res = await get(path, { access: 'private' });
    if (!res || res.statusCode !== 200 || !res.stream) return new NextResponse('Not found', { status: 404 });
    return new Response(res.stream, {
      headers: { 'Content-Type': res.blob?.contentType || 'video/mp4', 'Cache-Control': 'private, no-store' }
    });
  } catch (e) {
    console.error('giveaway video proxy failed', id, e?.message || e);
    return new NextResponse('Not found', { status: 404 });
  }
}
