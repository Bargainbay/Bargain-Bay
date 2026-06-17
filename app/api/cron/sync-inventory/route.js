import { NextResponse } from 'next/server';
import { syncInventoryFromTracker } from '../../../../lib/catalog-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Nightly inventory sync. Driven by Vercel Cron (vercel.json). If CRON_SECRET is
// set, require it (Vercel Cron sends Authorization: Bearer <CRON_SECRET>).
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
    const result = await syncInventoryFromTracker();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('cron sync-inventory failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
