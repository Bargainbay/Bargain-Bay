import { getAvailable } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import { decorate } from '../../lib/pricing';
import { LIKE_NEW, money } from '../../lib/constants';
import ProductCard from '../../components/ProductCard';
import { groupByModel } from '../../lib/group-units';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Like New Appliances — Certified Tested | Bargain Bay',
  description:
    'Like New appliances at Bargain Bay: certified tested and fully working, may show small signs of use, with a one-year warranty. Pickup, delivery & freight serving Pickering, Scarborough and the GTA.'
};

// Same source and same filter as the Condition dropdown on /shop.
export default async function LikeNewPage() {
  const session = await getSession();
  const units = (await decorate(await getAvailable({ marketplace: true }), session))
    .filter((u) => u.condition === LIKE_NEW);
  const totalSaved = units.reduce(
    (s, u) => s + Math.max(0, (u.compareAt || u.price) - u.price), 0
  );

  return (
    <div>
      <section className="likenew-hero">
        <div>
          <span className="clearance-kicker">Like New</span>
          <h1>Certified tested. Close to new.</h1>
          <p>
            Like New units may show small signs of use, but every one is certified tested by our technicians
            and confirmed fully working. Each is backed by a <b>one-year warranty</b>. One of each — when it&apos;s
            gone, it&apos;s gone.
          </p>
        </div>
      </section>

      {units.length === 0 ? (
        <div className="panel" style={{ marginTop: 18, fontSize: 15, color: 'var(--muted)' }}>
          No Like New units right now — check back soon, or <a href="/shop" style={{ textDecoration: 'underline' }}>browse the full catalogue</a>.
        </div>
      ) : (
        <>
          <div className="hint" style={{ margin: '14px 0' }}>
            {units.length} Like New {units.length === 1 ? 'unit' : 'units'}
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
