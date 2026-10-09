import VendorNav from '../../components/VendorNav';
import VendorGateView from '../../components/VendorGateView';
import { vendorGate, cents } from '../../lib/vendor-page';
import { strikeMeter } from '../../lib/vendors';
import { vendorBalance } from '../../lib/vendor-ledger';
import { bankSummary } from '../../lib/vendor-bank';
import { listVendorListings } from '../../lib/marketplace-listings';
import { listVendorOrders } from '../../lib/vendor-orders';
import { ACCEPT_HOURS, READY_HOURS, STRIKE_REASONS, TIERS } from '../../lib/marketplace-rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vendor home — Bargain Bay Marketplace' };

const BANNER = {
  good: ['ok', 'Good standing'], warning: ['warn', 'Warning — you have a strike'],
  at_risk: ['warn', 'At risk — one more strike restricts your account'],
  restricted: ['warn', 'Restricted — you cannot list or sell new units'],
  suspended: ['warn', 'Suspended'], approved: ['ok', 'Good standing']
};

export default async function VendorHome() {
  const gate = await vendorGate('/vendor');
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor } = gate.ctx;
  const [meter, bal, bank, listings, orders] = await Promise.all([
    strikeMeter(vendor.id), vendorBalance(vendor.id), bankSummary(vendor.id), listVendorListings(vendor.id),
    listVendorOrders(vendor.id).catch(() => [])
  ]);
  const waiting = orders.filter((o) => o.status === 'awaiting_accept').length;
  const toReady = orders.filter((o) => o.status === 'accepted').length;
  const by = (s) => listings.filter((l) => l.status === s).length;
  const [tone, label] = BANNER[meter.standing] || ['ok', meter.standing];
  const todo = [];
  if (!bank.payable && !bank.waiting.length) todo.push({ text: 'Add your banking details so we can pay you.', href: '/vendor/payouts' });
  if (waiting) todo.push({ text: `${waiting} order(s) are waiting for you to accept — the 24-hour clock is running.`, href: '/vendor/orders' });
  if (toReady) todo.push({ text: `${toReady} accepted order(s) still need to be made ready (72-hour clock).`, href: '/vendor/orders' });
  if (by('changes_requested')) todo.push({ text: `${by('changes_requested')} listing(s) need changes before they can go live.`, href: '/vendor/listings?status=changes_requested' });
  if (by('draft')) todo.push({ text: `${by('draft')} draft listing(s) are not submitted yet.`, href: '/vendor/listings?status=draft' });
  if (by('awaiting_checkin')) todo.push({ text: `${by('awaiting_checkin')} approved unit(s) are waiting to be delivered to our warehouse.`, href: '/vendor/listings?status=awaiting_checkin' });

  return (
    <div>
      <VendorNav active="home" name={vendor.trade_name || vendor.legal_name} />
      <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`pill ${tone}`}>{label}</span>
        <span style={{ fontSize: 14 }}>Tier: <strong>{TIERS[vendor.tier]}</strong></span>
        <span style={{ fontSize: 14 }}>Strikes: <strong>{meter.active} of {meter.limit}</strong></span>
        <a href="/vendor/performance" style={{ marginLeft: 'auto', fontSize: 13 }}>See the rules and your record →</a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, marginBottom: 16 }}>
        <div className="kpi-card"><div className="kpi-value">{cents(bal.availableCents)}</div><div style={{ fontSize: 13 }}>Available to be paid</div></div>
        <div className="kpi-card"><div className="kpi-value">{cents(bal.pendingCents)}</div><div style={{ fontSize: 13 }}>Pending (held after delivery)</div></div>
        <div className="kpi-card"><div className="kpi-value">{cents(bal.reserveHeldCents)}</div><div style={{ fontSize: 13 }}>Warranty reserve (2%, 12 months)</div></div>
        <div className="kpi-card"><div className="kpi-value">{by('live')}</div><div style={{ fontSize: 13 }}>Units for sale · {by('in_review')} in review</div></div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Your to-do list</h2>
        {todo.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{todo.map((t) => <li key={t.text}><a href={t.href}>{t.text}</a></li>)}</ul>
          : <p style={{ margin: 0, fontSize: 14 }}>Nothing waiting on you.</p>}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Order deadlines</h2>
        <p style={{ marginTop: 0, fontSize: 14 }}>
          When a customer&rsquo;s payment is confirmed you are notified and two clocks start together:
          <strong> accept within {ACCEPT_HOURS} hours</strong> and <strong>have it ready (or tracking submitted) within {READY_HOURS} hours</strong>.
          Missing either, or cancelling a paid order, is a strike. Three strikes restrict the account.
        </p>
        <p style={{ marginBottom: 0, fontSize: 14 }}>
          {waiting + toReady > 0
            ? <><b>{waiting}</b> to accept · <b>{toReady}</b> to make ready — <a href="/vendor/orders">open your orders and see the countdowns →</a></>
            : <span style={{ color: 'var(--muted)' }}>No open orders. Each one shows a live countdown — green, amber under six hours, red when overdue. <a href="/vendor/orders">Orders →</a></span>}
        </p>
      </div>

      {meter.strikes.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 17 }}>Strikes on your record</h2>
          <div className="table-wrap"><table className="admin"><thead><tr><th>Date</th><th>Reason</th><th>Order</th><th>Status</th></tr></thead><tbody>
            {meter.strikes.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.issued_at).toISOString().slice(0, 10)}</td>
                <td>{STRIKE_REASONS[s.reason_code] || s.reason_code}{s.note ? ` — ${s.note}` : ''}</td>
                <td>{s.order_ref || '—'}</td>
                <td>{s.revised_at ? <span className="pill ok">Revised: {s.revised_reason}</span> : <span className="pill warn">Active</span>}</td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      )}
    </div>
  );
}
