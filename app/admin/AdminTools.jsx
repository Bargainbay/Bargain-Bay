'use client';
import { useState } from 'react';

// Reservations panel + one-click schema migration for the /admin page.
export default function AdminTools({ initialReservations }) {
  const [reservations, setReservations] = useState(initialReservations);
  const [busySku, setBusySku] = useState(null);
  const [migrateMsg, setMigrateMsg] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState('');

  async function release(sku) {
    setBusySku(sku); setError('');
    try {
      const res = await fetch('/api/admin/reservations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Release failed'); return; }
      setReservations((rs) => rs.filter((r) => r.sku !== sku));
    } catch {
      setError('Network error');
    } finally {
      setBusySku(null);
    }
  }

  async function migrate() {
    setMigrating(true); setMigrateMsg('');
    try {
      const res = await fetch('/api/admin/migrate', { method: 'POST' });
      const data = await res.json();
      setMigrateMsg(res.ok ? `✓ ${data.message}` : `✗ ${data.error}`);
    } catch {
      setMigrateMsg('✗ Network error');
    } finally {
      setMigrating(false);
    }
  }

  return (
    <div>
      <h2 style={{ color: 'var(--charcoal)', marginTop: 28 }}>Active reservations ({reservations.length})</h2>
      <p className="hint" style={{ marginBottom: 12 }}>
        A reservation holds a unit while a checkout is in progress (30 minutes). Releasing one puts the
        unit straight back on sale — only do it if the customer abandoned payment.
      </p>
      {error && <div className="error-box">{error}</div>}
      {reservations.length === 0 ? (
        <div className="panel" style={{ fontSize: 14, color: 'var(--muted)' }}>No active holds right now.</div>
      ) : (
        <div className="table-wrap">
          <table className="admin">
            <thead>
              <tr><th>SKU</th><th>Order</th><th>Expires</th><th></th></tr>
            </thead>
            <tbody>
              {reservations.map((r) => {
                const expired = new Date(r.expires_at) < new Date();
                return (
                  <tr key={r.sku}>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{r.sku}</td>
                    <td>
                      {r.order_number
                        ? <a href={`/order/${r.order_number}${r.email ? `?email=${encodeURIComponent(r.email)}` : ''}`} style={{ fontWeight: 700, color: 'var(--charcoal)' }}>{r.order_number}</a>
                        : '—'}
                      {r.order_status && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.order_status}</div>}
                    </td>
                    <td>
                      {new Date(r.expires_at).toLocaleString('en-CA')}
                      {expired && <span className="pill sold" style={{ marginLeft: 8 }}>expired</span>}
                    </td>
                    <td>
                      <button className="btn danger" style={{ padding: '5px 10px', fontSize: 12.5 }} disabled={busySku === r.sku} onClick={() => release(r.sku)}>
                        {busySku === r.sku ? 'Releasing…' : 'Release'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ color: 'var(--charcoal)', marginTop: 28 }}>Database</h2>
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={migrating} onClick={migrate}>
          {migrating ? 'Running…' : 'Run schema migration'}
        </button>
        <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>
          Applies <code>db/schema.sql</code> (idempotent — safe to re-run). Run once after creating the database
          and after any deploy that changes the schema.
        </span>
        {migrateMsg && <span style={{ fontSize: 13.5, fontWeight: 600 }}>{migrateMsg}</span>}
      </div>
    </div>
  );
}
