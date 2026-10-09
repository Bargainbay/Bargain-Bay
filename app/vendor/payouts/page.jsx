import VendorNav from '../../../components/VendorNav';
import VendorGateView from '../../../components/VendorGateView';
import VendorBank from '../../../components/VendorBank';
import { vendorGate, cents } from '../../../lib/vendor-page';
import { vendorBalance, vendorStatement } from '../../../lib/vendor-ledger';
import { vendorPayouts } from '../../../lib/payouts';
import { bankSummary } from '../../../lib/vendor-bank';
import { secretsConfigured } from '../../../lib/secret-box';
import { holdDaysFor, WARRANTY_RESERVE_MONTHS } from '../../../lib/marketplace-rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payouts — Bargain Bay Marketplace' };

const KIND = {
  sale: 'Sale', lane_c_delivery: 'Delivery fee share', commission: 'Commission', delivery_service_fee: 'Delivery service fee',
  insurance: 'Shipment insurance', warranty_hold: 'Warranty reserve held', warranty_release: 'Warranty reserve released',
  refund: 'Refund', guarantee_claim: 'Guarantee claim', chargeback: 'Charge-back', adjustment: 'Adjustment',
  payout: 'Payout', payout_reversal: 'Payout returned'
};

export default async function Payouts() {
  const gate = await vendorGate('/vendor/payouts');
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor } = gate.ctx;
  const [bal, statement, payouts, bank] = await Promise.all([
    vendorBalance(vendor.id), vendorStatement(vendor.id, { limit: 100 }), vendorPayouts(vendor.id), bankSummary(vendor.id)
  ]);
  const hold = holdDaysFor(vendor.tier);
  return (
    <div>
      <VendorNav active="payouts" name={vendor.trade_name || vendor.legal_name} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, marginBottom: 16 }}>
        <div className="kpi-card"><div className="kpi-value">{cents(bal.availableCents)}</div><div style={{ fontSize: 13 }}>Available</div></div>
        <div className="kpi-card"><div className="kpi-value">{cents(bal.pendingCents)}</div><div style={{ fontSize: 13 }}>Pending ({hold} days after delivery)</div></div>
        <div className="kpi-card"><div className="kpi-value">{cents(bal.reserveHeldCents)}</div><div style={{ fontSize: 13 }}>Warranty reserve ({WARRANTY_RESERVE_MONTHS} months)</div></div>
        <div className="kpi-card"><div className="kpi-value">{cents(bal.paidOutCents)}</div><div style={{ fontSize: 13 }}>Paid to you so far</div></div>
      </div>

      <VendorBank initial={bank} isOwner={vendor.role === 'owner'} configured={secretsConfigured()} />

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Payouts</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
          Paid by direct deposit or wire once your balance is at least $50, after we approve the run.
          The first payout is checked by hand.
        </p>
        <div className="table-wrap"><table className="admin"><thead><tr><th>Proposed</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>
          {payouts.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>No payouts yet.</td></tr>}
          {payouts.map((p) => <tr key={p.id}><td>{new Date(p.proposed_at).toISOString().slice(0, 10)}</td><td>{cents(p.amount_cents)}</td><td>{p.status}</td><td>{p.paid_ref || '—'}</td></tr>)}
        </tbody></table></div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Statement</h2>
        <div className="table-wrap"><table className="admin"><thead><tr><th>Date</th><th>Entry</th><th>Order</th><th>Amount</th><th>Payable from</th></tr></thead><tbody>
          {statement.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>No activity yet.</td></tr>}
          {statement.map((s) => (
            <tr key={s.id}><td>{new Date(s.at).toISOString().slice(0, 10)}</td><td>{KIND[s.kind] || s.kind}{s.memo ? ` — ${s.memo}` : ''}</td>
              <td>{s.orderRef || '—'}</td><td style={{ color: s.amountCents < 0 ? 'var(--danger)' : undefined }}>{cents(s.amountCents)}</td>
              <td>{new Date(s.availableAt).toISOString().slice(0, 10)}</td></tr>
          ))}
        </tbody></table></div>
      </div>
    </div>
  );
}
