import SmsSubscribe from '../../components/SmsSubscribe';
import ProductCard from '../../components/ProductCard';
import { getAvailable } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import { decorate } from '../../lib/pricing';
import { bfGroups, isBfDeal } from '../../lib/bf-hero';
import { money, REFURBISHED_WARRANTY_MONTHS } from '../../lib/constants';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Black Friday Appliance Deals | Bargain Bay',
  description:
    'Every appliance marked down for Black Friday at Bargain Bay. Tested and working, with a warranty. One of each, while they last.',
  alternates: { canonical: '/black-friday' }
};

// Where every "Shop Black Friday deals" link lands: ONLY the units carrying the Black Friday banner.
export default async function BlackFridayPage() {
  const session = await getSession();
  const units = (await decorate(await getAvailable(), session)).filter(isBfDeal);
  const totalSaved = units.reduce((s, u) => s + Math.max(0, (u.compareAt || u.price) - u.price), 0);

  return (
    <div>
      <section className="clearance-hero">
        <div>
          <span className="clearance-kicker">Black Friday</span>
          <h1>Black Friday deals</h1>
          <p>
            Every appliance on this page is marked down for Black Friday and is tested and working, with a
            <b> one-year warranty</b> ({REFURBISHED_WARRANTY_MONTHS} months on refurbished units). One of each, so when
            it&apos;s gone, it&apos;s gone.
          </p>
        </div>
      </section>

      <p style={{ margin: '14px 0 0' }}>
        <a href="/marketing/black-friday/flyer/bargain-bay-black-friday-flyer.pdf" style={{ textDecoration: 'underline', fontWeight: 600 }}>
          View the Black Friday flyer (PDF)
        </a>
      </p>

      {units.length === 0 ? (
        <div className="panel" style={{ marginTop: 18, fontSize: 15, color: 'var(--muted)' }}>
          No Black Friday deals are available right now. See <a href="/clearance" style={{ textDecoration: 'underline' }}>clearance</a>
          {' '}or <a href="/shop" style={{ textDecoration: 'underline' }}>browse the full catalogue</a>.
        </div>
      ) : (
        <>
          <div className="hint" style={{ margin: '14px 0' }}>
            {units.length} Black Friday {units.length === 1 ? 'deal' : 'deals'} · {money(totalSaved)} in total savings off retail
          </div>
          <div className="grid">
            {bfGroups(units).map((g) => <ProductCard key={g.rep.id} unit={g.rep} count={g.count} />)}
          </div>
        </>
      )}

      <SmsSubscribe where="black friday page" />
    </div>
  );
}
