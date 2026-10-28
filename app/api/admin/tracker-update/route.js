// Admin: correct what a unit IS on the tracker — Status, Condition, Retail, the
// Invoice cell and the Tested / Cleaned / Repaired ticks — matched by Item ID.
//
// For stock that was never put through the cleaning queue (the Caledon lot): RS
// Ops only reports a state when a unit is routed, so the tracker still says
// Untested for machines that are done. Cost, Sold Price and Date Sold are NOT
// writable here — money has its own routes.
//
// { units: [{ sku, status?, condition?, retail?, invoice?, vendor?, notes?,
//             tested?, cleaned?, repaired? }] }  (a field left out is left alone)
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { readTrackerRows, writeTrackerCells, sheetsConfigured } from '../../../../lib/sheets';
import { INTAKE_CONDITIONS } from '../../../../lib/constants';
import { audit } from '../../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const STATUSES = ['Tested Working', 'Tested Working - Needs Cleaning', 'Tested Working - Needs QA', 'Untested',
  'Tested Not Working - Needs Parts', 'Tested Not Working - Needs Diagnosis', 'Salvage For Parts Only'];
const yn = (v) => (v === true || /^y/i.test(String(v)) ? 'Y' : v === false || /^n/i.test(String(v)) ? 'N' : null);

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!sheetsConfigured()) return NextResponse.json({ error: 'Tracker not configured (SHEET_ID / GOOGLE_CREDENTIALS).' }, { status: 400 });
  let b; try { b = await req.json(); } catch { b = {}; }
  const input = Array.isArray(b.units) ? b.units.slice(0, 40) : [];
  if (!input.length) return NextResponse.json({ error: 'No units.' }, { status: 400 });
  try {
    const rows = new Map((await readTrackerRows()).map((r) => [r.sku, r]));
    const cells = [];
    const done = [];
    const refused = [];
    for (const u of input) {
      const sku = String(u.sku || '').trim();
      const row = rows.get(sku);
      if (!row) { refused.push({ sku, why: 'not on the tracker' }); continue; }
      if (/^sold$/i.test(row.status)) { refused.push({ sku, why: 'is Sold — change a sale through the invoice, not here' }); continue; }
      const set = [];
      if (u.status != null) {
        if (!STATUSES.includes(u.status)) { refused.push({ sku, why: `status must be one of ${STATUSES.join(', ')}` }); continue; }
        set.push(['status', u.status]);
      }
      if (u.condition != null) {
        if (!INTAKE_CONDITIONS.includes(u.condition)) { refused.push({ sku, why: `condition must be one of ${INTAKE_CONDITIONS.join(', ')}` }); continue; }
        set.push(['condition', u.condition]);
      }
      if (u.retail != null && u.retail !== '') {
        const n = Number(String(u.retail).replace(/[$,]/g, ''));
        if (!(n > 0)) { refused.push({ sku, why: 'retail must be a positive number' }); continue; }
        set.push(['retail', n]);
      }
      for (const f of ['invoice', 'vendor', 'notes']) if (u[f] != null) set.push([f, String(u[f])]);
      for (const f of ['tested', 'cleaned', 'repaired']) if (u[f] != null) {
        const v = yn(u[f]);
        if (!v) { refused.push({ sku, why: `${f} must be Y or N` }); continue; }
        set.push([f, v]);
      }
      for (const [field, value] of set) cells.push({ row: row.row, field, value });
      done.push({ sku, fields: set.map(([f]) => f) });
    }
    const res = cells.length ? await writeTrackerCells(cells) : { written: 0 };
    await audit(s, { action: 'tracker_update', entity: 'tracker', entityId: done.map((d) => d.sku).join(',').slice(0, 200), summary: `Updated ${done.length} tracker row(s)`, detail: { done } });
    return NextResponse.json({ ok: true, updated: done, cellsWritten: res.written, refused });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not update the tracker.' }, { status: 500 });
  }
}
