import { SITE_URL } from '../lib/site';

export default function robots() {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api/', '/account', '/cart', '/checkout', '/login', '/signup', '/order/']
      }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`
  };
}
