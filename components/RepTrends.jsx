'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  GRANULARITIES, DEFAULT_SPAN, METRICS, COMPARE_PRESETS, bucketList, bucketStart, bucketLabel,
  presetRange, alignPair, addMonths, monthStart, monthName, daysBetween, addDays, cumulative, totalsByRep
} from '../lib/rep-periods';

// Trend and comparison charts for the sales team.
//
// One fetch of DAILY rows per rep (/api/admin/rep-daily); every filter —
// day/week/month, which measure, which rep, which two periods — is arithmetic on
// those rows in the browser, so clicking a filter is instant and cannot disagree
// with itself. It refetches only when a chosen period reaches back past what was
// loaded (a month picked from last spring).
//
// Colour never carries meaning alone: every series is in a legend and in the
// tooltip, and the comparison puts the two periods in different positions as
// well as different colours.
const PALETTE = ['#2f7bbf', '#e08a2c', '#2fa37a', '#b05fc4', '#d9534f', '#8c6d1f'];
const NO_REP = '#9a948d';
const A_COLOR = '#2f7bbf', B_COLOR = '#a8a29a';
const NONE = '';

// Whole dollars: cents on an axis label are noise, and the scorecard above has the exact figures.
const dollars = (v) => `$${Math.round(v).toLocaleString('en-CA')}`;
const fmtFor = (metric) => (METRICS[metric].money ? dollars : (v) => String(Math.round(v)));
const Chips = ({ items, value, onChange, label }) => (
  <div className="dash-filters" role="group" aria-label={label} style={{ margin: 0 }}>
    {items.map(([k, l]) => (
      <button key={k} type="button" className={'dash-filter' + (k === value ? ' active' : '')} aria-pressed={k === value} onClick={() => onChange(k)}>{l}</button>
    ))}
  </div>
);
const Sel = ({ value, onChange, children, label }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
    style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--charcoal)' }}>{children}</select>
);

function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)', margin: '8px 0' }}>
      {items.map((i) => (
        <span key={i.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: i.color, display: 'inline-block' }} />{i.name}
        </span>
      ))}
    </div>
  );
}

const W = 880, H = 300, PAD = { l: 62, r: 16, t: 16, b: 38 };
function Axes({ max, fmt, children }) {
  const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  return (
    <>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--line-soft)" />
          <text x={PAD.l - 8} y={y(max * f) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{fmt(max * f)}</text>
        </g>
      ))}
      {children(y)}
    </>
  );
}
const Empty = () => <p className="hint" style={{ margin: '12px 0' }}>No sales in this range.</p>;

// One stacked bar per bucket, one segment per rep.
function StackedBars({ buckets, series, fmt }) {
  const max = Math.max(...buckets.map((b) => b.total), 1);
  if (buckets.every((b) => b.total === 0)) return <Empty />;
  const n = buckets.length, plotW = W - PAD.l - PAD.r, bw = plotW / n, barW = Math.min(bw * 0.7, 48);
  const every = n <= 14 ? 1 : Math.ceil(n / 14);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sales by period and rep" style={{ display: 'block' }}>
      <Axes max={max} fmt={fmt}>{(y) => buckets.map((b, i) => {
        const cx = PAD.l + i * bw + bw / 2; let acc = 0;
        return (
          <g key={b.start}>
            <title>{`${b.label}: ${fmt(b.total)}\n${series.map((s) => `${s.name}: ${fmt(b.values[s.key] || 0)}`).join('\n')}`}</title>
            {series.map((s) => {
              const v = b.values[s.key] || 0; if (!v) return null;
              const y1 = y(acc + v), y0 = y(acc); acc += v;
              return <rect key={s.key} x={cx - barW / 2} y={y1} width={barW} height={Math.max(y0 - y1, 1)} fill={s.color} />;
            })}
            {b.total > 0 && n <= 14 && <text x={cx} y={y(b.total) - 5} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--charcoal)">{fmt(b.total)}</text>}
            {i % every === 0 && <text x={cx} y={H - PAD.b + 15} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{b.label}</text>}
          </g>
        );
      })}</Axes>
    </svg>
  );
}

// Two bars side by side per rep: this period, then the one it is measured against.
function GroupedBars({ groups, aName, bName, fmt }) {
  const max = Math.max(...groups.flatMap((g) => [g.a, g.b]), 1);
  if (groups.every((g) => g.a === 0 && g.b === 0)) return <Empty />;
  const n = groups.length, plotW = W - PAD.l - PAD.r, gw = plotW / n, bw = Math.min(gw * 0.3, 56);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${aName} against ${bName}, by rep`} style={{ display: 'block' }}>
      <Axes max={max} fmt={fmt}>{(y) => groups.map((g, i) => {
        const cx = PAD.l + i * gw + gw / 2;
        return (
          <g key={g.key}>
            <title>{`${g.name}\n${aName}: ${fmt(g.a)}\n${bName}: ${fmt(g.b)}`}</title>
            <rect x={cx - bw - 2} y={y(g.a)} width={bw} height={Math.max(y(0) - y(g.a), g.a > 0 ? 2 : 0)} fill={A_COLOR} />
            <rect x={cx + 2} y={y(g.b)} width={bw} height={Math.max(y(0) - y(g.b), g.b > 0 ? 2 : 0)} fill={B_COLOR} />
            <text x={cx - bw / 2 - 2} y={y(g.a) - 5} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--charcoal)">{fmt(g.a)}</text>
            <text x={cx + bw / 2 + 2} y={y(g.b) - 5} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{fmt(g.b)}</text>
            <text x={cx} y={H - PAD.b + 15} textAnchor="middle" fontSize="10.5" fill="var(--charcoal)">{g.name}</text>
          </g>
        );
      })}</Axes>
    </svg>
  );
}

// Running total, day 1 onwards, for both periods — whether this month is
// keeping pace with last, which two end-of-period totals cannot show.
function CumulativeLines({ a, b, aName, bName, fmt }) {
  const n = Math.max(a.length, b.length), max = Math.max(...[...a, ...b].filter((v) => v != null), 1);
  if (max <= 1 && a.every((v) => !v) && b.every((v) => !v)) return <Empty />;
  const plotW = W - PAD.l - PAD.r, x = (i) => PAD.l + (n <= 1 ? 0 : (plotW * i) / (n - 1));
  const path = (arr) => {
    let d = '', pen = false;
    arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},`; pen = true; d += '@' + i; });
    return d;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Running total, ${aName} against ${bName}`} style={{ display: 'block' }}>
      <Axes max={max} fmt={fmt}>{(y) => {
        const line = (arr, color, dash) => (
          <path d={path(arr).replace(/@(\d+)/g, (_, i) => y(arr[Number(i)]).toFixed(1))} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray={dash} strokeLinejoin="round" />
        );
        const every = n <= 16 ? 1 : Math.ceil(n / 15);
        return (
          <>
            {line(b, B_COLOR, '6 4')}{line(a, A_COLOR)}
            {Array.from({ length: n }, (_, i) => i % every === 0 && (
              <text key={i} x={x(i)} y={H - PAD.b + 15} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{i + 1}</text>
            ))}
            {a.map((v, i) => v != null && (
              <circle key={'a' + i} cx={x(i)} cy={y(v)} r="3.5" fill={A_COLOR}>
                <title>{`Day ${i + 1}\n${aName}: ${fmt(v)}\n${bName}: ${b[i] == null ? '—' : fmt(b[i])}`}</title>
              </circle>
            ))}
          </>
        );
      }}</Axes>
    </svg>
  );
}

export default function RepTrends() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState('trend');
  const [gran, setGran] = useState('day');
  const [metric, setMetric] = useState('revenue');
  const [rep, setRep] = useState('all');
  const [preset, setPreset] = useState('week');
  const [custom, setCustom] = useState({ a: '', b: '' });
  const [aligned, setAligned] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load(from) {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/admin/rep-daily${from ? `?from=${from}` : ''}`, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not load');
      setData(j);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);

  const today = data?.today;
  const months = useMemo(() => (today ? Array.from({ length: 24 }, (_, i) => addMonths(today, -i)) : []), [today]);

  // The two periods being compared.
  const ranges = useMemo(() => {
    if (!today) return null;
    let ak, bk;
    if (preset === 'custom') { ak = custom.a || monthStart(today).slice(0, 7); bk = custom.b || addMonths(today, -1).slice(0, 7); }
    else { const p = COMPARE_PRESETS.find((x) => x.key === preset); ak = p.a; bk = p.b; }
    const a = presetRange(ak, today), b = presetRange(bk, today);
    return a && b ? alignPair(a, b, today, aligned) : null;
  }, [today, preset, custom, aligned]);

  // A chosen period older than what was loaded → fetch further back.
  useEffect(() => {
    if (!data || !ranges || busy) return;
    const earliest = [ranges.a.from, ranges.b.from].sort()[0];
    if (earliest < data.from) load(monthStart(earliest));
  }, [ranges]); // eslint-disable-line react-hooks/exhaustive-deps

  const repName = useMemo(() => Object.fromEntries([...(data?.reps || []).map((r) => [r.key, r.name]), [NONE, 'No rep recorded']]), [data]);
  const colorOf = useMemo(() => {
    const m = { [NONE]: NO_REP }; (data?.reps || []).forEach((r, i) => { m[r.key] = PALETTE[i % PALETTE.length]; }); return m;
  }, [data]);
  const fmt = fmtFor(metric);

  if (err && !data) return <div className="panel" style={{ marginTop: 18 }}><p className="hint" style={{ margin: 0 }}>Trends couldn&apos;t load: {err}</p></div>;
  if (!data) return <div className="panel" style={{ marginTop: 18 }}><p className="hint" style={{ margin: 0 }}>Loading trends…</p></div>;

  // ── trend: stacked buckets
  const keys = [...data.reps.map((r) => r.key), NONE];
  const shown = rep === 'all' ? keys : [rep];
  const starts = bucketList(gran, DEFAULT_SPAN[gran], today);
  const idx = new Map(starts.map((s, i) => [s, i]));
  const buckets = starts.map((s) => ({ start: s, label: bucketLabel(s, gran), values: {}, total: 0 }));
  for (const r of data.rows) {
    const i = idx.get(bucketStart(r.d, gran));
    if (i == null || !shown.includes(r.rep)) continue;
    buckets[i].values[r.rep] = (buckets[i].values[r.rep] || 0) + (r[metric] || 0);
    buckets[i].total += r[metric] || 0;
  }
  const series = shown.map((k) => ({ key: k, name: repName[k], color: colorOf[k] }))
    .filter((s) => buckets.some((b) => (b.values[s.key] || 0) > 0));
  const spanText = { day: `last ${DEFAULT_SPAN.day} days`, week: `last ${DEFAULT_SPAN.week} weeks`, month: `last ${DEFAULT_SPAN.month} months` }[gran];

  // ── compare
  let cmp = null;
  if (view === 'compare' && ranges) {
    const ta = totalsByRep(data.rows, ranges.a, metric), tb = totalsByRep(data.rows, ranges.b, metric);
    const groups = keys.map((k) => ({ key: k, name: repName[k], a: ta[k] || 0, b: tb[k] || 0 })).filter((g) => g.key !== NONE || g.a || g.b);
    const sumA = groups.reduce((s, g) => s + g.a, 0), sumB = groups.reduce((s, g) => s + g.b, 0);
    cmp = {
      groups, sumA, sumB,
      ca: cumulative(data.rows, ranges.a, metric, rep, today), cb: cumulative(data.rows, ranges.b, metric, rep, today)
    };
  }
  const days = (r) => daysBetween(r.from, r.to);
  const rangeText = (r) => `${r.label} (${r.from === addDays(r.to, -1) ? r.from : `${r.from} → ${addDays(r.to, -1)}`})`;
  const change = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.abs(((a - b) / b) * 100).toFixed(0)}%` : a ? 'new' : '—');

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ marginTop: 0, marginBottom: 0, color: 'var(--charcoal)' }}>Trends & comparisons</h2>
        <Chips label="View" value={view} onChange={setView} items={[['trend', 'Over time'], ['compare', 'Compare periods']]} />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <Chips label="Measure" value={metric} onChange={setMetric} items={Object.entries(METRICS).map(([k, m]) => [k, m.label])} />
        <Sel label="Rep" value={rep} onChange={setRep}>
          <option value="all">Whole team</option>
          {data.reps.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          <option value={NONE}>No rep recorded</option>
        </Sel>
        {busy && <span className="hint" style={{ margin: 0 }}>Loading…</span>}
      </div>

      {view === 'trend' ? (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <Chips label="Group by" value={gran} onChange={setGran} items={GRANULARITIES.map((g) => [g, { day: 'By day', week: 'By week', month: 'By month' }[g]])} />
            <span className="hint" style={{ margin: 0 }}>{METRICS[metric].label}, {spanText}. Weeks start Monday.</span>
          </div>
          <Legend items={series.length ? series : []} />
          <StackedBars buckets={buckets} series={series} fmt={fmt} />
        </>
      ) : ranges && cmp ? (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <Chips label="Compare" value={preset} onChange={setPreset} items={[...COMPARE_PRESETS.map((p) => [p.key, p.label]), ['custom', 'Pick months']]} />
            {preset === 'custom' && (
              <>
                <Sel label="First month" value={custom.a || monthStart(today).slice(0, 7)} onChange={(v) => setCustom((c) => ({ ...c, a: v }))}>
                  {months.map((m) => <option key={m} value={m.slice(0, 7)}>{monthName(m)}</option>)}
                </Sel>
                <span>vs</span>
                <Sel label="Second month" value={custom.b || addMonths(today, -1).slice(0, 7)} onChange={(v) => setCustom((c) => ({ ...c, b: v }))}>
                  {months.map((m) => <option key={m} value={m.slice(0, 7)}>{monthName(m)}</option>)}
                </Sel>
              </>
            )}
            <label style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={aligned} onChange={(e) => setAligned(e.target.checked)} /> Same number of days
            </label>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            <b style={{ color: A_COLOR }}>■</b> {rangeText(ranges.a)} against <b style={{ color: B_COLOR }}>■</b> {rangeText(ranges.b)}.
            {ranges.cut ? ` Both cut to the first ${ranges.cut} day${ranges.cut === 1 ? '' : 's'} so an unfinished period isn't judged against a finished one — untick "Same number of days" to see the full periods.` : ''}
          </p>
          <h3 style={{ margin: '14px 0 0', fontSize: 14, color: 'var(--charcoal)' }}>By rep</h3>
          <Legend items={[{ name: ranges.a.label, color: A_COLOR }, { name: ranges.b.label, color: B_COLOR }]} />
          <GroupedBars groups={cmp.groups} aName={ranges.a.label} bName={ranges.b.label} fmt={fmt} />
          <div className="table-wrap" style={{ marginTop: 10 }}><table className="admin">
            <thead><tr><th>Rep</th><th style={{ textAlign: 'right' }}>{ranges.a.label}</th><th style={{ textAlign: 'right' }}>{ranges.b.label}</th><th style={{ textAlign: 'right' }}>Change</th></tr></thead>
            <tbody>
              {cmp.groups.map((g) => (
                <tr key={g.key}><td>{g.name}</td><td style={{ textAlign: 'right' }}>{fmt(g.a)}</td><td style={{ textAlign: 'right' }}>{fmt(g.b)}</td><td style={{ textAlign: 'right', color: 'var(--muted)' }}>{change(g.a, g.b)}</td></tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td>Total</td><td style={{ textAlign: 'right' }}>{fmt(cmp.sumA)}</td><td style={{ textAlign: 'right' }}>{fmt(cmp.sumB)}</td><td style={{ textAlign: 'right' }}>{change(cmp.sumA, cmp.sumB)}</td></tr>
            </tbody>
          </table></div>
          <h3 style={{ margin: '18px 0 0', fontSize: 14, color: 'var(--charcoal)' }}>Running total by day · {rep === 'all' ? 'whole team' : repName[rep]}</h3>
          <Legend items={[{ name: `${ranges.a.label} (solid)`, color: A_COLOR }, { name: `${ranges.b.label} (dashed)`, color: B_COLOR }]} />
          <CumulativeLines a={cmp.ca} b={cmp.cb} aName={ranges.a.label} bName={ranges.b.label} fmt={fmt} />
          <p className="hint" style={{ marginTop: 6 }}>Day number along the bottom. The solid line stops at today if the period isn&apos;t over.</p>
        </>
      ) : (
        <p className="hint" style={{ marginTop: 12 }}>Pick two periods to compare.</p>
      )}
      {err && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</p>}
    </div>
  );
}
