import { redirect, notFound } from 'next/navigation';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { hasDb } from '../../../../../lib/db';
import { getInvoiceByNumber } from '../../../../../lib/invoices';
import { getAll } from '../../../../../lib/inventory';
import { money } from '../../../../../lib/constants';
import AdminNav from '../../../../../components/AdminNav';
import InvoiceEditor from '../../../../../components/InvoiceEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit invoice — Bargain Bay' };

export default async function EditInvoicePage({ params }) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/admin/invoices/${params.number}/edit`);
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
    </div></div>);
  }
  if (!hasDb()) return <div className="narrow"><div className="panel">Database not configured.</div></div>;

  const invoice = await getInvoiceByNumber(params.number).catch(() => null);
  if (!invoice) return notFound();

  if (invoice.status !== 'open') {
    return (
      <div>
        <AdminNav active="invoices" />
        <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Edit {invoice.number}</h1>
        <div className="error-box">
          This invoice is <b>{invoice.status}</b> and can&apos;t be edited — editing a paid invoice would desync the
          recorded sale. {invoice.status === 'paid' ? 'Refund it and reissue a corrected invoice instead.' : ''}
        </div>
        <p><a className="btn" href="/admin/invoices">← Back to invoices</a></p>
      </div>
    );
  }

  let inventory = [];
  try {
    inventory = (await getAll()).map((u) => ({
      id: u.id,
      description: `${u.title || `${u.make} ${u.model}`} (${u.id})`,
      price: Number(u.price) || 0,
      search: `${u.make || ''} ${u.model || ''} ${u.title || ''} ${u.category || ''} ${u.id || ''}`.toLowerCase()
    }));
  } catch { inventory = []; }

  const editorInvoice = {
    id: invoice.id, number: invoice.number, email: invoice.email,
    hst: invoice.hst, memo: invoice.memo, items: invoice.items
  };

  return (
    <div>
      <AdminNav active="invoices" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Edit {invoice.number}</h1>
      <p className="hint" style={{ marginTop: 0 }}>For <b>{invoice.name || invoice.email}</b> · current total {money(invoice.total)}</p>
      <div className="panel">
        <InvoiceEditor invoice={editorInvoice} inventory={inventory} />
      </div>
    </div>
  );
}
