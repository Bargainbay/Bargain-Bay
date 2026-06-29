import RatingForm from '../../../components/RatingForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rate your order — Bargain Bay' };

export default function RatePage({ params, searchParams }) {
  const orderNumber = decodeURIComponent(params.number || '');
  const token = searchParams?.t || '';
  return (
    <div className="narrow" style={{ maxWidth: 560, margin: '0 auto' }}>
      <RatingForm orderNumber={orderNumber} token={token} />
    </div>
  );
}
