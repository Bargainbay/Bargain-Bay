'use client';
import { useState, useEffect } from 'react';

const TEMPLATE = `# Bargain Bay Playbook — how we run, in my words

## About us
We sell tested, name-brand liquidation appliances (one of each unit, 1-year warranty), Hamilton / GTA.

## Deliveries — for the drivers
- If a unit is damaged when you arrive: ...
- If the customer isn't home: ...
- Stairs / tight access / doesn't fit: ...
- Taking payment on delivery: ...

## Sales — for the sales guys
- Haggling / lowest price I'll accept: ...
- Bundle deals: ...
- Customer stuck between two units: ...
- Holds / deposits: ...

## Customers
- Tone to use, handling complaints, returns/exchanges, refunds, warranty claims: ...

## Policies & limits
- Delivery hours / areas we cover / what we will and won't do: ...

## How I'd handle common situations
- Write these as "if X, do Y" — Sarah will follow them exactly.`;

export default function PlaybookEditor() {
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/admin/playbook')
      .then((r) => r.json())
      .then((d) => { setContent(d.content || ''); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/admin/playbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      const d = await r.json();
      setMsg(r.ok ? '✓ Saved — Sarah uses this within a minute.' : (d.error || 'Could not save.'));
    } catch {
      setMsg('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        This is how you train Sarah. Write how the business runs and how you&apos;d handle things — she reads it and
        answers your team (delivery, sales, customers) the way you would. You can also just tell her in chat
        (&ldquo;remember that&hellip;&rdquo;) and she&apos;ll add it here herself.
      </p>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={loaded ? TEMPLATE : 'Loading…'}
        rows={18}
        disabled={!loaded}
        style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13.5, lineHeight: 1.55, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn accent" onClick={save} disabled={busy || !loaded}>{busy ? 'Saving…' : 'Save playbook'}</button>
        {loaded && !content && <button type="button" className="btn" onClick={() => setContent(TEMPLATE)}>Insert starter template</button>}
        {msg && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{msg}</span>}
      </div>
    </div>
  );
}
