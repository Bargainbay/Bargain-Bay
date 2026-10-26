'use client';
// The application, and the agreement it ends with. The agreement sits in a scroll box and the Accept
// button stays dead until the applicant has scrolled to the bottom of it - the way an app's terms
// work - so "I have read it" means they reached the end. It is a UI guard, not a proof of
// reading, and the server is told which VERSION of the text was shown so what was accepted is on record.
import { useEffect, useRef, useState } from 'react';
import HoneypotField from './HoneypotField';
import { AFFILIATE_TERMS, AFFILIATE_TERMS_VERSION } from '../lib/affiliate-terms';

function Block({ b }) {
  if (b.table) {
    return (
      <table style={{ borderCollapse: 'collapse', margin: '8px 0', fontSize: 13.5, width: '100%' }}>
        <thead><tr>{b.table.head.map((h) => <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid var(--line, #ddd)', padding: '4px 8px 4px 0' }}>{h}</th>)}</tr></thead>
        <tbody>{b.table.rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} style={{ padding: '4px 8px 4px 0', verticalAlign: 'top' }}>{c}</td>)}</tr>)}</tbody>
      </table>
    );
  }
  return (
    <>
      {(b.p || b.lead) && <p style={{ margin: '0 0 8px' }}>{b.lead && <b>{b.lead} </b>}{b.p}</p>}
      {b.ul && <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{b.ul.map((li) => <li key={li}>{li}</li>)}</ul>}
    </>
  );
}

export default function AffiliateApply({ defaultName }) {
  const [f, setF] = useState({ name: defaultName, phone: '', payoutEmail: '', audience: '', website: '' });
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  // At the bottom (a few pixels of slack: browsers round scroll positions), or too short to scroll at all.
  const check = () => {
    const el = box.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setRead(true);
  };
  useEffect(() => { check(); }, []);

  async function submit(e) {
    e.preventDefault();
    if (!read) return;
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/affiliate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, acceptTerms: true, termsVersion: AFFILIATE_TERMS_VERSION })
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not send your application.'); return; }
      window.location.reload();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }

  return (
    <form className="panel" onSubmit={submit} style={{ position: 'relative' }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Apply</h2>
      <HoneypotField value={f.website} onChange={set('website')} />
      <div className="field"><label htmlFor="af-name">Your name</label>
        <input id="af-name" required value={f.name} onChange={set('name')} autoComplete="name" /></div>
      <div className="field"><label htmlFor="af-phone">Phone (optional)</label>
        <input id="af-phone" value={f.phone} onChange={set('phone')} autoComplete="tel" /></div>
      <div className="field"><label htmlFor="af-pay">Email for e-transfers</label>
        <input id="af-pay" type="email" required value={f.payoutEmail} onChange={set('payoutEmail')} />
        <div className="hint">This is where we send your commission. You can change it later.</div></div>
      <div className="field"><label htmlFor="af-aud">How will you promote us?</label>
        <textarea id="af-aud" required rows={3} value={f.audience} onChange={set('audience')}
          placeholder="e.g. I run a Durham-region Facebook group of 4,000 landlords and post deals weekly." />
        <div className="hint">Your audience, platforms, or the people you work with.</div></div>

      <h3 style={{ margin: '16px 0 6px', color: 'var(--charcoal)' }}>Affiliate Agreement</h3>
      <div
        ref={box} onScroll={check} role="region" tabIndex={0} aria-label="Affiliate Agreement. Scroll to the end to enable the Accept button."
        style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: '12px 14px', fontSize: 14, lineHeight: 1.5, background: '#fff' }}
      >
        {AFFILIATE_TERMS.map((s) => (
          <section key={s.title} style={{ marginBottom: 12 }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 15 }}>{s.title}</h4>
            {s.blocks.map((b, i) => <Block key={i} b={b} />)}
          </section>
        ))}
      </div>
      <div className="hint" style={{ margin: '6px 0 10px' }} aria-live="polite">
        {read ? '✓ You have reached the end of the agreement.' : 'Scroll to the end of the agreement to continue.'}
      </div>

      {err && <div className="error-box" style={{ marginBottom: 8 }}>{err}</div>}
      <button className="btn btn-primary" disabled={busy || !read}>{busy ? 'Sending…' : 'Accept and send my application'}</button>
    </form>
  );
}
