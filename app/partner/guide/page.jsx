import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { getPartner, getPartnerSeat } from '../../../lib/referral-partners';
import PrintButton from '../../../components/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Partner guide — Bargain Bay', robots: { index: false } };

// The guide for an ORGANISATION's managers (the main login and its admin logins): what each of their links is for, a tour of their portal
// top to bottom, how to add and manage lead generators, and how they are paid. Lead generators get the training manual instead
// (/partner/training), which is deliberately a different document: it has no links to share, no team, no money.
const SECTIONS = [
  ['what', 'What this portal is for'],
  ['links', 'Your links and codes: what each one is for'],
  ['tour', 'A tour of your portal, top to bottom'],
  ['team', 'Adding and managing lead generators'],
  ['lead', 'What happens to a lead'],
  ['money', 'How you are paid'],
  ['rules', 'Rules to give your team'],
  ['help', 'When something looks wrong']
];
const h2 = { fontSize: 20, margin: '0 0 8px', color: 'var(--charcoal)' };
const Sec = ({ id, title, children }) => (
  <section id={id} className="panel" style={{ marginBottom: 14, scrollMarginTop: 70 }}>
    <h2 style={h2}>{title}</h2>
    <div style={{ fontSize: 15, lineHeight: 1.55 }}>{children}</div>
  </section>
);
const List = ({ items }) => <ul style={{ paddingLeft: 20, margin: '6px 0' }}>{items.map((t, i) => <li key={i} style={{ margin: '4px 0' }}>{t}</li>)}</ul>;
const Steps = ({ items }) => <ol style={{ paddingLeft: 20, margin: '6px 0' }}>{items.map((t, i) => <li key={i} style={{ margin: '4px 0' }}>{t}</li>)}</ol>;
const Item = ({ name, children }) => (<div style={{ padding: '8px 0', borderTop: '1px solid #eceae5' }}><b>{name}</b><div style={{ marginTop: 2 }}>{children}</div></div>);

export default async function GuidePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/partner/guide');
  const partner = hasDb() ? await getPartner(session.email) : null;
  const seat = hasDb() && !partner ? await getPartnerSeat(session.email) : null;
  if (!partner && !isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <p>This guide is for the managers of a Bargain Bay partner.{seat?.role === 'affiliate' ? ' Your training manual is the one for you.' : ''}</p>
      {seat?.role === 'affiliate' && <a className="btn btn-primary" href="/partner/training">Open the training manual</a>}
    </div></div>);
  }
  const org = partner?.name || 'your organisation';
  const spread = partner?.basis === 'spread';
  const pct = partner?.pct, retailPct = partner ? Math.max(0, (partner.pct || 0) - (partner.customer_pct || 0)) : null;
  return (
    <div className="narrow">
      <div className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, flex: 1, color: 'var(--charcoal)' }}>Partner guide for {org}</h1>
          <a className="btn" href="/partner">← Back to my portal</a>
          <PrintButton />
        </div>
        <p className="hint" style={{ margin: '8px 0 0' }}>For the people who manage {org}. Your lead generators have their own, shorter training manual.</p>
      </div>

      <nav className="panel" style={{ marginBottom: 14 }} aria-label="Contents">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>In this guide</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: '4px 16px' }}>
          {SECTIONS.map(([id, t], i) => <a key={id} href={`#${id}`} style={{ textDecoration: 'underline', fontSize: 14.5 }}>{i + 1}. {t}</a>)}
        </div>
      </nav>

      <Sec id="what" title="1. What this portal is for">
        <p>You and your team send Bargain Bay warm leads and sell our appliances. You run your people; we run the sales calls, delivery and paperwork. This portal at <b>bargainbay.ca/partner</b> shows what your team has done and what you have earned.</p>
        <p>Your lead generators sign in to the same address but see a smaller page: only their own leads, their own code, the posting kit and the training manual. They never see money, other people's leads, or your links.</p>
      </Sec>

      <Sec id="links" title="2. Your links and codes: what each one is for">
        <p>You have three kinds of link or code. Each is for a different person.</p>
        <Item name="Link for resellers (…/join/yourcode)">For <b>businesses that buy appliances to resell</b>: installers, landlords, small dealers. They open it, create an account and apply for reseller pricing. Once we approve them they are your <b>clients</b> and their orders earn you commission. Give this link to businesses, not to shoppers, and not to your lead generators to post.</Item>
        <Item name="Link for end users (…/join/yourcode/shop)">For <b>ordinary shoppers</b>. It opens the shop with your discount code already ready to apply, for {partner?.customer_pct ?? 5}% off. Anyone who buys through it is credited to you. Use it in posts and messages to people buying for themselves.</Item>
        <Item name="Your end-user code">The same discount as the end-user link, typed at checkout instead. The code is shown under "Link for end users" in your portal. Tell people "use code ___ at checkout" when you cannot send a link.</Item>
        <Item name="Each lead generator's own code and link">Made automatically the moment you add them (for example ALJO-ANNA). It gives the buyer the same discount and credits the sale to that person <b>and</b> to you. Do not make codes up yourselves, and do not share one person's code with another.</Item>
        <p style={{ marginTop: 10 }}>Under your links, the portal counts <b>people who opened a link</b>, <b>signed up or ordered</b>, <b>applied as resellers</b> and <b>approved</b>, so you can see which link is working.</p>
      </Sec>

      <Sec id="tour" title="3. A tour of your portal, top to bottom">
        <p>This is the order things appear on your page at bargainbay.ca/partner.</p>
        <Item name="Title bar">Your organisation's name, the <b>Monthly statement</b> button (every order and payment for one month, with a CSV to download) and Sign out.</Item>
        <Item name="Link for resellers and Link for end users">Your links, each with a Copy button, and the visit and sign-up counts described above.</Item>
        <Item name="Your team">Everyone who can sign in for you. Add a person here (section 4 below). A lead generator is shown with their code.</Item>
        <Item name="Learn and reference">The <b>Partner guide</b> (this page), the <b>Training manual</b> for your lead generators, and the <b>Delivery and installation rates</b> page, which you can use to answer a customer's question about delivery, haul-away or installation.</Item>
        <Item name="Send a lead">The same form your generators use. You can send leads yourself, by typing them in or by uploading a screenshot of the chat. Check every field before pressing Send.</Item>
        <Item name="Your lead generators">A table of each person: leads sent, with our team, reached, sold, completed, unreachable, junk, duplicates and orders from their code. Use it to see who is working and who is sending junk. Below it, <b>Refused as duplicates</b> lists leads that were refused because someone had already sent them, with who sent the first one inside your team.</Item>
        <Item name="All your leads">Every lead your team sent, as a <b>Board</b> (a column per stage, left to right) or a <b>List</b>. Each card shows who sent it and when it last changed. The last column is the ones that did not work out.</Item>
        <Item name="Posting kit">Our stock for Facebook: filter by <b>To post</b>, <b>New since last night</b>, <b>Posted</b> or <b>All</b>. Each unit has <b>Copy the words</b>, <b>Photos</b> and <b>Mark as posted</b>. Items that sold show "take it down".</Item>
        <Item name="The totals row">Clients, orders, sales before tax, commission <b>earned</b> (delivered and paid), <b>pending</b> (placed, not yet delivered and paid), what we have paid you, and the balance we owe you.</Item>
        <Item name="Your clients">One panel per client (businesses that joined through your reseller link, and anyone who bought with a code or came from a lead). Each lists their orders with the date, items, how it came in (reseller, with a code, from a lead), total, discount, profit, the rate applied, status and your commission. <b>Ask for a quote or order</b> on a client sends us a follow-up for them.</Item>
        <Item name="Payments to you">Each payment we have recorded: date, method, reference, amount.</Item>
      </Sec>

      <Sec id="team" title="4. Adding and managing lead generators">
        <Steps items={[
          'In Your team, choose "Lead generator (sees only their own)", enter their name and email and press Add a lead generator. There is nothing to ask us for. It works straight away, for up to 100 people.',
          'If they have no Bargain Bay account yet, they are emailed a link (it names your organisation) to choose a password. If they already have one, they can sign in with it.',
          'They sign in at bargainbay.ca/partner and land on their own page. Send them the training manual link so they read it on day one.',
          'To remove someone, press Remove. Their login stops at once and their code stops working for new orders. Leads they already sent stay on the record.'
        ]} />
        <List items={[
          'Only your logins can add or remove people. Your lead generators cannot.',
          'An email can belong to one organisation only, and your own login cannot be added as a generator.',
          'Add people you know. What they post and how they treat the people they contact reflects on you and on us.'
        ]} />
      </Sec>

      <Sec id="lead" title="5. What happens to a lead">
        <Steps items={[
          'A lead is sent (by form or screenshot) and checked for duplicates. If someone has already sent that person, it is refused and the sender is told, without saying who sent it first.',
          'If it is new, our sales team is told and takes it, usually the same day.',
          'They call or message the customer. The status moves to Called, then In conversation and Quote sent.',
          'If the customer buys and pays, it becomes Sold, and Completed once delivered. Otherwise it ends as Not interested or Couldn\'t reach.'
        ]} />
        <p>Statuses follow our team's real activity. You cannot change them and neither can your people.</p>
      </Sec>

      <Sec id="money" title="6. How you are paid">
        {spread ? (<>
          <p>Your deal is the <b>spread over member price</b>:</p>
          <List items={[
            <span key="a">Everything a customer pays <b>above our member price</b> of the unit is yours. The customer's {partner?.customer_pct ?? 5}% code discount comes out of that, so it is measured on what they actually paid.</span>,
            <span key="b">When we sell a unit <b>at member price</b> there is nothing above it, so you earn <b>{partner?.lead_pct ?? 10}% of the profit</b> on that unit instead.</span>,
            'You are never paid more than the unit made.'
          ]} />
          <p className="hint">Each order in your clients list shows which rule applied: "Over member price" or "Member price: profit share".</p>
        </>) : (
          <List items={[
            <span key="a">Orders from your <b>resellers</b>: <b>{pct}% of the profit</b>.</span>,
            <span key="b">Orders placed with your <b>end-user code or link</b>: <b>{retailPct}% of the profit</b> (that sale carries the {partner?.customer_pct ?? 5}% customer discount).</span>,
            <span key="c">Leads our team closes: <b>{partner?.lead_pct ?? 10}% of the profit</b>.</span>
          ]} />
        )}
        <p>Profit is the sale price before tax, less any discount or promo code, less what the unit cost us. Delivery fees and HST are not included, and an order that lost money earns $0.</p>
        <List items={[
          'Commission is earned once the order is delivered and paid. Until then it shows as pending.',
          'Cancelled and refunded orders drop off automatically and take their commission with them.',
          'We pay your organisation, not individuals. How you share it with your people is your business.',
          'A sale made with your own team\'s code to your own team\'s email is not counted.',
          'You see sale price, discount, profit and commission. Your lead generators see none of it.'
        ]} />
      </Sec>

      <Sec id="rules" title="7. Rules to give your team">
        <List items={[
          'Only send a person who contacted your person themselves. Never a name from a list, a stranger, or someone who said no.',
          'First in wins. If two people send the same customer, the first counts.',
          'Phone and email must be real. Junk lowers that person\'s quality score, and if it continues we will ask you to remove them.',
          'Never promise price, delivery date or warranty beyond what is on bargainbay.ca. Our team confirms everything.',
          'Sold means sold: take the listing down the same night. Each person is responsible for their own Facebook account\'s rules.',
          'Customer details are used only to sell them an appliance from us, and never shared or used for your own marketing.'
        ]} />
      </Sec>

      <Sec id="help" title="8. When something looks wrong">
        <List items={[
          <span key="a"><b>A lead was refused as a duplicate:</b> that is normal. The duplicates table shows who sent first inside your team.</span>,
          <span key="b"><b>A lead never got called:</b> tell us the lead's name and we will check our queue.</span>,
          <span key="c"><b>A code is not working:</b> check the person is still on Your team, then contact us.</span>,
          <span key="d"><b>A sale is not showing:</b> sales appear once the order is placed. Commission is earned once it is delivered and paid.</span>,
          <span key="e"><b>Anything else:</b> Service@rssolutions.ca.</span>
        ]} />
      </Sec>
    </div>
  );
}
