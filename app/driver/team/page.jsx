import { redirect } from 'next/navigation';
import { getSession } from '../../../lib/auth';
import { memberFromSession } from '../../../lib/team-board';
import DriverShell from '../../../components/DriverShell';
import TeamChat from '../../../components/TeamChat';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Team board',
  robots: { index: false },
  manifest: '/driver.webmanifest',
  icons: { icon: '/driver-icon-192.png', apple: '/driver-icon-192.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'My stops' }
};
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#3A3937' };

// The team board INSIDE the driver app. It lives under /driver on purpose: the installed
// app (manifest scope, service worker) only covers /driver, so /team opens in a browser
// overlay on a phone while this opens as a screen of the app, with a back button.
// Same board, same rights as /team — they come from the sign-in (lib/team-board.js).
export default async function DriverTeamPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/driver');
  const member = await memberFromSession(session);
  if (!member) redirect('/driver');
  return (
    <DriverShell>
      <p style={{ margin: '4px 0 8px' }}><a href="/driver" className="drv-btn" style={{ display: 'inline-flex', minHeight: 40, padding: '4px 14px' }}>← My stops</a></p>
      <h1 className="drv-hello" style={{ margin: '0 0 10px' }}>Team board</h1>
      <TeamChat initialChannel={sp?.channel || (member.rights.delivery ? 'delivery' : 'general')} />
    </DriverShell>
  );
}
