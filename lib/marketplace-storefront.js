// Vendor listings as storefront units. See docs/marketplace/PLAN.md §9.
//
// TWO FLAGS, both OFF until set to "1":
//   MARKETPLACE_STOREFRONT  vendor units are VISIBLE (shop, product page, /marketplace).
//   MARKETPLACE_ORDERING    vendor units can be BOUGHT. Not wired up yet — the checkout split
//                           (vendor orders, the payment-confirmed clocks) is the next slice, so a
//                           visible unit shows "ordering opens soon" instead of an Add to cart.
//
// OPT-IN, NEVER DEFAULT. `lib/inventory`'s readers exclude these units unless the caller passes
// { marketplace: true }, and only the storefront pages do. The reason is how many other readers
// there are — the Meta feed, the Google feed, the sitemap, Sarah's inventory tools, the voice agent,
// the invoice and quote pickers, the order editor, analytics. A vendor unit appearing in any of those
// by accident would be advertised, quoted or sold as ours.
import { query, hasDb } from './db';

export const storefrontOn = () => process.env.MARKETPLACE_STOREFRONT === '1';
export const orderingOn = () => process.env.MARKETPLACE_ORDERING === '1';

export const isMarketplaceSku = (id) => /^MP-\d+-\d+$/.test(String(id || ''));
export const photoUrlFor = (id) => `/api/mp-photo/${id}`;

// Honest copy. The storefront's own `conditionCopy` says "our technicians tested it", which is true
// of our stock and false of a vendor's. This says what a buyer can actually rely on.
const SELLER = 'the seller';
export function marketplaceConditionCopy(condition, vendorName, refurbNotes) {
  const who = vendorName || SELLER;
  switch (condition) {
    case 'New in Box':
      return `Brand new and unused, in its original factory packaging, sold by ${who}.`;
    case 'New Open Box':
      return `New and never used, but the box has been opened (a floor model, a return or repackaged). Sold and described by ${who}.`;
    case 'New Scratch & Dent':
      return `New and never used, with a cosmetic blemish from transit or handling — see the photos of this exact unit. Sold and described by ${who}.`;
    case 'Refurbished':
      return `Previously owned and refurbished by ${who}${refurbNotes ? `: ${refurbNotes}` : ''}. It is sold as Refurbished, not as new.`;
    default:
      return `Sold and described by ${who}.`;
  }
}

/** A live listing row (+ vendor) as a storefront unit. Pure. */
export function toUnit(r, photos = []) {
  const vendorName = r.trade_name || r.legal_name;
  const pub = photos.map((p) => ({ url: photoUrlFor(p.id), role: p.role, position: p.position }));
  const cover = pub.find((p) => p.role === 'front') || pub[0] || null;
  return {
    id: r.sku, make: r.make, model: r.model, category: r.category,
    title: r.title, condition: r.condition,
    price: Number(r.price), compareAt: r.compare_at == null ? 0 : Number(r.compare_at),
    cost: 0, uid: null, imageUrl: null,
    // what makes it a vendor's:
    marketplace: true,
    vendor: { id: r.vendor_id, name: vendorName, slug: r.slug },
    lane: r.lane, warrantyMonths: r.warranty_months,
    sellerDescription: r.description, refurbNotes: r.refurb_notes,
    vendorCover: cover ? cover.url : null,
    vendorPhotos: pub,
    orderable: orderingOn()
  };
}

/**
 * Live vendor units. Returns [] when the storefront flag is off or on ANY failure — the
 * storefront must render whether or not the marketplace tables exist.
 * Only listings that are `live` from a vendor in good standing (`approved`) are shown.
 */
export async function marketplaceUnits({ ids, slug } = {}) {
  if (!storefrontOn() || !hasDb()) return [];
  try {
    const { rows } = await query(
      `SELECT l.id AS listing_id, l.sku, l.vendor_id, l.lane, l.category, l.make, l.model, l.condition, l.title,
              l.description, l.refurb_notes, l.price, l.compare_at, l.warranty_months,
              v.slug, v.trade_name, v.legal_name
         FROM marketplace_listings l JOIN vendors v ON v.id = l.vendor_id
        WHERE l.status = 'live' AND v.status = 'approved'
          AND ($1::text[] IS NULL OR l.sku = ANY($1))
          AND ($2::text IS NULL OR v.slug = $2)
        ORDER BY l.id`, [ids && ids.length ? ids : null, slug || null]);
    if (!rows.length) return [];
    const { rows: ph } = await query(
      `SELECT id, listing_id, role, position FROM listing_photos
        WHERE kind = 'public' AND listing_id = ANY($1) ORDER BY position, id`, [rows.map((r) => r.listing_id)]);
    const by = new Map();
    for (const p of ph) { if (!by.has(p.listing_id)) by.set(p.listing_id, []); by.get(p.listing_id).push(p); }
    return rows.map((r) => toUnit(r, by.get(r.listing_id) || []));
  } catch (e) {
    console.error('marketplace units read failed', e?.message || e);
    return [];
  }
}

/** One approved, live vendor (for /marketplace/v/<slug>), or null. */
export async function publicVendor(slug) {
  if (!storefrontOn() || !hasDb()) return null;
  try {
    const { rows } = await query(
      `SELECT id, slug, trade_name, legal_name, city, approved_at FROM vendors WHERE slug = $1 AND status = 'approved'`, [slug]);
    return rows[0] ? { id: rows[0].id, slug: rows[0].slug, name: rows[0].trade_name || rows[0].legal_name, city: rows[0].city, since: rows[0].approved_at } : null;
  } catch { return null; }
}

/** Approved vendors with something on sale, for the /marketplace landing page. */
export async function vendorsWithStock() {
  if (!storefrontOn() || !hasDb()) return [];
  try {
    const { rows } = await query(
      `SELECT v.slug, COALESCE(v.trade_name, v.legal_name) AS name, v.city, count(*)::int AS units
         FROM vendors v JOIN marketplace_listings l ON l.vendor_id = v.id AND l.status = 'live'
        WHERE v.status = 'approved' GROUP BY v.id ORDER BY units DESC, name`);
    return rows;
  } catch { return []; }
}

/** The public photo behind /api/mp-photo/<id>: a PUBLIC photo of a LIVE listing, nothing else. */
export async function publicPhotoPath(photoId) {
  if (!hasDb()) return null;
  const { rows } = await query(
    `SELECT p.blob_path FROM listing_photos p JOIN marketplace_listings l ON l.id = p.listing_id
      WHERE p.id = $1 AND p.kind = 'public' AND l.status IN ('live','reserved')`, [photoId]);
  return rows[0]?.blob_path || null;
}
