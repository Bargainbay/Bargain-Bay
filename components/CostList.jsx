'use client';
import { Fragment, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { COST_FREQUENCIES, COST_CATEGORIES, dailyShare } from '../lib/daily-cost-math';

const money = (v) => `$${Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const blank = () => ({ name: '', category: 'Rent', amount: '', frequency: 'monthly', startsOn: today(), endsOn: '', note: '' });
const field = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)', font: 'inherit' };

async function post(body) {
  const r = await fetch('/api/admin/recurring-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Failed');
}

// One row, edited in place: type the amount, press Enter or tab away, and it is
// saved. The pencil opens the full form (dates, note, name) at the TOP of the
// page, where you can see it -- it used to open under 40 other rows.
function Row({ c, onFull }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(c.amount));
  const [freq, setFreq] = useState(c.frequency);
  const [state, setState] = useState('');
  const saved = useRef({ amount: String(c.amount), freq: c.frequency });

  async function save(nextAmount = amount, nextFreq = freq) {
    if (nextAmount === saved.current.amount && nextFreq === saved.current.freq) return;
    if (nextAmount === '' || Number(nextAmount) < 0 || Number.isNaN(Number(nextAmount))) { setState('Enter an amount'); return; }
    setState('Saving…');
    try {
      await post({ action: 'save', id: c.id, name: c.name, category: c.category, amount: nextAmount, frequency: nextFreq,
        startsOn: c.starts_on, endsOn: c.ends_on || '', note: c.note || '' });
      saved.current = { amount: nextAmount, freq: nextFreq };
      setState('Saved ✓'); router.refresh();
      setTimeout(() => setState(''), 1500);
    } catch (e) { setState(e.message); }
  }

  const perDay = c.frequency === 'once' || freq === 'once' ? null
    : dailyShare({ amount: Number(amount) || 0, frequency: freq, starts_on: c.starts_on, ends_on: c.ends_on }, today() >= c.starts_on ? today() : c.starts_on);
  const empty = Number(amount) === 0;
  return (
    <tr style={empty ? { opacity: 0.75 } : undefined}>
      <td>{c.name}{c.note && !/^Placeholder/.test(c.note) ? <div className="hint">{c.note}</div> : null}</td>
      <td>
        <span style={{ marginRight: 4 }}>$</span>
        <input aria-label={`${c.name} amount before tax`} type="number" min="0" step="0.01" inputMode="decimal"
          value={amount} onChange={(e) => setAmount(e.target.value)}
          onBlur={() => save()} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          onFocus={(e) => e.target.select()}
          style={{ ...field, width: 120, textAlign: 'right' }} />
      </td>
      <td>
        <select aria-label={`${c.name} billed`} value={freq} style={field}
          onChange={(e) => { setFreq(e.target.value); save(amount, e.target.value); }}>
          {COST_FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{perDay == null ? '—' : money(perDay)}</td>
      <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: state.startsWith('Saved') ? 'var(--ok)' : 'var(--muted)' }}>{state}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button type="button" className="dash-filter" onClick={() => onFull(c)}>Details</button>{' '}
        <button type="button" className="dash-filter" onClick={async () => { if (confirm(`Stop counting "${c.name}" from today? Past days keep it.`)) { try { await post({ action: 'remove', id: c.id }); router.refresh(); } catch (e) { setState(e.message); } } }}>Stop</button>
      </td>
    </tr>
  );
}

// The cost list: each bill, how often it comes, and what that works out to per
// day. Amounts are BEFORE tax -- the HST is recovered, so it is not a cost.
export default function CostList({ costs }) {
  const router = useRouter();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const top = useRef(null);

  const total = costs.reduce((a, c) => a + dailyShare(c, today()), 0);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const open = (f) => { setForm(f); setErr(''); setTimeout(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); };
  const unpriced = costs.filter((c) => Number(c.amount) === 0).length;

  async function submit() {
    setBusy(true); setErr('');
    try { await post({ action: 'save', ...form }); setForm(null); router.refresh(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const preview = form && form.amount !== '' ? dailyShare({ amount: form.amount, frequency: form.frequency, starts_on: form.startsOn, ends_on: form.endsOn }, form.frequency === 'once' ? form.startsOn : (today() >= form.startsOn ? today() : form.startsOn)) : null;

  return (
    <div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Cost list</h1>
      <p className="hint">
        Every bill the business pays on a schedule, spread over the days it covers. It becomes the overhead on the{' '}
        <a href="/admin/daily-pnl">daily P&amp;L</a>. <b>Type the amount straight into the row</b> (before tax), press Enter, and it saves.
        Don&apos;t add wages (they come from clock-ins and the driver app) or truck day rates and fuel (dispatch already counts those).
      </p>
      <p style={{ fontSize: 16 }}>
        Overhead today: <b>{money(total)}</b> a day
        {unpriced > 0 && <span className="hint"> · {unpriced} line{unpriced === 1 ? '' : 's'} still at $0</span>}
      </p>

      <div ref={top} style={{ scrollMarginTop: 12 }}>
        {form ? (
          <div style={{ margin: '0 0 18px', padding: 16, border: '2px solid var(--charcoal)', borderRadius: 12, display: 'grid', gap: 12, maxWidth: 560 }}>
            <b style={{ fontSize: 16 }}>{form.id ? `Details: ${form.name}` : 'Add a cost'}</b>
            <label>Name<input style={{ ...field, width: '100%', display: 'block' }} placeholder="Rent, Hydro, Shopify…" value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
            <label>Category
              <select style={{ ...field, width: '100%', display: 'block' }} value={form.category} onChange={(e) => set('category', e.target.value)}>
                {COST_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 180px' }}>Amount before tax ($)
                <input style={{ ...field, width: '100%', display: 'block' }} type="number" min="0" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
              </label>
              <label style={{ flex: '1 1 160px' }}>Billed
                <select style={{ ...field, width: '100%', display: 'block' }} value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>
                  {COST_FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ flex: '1 1 180px' }}>{form.frequency === 'once' ? 'Date' : 'Started'}
                <input style={{ ...field, width: '100%', display: 'block' }} type="date" value={form.startsOn} onChange={(e) => set('startsOn', e.target.value)} />
              </label>
              {form.frequency !== 'once' && (
                <label style={{ flex: '1 1 180px' }}>Ended (optional)
                  <input style={{ ...field, width: '100%', display: 'block' }} type="date" value={form.endsOn} onChange={(e) => set('endsOn', e.target.value)} />
                </label>
              )}
            </div>
            <label>Note (optional)<input style={{ ...field, width: '100%', display: 'block' }} value={form.note} onChange={(e) => set('note', e.target.value)} /></label>
            {preview != null && <span className="hint">{form.frequency === 'once' ? `Counted in full on ${form.startsOn}.` : `Works out to about ${money(preview)} a day.`}</span>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="dash-filter active" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className="dash-filter" onClick={() => setForm(null)}>Cancel</button>
              {err && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</span>}
            </div>
          </div>
        ) : (
          <button type="button" className="dash-filter active" style={{ marginBottom: 12 }} onClick={() => open(blank())}>+ Add a cost</button>
        )}
      </div>

      <div className="table-wrap"><table className="admin">
        <thead><tr><th>Cost</th><th>Amount before tax</th><th>Billed</th><th style={{ textAlign: 'right' }}>Per day</th><th></th><th></th></tr></thead>
        <tbody>
          {costs.length === 0 && <tr><td colSpan={6} className="hint">Nothing yet. Add rent, hydro, insurance, software, loan payments…</td></tr>}
          {costs.map((c, i) => (
            <Fragment key={c.id}>
              {(i === 0 || costs[i - 1].category !== c.category) && (
                <tr key={`h-${c.category}-${i}`}><td colSpan={6} style={{ background: 'var(--tint)', fontWeight: 700, fontSize: 13 }}>{c.category}</td></tr>
              )}
              <Row key={`${c.id}-${c.amount}-${c.frequency}`} c={c} onFull={(x) => open({ id: x.id, name: x.name, category: x.category, amount: x.amount, frequency: x.frequency, startsOn: x.starts_on, endsOn: x.ends_on || '', note: x.note || '' })} />
            </Fragment>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
