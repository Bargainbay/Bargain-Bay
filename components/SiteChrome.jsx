'use client';
import { usePathname } from 'next/navigation';
import Header from './Header';
import Footer from './Footer';
import ChatWidget from './ChatWidget';
import { DASHBOARD_ROUTES } from '../lib/dashboards';

// Decides the page chrome from the route:
//  - analytics dashboards → full-bleed (the page paints its own dark .dboard)
//  - other admin / driver  → no storefront header/footer/chat (clean portal)
//  - everything else       → the normal storefront chrome
export default function SiteChrome({ children }) {
  const path = usePathname() || '';
  const isDash = DASHBOARD_ROUTES.some((r) => path === r || path.startsWith(r + '/'));
  if (isDash) return children;
  const isPortal = path.startsWith('/admin') || path.startsWith('/driver');
  if (isPortal) return <main className="wrap">{children}</main>;
  return (
    <>
      <Header />
      <main className="wrap">{children}</main>
      <Footer />
      <ChatWidget />
    </>
  );
}
