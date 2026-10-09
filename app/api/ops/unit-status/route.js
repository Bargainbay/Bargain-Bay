import { NextResponse } from 'next/server';
import { hasDb, query } from '../../../../lib/db';
import { getSession, isStaff } from '../../../../lib/auth';
import { readTrackerRows, sheetsConfigured } from '../../../../lib/sheets';
import { unavailableSkus } from '../../../../lib/reservations';

// Is this unit sold, live on the website, or on an invoice? Read-only, for RS Ops'
// Clean up screen: its repair queue had filled with units that had since been
// fixed, listed and sold, because RS Ops only knows where it SENT a unit, not
// what happened to it afterwards. The tracker, the storefront and the invoices
// know. `GET ?skus=A,B,C` (max 200).
//
// Machine-to-machine on the shared RSOPS_INTAKE_KEY like the other /api/ops
// routes; a signed-in staff session also works, so it can be checked by hand.
// Cost and price are never returned — this answers "where is it", not "what did
// it cost".
//
// Every part soft-fails to "unknown": a tracker that can't be read must not look
// like a unit that isn't on it.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const norm = (s) => String(s || '').trim().toUpperCase();

async function allowed(req) {
  const key = process.env.RSOPS_INTAKE_KEY;
  const sent = req.headers.get('x-rsops-key') || '';
  if (key && sent.length === key.length && sent === key) return true;
  const s = await getSession();
  return Boolean(s && isStaff(s));
}

export async function GET(req) {
  if (!(await allowed(req))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const skus = [...new Set(String(new URL(req.url).searchParams.get('skus') || '')
    .split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 200);
  if (!skus.length) return NextResponse.json({ error: 'skus is empty' }, { status: 400 });
  const wanted = new Set(skus.map(norm));
  const out = Object.fromEntries(skus.map((s) => [s, {
    tracker: { known: false }, onSite: null, soldOnSite: null, invoices: null
  }]));
  const slot = (sku) => out[skus.find((s) => norm(s) === norm(sku))];

  // The tracker: the source of truth for Sold, Refurbished, Needs Diagnosis…
  let trackerOk = false;
  if (sheetsConfigured()) {
    try {
      for (const r of await readTrackerRows()) {
        if (!wanted.has(norm(r.sku))) continue;
        const o = slot(r.sku);
        if (o) o.tracker = { known: true, status: r.status, row: r.row, serial: r.serial };
      }
      trackerOk = true;
    } catch (e) { console.error('unit-status tracker read failed', e?.message); }
  }
  if (!trackerOk) for (const s of skus) out[s].tracker = { known: false, unreadable: true };

  if (hasDb()) {
    // Live on the storefront right now (active and not sold / held).
    try {
      const { rows } = await query('SELECT sku FROM products WHERE active = true AND upper(sku) = ANY($1)', [[...wanted]]);
      const unavailable = await unavailableSkus(skus).catch(() => new Set());
      for (const s of skus) {
        const active = rows.some((r) => norm(r.sku) === norm(s));
        out[s].onSite = active && !unavailable.has(s);
        out[s].soldOnSite = unavailable.has(s);
      }
    } catch (e) { console.error('unit-status products read failed', e?.message); }

    // Invoices that carry this exact SKU on a line. EXACT match, not a text
    // search: a text search for SS-Haulaways-002 also finds mentions in memos.
    try {
      const { rows } = await query(
        `SELECT upper(ii.sku) AS sku, i.number, i.status, i.created_at
           FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
          WHERE ii.refunded_at IS NULL AND i.status IN ('open','partial','paid') AND upper(ii.sku) = ANY($1)
          ORDER BY i.created_at DESC`, [[...wanted]]);
      for (const s of skus) out[s].invoices = [];
      for (const r of rows) {
        const o = slot(r.sku);
        if (o) o.invoices.push({ number: r.number, status: r.status, date: new Date(r.created_at).toISOString().slice(0, 10) });
      }
    } catch (e) { console.error('unit-status invoices read failed', e?.message); }
  }
  return NextResponse.json({ units: out });
}
