import { notFound, redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { getPackingSlip } from '../../../../lib/invoices';
import {
  BUSINESS_NAME, BUSINESS_LEGAL, BUSINESS_ADDRESS, PICKUP_ADDRESS, DISPATCH_EMAIL, isUnitLine } from '../../../../lib/constants';
import PackingSlipActions from '../../../../components/PackingSlipActions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Packing slip — Bargain Bay' };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export default async function PackingSlipPage({ params }) {
  const { number } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/admin/packing-slip/${number}`);
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>Your account ({session.email}) isn&apos;t on the admin list.</p>
    </div></div>);
  }
  if (!hasDb()) return <div className="narrow"><div className="panel">Database not configured.</div></div>;

  const slip = await getPackingSlip(number).catch(() => null);
  if (!slip) return notFound();

  const delivery = slip.delivery_method === 'delivery';
  const ship = delivery
    ? [slip.name, slip.address, [slip.city, slip.postal].filter(Boolean).join(' '), slip.phone].filter(Boolean)
    : [slip.name, 'Pickup by appointment', PICKUP_ADDRESS, slip.phone].filter(Boolean);
  const units = (slip.items || []).filter((it) => isUnitLine(it.kind));
  // What we're taking away, not bringing. The slip travels with the delivery, so
  // it is the last piece of paper anyone reads before the van leaves.
  const tradeIns = (slip.items || []).filter((it) => it.kind === 'trade_in');

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff; }
          .ps-sheet { box-shadow: none !important; border: none !important; }
        }
        .ps-sheet { background: #fff; color: #2e2d2b; border: 1px solid #e5e5e5; border-radius: 10px; padding: 28px; }
        .ps-th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #999; }
        .ps-serial { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; font-size: 16px; letter-spacing: .02em; }
        .ps-row td { padding: 9px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
      `}</style>

      <PackingSlipActions number={slip.number} dispatchEmail={DISPATCH_EMAIL} />

      <div className="ps-sheet">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #2e2d2b', paddingBottom: 10 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em' }}>{BUSINESS_NAME}</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>Packing Slip</div>
            <div style={{ fontSize: 12, color: '#666' }}>For warehouse / delivery — pick by serial. Not a receipt.</div>
          </div>
          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 13 }}>Ref <b>{slip.number}</b></div>
            <div style={{ fontSize: 12, color: '#666' }}>{fmtDate(slip.created_at)}</div>
            <div style={{ display: 'inline-block', marginTop: 4, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: delivery ? '#eaf3ff' : '#f1f1f1' }}>
              {delivery ? 'DELIVERY' : 'PICKUP'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 24, margin: '16px 0' }}>
          <div style={{ flex: 1 }}>
            <div className="ps-th">{delivery ? 'Deliver to' : 'Pickup for'}</div>
            {ship.map((l, i) => <div key={i} style={{ fontSize: 13.5, fontWeight: i === 0 ? 700 : 400 }}>{l}</div>)}
          </div>
          <div style={{ flex: 1 }}>
            <div className="ps-th">From</div>
            <div style={{ fontSize: 13.5 }}>{BUSINESS_LEGAL}</div>
            <div style={{ fontSize: 12.5, color: '#666' }}>{BUSINESS_ADDRESS}</div>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
          <thead>
            <tr className="ps-th" style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={{ padding: '4px 6px', width: 28 }}>#</th>
              <th style={{ padding: '4px 6px' }}>Item</th>
              <th style={{ padding: '4px 6px' }}>Serial #</th>
              <th style={{ padding: '4px 6px', textAlign: 'center', width: 60 }}>Picked</th>
            </tr>
          </thead>
          <tbody>
            {units.map((it, i) => {
              const sub = [it.sku, it.condition].filter(Boolean).join(' · ');
              return (
                <tr className="ps-row" key={it.id}>
                  <td style={{ color: '#999', textAlign: 'center' }}>{i + 1}</td>
                  <td>
                    <div style={{ fontSize: 14 }}>{it.description}</div>
                    {sub && <div style={{ fontSize: 11.5, color: '#888' }}>{sub}</div>}
                  </td>
                  <td><span className="ps-serial">{it.serial || '(no serial on file)'}</span></td>
                  <td style={{ textAlign: 'center', fontSize: 18 }}>☐</td>
                </tr>
              );
            })}
            {units.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 12, color: '#999' }}>No physical units on this invoice (services only).</td></tr>
            )}
          </tbody>
        </table>

        {tradeIns.length > 0 && (
          <div style={{ marginTop: 16, border: '2px solid #2e2d2b', borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>
              Bring back to the warehouse — trade-in
            </div>
            {tradeIns.map((it) => (
              <div key={it.id} style={{ fontSize: 14, marginTop: 4 }}>
                {it.description} &nbsp;·&nbsp; Collected ☐
              </div>
            ))}
          </div>
        )}

        <p style={{ fontSize: 12.5, color: '#666', marginTop: 12 }}>
          {units.length} unit{units.length === 1 ? '' : 's'} to pick{slip.memo ? <> · Note: {slip.memo}</> : ''}
        </p>
        <div style={{ marginTop: 22, fontSize: 12, color: '#666', borderTop: '1px solid #eee', paddingTop: 12 }}>
          Prepared by ______________________ &nbsp;·&nbsp; Date __________ &nbsp;·&nbsp; Loaded ☐ &nbsp;·&nbsp; Verified against serials ☐
        </div>
      </div>
    </div>
  );
}
