import { getAvailable } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import { decorate } from '../../lib/pricing';
import { money } from '../../lib/constants';
import ProductCard from '../../components/ProductCard';
import { groupByModel } from '../../lib/group-units';
import { PREMIUM_BRANDS, premiumRank } from '../../lib/premium-brands';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Premium Brand Appliances — Bertazzoni, Fulgor Milano, JennAir, Café & more | Bargain Bay',
  description:
    'High-end kitchen appliances from the finest brands at liquidation prices. Tested and backed by a one-year warranty. Pickup, delivery and freight serving Pickering, Scarborough and the GTA.'
};

const SCENES = [
  { src: '/brands/premium/range.jpg', title: 'Cook on a range that looks the part', text: 'Professional-style gas and induction ranges in stainless steel.' },
  { src: '/brands/premium/column.jpg', title: 'Refrigeration that disappears into the cabinetry', text: 'Built-in units sit flush with your design instead of interrupting it.' },
  { src: '/brands/premium/laundry.jpg', title: 'Even the laundry room', text: 'Compact front-load washers that look as good as they perform.' }
];

export default async function PremiumPage() {
  const session = await getSession();
  const all = await decorate(await getAvailable({ marketplace: true }), session);
  const premium = all.filter((u) => !u.vesta && premiumRank(u.make) >= 0);
  // One section per make that has stock, in the order of the list; the section is titled with the make as the tracker spells it.
  const byMake = new Map();
  for (const u of premium) {
    const k = premiumRank(u.make);
    if (!byMake.has(k)) byMake.set(k, { name: String(u.make).replace(/^Cafe$/i, 'Café'), units: [] });
    byMake.get(k).units.push(u);
  }
  const sections = [...byMake.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  const saved = premium.reduce((n, u) => n + Math.max(0, (u.compareAt || u.price) - u.price), 0);

  return (
    <div className="it-page">
      <section className="it-hero" style={{ backgroundImage: 'linear-gradient(90deg, rgba(14,12,10,.86) 0%, rgba(14,12,10,.45) 55%, rgba(14,12,10,.1) 100%), url(/brands/premium/hero.jpg)' }}>
        <div className="it-hero-inner">
          <span className="it-kicker">Premium Brands</span>
          <h1>The finest names in the kitchen</h1>
          <p>High-end appliances from brands like Bertazzoni, Fulgor Milano, JennAir and Café, at liquidation prices. Every unit is tested and backed by our one-year warranty. One of each, so when it&apos;s gone, it&apos;s gone.</p>
          <div className="it-stats">
            <span><b>{premium.length}</b> in stock now</span>
            {saved > 0 && <span><b>{money(saved)}</b> saved off retail</span>}
            <span><b>1-year</b> warranty</span>
          </div>
          <a className="it-cta" href="#units">Shop premium brands</a>
        </div>
      </section>

      <section id="units" className="it-section">
        {sections.length === 0 ? (
          <div className="panel" style={{ color: 'var(--muted)' }}>
            No premium-brand units in stock right now. <a href="/shop" style={{ textDecoration: 'underline' }}>Browse the full catalogue</a>.
          </div>
        ) : sections.map((s) => (
          <div key={s.name} className="it-brand">
            <h2>{s.name}</h2>
            <div className="grid">
              {groupByModel(s.units).map((g) => <ProductCard key={g.rep.id} unit={g.rep} count={g.count} />)}
            </div>
          </div>
        ))}
      </section>

      <section className="it-section">
        <h2>Designed to be lived with</h2>
        <div className="it-scenes">
          {SCENES.map((s) => (
            <figure key={s.src}>
              <img src={s.src} alt={s.title} loading="lazy" />
              <figcaption><b>{s.title}</b><span>{s.text}</span></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="it-section it-promise">
        <div><b>Tested</b><span>Every unit is bench-tested before it is listed.</span></div>
        <div><b>One-year warranty</b><span>Standard on everything we sell.</span></div>
        <div><b>Local delivery</b><span>Pickup in Pickering, delivery and freight across the GTA.</span></div>
      </section>
    </div>
  );
}
