import VendorApplyForm from '../../../components/VendorApplyForm';
import { requiredPolicies } from '../../../lib/marketplace-policies';

export const metadata = { title: 'Sell on Bargain Bay', description: 'Apply to sell appliances to Bargain Bay customers across Durham Region and the GTA.' };

export default function SellPage() {
  // What a seller accepts on this form: every required policy at its current version, shown in one scroll box.
  const policies = requiredPolicies().map((p) => ({ slug: p.slug, title: p.title, version: p.version, sections: p.sections() }));
  return (
    <div className="narrow" style={{ maxWidth: 760 }}>
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Sell on Bargain Bay</h1>
        <ul style={{ fontSize: 18, lineHeight: 1.7, margin: '0 0 12px', paddingLeft: 22 }}>
          <li>Reach GTA buyers.</li>
          <li>We market and deliver.</li>
          <li>Get paid fast.</li>
        </ul>
        <p style={{ fontSize: 14, margin: 0 }}>Fees and standards are in the <a href="/marketplace/policies">policies</a>.</p>
      </div>
      <p style={{ fontSize: 14 }}>Not sure yet? Read the <a href="/marketplace/guides/getting-started">getting-started guide</a>, the <a href="/marketplace/guides/packing-and-handover">packing guide</a> and the <a href="/marketplace/policies">policies</a> — everything is out in the open.</p>
      <div className="panel"><VendorApplyForm policies={policies} /></div>
    </div>
  );
}
