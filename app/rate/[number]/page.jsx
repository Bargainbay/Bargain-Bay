import RatingForm from '../../../components/RatingForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rate your order — Bargain Bay' };

export default async function RatePage({ params, searchParams }) {
  const { number } = await params;
  const sParams = await searchParams;
  const orderNumber = decodeURIComponent(number || '');
  const token = sParams?.t || '';
  return (
    <div className="narrow" style={{ maxWidth: 560, margin: '0 auto' }}>
      <RatingForm orderNumber={orderNumber} token={token} />
    </div>
  );
}
