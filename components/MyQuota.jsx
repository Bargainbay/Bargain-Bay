// "Where do I stand" — one rep's own quota for the month, in the three numbers
// they actually work from: what they have, what they are aiming for, and what is
// left (with what that comes to per day). Always THIS calendar month, whatever
// period the page below is showing.
//
// Revenue and LEAD revenue are the two headline targets. Lead revenue is every
// sale that came from this person's leads, whoever closed it. Sales-count targets
// appear underneath when they have been set. All of it is before HST, like every
// other figure here.
function Meter({ title, hint, actual, target, standing, fmt, daysLeft, pace }) {
  const set = target != null;
  const remaining = set ? Math.max(0, target - actual) : 0;
  const hit = set && actual >= target;
  const perDay = remaining && daysLeft > 0 ? remaining / daysLeft : 0;
  const pct = set && target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  const tone = !standing ? '' : { hit: 'ok', on_pace: 'ok', close: 'warn', behind: 'sold' }[standing.status];
  const label = !standing ? '' : { hit: 'Target hit', on_pace: 'On pace', close: 'Close', behind: 'Behind pace' }[standing.status];
  return (
    <div style={{ flex: '1 1 300px', minWidth: 260 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: 'var(--charcoal)' }}>{title}</h3>
        {label && <span className={'pill ' + tone}>{label}</span>}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--charcoal)', marginTop: 4 }}>
        {fmt(actual)}{set && <span style={{ fontSize: 15, fontWeight: 400, color: 'var(--muted)' }}> of {fmt(target)}</span>}
      </div>
      {set ? (
        <>
          <div style={{ position: 'relative', height: 10, borderRadius: 5, background: 'var(--line-soft)', margin: '8px 0 6px' }} role="img"
            aria-label={`${pct.toFixed(0)} percent of target; ${(pace * 100).toFixed(0)} percent of the month has gone`}>
            <div style={{ height: 10, borderRadius: 5, width: `${pct}%`, background: 'var(--charcoal)' }} />
            {/* Where the bar should be by now. */}
            <div style={{ position: 'absolute', left: `${Math.min(100, pace * 100)}%`, top: -3, bottom: -3, width: 2, background: 'var(--taupe-dark, #8a7f76)' }} title="Where you should be by today" />
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {hit
              ? <b style={{ color: 'var(--charcoal)' }}>Hit — {fmt(actual - target)} over.</b>
              : <><b style={{ color: 'var(--charcoal)' }}>{fmt(remaining)} to go</b>{perDay > 0 && <> — about {fmt(Math.ceil(perDay))} a day for the {daysLeft} day{daysLeft === 1 ? '' : 's'} left</>}.</>}
            {' '}{pct.toFixed(0)}% there; {(pace * 100).toFixed(0)}% of the month has gone.
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>No target set for this yet.</div>
      )}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{hint}</div>
    </div>
  );
}

export default function MyQuota({ data }) {
  const { quota, me } = data;
  if (!me || !quota?.ready) return null;
  const row = quota.rows.find((r) => r.key === me);
  if (!row) return null;
  const daysLeft = Math.max(0, quota.daysInMonth - quota.day + 1); // today still counts
  const q = row.quota || {}, st = row.standing || {};
  const counts = [
    ['Sales', row.actual.sales, q.sales, st.sales],
    ['Lead sales', row.actual.ownSales, q.ownSales, st.ownSales]
  ].filter(([, , t]) => t != null);
  const nothing = !row.quota || (q.revenue == null && q.ownRevenue == null && q.sales == null && q.ownSales == null);
  const rev = (v) => `$${Math.round(v).toLocaleString('en-CA')}`; // whole dollars — a target is not a cents figure

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, color: 'var(--charcoal)' }}>Your quota · {quota.label}</h2>
        <span className="hint" style={{ margin: 0 }}>Day {quota.day} of {quota.daysInMonth} · {daysLeft} day{daysLeft === 1 ? '' : 's'} left (today included) · before HST</span>
      </div>
      {nothing ? (
        <p className="hint" style={{ marginTop: 10 }}>
          No quota has been set for you yet. So far this month: {rev(row.actual.revenue)} closed, {rev(row.actual.ownRevenue)} from your own leads.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 12 }}>
            <Meter title="Total revenue" hint="Sales you closed." actual={row.actual.revenue} target={q.revenue}
              standing={st.revenue} fmt={rev} daysLeft={daysLeft} pace={quota.pace} />
            <Meter title="Lead revenue" hint="Sales from your leads, whoever closed them." actual={row.actual.ownRevenue} target={q.ownRevenue}
              standing={st.ownRevenue} fmt={rev} daysLeft={daysLeft} pace={quota.pace} />
          </div>
          {counts.length > 0 && (
            <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
              {counts.map(([label, a, t]) => `${label}: ${a} of ${t}${a >= t ? ' — hit' : ` (${t - a} to go)`}`).join('  ·  ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
