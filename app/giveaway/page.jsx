import { GIVEAWAY, BONUS, MAX_TICKETS, giveawayOpen, dayLabel, torontoParts } from '../../lib/deals-config';
import { entryIdFromParam, entryStatus } from '../../lib/giveaway';
import { BUSINESS_LEGAL, BUSINESS_NAME, BUSINESS_ADDRESS, PICKUP_ADDRESS, SALES_EMAIL, INSTAGRAM_URL } from '../../lib/constants';
import GiveawayForm from './GiveawayForm';
import GiveawayChecklist from './GiveawayChecklist';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Win a SMEG Countertop Oven: Halloween Giveaway',
  description: 'Enter to win a SMEG countertop oven from Bargain Bay, and show us your best Halloween costume for bonus entries. No purchase necessary. Ontario residents 18+.',
  alternates: { canonical: '/giveaway' }
};

export default async function GiveawayPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const open = giveawayOpen();
  // Somebody following their link back sees their checklist, not the form.
  const eParam = typeof sp.e === 'string' ? sp.e : '';
  const entryId = open ? entryIdFromParam(eParam) : null;
  const found = entryId ? await entryStatus(entryId).catch(() => null) : null;
  // A link from an earlier giveaway shows this one's form, not somebody's old checklist.
  const entry = found && found.giveaway === GIVEAWAY.id ? found : null;
  const { date } = torontoParts();
  const notYet = date < GIVEAWAY.from;

  return (
    <div className="narrow">
      <section className="clearance-hero">
        <div>
          <span className="clearance-kicker">Giveaway · no purchase necessary</span>
          <h1>Win a {GIVEAWAY.prizeShort}</h1>
          <p>
            Halloween is on us. We&apos;re giving away a SMEG countertop oven, free, and the best
            Halloween costume earns {BONUS.costume} bonus entries.
            Approximate retail value ${GIVEAWAY.retailValue.toLocaleString('en-CA')}.
            {open ? ` Entries close ${dayLabel(GIVEAWAY.to)} at 11:59 pm.` : ''}
          </p>
        </div>
      </section>

      <section className="giveaway-prize" aria-label="The prize" style={{ marginTop: 14 }}>
        <img src={GIVEAWAY.hero.image} alt={GIVEAWAY.hero.imageAlt} style={{ maxWidth: 320, width: '100%', height: 'auto' }} />
        <p className="hint" style={{ margin: '6px 0 0' }}>The SMEG oven shown is the prize.</p>
      </section>

      <div style={{ marginTop: 18 }}>
        {open && entry ? (
          <GiveawayChecklist e={eParam} initial={JSON.parse(JSON.stringify(entry))}
            instagramUrl={INSTAGRAM_URL} closesLabel={dayLabel(GIVEAWAY.to)} />
        ) : open ? <GiveawayForm /> : (
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
        <p>To enter you must do all three of the following. Together they earn one (1) entry:</p>
        <ol>
          <li>Create a free Bargain Bay account, or log in to your existing one, using the email address you enter with. No purchase is needed to create an account.</li>
          <li>Agree to receive Bargain Bay&apos;s deals, flyers and new-arrival announcements by email (about once a week). You may unsubscribe at any time using the link in any of those emails, and your entry stays valid if you do.</li>
          <li>Complete the entry form on this page.</li>
        </ol>
        <p>
          One entry form per person: entries made with more than one email address by the same person, or by automated
          means, will be disqualified.
        </p>

        <h2>4. Bonus entries (optional)</h2>
        <p>
          After entering you may earn extra entries in either of these two ways. Neither is required, and not doing
          them does not affect your base entry. Up to {MAX_TICKETS} entries per person in total.
        </p>
        <ul>
          <li><b>+{BONUS.instagram}</b> Follow Bargain Bay on Instagram (@bargainbayinc) and give us your username. We will confirm the winner follows us before the prize is awarded.</li>
          <li><b>+{BONUS.costume}</b> Halloween costume contest. Send us one photo of your Halloween costume. Bargain Bay will choose the one (1) costume it judges best, on creativity, effort and fun, on or about {dayLabel(GIVEAWAY.costumeJudgeDate)}, after entries close, and that entry earns {BONUS.costume} extra entries before the draw. Sending a photo does not earn extra entries by itself, and only one costume is chosen. Our choice is final.</li>
        </ul>
        <p>
          <b>Costume photo terms.</b> By sending a photo you confirm you took it, that everyone appearing in it has
          agreed, that it shows no one under 18, and that it contains no third-party material you do not have the right
          to use. You give {BUSINESS_LEGAL} a non-exclusive, royalty-free licence to show it on our website and social
          media, and in our marketing, for as long as we choose to. We may decline any photo that is unsuitable. Your
          photo is kept private until we choose to use it.
        </p>

        <h2>5. Prize</h2>
        <p>
          One (1) prize: {GIVEAWAY.prize}, approximate retail value ${GIVEAWAY.retailValue} CAD. The prize has no cash
          value, cannot be exchanged or transferred, and may be replaced with a unit of equal or greater value if this
          model becomes unavailable. The winner may collect it free from {PICKUP_ADDRESS}, or have it delivered free
          within our regular local delivery area; delivery outside that area is at the winner&apos;s cost. The winner is
          responsible for any installation and for any taxes owing on the prize.
        </p>

        <h2>6. The draw</h2>
        <p>
          On {dayLabel(GIVEAWAY.drawDate)}, one entry will be selected at random from all eligible entries received,
          counting each entry, including bonus entries, as one chance. The odds of winning depend on the number of
          eligible entries received. The selected entrant will be contacted by email and/or phone using the details on
          the entry and must respond within 72 hours.
        </p>
        <p>
          To be declared the winner, the selected entrant must first correctly answer, without assistance, a
          mathematical skill-testing question. If they cannot be reached within 72 hours, answer incorrectly, or are
          found to be ineligible, they forfeit the prize and another eligible entry will be drawn.
        </p>

        <h2>7. Your information</h2>
        <p>
          We use the details you give to run this contest, to contact the winner, to create your Bargain Bay account, and
          to send the deals and flyers email you agree to in section 3. You can unsubscribe from that email at any time.
          The winner&apos;s first name and city may be announced with their consent.
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
