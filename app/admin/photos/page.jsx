import { redirect } from 'next/navigation';
import { getSession, isAdmin, isStaff } from '../../../lib/auth';
import AdminNav from '../../../components/AdminNav';
import PhotoManager from '../../../components/PhotoManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Photos — Bargain Bay' };

// The photos the storefront shows: the stock picture for each MODEL, and our own
// pictures of each UNIT. Staff — it is the selling side's catalogue.
export default async function PhotosPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/photos');
  if (!isStaff(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the staff list.</p>
    </div></div>);
  }
  return (
    <div>
      <AdminNav active="photos" salesOnly={!isAdmin(session)} />
      <PhotoManager />
    </div>
  );
}
