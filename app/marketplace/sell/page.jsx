import VendorApplyForm from '../../../components/VendorApplyForm';
import { requiredPolicies } from '../../../lib/marketplace-policies';
import { getSession } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { sellerStanding } from '../../../lib/vendors';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sell on Bargain Bay', description: 'Apply to sell appliances to Bargain Bay customers across Durham Region and the GTA.' };

export default async function SellPage() {
  const session = await getSession();
  let standing = { access: null, application: null };
  if (session?.email && hasDb()) { try { standing = await sellerStanding(session.email); } catch { /* show the form */ } }
  const { access, application } = standing;
  const pending = application && application.status === 'applied';

  // What a seller accepts on this form: every required policy at its current version, shown in one scroll box.
  const policies = requiredPolicies().map((p) => ({ slug: p.slug, title: p.title, version: p.version, sections: p.sections() }));
  return (
    <div className="narrow" style={{ maxWidth: 760 }}>
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Sell on Bargain Bay</h1>
        <p style={{ fontSize: 18, margin: '0 0 14px', color: 'var(--muted)' }}>Let us help you turn your products into sales.</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 14px', display: 'grid', gap: 10, fontSize: 18 }}>
          <li>📣&nbsp; <strong>We market</strong> your listings</li>
          <li>🚚&nbsp; <strong>We pick up and deliver</strong></li>
          <li>💸&nbsp; <strong>You get paid</strong></li>
        </ul>
        <p style={{ fontSize: 14, margin: 0 }}>Fees and standards are in the <a href="/marketplace/policies">policies</a>.</p>
      </div>
      <p style={{ fontSize: 14 }}>Not sure yet? Read the <a href="/marketplace/guides/getting-started">getting-started guide</a>, the <a href="/marketplace/guides/packing-and-handover">packing guide</a> and the <a href="/marketplace/policies">policies</a> — everything is out in the open.</p>
      <div className="panel" id="apply">
        {access ? (
          <>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>You are a Bargain Bay seller</h2>
            <p>Your account is set up. <a className="btn primary" href="/vendor">Open your seller dashboard</a></p>
          </>
        ) : pending ? (
          <>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Your application is under review</h2>
            <p style={{ margin: 0 }}>We review each one by hand, usually within two business days. We will email {session.email} the moment you are approved. Then sign in and your seller dashboard, including Payouts, is ready.</p>
          </>
        ) : !session ? (
          <>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Apply</h2>
            <p>Create a free account first, then the application opens right here.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a className="btn primary" href="/signup?next=/marketplace/sell%23apply">Create an account</a>
              <a className="btn" href="/login?next=/marketplace/sell%23apply">I already have an account</a>
            </div>
          </>
        ) : (
          <>
            {application?.status === 'rejected' && <p className="hint">Your earlier application was not approved. You are welcome to apply again.</p>}
            <VendorApplyForm policies={policies} accountEmail={session.email} />
          </>
        )}
      </div>
    </div>
  );
}
