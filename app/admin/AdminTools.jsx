'use client';
import { useState } from 'react';

// Reservations panel + one-click schema migration for the /admin page.
export default function AdminTools({ initialReservations }) {
  const [reservations, setReservations] = useState(initialReservations);
  const [busySku, setBusySku] = useState(null);
  const [migrateMsg, setMigrateMsg] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState('');
  const [emailMsg, setEmailMsg] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);

  async function importCsv(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setImporting(true); setImportMsg('');
    try {
      const text = await file.text();
      const res = await fetch('/api/admin/import-inventory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: text })
      });
      const d = await res.json();
      setImportMsg(res.ok
        ? `✓ Imported ${d.synced} units${d.deactivated ? `, removed ${d.deactivated} no longer in stock` : ''}.`
        : `✗ ${d.error || 'Import failed'}`);
    } catch {
      setImportMsg('✗ Could not read that file.');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  async function syncInventory() {
    setSyncing(true); setSyncMsg('');
    try {
      const res = await fetch('/api/admin/sync-inventory', { method: 'POST' });
      const d = await res.json();
      setSyncMsg(res.ok
        ? `✓ Synced ${d.synced} available units${d.deactivated ? `, removed ${d.deactivated} no longer in stock` : ''}.`
        : `✗ ${d.error || 'Sync failed'}`);
    } catch {
      setSyncMsg('✗ Network error');
    } finally {
      setSyncing(false);
    }
  }

  async function testEmail() {
    setEmailBusy(true); setEmailMsg('');
    try {
      const res = await fetch('/api/admin/test-email', { method: 'POST' });
      const d = await res.json();
      if (!d.configured) {
        setEmailMsg('✗ RESEND_API_KEY is not set in Vercel — emails are disabled.');
      } else if (d.result?.ok) {
        setEmailMsg(`✓ Sent to ${d.to} from ${d.from} (id ${d.result.id || 'n/a'}). Check that inbox.`);
      } else {
        setEmailMsg(`✗ Resend rejected it (status ${d.result?.status || '?'}): ${d.result?.error || d.result?.reason || 'unknown'} — from=${d.from}`);
      }
    } catch {
      setEmailMsg('✗ Network error');
    } finally {
      setEmailBusy(false);
    }
  }

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

      <h2 style={{ color: 'var(--charcoal)', marginTop: 28 }}>Inventory</h2>
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={syncing} onClick={syncInventory}>
          {syncing ? 'Syncing…' : 'Sync inventory from tracker'}
        </button>
        <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>
          Pulls every "Tested Working" unit from the master tracker into the live storefront (price, cost, serial),
          and removes anything no longer in stock. Needs <code>GOOGLE_CREDENTIALS</code> + <code>SHEET_ID</code>.
        </span>
        {syncMsg && <span style={{ fontSize: 13.5, fontWeight: 600, flexBasis: '100%' }}>{syncMsg}</span>}
        <div style={{ flexBasis: '100%', borderTop: '1px solid var(--line-soft)', paddingTop: 12, marginTop: 2 }}>
          <label className="btn" style={{ cursor: 'pointer', opacity: importing ? 0.6 : 1 }}>
            {importing ? 'Importing…' : 'Import inventory CSV'}
            <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} disabled={importing} onChange={importCsv} />
          </label>
          <span style={{ fontSize: 13.5, color: 'var(--muted)', marginLeft: 12 }}>
            No Google needed — export your tracker's Main tab to CSV and upload it here.
          </span>
          {importMsg && <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 8 }}>{importMsg}</div>}
        </div>
      </div>

      <h2 style={{ color: 'var(--charcoal)', marginTop: 28 }}>Email</h2>
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={emailBusy} onClick={testEmail}>
          {emailBusy ? 'Sending…' : 'Send test email'}
        </button>
        <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>
          Sends a test to <code>NOTIFY_EMAIL</code> and reports exactly what the mail provider said —
          use it to confirm order &amp; member notifications will deliver.
        </span>
        {emailMsg && <span style={{ fontSize: 13.5, fontWeight: 600, flexBasis: '100%' }}>{emailMsg}</span>}
      </div>

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
