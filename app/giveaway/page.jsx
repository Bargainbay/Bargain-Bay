import { GIVEAWAY, giveawayOpen, dayLabel, torontoParts } from '../../lib/deals-config';
import { BUSINESS_LEGAL, BUSINESS_NAME, BUSINESS_ADDRESS, PICKUP_ADDRESS, SALES_EMAIL } from '../../lib/constants';
import GiveawayForm from './GiveawayForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Win a 7 cu. ft. Freezer: Thanksgiving Giveaway',
  description: 'Enter to win a Frigidaire 7 cu. ft. upright freezer from Bargain Bay. No purchase necessary. Ontario residents 18+.',
  alternates: { canonical: '/giveaway' }
};

export default function GiveawayPage() {
  const open = giveawayOpen();
  const { date } = torontoParts();
  const notYet = date < GIVEAWAY.from;

  return (
    <div className="narrow">
      <section className="clearance-hero">
        <div>
          <span className="clearance-kicker">Giveaway · no purchase necessary</span>
          <h1>Win a {GIVEAWAY.prizeShort}</h1>
          <p>
            Thanksgiving means a full fridge and a fuller freezer. We&apos;re giving one away, free.
            Approximate retail value ${GIVEAWAY.retailValue}.
            {open ? ` Entries close ${dayLabel(GIVEAWAY.to)} at 11:59 pm.` : ''}
          </p>
        </div>
      </section>

      <div style={{ marginTop: 18 }}>
        {open ? <GiveawayForm /> : (
          <div className="panel" style={{ fontSize: 15 }}>
            {notYet
              ? `Entries open ${dayLabel(GIVEAWAY.from)}.`
              : 'This giveaway has closed. Thank you to everyone who entered.'}
            {' '}<a href="/deals" style={{ textDecoration: 'underline' }}>See this week&apos;s deals</a>.
          </div>
        )}
      </div>

      <section className="giveaway-rules panel" id="rules" style={{ marginTop: 28 }}>
        <h2 style={{ marginTop: 0 }}>Official contest rules</h2>
        <p><b>No purchase necessary.</b> Buying something does not improve your chances.</p>

        <h2>1. Who can enter</h2>
        <p>
          Residents of Ontario who are 18 or older at the time of entry. Employees of {BUSINESS_LEGAL}
          (operating as {BUSINESS_NAME}) and their immediate families are not eligible.
        </p>

        <h2>2. Contest period</h2>
        <p>
          From 12:00 am {dayLabel(GIVEAWAY.from)} to 11:59 pm {dayLabel(GIVEAWAY.to)}, 2026, Eastern Time.
        </p>

        <h2>3. How to enter</h2>
        <p>
          Complete the entry form on this page. One entry per person. Entries made with more than one email
          address by the same person, or by automated means, will be disqualified.
        </p>

        <h2>4. Prize</h2>
        <p>
          One (1) prize: {GIVEAWAY.prize}, approximate retail value ${GIVEAWAY.retailValue} CAD. The prize has no cash
          value, cannot be exchanged or transferred, and may be replaced with a unit of equal or greater value if this
          model becomes unavailable. The winner may collect it free from {PICKUP_ADDRESS}, or have it delivered free
          within our regular local delivery area; delivery outside that area is at the winner&apos;s cost. The winner is
          responsible for any installation and for any taxes owing on the prize.
        </p>

        <h2>5. The draw</h2>
        <p>
          On {dayLabel(GIVEAWAY.drawDate)}, one entry will be selected at random from all eligible entries received. The
          odds of winning depend on the number of eligible entries received. The selected entrant will be contacted by
          email and/or phone using the details on the entry and must respond within 72 hours.
        </p>

        <h2>6. Skill-testing question</h2>
        <p>
          To be declared the winner, the selected entrant must first correctly answer, without assistance, a
          mathematical skill-testing question. If they cannot be reached within 72 hours, answer incorrectly, or are
          found to be ineligible, they forfeit the prize and another eligible entry will be drawn.
        </p>

        <h2>7. Your information</h2>
        <p>
          We use the details you give only to run this contest and to contact the winner. We will send you marketing
          email only if you tick the separate, optional box on the form, and you can unsubscribe at any time. The winner&apos;s
          first name and city may be announced with their consent.
        </p>

        <h2>8. General</h2>
        <p>
          By entering you agree to these rules. We may cancel or change the contest if it cannot run as planned
          because of fraud or technical problems. This contest is governed by the laws of Ontario and Canada. This
          contest is not sponsored, endorsed or administered by, or associated with, Facebook, Instagram or Meta.
        </p>

        <h2>Sponsor</h2>
        <p>{BUSINESS_LEGAL}, {BUSINESS_ADDRESS}. Questions: <a href={`mailto:${SALES_EMAIL}`} style={{ textDecoration: 'underline' }}>{SALES_EMAIL}</a>.</p>
      </section>
    </div>
  );
}
