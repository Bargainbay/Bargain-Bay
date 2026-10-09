import VendorApplyForm from '../../../components/VendorApplyForm';
import { WARRANTY_MONTHS, ACCEPT_HOURS, READY_HOURS, STRIKE_LIMIT, DEFAULT_COMMISSION_BPS } from '../../../lib/marketplace-rules';

export const metadata = { title: 'Sell on Bargain Bay', description: 'Apply to sell appliances to Bargain Bay customers across Durham Region and the GTA.' };

export default function SellPage() {
  return (
    <div className="narrow" style={{ maxWidth: 760 }}>
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Sell on Bargain Bay</h1>
        <p>Put your appliances in front of our customers across Pickering, Durham Region, Scarborough and the GTA — with our delivery team, our marketing and our name behind the sale.</p>
        <p style={{ fontSize: 14 }}><strong>How it works.</strong> We approve every vendor by hand. You list real units with real photos; we review each listing. When a customer pays, you have {ACCEPT_HOURS} hours to accept and {READY_HOURS} hours to have it ready — we collect and deliver it, or you ship it yourself once you reach Standard tier. We take {DEFAULT_COMMISSION_BPS / 100}% of the item price and pay you by direct deposit or wire.</p>
        <p style={{ fontSize: 14 }}><strong>What we ask.</strong> Every unit carries at least a {WARRANTY_MONTHS}-month warranty from you. Pre-owned units are sold as Refurbished and never described as new. {STRIKE_LIMIT} strikes (missed deadlines, cancellations, misdescribed units) restrict an account.</p>
      </div>
      <div className="panel"><VendorApplyForm /></div>
    </div>
  );
}
