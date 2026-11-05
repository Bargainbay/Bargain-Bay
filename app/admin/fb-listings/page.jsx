import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import { getAvailable } from '../../../lib/inventory';
import { decorate } from '../../../lib/pricing';
import { fbListing } from '../../../lib/fb-kit';
import AdminNav from '../../../components/AdminNav';
import FbListings from '../../../components/FbListings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Facebook listings — Bargain Bay' };

// Ready-to-post Facebook Marketplace listings for every unit on sale: title, caption, price, photos.
// Posting is done by hand from the phone; nothing here touches Facebook.
export default async function FbListingsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/fb-listings');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }
  const units = await decorate(await getAvailable(), session); // our own stock only, same prices as the site
  const listings = units.map(fbListing).sort((a, b) => a.category?.localeCompare(b.category || '') || a.title.localeCompare(b.title));
  return (
    <div>
      <AdminNav active="fb-listings" salesOnly={!isAdmin(session)} />
      <FbListings listings={listings} />
    </div>
  );
}
