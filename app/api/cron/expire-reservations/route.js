import { NextResponse } from 'next/server';
import { expireReservations } from '../../../../lib/reservations';

export const dynamic = 'force-dynamic';

// Reservation/abandoned-order cleanup. Hit it from Vercel Cron (vercel.json)
// or any scheduler; /api/checkout also calls the same helper opportunistically.
// If CRON_SECRET is set, require it (Vercel Cron sends Authorization: Bearer <CRON_SECRET>).
async function run(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    const key = new URL(req.url).searchParams.get('key') || '';
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
    }
  }
  try {
    const result = await expireReservations();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('expire-reservations failed', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
