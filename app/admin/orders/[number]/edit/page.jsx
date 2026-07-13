import { redirect, notFound } from 'next/navigation';
import { getSession, isAdmin } from '../../../../../lib/auth';
import { hasDb } from '../../../../../lib/db';
import { getOrderByNumber, orderInvoiceLink } from '../../../../../lib/orders';
import { getAll } from '../../../../../lib/inventory';
import { money, STATUS_LABELS } from '../../../../../lib/constants';
import AdminNav from '../../../../../components/AdminNav';
import OrderEditor from '../../../../../components/OrderEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit order — Bargain Bay' };

export default async function EditOrderPage({ params }) {
  const session = await getSession();
  if (!session) redirect(`/login?next=/admin/orders/${params.number}/edit`);
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
    </div></div>);
  }
  if (!hasDb()) return <div className="narrow"><div className="panel">Database not configured.</div></div>;

  const order = await getOrderByNumber(params.number).catch(() => null);
  if (!order) return notFound();
  const bridged = await orderInvoiceLink(order.id);

  let inventory = [];
  try {
    inventory = (await getAll()).map((u) => ({
      id: u.id,
      description: `${u.title || `${u.make} ${u.model}`} (${u.id})`,
      price: Number(u.price) || 0,
      search: `${u.make || ''} ${u.model || ''} ${u.title || ''} ${u.category || ''} ${u.id || ''}`.toLowerCase()
    }));
  } catch { inventory = []; }

  const items = order.items.map((it) => ({
    id: it.id, sku: it.sku, title: it.title, price: Number(it.price), cost: it.cost != null ? Number(it.cost) : null
  }));

  return (
    <div>
      <AdminNav active="operations" />
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>
          Edit {order.order_number}
          <span className={`status-chip status-${order.status}`} style={{ marginLeft: 10, verticalAlign: 'middle' }}>
            {STATUS_LABELS[order.status] || order.status}
          </span>
        </h1>
        <a href="/admin/operations" className="hint" style={{ textDecoration: 'underline' }}>← Back to Operations</a>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {money(Number(order.total))} · placed {new Date(order.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
        {order.payment_method ? ` · ${order.payment_method === 'in_person' ? 'in person' : 'e-transfer'}` : ''}
      </p>
      <OrderEditor
        order={{
          order_number: order.order_number, status: order.status,
          name: order.name, email: order.email, phone: order.phone,
          delivery_method: order.delivery_method, address: order.address, city: order.city, postal: order.postal,
          subtotal: Number(order.subtotal), hst: Number(order.hst), total: Number(order.total)
        }}
        initialItems={items}
        inventory={inventory}
        bridgedInvoice={bridged?.number || null}
      />
    </div>
  );
}
