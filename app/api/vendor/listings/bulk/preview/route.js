// Bulk upload, step 1: read the file and report every row. Writes NOTHING.
// The vendor comes from the session, never from the request.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../../../lib/vendor-session';
import { previewBulk, xlsxToText, BULK_MAX_CHARS } from '../../../../../../lib/listing-bulk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req) {
  const ctx = await requireVendor('listings.bulk');
  if (!ctx) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let text = '';
  try {
    const type = req.headers.get('content-type') || '';
    if (type.includes('multipart/form-data')) {
      const file = (await req.formData()).get('file');
      if (!file || typeof file !== 'object') return NextResponse.json({ error: 'No file.' }, { status: 400 });
      if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That file is over 2MB. Upload at most 100 units at a time.' }, { status: 413 });
      if (/\.xls$/i.test(file.name || '')) return NextResponse.json({ error: 'Old .xls files cannot be read. Save it as .xlsx or CSV.' }, { status: 400 });
      const buf = Buffer.from(await file.arrayBuffer());
      const isXlsx = /\.xlsx$/i.test(file.name || '') || (buf[0] === 0x50 && buf[1] === 0x4b);
      text = isXlsx ? xlsxToText(buf) : buf.toString('utf8');
    } else {
      text = String((await req.json())?.text || '');
    }
  } catch {
    return NextResponse.json({ error: 'Could not read that file.' }, { status: 400 });
  }
  if (text.length > BULK_MAX_CHARS) return NextResponse.json({ error: 'That is too much to read at once. Upload at most 100 units.' }, { status: 413 });
  try {
    return NextResponse.json({ ...(await previewBulk(ctx.vendor.id, text)), text });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not read that file.' }, { status: 400 });
  }
}
