'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// Bank feed panel on the Financial dashboard. Three states, same shape as the
// QuickBooks panel beside it:
//   - keys not set → the one-time Plaid setup steps
//   - keys, no bank → "Connect a bank account" (opens Plaid Link)
//   - connected    → each institution, when it last pulled, sync / disconnect
//
// Plaid Link is loaded from Plaid's CDN on demand rather than in the app shell:
// it's a third-party script that only this panel needs, and only when an admin
// is actually linking a bank.
const LINK_JS = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

function loadLink() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('no window'));
    if (window.Plaid) return resolve(window.Plaid);
    const existing = document.querySelector(`script[src="${LINK_JS}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Plaid));
      existing.addEventListener('error', () => reject(new Error('Could not load Plaid.')));
      return;
    }
    const el = document.createElement('script');
    el.src = LINK_JS;
    el.onload = () => resolve(window.Plaid);
    el.onerror = () => reject(new Error('Could not load Plaid.'));
    document.head.appendChild(el);
  });
}

export default function PlaidPanel({ status }) {
  const router = useRouter();
  const { configured, connected, institutions = [], lastSync, env } = status || {};
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  // Account balances, read from Plaid once the panel is on screen.
  const [bal, setBal] = useState(null); // null = loading, { accounts, errors }

  async function post(body) {
    const res = await fetch('/api/admin/plaid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'That failed.');
    return d;
  }

  useEffect(() => {
    if (!connected) return undefined;
    let live = true;
    post({ action: 'balances' })
      .then((d) => { if (live) setBal({ accounts: d.accounts || [], errors: d.errors || [] }); })
      .catch((e) => { if (live) setBal({ accounts: [], errors: [e.message] }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, lastSync]);

  // itemId set = re-authenticating a connection whose bank login expired.
  async function link(itemId = null) {
    setBusy('link'); setErr(''); setMsg('');
    try {
      const [{ linkToken }, Plaid] = await Promise.all([post({ action: 'link_token', itemId }), loadLink()]);
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken) => {
          setBusy('exchange');
          try {
            const d = await post({ action: 'exchange', publicToken });
            const n = (d.sync?.added || 0);
            setMsg(`Connected ${d.institution}. ${n} transaction${n === 1 ? '' : 's'} pulled in — set the HST on them below.`);
            router.refresh();
          } catch (e) { setErr(e.message); } finally { setBusy(''); }
        },
        onExit: (e) => {
          setBusy('');
          // A plain close isn't an error; a real failure is.
          if (e && e.error_code) setErr(e.display_message || e.error_message || 'Bank connection cancelled.');
        }
      });
      handler.open();
    } catch (e) {
      setErr(e.message); setBusy('');
    }
  }

  async function act(body, label) {
    setBusy(label); setErr(''); setMsg('');
    try {
      const d = await post(body);
      if (d.disconnected) setMsg('Bank disconnected.');
      else {
        const moved = (d.added || 0) + (d.updated || 0) + (d.removed || 0);
        setMsg(moved
          ? `${d.added || 0} new, ${d.updated || 0} updated, ${d.removed || 0} removed.`
          : 'Already up to date.');
      }
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  // Pull now: ask the bank itself, read what comes back, take the live balance — and say what happened.
  async function pull() {
    setBusy('sync'); setErr(''); setMsg('');
    try {
      const d = await post({ action: 'pull' });
      const moved = (d.added || 0) + (d.updated || 0) + (d.removed || 0);
      const live = d.balances && d.balances.accounts && d.balances.accounts.length;
      if (live) setBal({ accounts: d.balances.accounts, errors: d.balances.errors || [] });
      const parts = [
        moved ? `${d.added || 0} new, ${d.updated || 0} updated, ${d.removed || 0} removed.` : 'No new transactions yet.',
        live ? 'Balances are live from the bank.' : 'Could not get a live balance.'
      ];
      const notes = [...(d.notes || []), ...((d.balances && d.balances.errors) || []), ...(d.errors || [])];
      if (!moved) parts.push('Plaid re-reads TD a few times a day; we have asked it to now, and new lines arrive by themselves when it has them.');
      setMsg(parts.join(' '));
      if (notes.length) setErr(notes.join(' · '));
      router.refresh();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  if (!configured) {
    return (
      <div>
        <p className="hint" style={{ marginTop: 0 }}>
          Link the TD account (and any card) and every transaction lands in the expense ledger by itself —
          pulled live through the day and again each night. You still say what HST was inside each charge;
          the bank never saw the receipt.
        </p>
        <ol style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.7, margin: '6px 0 0', paddingLeft: 18 }}>
          <li>Create a Plaid account at <b>dashboard.plaid.com/signup</b> and request <b>Production</b> access with <b>Canada</b> and the <b>Transactions</b> product.</li>
          <li>In <b>Team Settings → Keys</b>, copy the <b>client_id</b> and the <b>production</b> secret.</li>
          <li>In Vercel set <code>PLAID_CLIENT_ID</code>, <code>PLAID_SECRET</code> and <code>PLAID_ENV=production</code>, then redeploy.</li>
          <li>In Plaid&apos;s <b>Developers → Webhooks</b>, add <code>https://bargainbay.ca/api/plaid/webhook</code> — that&apos;s what makes it live rather than nightly.</li>
          <li>Come back here and hit <b>Connect a bank account</b>.</li>
        </ol>
      </div>
    );
  }

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        {connected
          ? 'Transactions arrive on their own — minutes after they settle, and again on the nightly pass.'
          : 'Link the TD account (and any card) and every transaction lands here by itself.'}
        {env === 'sandbox' && <b style={{ color: 'var(--danger)' }}> · Plaid is in SANDBOX — this is test data, not your bank.</b>}
      </p>

      {connected && <Balances bal={bal} />}

      {institutions.length > 0 && (
        <div className="table-wrap" style={{ margin: '10px 0' }}>
          <table className="admin">
            <thead><tr><th>Bank</th><th>Last pulled</th><th /></tr></thead>
            <tbody>
              {institutions.map((i) => (
                <tr key={i.itemId}>
                  <td>
                    <b>{i.institution}</b>
                    {i.needsReauth && (
                      <span className="pill sold" style={{ fontSize: 11, marginLeft: 6 }}
                        title="The bank login has expired — nothing new is coming in until it's redone">
                        needs sign-in
                      </span>
                    )}
                  </td>
                  <td>{i.lastSync ? new Date(i.lastSync).toLocaleString('en-CA') : 'not yet'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {i.needsReauth && (
                      <>
                        <button className="dash-filter active" disabled={!!busy} onClick={() => link(i.itemId)}>Sign in again</button>{' '}
                      </>
                    )}
                    <button className="dash-filter" disabled={!!busy}
                      onClick={() => {
                        if (!window.confirm(`Disconnect ${i.institution}? Transactions already imported stay in the ledger.`)) return;
                        act({ action: 'disconnect', itemId: i.itemId }, 'disc');
                      }}>Disconnect</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn accent" disabled={!!busy} onClick={() => link(null)}>
          {busy === 'link' || busy === 'exchange' ? 'Opening…' : (connected ? '+ Add another bank' : 'Connect a bank account')}
        </button>
        {connected && (
          <button className="btn" disabled={!!busy} onClick={pull}>
            {busy === 'sync' ? 'Pulling…' : 'Pull now'}
          </button>
        )}
        {lastSync && <span className="hint" style={{ margin: 0 }}>Last pull {new Date(lastSync).toLocaleString('en-CA')}</span>}
      </div>

      {institutions.some((i) => /\bTD\b/i.test(i.institution || '')) && (
        <div className="hint" style={{ marginTop: 10 }}>
          TD Canada Trust only lets Plaid update transactions between about 11pm and 6am Toronto time (4am-11am UTC).
          Pull now at any other hour fails with "Institution not responding" — that is TD's limit, not a fault here.
          The nightly sync runs inside that window.
        </div>
      )}

      {msg && <div className="notice-box" style={{ marginTop: 10 }}>{msg}</div>}
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}


const cad = (v, cur) => (v == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: cur || 'CAD' }).format(v));

// What the bank says is in each account. A card's "current" is what is OWED, so
// it is labelled that way and kept out of the cash total.
function Balances({ bal }) {
  if (!bal) return <p className="hint" style={{ margin: '10px 0' }}>Reading balances…</p>;
  const { accounts, errors } = bal;
  const cash = accounts.filter((a) => a.type === 'depository');
  const total = cash.reduce((t, a) => t + (a.current || 0), 0);
  return (
    <div style={{ margin: '10px 0' }}>
      {accounts.length > 0 && (
        <div className="table-wrap">
          <table className="admin">
            <thead><tr><th>Account</th><th style={{ textAlign: 'right' }}>Balance</th><th style={{ textAlign: 'right' }}>Available</th><th>As of</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.accountId}>
                  <td><b>{a.institution}</b> · {a.name}{a.mask ? ` ····${a.mask}` : ''}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>
                    {cad(a.current, a.currency)}{a.type === 'credit' && <span className="hint" style={{ fontSize: 11 }}> owed</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{a.type === 'credit' ? '—' : cad(a.available, a.currency)}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{a.asOf ? new Date(a.asOf).toLocaleString('en-CA') : 'not stamped by the bank'}</td>
                </tr>
              ))}
              {cash.length > 1 && (
                <tr><td><b>Total in bank accounts</b></td><td style={{ textAlign: 'right', fontWeight: 700 }}>{cad(total, 'CAD')}</td><td /><td /></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ margin: '6px 0 0' }}>
        Shown as the bank last reported it. If the time on a row is old or missing, press Pull now: that asks the bank for the balance this minute.
      </p>
      {errors.length > 0 && <div className="error-box" style={{ marginTop: 8 }}>{errors.join(' · ')}</div>}
    </div>
  );
}
