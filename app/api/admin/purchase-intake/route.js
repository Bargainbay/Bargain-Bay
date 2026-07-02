import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { extractPurchaseInvoice } from '../../../../lib/purchase-intake';
import { addIntakeUnits } from '../../../../lib/intake';

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
    const created = [];
    const failed = [];
    for (const it of items) {
      try {
        const r = await addIntakeUnits({
          make: it.make, model: it.model, category: it.category,
          cost: it.cost, retail: it.retail, description: it.description,
          vendor: body.vendor || it.vendor || null,
          invoice: body.invoice || it.invoice || null,
          qty: Math.max(1, Math.round(Number(it.qty) || 1))
        });
        created.push(...(r.created || []));
      } catch (e) {
        failed.push({ model: it.model, error: e?.message || 'failed' });
      }
    }
    return NextResponse.json({ ok: true, addedSkus: created, count: created.length, failed });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
