import { getSession } from '../../lib/auth';
import { decorate } from '../../lib/pricing';
import { marketplaceUnits, vendorsWithStock, storefrontOn } from '../../lib/marketplace-storefront';
import { imageFor } from '../../lib/images';
import { groupByModel } from '../../lib/group-units';
import ProductCard from '../../components/ProductCard';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Marketplace — appliances from trusted sellers',
  description: 'Appliances from vetted sellers, delivered by Bargain Bay across Pickering, Durham Region, Scarborough and the GTA.'
};

export default async function MarketplacePage() {
  if (!storefrontOn()) {
    return (
      <div className="narrow" style={{ maxWidth: 680 }}><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Marketplace</h1>
        <p>We are opening our marketplace to vetted sellers soon. Want to sell with us?</p>
        <a className="btn primary" href="/marketplace/sell">Apply to sell on Bargain Bay</a>
      </div></div>
    );
  }
  const session = await getSession();
  const [vendors, raw] = await Promise.all([vendorsWithStock(), marketplaceUnits()]);
  const units = (await decorate(raw.map((u) => ({ ...u, image: imageFor(u) })), session));
  const groups = groupByModel(units);
  return (
    <div>
      <h1 style={{ color: 'var(--charcoal)' }}>Marketplace</h1>
      <p style={{ maxWidth: 680 }}>Appliances from sellers we have vetted and approved. Each unit is one-of-a-kind, described and backed by its seller with at least a 12-month warranty, and delivered by Bargain Bay.</p>
      {vendors.length > 0 && (
        <p style={{ fontSize: 14 }}>Sellers: {vendors.map((v, i) => (
          <span key={v.slug}>{i > 0 ? ' · ' : ''}<a href={`/marketplace/v/${v.slug}`}>{v.name}</a> ({v.units})</span>
        ))}</p>
      )}
      {groups.length === 0
        ? <div className="panel">No marketplace units right now — check back soon, or <a href="/shop">browse our own stock</a>.</div>
        : <div className="grid">{groups.map((g) => <ProductCard key={g.rep.id} unit={g.rep} count={g.count} />)}</div>}
      <p style={{ marginTop: 24, fontSize: 14 }}>Have appliances to sell? <a href="/marketplace/sell">Apply to sell on Bargain Bay</a>.</p>
    </div>
  );
}
