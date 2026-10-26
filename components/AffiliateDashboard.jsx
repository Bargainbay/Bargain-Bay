'use client';
// An affiliate's own numbers: their code and link, what is waiting / payable / paid,
// every sale made with the code (no customer details), and where they get paid.
import { useState } from 'react';

const $ = (v) => `$${Number(v || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATE = {
  waiting: ['Waiting for delivery', 'warn'],
  hold: ['In the return window', 'warn'],
  payable: ['Ready to pay', 'ok'],
  void: ['No commission', 'sold']
};

export default function AffiliateDashboard({ data, siteUrl }) {
  const { affiliate: a, sales, payouts, summary: s, clicks } = data;
  const link = `${siteUrl}/?ref=${encodeURIComponent(a.code)}`;
  const [copied, setCopied] = useState('');
  const [pay, setPay] = useState(a.payoutEmail);
  const [msg, setMsg] = useState('');

  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1800); } catch { setCopied('Copy failed — select and copy by hand'); }
  }
  async function savePay() {
    setMsg('');
    const r = await fetch('/api/affiliate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'payout_email', payoutEmail: pay }) });
    const d = await r.json().catch(() => ({}));
    setMsg(r.ok ? 'Saved.' : (d.error || 'Could not save.'));
  }

  return (
    <>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Your code and link</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <code style={{ fontSize: 22, fontWeight: 700, padding: '4px 10px', background: 'var(--line-soft)', borderRadius: 6 }}>{a.code}</code>
          <button className="btn" onClick={() => copy(a.code, 'Code copied')}>Copy code</button>
        </div>
        <div style={{ marginTop: 10, wordBreak: 'break-all', fontSize: 14 }}>{link}</div>
        <button className="btn" style={{ marginTop: 6 }} onClick={() => copy(link, 'Link copied')}>Copy link</button>
        {copied && <span className="hint" style={{ marginLeft: 10 }}>{copied}</span>}
        <p className="hint" style={{ marginTop: 10 }}>
          Anyone who opens your link and checks out gets your code applied automatically, or they can type it at checkout. You earn {a.commissionPct}% of the goods on every sale.
          Remember to say you earn a commission when you post.
        </p>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Your earnings</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Stat label="Owed to you now" value={$(Math.max(0, s.balance))} strong note={s.balance > 0 && s.balance < s.minPayout ? `We pay from ${$(s.minPayout)}` : 'Delivered, past the return window'} />
          <Stat label="Coming" value={$(s.waiting + s.hold)} note={`Not delivered yet, or inside the ${s.holdDays}-day return window`} />
          <Stat label="Paid to you" value={$(s.paid)} />
          <Stat label="Link visitors" value={clicks ? clicks.visitors : 0} note="People who opened your link (once per day each)" />
          <Stat label="Sales" value={s.sales} note={`${$(s.sold)} in goods`} />
        </div>
        {s.balance < 0 && <p className="hint" style={{ marginTop: 8 }}>A refund on an order we had already paid you for will be taken off your next payment.</p>}
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Sales through your code</h2>
        {!sales.length ? <p className="hint">Nothing yet. Your first sale will show here the moment it is placed.</p> : (
          <div className="table-wrap">
            <table className="admin" style={{ minWidth: 0 }}>
              <thead><tr><th>Date</th><th>What sold</th><th style={{ textAlign: 'right' }}>Goods</th><th style={{ textAlign: 'right' }}>Your commission</th><th>Status</th></tr></thead>
              <tbody>
                {sales.map((x) => {
                  const [label, tone] = STATE[x.state];
                  return (
                    <tr key={x.id}>
                      <td>{x.soldOn}</td>
                      <td style={{ maxWidth: 260 }}>{x.what || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{$(x.base)}</td>
                      <td style={{ textAlign: 'right' }}>{x.state === 'void' ? '—' : $(x.commission)}</td>
                      <td><span className={'pill ' + tone}>{x.own ? 'Your own order' : label}</span>
                        {x.state === 'hold' && x.payableOn ? <div className="hint" style={{ margin: 0 }}>payable {x.payableOn}</div> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Where we pay you</h2>
        <div className="field"><label htmlFor="af-pay2">E-transfer email</label>
          <input id="af-pay2" type="email" value={pay} onChange={(e) => setPay(e.target.value)} /></div>
        <button className="btn" onClick={savePay}>Save</button> {msg && <span className="hint">{msg}</span>}
        {payouts.length > 0 && (
          <>
            <h3 style={{ marginBottom: 4 }}>Payments</h3>
            {payouts.map((p) => <div key={p.id} className="hint" style={{ margin: 0 }}>{p.paidOn} · {$(p.amount)} · {p.method}{p.ref ? ` · ${p.ref}` : ''}</div>)}
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, note, strong }) {
  return (
    <div style={{ minWidth: 150 }}>
      <div className="hint" style={{ margin: 0 }}>{label}</div>
      <div style={{ fontSize: strong ? 30 : 24, fontWeight: 700, color: 'var(--charcoal)' }}>{value}</div>
      {note && <div className="hint" style={{ margin: 0 }}>{note}</div>}
    </div>
  );
}
