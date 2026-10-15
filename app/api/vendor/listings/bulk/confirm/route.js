// Bulk upload, step 2: create DRAFTS for the rows that pass. Never submits, never goes live.
// Everything is re-read and re-checked here; the browser's preview is not trusted.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../../../lib/vendor-session';
import { confirmBulk, BULK_MAX_CHARS } from '../../../../../../lib/listing-bulk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const ctx = await requireVendor();
  if (!ctx) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const text = String(body?.text || '');
  if (text.length > BULK_MAX_CHARS) return NextResponse.json({ error: 'That is too much to read at once.' }, { status: 413 });
  try {
    return NextResponse.json(await confirmBulk(ctx.vendor.id, text, String(body?.token || ''), { by: ctx.session.email }));
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not import that file.' }, { status: 400 });
  }
}
