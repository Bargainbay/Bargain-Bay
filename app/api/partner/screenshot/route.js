// Look at a lead's screenshot. Allowed for our staff, the generator who sent it and their organisation's admins; everybody else,
// and every missing picture, gets the same 404 (nothing says a picture exists).
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { getPartnerSeat } from '../../../../lib/referral-partners';
import { screenshotFor, openScreenshot } from '../../../../lib/lead-screenshot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const s = await getSession();
  if (!s) return new NextResponse('Not found', { status: 404 });
  const id = new URL(req.url).searchParams.get('id');
  const row = await screenshotFor(id, { staff: isStaff(s), seat: await getPartnerSeat(s.email) });
  if (!row) return new NextResponse('Not found', { status: 404 });
  try {
    const f = await openScreenshot(row);
    if (!f) return new NextResponse('Not found', { status: 404 });
    return new Response(f.stream, { headers: { 'Content-Type': f.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new NextResponse('Not found', { status: 404 }); }
}
