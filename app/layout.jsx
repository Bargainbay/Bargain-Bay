import './globals.css';
import SiteChrome from '../components/SiteChrome';
import MetaPixel from '../components/MetaPixel';
import AttributionTracker from '../components/AttributionTracker';
import { SALES_EMAIL, PICKUP_ADDRESS } from '../lib/constants';
import { SITE_URL, jsonLd } from '../lib/site';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Bargain Bay — Discount Appliances Pickering & Scarborough | Tested & Working',
    template: '%s | Bargain Bay — Discount Appliances Pickering & Scarborough'
  },
  description:
    'Name-brand appliances at liquidation prices — every unit tested & working with a one-year warranty. Pickup, delivery & freight serving Pickering, Durham Region, Scarborough and the GTA.',
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
    streetAddress: '1135 Squires Beach Rd',
    addressLocality: 'Pickering',
    addressRegion: 'ON',
    postalCode: 'L1W 3T9',
    addressCountry: 'CA'
  },
  areaServed: [
    { '@type': 'City', name: 'Pickering' },
    { '@type': 'City', name: 'Ajax' },
    { '@type': 'City', name: 'Whitby' },
    { '@type': 'City', name: 'Oshawa' },
    { '@type': 'City', name: 'Scarborough' },
    { '@type': 'City', name: 'Toronto' },
    { '@type': 'AdministrativeArea', name: 'Durham Region' },
    { '@type': 'AdministrativeArea', name: 'Greater Toronto Area' }
  ],
  openingHoursSpecification: [{
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    opens: '10:00',
    closes: '20:00'
  }],
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
