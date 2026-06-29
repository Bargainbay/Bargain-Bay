import './globals.css';
import SiteChrome from '../components/SiteChrome';
import MetaPixel from '../components/MetaPixel';
import AttributionTracker from '../components/AttributionTracker';
import { SALES_EMAIL, PICKUP_ADDRESS } from '../lib/constants';
import { SITE_URL, jsonLd } from '../lib/site';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Bargain Bay — Discount Appliances Hamilton & Scarborough | Tested & Working',
    template: '%s | Bargain Bay — Discount Appliances Hamilton & Scarborough'
  },
  description:
    'Name-brand appliances at liquidation prices — every unit tested & working with a one-year warranty. Pickup, delivery & freight serving Hamilton, Scarborough and the GTA.',
  icons: { icon: '/bargain-bay-favicon.png' },
  openGraph: {
    siteName: 'Bargain Bay',
    type: 'website',
    images: ['/bargain-bay-hero-wide.jpg']
  }
};

// Store / LocalBusiness schema — rendered on every page.
const storeSchema = {
  '@context': 'https://schema.org',
  '@type': 'Store',
  name: 'Bargain Bay',
  description:
    'Liquidation arm of RS Solutions. Overstock, open-box and lightly-used name-brand appliances — every unit tested & working and backed by a one-year warranty.',
  url: SITE_URL,
  email: SALES_EMAIL,
  image: `${SITE_URL}/bargain-bay-logo-transparent.png`,
  logo: `${SITE_URL}/bargain-bay-logo-transparent.png`,
  address: {
    '@type': 'PostalAddress',
    streetAddress: '2764 Governors Road',
    addressLocality: 'Lynden',
    addressRegion: 'ON',
    postalCode: 'L0R 1T0',
    addressCountry: 'CA'
  },
  areaServed: [
    { '@type': 'City', name: 'Hamilton' },
    { '@type': 'City', name: 'Scarborough' },
    { '@type': 'AdministrativeArea', name: 'Greater Toronto Area' }
  ],
  priceRange: '$$',
  currenciesAccepted: 'CAD'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <MetaPixel />
        <AttributionTracker />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(storeSchema) }}
        />
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
