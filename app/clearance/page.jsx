import { getAvailable } from '../../lib/inventory';
import { clearanceUnits } from '../../lib/clearance';
import { money } from '../../lib/constants';
import ProductCard from '../../components/ProductCard';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Clearance — Heavy Markdowns on Tested Appliances | Bargain Bay',
  description:
    'Clearance appliances at Bargain Bay — heavily marked-down tested units. Every clearance appliance is bench-tested and backed by our full one-year warranty. While they last.'
};

export default async function ClearancePage() {
  const available = await getAvailable();
  const units = await clearanceUnits(available);
  const totalSaved = units.reduce(
    (s, u) => s + Math.max(0, (u.compareAt || u.price) - u.price), 0
  );

  return (
    <div>
      <section className="clearance-hero">
        <div>
          <span className="clearance-kicker">Clearance</span>
          <h1>Final markdowns. While they last.</h1>
          <p>
            Heavily discounted tested appliances we&apos;re clearing out. Every unit is bench-tested and
            working, backed by our full <b>one-year warranty</b>. One of each — when it&apos;s gone, it&apos;s gone.
          </p>
        </div>
      </section>

      {units.length === 0 ? (
        <div className="panel" style={{ marginTop: 18, fontSize: 15, color: 'var(--muted)' }}>
          No clearance units right now — check back soon, or <a href="/shop" style={{ textDecoration: 'underline' }}>browse the full catalogue</a>.
        </div>
      ) : (
        <>
          <div className="hint" style={{ margin: '14px 0' }}>
            {units.length} clearance {units.length === 1 ? 'unit' : 'units'} · {money(totalSaved)} in total savings off retail
          </div>
          <div className="grid">
            {units.map((u) => <ProductCard key={u.id} unit={u} />)}
          </div>
        </>
      )}
    </div>
  );
}
