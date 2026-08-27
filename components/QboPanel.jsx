'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// QuickBooks connection panel on the Financial dashboard. Three states:
//  - keys not set   → setup steps for the one-time Intuit app creation
//  - keys, no grant → big "Connect QuickBooks" button (OAuth)
//  - connected      → company + last sync + "Sync now" / "Disconnect"
export default function QboPanel({ status }) {
  const router = useRouter();
  const { configured, connected, company, lastSync, env, sandboxCompany, imported = 0 } = status || {};
  // Sandbox keys reach one of Intuit's DEMO companies. Its invented
  // transactions import into the real expense ledger exactly like real ones,
  // wrecking the P&L and every input tax credit taken off it — and until this
  // banner existed the panel just said "connected" in green.
  const isSandbox = env === 'sandbox' || sandboxCompany;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function act(body, label) {
    setBusy(true); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/admin/qbo/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `${label} failed`);
      setMsg(d.disconnected
        ? 'Disconnected.'
        : d.purged !== undefined
          ? `Removed ${d.purged} imported row(s) from the expense ledger.`
          : d.synced === 0
            // "Synced 0" reads like a failure and tells you nothing. The usual
            // cause is real and fixable: the books have expenses, they're just
            // older than the window we asked for.
            ? `No Purchases or Bills dated in the last ${d.days || '?'} days. If QuickBooks has older expenses than that, use "Import last 12 months".`
            : `Synced ${d.synced} transaction(s) from the last ${d.days} days${d.errors?.length ? ` (${d.errors.length} issue(s) — see logs)` : ''}.`);
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!configured) {
    return (
      <div>
        <p className="hint" style={{ marginTop: 0 }}>
          Connect QuickBooks and your expenses track themselves: link your bank + credit cards inside QuickBooks
          once, its bank feed captures and categorizes every transaction, and this dashboard pulls them in nightly.
          No manual logging.
        </p>
        <ol style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.7, margin: '6px 0 0', paddingLeft: 18 }}>
          <li>Create a (free) Intuit developer app at <b>developer.intuit.com</b> → "Create an app" → QuickBooks Online Accounting.</li>
          <li>In the app's <b>Production</b> keys page, add redirect URI <code>https://bargainbay.ca/api/admin/qbo/callback</code> and copy the Client ID + Client Secret.</li>
          <li>In Vercel, set <code>QBO_CLIENT_ID</code> + <code>QBO_CLIENT_SECRET</code> and redeploy.</li>
          <li>Come back here and hit <b>Connect QuickBooks</b>.</li>
        </ol>
      </div>
    );
  }

  if (!connected) {
    return (
      <div>
        <p className="hint" style={{ marginTop: 0 }}>
          Keys are set — one click left. You&apos;ll be sent to Intuit to approve access to your books, then dropped back here
          with your last 90 days of expenses imported.
        </p>
        <a className="dash-filter active" href="/api/admin/qbo/connect" style={{ display: 'inline-block', textDecoration: 'none' }}>
          Connect QuickBooks →
        </a>
        {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      </div>
    );
  }

  return (
    <div>
      {isSandbox && (
        <div className="error-box" style={{ marginTop: 0, lineHeight: 1.6 }}>
          <b>This is Intuit&apos;s SANDBOX, not your books.</b> {company ? <><b>{company}</b> is a</> : 'You are connected to a'} demo
          company, and everything it has imported is invented — a landscaping firm&apos;s car washes and burger
          receipts, not your spending.
          {imported > 0 && <> <b>{imported}</b> such row{imported === 1 ? '' : 's'} are in your expense ledger right now, dragging down
            net profit and counting as unreviewed spending against your HST remittance.</>}
          <div style={{ marginTop: 8 }}>
            To switch to the real thing: take the <b>Production</b> keys from your app on developer.intuit.com,
            replace <code>QBO_CLIENT_ID</code> / <code>QBO_CLIENT_SECRET</code> in Vercel, remove
            <code> QBO_ENV</code> (or set it to <code>production</code>), redeploy — then disconnect below,
            clear the imported rows, and connect again.
          </div>
        </div>
      )}
      <p className="hint" style={{ marginTop: 0 }}>
        Connected{company ? <> to <b>{company}</b></> : null}
        {lastSync ? <> · last sync {new Date(lastSync).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</> : null}.
        Expenses pull in automatically every night — keep your bank + cards linked inside QuickBooks (Banking → Link account)
        and there&apos;s nothing else to do.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="dash-filter active" disabled={busy} onClick={() => act({ days: 90 }, 'Sync')}
          title="Pulls the last 90 days — the everyday catch-up.">{busy ? '…' : 'Sync now'}</button>
        {/* The backfill. A first connection needs this: the 90-day window finds
            nothing at all if the books haven't been touched since the spring,
            which looks identical to a broken integration. */}
        <button className="dash-filter" disabled={busy} onClick={() => act({ days: 365 }, 'Import')}
          title="Pulls a full year. Use this on a first connection, or after a gap.">
          {busy ? '…' : 'Import last 12 months'}
        </button>
        {imported > 0 && (
          <button className="dash-filter" disabled={busy}
            title="Deletes every expense row QuickBooks imported. Hand-entered and recurring expenses are untouched."
            onClick={() => {
              if (!window.confirm(`Delete all ${imported} expense row(s) imported from QuickBooks? Anything you typed by hand stays. Reconnecting and syncing brings the real ones back.`)) return;
              act({ action: 'purge_synced' }, 'Purge');
            }}>
            {busy ? '…' : `Remove ${imported} imported row${imported === 1 ? '' : 's'}`}
          </button>
        )}
        <button className="dash-filter" disabled={busy}
          onClick={() => { if (window.confirm('Disconnect QuickBooks? Nightly expense sync stops (already-imported expenses stay).')) act({ action: 'disconnect' }, 'Disconnect'); }}>
          Disconnect
        </button>
      </div>
      {msg && <div className="notice-box" style={{ marginTop: 10 }}>{msg}</div>}
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}
