import { getSession } from '../../lib/auth';
import { hasDb } from '../../lib/db';
import { isDriver, touchDriverSeen } from '../../lib/drivers';
import { driverJobs } from '../../lib/driver-jobs';
import DriverStops from '../../components/DriverStops';
import DriverShell from '../../components/DriverShell';
import AddToHome from '../../components/AddToHome';

export const dynamic = 'force-dynamic';

// Where a driver's link lands them, and therefore the only host their sign-in
// is good for. Same source as the link the office texts.
const DRIVER_HOST = (process.env.DISPATCH_HOSTS || 'dispatch.rssolutions.ca').split(',')[0].trim();
export const metadata = {
  title: 'My stops',
  robots: { index: false },
  manifest: '/driver.webmanifest',
  // iOS reads apple-touch-icon, NOT the manifest — without this the home screen
  // gets a screenshot of the page instead of the RS mark.
  icons: { icon: '/driver-icon-192.png', apple: '/driver-icon-192.png' },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'My stops' }
};
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#3A3937' };

// The driver app. Its own screen, its own session, and nothing on it that isn't
// a stop — no site chrome, no admin, no navigation to get lost in.
//
// Drivers reach it by tapping a texted link (see /d/[token]) and then adding it
// to the home screen; from then on this page IS the app.
export default async function DriverPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  const driver = session && hasDb() ? await isDriver(session) : false;

  if (!driver) {
    return (
      <DriverShell>
        <div className="drv-card">
          <h1 className="drv-hello" style={{ marginTop: 0 }}>Not signed in on this phone</h1>
          <p className="hint">
            {sp?.link === 'expired'
              ? 'That link has already been used or has expired — ask the office to text you a new one.'
              : 'Ask the office to text you your sign-in link. Tapping it once signs this phone in for good.'}
          </p>
          {/* The sign-in cookie belongs to the host the LINK opened, and the link
              is texted on the RS address. Somebody who reaches this page from
              bargainbay.ca is signed in — just not here — and without this line
              the page tells them the opposite. */}
          <p className="hint" style={{ marginTop: 8 }}>
            Your link opens <b>{DRIVER_HOST}</b>. If you got here another way, open it from the text
            message instead — a bookmark to a different address won&apos;t know you.
          </p>
        </div>
      </DriverShell>
    );
  }

  touchDriverSeen(session.userId).catch(() => {});
  const initial = await driverJobs(session.userId).catch(() => ({ date: null, stops: [] }));

  return (
    <DriverShell>
      {/* Chrome fires beforeinstallprompt as soon as it decides the page is
          installable, which is routinely BEFORE React has hydrated — a listener
          added in an effect misses it and the Install button never appears.
          This runs before hydration and parks the event for AddToHome. */}
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html:
          "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__rsInstall=e;window.dispatchEvent(new Event('rs-installable'))});"
        }}
      />
      {/* Which phone this is decides the instructions — see AddToHome. Naming
          iPhone Safari's Share button to an Android driver just tells them the
          app is broken. */}
      <AddToHome welcome={sp?.welcome === '1'} />
      <DriverStops initial={initial} driverName={session.name || ''} />
    </DriverShell>
  );
}
