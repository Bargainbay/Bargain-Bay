// Admin write-back into the master tracker — mark units Sold (Status + Sold Price
// + Date Sold) and/or correct a unit's Cost, matched exactly by Item ID. Used for
// the one-time historical Sold cleanup and ongoing manual corrections; also the
// building block for the nightly Sold catch-up sweep.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { writeSoldRows, setTrackerCost, sheetsConfigured } from '../../../../lib/sheets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!sheetsConfigured()) return NextResponse.json({ error: 'Tracker not configured (SHEET_ID / GOOGLE_CREDENTIALS).' }, { status: 400 });
  let b; try { b = await req.json(); } catch { b = {}; }
  const sold = Array.isArray(b.sold) ? b.sold : [];
  const costs = Array.isArray(b.costs) ? b.costs : [];
  try {
    const soldRes = sold.length ? await writeSoldRows(sold) : { written: 0 };
    const costRes = [];
    for (const c of costs) {
      if (!c || !c.sku || c.amount == null) continue;
      costRes.push(await setTrackerCost(String(c.sku), Number(c.amount)));
    }
    return NextResponse.json({ ok: true, soldWritten: soldRes.written, costsUpdated: costRes });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Write-back failed.' }, { status: 500 });
  }
}
