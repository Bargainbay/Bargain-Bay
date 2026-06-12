import { getAll } from '../lib/inventory';
import { SITE_URL } from '../lib/site';

export default function sitemap() {
  const now = new Date();
  const staticPages = ['', '/shop', '/contact', '/track', '/policies/returns', '/policies/shipping', '/policies/privacy', '/policies/terms', '/policies/contact'].map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified: now,
    changeFrequency: p === '' || p === '/shop' ? 'daily' : 'monthly',
    priority: p === '' ? 1 : p === '/shop' ? 0.9 : 0.4
  }));
  const collections = ['refrigerators', 'washers-dryers', 'dishwashers', 'ranges-ovens', 'microwaves-hoods', 'under-500'].map((c) => ({
    url: `${SITE_URL}/shop?collection=${c}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.7
  }));
  const products = getAll().map((u) => ({
    url: `${SITE_URL}/product/${encodeURIComponent(u.id)}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.8
  }));
  return [...staticPages, ...collections, ...products];
}
