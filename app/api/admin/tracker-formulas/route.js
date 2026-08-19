import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { repairTrackerFormulas, sheetsConfigured } from '../../../../lib/sheets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // reads the whole Main tab, then one batched paste

// Backfill the master tracker's formula columns on rows a past API append left
// bare. Chiefly AvailRank (AF) — the column the tracker's own "Available
// Inventory" and "Shopify Export" tabs key off, so a blank one makes a real,
// in-stock unit invisible on the sheet while the storefront happily lists it.
// Idempotent: only EMPTY cells are filled.
export async function POST() {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!sheetsConfigured()) {
    return NextResponse.json({ error: 'Google Sheets not configured — set GOOGLE_CREDENTIALS and SHEET_ID.' }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await repairTrackerFormulas()) });
  } catch (e) {
    console.error('tracker formula repair failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Repair failed.' }, { status: 500 });
  }
}
