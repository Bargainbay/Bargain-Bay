import { notFound } from 'next/navigation';
import { getById, getSiblings } from '../../../lib/inventory';
import { decorateOne, decorate } from '../../../lib/pricing';
import { getSession } from '../../../lib/auth';
import { isUnavailable } from '../../../lib/reservations';
import { conditionCopy, leadSentence, specRows, seoDescription } from '../../../lib/specs';
import { marketplaceConditionCopy } from '../../../lib/marketplace-storefront';
import { VESTA_HOST } from '../../../lib/vesta';
import { SITE_URL, jsonLd } from '../../../lib/site';
import ProductBuyPanel from '../../../components/ProductBuyPanel';
import PixelView from '../../../components/PixelView';

export const dynamic = 'force-dynamic';

const CONDITION_SCHEMA = {
  'New in Box': 'https://schema.org/NewCondition',
  'Refurbished': 'https://schema.org/RefurbishedCondition'
};

export async function generateMetadata({ params }) {
  const { id } = await params;
  const u = await getById(decodeURIComponent(id), { marketplace: true });
  if (!u) return { title: 'Not found' };
  return {
    title: `${u.make} ${u.model} ${u.category} (${u.condition})`,
    description: seoDescription(u),
    alternates: { canonical: `${SITE_URL}/product/${encodeURIComponent(u.id)}` },
    openGraph: {
      title: `${u.make} ${u.model} ${u.category} (${u.condition}) | Bargain Bay`,
      description: seoDescription(u),
      images: [u.image]
    }
  };
}

// Slim, serializable shape handed to the client buy panel — only the fields the
// picker needs, so we don't ship the whole spec blob to the browser.
const explain = (x) => (x.vesta
  ? 'Brand new in the manufacturer’s box, sold and shipped from Vesta Kitchen’s range through Bargain Bay.'
  : x.marketplace
  ? marketplaceConditionCopy(x.condition, x.vendor?.name, x.refurbNotes)
  : conditionCopy(x.condition));

function forPanel(x, sold) {
  return {
    ...(x.vesta ? {
      vesta: true, vestaImages: x.vestaImages || [], inStock: !!x.inStock, orderable: !!x.orderable,
      warrantyMonths: x.warrantyMonths || 24
    } : {}),
    // A vendor's unit carries who sells it and what they promise; ours carries none of this.
    ...(x.marketplace ? {
      marketplace: true, vendor: x.vendor, lane: x.lane, warrantyMonths: x.warrantyMonths,
      orderable: !!x.orderable, vendorPhotos: x.vendorPhotos || []
    } : {}),
    id: x.id,
    make: x.make,
    model: x.model,
    category: x.category,
    title: x.title || `${x.make} ${x.model}`,
    condition: x.condition,
    explainer: explain(x),
    price: x.price,
    compareAt: x.compareAt || 0,
    clientPrice: x.clientPrice,
    onClearance: !!x.onClearance,
    isMemberPrice: !!x.isMemberPrice,
    image: x.image,
    // The gallery lives in the buy panel, so the photos have to travel with the
    // unit — picking a different one of the same model has to swap its photos
    // along with its price and condition.
    photos: x.photos || [],
    rsopsPhotos: x.rsopsPhotos || [],
    sold: !!sold
  };
}

export default async function Product({ params }) {
  const { id } = await params;
  const base = await getById(decodeURIComponent(id), { marketplace: true });
  if (!base) return notFound();
  const session = await getSession();
  const u = await decorateOne(base, session);
  const sold = await isUnavailable(u.id);
  const siblings = await decorate(await getSiblings(u.make, u.model, u.id, 8, { marketplace: true }), session);

  // Every available unit of this model, cheapest first; the URL's unit is the
  // one preselected in the picker. Siblings come from getAvailable(), so they're
  // already in stock — only the URL unit can be sold/on-hold.
  const units = [forPanel(u, sold), ...siblings.map((s) => forPanel(s, false))]
    .sort((a, b) => a.price - b.price);

  const explainer = explain(u);
  const rows = specRows(u);
  const warrantyLabel = 'one-year warranty';
  const vendorName = u.vendor?.name;

  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: u.title || `${u.make} ${u.model}`,
    image: u.image && u.image.startsWith('http') ? u.image : `${SITE_URL}${u.image}`,
    description: `${leadSentence(u)} ${seoDescription(u)}`,
    brand: { '@type': 'Brand', name: u.make },
    mpn: u.model,
    sku: u.id,
    offers: {
      ...(u.vendor ? { seller: { '@type': 'Organization', name: u.vendor.name } } : {}),
      '@type': 'Offer',
      price: Number(u.price).toFixed(2),
      priceCurrency: 'CAD',
      availability: sold || (u.vesta && !u.inStock) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      itemCondition: CONDITION_SCHEMA[u.condition] || 'https://schema.org/UsedCondition',
      url: `${SITE_URL}/product/${encodeURIComponent(u.id)}`
    }
  };

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(productSchema) }} />
      <PixelView id={u.id} name={u.title || `${u.make} ${u.model}`} value={u.price} />

      <ProductBuyPanel units={units} initialId={u.id} />

      <div className="product-desc">
        {/* The photo grids that used to sit here — ours and RS Ops's — are now
            slides in the gallery at the top of the page (components/ProductGallery).
            Leaving them here as well would show every photograph twice and bury
            the spec table another screen down. */}
        <h2>{u.vesta ? 'About this product' : 'About this unit'}</h2>
        {!u.vesta && <p>{leadSentence(u)}</p>}
        {u.vesta ? (
          <>
            {u.vestaDescription && <p style={{ whiteSpace: 'pre-line' }}>{u.vestaDescription}</p>}
            <p>
              This is a new {u.make} product from the Vesta Kitchen range, listed at Vesta&apos;s price. It is not
              from our warehouse stock and is not a one-of-a-kind unit. Vesta&apos;s manufacturer warranty applies.
            </p>
          </>
        ) : u.marketplace ? (
          <>
            {u.sellerDescription && <p style={{ whiteSpace: 'pre-line' }}>{u.sellerDescription}</p>}
            <p>
              This unit is sold by {vendorName} on the Bargain Bay marketplace. {vendorName} tested and described it and
              backs it with a {u.warrantyMonths || 12}-month warranty.
              {u.lane === 'C' ? ' The seller ships it to you.' : ' Bargain Bay arranges delivery to Pickering, Scarborough and the GTA.'}
            </p>
          </>
        ) : (
          <p>
            Like every appliance at Bargain Bay, it was put through a functional bench test by our
            technicians before listing and is backed by a {warrantyLabel}. Free warehouse pickup,
            flat-fee local delivery, and freight options serve Pickering, Scarborough and the GTA.
          </p>
        )}

        <h2>Condition: {u.condition}</h2>
        <p>{explainer}</p>

        <h2>Specifications</h2>
        <table className="spec-table">
          <tbody>
            {u.vesta && <tr><th>Subcategory</th><td>{u.style || u.category}</td></tr>}
            {rows.map(([k, v]) => (
              <tr key={k}><th>{k}</th><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
