import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { extractPurchaseInvoice } from '../../../../lib/purchase-intake';
import { addIntakeLines, lotForInvoice } from '../../../../lib/intake';
import { matchInvoiceLines, requestFills } from '../../../../lib/stock-reconcile';
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

  // Units RS Ops booked in before this invoice was uploaded are already on the
  // tracker, marked NEEDS INVOICE. Find them per line so the review screen can
  // show them, and so committing FILLS those rows instead of adding the same
  // appliances a second time. Writes nothing.
  if (body.action === 'match') {
    const items = Array.isArray(body.items) ? body.items : [];
    try {
      return NextResponse.json({ ok: true, matches: await matchInvoiceLines(items, { invoice: body.invoice || '' }) });
    } catch (e) {
      // A failed lookup must not stop an invoice going in; the screen just shows no matches.
      return NextResponse.json({ ok: true, matches: [], error: e?.message || 'Could not check for units already booked in.' });
    }
  }

  if (body.action === 'commit') {
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return NextResponse.json({ error: 'No units to add.' }, { status: 400 });
    try {
      // Units already waiting for this invoice are held back for admin approval;
      // only what's left over on each line is added as new units. `matches` =
      // [{ line, skus }], exactly what the review screen was shown and left ticked.
      const matches = (Array.isArray(body.matches) ? body.matches : [])
        .filter((m) => Number.isInteger(m?.line) && items[m.line] && Array.isArray(m.skus) && m.skus.length);
      // Matched units are NOT written here: each becomes a request an admin
      // approves on Stock gaps (requestFills). They still come off the line's
      // quantity — they are the appliances this line bought, if approved, and a
      // rejection adds the line as a new unit then.
      let pending = [];
      let pendingError = null;
      if (matches.length) {
        try {
          const session = await getSession();
          const r = await requestFills(
            matches.map((m) => ({ line: items[m.line], skus: m.skus })),
            { vendor: body.vendor || null, invoice: body.invoice || null, lot: lotForInvoice(body.invoice).lot, by: session?.email }
          );
          pending = r.requested;
        } catch (e) {
          // No approval queue means no way to hold the match — add every line as new instead.
          pendingError = e?.message || 'Could not file the approval requests.';
        }
      }
      const filledPerLine = new Map();
      if (!pendingError) for (const m of matches) filledPerLine.set(m.line, m.skus.filter((s) => pending.includes(s)).length);
      const remaining = items
        .map((it, i) => ({ ...it, qty: Math.max(1, Math.round(Number(it.qty) || 1)) - (filledPerLine.get(i) || 0) }))
        .filter((it) => it.qty > 0);

      // One batched tracker write for the whole invoice — per-line writes take a
      // full sheet read each and time out on big (60-line) invoices.
      const added = remaining.length
        ? await addIntakeLines(remaining, { vendor: body.vendor || null, invoice: body.invoice || null })
        : { created: [], count: 0, lot: null, units: [] };
      const r = { ...added, count: added.count };

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
      // Only the NEW units: the matched ones are appliances RS Ops already has.
      const manifest = r.units?.length
        ? await pushManifestToRsOps({
          lot: r.lot, vendor: body.vendor || null, invoice: body.invoice || null,
          clientId: body.clientId || null, units: r.units
        })
        : { ok: true, createdCount: 0, lot: null };

      return NextResponse.json({
        ok: true, addedSkus: r.created, pendingSkus: pending, pendingError, count: r.count, failed: [], tax, taxUpdated, taxError,
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
