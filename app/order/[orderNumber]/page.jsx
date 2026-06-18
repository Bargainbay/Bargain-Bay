import { notFound } from 'next/navigation';
import { hasDb } from '../../../lib/db';
import { getOrderByNumber } from '../../../lib/orders';
import { getSession } from '../../../lib/auth';
import { money, STATUS_LABELS, PICKUP_ADDRESS, SALES_EMAIL, ETRANSFER_EMAIL } from '../../../lib/constants';
import { availableSlots, pickupLabel } from '../../../lib/pickup';
import PixelPurchase from '../../../components/PixelPurchase';
import PickupBooker from '../../../components/PickupBooker';
import OrderLiveRefresh from '../../../components/OrderLiveRefresh';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Order Status — Bargain Bay' };

function timelineSteps(order) {
  const pickup = order.delivery_method !== 'delivery';
  return [
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'ready', label: pickup ? 'Ready for pickup' : 'Ready' },
    { key: 'out_for_delivery', label: pickup ? 'Pickup scheduled' : 'Out for delivery' },
    { key: 'delivered', label: pickup ? 'Picked up' : 'Delivered' }
  ];
}

export default async function OrderPage({ params, searchParams }) {
  if (!hasDb()) {
    return <div className="narrow"><div className="panel">Order tracking is not available — database not configured.</div></div>;
  }
  const order = await getOrderByNumber(params.orderNumber).catch(() => null);
  if (!order) return notFound();

  // Access: logged-in owner, or guest with matching ?email=
  const session = await getSession();
  const guestEmail = String(searchParams?.email || '').trim().toLowerCase();
  const owns =
    (session && order.user_id && session.userId === order.user_id) ||
    (session && session.email?.toLowerCase() === order.email?.toLowerCase()) ||
    (guestEmail && guestEmail === order.email?.toLowerCase());
  if (!owns) {
    return (
      <div className="narrow">
        <div className="panel">
          <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Find your order</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)' }}>
            To view order <b>{params.orderNumber}</b>, <a href={`/login?next=/order/${params.orderNumber}`} style={{ textDecoration: 'underline' }}>log in</a>,
            or open the tracking link from your confirmation (it includes your email), e.g.:
          </p>
          <form method="GET" action={`/order/${params.orderNumber}`}>
            <div className="field">
              <label htmlFor="track-email">Email used on the order</label>
              <input id="track-email" name="email" type="email" required placeholder="you@example.com" />
            </div>
            <button className="btn primary block">View order</button>
          </form>
        </div>
      </div>
    );
  }

  const steps = timelineSteps(order);
  // An offline order is "Confirmed" the moment it's placed; payment is a separate
  // pending→paid state shown as a badge. So pending_payment lights the Confirmed
  // step, and marking it paid advances the order to Ready (for pickup/delivery).
  const STAGE_INDEX = { pending_payment: 0, confirmed: 0, ready: 1, out_for_delivery: 2, delivered: 3 };
  const reached = STAGE_INDEX[order.status] ?? -1;
  const pickup = order.delivery_method !== 'delivery';
  const cancelled = order.status === 'cancelled';
  const pendingPayment = order.status === 'pending_payment';
  const justPaid = searchParams?.status === 'success';

  // Pickup self-scheduling opens once a pickup order is Ready.
  const showPickupBooker = pickup && order.status === 'ready';
  const slots = showPickupBooker ? await availableSlots() : [];

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ color: 'var(--charcoal)' }}>Order {order.order_number}</h1>
      <div style={{ marginBottom: 8 }}>
        {pendingPayment ? (
          <>
            <span className="status-chip status-confirmed">Confirmed</span>
            <span className="pill warn" style={{ marginLeft: 8 }}>Pending payment</span>
          </>
        ) : (
          <span className={`status-chip status-${order.status}`}>{STATUS_LABELS[order.status]}</span>
        )}
        <span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 10 }}>
          Placed {new Date(order.created_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}
        </span>
      </div>
      <OrderLiveRefresh orderNumber={order.order_number} email={guestEmail} status={order.status} />

      {justPaid && !cancelled && (
        <PixelPurchase
          orderNumber={order.order_number}
          ids={order.items.map((i) => i.sku)}
          value={Number(order.total)}
          email={order.email}
        />
      )}
      {justPaid && !cancelled && (
        <div className="notice-box">Payment received — thank you! We&apos;ll email you to schedule {order.delivery_method === 'delivery' ? 'delivery' : 'pickup'}.</div>
      )}
      {order.status === 'confirmed' && !justPaid && (
        <div className="notice-box">
          Payment received — thank you! We&apos;re preparing your order and will email {order.email} as soon as it&apos;s
          ready for {pickup ? 'pickup' : 'delivery'}.
        </div>
      )}
      {['ready', 'out_for_delivery'].includes(order.status) && !justPaid && (
        <div className="notice-box">
          Payment received — your order is {pickup ? 'ready for pickup' : 'ready for delivery'}. We&apos;ll
          email {order.email} to arrange {pickup ? 'a pickup time' : 'delivery'}.
        </div>
      )}
      {pendingPayment && !justPaid && (
        <div className="notice-box" style={{ lineHeight: 1.6 }}>
          {order.payment_method === 'in_person' ? (
            <>
              <b>Payment due {order.delivery_method === 'delivery' ? 'on delivery' : 'on pickup'}.</b><br />
              Pay <b>{money(order.total)}</b> by cash, debit, or credit card in person
              {order.delivery_method === 'delivery' ? ' when we deliver' : ' when you pick up'}.
              Your {order.items.length === 1 ? 'unit is' : 'units are'} held for you — we&apos;ll email {order.email} to arrange a time.
            </>
          ) : (
            <>
              <b>Payment due — Interac e-Transfer.</b><br />
              Send <b>{money(order.total)}</b> to <b>{ETRANSFER_EMAIL}</b> (auto-deposit — no security question).
              Put your order number <b>{order.order_number}</b> in the message. We&apos;ll hold your
              {order.items.length === 1 ? ' unit' : ' units'} for 24 hours and confirm as soon as payment is applied.
              Orders with non payment will automatically be cancelled after 24 hours.
            </>
          )}
        </div>
      )}
      {cancelled && <div className="error-box">This order was cancelled. Questions? Email {SALES_EMAIL}.</div>}

      {!cancelled && (
        <div className="panel">
          <div className="timeline">
            {steps.map((s, i) => {
              const done = reached > i || order.status === 'delivered';
              const current = reached === i;
              return (
                <div className={'tl-step' + (done ? ' done' : '') + (current ? ' current' : '')} key={s.key}>
                  <div className="tl-col">
                    <div className="tl-dot">{done ? '✓' : ''}</div>
                    {i < steps.length - 1 && <div className="tl-bar" />}
                  </div>
                  <div className="tl-label">{s.label}</div>
                </div>
              );
            })}
          </div>
          {!pickup && order.delivery_date && order.status !== 'delivered' && (
            <p style={{ margin: '12px 0 0', fontSize: 14 }}>
              <b>{order.status === 'out_for_delivery' ? 'Out for delivery today' : 'Scheduled delivery'}:</b>{' '}
              {new Date(order.delivery_date).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}
              <span style={{ color: 'var(--muted)' }}> — we&apos;ll call {order.phone || 'you'} with a window.</span>
            </p>
          )}
        </div>
      )}

      {showPickupBooker && (
        <PickupBooker
          orderNumber={order.order_number}
          email={order.email}
          slots={slots}
          currentValue={order.pickup_slot || ''}
          currentLabel={pickupLabel(order.pickup_slot)}
        />
      )}

      <div className="panel">
        <h2>Items</h2>
        {order.items.map((it) => (
          <div className="summary-row" key={it.id}>
            <span>{it.title} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({it.sku})</span></span>
            <span>{money(it.price)}</span>
          </div>
        ))}
        <div className="summary-row" style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 10 }}>
          <span>Subtotal</span><span>{money(order.subtotal)}</span>
        </div>
        <div className="summary-row">
          <span>{order.delivery_method === 'delivery' ? 'Local delivery' : 'Warehouse pickup'}</span>
          <span>{order.delivery_method === 'delivery' ? money(Number(order.total) - Number(order.subtotal) - Number(order.hst)) : 'Free'}</span>
        </div>
        <div className="summary-row"><span>HST (13%)</span><span>{money(order.hst)}</span></div>
        <div className="summary-row total"><span>Total</span><span>{money(order.total)}</span></div>
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
          RS Solutions Inc. — GST/HST # 708490016 RT0001. This page is your receipt; keep your order number for reference.
        </p>
      </div>

      <div className="panel">
        <h2>{order.delivery_method === 'delivery' ? 'Delivery details' : 'Pickup details'}</h2>
        {order.delivery_method === 'delivery' ? (
          <p style={{ margin: 0, fontSize: 14.5 }}>
            {order.address}, {order.city}, ON {order.postal}<br />
            <span style={{ color: 'var(--muted)', fontSize: 13.5 }}>We&apos;ll call {order.phone || 'you'} to arrange a delivery window. Delivery is to your door / ground floor.</span>
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 14.5 }}>
            {PICKUP_ADDRESS}<br />
            <span style={{ color: 'var(--muted)', fontSize: 13.5 }}>By appointment — we&apos;ll email {order.email} to schedule. Bring photo ID and a vehicle suited to the appliance.</span>
          </p>
        )}
      </div>

      <p className="hint">Questions about this order? Email <a href={`mailto:${SALES_EMAIL}`} style={{ textDecoration: 'underline' }}>{SALES_EMAIL}</a> with your order number.</p>
    </div>
  );
}
