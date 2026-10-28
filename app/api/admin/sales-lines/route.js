import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// READ-ONLY. Every invoice line and every order line with the SKU it carries and
// the amount it sold for, so a unit the tracker calls Sold with no price can be
// tied to the sale that explains it. Prices only: no cost, no customer contact.
//   ?from=YYYY-MM-DD   (default: everything)
//   ?kind=unit         (default: appliance lines only; 'all' for services too)
export async function GET(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ invoiceLines: [], orderLines: [] });
  const sp = new URL(req.url).searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('from') || '') ? sp.get('from') : '1970-01-01';
  const unitOnly = (sp.get('kind') || 'unit') !== 'all';
  try {
    const inv = await query(
      `SELECT i.number, i.status, to_char(i.created_at AT TIME ZONE 'America/Toronto','YYYY-MM-DD') AS date,
              ii.id AS item_id, ii.sku, ii.description, ii.amount, ii.kind
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.created_at >= $1::date
          AND ($2::boolean = false OR COALESCE(ii.kind,'unit') = 'unit')
        ORDER BY i.id, ii.id`, [from, unitOnly]);
    const ord = await query(
      `SELECT o.order_number, o.status, to_char(o.created_at AT TIME ZONE 'America/Toronto','YYYY-MM-DD') AS date,
              oi.sku, oi.title, oi.price, oi.kind
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= $1::date
          AND ($2::boolean = false OR COALESCE(oi.kind,'unit') = 'unit')
        ORDER BY o.id, oi.id`, [from, unitOnly]);
    return NextResponse.json({
      ok: true,
      invoiceLines: inv.rows.map((r) => ({ number: r.number, status: r.status, date: r.date, itemId: r.item_id, sku: r.sku, description: r.description, amount: Number(r.amount), kind: r.kind })),
      orderLines: ord.rows.map((r) => ({ number: r.order_number, status: r.status, date: r.date, sku: r.sku, title: r.title, price: Number(r.price), kind: r.kind }))
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not read the lines.' }, { status: 500 });
  }
}
