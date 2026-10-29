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
        <p style={{ fontSize: 18, margin: '0 0 14px', color: 'var(--muted)' }}>Turn your appliances into sales.</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 14px', display: 'grid', gap: 10, fontSize: 18 }}>
          <li>🚚&nbsp; <strong>We deliver</strong> every sale</li>
          <li>📣&nbsp; <strong>We market</strong> your listings</li>
          <li>💸&nbsp; <strong>You get paid</strong> by direct deposit</li>
        </ul>
        <p style={{ fontSize: 14, margin: 0 }}>Fees and standards are in the <a href="/marketplace/policies">policies</a>.</p>
      </div>
      <p style={{ fontSize: 14 }}>Not sure yet? Read the <a href="/marketplace/guides/getting-started">getting-started guide</a>, the <a href="/marketplace/guides/packing-and-handover">packing guide</a> and the <a href="/marketplace/policies">policies</a> — everything is out in the open.</p>
      <div className="panel"><VendorApplyForm policies={policies} /></div>
    </div>
  );
}
