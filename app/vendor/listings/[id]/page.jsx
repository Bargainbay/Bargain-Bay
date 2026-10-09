import { notFound } from 'next/navigation';
import VendorNav from '../../../../components/VendorNav';
import VendorGateView from '../../../../components/VendorGateView';
import ListingEditor from '../../../../components/ListingEditor';
import { vendorGate } from '../../../../lib/vendor-page';
import { getVendorListing } from '../../../../lib/marketplace-listings';
import { canSelfShip, canSell } from '../../../../lib/marketplace-rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit listing — Bargain Bay Marketplace' };

export default async function ListingPage({ params }) {
  const { id } = await params;
  const gate = await vendorGate(`/vendor/listings/${id}`);
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor } = gate.ctx;
  const listing = await getVendorListing(vendor.id, Number(id));
  if (!listing) notFound();                       // another vendor's id is exactly "not found"
  return (
    <div>
      <VendorNav active="listings" name={vendor.trade_name || vendor.legal_name} />
      <ListingEditor initial={listing} canSelfShip={canSelfShip(vendor.tier)} canSell={canSell(vendor.status)} tier={vendor.tier} />
    </div>
  );
}
