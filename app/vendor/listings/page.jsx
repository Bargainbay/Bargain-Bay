import VendorNav from '../../../components/VendorNav';
import VendorGateView from '../../../components/VendorGateView';
import VendorListings from '../../../components/VendorListings';
import { vendorGate } from '../../../lib/vendor-page';
import { listVendorListings } from '../../../lib/marketplace-listings';
import { canSell } from '../../../lib/marketplace-rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Listings — Bargain Bay Marketplace' };

export default async function ListingsPage({ searchParams }) {
  const gate = await vendorGate('/vendor/listings');
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor } = gate.ctx;
  const sp = await searchParams;
  const listings = await listVendorListings(vendor.id);
  return (
    <div>
      <VendorNav active="listings" name={vendor.trade_name || vendor.legal_name} />
      <VendorListings initial={listings} initialStatus={sp?.status || ''} canList={canSell(vendor.status)} />
    </div>
  );
}
