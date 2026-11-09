import { hubPage, NotAuthorized, repCode } from '../../../lib/sales-page';
import { hasDb } from '../../../lib/db';
import { getAvailable } from '../../../lib/inventory';
import { SITE_URL } from '../../../lib/site';
import { money } from '../../../lib/constants';
import SalesNav from '../../../components/SalesNav';
import CopyButton from '../../../components/CopyButton';
import { HoldButton, MyHolds } from '../../../components/HoldControls';
import { listRepHolds } from '../../../lib/rep-holds';
import { costsForSkus } from '../../../lib/sales-services';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Catalog — Sales Hub' };

// Read-only for now: the live, sellable units at the prices a customer sees. Cost
// is NOT on this page (a later change adds it, role-gated, with the live profit
// panel on quotes). Each unit has a share link carrying the rep's code.
export default async function CatalogPage({ searchParams }) {
  const sp = await searchParams;
  const g = await hubPage('/sales/catalog');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;
  if (!hasDb()) return <div className="panel">Database not configured — set POSTGRES_URL.</div>;

  const q = String(sp?.q || '').trim().toLowerCase();
  let units = await getAvailable().catch(() => []);
  if (q) units = units.filter((u) => `${u.make} ${u.model} ${u.title} ${u.id} ${u.category}`.toLowerCase().includes(q));
  const code = repCode(viewer.name, viewer.email);
  const holds = await listRepHolds(viewer);
  // Unit cost is for the owner and the business-development rep only (canSeeCost), and is read here on
  // the server for the rows being shown; it is never sent to anyone else.
  const costs = viewer.canSeeCost ? await costsForSkus(units.slice(0, 120).map((u) => u.id)) : null;
  const shown = units.slice(0, 120);

  return (
    <div>
      <SalesNav side={side} name={viewer.name} />
      {side === 'rs' && <div className="panel hint">RS Solutions services (repair, install, delivery, moving) are added to quotes in the next release. This page lists Bargain Bay appliances.</div>}
      <form method="get" style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <input name="q" defaultValue={sp?.q || ''} placeholder="Search model, brand, category, SKU" aria-label="Search the catalog" style={{ flex: 1 }} />
        <button className="btn" type="submit">Search</button>
      </form>
      <MyHolds holds={holds} isAdmin={viewer.admin} />
      <div className="panel" style={{ overflowX: 'auto' }}>
        <table className="admin" style={{ minWidth: 640 }}>
          <thead><tr><th>Unit</th><th>Condition</th><th>Retail</th><th>Price</th>{costs && <th>Cost</th>}{costs && <th>Margin</th>}<th>Share / hold</th></tr></thead>
          <tbody>
            {shown.map((u) => {
              const link = `${SITE_URL}/product/${encodeURIComponent(u.id)}?rep=${code}`;
              return (
                <tr key={u.id}>
                  <td><b>{u.make} {u.model}</b><div className="hint">{u.title} · {u.id}</div></td>
                  <td>{u.condition}</td>
                  <td>{u.compareAt ? money(u.compareAt) : '—'}</td>
                  <td><b>{money(u.price)}</b></td>
                  {costs && <td>{costs[String(u.id).toUpperCase()] == null ? <span className="hint">not on file</span> : money(costs[String(u.id).toUpperCase()])}</td>}
                  {costs && (() => {
                    const c = costs[String(u.id).toUpperCase()];
                    if (c == null) return <td>—</td>;
                    const m = Number(u.price) - c;
                    return <td style={{ color: m < 0 ? 'var(--red, #c33)' : m < 100 ? '#b7791f' : 'inherit' }}>{money(m)}</td>;
                  })()}
                  <td style={{ whiteSpace: 'nowrap' }}><CopyButton text={link} label="Copy link" /> <HoldButton sku={u.id} /></td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={costs ? 7 : 5} className="hint">No units match.</td></tr>}
          </tbody>
        </table>
        {units.length > shown.length && <p className="hint">Showing {shown.length} of {units.length}. Narrow the search.</p>}
      </div>
    </div>
  );
}
