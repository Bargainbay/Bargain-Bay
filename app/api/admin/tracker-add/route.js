// Admin: book units that are physically here but on neither the tracker nor RS Ops
// onto the Main tab, with the fields the storefront needs to price them.
//
// The vendor drop-off and invoice book-in paths each write a fixed shape (a
// consignment row, or a NEEDS INVOICE row with no price). This is for the third
// case: stock somebody counted on the warehouse floor. Admin only because it
// writes cost and sets a status.
//
// { units: [{ lot, sku?, category, make, model, serial?, description?, condition?,
//             retail?, cost?, status?, vendor?, invoice?, notes?, dateReceived? }] }
// Without `sku`, the next number in `lot` is used (lot-NNN, like an invoice commit).
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { appendTrackerUnits, highestSkuNumber, readTrackerRows, sheetsConfigured } from '../../../../lib/sheets';
import { audit } from '../../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const STATUSES = ['Tested Working', 'Tested Working - Needs Cleaning', 'Tested Working - Needs QA', 'Untested'];
const fold = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const money = (v) => (v === '' || v == null ? null : (Number.isFinite(Number(String(v).replace(/[$,]/g, ''))) ? Number(String(v).replace(/[$,]/g, '')) : NaN));

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!sheetsConfigured()) return NextResponse.json({ error: 'Tracker not configured (SHEET_ID / GOOGLE_CREDENTIALS).' }, { status: 400 });
  let b; try { b = await req.json(); } catch { b = {}; }
  const input = Array.isArray(b.units) ? b.units.slice(0, 20) : [];
  if (!input.length) return NextResponse.json({ error: 'No units.' }, { status: 400 });
  try {
    const existing = await readTrackerRows();
    const serials = new Map(existing.filter((r) => fold(r.serial).length >= 5).map((r) => [fold(r.serial), r.sku]));
    const next = new Map();
    const units = [];
    const refused = [];
    for (const u of input) {
      const make = String(u.make || '').trim(), model = String(u.model || '').trim();
      const lot = String(u.lot || '').trim();
      const status = u.status ? String(u.status) : 'Tested Working';
      if (!make || !model || !(u.sku || lot)) { refused.push({ model, why: 'make, model and a lot (or sku) are required' }); continue; }
      if (!STATUSES.includes(status)) { refused.push({ model, why: `status must be one of ${STATUSES.join(', ')}` }); continue; }
      const retail = money(u.retail), cost = money(u.cost);
      if (Number.isNaN(retail) || Number.isNaN(cost)) { refused.push({ model, why: 'retail / cost must be numbers' }); continue; }
      const ser = fold(u.serial);
      if (ser.length >= 5 && serials.has(ser)) { refused.push({ model, why: `serial already on the tracker as ${serials.get(ser)}` }); continue; }
      let sku = String(u.sku || '').trim();
      if (!sku) {
        if (!next.has(lot)) next.set(lot, await highestSkuNumber(lot));
        const n = next.get(lot) + 1;
        next.set(lot, n);
        sku = `${lot}-${String(n).padStart(3, '0')}`;
      }
      if (ser.length >= 5) serials.set(ser, sku);
      units.push({
        lot: lot || sku, sku, category: String(u.category || '').trim() || 'Other', make, model,
        serial: u.serial ? String(u.serial).trim() : null,
        description: String(u.description || '').trim() || [make, model].filter(Boolean).join(' '),
        condition: u.condition ? String(u.condition).trim() : null,
        retail, cost, status,
        vendor: u.vendor ? String(u.vendor).trim() : null,
        invoice: u.invoice ? String(u.invoice).trim() : null,
        dateReceived: u.dateReceived || undefined,
        notes: u.notes ? String(u.notes) : `Counted on the warehouse floor and booked in by ${s.name || s.email} — it was on neither the tracker nor RS Ops.`
      });
    }
    const res = units.length ? await appendTrackerUnits(units) : { created: [] };
    await audit(s, { action: 'tracker_add', entity: 'tracker', entityId: res.created.map((c) => c.sku).join(','), summary: `Booked ${res.created.length} unit(s) onto the tracker`, detail: { units: units.map((u) => ({ sku: u.sku, model: u.model, cost: u.cost })) } });
    return NextResponse.json({ ok: true, created: res.created, refused });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not add the units.' }, { status: 500 });
  }
}
