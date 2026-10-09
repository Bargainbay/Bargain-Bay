// The sections of a policy or guide. Server component. Paragraph strings, { list }, { steps },
// { checklist } and { table } only — nothing is ever injected as HTML, so a document can't carry markup
// it was not meant to.
export default function DocBody({ sections }) {
  return sections.map((s) => (
    <section key={s.h}>
      <h2>{s.h}</h2>
      {s.body.map((b, i) => {
        if (typeof b === 'string') return <p key={i}>{b}</p>;
        if (b.list) return <ul key={i}>{b.list.map((x, j) => <li key={j}>{x}</li>)}</ul>;
        if (b.steps) return <ol key={i}>{b.steps.map((x, j) => <li key={j}>{x}</li>)}</ol>;
        // A tick-list for the loading bay. The box is a real glyph so it survives printing in black and white.
        if (b.checklist) return <ul key={i} className="doc-checklist">{b.checklist.map((x, j) => <li key={j}><span aria-hidden="true">☐</span> {x}</li>)}</ul>;
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
  ));
}
