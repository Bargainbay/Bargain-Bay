import { GUIDES } from '../../../lib/marketplace-guides';

export const metadata = { title: 'Seller guides — Bargain Bay Marketplace', description: 'How to get started, photograph and pack appliances for the Bargain Bay marketplace.' };

export default function GuidesIndex() {
  return (
    <div className="prose">
      <a href="/marketplace" style={{ fontSize: 14 }}>← Marketplace</a>
      <h1>Seller guides</h1>
      <p>Practical how-tos for selling on Bargain Bay. The rules themselves are in the <a href="/marketplace/policies">marketplace policies</a>.</p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {GUIDES.map((g) => (
          <li key={g.slug} style={{ marginBottom: 14 }}>
            <a href={`/marketplace/guides/${g.slug}`}><b>{g.title}</b></a>
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>{g.summary}</div>
          </li>
        ))}
      </ul>
      <p>Want to sell with us? <a href="/marketplace/sell">Apply to sell on Bargain Bay</a>.</p>
    </div>
  );
}
