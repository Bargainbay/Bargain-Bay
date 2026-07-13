// Google Merchant Center product feed (RSS 2.0 + Google Shopping namespace).
// Connect in Merchant Center: Products → Feeds → Scheduled fetch →
//   <SITE_URL>/api/merchant-feed  (daily). See README "Google Merchant Center".
import { getAvailable } from '../../../lib/inventory';
import { seoDescription, leadSentence } from '../../../lib/specs';
import { SITE_URL } from '../../../lib/site';
import { feedShippingWeightKg } from '../../../lib/shipping';

export const dynamic = 'force-dynamic';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

function gCondition(condition) {
  const map = {
    'New in Box': 'new',
    'New Open Box': 'new',
    'Scratch & Dent': 'new',
    'Refurbished': 'refurbished',
    'Used': 'used',
    'Tested & Working': 'used',
    'Haul-away': 'used',
  };
  return map[condition] || 'used';
}

function absoluteImage(img) {
  if (!img) return null;
  if (img.endsWith('.svg')) return null; // Google rejects placeholder art
  return img.startsWith('http') ? img : `${SITE_URL}${img}`;
}

export async function GET() {
  const units = await getAvailable();

  const items = units
    .map((u) => ({ u, img: absoluteImage(u.image) }))
    .filter(({ img }) => img) // skip units that only have SVG placeholders
    .map(({ u, img }) => `    <item>
      <g:id>${esc(u.id)}</g:id>
      <title>${esc(`${u.title || `${u.make} ${u.model}`} (${u.condition})`)}</title>
      <description>${esc(`${leadSentence(u)} ${seoDescription(u)}`)}</description>
      <link>${esc(`${SITE_URL}/product/${encodeURIComponent(u.id)}`)}</link>
      <g:image_link>${esc(img)}</g:image_link>
      <g:price>${Number(u.price).toFixed(2)} CAD</g:price>
      <g:shipping_weight>${feedShippingWeightKg(u)} kg</g:shipping_weight>
      <g:availability>in_stock</g:availability>
      <g:condition>${gCondition(u.condition)}</g:condition>
      <g:brand>${esc(u.make)}</g:brand>
      <g:mpn>${esc(u.model)}</g:mpn>
      <g:google_product_category>Home &amp; Garden &gt; Household Appliances</g:google_product_category>
      <g:identifier_exists>true</g:identifier_exists>
    </item>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Bargain Bay — Liquidation Appliances</title>
    <link>${esc(SITE_URL)}</link>
    <description>Tested &amp; working name-brand appliances with a one-year warranty. Hamilton, Scarborough &amp; the GTA.</description>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // Serve repeats from Vercel's edge cache (Google fetches this ~daily), so a
      // public URL can't be looped to force full-catalog DB scans on every hit.
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400'
    }
  });
}
