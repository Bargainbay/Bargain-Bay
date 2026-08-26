import { redirect, notFound } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../../../lib/auth';
import { hasDb } from '../../../../../lib/db';
import { getInvoiceByNumber, listInvoiceRefunds } from '../../../../../lib/invoices';
import { money, round2, normalizeLineKind } from '../../../../../lib/constants';
import { creditFactorOf } from '../../../../../lib/invoice-lines';
import AdminNav from '../../../../../components/AdminNav';
import RefundControl from '../../../../../components/RefundControl';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Refund invoice — Bargain Bay' };

// The refund screen. Two ways money goes back: tick the unit(s) that came back
// (relisted, optionally minus a restocking fee), or refund a bare amount
// (money only, no stock moves). A part-paid invoice can only do the second —
// there is nothing to return until the sale has actually settled.
export default async function RefundInvoicePage({ params }) {
  const { number } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/admin/invoices/${number}/refund`);
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
    </div></div>);
  }
  if (!hasDb()) return <div className="narrow"><div className="panel">Database not configured.</div></div>;

  const invoice = await getInvoiceByNumber(number).catch(() => null);
  if (!invoice) return notFound();

  if (!['paid', 'partial'].includes(invoice.status)) {
    return (
      <div>
        <AdminNav active="invoices" salesOnly={!isAdmin(session)} />
        <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Refund {invoice.number}</h1>
        <div className="error-box">
          This invoice is <b>{invoice.status}</b> — money can only be returned on one that has taken some.
          {invoice.status === 'refunded' ? ' It has already been fully refunded.' : ''}
        </div>
        <p><a className="btn" href="/admin/invoices">← Back to invoices</a></p>
      </div>
    );
  }

  const refunded = Number(invoice.refund_total) || 0;
  // What can still physically go back = money actually collected, less anything
  // already returned. A legacy 'paid' invoice predating the payment ledger has no
  // payment rows, so it falls back to its total rather than refusing a refund.
  const collected = round2(Math.max(Number(invoice.amountPaid) || 0, invoice.status === 'paid' ? Number(invoice.total) || 0 : 0));
  const refundable = round2(Math.max(0, collected - refunded));
  // The invoice charged less than its charged lines add up to when it carries a
  // discount or a trade-in. Same helper the refund itself uses, so the figure
  // previewed here is the one that will actually be handed back.
  const creditFactor = creditFactorOf(invoice.items);
  const view = {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    hasHst: Number(invoice.hst) > 0,
    refundable,
    // Only charged lines can come back — a discount or a trade-in credit isn't
    // something the customer can return. They're shown for context and can't be
    // picked, and `creditFactor` is how their value is taken off what IS picked.
    items: (invoice.items || []).map((it) => ({
      id: it.id,
      description: it.description,
      sku: it.sku || null,
      kind: normalizeLineKind(it.kind),
      amount: Number(it.amount) || 0,
      refunded: !!it.refunded_at
    })),
    creditFactor,
    refunds: await listInvoiceRefunds(invoice.id).catch(() => [])
  };

  return (
    <div>
      <AdminNav active="invoices" salesOnly={!isAdmin(session)} />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Refund {invoice.number}</h1>
      <p className="hint" style={{ marginTop: 0 }}>
        For <b>{invoice.name || invoice.email}</b> · total {money(invoice.total)} · collected {money(collected)}
        {refunded > 0 ? <> · already refunded {money(refunded)}</> : null}
      </p>
      <div className="panel">
        <RefundControl invoice={view} />
      </div>
    </div>
  );
}
