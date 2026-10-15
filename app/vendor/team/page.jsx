import VendorNav from '../../../components/VendorNav';
import VendorGateView from '../../../components/VendorGateView';
import VendorTeam from '../../../components/VendorTeam';
import { vendorGate } from '../../../lib/vendor-page';
import { listTeam } from '../../../lib/vendor-team';
import { VENDOR_ROLES, VENDOR_ROLE_LABELS, VENDOR_ROLE_BLURB } from '../../../lib/vendor-permissions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Team — Bargain Bay Marketplace' };

export default async function TeamPage() {
  const gate = await vendorGate('/vendor/team', 'team.view');
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor, mfa, session } = gate.ctx;
  const team = await listTeam(vendor.id);
  return (
    <div>
      <VendorNav active="team" name={vendor.trade_name || vendor.legal_name} role={vendor.role} mfa={mfa} />
      <VendorTeam
        initial={JSON.parse(JSON.stringify(team))} me={session.email} enrolled={mfa.enrolled}
        roles={VENDOR_ROLES.map((r) => ({ key: r, label: VENDOR_ROLE_LABELS[r], blurb: VENDOR_ROLE_BLURB[r] }))}
      />
    </div>
  );
}
