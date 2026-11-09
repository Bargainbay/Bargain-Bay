import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { torontoToday } from '../../../lib/constants';
import { listEmployees, staffShiftReport } from '../../../lib/team-clock';
import { payrollWeek, weekBounds } from '../../../lib/payroll-week';
import { payBalances } from '../../../lib/pay-ledger';
import AdminNav from '../../../components/AdminNav';
import PayrollHub from '../../../components/PayrollHub';
import TeamClockAdmin from '../../../components/TeamClockAdmin';
import PayrollManager from '../../../components/PayrollManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Payroll — Bargain Bay' };

// ONE Payroll page: the week's hours and what each person earned, what they are owed and have been paid, the people and
// their rates, every shift (with a way to add a missed one or fix a clock-out), and the older piece-rate log, folded away.
export default async function PayrollPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/payroll');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<div><AdminNav active="payroll" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>);

  const today = torontoToday();
  const w = weekBounds(sp?.week);
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const from = ok(sp?.from) ? sp.from : w.start;
  const to = ok(sp?.to) ? sp.to : w.end;
  let payroll = null, pay = { people: [], names: [] }, employees = [], shifts = [], error = '';
  try {
    [payroll, pay, employees, shifts] = await Promise.all([
      payrollWeek(w.start), payBalances(), listEmployees(), staffShiftReport(from, to)
    ]);
  } catch (e) { console.error('payroll load failed', e.message); error = 'Could not load payroll.'; }
  return (
    <div>
      <AdminNav active="payroll" />
      {error || !payroll ? <div className="error-box">{error || 'No data.'}</div> : (
        <>
          <PayrollHub initial={{ payroll: JSON.parse(JSON.stringify(payroll)), pay: JSON.parse(JSON.stringify(pay)) }} today={today} />
          <div style={{ marginTop: 18 }}>
            <TeamClockAdmin employees={employees} shifts={JSON.parse(JSON.stringify(shifts))} from={from} to={to} />
          </div>
          <details className="panel" style={{ marginTop: 18 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Piece-rate and delivery work (the older method)</summary>
            <PayrollManager />
          </details>
        </>
      )}
    </div>
  );
}
