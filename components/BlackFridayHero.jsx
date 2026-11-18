// The Black Friday homepage hero: a slideshow, one banner per doorbuster (owner, 2026-11-18).
//
// Server component. The lots come from lib/bf-lots-load.js (frozen set + live catalogue), so every figure is a real unit
// at its real price, and a unit that sells stays on as a stamped SOLD OUT slide until the sale ends. If a coupon is live
// for the deal it is shown; if not, no code is mentioned at all.
import { topOffPct, endOfTorontoDayMs } from '../lib/bf-hero';
import { dayLabel } from '../lib/deals-config';
import { loadSlides } from '../lib/bf-lots-load';
import { firstLive } from '../lib/bf-lots';
import BfCountdown from './BfCountdown';
import BfSlides from './BfSlides';

export default async function BlackFridayHero({ promo, units, markedDown }) {
  const slides = await loadSlides(units).catch(() => []);
  const top = topOffPct(units);
  const endMs = endOfTorontoDayMs(promo.ends);
  const gone = slides.filter((s) => s.sold).length;
  return (
    <section className="bfh" aria-label="Black Friday">
      <div className="bfh-glow" aria-hidden="true" />
      <div className="bfh-bar">
        <div className="bfh-bar-l">
          <span className="bfh-kicker">{promo.kicker} · now through {dayLabel(promo.ends)}</span>
          <h1 className="bfh-h1">Black <span className="bfh-gold">Friday</span>{top >= 30 && <span className="bfh-h1-off"> · up to <b>{top}% off</b></span>}</h1>
        </div>
        {endMs && (
          <div className="bfh-clock">
            <span className="bfh-clock-label">Sale ends Cyber Monday</span>
            <BfCountdown endMs={endMs} fallback={`Ends ${dayLabel(promo.ends)}`} />
          </div>
        )}
      </div>

      {slides.length > 0 ? (
        <BfSlides slides={slides} start={firstLive(slides)} ctaHref={promo.cta.href} gone={gone} />
      ) : (
        <div className="bfs-empty">
          <p>Name-brand appliances, every unit tested and backed by a one-year warranty.</p>
          <a href={promo.cta.href} className="bfh-btn bfh-btn-gold">Shop Black Friday deals</a>
        </div>
      )}

      {promo.code && <p className="bfh-code bfh-code-pad">Extra: use code <code>{promo.code.code}</code> · {promo.code.text}</p>}
      <ul className="bfh-proof">
        {markedDown > 0 && <li><b>{markedDown}</b> units marked down</li>}
        <li><b>1-year</b> warranty on every unit</li>
        <li><b>Free</b> pickup in Pickering</li>
        <li><b>Tested</b> and working</li>
      </ul>
    </section>
  );
}
