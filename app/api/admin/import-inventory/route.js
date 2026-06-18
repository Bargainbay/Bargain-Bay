import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { parseTrackerCsv } from '../../../../lib/csv';
import { upsertProducts } from '../../../../lib/catalog-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

// Keyless inventory import: paste/upload a CSV export of the master tracker.
export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const csv = String(body.csv || '');
  if (!csv.trim()) return NextResponse.json({ error: 'No CSV content received.' }, { status: 400 });

  let units, report;
  try {
    ({ units, report } = parseTrackerCsv(csv));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  if (!units.length) {
    return NextResponse.json({
      error: 'No "Tested Working" units found in that CSV — check the Status column.',
      report
    }, { status: 400 });
  }
  try {
    const result = await upsertProducts(units);
    // report explains why the imported count can differ from total tracker rows.
    return NextResponse.json({ ok: true, ...result, report });
  } catch (e) {
    console.error('csv import failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Import failed.' }, { status: 500 });
  }
}
