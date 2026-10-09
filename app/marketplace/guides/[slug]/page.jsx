import { notFound } from 'next/navigation';
import GuideDoc from '../../../../components/GuideDoc';
import { GUIDE_BY_SLUG } from '../../../../lib/marketplace-guides';

export async function generateMetadata({ params }) {
  const g = GUIDE_BY_SLUG[(await params).slug];
  return g ? { title: `${g.title} — Bargain Bay Marketplace`, description: g.summary } : { title: 'Not found' };
}

export default async function GuidePage({ params }) {
  const g = GUIDE_BY_SLUG[(await params).slug];
  if (!g) notFound();
  return (
    <div>
      <a href="/marketplace/guides" className="noprint" style={{ fontSize: 14 }}>← All seller guides</a>
      <GuideDoc guide={g} />
    </div>
  );
}
