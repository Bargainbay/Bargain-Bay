'use client';
import { useEffect, useState } from 'react';

// What is actually owed to somebody today.
//
// Three buckets, never one list: a run of overdue follow-ups has to read
// differently from a quiet Tuesday, and a single count cannot do that. Next
// week is deliberately absent — a CRM that shows it beside today's work is a
// CRM people stop reading.
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-CA') : '');

function Task({ t, onDone, busy }) {
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '7px 0', borderTop: '1px solid var(--line, #eee)' }}>
      <button className="btn" style={{ fontSize: 12 }} disabled={busy} onClick={() => onDone(t.id)}>Done</button>
      <span style={{ flex: 1, fontSize: 14 }}>
        <a href={`/admin/customers/${t.customer_id}`} style={{ fontWeight: 700, color: 'var(--charcoal)' }}>
          {t.customer_name || t.customer_email || `#${t.customer_id}`}
        </a>
        {' — '}{t.title}
        {/* The number is here so the call can be made without opening anything. */}
        {t.customer_phone && <a href={`tel:${t.customer_phone}`} style={{ marginLeft: 8, fontSize: 12.5 }}>{t.customer_phone}</a>}
        {t.due_on && <span className="hint" style={{ marginLeft: 8, fontSize: 12 }}>{fmt(t.due_on)}</span>}
      </span>
    </li>
  );
}

export default function MyDay() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => fetch('/api/admin/crm?view=my-day').then((r) => r.json()).then(setD).catch(() => setD(null));
  useEffect(() => { load(); }, []);

  async function done(taskId) {
    setBusy(true);
    try {
      await fetch('/api/admin/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'done', taskId })
      });
      await load();
    } finally { setBusy(false); }
  }

  if (!d) return null;
  const total = d.counts.overdue + d.counts.today + d.counts.unowned;

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>
        My day{total ? ` (${total})` : ''}
      </h2>

      {!total && (
        <p className="hint" style={{ margin: 0 }}>
          Nothing due. Follow-ups are added from a customer&apos;s page.
        </p>
      )}

      {d.overdue.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: '#b3261e', margin: '10px 0 0' }}>
            Overdue ({d.overdue.length})
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {d.overdue.map((t) => <Task key={t.id} t={t} onDone={done} busy={busy} />)}
          </ul>
        </>
      )}

      {d.today.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', margin: '14px 0 0' }}>
            Today ({d.today.length})
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {d.today.map((t) => <Task key={t.id} t={t} onDone={done} busy={busy} />)}
          </ul>
        </>
      )}

      {d.unowned.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)', margin: '14px 0 0' }}>
            Nobody&apos;s ({d.unowned.length})
          </h3>
          <p className="hint" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            Not assigned to anyone, so everyone sees them — which is why they do not get forgotten.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {d.unowned.map((t) => <Task key={t.id} t={t} onDone={done} busy={busy} />)}
          </ul>
        </>
      )}
    </div>
  );
}
