import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { getAvailable } from '../../../lib/inventory';
import { listBundles } from '../../../lib/bundles';
import AdminNav from '../../../components/AdminNav';
import BundlesManager from '../../../components/BundlesManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Packages — Bargain Bay' };

// Package deals (washer + dryer, a whole kitchen). Admin-only: a package price changes what the storefront charges.
export default async function BundlesPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/bundles');
  if (!isAdmin(session)) {
    return <div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1></div></div>;
  }
  if (!hasDb()) return <div><AdminNav active="bundles" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  const [bundles, units] = await Promise.all([listBundles(), getAvailable().catch(() => [])]);
  const options = units.map((u) => ({ id: u.id, title: u.title || `${u.make} ${u.model}`, category: u.category || '', price: Number(u.price) || 0 }));
  return (
    <div>
      <AdminNav active="bundles" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 8px' }}>Packages</h1>
      <BundlesManager initialBundles={bundles} options={options} />
    </div>
  );
}
