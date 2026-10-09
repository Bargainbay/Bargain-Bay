import VendorNav from '../../../components/VendorNav';
import VendorGateView from '../../../components/VendorGateView';
import VendorPolicies from '../../../components/VendorPolicies';
import { vendorGate } from '../../../lib/vendor-page';
import { acceptanceStatus } from '../../../lib/policy-acceptance';
import { POLICIES, isPublished } from '../../../lib/marketplace-policies';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Policies — Bargain Bay Marketplace' };

export default async function PoliciesPage() {
  const gate = await vendorGate('/vendor/policies');
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor } = gate.ctx;
  const status = await acceptanceStatus(vendor.id);
  const docs = POLICIES.filter((p) => isPublished(p) || p.acceptRequired || p.audience !== 'customers')
    .map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, version: p.version, status: p.status, required: p.acceptRequired }));
  return (
    <div>
      <VendorNav active="policies" name={vendor.trade_name || vendor.legal_name} />
      <VendorPolicies
        docs={docs} isOwner={vendor.role === 'owner'}
        accepted={JSON.parse(JSON.stringify(status.accepted))}
        pending={status.pending.map((p) => ({ slug: p.slug, title: p.title, version: p.version }))}
      />
    </div>
  );
}
