import { redirect } from 'next/navigation';
import VendorGateView from '../../../components/VendorGateView';
import VendorMfaVerify from '../../../components/VendorMfaVerify';
import { safeNext } from '../../../lib/vendor-next';
import { vendorIdentityGate } from '../../../lib/vendor-page';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Two-factor sign-in — Bargain Bay Marketplace' };

// Where an enrolled user types their code — at sign-in, and again when a sensitive action asks
// for a fresh one. Reachable before the second factor is passed; that is its whole job.
export default async function MfaPage({ searchParams }) {
  const sp = await searchParams;
  const next = safeNext(sp?.next);
  const gate = await vendorIdentityGate(`/vendor/mfa?next=${encodeURIComponent(next)}`);
  if (!gate.ctx) return <VendorGateView {...gate} />;
  if (!gate.ctx.mfa.enrolled) redirect(`/vendor/security?next=${encodeURIComponent(next)}`);
  return <div className="narrow"><VendorMfaVerify next={next} stepUp={!!sp?.fresh} /></div>;
}
