import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { getPartnerSeat } from '../../../lib/referral-partners';
import PrintButton from '../../../components/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Training manual — Bargain Bay', robots: { index: false } };

// The lead generator training manual. Visible to anyone with a partner seat (organisation admin or lead generator) and to our
// own admins. It is plain reading material: no numbers about our costs, prices or commission appear here, only how to do the job.
const SECTIONS = [
  ['start', 'Day one: the 10-minute start'],
  ['job', 'What your job is'],
  ['lead', 'What makes a good lead'],
  ['send', 'Sending a lead, step by step'],
  ['shot', 'Sending a lead from a screenshot'],
  ['dup', 'If it says "already entered"'],
  ['status', 'Reading the board'],
  ['post', 'Posting on Facebook'],
  ['talk', 'Talking to buyers'],
  ['code', 'Your code and your link'],
  ['rules', 'The rules'],
  ['faq', 'Questions people ask'],
  ['check', 'Your daily checklist']
];

const h2 = { fontSize: 20, margin: '0 0 8px', color: 'var(--charcoal)' };
const Box = ({ tone = 'info', title, children }) => {
  const c = { info: ['#f3f6fb', '#c9d6ea'], good: ['#f1f8f3', '#bfdcc6'], warn: ['#fff8ec', '#ecd29a'], stop: ['#fdf2f2', '#e8bcbc'] }[tone];
  return (
    <div style={{ background: c[0], border: `1px solid ${c[1]}`, borderRadius: 10, padding: '10px 14px', margin: '10px 0' }}>
      {title && <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>}
      <div style={{ fontSize: 14.5, lineHeight: 1.5 }}>{children}</div>
    </div>
  );
};
const Sec = ({ id, title, children }) => (
  <section id={id} className="panel" style={{ marginBottom: 14, scrollMarginTop: 70 }}>
    <h2 style={h2}>{title}</h2>
    <div style={{ fontSize: 15, lineHeight: 1.6 }}>{children}</div>
  </section>
);
const Steps = ({ items }) => (
  <ol style={{ paddingLeft: 20, margin: '6px 0' }}>{items.map((t, i) => <li key={i} style={{ margin: '4px 0' }}>{t}</li>)}</ol>
);

export default async function TrainingPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/partner/training');
  const seat = hasDb() ? await getPartnerSeat(session.email) : null;
  if (!seat && !isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><p>This manual is for Bargain Bay partners and their lead generators.</p></div></div>);
  }

  return (
    <div className="narrow">
      <div className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, flex: 1, color: 'var(--charcoal)' }}>Lead generator training manual</h1>
          <a className="btn" href="/partner">← Back to my portal</a>
          <PrintButton />
        </div>
        <p className="hint" style={{ margin: '8px 0 0' }}>Read it once from top to bottom, then come back to any part when you need it. It takes about 15 minutes.</p>
      </div>

      <nav className="panel" style={{ marginBottom: 14 }} aria-label="Contents">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>In this manual</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: '4px 16px' }}>
          {SECTIONS.map(([id, t], i) => <a key={id} href={`#${id}`} style={{ textDecoration: 'underline', fontSize: 14.5 }}>{i + 1}. {t}</a>)}
        </div>
      </nav>

      <Sec id="start" title="1. Day one: the 10-minute start">
        <Steps items={[
          'Sign in at bargainbay.ca/partner and save the page to your phone\'s home screen so it opens like an app.',
          'Open the Posting kit. Pick any item and press Copy the words. Press Photos to download its pictures.',
          'Post it on your own Facebook Marketplace, paste the words, add the photos, then press Mark as posted.',
          'When someone messages you that they want it, press Send a lead and put in their name and phone. That is the whole job.'
        ]} />
        <Box tone="good" title="Your first goal">Post five items and send one real lead in your first week. Everything else in this manual makes that easier.</Box>
      </Sec>

      <Sec id="job" title="2. What your job is">
        <p>You do three things:</p>
        <Steps items={[
          <span key="a"><b>Post</b> our appliances on Facebook. We give you the photos and the words.</span>,
          <span key="b"><b>Send leads.</b> When a person wants to buy, or wants delivery, installation or a repair, you send us their details and our sales team takes it from there.</span>,
          <span key="c"><b>Share your code.</b> Your own discount code gives buyers a discount online and credits the sale to you.</span>
        ]} />
        <p>You do not set prices, promise delivery dates or negotiate. Our team does that. You never see our costs. Everything we sell is a one-of-a-kind appliance (open-box, scratch and dent, refurbished, or tested-working), so each item is only available once.</p>
      </Sec>

      <Sec id="lead" title="3. What makes a good lead">
        <p>A good lead is a real person who <b>contacted you</b> and wants something we sell. That is the only kind we want.</p>
        <Box tone="good" title="Send these">
          Someone messaged you about a post. Someone said "I am interested" or asked the price. Someone asked about delivery or installation. Someone asked whether it is still available. A friend or neighbour who asked you about a fridge.
        </Box>
        <Box tone="stop" title="Never send these">
          A person you picked from a list or found online. A stranger you have never spoken to. Someone who said no, or "do not contact me". Someone you only think might want one.
        </Box>
        <p>Quality counts. A few good leads are worth far more than many poor ones. Junk or invented details lower your quality score and can get you removed from the program.</p>
      </Sec>

      <Sec id="send" title="4. Sending a lead, step by step">
        <Steps items={[
          'Open your portal and find the Send a lead box.',
          'Type their name and phone number (or email). Read the number back digit by digit. A wrong digit means we cannot reach them and nobody earns anything.',
          'Choose what they want: buy an appliance, delivery, installation or repair.',
          'Choose how they reached you: message, text, in person or phone.',
          'Add a short note that helps our team: what they asked about, where they are, the best time to call. Example: "Wants a washer, in Ajax, asked about Saturday."',
          'Press Send lead. You will see "Sent". It now appears on your board.'
        ]} />
        <Box tone="warn" title="Phone numbers">Use a real 10-digit number. We cannot send a lead without a phone or an email.</Box>
      </Sec>

      <Sec id="shot" title="5. Sending a lead from a screenshot">
        <p>If the person messaged you, you can upload a screenshot of the chat and we will read their details into the form for you.</p>
        <Steps items={[
          'Press Send a lead from a screenshot and choose the picture.',
          'Wait a few seconds. The form fills itself in.',
          'Check every field, especially the phone number. Fix anything that is wrong. The reader can make mistakes.',
          'Choose how they reached you and press Send lead.'
        ]} />
        <Box tone="info" title="Good to know">
          Nothing is sent until you press Send. If the picture cannot be read, just fill the form in by hand. Your screenshot is stored privately with the lead as the record of the enquiry and is deleted after 90 days. Only use a screenshot of someone who contacted you.
        </Box>
      </Sec>

      <Sec id="dup" title={'6. If it says "already entered"'}>
        <p>This means someone else sent that person first, or we already know them. It is normal and it is nothing you did wrong. The lead is not counted for you, and we do not say who sent it. Just move on to the next person.</p>
        <p>If you yourself sent that person before, the message shows you where that lead stands.</p>
      </Sec>

      <Sec id="status" title="7. Reading the board">
        <p>Your leads are shown as columns that move from left to right as our team works them. You cannot change them. They update by themselves.</p>
        <div className="table-wrap"><table className="admin" style={{ minWidth: 0 }}>
          <thead><tr><th>Column</th><th>What it means</th></tr></thead>
          <tbody>
            <tr><td><b>Sent</b></td><td>We have it. Nobody has picked it up yet.</td></tr>
            <tr><td><b>With our team</b></td><td>A salesperson has taken it.</td></tr>
            <tr><td><b>Called</b></td><td>We have contacted them.</td></tr>
            <tr><td><b>In conversation</b></td><td>We are talking with them.</td></tr>
            <tr><td><b>Quote sent</b></td><td>We sent them a price.</td></tr>
            <tr><td><b>Sold</b></td><td>They bought and paid.</td></tr>
            <tr><td><b>Completed</b></td><td>Their order was delivered.</td></tr>
            <tr><td><b>Didn&apos;t work out</b></td><td>Not interested, couldn&apos;t reach them, wrong number, or not counted (a duplicate or junk).</td></tr>
          </tbody>
        </table></div>
        <p>You also get an email when one of your leads buys.</p>
      </Sec>

      <Sec id="post" title="8. Posting on Facebook">
        <Steps items={[
          'Open the Posting kit. Every item for sale is a card with a photo, a price, ready words and a photo download.',
          'Press Copy the words, then Photos to save the pictures to your phone.',
          'On your own Facebook Marketplace, create a listing, add the photos and paste the words.',
          'Press Mark as posted on the card so you can keep track.'
        ]} />
        <Box tone="stop" title="Do not change these">
          Do not change the price, the condition or the warranty. Do not promise a delivery date. Our team confirms those with the buyer.
        </Box>
        <h3 style={{ fontSize: 16, margin: '14px 0 4px' }}>Every night</h3>
        <p>You get an email around 7 pm with two lists:</p>
        <Steps items={[
          <span key="a"><b>Take these down:</b> items you posted that have sold. Delete those Facebook listings <b>that night</b>, then press Taken down in the portal. A sold listing that stays up wastes a buyer&apos;s time and hurts all of us.</span>,
          <span key="b"><b>New items:</b> stock that arrived. Post these first. New items sell fastest.</span>
        ]} />
        <p>The same lists are in your portal all day. Refresh the page before you post, because stock changes during the day.</p>
        <Box tone="warn" title="Facebook&apos;s rules are yours to follow">
          Use real photos when we have them. Do not post the same item over and over or in many groups. Follow Facebook&apos;s rules for selling.
        </Box>
      </Sec>

      <Sec id="talk" title="9. Talking to buyers">
        <p>Keep it short, friendly and honest. You are the first hello. Our team does the rest.</p>
        <Box tone="info" title="When someone asks &quot;Is it available?&quot;">
          &quot;Yes, it is. Everything we have is one of a kind, so when it is gone it is gone. Can I get your name and phone number so our team can call you?&quot;
        </Box>
        <Box tone="info" title="When someone asks about price, delivery or warranty">
          &quot;The price is on the post. Our team confirms delivery and the warranty details directly with you. Can I get your phone number so they can call?&quot;
        </Box>
        <Box tone="info" title="When someone wants to buy online">
          &quot;You can order at bargainbay.ca. Use my code at checkout for a discount.&quot; Then give them your code or your link.
        </Box>
        <Box tone="stop" title="Never say">
          Anything about our costs, margins or other customers. A promise of a price, date or warranty that is not on the post. Anything you are not sure is true. If you do not know, say &quot;Let me have our team confirm that for you.&quot;
        </Box>
      </Sec>

      <Sec id="code" title="10. Your code and your link">
        <p>You have your own discount code and link, shown in your portal. When a customer uses your code at checkout, or arrives from your link and buys, the sale is credited to you.</p>
        <Steps items={[
          'Tell buyers: "Use my code at bargainbay.ca for a discount."',
          'Share your link in messages and on your posts where it is allowed.',
          'Using your own code on your own order does not count.'
        ]} />
      </Sec>

      <Sec id="rules" title="11. The rules">
        <ul style={{ paddingLeft: 20, margin: '6px 0' }}>
          <li>Only send people who <b>contacted you</b>.</li>
          <li>Real phone numbers and emails only. No invented or copied details.</li>
          <li>Never promise a price, a delivery date or a warranty beyond what is on the post.</li>
          <li>Never pass a customer&apos;s details to anyone else.</li>
          <li>Take sold listings down the same night.</li>
          <li>If a customer says &quot;stop contacting me&quot;, tell your manager and do not send them again.</li>
          <li>Be polite. You represent Bargain Bay.</li>
        </ul>
      </Sec>

      <Sec id="faq" title="12. Questions people ask">
        <p><b>I forgot my password.</b><br />On the sign-in page, choose the forgot password link. A new one is emailed to you.</p>
        <p><b>My lead says &quot;Not counted&quot;.</b><br />It was a duplicate or was marked junk. Check the person actually contacted you and that the details were real.</p>
        <p><b>Can I see why a lead did not buy?</b><br />No. You see the status only. Our team handles the conversation.</p>
        <p><b>A photo will not download.</b><br />Tap the photo to open it and save it by hand.</p>
        <p><b>An item I posted is not in my portal any more.</b><br />It sold or is on hold. Check the Take these down list and remove the listing.</p>
        <p><b>Who do I ask?</b><br />Your Aljo manager first. They can reach us at Service@rssolutions.ca.</p>
      </Sec>

      <Sec id="check" title="13. Your daily checklist">
        <ul style={{ listStyle: 'none', paddingLeft: 0, margin: '6px 0' }}>
          {[
            'Check the Take these down list and remove every sold listing.',
            'Look at the New since last night items and post the best ones.',
            'Reply to everyone who messaged you. Send a lead for each one who wants to buy.',
            'Check your board to see how your leads are moving.',
            'Keep your phone notifications on so buyers are not left waiting.'
          ].map((t) => <li key={t} style={{ margin: '6px 0' }}>☐ {t}</li>)}
        </ul>
      </Sec>
    </div>
  );
}
