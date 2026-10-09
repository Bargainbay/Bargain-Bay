import { redirect } from 'next/navigation';
import { getSession, isStaff, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import AdminNav from '../../../components/AdminNav';
import AdminMarketplace from '../../../components/AdminMarketplace';
import { listVendors } from '../../../lib/vendor-admin';
import { reviewQueue } from '../../../lib/marketplace-listings';
import { strikesAwaitingReview } from '../../../lib/vendors';
import { pendingBankAccounts } from '../../../lib/vendor-bank';
import { listPayouts } from '../../../lib/payouts';
import { allVendorOrders, deliveryRates } from '../../../lib/vendor-orders';
import { REJECT_REASONS } from '../../../lib/listing-rules';
import { STRIKE_REASONS } from '../../../lib/marketplace-rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Marketplace — Bargain Bay' };

// Staff run onboarding and listing review (a rep does that with a vendor on the phone). Banking,
// payouts, strikes, tiers and commission are the business's money and standing: admin only, and
// those tabs are not sent to a staff browser at all.
export default async function MarketplacePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/marketplace');
  if (!isStaff(session)) {
    return <div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) is not on the staff list.</p></div></div>;
  }
  if (!hasDb()) return <div><AdminNav active="marketplace" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  const admin = isAdmin(session);
  const soft = (p, fallback) => p.catch((e) => { console.error('marketplace page', e?.message || e); return fallback; });
  const [vendors, queue, due, banks, payouts, orders, rates] = await Promise.all([
    soft(listVendors(), []),
    soft(reviewQueue(), []),
    admin ? soft(strikesAwaitingReview(), []) : [],
    admin ? soft(pendingBankAccounts(), []) : [],
    admin ? soft(listPayouts(), []) : [],
    soft(allVendorOrders(), []),
    admin ? soft(deliveryRates(), null) : null
  ]);
  return (
    <div>
      <AdminNav active="marketplace" salesOnly={!admin} />
      <AdminMarketplace
        isAdmin={admin}
        vendors={JSON.parse(JSON.stringify(vendors))}
        queue={JSON.parse(JSON.stringify(queue))}
        due={JSON.parse(JSON.stringify(due))}
        banks={JSON.parse(JSON.stringify(banks))}
        payouts={JSON.parse(JSON.stringify(payouts))}
        orders={JSON.parse(JSON.stringify(orders))}
        rates={rates}
        serverNow={new Date().toISOString()}
        rejectReasons={REJECT_REASONS}
        strikeReasons={STRIKE_REASONS}
      />
    </div>
  );
}
