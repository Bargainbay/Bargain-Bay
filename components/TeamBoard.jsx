import { STAGES, ACTIVITY_TYPES, OUTCOMES, DAILY_TARGETS } from '../lib/lead-rules';

// The owner's view of the team (server-rendered, read-only): each rep's funnel, today's work against the daily targets,
// the collected-sales tracker, and the leads that need a hand with the reason. Acting on a lead happens on the Leads page,
// which every link here opens.
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-CA');
const money2 = (n) => '$' + (Number(n) || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const label = (list, key) => (list.find((x) => x[0] === key) || [])[1] || key || '';

function ago(d) {
  if (!d) return 'never';
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  if (m < 2) return 'just now';
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
const time = (d) => new Date(d).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });

function Reasons({ l }) {
  const chips = [];
  if (l.unaccepted) chips.push(['Not accepted', 'warn']);
  if (l.untouched) chips.push(['Never contacted', 'sold']);
  if (l.overdue) chips.push([`Next step overdue (${l.next_step_at})`, 'sold']);
  if (l.stale) chips.push(['No activity in 5+ days', 'warn']);
  return chips.map(([t, tone]) => <span key={t} className={'pill ' + tone} style={{ marginRight: 4, fontSize: 11.5 }}>{t}</span>);
}

function Counter({ title, have, target }) {
  return (
    <div style={{ minWidth: 92 }}>
      <div className="hint" style={{ fontSize: 12 }}>{title}</div>
      <b style={{ fontSize: 18 }}>{have}</b><span className="hint" style={{ fontSize: 12 }}> / {target}</span>
    </div>
  );
}

function RepCard({ r }) {
  const t = r.tracker;
  const q = `owner=${encodeURIComponent(r.owner)}`;
  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{r.name}</h2>
          <div className="hint" style={{ fontSize: 12.5 }}>
            {r.owner} · last activity {ago(r.lastActivityAt)}
            {r.atShopSince && <> · <b>at the shop since {time(r.atShopSince)}</b></>}
            {!r.onPlan && ' · not on the commission plan'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn" href={`/sales/leads?${q}`}>All their leads</a>
          <a className="btn" href={`/sales/pipeline?${q}`}>Their pipeline</a>
        </div>
      </div>

      {t && (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '12px 0 4px' }}>
          <div>
            <div className="hint" style={{ fontSize: 12 }}>Collected today · {t.mode === 'in-house' ? 'In-house' : 'Mobile'} day (before HST)</div>
            <b style={{ fontSize: 20 }}>{money2(t.todayNet)}</b>
            <span className="hint"> {t.todayPct ? `· ${t.todayPct}% tier → ${money2(t.todayCommission)}` : '· no tier yet'}</span>
          </div>
          <div>
            <div className="hint" style={{ fontSize: 12 }}>Quota {t.quota.windowStart} → {t.quota.windowEnd}</div>
            <b style={{ fontSize: 20 }}>{money2(t.quota.collected)}</b><span className="hint"> of {money(t.quota.target)}</span>
            <span className="hint"> · {t.quota.left > 0 ? `${money(t.quota.left)} to go (~${money(t.quota.perDayNeeded)}/day)` : 'quota met'}</span>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 13.5, margin: '14px 0 6px' }}>Today against the daily targets</h3>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Counter title="Touches" have={r.today.touches} target={DAILY_TARGETS.touches} />
        <Counter title="Conversations" have={r.today.conversations} target={DAILY_TARGETS.conversations} />
        <Counter title="Meetings booked" have={r.today.meetings} target={DAILY_TARGETS.meetings} />
        <Counter title="Proposals" have={r.today.proposals} target={DAILY_TARGETS.proposals} />
        <div style={{ minWidth: 150 }}>
          <div className="hint" style={{ fontSize: 12 }}>Since the start</div>
          <span style={{ fontSize: 13 }}>{r.allTime.touches} touches · {r.allTime.conversations} conversations · {r.allTime.meetings} meetings · {r.allTime.proposals} proposals</span>
        </div>
      </div>

      <h3 style={{ fontSize: 13.5, margin: '14px 0 6px' }}>Where their leads are</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {STAGES.map(([k, l]) => {
          const s = r.stages[k] || { n: 0, value: 0 };
          return (
            <a key={k} href={`/sales/leads?${q}&stage=${k}`} style={{ textDecoration: 'none', color: 'inherit', flex: '1 1 110px', minWidth: 110, border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: '8px 10px', opacity: s.n ? 1 : 0.55 }}>
              <div className="hint" style={{ fontSize: 12 }}>{l}</div>
              <b style={{ fontSize: 20 }}>{s.n}</b>
              <div className="hint" style={{ fontSize: 12 }}>{s.n ? money(s.value) : '—'}</div>
            </a>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 6, fontSize: 12.5 }}>{r.openLeads} open leads worth {money(r.openValue)}.</div>

      <h3 style={{ fontSize: 13.5, margin: '14px 0 6px' }}>Needs a hand ({r.needsHelp.length})</h3>
      {r.needsHelp.length === 0 && <p className="hint" style={{ margin: 0 }}>Nothing stuck: every open lead has a recent touch and a next step that is not overdue.</p>}
      {r.needsHelp.slice(0, 15).map((l) => (
        <div key={l.id} style={{ padding: '7px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 13.5 }}>
          <a href={`/sales/leads?${q}&open=${l.id}`} style={{ fontWeight: 700 }}>{l.company || l.contact_name}</a>
          <span className="hint"> · {label(STAGES, l.stage)}{l.est_value != null ? ` · ${money(l.est_value)}` : ''} · {l.temperature}</span>
          {l.phone && <a href={`tel:${l.phone}`} style={{ marginLeft: 8 }}>{l.phone}</a>}
          <div style={{ marginTop: 3 }}><Reasons l={l} /> <span className="hint" style={{ fontSize: 12 }}>last touch {ago(l.last_activity_at)}{l.next_step ? ` · next: ${l.next_step}` : ''}</span></div>
        </div>
      ))}
      {r.needsHelp.length > 15 && <p className="hint">Showing 15 of {r.needsHelp.length}, oldest first.</p>}
    </div>
  );
}

export default function TeamBoard({ reps, pool, recent }) {
  return (
    <div>
      <p className="hint" style={{ margin: '0 0 10px' }}>
        Every rep&apos;s leads and what they did, read-only. Open a lead to add a note, log a call or reassign it. A lead “needs a hand” when its next step is
        overdue, nothing has been logged for 5 days, it was assigned and never contacted, or it has not been accepted.
      </p>
      {reps.length === 0 && <div className="panel">No reps yet. Add John&apos;s plan on Rep commission and assign him a lead.</div>}
      {reps.map((r) => <RepCard key={r.owner} r={r} />)}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Unassigned pool</h2>
        <p style={{ margin: 0 }}>
          <b>{pool.count}</b> open lead{pool.count === 1 ? '' : 's'} nobody owns ({money(pool.value)}). <a href="/sales/leads?owner=pool">Open the pool</a> to assign them.
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Latest activity, all reps</h2>
        {recent.length === 0 && <p className="hint" style={{ margin: 0 }}>Nothing logged yet.</p>}
        {recent.map((a) => (
          <div key={a.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line, #eee)', fontSize: 13.5 }}>
            <b>{a.by_name || (a.owner || '').split('@')[0]}</b> · {label(ACTIVITY_TYPES, a.kind)}{a.outcome ? ` — ${label(OUTCOMES, a.outcome)}` : ''}{' '}
            on <a href={`/sales/leads?open=${a.lead_id}`}>{a.company || a.contact_name}</a> <span className="hint">· {ago(a.occurred_at)}</span>
            {a.notes && <div className="hint" style={{ fontSize: 12.5 }}>{a.notes.length > 160 ? `${a.notes.slice(0, 160)}…` : a.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
