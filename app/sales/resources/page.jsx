import { hubPage, NotAuthorized } from '../../../lib/sales-page';
import { mergeTemplate } from '../../../lib/lead-rules';
import {
  PITCH, RULES, SEGMENT_PITCHES, PRICE_LIST, WE_PROMISE, WE_DO_NOT, FIRST_TWO_WEEKS, FOLLOW_UP, OBJECTIONS, PIPELINE_NOTE, WEEKLY_CHECKIN
} from '../../../lib/sales-content';
import SalesNav from '../../../components/SalesNav';
import CopyButton from '../../../components/CopyButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Resources — Sales Hub' };

// Everything John says, by segment, with the real prices and the promises we can actually keep.
export default async function ResourcesPage() {
  const g = await hubPage('/sales/resources');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;
  // The rep's own name is filled in; the prospect's name and company stay as placeholders to be replaced when sent.
  const vars = { rep_name: viewer.name || '{rep_name}', first_name: '{first_name}', company: '{company}', rep_phone: '{rep_phone}' };
  const fill = (t) => mergeTemplate(t, vars);
  const live = SEGMENT_PITCHES.filter((s) => !s.hold);

  return (
    <div>
      <SalesNav side={side} name={viewer.name} admin={viewer.admin} />

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>The one-line pitch</h2>
        <p style={{ margin: '0 0 8px' }}>{PITCH}</p>
        <p style={{ margin: 0, fontWeight: 700 }}>{FIRST_TWO_WEEKS}</p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Three rules for every call</h2>
        <ol style={{ margin: 0, paddingLeft: 20 }}>{RULES.map((r) => <li key={r}>{r}</li>)}</ol>
      </div>

      <div className="panel" style={{ overflowX: 'auto' }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Call order</h2>
        <table className="admin" style={{ minWidth: 520 }}>
          <thead><tr><th>#</th><th>Segment</th><th>Why</th><th></th></tr></thead>
          <tbody>
            {SEGMENT_PITCHES.map((s) => (
              <tr key={s.key} style={{ opacity: s.hold ? 0.55 : 1 }}>
                <td>{s.order}</td>
                <td><b>{s.label}</b>{s.startNow && <span className="pill ok" style={{ marginLeft: 6 }}>start here</span>}{s.hold && <span className="pill sold" style={{ marginLeft: 6 }}>on hold</span>}</td>
                <td>{s.hold || s.why}</td>
                <td>{!s.hold && <a className="btn" style={{ fontSize: 12.5 }} href={`/sales/resources/leave-behind/${s.key}`}>Leave-behind</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {live.map((s) => (
        <details key={s.key} className="panel" open={!!s.startNow}>
          <summary style={{ cursor: 'pointer', fontWeight: 800, fontSize: 16 }}>{s.order}. {s.label}</summary>
          <p style={{ margin: '10px 0 4px' }}><b>Why:</b> {s.why}</p>
          <p style={{ margin: '4px 0' }}><b>Watch for:</b> {s.watch}</p>
          <h3 style={{ fontSize: 14, margin: '12px 0 4px' }}>What we can offer</h3>
          <ul style={{ margin: 0, paddingLeft: 20 }}>{s.offer.map((o) => <li key={o}>{o}</li>)}</ul>
          <h3 style={{ fontSize: 14, margin: '12px 0 4px' }}>Opener</h3>
          <p style={{ margin: '0 0 6px' }}>{fill(s.opener)}</p>
          <CopyButton text={fill(s.opener)} label="Copy opener" />
          <p style={{ margin: '8px 0 0' }}><b>The small yes:</b> {s.smallYes}</p>
          <p style={{ margin: '4px 0 0' }}>{s.ifThey}</p>
          <h3 style={{ fontSize: 14, margin: '12px 0 4px' }}>Email (it warms the call; it does not close)</h3>
          <div style={{ display: 'flex', gap: 6, margin: '0 0 6px', flexWrap: 'wrap' }}>
            <CopyButton text={fill(s.email.body)} label="Copy body" />
            <a className="btn" style={{ fontSize: 12.5 }} href={`mailto:?subject=${encodeURIComponent(s.email.subject)}&body=${encodeURIComponent(fill(s.email.body))}`}>Open in email</a>
            <a className="btn" style={{ fontSize: 12.5 }} href={`/sales/resources/leave-behind/${s.key}`}>Leave-behind</a>
          </div>
          <div className="hint" style={{ fontSize: 13 }}>Subject: {s.email.subject}</div>
          <p style={{ margin: '4px 0 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>{fill(s.email.body)}</p>
        </details>
      ))}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Price list (2026 rate sheet)</h2>
        <table className="admin" style={{ minWidth: 480 }}>
          <tbody>{PRICE_LIST.map((p) => <tr key={p.item}><td>{p.item}</td><td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><b>{p.price}</b></td></tr>)}</tbody>
        </table>
      </div>

      <div className="panel" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px' }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>What we promise</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>{WE_PROMISE.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div style={{ flex: '1 1 300px' }}>
          <h2 style={{ marginTop: 0, fontSize: 16, color: 'var(--red, #c33)' }}>What we do NOT promise</h2>
          <ul style={{ margin: 0, paddingLeft: 20 }}>{WE_DO_NOT.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Follow-up (three days later)</h2>
        <div className="hint" style={{ fontSize: 13 }}>Subject: {FOLLOW_UP.subject}</div>
        <p style={{ whiteSpace: 'pre-wrap' }}>{fill(FOLLOW_UP.body)}</p>
        <CopyButton text={fill(FOLLOW_UP.body)} label="Copy body" />
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Handling objections</h2>
        {OBJECTIONS.map((o) => <p key={o.says} style={{ margin: '8px 0' }}><b>“{o.says}”</b><br />{o.reply}</p>)}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Pipeline and weekly check-in</h2>
        <p>{PIPELINE_NOTE}</p>
        <p style={{ margin: 0 }}>{WEEKLY_CHECKIN}</p>
      </div>
    </div>
  );
}
