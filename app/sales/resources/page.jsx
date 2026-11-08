import { hubPage, NotAuthorized } from '../../../lib/sales-page';
import { mergeTemplate } from '../../../lib/lead-rules';
import { PITCH, TARGETS, COLD_CALL, EMAIL_TEMPLATES, OBJECTIONS, PIPELINE_NOTE, WEEKLY_CHECKIN } from '../../../lib/sales-content';
import SalesNav from '../../../components/SalesNav';
import CopyButton from '../../../components/CopyButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Resources — Sales Hub' };

export default async function ResourcesPage() {
  const g = await hubPage('/sales/resources');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;
  // The rep's own name is filled in; the prospect's name and company stay as
  // placeholders to be replaced when the message is sent.
  const vars = { rep_name: viewer.name || '{rep_name}', first_name: '{first_name}', company: '{company}', rep_phone: '{rep_phone}' };
  return (
    <div>
      <SalesNav side={side} name={viewer.name} />

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>The one-line pitch</h2>
        <p style={{ margin: 0 }}>{PITCH}</p>
      </div>

      <div className="panel" style={{ overflowX: 'auto' }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Who to target and what to sell them</h2>
        <table className="admin" style={{ minWidth: 560 }}>
          <thead><tr><th>Target</th><th>Main offers</th><th>Hook</th></tr></thead>
          <tbody>{TARGETS.map((t) => <tr key={t.who}><td><b>{t.who}</b></td><td>{t.offers}</td><td>{t.hook}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Cold call script</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{mergeTemplate(COLD_CALL, vars)}</p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Email templates</h2>
        {EMAIL_TEMPLATES.map((t) => {
          const body = mergeTemplate(t.body, vars);
          return (
            <div key={t.key} style={{ borderTop: '1px solid var(--line, #eee)', padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <b>{t.title}</b>
                <span style={{ display: 'flex', gap: 6 }}>
                  <CopyButton text={body} label="Copy body" />
                  <a className="btn" style={{ fontSize: 12.5 }} href={`mailto:?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(body)}`}>Open in email</a>
                </span>
              </div>
              <div className="hint" style={{ fontSize: 13 }}>Subject: {t.subject}</div>
              <p style={{ margin: '4px 0 0', fontSize: 14 }}>{body}</p>
            </div>
          );
        })}
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
