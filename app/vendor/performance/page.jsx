import VendorNav from '../../../components/VendorNav';
import VendorGateView from '../../../components/VendorGateView';
import { vendorGate } from '../../../lib/vendor-page';
import { strikeMeter } from '../../../lib/vendors';
import {
  ACCEPT_HOURS, READY_HOURS, CLAIM_RESPOND_HOURS, CLAIM_RESOLVE_DAYS, STRIKE_LIMIT, STRIKE_REASONS, WARRANTY_MONTHS, TIERS, HOLD_DAYS_BY_TIER
} from '../../../lib/marketplace-rules';
import { TIER_LIMITS } from '../../../lib/listing-rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Performance — Bargain Bay Marketplace' };

export default async function Performance() {
  const gate = await vendorGate('/vendor/performance');
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor } = gate.ctx;
  const meter = await strikeMeter(vendor.id);
  const lim = TIER_LIMITS[vendor.tier];
  return (
    <div>
      <VendorNav active="performance" name={vendor.trade_name || vendor.legal_name} />
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>The standards</h2>
        <div className="table-wrap"><table className="admin"><thead><tr><th>Rule</th><th>Standard</th><th>If missed</th></tr></thead><tbody>
          <tr><td>Accept an order</td><td>Within {ACCEPT_HOURS} hours of being notified</td><td>Order cancelled, customer refunded, strike</td></tr>
          <tr><td>Order ready</td><td>Within {READY_HOURS} hours of payment confirmation (tracking submitted if you ship yourself)</td><td>Customer may cancel for a full refund, strike</td></tr>
          <tr><td>Cancel a paid order</td><td>Allowed (e.g. out of stock), customer refunded in full</td><td>A strike, every time</td></tr>
          <tr><td>Unit as described</td><td>Matches the listing when we receive it</td><td>Strike and charge-back</td></tr>
          <tr><td>Warranty</td><td>Every unit carries at least {WARRANTY_MONTHS} months from you; respond to a claim in {CLAIM_RESPOND_HOURS} hours and resolve it in {CLAIM_RESOLVE_DAYS} days (see <a href="/vendor/claims">Claims</a>)</td><td>Strike; the 2% reserve funds the claim</td></tr>
        </tbody></table></div>
        <p style={{ fontSize: 14, marginBottom: 0 }}>
          {STRIKE_LIMIT} active strikes restrict your account (no new listings or sales; paid orders must still be fulfilled).
          Strikes do not expire on a timer — management reviews them and may remove one, with a reason on record.
          Passing a used unit off as new, stolen or counterfeit goods, falsified documents or concealing a safety defect
          are immediate removal.
        </p>
      </div>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Your tier: {TIERS[vendor.tier]}</h2>
        <p style={{ fontSize: 14, margin: 0 }}>
          You can list up to {lim.maxUnits} units at once in Lane{lim.lanes.length > 1 ? 's' : ''} {lim.lanes.join(', ')}.
          Payouts are released {HOLD_DAYS_BY_TIER[vendor.tier]} days after delivery. Self-shipping opens at Standard tier.
          Tiers are earned from a clean record.
        </p>
      </div>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Strike meter: {meter.active} of {meter.limit}</h2>
        {meter.strikes.length === 0 ? <p style={{ margin: 0, fontSize: 14 }}>No strikes. Keep it that way.</p> : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {meter.strikes.map((s) => (
              <li key={s.id}>{new Date(s.issued_at).toISOString().slice(0, 10)} — {STRIKE_REASONS[s.reason_code]}{s.order_ref ? ` (${s.order_ref})` : ''}
                {s.revised_at ? <> · <em>revised: {s.revised_reason}</em></> : <> · <strong>active</strong></>}</li>
            ))}
          </ul>
        )}
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 0 }}>
          Order-level scorecards (time to accept, on-time ready, cancellations) appear here once you have orders.
        </p>
      </div>
    </div>
  );
}
