import { getAvailable } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import { decorate } from '../../lib/pricing';
import { groupByModel } from '../../lib/group-units';
import { dealsSnapshot } from '../../lib/deals';
import { describeCoupon, dayLabel, GIVEAWAY } from '../../lib/deals-config';
import ProductCard from '../../components/ProductCard';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Deals — This Week at Bargain Bay',
  description:
    'This week’s appliance deals at Bargain Bay: promo codes, a Drop of the Week and clearance units. Every unit tested and working with a one-year warranty. One of each, while they last.',
  alternates: { canonical: '/deals' }
};

function Grid({ units }) {
  if (!units.length) return null;
  return (
    <div className="grid">
      {groupByModel(units).map((g) => <ProductCard key={g.rep.id} unit={g.rep} count={g.count} />)}
    </div>
  );
}

export default async function DealsPage() {
  const [session, snap] = await Promise.all([getSession(), dealsSnapshot()]);
  const units = await decorate(await getAvailable(), session);
  const byId = new Map(units.map((u) => [u.id, u]));
  // A listed unit that has sold simply drops out: the deal never shows a card
  // for something nobody can buy.
  const pick = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);
  const clearance = units.filter((u) => u.onClearance);
  const drop = snap.drop ? byId.get(snap.drop.sku) : null;

  const nothing = !snap.active.length && !drop && !snap.giveaway;

  return (
    <div>
      <section className="clearance-hero">
        <div>
          <span className="clearance-kicker">Deals</span>
          <h1>This week at Bargain Bay</h1>
          <p>
            Real units, real markdowns. Every appliance is tested and working with a
            <b> one-year warranty</b>. One of each, so when it&apos;s gone, it&apos;s gone.
          </p>
        </div>
      </section>

      {snap.giveaway && (
        <a href="/giveaway" className="deal-giveaway" aria-label="Enter the giveaway">
          <div>
            <span className="clearance-kicker">Giveaway · no purchase necessary</span>
            <strong>Win a {GIVEAWAY.prizeShort}</strong>
            <span className="deal-sub">Worth ${GIVEAWAY.retailValue} · enter by {dayLabel(GIVEAWAY.to)}</span>
          </div>
          <span className="clearance-banner-cta">Enter now →</span>
        </a>
      )}

      {snap.active.map((d) => {
        const list = d.id === 'halloween' ? clearance : pick(d.skus);
        const ends = d.coupon?.endsAt || d.to;
        return (
          <section key={d.id} className="deal-block" id={d.id}>
            <div className="section-head">
              <h2>{d.title}</h2>
              <span className="hint" style={{ margin: 0 }}>Ends {dayLabel(ends)}</span>
            </div>
            <p style={{ margin: '0 0 12px', fontSize: 15 }}>{d.blurb}</p>
            {d.coupon && (
              <div className="deal-code">
                <span className="deal-code-label">Promo code</span>
                <code>{d.coupon.code}</code>
                <span>{describeCoupon(d.coupon)}.{d.coupon.excludeClearance ? ' Not valid on clearance units.' : ''} Enter it at checkout.</span>
              </div>
            )}
            {d.cta && <p><a href={d.cta.href} className="btn primary">{d.cta.label}</a></p>}
            <Grid units={list} />
          </section>
        );
      })}

      {drop && (
        <section className="deal-block" id="drop">
          <div className="section-head">
            <h2>Drop of the Week</h2>
            <span className="hint" style={{ margin: 0 }}>Until {dayLabel(snap.drop.to)}</span>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 15 }}>
            One unit a week gets an extra markdown. This is this week&apos;s. There is only one.
          </p>
          <Grid units={[drop]} />
        </section>
      )}

      {clearance.length > 0 && (
        <a href="/clearance" className="clearance-banner" aria-label="Shop clearance" style={{ marginTop: 26 }}>
          <div className="clearance-banner-txt">
            <span className="clearance-kicker">Always on</span>
            <strong>{clearance.length} clearance unit{clearance.length === 1 ? '' : 's'} at final markdowns</strong>
            <span className="clearance-banner-sub">Full one-year warranty on every one</span>
          </div>
          <span className="clearance-banner-cta">Shop clearance →</span>
        </a>
      )}

      {nothing && (
        <div className="panel" style={{ marginTop: 18, fontSize: 15, color: 'var(--muted)' }}>
          No promotion is running today. Our everyday prices are already well under retail:
          {' '}<a href="/shop" style={{ textDecoration: 'underline' }}>browse the full catalogue</a>.
        </div>
      )}

      {snap.upcoming.length > 0 && (
        <section className="deal-block">
          <div className="section-head"><h2>Coming up</h2></div>
          <ul className="deal-upcoming">
            {snap.upcoming.map((d) => (
              <li key={d.id}><b>{d.title}</b> <span>from {dayLabel(d.from)}</span></li>
            ))}
          </ul>
        </section>
      )}

      <p className="hint" style={{ marginTop: 24 }}>
        Promo codes can&apos;t be combined and have limited uses. &quot;Retail&quot; is the manufacturer&apos;s list price.
        Prices and availability are live and change as units sell.
      </p>
    </div>
  );
}
