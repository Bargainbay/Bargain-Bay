import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import AdminNav from '../../../components/AdminNav';
import SalesCommissionAdmin from '../../../components/SalesCommissionAdmin';
import TeamProfit from '../../../components/TeamProfit';
import RepAgreementAdmin from '../../../components/RepAgreementAdmin';
import { repProfit } from '../../../lib/analytics';
import { getPlans } from '../../../lib/sales-commission';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rep commission — Bargain Bay' };

export default async function SalesCommissionPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/sales-commission');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Commission is for the owner only.</p>
    </div></div>);
  }
  // The reps on the OLDER plan (10% of the day's gross profit once a day reaches $3,000), e.g. Roushi.
  // Anyone on the tiered plan below is left out of this table so nobody appears on two plans.
  let older = null;
  if (hasDb()) {
    try {
      const [gp, plans] = await Promise.all([repProfit({ name: session.name, email: session.email }, { all: true }), getPlans()]);
      const tiered = new Set(Object.values(plans).map((p) => String(p.name || '').trim().toLowerCase()).filter(Boolean));
      if (gp?.team) older = { ...gp, team: gp.team.filter((r) => !tiered.has(String(r.name || '').trim().toLowerCase())) };
    } catch { older = null; }
  }
  return (
    <div>
      <AdminNav active="sales-commission" />
      <h1 style={{ color: 'var(--charcoal)', margin: '4px 0 16px' }}>Rep commission</h1>
      {!hasDb() ? <div className="error-box">Database isn&apos;t configured.</div> : (
        <>
          {older && <TeamProfit data={older} />}
          <SalesCommissionAdmin />
          <RepAgreementAdmin />
        </>
      )}
    </div>
  );
}
