import { NextResponse } from 'next/server';
import { syncMetaAds } from '../../../../lib/meta-ads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Daily Meta ad-spend sync. Driven by Vercel Cron (vercel.json). No-ops cleanly
// until META_ADS_ACCESS_TOKEN + META_AD_ACCOUNT_ID are configured.
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
    const result = await syncMetaAds();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('cron sync-ads failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'sync failed' }, { status: 500 });
  }
}

export async function GET(req) { return run(req); }
export async function POST(req) { return run(req); }
