import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth';
import { decorate } from '../../../../lib/pricing';
import { marketplaceUnits, publicVendor } from '../../../../lib/marketplace-storefront';
import { imageFor } from '../../../../lib/images';
import { groupByModel } from '../../../../lib/group-units';
import ProductCard from '../../../../components/ProductCard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const v = await publicVendor((await params).slug);
  return v ? { title: `${v.name} on Bargain Bay`, description: `Appliances sold by ${v.name}, delivered by Bargain Bay.` } : { title: 'Not found' };
}

// A seller's page: their name, since when, and their live units. No contact details — buyers deal
// with Bargain Bay, never off-platform.
export default async function VendorStorePage({ params }) {
  const { slug } = await params;
  const v = await publicVendor(slug);
  if (!v) notFound();
  const session = await getSession();
  const raw = await marketplaceUnits({ slug });
  const units = await decorate(raw.map((u) => ({ ...u, image: imageFor(u) })), session);
  const groups = groupByModel(units);
  return (
    <div>
      <a href="/marketplace" style={{ fontSize: 14 }}>← Marketplace</a>
      <h1 style={{ color: 'var(--charcoal)', marginBottom: 4 }}>{v.name}</h1>
      <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 14 }}>
        Approved seller on Bargain Bay{v.since ? ` since ${new Date(v.since).toISOString().slice(0, 7)}` : ''}{v.city ? ` · ${v.city}` : ''}
      </p>
      {groups.length === 0
        ? <div className="panel">Nothing for sale from this seller right now.</div>
        : <div className="grid">{groups.map((g) => <ProductCard key={g.rep.id} unit={g.rep} count={g.count} />)}</div>}
    </div>
  );
}
