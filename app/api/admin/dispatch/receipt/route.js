import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { getSession, isStaff } from '../../../../../lib/auth';
import { hasDb, query } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The fuel receipt the driver photographed at the pump, streamed to the office.
//
// The whole point of the driver entering fuel is that nobody in the office
// re-types it — and that only holds if they can SEE the receipt from here.
// Without this they'd be asking for it on WhatsApp, which is the work the
// feature exists to remove.
//
// Same shape as the POD proxy: the blob is PRIVATE and its URL is never handed
// out; only a signed-in staff session can read one, and the filename is the
// date and the amount rather than a blob id.
export async function GET(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'Which receipt?' }, { status: 400 });

  const { rows } = await query(
    'SELECT expense_date, amount, receipt_path FROM dispatch_expenses WHERE id = $1', [id]
  );
  const row = rows[0];
  if (!row?.receipt_path) return NextResponse.json({ error: 'No receipt on that one.' }, { status: 404 });

  try {
    const res = await get(row.receipt_path);
    const ext = (res.blob?.contentType || '').includes('png') ? 'png' : 'jpg';
    const name = `fuel-${row.expense_date?.toISOString?.().slice(0, 10) || 'receipt'}-$${Number(row.amount).toFixed(2)}.${ext}`;
    return new NextResponse(res.body, {
      headers: {
        'Content-Type': res.blob?.contentType || 'application/octet-stream',
        'Content-Disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${name}"`,
        'Cache-Control': 'private, max-age=300'
      }
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not read that receipt.' }, { status: 404 });
  }
}
