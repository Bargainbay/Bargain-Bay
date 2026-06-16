// app/feed/route.js — Meta product feed at /feed (CSV).
// Point Commerce Manager at https://<your-domain>/feed as a SCHEDULED feed.
// Reuses the SAME data the storefront renders: catalog + clearance markdowns,
// availability from reservations, images from lib/images. The `id` here equals
// the pixel content_ids, so dynamic / Advantage+ catalog ads line up.
import { getAll } from '../../lib/inventory';
import { decorate as decorateClearance } from '../../lib/clearance';
import { unavailableSkus } from '../../lib/reservations';
import { hasRealImage, imageFor } from '../../lib/images';
import { seoDescription } from '../../lib/specs';
import { SITE_URL } from '../../lib/site';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

// Meta condition is coarse (new|refurbished|used). Open-box / scratch&dent are
// functionally new with cosmetic notes -> "new"; adjust here if you prefer.
const CONDITION_MAP = {
  'New in Box': 'new',
  'New Open Box': 'new',
  'Scratch & Dent': 'new',
  'Refurbished': 'refurbished',
  'Used': 'used',
  'Tested & Working': 'used',
};

const COLUMNS = [
  'id', 'title', 'description', 'availability', 'condition',
  'price', 'sale_price', 'link', 'image_link', 'brand',
  'product_type', 'google_product_category',
];
const GPC_APPLIANCES = '604'; // Home & Garden > Household Appliances

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const fmt = (n) => `${Number(n).toFixed(2)} CAD`;

export async function GET() {
  const units = await decorateClearance(getAll()); // clearance markdowns applied
  const blocked = await unavailableSkus();          // sold / reserved units

  const rows = units
    .filter((u) => hasRealImage(u)) // Meta rejects placeholder SVG art
    .map((u) => {
      const current = u.price; // public, clearance-aware price
      const regular = u.compareAt && u.compareAt > current ? u.compareAt : current;
      const onSale = current < regular;
      const img = imageFor(u);
      const imageAbs = img && img.startsWith('http') ? img : `${SITE_URL}${img}`;
      return {
        id: u.id,
        title: (u.title || `${u.make} ${u.model}`).slice(0, 150),
        description: (seoDescription(u) ||
          `${u.make} ${u.model} ${u.category} — ${u.condition}. Tested & working, one-year warranty.`).slice(0, 5000),
        availability: blocked.has(u.id) ? 'out of stock' : 'in stock',
        condition: CONDITION_MAP[u.condition] || 'used',
        price: fmt(regular),
        sale_price: onSale ? fmt(current) : '',
        link: `${SITE_URL}/product/${encodeURIComponent(u.id)}`,
        image_link: imageAbs,
        brand: u.make || 'Bargain Bay',
        product_type: u.category || '',
        google_product_category: GPC_APPLIANCES,
      };
    });

  const csv = [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => esc(r[c])).join(','))].join('\n');
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'inline; filename="bargain-bay-meta-feed.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
