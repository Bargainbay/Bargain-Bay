import { redirect } from 'next/navigation';
import { getSession } from '../../lib/auth';
import { hasDb } from '../../lib/db';
import { employeeByEmail } from '../../lib/team-clock';
import ClockButton from '../../components/ClockButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Clock in / out', robots: { index: false } };
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#3A3937' };

// The whole screen for anyone who isn't driving: one button. Sign in once with
// the email the office added, and from then on this page opens straight to it.
export default async function ClockPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/clock');
  const employee = hasDb() ? await employeeByEmail(session.email) : null;
  return (
    <div className="drv-page">
      {employee
        ? <ClockButton name={employee.name || session.name || session.email} />
        : (
          <div className="drv-card">
            <h1 className="drv-hello" style={{ marginTop: 0 }}>Not on the team list yet</h1>
            <p className="hint">
              You&apos;re signed in as <b>{session.email}</b>, but the office hasn&apos;t added that
              address as an employee. Ask them to add it, then open this page again.
            </p>
          </div>
        )}
    </div>
  );
}
