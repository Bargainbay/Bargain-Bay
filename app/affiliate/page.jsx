import { getSession } from '../../lib/auth';
import { hasDb } from '../../lib/db';
import { SITE_URL } from '../../lib/site';
import { dashboardFor } from '../../lib/affiliates';
import { AFFILIATE_DEFAULT_PCT, AFFILIATE_HOLD_DAYS } from '../../lib/commission-rules';
import AffiliateApply from '../../components/AffiliateApply';
import AffiliateDashboard from '../../components/AffiliateDashboard';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Earn commission selling appliances — Bargain Bay Affiliates',
  description: `Share Bargain Bay's discounted appliances your way and earn ${AFFILIATE_DEFAULT_PCT}% of every sale made with your code.`
};

export default async function AffiliatePage() {
  const session = await getSession();
  let dash = null, error = '';
  if (session && hasDb()) {
    try { dash = await dashboardFor(session); }
    catch (e) { console.error('affiliate dashboard failed', e.message); error = 'We could not load your affiliate account just now. Please try again in a minute.'; }
  }
  const a = dash?.affiliate;

  return (
    <div className="narrow" style={{ maxWidth: 820 }}>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Earn {AFFILIATE_DEFAULT_PCT}% on every appliance you sell</h1>
        <p style={{ fontSize: 16 }}>
          Bargain Bay sells open-box, scratch-and-dent and refurbished appliances at deep discounts, each with a one-year warranty.
          Share them your way — Reels, Marketplace, groups, word of mouth — and earn <b>{AFFILIATE_DEFAULT_PCT}% of the goods on every sale made with your code</b>.
          A $10,000 range pays you $500. There is no cap, no hours, and no boss.
        </p>
        <ol style={{ fontSize: 15, lineHeight: 1.6, paddingLeft: 20 }}>
          <li>Apply below. We approve applications quickly.</li>
          <li>You get your own <b>code and link</b>. Customers who use them get a discount, and the sale is tracked to you.</li>
          <li>Post, share and refer however you like.</li>
          <li>You are paid by e-transfer once the customer has the appliance and the {AFFILIATE_HOLD_DAYS}-day return window has closed. You see every sale and its status in your dashboard.</li>
        </ol>
      </div>

      {error && <div className="error-box">{error}</div>}

      {!session && (
        <div className="panel">
          <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Start here</h2>
          <p>Create a free account (or sign in) and come back to this page to apply.</p>
          <a className="btn btn-primary" href="/signup?next=/affiliate">Create an account</a>{' '}
          <a className="btn" href="/login?next=/affiliate">Sign in</a>
        </div>
      )}

      {session && !error && !a && <AffiliateApply defaultName={session.name || ''} />}

      {a?.status === 'pending' && (
        <div className="panel"><h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Application received</h2>
          <p>Thanks, {a.name}. We will email you at {a.email} once you are approved and your code is ready.</p></div>
      )}
      {a?.status === 'rejected' && (
        <div className="panel"><h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>We can’t take this application</h2>
          <p>We aren’t able to approve your affiliate application right now. Write to us through the contact page if you think this is a mistake.</p></div>
      )}
      {a?.status === 'suspended' && (
        <div className="panel"><h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Your affiliate account is paused</h2>
          <p>Your code is switched off for now. Commission already earned on earlier sales is still yours. Contact us to talk it through.</p></div>
      )}
      {a?.status === 'approved' && dash && <AffiliateDashboard data={dash} siteUrl={SITE_URL} />}

    </div>
  );
}
