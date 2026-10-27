import { getAvailable } from '../../../lib/inventory';
import { getSession } from '../../../lib/auth';
import { decorate } from '../../../lib/pricing';
import { money } from '../../../lib/constants';
import ProductCard from '../../../components/ProductCard';
import { groupByModel } from '../../../lib/group-units';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Bertazzoni & Fulgor Milano — Italian Kitchen Appliances | Bargain Bay',
  description:
    'Italian-designed Bertazzoni and Fulgor Milano ranges, refrigeration and laundry at liquidation prices. Tested and backed by a one-year warranty. Pickup, delivery and freight serving Pickering, Scarborough and the GTA.'
};

const BRANDS = [
  { make: 'Bertazzoni', blurb: 'Professional ranges, induction and built-in refrigeration with the look of a restaurant line, made for the home kitchen.' },
  { make: 'Fulgor Milano', blurb: 'Sofia professional gas ranges and Milan-styled laundry, designed to sit at the centre of a considered kitchen.' }
];

const SCENES = [
  { src: '/brands/italian/range.jpg', title: 'Cook on a range that looks the part', text: 'Professional gas and induction ranges in stainless steel, from 36 to 48 inches.' },
  { src: '/brands/italian/column.jpg', title: 'Refrigeration that disappears into the cabinetry', text: 'Built-in column units sit flush with your design instead of interrupting it.' },
  { src: '/brands/italian/laundry.jpg', title: 'Even the laundry room', text: 'Compact front-load washers that look as good as they perform.' }
];

const Label = () => (
  <div className="it-label">Illustration: AI-generated kitchen scene, not a photo of a unit for sale.</div>
);

export default async function ItalianPage() {
  const session = await getSession();
  const all = await decorate(await getAvailable({ marketplace: true }), session);
  const norm = (s) => String(s || '').toLowerCase();
  const sections = BRANDS.map((b) => ({ ...b, units: all.filter((u) => norm(u.make) === norm(b.make)) }));
  const total = sections.reduce((n, s) => n + s.units.length, 0);
  const saved = sections.flatMap((s) => s.units).reduce((n, u) => n + Math.max(0, (u.compareAt || u.price) - u.price), 0);

  return (
    <div className="it-page">
      <section className="it-hero" style={{ backgroundImage: 'linear-gradient(90deg, rgba(14,12,10,.86) 0%, rgba(14,12,10,.45) 55%, rgba(14,12,10,.1) 100%), url(/brands/italian/hero.jpg)' }}>
        <div className="it-hero-inner">
          <span className="it-kicker">The Italian Collection</span>
          <h1>Bertazzoni &amp; Fulgor Milano</h1>
          <p>Italian design for the kitchen, at liquidation prices. Every unit is tested and backed by our one-year warranty. One of each, so when it&apos;s gone, it&apos;s gone.</p>
          <div className="it-stats">
            <span><b>{total}</b> in stock now</span>
            {saved > 0 && <span><b>{money(saved)}</b> saved off retail</span>}
            <span><b>1-year</b> warranty</span>
          </div>
          <a className="it-cta" href="#units">Shop the collection</a>
        </div>
        <div className="it-hero-label">AI-generated illustration</div>
      </section>

      <section id="units" className="it-section">
        {sections.map((s) => (
          <div key={s.make} className="it-brand">
            <h2>{s.make}</h2>
            <p className="it-blurb">{s.blurb}</p>
            {s.units.length === 0 ? (
              <div className="panel" style={{ color: 'var(--muted)' }}>
                No {s.make} units in stock right now. <a href="/shop" style={{ textDecoration: 'underline' }}>Browse the full catalogue</a>.
              </div>
            ) : (
              <div className="grid">
                {groupByModel(s.units).map((g) => <ProductCard key={g.rep.id} unit={g.rep} count={g.count} />)}
              </div>
            )}
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
        <Label />
      </section>

      <section className="it-section it-promise">
        <div><b>Tested</b><span>Every unit is bench-tested before it is listed.</span></div>
        <div><b>One-year warranty</b><span>Standard on everything we sell.</span></div>
        <div><b>Local delivery</b><span>Pickup in Pickering, delivery and freight across the GTA.</span></div>
      </section>
    </div>
  );
}
