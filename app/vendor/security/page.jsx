import { redirect } from 'next/navigation';
import VendorNav from '../../../components/VendorNav';
import VendorGateView from '../../../components/VendorGateView';
import VendorSecurity from '../../../components/VendorSecurity';
import { safeNext } from '../../../lib/vendor-next';
import { vendorIdentityGate } from '../../../lib/vendor-page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Security — Bargain Bay Marketplace' };

// Reachable before the second factor is passed: an owner past the grace period is sent HERE to
// enrol. An enrolled user who has not typed their code this session is sent to /vendor/mfa first
// (their recovery codes and settings are not shown to a browser that has not proved it).
export default async function SecurityPage({ searchParams }) {
  const sp = await searchParams;
  const next = sp?.next ? safeNext(sp.next) : '';
  const gate = await vendorIdentityGate('/vendor/security');
  if (!gate.ctx) return <VendorGateView {...gate} />;
  const { vendor, mfa } = gate.ctx;
  if (mfa.enrolled && !mfa.verified) {
    redirect(`/vendor/mfa?next=${encodeURIComponent('/vendor/security')}`);
  }
  const state = {
    enrolled: mfa.enrolled, recoveryLeft: mfa.recoveryLeft, required: mfa.required, available: mfa.available,
    mustEnrol: mfa.mustEnrol, daysLeft: mfa.daysLeft, verified: mfa.verified
  };
  return (
    <div>
      <VendorNav active="security" name={vendor.trade_name || vendor.legal_name} role={vendor.role} mfa={mfa} />
      <VendorSecurity initial={state} next={next} />
    </div>
  );
}
