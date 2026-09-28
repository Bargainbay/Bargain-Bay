// Who we buy from — terms, contact, what we owe them and whether they turn up.
//
// ADMIN, not staff. Every answer on this screen is cost- or payables-derived:
// what an order was worth, what is owed and when it falls due. Same line
// CLAUDE.md draws everywhere else — the customer's sale is staff, the
// business's books are the owner's.
import { NextResponse } from 'next/server';
import { explainDbError } from '../../../../lib/migrate';
import { getSession, isAdmin } from '../../../../lib/auth';
import {
  createSupplier, updateSupplier, addSupplierAlias, listSuppliers,
  supplierPerformance, payablesAging, unknownVendorNames, relinkAll, supplierSpend
} from '../../../../lib/suppliers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return s && isAdmin(s) ? s : null;
}

export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const sp = new URL(req.url).searchParams;

  // Every read soft-fails to an empty answer inside lib/suppliers, so a
  // half-migrated database renders an empty panel rather than a broken page.
  switch (sp.get('view')) {
    case 'aging':
      return NextResponse.json(await payablesAging());
    case 'performance':
      return NextResponse.json({ suppliers: await supplierPerformance({ days: sp.get('days') }) });
    case 'spend':
      return NextResponse.json(await supplierSpend({
        groupBy: sp.get('groupBy') || 'month', periods: sp.get('periods')
      }));
    case 'unknown':
      return NextResponse.json({ names: await unknownVendorNames({}) });
    default:
      return NextResponse.json({ suppliers: await listSuppliers({ includeInactive: sp.get('all') === '1' }) });
  }
}

export async function POST(req) {
  const session = await admin();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body; try { body = await req.json(); } catch { body = {}; }

  try {
    switch (body.action) {
      case 'create': {
        // Returns `created: false` for a name already on file rather than
        // erroring — see createSupplier. Answering the unknown-names list is
        // the main way this is called, and half of those are already there
        // under another spelling.
        const r = await createSupplier({ ...body, by: session.email });
        if (r.id && body.alias) await addSupplierAlias(r.id, body.alias, { by: session.email });
        // Answering the question fixes the HISTORY too. A supplier added today
        // is no use if the orders and invoices already carrying their name stay
        // unattached — and nobody would think to press a second button for it.
        return NextResponse.json({ ...r, ...(await relinkAll().catch(() => ({}))) });
      }
      case 'update':
        return NextResponse.json(await updateSupplier(body.id, body));
      case 'alias': {
        // This is what stops a name coming back on the unknown list forever —
        // and, with the relink, takes everything already filed under it with it.
        await addSupplierAlias(body.id, body.alias, { by: session.email });
        return NextResponse.json({ ok: true, ...(await relinkAll().catch(() => ({}))) });
      }
      case 'relink':
        // Fold the history on. A supplier added today is no use if the four
        // years of orders already carrying their name stay unattached.
        return NextResponse.json(await relinkAll());
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: explainDbError(e) }, { status: 400 });
  }
}
