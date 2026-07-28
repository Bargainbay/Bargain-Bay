import { redirect, notFound } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../../../lib/auth';
import { hasDb } from '../../../../../lib/db';
import { getInvoiceByNumber } from '../../../../../lib/invoices';
import { money } from '../../../../../lib/constants';
import AdminNav from '../../../../../components/AdminNav';
import RefundItemsControl from '../../../../../components/RefundItemsControl';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Refund invoice — Bargain Bay' };

// Per-unit refund page: tick the line(s) coming back on a PAID invoice. Ticking
// every line is a full refund (same as the old Refund button).
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

  if (invoice.status !== 'paid') {
    return (
      <div>
        <AdminNav active="invoices" salesOnly={!isAdmin(session)} />
        <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Refund {invoice.number}</h1>
        <div className="error-box">
          This invoice is <b>{invoice.status}</b> — only a paid invoice can be refunded.
          {invoice.status === 'refunded' ? ' It has already been fully refunded.' : ''}
        </div>
        <p><a className="btn" href="/admin/invoices">← Back to invoices</a></p>
      </div>
    );
  }

  const refunded = Number(invoice.refund_total) || 0;
  const view = {
    id: invoice.id,
    number: invoice.number,
    hasHst: Number(invoice.hst) > 0,
    items: (invoice.items || []).map((it) => ({
      id: it.id,
      description: it.description,
      sku: it.sku || null,
      kind: it.kind === 'service' ? 'service' : 'unit',
      amount: Number(it.amount) || 0,
      refunded: !!it.refunded_at
    }))
  };

  return (
    <div>
      <AdminNav active="invoices" salesOnly={!isAdmin(session)} />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Refund {invoice.number}</h1>
      <p className="hint" style={{ marginTop: 0 }}>
        For <b>{invoice.name || invoice.email}</b> · total {money(invoice.total)}
        {refunded > 0 ? <> · already refunded {money(refunded)}</> : null}
      </p>
      <div className="panel">
        <RefundItemsControl invoice={view} />
      </div>
    </div>
  );
}
