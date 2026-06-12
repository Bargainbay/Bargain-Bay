import { getAvailable, newestArrivals } from '../lib/inventory';
import { COLLECTIONS, collectionFilter } from '../lib/constants';
import ProductCard from '../components/ProductCard';

export const dynamic = 'force-dynamic';

const TILE_IMG = {
  'refrigerators': '/stock/refrigerator.svg',
  'washers-dryers': '/stock/washer.svg',
  'dishwashers': '/stock/dishwasher.svg',
  'ranges-ovens': '/stock/range.svg',
  'microwaves-hoods': '/stock/microwave.svg',
  'under-500': '/stock/_default.svg'
};

export default async function Home() {
  const units = await getAvailable();
  const newest = newestArrivals(units, 12);

  return (
    <div>
      <section className="hero">
        <h1>Name-brand appliances. Tested. <em>Up to 60% off retail.</em></h1>
        <p>
          Every unit is bench-tested and certified working before it hits the floor.
          One-of-a-kind fridges, washers, dryers, ranges and more — new lots every week
          at our Lynden warehouse, minutes from Hamilton.
        </p>
        <div className="btn-row">
          <a href="/shop" className="btn accent">Shop all {units.length} units</a>
          <a href="/shop?collection=under-500" className="btn" style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.4)' }}>
            Deals under $500
          </a>
        </div>
      </section>

      <div className="tile-grid">
        {COLLECTIONS.map((c) => {
          const count = units.filter(collectionFilter(c.slug)).length;
          return (
            <a key={c.slug} href={`/shop?collection=${c.slug}`} className="cat-tile">
              <img src={TILE_IMG[c.slug]} alt="" aria-hidden="true" />
              {c.label}
              <span className="count">{count} available</span>
            </a>
          );
        })}
      </div>

      <div className="trust-strip">
        <div className="item"><span className="ico">✔️</span><div><b>Tested &amp; certified working</b><span>Every unit bench-tested by our technicians before listing.</span></div></div>
        <div className="item"><span className="ico">🚚</span><div><b>Local pickup or delivery</b><span>Free warehouse pickup, or flat-rate delivery in Hamilton &amp; area.</span></div></div>
        <div className="item"><span className="ico">🧾</span><div><b>HST included at checkout</b><span>13% Ontario HST calculated up front — no surprises.</span></div></div>
      </div>

      <div className="section-head">
        <h2>Newest arrivals</h2>
        <a href="/shop">View all →</a>
      </div>
      <div className="grid">
        {newest.map((u) => <ProductCard key={u.id} unit={u} />)}
      </div>
    </div>
  );
}
