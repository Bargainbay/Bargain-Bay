'use client';
// Sales per day for a month, against any other months picked beside it.
//
// The first month is the one being looked at; each other month is compared with
// it. Up to two months are drawn as bars side by side, three or more as lines
// (bars that thin cannot be told apart). Every figure in the chart is also in the
// tables under it, so colour is never the only way to read it.
import { useCallback, useEffect, useState } from 'react';
import { addMonths, monthName } from '../lib/rep-periods';
import { daySeries, runningTotal, sameDayCut, monthSummary, change, weekdayOf, isRunning, daysIn } from '../lib/month-sales';

// Fixed order, validated for colour-blind separation on the dark dashboard.
const COLOURS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c'];
const MAX = COLOURS.length;
const MEASURES = [
  ['revenue', 'Sales before tax'], ['revenueWithTax', 'Sales with tax'], ['gp', 'Gross profit'], ['sales', 'Number of sales']
];

const money = (v) => `${v < 0 ? '−' : ''}$${Math.abs(Number(v) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (v) => `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-CA')}`;
const monthLabel = (m) => monthName(`${m}-01`);

const W = 960, H = 320, PAD = { l: 66, r: 12, t: 14, b: 40 };

// A round number at or above v, for the top of the axis.
function niceTop(v) {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v));
  // Steps that divide cleanly into the four gridlines, without leaving half the chart empty.
  return [1, 1.2, 1.6, 2, 2.4, 3.2, 4, 5, 6, 8, 10].map((k) => k * step).find((t) => t >= v);
}

function Chart({ series, kind, fmt, axisFmt, active, onActive }) {
  const days = Math.max(...series.map((s) => s.values.length), 1);
  const all = series.flatMap((s) => s.values.filter((v) => v != null));
  const top = niceTop(Math.max(...all, 0));
  const bottom = Math.min(...all, 0) < 0 ? -niceTop(-Math.min(...all)) : 0;
  const plotW = W - PAD.l - PAD.r, band = plotW / days;
  const x = (i) => PAD.l + i * band + band / 2;
  const y = (v) => PAD.t + (H - PAD.t - PAD.b) * ((top - v) / (top - bottom));
  const ticks = [...new Set([bottom, 0, top / 4, top / 2, (3 * top) / 4, top])];
  const barW = Math.max(2, Math.min((band * 0.8) / series.length - 2, 18));
  const line = (values) => {
    let d = '', pen = false;
    values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
    });
    return d;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sales by day of the month" style={{ display: 'block', minWidth: 640 }}
      onMouseLeave={() => onActive(null)}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--line)' : 'var(--line-soft)'} />
          <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{axisFmt(t)}</text>
        </g>
      ))}
      {active != null && <rect x={PAD.l + active * band} y={PAD.t} width={band} height={H - PAD.t - PAD.b} fill="var(--charcoal)" opacity="0.07" />}
      {kind === 'bars'
        ? series.map((s, k) => s.values.map((v, i) => {
          if (v == null || v === 0) return null;
          const left = x(i) - (series.length * (barW + 2) - 2) / 2 + k * (barW + 2);
          const h = Math.max(Math.abs(y(v) - y(0)), 2), r = Math.min(4, barW / 2, h);
          // Rounded at the data end only; square on the baseline.
          const d = v > 0
            ? `M${left},${y(0)}v${-(h - r)}q0,${-r} ${r},${-r}h${barW - 2 * r}q${r},0 ${r},${r}v${h - r}z`
            : `M${left},${y(0)}v${h - r}q0,${r} ${r},${r}h${barW - 2 * r}q${r},0 ${r},${-r}v${-(h - r)}z`;
          return <path key={`${s.month}-${i}`} d={d} fill={s.colour} />;
        }))
        : series.map((s) => <path key={s.month} d={line(s.values)} fill="none" stroke={s.colour} strokeWidth={s.main ? 2.5 : 2} strokeLinejoin="round" />)}
      {kind === 'lines' && active != null && series.map((s) => (s.values[active] == null ? null
        : <circle key={s.month} cx={x(active)} cy={y(s.values[active])} r="4.5" fill={s.colour} stroke="var(--card)" strokeWidth="2" />))}
      {Array.from({ length: days }, (_, i) => (
        <g key={i}>
          <text x={x(i)} y={H - PAD.b + 16} textAnchor="middle" fontSize="10.5" fill={active === i ? 'var(--charcoal)' : 'var(--muted)'}>{i + 1}</text>
          {series[0] && i < daysIn(series[0].month) && (
            <text x={x(i)} y={H - PAD.b + 30} textAnchor="middle" fontSize="8.5" fill="var(--taupe)">{weekdayOf(series[0].month, i + 1).slice(0, 2)}</text>
          )}
          {/* The hit area is the whole column, so a thin bar is still easy to point at or tap. */}
          <rect x={PAD.l + i * band} y={PAD.t} width={band} height={H - PAD.t} fill="transparent" tabIndex={0}
            aria-label={`Day ${i + 1}: ${series.map((s) => `${monthLabel(s.month)} ${s.values[i] == null ? 'no figure' : fmt(s.values[i])}`).join(', ')}`}
            onMouseEnter={() => onActive(i)} onFocus={() => onActive(i)} onClick={() => onActive(i)} />
        </g>
      ))}
    </svg>
  );
}

const Chips = ({ items, value, onChange, label }) => (
  <div className="dash-filters" role="group" aria-label={label} style={{ margin: 0 }}>
    {items.map(([k, l]) => (
      <button key={k} type="button" className={'dash-filter' + (k === value ? ' active' : '')} aria-pressed={k === value} onClick={() => onChange(k)}>{l}</button>
    ))}
  </div>
);
const selectStyle = { width: 'auto', margin: 0, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)' };
const right = { textAlign: 'right' };

export default function MonthSales() {
  // Empty until the first answer: the server says what "this month" is.
  const [picked, setPicked] = useState([]);
  const [data, setData] = useState(null);
  const [measure, setMeasure] = useState('revenue');
  const [view, setView] = useState('day');
  const [active, setActive] = useState(null);
  const [showDays, setShowDays] = useState(false);
  const [err, setErr] = useState('');
  const key = picked.join(',');

  const load = useCallback(async (months, signal) => {
    try {
      const res = await fetch(`/api/admin/month-days${months ? `?months=${months}` : ''}`, { cache: 'no-store', signal });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not load');
      setData(j); setErr('');
      if (!months) setPicked(j.selected);
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message); }
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    load(key, ctl.signal);
    const t = setInterval(() => load(key, ctl.signal), 60000);
    return () => { ctl.abort(); clearInterval(t); };
  }, [key, load]);

  if (!data) {
    return <div className="panel" style={{ marginBottom: 14 }}><p className="hint" style={{ margin: 0 }}>{err ? `The month chart couldn't load: ${err}` : 'Loading the month chart…'}</p></div>;
  }

  const { today } = data;
  const options = [];
  for (let m = today.slice(0, 7); m >= data.first && options.length < 60; m = addMonths(`${m}-01`, -1).slice(0, 7)) options.push(m);
  // Only months that have actually arrived are drawn, so a month just added shows when its figures do.
  const shown = picked.filter((m) => data.months[m]);
  const measures = MEASURES.filter(([k]) => k !== 'gp' || data.profit);
  const fmt = measure === 'sales' ? (v) => String(Math.round(v)) : money;
  const axisFmt = measure === 'sales' ? (v) => String(Math.round(v * 10) / 10) : short;
  // A month keeps its colour while it stays picked.
  const colourOf = (m) => COLOURS[Math.max(picked.indexOf(m), 0) % MAX];
  const series = shown.map((m) => {
    const v = daySeries(data.months[m], m, today, measure);
    return { month: m, main: m === picked[0], colour: colourOf(m), values: view === 'total' ? runningTotal(v) : v };
  });
  const kind = view === 'day' && series.length <= 2 ? 'bars' : 'lines';
  const cut = sameDayCut(shown, today);
  const sums = shown.map((m) => monthSummary(data.months[m], m, today, measure, cut));
  const main = sums[0];
  const missing = measure === 'gp' ? shown.reduce((a, m) => a + data.months[m].reduce((t, r) => t + (r.missing || 0), 0), 0) : 0;
  const setMain = (m) => setPicked((p) => [m, ...p.slice(1).filter((x) => x !== m)]);
  const add = (m) => m && setPicked((p) => (p.includes(m) || p.length >= MAX ? p : [...p, m]));
  const longest = Math.max(...shown.map(daysIn), 0);

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>Sales by day</h2>
        <span className="hint" style={{ margin: 0 }}>Every sale, on the day it was invoiced · the date filter below does not change this</span>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <label style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center', margin: 0, color: 'var(--charcoal)' }}>Month
          <select value={picked[0] || ''} onChange={(e) => setMain(e.target.value)} style={selectStyle}>
            {options.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <span className="hint" style={{ margin: 0 }}>compared with</span>
        {picked.slice(1).map((m) => (
          <button key={m} type="button" className="dash-filter" onClick={() => setPicked((p) => p.filter((x) => x !== m))}
            aria-label={`Remove ${monthLabel(m)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: colourOf(m) }} />{monthLabel(m)} ✕
          </button>
        ))}
        {picked.length < MAX && (
          <select value="" onChange={(e) => add(e.target.value)} aria-label="Add a month to compare" style={selectStyle}>
            <option value="">+ Add a month</option>
            {options.filter((m) => !picked.includes(m)).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
        <Chips label="Measure" value={measure} onChange={setMeasure} items={measures} />
        <Chips label="View" value={view} onChange={setView} items={[['day', 'Each day'], ['total', 'Running total']]} />
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--muted)', margin: '12px 0 4px' }}>
        {series.map((s) => (
          <span key={s.month} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.colour }} />{monthLabel(s.month)}{isRunning(s.month, today) ? ' (so far)' : ''}
          </span>
        ))}
      </div>
      {/* What the pointed-at day was worth in each month. */}
      <div aria-live="polite" style={{ minHeight: 22, fontSize: 13, color: 'var(--charcoal)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {active == null || active >= longest ? <span className="hint" style={{ margin: 0 }}>Point at or tap a day to read it.</span> : (
          <>
            <b>Day {active + 1}{view === 'total' ? ', running total' : ''}</b>
            {series.map((s) => (
              <span key={s.month} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: s.colour }} />
                {active < daysIn(s.month) ? `${weekdayOf(s.month, active + 1)} ${monthLabel(s.month)}: ${s.values[active] == null ? 'not yet' : fmt(s.values[active])}` : `${monthLabel(s.month)}: no such day`}
              </span>
            ))}
          </>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <Chart series={series} kind={kind} fmt={fmt} axisFmt={axisFmt} active={active} onActive={setActive} />
      </div>
      <p className="hint" style={{ margin: '4px 0 0' }}>The weekday letters under the day numbers are for {picked[0] ? monthLabel(picked[0]) : 'the first month'}.</p>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="admin">
          <thead><tr>
            <th>Month</th><th style={right}>Total</th>
            {cut != null && <th style={right}>Days 1–{cut}</th>}
            {sums.length > 1 && <th style={right}>{main ? `How ${monthLabel(main.month)} compares` : 'Change'}</th>}
            <th style={right}>Average per day</th><th style={right}>Days with a sale</th><th>Best day</th>
          </tr></thead>
          <tbody>
            {sums.map((s, i) => {
              const c = i === 0 ? null : change(main.toCut, s.toCut);
              return (
                <tr key={s.month}>
                  <td><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: colourOf(s.month), marginRight: 8 }} />{monthLabel(s.month)}{isRunning(s.month, today) ? ' (so far)' : ''}</td>
                  <td style={{ ...right, fontWeight: 700 }}>{fmt(s.total)}</td>
                  {cut != null && <td style={right}>{fmt(s.toCut)}</td>}
                  {sums.length > 1 && <td style={right}>{i === 0 ? '—' : c == null ? 'nothing to compare' : <span style={{ color: c >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{c >= 0 ? '▲ up' : '▼ down'} {Math.abs(c).toFixed(0)}%</span>}</td>}
                  <td style={right}>{measure === 'sales' ? s.average.toFixed(1) : money(s.average)}</td>
                  <td style={right}>{s.daysSold} of {s.days}</td>
                  <td>{s.best ? `${weekdayOf(s.month, s.best.day)} ${s.best.day} · ${fmt(s.best.value)}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cut != null && sums.length > 1 && <p className="hint" style={{ marginTop: 6 }}>The change compares days 1–{cut} of each month, because the current month is not over.</p>}
      {missing > 0 && <p className="hint" style={{ marginTop: 6 }}>{missing} unit{missing === 1 ? '' : 's'} in these months {missing === 1 ? 'has' : 'have'} no cost on file, so gross profit reads lower than the real figure.</p>}

      <button type="button" className="dash-filter" style={{ marginTop: 10 }} aria-expanded={showDays} onClick={() => setShowDays((v) => !v)}>
        {showDays ? 'Hide' : 'Show'} the day-by-day numbers
      </button>
      {showDays && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="admin" style={{ minWidth: 0 }}>
            <thead><tr><th>Day</th>{series.map((s) => <th key={s.month} style={right}>{monthLabel(s.month)}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: longest }, (_, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {series.map((s) => (
                    <td key={s.month} style={right}>
                      {i >= daysIn(s.month) || s.values[i] == null ? '—' : <><span className="hint" style={{ marginRight: 8 }}>{weekdayOf(s.month, i + 1)}</span>{fmt(s.values[i])}</>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && <p className="hint" style={{ color: 'var(--danger)' }}>Could not refresh: {err}</p>}
    </div>
  );
}
