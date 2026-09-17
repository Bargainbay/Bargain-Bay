'use client';
import { usePathname } from 'next/navigation';
import Header from './Header';
import Footer from './Footer';
import ChatWidget from './ChatWidget';
import TeamAssistant from './TeamAssistant';
import { DASHBOARD_ROUTES } from '../lib/dashboards';

// Decides the page chrome from the route:
//  - analytics dashboards → full-bleed (the page paints its own dark .dboard)
//  - other admin / driver  → no storefront header/footer/chat (clean portal)
//  - everything else       → the normal storefront chrome
//
// The crew's assistant rides on every portal page. It asks the server who is
// signed in and renders nothing for anyone who isn't a driver or staff, so no
// role check is needed here. Not on pages that exist to be printed.
const PAPER = /\/(print|labels|pod|packing-slip)(\/|$)/;

export default function SiteChrome({ children }) {
  const path = usePathname() || '';
  const crew = path.startsWith('/driver') ? <TeamAssistant placement="driver" />
    : PAPER.test(path) ? null : <TeamAssistant />;
  const isDash = DASHBOARD_ROUTES.some((r) => path === r || path.startsWith(r + '/'));
  if (isDash) return <>{children}{crew}</>;
  const isPortal = path.startsWith('/admin') || path.startsWith('/driver');
  if (isPortal) return <><main className="wrap">{children}</main>{crew}</>;
  return (
    <>
      <Header />
      <main className="wrap">{children}</main>
      <Footer />
      <ChatWidget />
    </>
  );
}
