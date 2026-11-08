import { NextResponse } from 'next/server';
import { getSession, canKeepBooks } from '../../../../../lib/auth';
import { receiptPhoto } from '../../../../../lib/receipts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The receipt photo, streamed to somebody with books access. The blob is PRIVATE; its URL is never handed out.
export async function GET(req) {
  const s = await getSession();
  if (!s || !(await canKeepBooks(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'Which receipt?' }, { status: 400 });
  try {
    const res = await receiptPhoto(id);
    if (!res) return NextResponse.json({ error: 'No photo on that one.' }, { status: 404 });
    return new NextResponse(res.stream, { headers: {
      'Content-Type': res.blob?.contentType || 'image/jpeg',
      'Content-Disposition': `inline; filename="receipt-${id}.jpg"`, 'Cache-Control': 'private, max-age=300' } });
  } catch (e) { return NextResponse.json({ error: e?.message || 'Could not read that photo.' }, { status: 404 }); }
}
