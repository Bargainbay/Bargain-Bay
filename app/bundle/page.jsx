import { getAvailable } from '../../lib/inventory';
import { decorate } from '../../lib/pricing';
import { getSession } from '../../lib/auth';
import BundleBuilder from '../../components/BundleBuilder';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Build a bundle — get a package quote',
  description: 'Furnishing a whole kitchen or laundry? Pick the appliances you need and get a custom package price. Bundles save more.'
};

export default async function BundlePage() {
  const session = await getSession();
  let units = [];
  try {
    units = (await decorate(await getAvailable(), session)).map((u) => ({
      id: u.id,
      title: u.title || `${u.make} ${u.model}`,
      make: u.make,
      model: u.model,
      category: u.category,
      condition: u.condition,
      price: Number(u.price) || 0,
      compareAt: Number(u.compareAt) || 0,
      image: u.image,
      search: `${u.make || ''} ${u.model || ''} ${u.title || ''} ${u.category || ''} ${u.id || ''}`.toLowerCase()
    }));
  } catch { units = []; }
  const user = session ? { name: session.name || '', email: session.email || '' } : null;

  return (
    <div>
      <h1 style={{ color: 'var(--charcoal)' }}>Build your bundle</h1>
      <p style={{ color: 'var(--muted)', maxWidth: 640 }}>
        Furnishing a whole kitchen or laundry room? Add the appliances you need and we&apos;ll send you a
        custom package price — bundles save more. Nothing is reserved; we&apos;ll confirm availability when we
        send your quote.
      </p>
      <BundleBuilder units={units} user={user} />
    </div>
  );
}
