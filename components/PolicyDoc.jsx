import { AUDIENCE } from '../lib/marketplace-policies';

// Renders one policy document. Server component. Paragraph strings, { list } and { table } only —
// nothing is ever injected as HTML, so a policy can't carry markup it was not meant to.
export default function PolicyDoc({ policy }) {
  const draft = policy.status !== 'published';
  return (
    <div className="prose">
      {draft && (
        <div className="panel" style={{ background: 'var(--warnbg)', color: 'var(--warn)', maxWidth: 760 }}>
          <b>DRAFT — not in force.</b> This document is waiting for review and has not been published. It does not bind anyone yet.
        </div>
      )}
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 4px' }}>{AUDIENCE[policy.audience]} · Version {policy.version}</p>
      <h1 style={{ marginTop: 0 }}>{policy.title}</h1>
      {policy.sections().map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          {s.body.map((b, i) => {
            if (typeof b === 'string') return <p key={i}>{b}</p>;
            if (b.list) return <ul key={i}>{b.list.map((x, j) => <li key={j}>{x}</li>)}</ul>;
            if (b.table) {
              return (
                <div key={i} style={{ overflowX: 'auto' }}>
                  <table>
                    <thead><tr>{b.table.head.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
                    <tbody>{b.table.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              );
            }
            return null;
          })}
        </section>
      ))}
    </div>
  );
}
