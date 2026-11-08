import { NextResponse } from 'next/server';
import { getSession, canKeepBooks } from '../../../../../lib/auth';
import { readReceipt } from '../../../../../lib/receipt-read';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Read a photographed receipt so the form arrives filled in. Nothing is stored here.
export async function POST(req) {
  const s = await getSession();
  if (!s || !(await canKeepBooks(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  try {
    const f = await req.formData();
    const photo = f.get('photo');
    if (!photo || typeof photo !== 'object' || !(photo.size > 0)) return NextResponse.json({ error: 'No photo.' }, { status: 400 });
    const base64 = Buffer.from(await photo.arrayBuffer()).toString('base64');
    return NextResponse.json({ ok: true, read: await readReceipt({ base64, mediaType: photo.type || 'image/jpeg' }) });
  } catch (e) { return NextResponse.json({ error: e?.message || 'Could not read that photo.' }, { status: 400 }); }
}
