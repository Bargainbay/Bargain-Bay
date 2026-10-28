import { getSession } from '../../lib/auth';
import { hasDb } from '../../lib/db';
import { getMembership } from '../../lib/members';
import { redirect } from 'next/navigation';
import MemberRequest from '../account/MemberRequest';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Resellers & Businesses — Wholesale Appliances',
  description: 'Property managers, contractors and appliance resellers: apply for wholesale member pricing on tested open-box, scratch-and-dent and refurbished appliances in Durham Region and the GTA.'
};

const WHO = [
  ['Resellers & stores', 'Stock your floor or your online listings with tested appliances at wholesale cost.'],
  ['Property managers & landlords', 'Replace units across a building or portfolio without paying retail.'],
  ['Contractors & builders', 'Outfit kitchens and laundry rooms for clients with one account.']
];
const HOW = [
  ['Create a free account', 'Takes a minute. Sign in with Google or Microsoft, or use your email.'],
  ['Tell us about your business', 'A few details and a short member agreement. No fees, no minimum order to apply.'],
  ['We review it', 'We approve applications quickly and email you the moment you are in.'],
  ['See wholesale prices', 'Your member price shows beside every unit, in the shop and at checkout. Your dashboard lists all available stock with your price and your savings.']
];

export default async function ResellersPage() {
  const session = await getSession();
  let membership = null;
  if (session && hasDb()) membership = await getMembership(session.userId);
  // An approved member has nothing to apply for: send them to their own page.
  if (membership?.role === 'member' && membership?.member_status === 'approved') redirect('/account/member');
  const pending = membership?.member_status === 'pending';

  return (
    <div className="narrow" style={{ maxWidth: 860 }}>
      <div className="panel" style={{ marginBottom: 14 }}>
        <span className="clearance-kicker">Wholesale</span>
        <h1 style={{ margin: '4px 0 10px', color: 'var(--charcoal)' }}>Wholesale pricing for businesses that buy appliances</h1>
        <p style={{ fontSize: 16, margin: '0 0 14px' }}>
          Bargain Bay sells tested open-box, scratch-and-dent and refurbished appliances out of Pickering. Approved
          business accounts get <b>member pricing</b> on the whole catalogue, a dashboard of everything in stock with
          their price on it, and the same pickup and delivery as any customer.
        </p>
        {!session && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a className="btn primary" href="/signup?next=/resellers%23apply">Apply for a business account</a>
            <a className="btn" href="/login?next=/resellers%23apply">I already have an account</a>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12, marginBottom: 14 }}>
        {WHO.map(([h, p]) => (
          <div className="panel" key={h} style={{ margin: 0 }}>
            <h3 style={{ margin: '0 0 6px', color: 'var(--charcoal)' }}>{h}</h3>
            <p style={{ margin: 0, fontSize: 14.5 }}>{p}</p>
          </div>
        ))}
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>How it works</h2>
        <ol style={{ fontSize: 15, lineHeight: 1.6, paddingLeft: 20, margin: 0 }}>
          {HOW.map(([h, p]) => <li key={h}><b>{h}.</b> {p}</li>)}
        </ol>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Good to know</h2>
        <ul style={{ fontSize: 15, lineHeight: 1.6, paddingLeft: 20, margin: 0 }}>
          <li>Every unit is one of a kind. When it is sold it is gone, so the stock list changes daily.</li>
          <li>Wholesale prices are shown to approved members only, once you are signed in.</li>
          <li>Pickup is at 1135 Squires Beach Rd, Pickering. Delivery across the GTA is available at checkout.</li>
          <li>Questions before you apply? <a href="/contact" style={{ textDecoration: 'underline' }}>Contact us</a>.</li>
        </ul>
      </div>

      <div className="panel" id="apply">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Apply</h2>
        {!session ? (
          <p style={{ margin: 0 }}>
            <a href="/signup?next=/resellers%23apply" style={{ textDecoration: 'underline', fontWeight: 700 }}>Create an account</a> or{' '}
            <a href="/login?next=/resellers%23apply" style={{ textDecoration: 'underline', fontWeight: 700 }}>sign in</a>, and this form will be waiting for you here.
          </p>
        ) : pending ? (
          <p style={{ margin: 0 }}>Your application is <b>under review</b>. We will email you at {session.email} as soon as it is approved.</p>
        ) : (
          <>
            {membership?.member_status === 'rejected' && (
              <p className="hint">Your earlier application was not approved. You are welcome to apply again with more detail.</p>
            )}
            <MemberRequest />
          </>
        )}
      </div>
    </div>
  );
}
