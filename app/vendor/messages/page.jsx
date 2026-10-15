import VendorNav from '../../../components/VendorNav';
import VendorGateView from '../../../components/VendorGateView';
import VendorMessages from '../../../components/VendorMessages';
import { vendorGate } from '../../../lib/vendor-page';
import { listVendorThreads, vendorTieOptions, vendorUnreadCount, MAX_BODY, MAX_SUBJECT } from '../../../lib/vendor-messages';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Messages — Bargain Bay Marketplace' };

export default async function MessagesPage({ searchParams }) {
  const gate = await vendorGate('/vendor/messages', 'messages.view');
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor } = gate.ctx;
  const sp = await searchParams;
  const [threads, ties, unread] = await Promise.all([
    listVendorThreads(vendor.id).catch(() => []), vendorTieOptions(vendor.id).catch(() => ({ orders: [], listings: [], claims: [] })), vendorUnreadCount(vendor.id).catch(() => 0)
  ]);
  return (
    <div>
      <VendorNav active="messages" name={vendor.trade_name || vendor.legal_name} role={vendor.role} mfa={gate.ctx.mfa} unread={unread} />
      <VendorMessages initial={JSON.parse(JSON.stringify(threads))} ties={ties} openId={Number(sp?.t) || null} limits={{ body: MAX_BODY, subject: MAX_SUBJECT }} />
    </div>
  );
}
