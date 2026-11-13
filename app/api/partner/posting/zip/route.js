// The photos of one unit as a zip, for a lead generator's posting. Partner-login only; the unit must be on sale now.
import { NextResponse } from 'next/server';
import { getSession } from '../../../../../lib/auth';
import { getPartnerSeat } from '../../../../../lib/referral-partners';
import { readStock } from '../../../../../lib/partner-posting';
import { photoZip } from '../../../../../lib/photo-zip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (!(await getPartnerSeat(s.email))) return NextResponse.json({ error: 'Not a partner login.' }, { status: 403 });
  const sku = (new URL(req.url).searchParams.get('sku') || '').trim();
  const stock = await readStock();
  const unit = stock.ok ? stock.units.find((u) => u.id === sku) : null;
  if (!unit) return NextResponse.json({ error: 'That item is not for sale any more.' }, { status: 404 });
  const r = await photoZip(unit);
  if (r.error) return NextResponse.json({ error: r.error }, { status: 502 });
  return new Response(r.zip, { status: 200, headers: {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${String(unit.id).replace(/[^\w.-]/g, '_')}-photos.zip"`,
    'X-Photos-Skipped': r.skipped.join(','), 'Cache-Control': 'no-store'
  } });
}
