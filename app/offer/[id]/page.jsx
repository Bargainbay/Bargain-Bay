import { offerByLink } from '../../../lib/member-offers';
import OfferStatus from '../../../components/OfferStatus';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your offer — Bargain Bay', robots: { index: false } };

export default async function OfferPage({ params, searchParams }) {
  const { id } = await params;
  const { t } = await searchParams;
  const o = await offerByLink(Number(id), String(t || ''));
  if (!o) return <div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Offer not found</h1><p>That link is not valid, or the offer has been removed.</p></div></div>;
  return (
    <div className="narrow">
      <h1 style={{ color: 'var(--charcoal)' }}>Your offer</h1>
      <OfferStatus offer={JSON.parse(JSON.stringify(o))} token={String(t)} />
    </div>
  );
}
