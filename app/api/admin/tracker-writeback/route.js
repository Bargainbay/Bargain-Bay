// Admin write-back into the master tracker — mark units Sold (Status + Sold Price
// + Date Sold), reverse a sale after a refund (`unsold`), and/or correct a unit's
// Cost, matched exactly by Item ID. Used for
// the one-time historical Sold cleanup and ongoing manual corrections; also the
// building block for the nightly Sold catch-up sweep.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { writeSoldRows, writeUnsoldRows, setTrackerCost, sheetsConfigured } from '../../../../lib/sheets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!sheetsConfigured()) return NextResponse.json({ error: 'Tracker not configured (SHEET_ID / GOOGLE_CREDENTIALS).' }, { status: 400 });
  let b; try { b = await req.json(); } catch { b = {}; }
  const sold = Array.isArray(b.sold) ? b.sold : [];
  // Reverse a sale (refund/return): Status back to 'Tested Working', Sold Price
  // and Date Sold cleared. Accepts ['SKU', ...] or [{ sku }, ...].
  const unsold = (Array.isArray(b.unsold) ? b.unsold : []).map((u) => (typeof u === 'string' ? u : u?.sku));
  const costs = Array.isArray(b.costs) ? b.costs : [];
  try {
    const soldRes = sold.length ? await writeSoldRows(sold) : { written: 0 };
    const unsoldRes = unsold.length ? await writeUnsoldRows(unsold) : { written: 0, missing: [] };
    const costRes = [];
    for (const c of costs) {
      if (!c || !c.sku || c.amount == null) continue;
      costRes.push(await setTrackerCost(String(c.sku), Number(c.amount)));
    }
    return NextResponse.json({ ok: true, soldWritten: soldRes.written, unsoldWritten: unsoldRes.written, unsoldMissing: unsoldRes.missing, costsUpdated: costRes });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Write-back failed.' }, { status: 500 });
  }
}
