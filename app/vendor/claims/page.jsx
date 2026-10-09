import VendorNav from '../../../components/VendorNav';
import VendorGateView from '../../../components/VendorGateView';
import VendorClaims from '../../../components/VendorClaims';
import { vendorGate } from '../../../lib/vendor-page';
import { listVendorClaims } from '../../../lib/warranty-claims';
import { CLAIM_RESPOND_HOURS, CLAIM_RESOLVE_DAYS, CLAIM_RESOLUTIONS } from '../../../lib/marketplace-rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Warranty claims — Bargain Bay Marketplace' };

export default async function ClaimsPage() {
  const gate = await vendorGate('/vendor/claims');
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor } = gate.ctx;
  const claims = await listVendorClaims(vendor.id);
  return (
    <div>
      <VendorNav active="claims" name={vendor.trade_name || vendor.legal_name} />
      <VendorClaims initial={JSON.parse(JSON.stringify(claims))} serverNow={new Date().toISOString()}
        rules={{ respondHours: CLAIM_RESPOND_HOURS, resolveDays: CLAIM_RESOLVE_DAYS, resolutions: CLAIM_RESOLUTIONS }} />
    </div>
  );
}
