import { WORKSHOP, dayLabel } from '../../lib/workshop';
import { PICKUP_ADDRESS, BUSINESS_LEGAL } from '../../lib/constants';
import ApplyForm from './ApplyForm';
import './workshop.css';

export const metadata = {
  title: { absolute: 'Appliance Repair Workshop | RS Solutions' },
  description: `Learn appliance repair in 6 weeks from instructors with 20+ years in the trade, including licensed refrigeration training. Hands-on, in Pickering. ${dayLabel(WORKSHOP.start, false)} to ${dayLabel(WORKSHOP.end, false)}. Top graduates may be offered an apprenticeship.`,
  alternates: { canonical: '/workshop' },
  openGraph: { title: 'Appliance Repair Workshop | RS Solutions', type: 'website' }
};

const W = WORKSHOP;
const EMAIL = 'Service@rssolutions.ca';

export default function WorkshopPage() {
  const course = {
    '@context': 'https://schema.org', '@type': 'Course',
    name: W.title,
    description: 'Six-week hands-on appliance repair workshop taught by instructors with over 20 years of experience.',
    provider: { '@type': 'Organization', name: 'RS Solutions', url: 'https://rssolutions.ca' },
    offers: { '@type': 'Offer', price: '2500', priceCurrency: 'CAD', category: 'Paid' },
    hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'onsite', startDate: W.start, endDate: W.end,
      location: { '@type': 'Place', name: 'RS Solutions', address: PICKUP_ADDRESS } }
  };
  return (
    <div className="ws">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(course).replace(/</g, '\\u003c') }} />

      <header className="ws-top">
        <a href="https://rssolutions.ca" className="ws-brand" aria-label="RS Solutions">
          <img src="/rs-solutions-logo.png" alt="RS Solutions" height="40" />
        </a>
        <a href="#apply" className="ws-btn ws-btn-sm">Apply now</a>
      </header>

      <section className="ws-hero">
        <p className="ws-kicker">Hands-on training · Pickering, Ontario</p>
        <h1>Learn Appliance Repair in 6 Weeks</h1>
        <p className="ws-lead">Taught by instructors with 20+ years in the trade. Real appliances, real tools, real faults, including refrigeration with licensed instructors.</p>
        <div className="ws-facts">
          <div><b>{dayLabel(W.start, false)} – {dayLabel(W.end, false)}</b><span>Six weekly sessions{W.timeLabel ? `, ${W.timeLabel}` : ''}</span></div>
          <div><b>{W.priceLabel}</b><span>{W.priceNote}</span></div>
          <div><b>{W.seats ? `${W.seats} seats` : 'Small groups'}</b><span>So everyone gets tool time</span></div>
        </div>
        <a href="#apply" className="ws-btn">Apply for a seat</a>
      </section>

      <section className="ws-sec">
        <h2>A path to a job with us</h2>
        <p className="ws-big">This isn&apos;t only a class. Successful candidates may be offered a place in our apprenticeship program and, from there, job offers with RS Solutions.</p>
        <p className="ws-muted">Offers aren&apos;t guaranteed. They depend on your attendance, skill, attitude and our openings. You can tell us on the application that you want to be considered.</p>
      </section>

      <section className="ws-sec ws-alt">
        <h2>What you&apos;ll learn</h2>
        <div className="ws-grid">
          {W.weeks.map((w) => (
            <article key={w.n} className="ws-card">
              <span className="ws-wk">Week {w.n} · {dayLabel(W.sessions[w.n - 1])}</span>
              <h3>{w.t}</h3>
              <p>{w.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ws-sec">
        <h2>Your instructors</h2>
        <p className="ws-big">Over 20 years of repair experience between them, and licensed for refrigeration work. They teach what actually fails in the field and how to fix it safely, not just what&apos;s in a manual.</p>
      </section>

      <section className="ws-sec ws-alt">
        <h2>Who it&apos;s for</h2>
        <ul className="ws-list">
          <li>Anyone starting a trade or changing careers. No experience needed.</li>
          <li>Handy people who want to fix their own appliances, or earn on the side.</li>
          <li>Landlords and property managers who pay for repairs every month.</li>
          <li>Handymen and contractors adding appliance repair to what they offer.</li>
        </ul>
      </section>

      <section className="ws-sec">
        <h2>Questions</h2>
        <details><summary>Do I need experience or my own tools?</summary><p>No experience is needed; we start from the basics. Tools are provided for use in class.</p></details>
        <details><summary>Is it safe?</summary><p>Safety is week one. Instructors supervise every live-power, gas and refrigeration task.</p></details>
        <details><summary>Will I get a job?</summary><p>We can&apos;t promise one. Successful candidates may be offered our apprenticeship program, and then employment with RS Solutions, as described above.</p></details>
        <details><summary>How do I pay?</summary><p>Tuition is {W.priceLabel} for the six-week term. Apply below, and we&apos;ll contact you to confirm your seat and arrange payment. Nothing is charged when you apply.</p></details>
        <details><summary>Where is it?</summary><p>{PICKUP_ADDRESS}.</p></details>
      </section>

      <section className="ws-sec ws-alt" id="apply">
        <h2>Apply for a seat</h2>
        <p className="ws-muted">Classes run {dayLabel(W.start, false)} to {dayLabel(W.end, false)}. Seats are limited, and we confirm them in the order applications arrive.</p>
        <ApplyForm experience={W.experience} heardFrom={W.heardFrom} priceLabel={W.priceLabel} />
      </section>

      <footer className="ws-foot">
        <p><b>RS Solutions</b> · {PICKUP_ADDRESS}</p>
        <p>Questions? <a href={`mailto:${EMAIL}`}>{EMAIL}</a>{W.phone ? <> · {W.phone}</> : null}</p>
        <p className="ws-fine">{BUSINESS_LEGAL}</p>
      </footer>
    </div>
  );
}
