import { redirect, notFound } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../../../lib/auth';
import { hasDb } from '../../../../../lib/db';
import { getInvoiceByNumber } from '../../../../../lib/invoices';
import { getAll } from '../../../../../lib/inventory';
import { money } from '../../../../../lib/constants';
import AdminNav from '../../../../../components/AdminNav';
import InvoiceEditor from '../../../../../components/InvoiceEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit invoice — Bargain Bay' };

export default async function EditInvoicePage({ params }) {
  const { number } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/admin/invoices/${number}/edit`);
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
    </div></div>);
  }
  if (!hasDb()) return <div className="narrow"><div className="panel">Database not configured.</div></div>;

  const invoice = await getInvoiceByNumber(number).catch(() => null);
  if (!invoice) return notFound();

  if (invoice.status !== 'open') {
    return (
      <div>
        <AdminNav active="invoices" salesOnly={!isAdmin(session)} />
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
    hst: invoice.hst, memo: invoice.memo, items: invoice.items,
    // Issued date shown in the editor (Toronto), so the owner can backdate a
    // sale that was rung up late.
    invoiceDate: invoice.created_at
      ? new Date(invoice.created_at).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
      : null
  };

  return (
    <div>
      <AdminNav active="invoices" salesOnly={!isAdmin(session)} />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Edit {invoice.number}</h1>
      <p className="hint" style={{ marginTop: 0 }}>For <b>{invoice.name || invoice.email}</b> · current total {money(invoice.total)}</p>
      <div className="panel">
        <InvoiceEditor invoice={editorInvoice} inventory={inventory} />
      </div>
    </div>
  );
}
