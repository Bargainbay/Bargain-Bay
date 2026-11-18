// The Black Friday homepage hero (replaces the one-unit "1/1 left" stage, 2026-11-17).
//
// Server component. Everything numeric is read from the live catalogue (lib/bf-hero.js): the "up to X% off" line and
// the four unit cards are real units at their real prices, so nothing here can advertise something we no longer have.
// If a coupon is live for the deal it is shown as an extra; if not, no code is mentioned at all.
import { money } from '../lib/constants';
import { pickDoorbusters, topOffPct, endOfTorontoDayMs } from '../lib/bf-hero';
import { dayLabel } from '../lib/deals-config';
import BfCountdown from './BfCountdown';

const short = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1).trim()}…` : String(s || ''));

export default function BlackFridayHero({ promo, units, markedDown }) {
  const cards = pickDoorbusters(units, 4);
  const top = topOffPct(units);
  const endMs = endOfTorontoDayMs(promo.ends);
  return (
    <section className="bfh" aria-label="Black Friday">
      <div className="bfh-glow" aria-hidden="true" />
      <div className="bfh-inner">
        <div className="bfh-copy">
          <span className="bfh-kicker">{promo.kicker} · now through {dayLabel(promo.ends)}</span>
          <h1 className="bfh-title"><span>Black</span><span className="bfh-gold">Friday</span></h1>
          {top >= 30 && <p className="bfh-big">Up to <b>{top}% off</b> retail</p>}
          <p className="bfh-sub">Name-brand appliances, every unit tested and backed by a one-year warranty. One of each. When it is gone, it is gone.</p>
          {promo.code && (
            <p className="bfh-code">Extra: use code <code>{promo.code.code}</code> · {promo.code.text}</p>
          )}
          <div className="bfh-actions">
            <a href={promo.cta.href} className="bfh-btn bfh-btn-gold">Shop Black Friday deals</a>
            <a href="/clearance" className="bfh-btn bfh-btn-ghost">Shop clearance</a>
          </div>
          {endMs && (
            <div className="bfh-clock">
              <span className="bfh-clock-label">Sale ends Cyber Monday</span>
              <BfCountdown endMs={endMs} fallback={`Ends ${dayLabel(promo.ends)}`} />
            </div>
          )}
        </div>

        {cards.length > 0 && (
          <div className="bfh-deals">
            <div className="bfh-deals-head"><b>Biggest markdowns right now</b><span>Live from our warehouse</span></div>
            <div className="bfh-grid">
              {cards.map((g) => {
                const u = g.rep;
                return (
                  <a key={u.id} href={`/product/${u.id}`} className="bfh-card">
                    <span className="bfh-ribbon">{g.pct}% off</span>
                    <span className="bfh-photo"><img src={u.image} alt={`${u.make || ''} ${u.model || ''}`.trim()} loading="eager" /></span>
                    <span className="bfh-card-body">
                      <small>{u.make}{u.condition ? ` · ${u.condition}` : ''}</small>
                      <b>{short(u.title || `${u.make} ${u.model}`, 46)}</b>
                      <span className="bfh-price">
                        {g.count > 1 && <em>from</em>}
                        <strong>{money(g.minPrice)}</strong>
                        <s>{money(u.compareAt)}</s>
                      </span>
                      {g.count > 1 && <span className="bfh-avail">{g.count} available</span>}
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <ul className="bfh-proof">
        {markedDown > 0 && <li><b>{markedDown}</b> units marked down</li>}
        <li><b>1-year</b> warranty on every unit</li>
        <li><b>Free</b> pickup in Pickering</li>
        <li><b>Tested</b> and working</li>
      </ul>
    </section>
  );
}
