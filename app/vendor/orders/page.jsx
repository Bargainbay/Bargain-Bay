import VendorNav from '../../../components/VendorNav';
import VendorGateView from '../../../components/VendorGateView';
import VendorOrders from '../../../components/VendorOrders';
import { vendorGate } from '../../../lib/vendor-page';
import { listVendorOrders } from '../../../lib/vendor-orders';
import { insuranceCents, VENDOR_CANCEL_REASONS, CARRIERS, ACCEPT_HOURS, READY_HOURS, INSURANCE_BPS } from '../../../lib/marketplace-rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Orders — Bargain Bay Marketplace' };

export default async function OrdersPage() {
  const gate = await vendorGate('/vendor/orders');
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor } = gate.ctx;
  const orders = await listVendorOrders(vendor.id);
  return (
    <div>
      <VendorNav active="orders" name={vendor.trade_name || vendor.legal_name} />
      <VendorOrders
        initial={JSON.parse(JSON.stringify(orders))} serverNow={new Date().toISOString()}
        cancelReasons={VENDOR_CANCEL_REASONS} carriers={CARRIERS}
        rules={{ acceptHours: ACCEPT_HOURS, readyHours: READY_HOURS, insuranceBps: INSURANCE_BPS }}
      />
    </div>
  );
}
