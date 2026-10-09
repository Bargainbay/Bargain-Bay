import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { listAudit } from '../../../lib/audit';
import AdminNav from '../../../components/AdminNav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Change log — Bargain Bay' };

const ENTITIES = ['invoice', 'order', 'clearance', 'coupon'];

export default async function AuditPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/audit');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p></div></div>);
  }
  if (!hasDb()) return (<div><AdminNav active="audit" /><div className="panel">Database not configured.</div></div>);

  const q = String(sp?.q || '').trim();
  const entity = ENTITIES.includes(sp?.entity) ? sp.entity : '';
  const { rows, total } = await listAudit({ q, entity }).catch(() => ({ rows: [], total: 0, failed: true }));

  return (
    <div>
      <AdminNav active="audit" />
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Change log</h1>
        <p className="hint">
          Who changed a price, raised, edited, paid, voided or refunded an invoice, edited or refunded an order, or changed a coupon.
          Nothing here can be edited or deleted. Changes made before this log existed are not in it.
        </p>
        <form method="GET" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
          <input name="q" defaultValue={q} placeholder="Invoice number, SKU, or what happened" style={{ flex: '1 1 240px' }} />
          <select name="entity" defaultValue={entity} style={{ width: 'auto' }}>
            <option value="">Everything</option>
            {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <button className="btn">Search</button>
        </form>
        <p className="hint">{total} entr{total === 1 ? 'y' : 'ies'}{total > rows.length ? ` — showing the latest ${rows.length}` : ''}</p>
        <div className="table-wrap">
          <table className="admin">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>On</th><th>Detail</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString('en-CA', { timeZone: 'America/Toronto' })}</td>
                  <td>{r.actor_name || r.actor}<div style={{ color: 'var(--muted)', fontSize: 12 }}>{r.actor}</div></td>
                  <td>{r.action}</td>
                  <td>{r.entity} {r.entity_id}</td>
                  <td style={{ fontSize: 12.5 }}>{r.summary}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>Nothing logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
