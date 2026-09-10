import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { extractPurchaseInvoice } from '../../../../lib/purchase-intake';
import { addIntakeLines } from '../../../../lib/intake';
import { recordPurchaseInvoice } from '../../../../lib/finance';
import { pushManifestToRsOps } from '../../../../lib/rsops-push';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

// POST { action:'extract', fileBase64, mediaType } → AI-read the purchase invoice,
//   return the line items for the owner to review (writes nothing).
// POST { action:'commit', vendor, invoice, date, subtotal, tax, total, items:[...] }
//   → write the reviewed units into the master tracker as "Untested" via the
//   existing intake path, AND record the invoice's tax as an input tax credit.
export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }

  if (body.action === 'extract') {
    try {
      const data = await extractPurchaseInvoice({ base64: body.fileBase64, mediaType: body.mediaType });
      return NextResponse.json({ ok: true, ...data });
    } catch (e) {
      return NextResponse.json({ error: e?.message || 'Extraction failed.' }, { status: 400 });
    }
  }

  if (body.action === 'commit') {
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return NextResponse.json({ error: 'No units to add.' }, { status: 400 });
    try {
      // One batched tracker write for the whole invoice — per-line writes take a
      // full sheet read each and time out on big (60-line) invoices.
      const r = await addIntakeLines(items, { vendor: body.vendor || null, invoice: body.invoice || null });

      // The tax half. Recorded AFTER the units are safely in the tracker and
      // never allowed to fail the intake: getting the stock on the books is the
      // job, and a tax figure can be fixed afterwards on the Financial tab.
      let tax = 0, taxUpdated = false, taxError = null;
      const claimed = Number(body.tax);
      if (Number.isFinite(claimed) && claimed > 0) {
        try {
          const session = await getSession();
          const saved = await recordPurchaseInvoice({
            vendor: body.vendor, invoiceNumber: body.invoice, invoiceDate: body.date,
            subtotal: body.subtotal, tax: claimed, total: body.total,
            units: r.count, createdBy: session?.email
          });
          tax = Math.round(claimed * 100) / 100;
          taxUpdated = saved.updated;
        } catch (e) {
          taxError = e?.message || 'Could not record the tax on that invoice.';
        }
      }
      // Hand the same manifest to RS Ops so the refurb floor knows what this
      // invoice bought before the truck arrives. Like the tax record: written
      // AFTER the units are safely in the tracker, and never allowed to fail the
      // intake — RS Ops being unreachable is not a reason to lose the stock.
      const manifest = await pushManifestToRsOps({
        lot: r.lot, vendor: body.vendor || null, invoice: body.invoice || null,
        clientId: body.clientId || null, units: r.units
      });

      return NextResponse.json({
        ok: true, addedSkus: r.created, count: r.count, failed: [], tax, taxUpdated, taxError,
        rsops: manifest.ok
          ? { seeded: manifest.createdCount ?? 0, lot: manifest.lot }
          : { seeded: 0, error: manifest.error || manifest.skipped || null }
      });
    } catch (e) {
      return NextResponse.json({ error: e?.message || 'Could not write to the tracker.' }, { status: 400 });
    }
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
