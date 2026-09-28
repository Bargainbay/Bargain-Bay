// Purchase orders — what we have ordered, and receiving it.
//
// ADMIN, not staff. A purchase order carries what we AGREED TO PAY, and cost is
// the line CLAUDE.md draws between the customer's sale and the business's books.
// Receiving is admin for the same reason: the cost on the line is what the unit
// arrives priced at.
import { NextResponse } from 'next/server';
import { explainDbError } from '../../../../lib/migrate';
import { getSession, isAdmin } from '../../../../lib/auth';
import {
  createPurchaseOrder, getPurchaseOrder, receivePurchaseOrder,
  cancelPurchaseOrder, listPurchaseOrders, outstandingSummary,
  matchPurchaseOrder, linkInvoiceToPurchaseOrder, suggestPurchaseOrderForInvoice, matchingGaps
} from '../../../../lib/purchase-orders';
import { listSuppliers } from '../../../../lib/suppliers';
import { reorderReport } from '../../../../lib/reorder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function admin() {
  const s = await getSession();
  return s && isAdmin(s) ? s : null;
}

export async function GET(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const id = sp.get('id');
  if (id) {
    const po = await getPurchaseOrder(id);
    return po ? NextResponse.json({ po }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // Everything the raise-an-order form needs, in one call: who we buy from, and
  // the parts that are short. A part is offered here because a purchase order
  // line can now name one, which is what lets the reorder list know something
  // is already on its way.
  if (sp.get('view') === 'setup') {
    const [suppliers, reorder] = await Promise.all([
      listSuppliers({}),
      reorderReport({}).catch(() => ({ below: [] }))
    ]);
    return NextResponse.json({
      suppliers,
      parts: (reorder.below || []).map((p) => ({
        id: p.id, name: p.name, partNumber: p.partNumber,
        supplier: p.supplier, suggestQty: p.orderQty
      }))
    });
  }
  if (sp.get('view') === 'summary') return NextResponse.json(await outstandingSummary());
  if (sp.get('view') === 'gaps') return NextResponse.json(await matchingGaps({}));
  if (sp.get('match')) return NextResponse.json({ match: await matchPurchaseOrder(sp.get('match')) });
  if (sp.get('suggest')) return NextResponse.json({ orders: await suggestPurchaseOrderForInvoice(sp.get('suggest')) });
  return NextResponse.json({ orders: await listPurchaseOrders({ status: sp.get('status') || 'outstanding' }) });
}

export async function POST(req) {
  const session = await admin();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body; try { body = await req.json(); } catch { body = {}; }

  try {
    switch (body.action) {
      case 'create':
        return NextResponse.json(await createPurchaseOrder({ ...body, by: session.email }));
      case 'receive':
        // The tracker write happens inside this call and inside a transaction —
        // a refused write leaves no receipt behind, so the answer here is
        // either "it is booked in" or "nothing happened".
        return NextResponse.json(
          await receivePurchaseOrder(body.id, body.lines, { by: session.email, note: body.note })
        );
      case 'link':
        // Explicit. Nothing links automatically — matching on a number that
        // "looks like" the order's is exactly how the S-ORD115612 /
        // PS-INV116968 tangle happened.
        return NextResponse.json(
          await linkInvoiceToPurchaseOrder(body.invoiceId, body.poId ?? null, { by: session.email })
        );
      case 'cancel':
        return NextResponse.json(await cancelPurchaseOrder(body.id, { by: session.email }));
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: explainDbError(e) }, { status: 400 });
  }
}
