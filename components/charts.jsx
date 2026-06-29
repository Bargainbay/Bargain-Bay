// Shared, server-rendered SVG chart primitives for the owner dashboards.
// No chart library — small, themeable via the dark .dboard CSS tokens.
import { money } from '../lib/constants';

export function Delta({ d }) {
  if (!d) return null;
  if (d.isNew) return <span className="kpi-delta up">▲ new</span>;
  const sym = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '•';
  return <span className={'kpi-delta ' + d.dir}>{sym} {Math.abs(d.pct).toFixed(0)}%</span>;
}

export function Kpi({ label, value, delta, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value">{value}{delta !== undefined ? <Delta d={delta} /> : null}</div>
      <div className="kpi-label">{label}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

// Donut ring from weighted segments [{label,value,color}].
export function Donut({ segments, centerTop, centerSub, size = 168, thickness = 24, label = 'chart' }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={label}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tint)" strokeWidth={thickness} />
        {total > 0 && segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />
          );
          offset += len;
          return el;
        })}
      </g>
      <text x="50%" y="47%" textAnchor="middle" fontSize="30" fontWeight="700" fill="var(--charcoal)">{centerTop}</text>
      <text x="50%" y="62%" textAnchor="middle" fontSize="11.5" fill="var(--muted)">{centerSub}</text>
    </svg>
  );
}

// Horizontal bars — rows of [{label,value,sub,color}], scaled to the max.
export function HBars({ rows, money: asMoney = false }) {
  if (!rows.length) return <p className="hint">Nothing here yet.</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      {rows.map((r, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
            <span style={{ color: 'var(--charcoal)' }}>{r.label}</span>
            <span style={{ color: 'var(--muted)' }}>{asMoney ? money(r.value) : r.value}{r.sub ? ` · ${r.sub}` : ''}</span>
          </div>
          <div className="goalbar" style={{ height: 13 }}>
            <span style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 3 : 0)}%`, background: r.color || 'var(--accent)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Stepped funnel — [{label,value,sub,color}].
export function Funnel({ stages }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {stages.map((s, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
            <span style={{ color: 'var(--charcoal)' }}>{s.label}</span>
            <span style={{ color: 'var(--muted)' }}>{s.value}{s.sub ? ` · ${s.sub}` : ''}</span>
          </div>
          <div className="goalbar" style={{ height: 14 }}>
            <span style={{ width: `${Math.max((s.value / max) * 100, s.value > 0 ? 4 : 0)}%`, background: s.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Vertical bar trend over a continuous series of {label, value, [hint]}.
// `fmtVal` formats the y-axis + tooltips (money by default).
export function TrendChart({ series, label = 'trend', fmtVal = money, accent = 'var(--accent)' }) {
  if (!series.length) return <p className="hint">No data in this period yet.</p>;
  const n = series.length;
  const total = series.reduce((s, d) => s + d.value, 0);
  const max = Math.max(...series.map((d) => d.value), 1);
  const avg = total / n;
  const W = 880, H = 280, pad = { l: 58, r: 16, t: 18, b: 36 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const bw = plotW / n;
  const barW = Math.min(bw * 0.66, 46);
  const y = (v) => pad.t + plotH * (1 - v / max);
  const showVals = n <= 14;
  const labelEvery = n <= 14 ? 1 : n <= 24 ? 2 : Math.ceil(n / 16);
  const avgY = y(avg);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`g-${label}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.95" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const gy = y(max * f);
        return (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={gy} y2={gy} stroke="var(--line-soft)" strokeWidth="1" />
            {(f === 0 || f === 0.5 || f === 1) && (
              <text x={pad.l - 8} y={gy + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{fmtVal(max * f)}</text>
            )}
          </g>
        );
      })}
      {avg > 0 && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={avgY} y2={avgY} stroke="var(--taupe)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
          <text x={W - pad.r} y={avgY - 5} textAnchor="end" fontSize="9.5" fill="var(--taupe-dark)">avg {fmtVal(avg)}</text>
        </g>
      )}
      {series.map((d, i) => {
        const h = plotH * (d.value / max);
        const cx = pad.l + i * bw + bw / 2;
        const isLast = i === n - 1;
        const showLabel = (i % labelEvery === 0) || isLast;
        return (
          <g key={i}>
            <title>{d.label}: {fmtVal(d.value)}{d.hint ? ` · ${d.hint}` : ''}</title>
            <rect x={cx - barW / 2} y={H - pad.b - h} width={barW} height={Math.max(h, d.value > 0 ? 2 : 0)} rx="3"
              fill={`url(#g-${label})`} opacity={isLast ? 1 : 0.82} />
            {showVals && d.value > 0 && (
              <text x={cx} y={H - pad.b - h - 5} textAnchor="middle" fontSize="9.5" fill="var(--charcoal)" fontWeight="600">{fmtVal(d.value)}</text>
            )}
            {showLabel && (
              <text x={cx} y={H - pad.b + 15} textAnchor="middle" fontSize="9.5" fill="var(--muted)">{d.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
