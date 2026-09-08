'use client';
import { useEffect } from 'react';
import { reloadHeld } from '../lib/driver-busy';

// The frame around the driver app: registers the service worker (so the stop
// list opens from the home screen with no signal at all) and keeps the page
// clear of site chrome. Client component purely for the registration.
export default function DriverShell({ children }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    navigator.serviceWorker.register('/driver-sw.js', { scope: '/driver' }).catch(() => {
      // No SW (private window, unsupported browser) just means no offline shell.
      // Everything the driver does is still queued in IndexedDB.
    });

    // A new build has taken over — put the driver ON it.
    //
    // An installed app is opened once and then lives in a pocket for days, so a
    // phone could go on running last week's screen long after the office had
    // fixed something on it. The new service worker claims the page as soon as
    // it activates; this is the other half of that, the part that swaps the
    // JavaScript the driver is actually looking at.
    //
    // Never over the top of a half-filled close-out: the signature and photos in
    // an open sheet exist nowhere else yet. It waits, and reloads when the sheet
    // is shut.
    let timer = null;
    const reload = () => {
      if (reloadHeld()) { timer = setTimeout(reload, 5000); return; }
      window.location.reload();
    };
    const onChange = () => { if (!timer) reload(); };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return <div className="drv-page">{children}</div>;
}
