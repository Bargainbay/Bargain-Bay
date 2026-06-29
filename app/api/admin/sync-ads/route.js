// Manual "Sync Meta ads now" — admin-only.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { syncMetaAds, metaConfigured } from '../../../../lib/meta-ads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!metaConfigured()) return NextResponse.json({ error: 'Meta Ads isn’t connected yet. Set META_ADS_ACCESS_TOKEN and META_AD_ACCOUNT_ID.' }, { status: 400 });
  try {
    const result = await syncMetaAds();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Sync failed.' }, { status: 500 });
  }
}
