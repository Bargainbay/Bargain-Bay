import { notFound } from 'next/navigation';
import PolicyDoc from '../../../../components/PolicyDoc';
import { POLICY_BY_SLUG, isPublished } from '../../../../lib/marketplace-policies';

export async function generateMetadata({ params }) {
  const p = POLICY_BY_SLUG[(await params).slug];
  if (!p) return { title: 'Not found' };
  return {
    title: `${p.title} — Bargain Bay Marketplace`, description: p.summary,
    // A draft is not in force: keep it out of search engines.
    robots: isPublished(p) ? undefined : { index: false, follow: false }
  };
}

export default async function PolicyPage({ params }) {
  const p = POLICY_BY_SLUG[(await params).slug];
  if (!p) notFound();
  return (
    <div>
      <a href="/marketplace/policies" style={{ fontSize: 14 }}>← All marketplace policies</a>
      <PolicyDoc policy={p} />
    </div>
  );
}
