'use client';
// THE ONE WAY BARGAIN BAY ASKS ANYBODY TO AGREE TO TERMS - affiliates, members and sellers.
// The agreement sits in a scroll box; the parent keeps the Accept button dead until `onRead` fires, which it
// does once the box has been scrolled to the bottom (or it was too short to scroll). The parent also sends
// the VERSION it showed, which the server checks and records. Scrolling to the end is a UI guard, not proof of
// reading, so what is kept on record is the version and the time, never "they read it".
//
// `sections` is the policy format ({ h, body: [string | { p, lead?, list? } | { list } | { steps } | { table }] }),
// the same one lib/marketplace-policies.js uses, so a seller's policies render here without conversion.
// `{ h, group: true, body: [] }` is a document heading when several documents are shown in one box.
import { useEffect, useRef } from 'react';

function Block({ b }) {
  if (typeof b === 'string') return <p style={{ margin: '0 0 8px' }}>{b}</p>;
  if (b.table) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', margin: '8px 0', fontSize: 13.5, width: '100%' }}>
          <thead><tr>{b.table.head.map((h) => <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid var(--line, #ddd)', padding: '4px 8px 4px 0' }}>{h}</th>)}</tr></thead>
          <tbody>{b.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: '4px 8px 4px 0', verticalAlign: 'top' }}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  const items = b.list || b.steps;
  const List = b.steps ? 'ol' : 'ul';
  return (
    <>
      {(b.p || b.lead) && <p style={{ margin: '0 0 8px' }}>{b.lead && <b>{b.lead} </b>}{b.p}</p>}
      {items && <List style={{ margin: '0 0 8px', paddingLeft: 20 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</List>}
      {b.checklist && <ul style={{ margin: '0 0 8px', paddingLeft: 20, listStyle: 'none' }}>{b.checklist.map((x, i) => <li key={i}>☐ {x}</li>)}</ul>}
    </>
  );
}

export default function AgreementScroll({ sections, label, read, onRead, maxHeight = 320 }) {
  const box = useRef(null);
  // At the bottom (a few pixels of slack: browsers round scroll positions), or too short to scroll at all.
  const check = () => {
    const el = box.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 8) onRead();
  };
  useEffect(() => { check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div
        ref={box} onScroll={check} role="region" tabIndex={0}
        aria-label={`${label}. Scroll to the end to enable the Accept button.`}
        style={{ maxHeight, overflowY: 'auto', border: '1px solid var(--line, #ddd)', borderRadius: 8, padding: '12px 14px', fontSize: 14, lineHeight: 1.5, background: '#fff' }}
      >
        {sections.map((s, i) => (
          <section key={`${s.h}-${i}`} style={{ marginBottom: 12 }}>
            {s.group
              ? <h3 style={{ margin: '14px 0 6px', fontSize: 16, borderBottom: '1px solid var(--line, #ddd)', paddingBottom: 4 }}>{s.h}</h3>
              : <h4 style={{ margin: '0 0 6px', fontSize: 15 }}>{s.h}</h4>}
            {(s.body || []).map((b, j) => <Block key={j} b={b} />)}
          </section>
        ))}
      </div>
      <div className="hint" style={{ margin: '6px 0 10px' }} aria-live="polite">
        {read ? '✓ You have reached the end.' : 'Scroll to the end to continue.'}
      </div>
    </>
  );
}
