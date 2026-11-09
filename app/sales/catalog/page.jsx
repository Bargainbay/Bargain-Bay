import { hubPage, NotAuthorized, repCode } from '../../../lib/sales-page';
import { hasDb } from '../../../lib/db';
import { getAvailable } from '../../../lib/inventory';
import { SITE_URL } from '../../../lib/site';
import { money } from '../../../lib/constants';
import SalesNav from '../../../components/SalesNav';
import CopyButton from '../../../components/CopyButton';
import { HoldButton, MyHolds } from '../../../components/HoldControls';
import { listRepHolds } from '../../../lib/rep-holds';
import { costsForSkus, listServices } from '../../../lib/sales-services';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Catalog — Sales Hub' };

const BASIS = { order: 'per order', unit: 'per unit', hour: 'per hour', appliance: 'per appliance' };
const marginColor = (m) => (m < 0 ? 'var(--red, #c33)' : m < 100 ? '#b7791f' : 'inherit');

// What the rep can sell, by side. Bargain Bay is the appliances (live units at the prices a customer sees, with a
// share link and a 48-hour hold); RS Solutions is the service price list (delivery, installation, haul-away, repair,
// moving…). All shows both. Cost and margin are for the owner and the business-development rep only (canSeeCost),
// read here on the server and never sent to anyone else.
export default async function CatalogPage({ searchParams }) {
  const sp = await searchParams;
  const g = await hubPage('/sales/catalog');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;
  if (!hasDb()) return <div className="panel">Database not configured — set POSTGRES_URL.</div>;

  const showUnits = side !== 'rs';
  const q = String(sp?.q || '').trim().toLowerCase();
  let units = showUnits ? await getAvailable().catch(() => []) : [];
  if (q) units = units.filter((u) => `${u.make} ${u.model} ${u.title} ${u.id} ${u.category}`.toLowerCase().includes(q));
  const shown = units.slice(0, 120);
  const code = repCode(viewer.name, viewer.email);
  const holds = showUnits ? await listRepHolds(viewer) : [];
  const costs = viewer.canSeeCost && shown.length ? await costsForSkus(shown.map((u) => u.id)) : (viewer.canSeeCost ? {} : null);

  // A service belongs to a side, or to both. "All" lists every one.
  const services = (await listServices({ withCost: !!viewer.canSeeCost }))
    .filter((s) => side === 'all' || s.side === side || s.side === 'both')
    .filter((s) => !q || `${s.name} ${s.description || ''}`.toLowerCase().includes(q));
  const sideLabel = side === 'bb' ? 'Bargain Bay' : side === 'rs' ? 'RS Solutions' : '';

  return (
    <div>
      <SalesNav side={side} name={viewer.name} />
      <form method="get" style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <input name="q" defaultValue={sp?.q || ''} placeholder={side === 'rs' ? 'Search services' : 'Search model, brand, category, SKU, service'} aria-label="Search the catalog" style={{ flex: 1 }} />
        <button className="btn" type="submit">Search</button>
      </form>

      {showUnits && <MyHolds holds={holds} isAdmin={viewer.admin} />}

      {showUnits && (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Appliances</h2>
          <table className="admin" style={{ minWidth: 640 }}>
            <thead><tr><th>Unit</th><th>Condition</th><th>Retail</th><th>Price</th>{costs && <th>Cost</th>}{costs && <th>Margin</th>}<th>Share / hold</th></tr></thead>
            <tbody>
              {shown.map((u) => {
                const link = `${SITE_URL}/product/${encodeURIComponent(u.id)}?rep=${code}`;
                const c = costs ? costs[String(u.id).toUpperCase()] : null;
                const m = c == null ? null : Number(u.price) - c;
                return (
                  <tr key={u.id}>
                    <td><b>{u.make} {u.model}</b><div className="hint">{u.title} · {u.id}</div></td>
                    <td>{u.condition}</td>
                    <td>{u.compareAt ? money(u.compareAt) : '—'}</td>
                    <td><b>{money(u.price)}</b></td>
                    {costs && <td>{c == null ? <span className="hint">not on file</span> : money(c)}</td>}
                    {costs && <td style={{ color: m == null ? 'inherit' : marginColor(m) }}>{m == null ? '—' : money(m)}</td>}
                    <td style={{ whiteSpace: 'nowrap' }}><CopyButton text={link} label="Copy link" /> <HoldButton sku={u.id} /></td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={costs ? 7 : 5} className="hint">No units match.</td></tr>}
            </tbody>
          </table>
          {units.length > shown.length && <p className="hint">Showing {shown.length} of {units.length}. Narrow the search.</p>}
        </div>
      )}

      <div className="panel" style={{ overflowX: 'auto' }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>{side === 'bb' ? 'Add-on services' : 'Services'}{sideLabel && side === 'rs' ? ` · ${sideLabel}` : ''}</h2>
        <table className="admin" style={{ minWidth: 640 }}>
          <thead><tr><th>Service</th><th>Price</th>{viewer.canSeeCost && <th>Our cost</th>}{viewer.canSeeCost && <th>Margin</th>}</tr></thead>
          <tbody>
            {services.map((s) => {
              const hasPrice = s.defaultPrice != null;
              const label = !hasPrice ? (s.pricingType === 'custom' ? 'Custom quote' : '—')
                : `${s.pricingType === 'from' ? 'from ' : ''}${money(s.defaultPrice)}${s.pricingType === 'hourly' ? ' / hr' : ''}`;
              const m = hasPrice && s.internalCost != null ? s.defaultPrice - s.internalCost : null;
              return (
                <tr key={s.id}>
                  <td><b>{s.name}</b>{s.description && <div className="hint">{s.description}</div>}</td>
                  <td>{label}</td>
                  {viewer.canSeeCost && <td>{s.internalCost == null ? <span className="hint">not set</span> : `${money(s.internalCost)} ${BASIS[s.costBasis] || ''}`}</td>}
                  {/* a service's margin is naturally small, so only a LOSS is flagged (the $100 yellow line is for appliances) */}
                  {viewer.canSeeCost && <td style={{ color: m != null && m < 0 ? 'var(--red, #c33)' : 'inherit' }}>{m == null ? '—' : money(m)}</td>}
                </tr>
              );
            })}
            {services.length === 0 && <tr><td colSpan={viewer.canSeeCost ? 4 : 2} className="hint">No services listed yet{viewer.admin ? ' — add the starting list on Service prices.' : '.'}</td></tr>}
          </tbody>
        </table>
        <p className="hint" style={{ marginBottom: 0 }}>Add any of these to a quote on the Quotes page; the profit panel there counts their cost.</p>
      </div>
    </div>
  );
}
