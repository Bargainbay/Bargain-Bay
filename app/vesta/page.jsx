import { getAvailable } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import { decorate } from '../../lib/pricing';
import ProductCard from '../../components/ProductCard';
import { groupByModel } from '../../lib/group-units';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Vesta Kitchen — Range Hoods, Cooktops, Ranges & More | Bargain Bay',
  description:
    'The full Vesta Kitchen range at Bargain Bay: range hoods, cooktops, ranges, refrigerators, laundry and accessories, brand new. Delivery serving Pickering, Scarborough and the GTA.'
};

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default async function VestaPage() {
  const session = await getSession();
  const units = (await decorate(await getAvailable({ marketplace: true }), session)).filter((u) => u.vesta);
  // Category, then subcategory; in-stock first inside each, so the page leads with what can be bought.
  const cats = new Map();
  for (const u of units) {
    if (!cats.has(u.category)) cats.set(u.category, new Map());
    const subs = cats.get(u.category);
    const k = u.style || '';
    if (!subs.has(k)) subs.set(k, []);
    subs.get(k).push(u);
  }
  const order = [...cats.entries()].sort((a, b) => [...b[1].values()].flat().length - [...a[1].values()].flat().length);
  const inStock = units.filter((u) => u.inStock).length;

  return (
    <div className="it-page">
      <section className="it-hero vs-hero" style={{ backgroundImage: 'linear-gradient(90deg, rgba(14,12,10,.78) 0%, rgba(14,12,10,.4) 55%, rgba(14,12,10,.05) 100%), url(/brands/premium/vesta-hero.jpg)' }}>
        <div className="it-hero-inner">
          <span className="it-kicker">Vesta Kitchen</span>
          <h1>The complete Vesta range</h1>
          <p>Range hoods, cooktops, ranges, refrigeration, laundry and accessories. Every item is brand new and priced by Vesta, with delivery arranged by Bargain Bay across Pickering, Scarborough and the GTA.</p>
          <div className="it-stats">
            <span><b>{units.length}</b> products</span>
            <span><b>{inStock}</b> in stock</span>
            <span><b>New</b> in box</span>
          </div>
          <a className="it-cta" href="#range">Browse the range</a>
        </div>
      </section>

      <div id="range" className="vs-jump">
        {order.map(([c, subs]) => <a key={c} href={`#${slug(c)}`}>{c} ({[...subs.values()].flat().length})</a>)}
      </div>

      {units.length === 0 && (
        <div className="panel" style={{ marginTop: 18, color: 'var(--muted)' }}>
          The Vesta range is not available right now. <a href="/shop" style={{ textDecoration: 'underline' }}>Browse the full catalogue</a>.
        </div>
      )}

      {order.map(([c, subs]) => (
        <section key={c} id={slug(c)} className="it-section">
          <h2>{c}</h2>
          {[...subs.entries()].sort((a, b) => (a[0] === '') - (b[0] === '') || a[0].localeCompare(b[0])).map(([sub, list]) => (
            <div key={sub || 'all'}>
              {sub && subs.size > 1 && <div className="vs-sub">{sub}</div>}
              <div className="grid">
                {groupByModel([...list].sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price))
                  .map((g) => <ProductCard key={g.rep.id} unit={g.rep} count={g.count} />)}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
