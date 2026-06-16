import { getAvailable, newestArrivals } from '../lib/inventory';
import { getSession } from '../lib/auth';
import { decorate } from '../lib/pricing';
import { COLLECTIONS, collectionFilter, money } from '../lib/constants';
import ProductCard from '../components/ProductCard';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Bargain Bay — Discount Appliances Hamilton & Scarborough | Tested & Working',
  description:
    'Name-brand appliances. Liquidation prices. Every unit tested & working with a one-year warranty — pickup, delivery & freight serving Hamilton, Scarborough and the GTA.',
  alternates: { canonical: '/' }
};

// Fallback per-category line-art if no real product photo is available.
const TILE_FALLBACK = {
  'refrigerators': '/stock/refrigerator.svg',
  'washers-dryers': '/stock/washer.svg',
  'dishwashers': '/stock/dishwasher.svg',
  'ranges-ovens': '/stock/range.svg',
  'microwaves-hoods': '/stock/microwave.svg',
  'under-500': '/stock/appliance.svg'
};

// Pick a real representative product photo for each category tile: the
// priciest available unit in the collection that has actual photography
// (image not a placeholder .svg). Falls back to the category line-art.
function tileImage(slug, units) {
  const match = units
    .filter(collectionFilter(slug))
    .filter((u) => u.image && !u.image.endsWith('.svg'))
    .sort((a, b) => (b.price || 0) - (a.price || 0))[0];
  return match ? match.image : TILE_FALLBACK[slug];
}

export default async function Home() {
  const session = await getSession();
  const units = await decorate(await getAvailable(), session);
  const newest = newestArrivals(units, 12);
  const clearance = units.filter((u) => u.onClearance);
  const tileImages = Object.fromEntries(COLLECTIONS.map((c) => [c.slug, tileImage(c.slug, units)]));
  const topClearanceOff = clearance.reduce(
    (m, u) => Math.max(m, u.compareAt > u.price ? Math.round((1 - u.price / u.compareAt) * 100) : 0), 0
  );

  return (
    <div>
      <section className="hero">
        <img
          src="/bargain-bay-hero-wide.jpg"
          alt="Rows of tested name-brand appliances at the Bargain Bay warehouse"
          className="hero-bg"
        />
        <div className="hero-inner">
          <h1>Name-brand appliances. <em>Liquidation prices.</em></h1>
          <p>
            Overstock, open-box, and lightly-used fridges, washers, ranges and more — every unit
            tested, working, and backed by a one-year warranty. Pickup or delivery across Hamilton,
            Scarborough and the GTA.
          </p>
          <div className="btn-row">
            <a href="/shop" className="btn accent">Shop all appliances</a>
            <a href="/shop?collection=under-500" className="btn">Deals under $500</a>
          </div>
        </div>
      </section>

      {clearance.length > 0 && (
        <a href="/clearance" className="clearance-banner" aria-label="Shop clearance">
          <div className="clearance-banner-txt">
            <span className="clearance-kicker">Clearance · while they last</span>
            <strong>
              {clearance.length} unit{clearance.length === 1 ? '' : 's'} marked down
              {topClearanceOff > 0 ? ` — up to ${topClearanceOff}% off retail` : ''}
            </strong>
            <span className="clearance-banner-sub">Heavy markdowns on tested units · full one-year warranty</span>
          </div>
          <span className="clearance-banner-cta">Shop clearance →</span>
        </a>
      )}

      <div className="trust-strip">
        <div className="item"><span className="ico">✓</span><div><b>Tested &amp; working</b><span>Every unit is bench-tested before it&apos;s listed.</span></div></div>
        <div className="item"><span className="ico">①</span><div><b>One-year warranty</b><span>Buy with confidence, not &quot;as-is&quot; worry.</span></div></div>
        <div className="item"><span className="ico">⇄</span><div><b>Pickup, delivery &amp; freight</b><span>Free warehouse pickup, flat-fee local delivery, freight for the big stuff — Hamilton / GTA.</span></div></div>
      </div>

      <div className="section-head">
        <h2>Shop by category</h2>
        <a href="/shop">View all →</a>
      </div>
      <div className="tile-grid">
        {COLLECTIONS.map((c) => {
          const count = units.filter(collectionFilter(c.slug)).length;
          return (
            <a key={c.slug} href={`/shop?collection=${c.slug}`} className="cat-tile">
              <span className="cat-thumb"><img src={tileImages[c.slug]} alt="" aria-hidden="true" loading="lazy" /></span>
              <span className="cat-label">{c.label}</span>
              <span className="count">{count} available</span>
            </a>
          );
        })}
      </div>

      <div className="section-head">
        <h2>New arrivals</h2>
        <a href="/shop">View all →</a>
      </div>
      <div className="grid">
        {newest.map((u) => <ProductCard key={u.id} unit={u} />)}
      </div>

      <div className="panel" style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 17 }}>Why Bargain Bay</h2>
        <p style={{ fontSize: 14.5, margin: '8px 0' }}>
          We&apos;re the liquidation arm of RS Solutions. We buy overstock, open-box, and lightly-used
          appliances from major retailers and distributors, put every one through a working test, and
          pass the savings straight to you. Same brands you&apos;d pay full price for — Frigidaire, LG,
          Samsung, Bosch, KitchenAid, Whirlpool, Bertazzoni and more — for a fraction of retail,
          serving Hamilton, Scarborough and the GTA.
        </p>
        <p style={{ fontSize: 14.5, margin: '8px 0' }}>
          <b>How it works:</b> Browse — every listing shows the make, model, condition, and price; one
          of each, so when it&apos;s gone, it&apos;s gone. Buy — secure checkout online, or reserve and
          pay on pickup. Get it home — free pickup from our Lynden (Hamilton) warehouse, flat-fee local
          delivery, or a freight quote for oversized and out-of-area orders.
        </p>
        <p style={{ fontSize: 14.5, margin: '8px 0 0' }}>
          Every appliance comes with a <b>one-year warranty</b>. If a covered unit stops working within
          a year of purchase, we&apos;ll repair or replace it. Liquidation pricing, full peace of mind.
        </p>
      </div>
    </div>
  );
}
