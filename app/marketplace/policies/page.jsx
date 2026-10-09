import { POLICIES, AUDIENCE, isPublished } from '../../../lib/marketplace-policies';

export const metadata = { title: 'Marketplace policies — Bargain Bay', description: 'The rules for selling on, and buying from, the Bargain Bay marketplace.' };

export default function PoliciesIndex() {
  const group = (aud) => POLICIES.filter((p) => isPublished(p) && (aud === 'vendors' ? p.audience === 'vendors' || p.audience === 'both' : p.audience === 'customers' || p.audience === 'both'));
  const drafts = POLICIES.filter((p) => !isPublished(p));
  const Row = ({ p }) => (
    <li style={{ marginBottom: 10 }}>
      <a href={`/marketplace/policies/${p.slug}`}><b>{p.title}</b></a>
      <div style={{ fontSize: 14, color: 'var(--muted)' }}>{p.summary}</div>
    </li>
  );
  return (
    <div className="prose">
      <a href="/marketplace" style={{ fontSize: 14 }}>← Marketplace</a>
      <h1>Marketplace policies</h1>
      <p>How selling on Bargain Bay works, in plain language. Sellers accept the policies marked as required in their dashboard before they can list.</p>
      <h2>For sellers</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>{group('vendors').map((p) => <Row key={p.slug} p={p} />)}</ul>
      <h2>For customers</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>{group('customers').map((p) => <Row key={p.slug} p={p} />)}
        <li style={{ marginBottom: 10 }}><a href="/policies/returns"><b>Returns &amp; Refund Policy</b></a><div style={{ fontSize: 14, color: 'var(--muted)' }}>Applies to every unit, including marketplace units.</div></li>
      </ul>
      {drafts.length > 0 && (
        <>
          <h2>Drafts, not yet in force</h2>
          <p style={{ fontSize: 14 }}>These are written but waiting for review. They do not bind anyone yet.</p>
          <ul style={{ listStyle: 'none', padding: 0 }}>{drafts.map((p) => <Row key={p.slug} p={p} />)}</ul>
        </>
      )}
      <p style={{ marginTop: 24 }}>Want to sell with us? <a href="/marketplace/sell">Apply to sell on Bargain Bay</a>.</p>
    </div>
  );
}
