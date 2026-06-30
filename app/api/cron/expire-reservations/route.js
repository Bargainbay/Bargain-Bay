import { NextResponse } from 'next/server';
import { expireReservations } from '../../../../lib/reservations';
import { cronAuthorized } from '../../../../lib/cron-auth';

export const dynamic = 'force-dynamic';

// Reservation/abandoned-order cleanup. Hit it from Vercel Cron (vercel.json)
// or any scheduler; /api/checkout also calls the same helper opportunistically.
async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
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
