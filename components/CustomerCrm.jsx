'use client';
import { useEffect, useState } from 'react';

// The two things that make a customer record worth opening: what was said, and
// what happens next.
//
// The follow-up box is first and deliberately so. Somebody reading a customer's
// history is usually about to ring them, and the thing they most need to do
// afterwards is write down what happens next — which until now they could not.
const KIND_LABEL = { note: 'Note', call: 'Call', email: 'Email', sms: 'Text', visit: 'Visit', system: '' };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA') : '');
const fmtWhen = (d) => (d ? new Date(d).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

export default function CustomerCrm({ customerId }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState(todayStr());
  const [mine, setMine] = useState(true);

  const [kind, setKind] = useState('call');
  const [body, setBody] = useState('');

  const load = () => fetch(`/api/admin/crm?customer=${customerId}`)
    .then((r) => r.json()).then(setData).catch(() => setData({ activity: [], tasks: [] }));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  async function post(payload, after) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/crm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, customerId })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'That did not work.'); return; }
      after?.();
      await load();
    } catch { setErr('Network error.'); } finally { setBusy(false); }
  }

  if (!data) return <div className="panel"><p className="hint" style={{ margin: 0 }}>Loading…</p></div>;

  const open = (data.tasks || []).filter((t) => !t.done_at);
  const closed = (data.tasks || []).filter((t) => t.done_at);
  const overdue = (t) => t.due_on && String(t.due_on).slice(0, 10) < todayStr();

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Follow-ups &amp; history</h2>
      {err && <div className="error-box">{err}</div>}

      {/* ---- what happens next ---- */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0, flex: '1 1 260px' }}>
          <label htmlFor="crm-title">Follow-up</label>
          <input id="crm-title" value={title} onChange={(e) => setTitle(e.target.value)}
                 placeholder="Call about the LG set" />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="crm-due">When</label>
          <input id="crm-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </div>
        <label style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 8 }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          mine
        </label>
        <button className="btn primary" disabled={busy || !title.trim()}
                onClick={() => post(
                  { action: 'task', title, dueOn: dueOn || null, ...(mine ? {} : { ownerEmail: null }) },
                  () => setTitle('')
                )}>
          Add
        </button>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Untick <b>mine</b> to leave it for whoever picks it up — unassigned follow-ups show on
        everyone&apos;s day, which is the point.
      </p>

      {open.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
          {open.map((t) => (
            <li key={t.id} style={{
              display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 10px',
              borderLeft: `3px solid ${overdue(t) ? '#b3261e' : 'var(--line, #ddd)'}`,
              background: overdue(t) ? '#fdf3f2' : 'transparent', marginBottom: 6, borderRadius: 4
            }}>
              <button className="btn" style={{ fontSize: 12 }} disabled={busy}
                      onClick={() => post({ action: 'done', taskId: t.id })}>Done</button>
              <span style={{ flex: 1, fontSize: 14 }}>
                {t.title}
                {t.due_on && <span style={{ color: overdue(t) ? '#b3261e' : 'var(--muted)', marginLeft: 8, fontSize: 12.5, fontWeight: overdue(t) ? 700 : 400 }}>
                  {overdue(t) ? 'overdue — ' : ''}{fmtDate(t.due_on)}
                </span>}
                {!t.owner_email && <span className="pill" style={{ marginLeft: 8, fontSize: 11 }}>unassigned</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ---- what was said ---- */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 18 }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="crm-kind">Log</label>
          <select id="crm-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {['call', 'note', 'email', 'sms', 'visit'].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0, flex: '1 1 320px' }}>
          <label htmlFor="crm-body">What happened</label>
          <input id="crm-body" value={body} onChange={(e) => setBody(e.target.value)}
                 placeholder="Wants it held till Friday" />
        </div>
        <button className="btn" disabled={busy || !body.trim()}
                onClick={() => post({ action: 'log', kind, body }, () => setBody(''))}>
          Save
        </button>
      </div>

      {data.activity?.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0' }}>
          {data.activity.map((e) => (
            <li key={e.id} style={{ padding: '8px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 14 }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>
                {KIND_LABEL[e.kind] && <b style={{ marginRight: 6 }}>{KIND_LABEL[e.kind]}:</b>}
                {e.body}
              </div>
              <div className="hint" style={{ fontSize: 12 }}>
                {fmtWhen(e.at)}{e.by_name || e.by_email ? ` · ${e.by_name || e.by_email}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      {closed.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>Done ({closed.length})</summary>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
            {closed.map((t) => (
              <li key={t.id} style={{ fontSize: 13, opacity: 0.7, padding: '4px 0' }}>
                {t.title} — {fmtDate(t.done_at)}{t.outcome ? ` · ${t.outcome}` : ''}
                <button className="btn" style={{ fontSize: 11, marginLeft: 8 }} disabled={busy}
                        onClick={() => post({ action: 'reopen', taskId: t.id })}>Reopen</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
