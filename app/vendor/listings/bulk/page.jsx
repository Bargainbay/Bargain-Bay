import VendorNav from '../../../../components/VendorNav';
import VendorGateView from '../../../../components/VendorGateView';
import VendorBulkUpload from '../../../../components/VendorBulkUpload';
import { vendorGate } from '../../../../lib/vendor-page';
import { canSell } from '../../../../lib/marketplace-rules';
import { BULK_MAX_ROWS, bulkColumnHelp } from '../../../../lib/listing-bulk';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bulk upload — Bargain Bay Marketplace' };

export default async function BulkPage() {
  const gate = await vendorGate('/vendor/listings/bulk');
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor } = gate.ctx;
  return (
    <div>
      <VendorNav active="listings" name={vendor.trade_name || vendor.legal_name} />
      <VendorBulkUpload max={BULK_MAX_ROWS} help={bulkColumnHelp()} canList={canSell(vendor.status)} />
    </div>
  );
}
