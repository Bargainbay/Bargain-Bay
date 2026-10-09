import { getAvailable } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import { decorate } from '../../lib/pricing';
import { CONDITIONS, money } from '../../lib/constants';
import ProductCard from '../../components/ProductCard';
import { groupByModel } from '../../lib/group-units';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Refurbished Appliances — Inspected, Repaired & Bench-Tested | Bargain Bay',
  description:
    'Refurbished appliances at Bargain Bay — professionally inspected, repaired where needed and bench-tested back to full working order, with a one-year warranty. Pickup, delivery & freight serving Pickering, Scarborough and the GTA.'
};

// Same source and same filter as the Condition dropdown on /shop, so the two can
// never disagree about what counts as refurbished.
export default async function RefurbishedPage() {
  const session = await getSession();
  const units = (await decorate(await getAvailable({ marketplace: true }), session))
    .filter((u) => u.condition === 'Refurbished');
  const totalSaved = units.reduce(
    (s, u) => s + Math.max(0, (u.compareAt || u.price) - u.price), 0
  );

  return (
    <div>
      <section className="refurb-hero">
        <div>
          <span className="clearance-kicker">Refurbished</span>
          <h1>Inspected, repaired and bench-tested.</h1>
          <p>
            {CONDITIONS.Refurbished} Every refurbished appliance is backed by our full{' '}
            <b>one-year warranty</b>. One of each — when it&apos;s gone, it&apos;s gone.
          </p>
        </div>
      </section>

      {units.length === 0 ? (
        <div className="panel" style={{ marginTop: 18, fontSize: 15, color: 'var(--muted)' }}>
          No refurbished units right now — check back soon, or <a href="/shop" style={{ textDecoration: 'underline' }}>browse the full catalogue</a>.
        </div>
      ) : (
        <>
          <div className="hint" style={{ margin: '14px 0' }}>
            {units.length} refurbished {units.length === 1 ? 'unit' : 'units'}
            {totalSaved > 0 && <> · {money(totalSaved)} in total savings off retail</>}
          </div>
          <div className="grid">
            {groupByModel(units).map((g) => <ProductCard key={g.rep.id} unit={g.rep} count={g.count} />)}
          </div>
        </>
      )}
    </div>
  );
}
