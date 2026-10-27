// Vesta Kitchen's range as storefront units. Their store (ca.vesta.kitchen) is Shopify, so the catalogue is
// read from its public /products.json and mirrored into `vesta_products` (migration 0039) by syncVesta().
//
// ADDITIVE, like the marketplace: lib/inventory merges these in only for the storefront readers that pass
// { marketplace: true } (shop, home, product page, cart, checkout). The Meta/Google feeds, Sarah, the
// invoice pickers, analytics and the tracker paths never see them — a Vesta item is not stock we hold.
//
// WHAT IS DELIBERATELY NOT IMPORTED
//  * the paid warranty upgrades (Vesta sells them as `warranty` products and as variants of every item);
//    only each product's first, base variant is taken. Warranty cover is Vesta's, and named as such.
//  * anything priced like a placeholder (>= $9,000, or under $5): Vesta lists "Range Hood Parts" at $9,999.00.
import { query, hasDb } from './db';

export const VESTA_HOST = 'https://ca.vesta.kitchen';
export const VESTA_PREFIX = 'VS-';
export const isVestaSku = (id) => /^VS-\d+$/.test(String(id || ''));

// Ordering is its own switch: browsing is on by default, buying a Vesta item through the cart is not until
// the owner says so (cost is unknown to us, so the books treat these lines as zero-cost; see CLAUDE.md).
export const vestaOn = () => process.env.VESTA_STOREFRONT !== 'off';
export const vestaOrderingOn = () => process.env.VESTA_ORDERING === '1';

const STYLE_BY_TYPE = { 'Under Cabinet': 'Under Cabinet', 'Wall Mount': 'Wall Mount', Insert: 'Insert', Island: 'Island' };

/** Vesta's product_type + title -> our { category, subcategory }. Pure. */
export function classify(type, title) {
  const t = String(title || '').toLowerCase();
  switch (type) {
    case 'Under Cabinet': case 'Wall Mount': case 'Insert': case 'Island':
      return { category: 'Range Hood', subcategory: STYLE_BY_TYPE[type] };
    case 'Cooktops':
      return { category: 'Cooktop', subcategory: /induction/.test(t) ? 'Induction' : /ceramic|electric/.test(t) ? 'Electric' : /gas/.test(t) ? 'Gas' : null };
    case 'Rangetops':
      return { category: 'Cooktop', subcategory: 'Gas Rangetop' };
    case 'Gas Range': return { category: 'Range', subcategory: 'Gas' };
    case 'Electric Range': return { category: 'Range', subcategory: 'Electric' };
    case 'Refrigerators': return { category: 'Refrigerator', subcategory: /french/.test(t) ? 'French Door' : /side/.test(t) ? 'Side by Side' : /top|bottom/.test(t) ? 'Bottom Freezer' : null };
    case 'Laundry':
      return /dryer/.test(t) ? { category: 'Dryer', subcategory: 'Electric' } : { category: 'Washer', subcategory: 'Front Load' };
    case 'Microwaves': return { category: 'Microwave', subcategory: /built|trim/.test(t) ? 'Built-in' : null };
    case 'Ovens': return { category: 'Wall Oven', subcategory: /double/.test(t) ? 'Double' : /single/.test(t) ? 'Single' : null };
    case 'Dishwashers': return { category: 'Dishwasher', subcategory: null };
    case 'Massage Chairs': return { category: 'Massage Chair', subcategory: null };
    case 'Tabletop Halogen Ovens': return { category: 'Small Appliance', subcategory: 'Countertop Oven' };
    case 'Accessories':
      return {
        category: 'Range Hood Accessories',
        subcategory: /chimney/.test(t) ? 'Chimney Extensions' : /filter/.test(t) ? 'Filters' : /led|light/.test(t) ? 'Lights' : /backsplash/.test(t) ? 'Backsplashes' : 'Parts'
      };
    default:
      return /cooker|hot pot|kettle|fryer|toaster/.test(t) ? { category: 'Small Appliance', subcategory: null } : null;
  }
}

const strip = (html) => String(html || '')
  .replace(/<\/(li|p|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .split('\n').map((s) => s.trim()).filter(Boolean).join('\n');

// Vesta's own first photo is sometimes a poor lead (a flat bottom view that reads as a blank tile). Name the
// photo to lead with, by a fragment of its file name, per Vesta product id. Every other photo keeps its order.
const LEAD_IMAGE = { 8807224967405: 'Montreal30SSLow' };
const leadFirst = (id, urls) => {
  const want = LEAD_IMAGE[id];
  const i = want ? urls.findIndex((u) => u.includes(want)) : -1;
  return i > 0 ? [urls[i], ...urls.slice(0, i), ...urls.slice(i + 1)] : urls;
};

/** A Shopify product (as in /products.json) -> a row, or null when it should not be listed. Pure. */
export function toRow(p) {
  if (!p || p.product_type === 'warranty') return null;
  const v = (p.variants || [])[0];
  if (!v) return null;
  const price = Number(v.price);
  if (!Number.isFinite(price) || price < 5 || price >= 9000) return null;
  const cls = classify(p.product_type, p.title);
  if (!cls) return null;
  const was = Number(v.compare_at_price);
  return {
    sku: `${VESTA_PREFIX}${p.id}`, handle: p.handle,
    title: String(p.title || '').replace(/^clearance!\s*/i, '').trim(),
    product_type: p.product_type || null, category: cls.category, subcategory: cls.subcategory || null,
    price, compare_at: Number.isFinite(was) && was > price ? was : null,
    in_stock: !!v.available,
    images: leadFirst(p.id, (p.images || []).map((i) => i.src).filter(Boolean)).slice(0, 40),   // every image Vesta publishes (the most any product has is 19)
    description: strip(p.body_html).slice(0, 4000) || null,
    tags: p.tags || []
  };
}

/** A stored row as a storefront unit. Pure. */
export function toUnit(r) {
  const images = Array.isArray(r.images) ? r.images : [];
  return {
    id: r.sku, make: 'Vesta', model: r.title, category: r.category, style: r.subcategory || null,
    title: r.title, condition: 'New in Box',
    price: Number(r.price), compareAt: r.compare_at == null ? 0 : Number(r.compare_at),
    cost: 0, uid: null, imageUrl: null,
    vesta: true, // priced by Vesta and nothing else: lib/pricing.decorate gives it no member tier, clearance or promo
    vestaImages: images, vestaDescription: r.description || '', vestaHandle: r.handle,
    warrantyMonths: 24,
    inStock: !!r.in_stock, orderable: !!r.in_stock && vestaOrderingOn()
  };
}

/** Active Vesta units. [] when switched off, with no database, or on ANY failure. */
export async function vestaUnits({ ids } = {}) {
  if (!vestaOn() || !hasDb()) return [];
  try {
    const { rows } = await query(
      `SELECT * FROM vesta_products WHERE active = true AND ($1::text[] IS NULL OR sku = ANY($1)) ORDER BY category, title`,
      [ids && ids.length ? ids : null]);
    return rows.map(toUnit);
  } catch (e) {
    console.error('vesta units read failed', e?.message || e);
    return [];
  }
}

async function fetchAll(fetcher = fetch) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetcher(`${VESTA_HOST}/products.json?limit=250&page=${page}`, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Vesta feed answered ${res.status}`);
    const { products = [] } = await res.json();
    out.push(...products);
    if (products.length < 250) break;
  }
  return out;
}

/**
 * Mirror Vesta's catalogue. Upserts every listable product and retires (active = false) any that has left the
 * feed. REFUSES to retire anything when the feed came back with fewer than half of what we hold: a partial
 * read must not delist the range.
 */
export async function syncVesta({ fetcher } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const products = await fetchAll(fetcher);
  const rows = products.map(toRow).filter(Boolean);
  if (!rows.length) throw new Error('Vesta feed held nothing listable; left the catalogue alone.');
  for (const r of rows) {
    await query(
      `INSERT INTO vesta_products (sku, handle, title, product_type, category, subcategory, price, compare_at, in_stock, images, description, tags, active, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,true,now())
       ON CONFLICT (sku) DO UPDATE SET handle=$2, title=$3, product_type=$4, category=$5, subcategory=$6, price=$7,
         compare_at=$8, in_stock=$9, images=$10::jsonb, description=$11, tags=$12, active=true, synced_at=now()`,
      [r.sku, r.handle, r.title, r.product_type, r.category, r.subcategory, r.price, r.compare_at, r.in_stock, JSON.stringify(r.images), r.description, r.tags]);
  }
  const { rows: held } = await query('SELECT count(*)::int AS n FROM vesta_products WHERE active = true');
  let retired = 0;
  if (rows.length >= held[0].n * 0.5) {
    const r = await query('UPDATE vesta_products SET active = false WHERE active = true AND sku <> ALL($1)', [rows.map((x) => x.sku)]);
    retired = r.rowCount || 0;
  }
  return { seen: products.length, listed: rows.length, inStock: rows.filter((r) => r.in_stock).length, retired };
}
