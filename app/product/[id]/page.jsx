import { notFound } from 'next/navigation';
import { getById } from '../../../lib/inventory';
import { decorateOne } from '../../../lib/pricing';
import { getSession } from '../../../lib/auth';
import { isUnavailable } from '../../../lib/reservations';
import { money, pctOff, PICKUP_ADDRESS } from '../../../lib/constants';
import { conditionCopy, leadSentence, specRows, seoDescription } from '../../../lib/specs';
import { SITE_URL } from '../../../lib/site';
import ConditionPill from '../../../components/ConditionPill';
import AddToCartButton from '../../../components/AddToCartButton';
import PixelView from '../../../components/PixelView';

export const dynamic = 'force-dynamic';

const CONDITION_SCHEMA = {
  'New in Box': 'https://schema.org/NewCondition',
  'Refurbished': 'https://schema.org/RefurbishedCondition'
};

export async function generateMetadata({ params }) {
  const u = getById(decodeURIComponent(params.id));
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

export default async function Product({ params }) {
  const base = getById(decodeURIComponent(params.id));
  if (!base) return notFound();
  const u = await decorateOne(base, await getSession());
  const sold = await isUnavailable(u.id);
  const off = pctOff(u.price, u.compareAt);
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
      <div className="product-layout">
        <div className="product-img">
          {u.onClearance && <span className="clearance-badge product-clearance-badge">Clearance</span>}
          <img src={u.image} alt={u.title || `${u.make} ${u.model}`} />
        </div>
        <div>
          <ConditionPill condition={u.condition} />
          {u.onClearance && <span className="pill clearance-pill" style={{ marginLeft: 8 }}>Clearance</span>}
          {sold && <span className="pill sold" style={{ marginLeft: 8 }}>Sold / on hold</span>}
          <h1 style={{ margin: '10px 0 4px' }}>{u.title || `${u.make} ${u.model}`}</h1>
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>{u.category} · {u.make}</div>

          <div className="price-row" style={{ margin: '14px 0 4px' }}>
            <span className={'product-price' + (u.onClearance ? ' price-clearance' : '')}>{money(u.price)}</span>
            {u.compareAt > u.price && <span className="compare" style={{ fontSize: 16 }}>{money(u.compareAt)}</span>}
          </div>
          {off > 0 && (
            <div className="savings">You save {money(u.compareAt - u.price)} ({off}% off retail)</div>
          )}
          {u.isMemberPrice && (
            <div className="member-was">Member price · client price {money(u.clientPrice)}</div>
          )}
          <div className="hint">+ 13% HST at checkout · prices in CAD</div>

          <div className="cond-box">
            <b>{u.condition}:</b> {explainer}
          </div>

          <div className="meta-list">
            <div>Model #: <b style={{ color: 'var(--ink)' }}>{u.model}</b></div>
            <div>SKU: {u.id}</div>
            <div>⚡ <b style={{ color: 'var(--ink)' }}>One available</b> — every Bargain Bay unit is one-of-a-kind. When it&apos;s gone, it&apos;s gone.</div>
          </div>

          <div style={{ maxWidth: 360, marginTop: 12 }}>
            <AddToCartButton sku={u.id} available={!sold} price={u.price} name={u.title || `${u.make} ${u.model}`} />
          </div>

          <div className="meta-list" style={{ marginTop: 18 }}>
            <div>🚚 Free pickup at {PICKUP_ADDRESS} (by appointment), flat-fee local delivery, or freight — Hamilton, Scarborough &amp; the GTA.</div>
            <div>✔️ Bench-tested &amp; certified working before listing.</div>
            <div>📄 <a href="/policies/returns" style={{ textDecoration: 'underline' }}>Returns &amp; {warrantyLabel}</a></div>
          </div>

          <a className="btn" href="/shop" style={{ marginTop: 18 }}>← Back to catalogue</a>
        </div>
      </div>

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
