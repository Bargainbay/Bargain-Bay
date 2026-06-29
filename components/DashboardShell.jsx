import { DASHBOARD_TABS } from '../lib/dashboards';

// Dark full-bleed wrapper + 5-tab sub-nav for the analytics dashboards.
// `active` = one of the tab keys. `children` is the dashboard body.
export default function DashboardShell({ active, children }) {
  return (
    <div className="dboard">
      <div className="dboard-bar">
        <div className="dboard-brand">
          <b>Bargain Bay</b><span>Owner analytics</span>
        </div>
        <a href="/admin/operations" className="dboard-portal">← Portal</a>
      </div>

      <nav className="dnav" aria-label="Dashboards">
        {DASHBOARD_TABS.map((t) => (
          <a
            key={t.key}
            href={t.built ? t.href : `${t.href}`}
            className={'dtab' + (t.key === active ? ' active' : '') + (t.built ? '' : ' soon')}
            aria-current={t.key === active ? 'page' : undefined}
          >
            <span className="dot" />
            {t.label}
            {t.built ? null : <span className="soon-tag">soon</span>}
          </a>
        ))}
      </nav>

      {children}
    </div>
  );
}

// Reusable "coming next" body for un-built dashboards.
export function ComingSoon({ title, blurb, points = [] }) {
  return (
    <div className="dboard-soon">
      <div className="panel">
        <h2>{title}</h2>
        <p className="hint" style={{ marginTop: 0 }}>{blurb}</p>
        {points.length > 0 && (
          <ul style={{ textAlign: 'left', margin: '14px auto 0', maxWidth: 380, color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.7 }}>
            {points.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        )}
        <p className="hint" style={{ marginTop: 16 }}>Shipping in an upcoming update.</p>
      </div>
    </div>
  );
}
