// Site-wide URL + SEO helpers. Safe for server components.
export const SITE_URL = (process.env.SITE_URL || 'https://bargain-bay-two.vercel.app').replace(/\/$/, '');

export const SITE_NAME = 'Bargain Bay';
export const SEO_SUFFIX = 'Bargain Bay — Discount Appliances Hamilton & Scarborough';

// Serialize an object for safe embedding in <script type="application/ld+json">.
// JSON.stringify does NOT escape `</script>` or the JS line separators U+2028/29,
// so a value containing those could break out of the tag. Neutralize them.
// (split/join + fromCharCode keeps this source pure-ASCII.)
export function jsonLd(obj) {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(LS).join('\\u2028')
    .split(PS).join('\\u2029');
}
