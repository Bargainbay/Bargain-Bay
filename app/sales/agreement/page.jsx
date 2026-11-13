import { hubPage, NotAuthorized } from '../../../lib/sales-page';
import { getSession, isSalesRep } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { agreementState } from '../../../lib/rep-agreements';
import SalesNav from '../../../components/SalesNav';
import RepAgreement from '../../../components/RepAgreement';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My agreement — Sales Hub' };

// Read and sign the employment and confidentiality agreements. The signer is the SIGNED-IN person.
export default async function AgreementPage() {
  const g = await hubPage('/sales/agreement');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;
  if (!hasDb()) return <div className="panel">Database not configured — set POSTGRES_URL.</div>;
  const session = await getSession();
  const state = await agreementState(viewer.email);
  return (
    <div>
      <SalesNav side={side} name={viewer.name} admin={viewer.admin} />
      <RepAgreement state={state} isRep={isSalesRep(session)} />
    </div>
  );
}
