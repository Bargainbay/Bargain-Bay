import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { extractPurchaseInvoice } from '../../../../lib/purchase-intake';
import { addIntakeLines } from '../../../../lib/intake';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function admin() {
  const s = await getSession();
  return !!(s && isAdmin(s));
}

// POST { action:'extract', fileBase64, mediaType } → AI-read the purchase invoice,
//   return the line items for the owner to review (writes nothing).
// POST { action:'commit', vendor, invoice, items:[...] } → write the reviewed units
//   into the master tracker as "Untested" via the existing intake path.
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
      return NextResponse.json({ ok: true, addedSkus: r.created, count: r.count, failed: [] });
    } catch (e) {
      return NextResponse.json({ error: e?.message || 'Could not write to the tracker.' }, { status: 400 });
    }
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
