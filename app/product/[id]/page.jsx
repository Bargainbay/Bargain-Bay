import { notFound } from 'next/navigation';
import { getById } from '../../../lib/inventory';
import { isUnavailable } from '../../../lib/reservations';
import { money, pctOff, CONDITIONS, PICKUP_ADDRESS } from '../../../lib/constants';
import ConditionPill from '../../../components/ConditionPill';
import AddToCartButton from '../../../components/AddToCartButton';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const u = getById(decodeURIComponent(params.id));
  if (!u) return { title: 'Not found — Bargain Bay' };
  return { title: `${u.title || `${u.make} ${u.model}`} — Bargain Bay` };
}

export default async function Product({ params }) {
  const u = getById(decodeURIComponent(params.id));
  if (!u) return notFound();
  const sold = await isUnavailable(u.id);
  const off = pctOff(u.price, u.compareAt);
  const explainer = CONDITIONS[u.condition] || CONDITIONS['Tested & Working'];

  return (
    <div className="product-layout">
      <div className="product-img">
        <img src={u.image} alt={u.title || `${u.make} ${u.model}`} />
      </div>
      <div>
        <ConditionPill condition={u.condition} />
        {sold && <span className="pill sold" style={{ marginLeft: 8 }}>Sold / on hold</span>}
        <h1 style={{ margin: '10px 0 4px', color: 'var(--navy)' }}>{u.title || `${u.make} ${u.model}`}</h1>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>{u.category} · {u.make}</div>

        <div className="price-row" style={{ margin: '14px 0 4px' }}>
          <span className="product-price">{money(u.price)}</span>
          {u.compareAt > u.price && <span className="compare" style={{ fontSize: 16 }}>{money(u.compareAt)}</span>}
        </div>
        {off > 0 && (
          <div className="savings">You save {money(u.compareAt - u.price)} ({off}% off retail)</div>
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
          <AddToCartButton sku={u.id} available={!sold} />
        </div>

        <div className="meta-list" style={{ marginTop: 18 }}>
          <div>🚚 Free pickup at {PICKUP_ADDRESS} (by appointment), or flat-rate local delivery.</div>
          <div>✔️ Bench-tested &amp; certified working before listing.</div>
          <div>📄 <a href="/policies/returns" style={{ textDecoration: 'underline' }}>Returns &amp; one-year functional warranty</a></div>
        </div>

        <a className="btn" href="/shop" style={{ marginTop: 18 }}>← Back to catalogue</a>
      </div>
    </div>
  );
}
