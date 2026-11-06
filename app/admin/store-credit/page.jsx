import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import AdminNav from '../../../components/AdminNav';
import { listStoreCredits, storeCreditOutstanding } from '../../../lib/store-credit';
import { money } from '../../../lib/constants';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Store credit — Bargain Bay' };

export default async function StoreCreditPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/store-credit');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel"><h1 style={{ marginTop: 0 }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Store credit codes are spendable money, so this list is for admins.</p></div></div>);
  }
  if (!hasDb()) return <div><AdminNav active="reports" /><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  const q = String((await searchParams)?.q || '').trim();
  const [credits, outstanding] = await Promise.all([listStoreCredits({ q }).catch(() => []), storeCreditOutstanding().catch(() => 0)]);
  return (
    <div>
      <AdminNav active="reports" />
      <div className="panel">
        <h1 style={{ marginTop: 0 }}>Store credit</h1>
        <p className="hint">
          Issued when a cancelled order or return is refunded as credit (Refund screen → &ldquo;Give it back as store credit&rdquo;).
          Never expires, and anyone holding the code can spend it at checkout or on an invoice. Owed to customers:{' '}
          <b>{money(outstanding)}</b> (account 2170 on the balance sheet).
        </p>
        <form method="get" style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
          <input name="q" defaultValue={q} placeholder="Search code, name, email or invoice" style={{ flex: 1, maxWidth: 360 }} />
          <button className="btn">Search</button>
        </form>
        <div className="table-wrap">
          <table className="admin">
            <thead><tr><th>Code</th><th>Issued to</th><th>From</th><th>Issued</th><th>Left</th><th>Date</th></tr></thead>
            <tbody>
              {credits.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No store credit {q ? 'matches that search' : 'issued yet'}.</td></tr>}
              {credits.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.code}</b></td>
                  <td>{c.name || '—'}{c.email ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.email}</div> : null}</td>
                  <td>{c.invoiceNumber || '—'}</td>
                  <td>{money(c.issued)}</td>
                  <td><b>{money(c.balance)}</b></td>
                  <td>{c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
