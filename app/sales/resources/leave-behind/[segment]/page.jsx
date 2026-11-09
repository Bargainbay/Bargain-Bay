import { notFound } from 'next/navigation';
import { hubPage, NotAuthorized } from '../../../../../lib/sales-page';
import { leaveBehind, SEGMENT_PITCHES } from '../../../../../lib/sales-content';
import SalesNav from '../../../../../components/SalesNav';
import PrintButton from '../../../../../components/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leave-behind — Sales Hub' };

// A one-page leave-behind for a segment, printable (Print / Save as PDF). It carries the real rate-sheet prices and only the
// promises we can keep. It prints the COMPANY's contact details, never the rep's personal login address.
export default async function LeaveBehindPage({ params }) {
  const { segment } = await params;
  const g = await hubPage(`/sales/resources/leave-behind/${segment}`);
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;
  const pitch = SEGMENT_PITCHES.find((s) => s.key === segment);
  if (!pitch || pitch.hold) notFound();
  const lb = leaveBehind(segment);

  return (
    <div className="doc-print">
      <div className="noprint">
        <SalesNav side={side} name={viewer.name} admin={viewer.admin} />
        <p style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <a href="/sales/resources">← Resources</a><PrintButton />
          <span className="hint">Prints as one page. Add your name and number by hand if you like.</span>
        </p>
      </div>

      <div className="panel" style={{ maxWidth: 780, margin: '0 auto' }}>
        <div style={{ borderBottom: '3px solid var(--charcoal, #222)', paddingBottom: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted, #777)' }}>RS Solutions · Bargain Bay</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 24 }}>{lb.headline}</h1>
        </div>

        <h2 style={{ fontSize: 15, margin: '10px 0 4px' }}>What we do for you</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>{lb.bullets.map((b) => <li key={b} style={{ margin: '3px 0' }}>{b}</li>)}</ul>

        <h2 style={{ fontSize: 15, margin: '14px 0 4px' }}>Prices (2026 rate sheet, before HST)</h2>
        <table className="admin" style={{ width: '100%', fontSize: 13 }}>
          <tbody>{lb.prices.map((p) => <tr key={p.item}><td>{p.item}</td><td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><b>{p.price}</b></td></tr>)}</tbody>
        </table>

        <h2 style={{ fontSize: 15, margin: '14px 0 4px' }}>How it works</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>{lb.promises.map((b) => <li key={b} style={{ margin: '3px 0' }}>{b}</li>)}</ul>

        <div style={{ marginTop: 16, paddingTop: 10, borderTop: '1px solid var(--line, #ddd)', fontSize: 13.5, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span><b>1000732031 Ontario Inc.</b> o/a RS Solutions and Bargain Bay<br />1135 Squires Beach Rd, Pickering, ON L1W 3T9</span>
          <span>service@rssolutions.ca<br />(647) 259-7119 · rssolutions.ca<br />Your contact: {viewer.name || '________________'}</span>
        </div>
      </div>
    </div>
  );
}
