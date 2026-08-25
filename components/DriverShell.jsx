'use client';
import { useEffect } from 'react';

// The frame around the driver app: registers the service worker (so the stop
// list opens from the home screen with no signal at all) and keeps the page
// clear of site chrome. Client component purely for the registration.
export default function DriverShell({ children }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/driver-sw.js', { scope: '/driver' }).catch(() => {
      // No SW (private window, unsupported browser) just means no offline shell.
      // Everything the driver does is still queued in IndexedDB.
    });
  }, []);
  return <div className="drv-page">{children}</div>;
}
