import { notFound } from 'next/navigation';
import { getById, getSiblings } from '../../../lib/inventory';
import { decorateOne, decorate } from '../../../lib/pricing';
import { getSession } from '../../../lib/auth';
import { isUnavailable } from '../../../lib/reservations';
import { conditionCopy, leadSentence, specRows, seoDescription } from '../../../lib/specs';
import { SITE_URL } from '../../../lib/site';
import ProductBuyPanel from '../../../components/ProductBuyPanel';
import PixelView from '../../../components/PixelView';

export const dynamic = 'force-dynamic';

const CONDITION_SCHEMA = {
  'New in Box': 'https://schema.org/NewCondition',
  'Refurbished': 'https://schema.org/RefurbishedCondition'
};

export async function generateMetadata({ params }) {
  const u = await getById(decodeURIComponent(params.id));
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
function forPanel(x, sold) {
  return {
    id: x.id,
    make: x.make,
    model: x.model,
    category: x.category,
    title: x.title || `${x.make} ${x.model}`,
    condition: x.condition,
    explainer: conditionCopy(x.condition),
    price: x.price,
    compareAt: x.compareAt || 0,
    clientPrice: x.clientPrice,
    onClearance: !!x.onClearance,
    isMemberPrice: !!x.isMemberPrice,
    image: x.image,
    sold: !!sold
  };
}

export default async function Product({ params }) {
  const base = await getById(decodeURIComponent(params.id));
  if (!base) return notFound();
  const session = await getSession();
  const u = await decorateOne(base, session);
  const sold = await isUnavailable(u.id);
  const siblings = await decorate(await getSiblings(u.make, u.model, u.id), session);

  // Every available unit of this model, cheapest first; the URL's unit is the
  // one preselected in the picker. Siblings come from getAvailable(), so they're
  // already in stock — only the URL unit can be sold/on-hold.
  const units = [forPanel(u, sold), ...siblings.map((s) => forPanel(s, false))]
    .sort((a, b) => a.price - b.price);

  const explainer = conditionCopy(u.condition);
  const rows = specRows(u);
  const warrantyLabel = 'one-year warranty';

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
      '@type': 'Offer',
      price: Number(u.price).toFixed(2),
      priceCurrency: 'CAD',
      availability: sold ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      itemCondition: CONDITION_SCHEMA[u.condition] || 'https://schema.org/UsedCondition',
      url: `${SITE_URL}/product/${encodeURIComponent(u.id)}`
    }
  };

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }} />
      <PixelView id={u.id} name={u.title || `${u.make} ${u.model}`} value={u.price} />

      <ProductBuyPanel units={units} initialId={u.id} />

      <div className="product-desc">
        <h2>About this unit</h2>
        <p>{leadSentence(u)}</p>
        <p>
          Like every appliance at Bargain Bay, it was put through a functional bench test by our
          technicians before listing and is backed by a {warrantyLabel}. Free warehouse pickup,
          flat-fee local delivery, and freight options serve Hamilton, Scarborough and the GTA.
        </p>

        <h2>Condition: {u.condition}</h2>
        <p>{explainer}</p>

        <h2>Specifications</h2>
        <table className="spec-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}><th>{k}</th><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
