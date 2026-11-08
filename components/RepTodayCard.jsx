// Today's tracker and the quota window, for the rep's Home. Presentational: the page computes it
// on the server (lib/sales-commission repToday) from the rep's own payments.
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

export default function RepTodayCard({ t }) {
  if (!t) return null;
  const q = t.quota;
  const pct = q.target ? Math.min(100, Math.round((q.collected / q.target) * 100)) : 0;
  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Collected sales <span className="hint" style={{ fontWeight: 400 }}>(before HST, eligible only)</span></h2>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px' }}>
          <div className="hint">Today · {t.mode === 'in-house' ? 'In-house day' : 'Mobile day'}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--charcoal)' }}>{money(t.todayNet)}</div>
          <div style={{ fontSize: 14 }}>
            {t.todayPct > 0 ? <>Tier reached: <b>{t.todayPct}%</b> → <b>{money(t.todayCommission)}</b> commission today</> : <>No commission tier reached yet</>}
          </div>
          {t.next && (
            <div className="hint" style={{ marginTop: 4 }}>
              <b>{money(t.next.moreNeeded)}</b> more to reach {t.next.pct}% — that would make today <b>{money(t.next.wouldPay)}</b>.
            </div>
          )}
        </div>
        <div style={{ flex: '1 1 280px' }}>
          <div className="hint">Quota window {day(q.windowStart)} – {day(q.windowEnd)}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--charcoal)' }}>
            {money(q.collected)}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted)' }}> of {money(q.target)}</span>
          </div>
          <div style={{ height: 8, background: 'var(--panel-alt, #eee)', borderRadius: 5, margin: '6px 0' }}>
            <div style={{ width: `${pct}%`, height: 8, background: pct >= 100 ? 'var(--ok, #1a7f4b)' : 'var(--charcoal, #222)', borderRadius: 5 }} />
          </div>
          <div style={{ fontSize: 13.5 }}>
            {q.over ? (q.left > 0 ? `Window over: ${money(q.left)} short.` : 'Quota met.')
              : q.left > 0 ? <>{money(q.left)} to go over {q.workingDaysLeft} working day{q.workingDaysLeft === 1 ? '' : 's'} — about <b>{money(q.perDayNeeded)}</b> a day.</> : 'Quota met.'}
          </div>
        </div>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 13 }}><a href="/sales/performance">See your weekly statement →</a></p>
    </div>
  );
}
