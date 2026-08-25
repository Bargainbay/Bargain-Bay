import { redirect } from 'next/navigation';
import { getSession, isStaff } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { dispatchBoard, torontoToday } from '../../../../lib/jobs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Run sheet', robots: { index: false } };

// The paper run sheet — the direct replacement for the one built by hand each
// morning. One page per driver, because they get handed out separately, and a
// phone battery dies where a sheet of paper doesn't.
const prettyDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
const win = (j) => (j.windowStart && j.windowEnd ? `${j.windowStart}–${j.windowEnd}` : 'Any time');
// Cash and e-transfers the driver is expected to come back with, for the day.
const toCollect = (stops) => stops.reduce((sum, j) => sum + (Number(j.balanceDue) || 0), 0);
const SHIPMENT_LABEL = { white_glove: 'WHITE GLOVE', threshold: 'THRESHOLD' };
const SERVICE_LABEL = {
  delivery_only: 'Delivery only', install: 'Install', haul_away: 'Haul away',
  exchange: 'Exchange', return_pickup: 'Return pickup',
  parts_drop: 'Parts drop-off', warranty: 'Warranty'
};

export default async function RunSheetPage({ searchParams }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/dispatch');
  if (!isStaff(session)) return <div style={{ padding: 24 }}>Not authorized.</div>;
  if (!hasDb()) return <div style={{ padding: 24 }}>Database not configured.</div>;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(sp?.date || '')) ? String(sp.date) : torontoToday();
  const board = await dispatchBoard(date).catch(() => null);
  if (!board) return <div style={{ padding: 24 }}>Could not load that day.</div>;

  const live = (j) => !['cancelled'].includes(j.status);
  const columns = [
    ...board.drivers.map((d) => ({
      key: `d${d.id}`,
      title: d.name,
      sub: d.phone || '',
      stops: board.jobs
        .filter((j) => j.driverId === d.id && live(j))
        .sort((a, b) => (a.seq ?? 99) - (b.seq ?? 99) || String(a.windowStart).localeCompare(String(b.windowStart)))
    })),
    {
      key: 'unassigned',
      title: 'Not yet assigned',
      sub: '',
      stops: board.jobs.filter((j) => !j.driverId && live(j))
    }
  ].filter((c) => c.stops.length > 0);

  return (
    <div className="runsheet">
      <style>{`
        @media print {
          @page { margin: 14mm; }
          .runsheet-noprint { display: none !important; }
          .runsheet-driver { break-after: page; }
          .runsheet-driver:last-child { break-after: auto; }
        }
        .runsheet { font-family: var(--font-body, system-ui); color: #111; background: #fff; padding: 22px; max-width: 900px; margin: 0 auto; }
        .runsheet h1 { font-size: 21px; margin: 0 0 2px; }
        .runsheet h2 { font-size: 17px; margin: 0 0 2px; }
        .runsheet .sub { color: #555; font-size: 13px; margin: 0 0 14px; }
        .runsheet table { width: 100%; border-collapse: collapse; margin-bottom: 26px; font-size: 12.5px; }
        .runsheet th { text-align: left; border-bottom: 2px solid #111; padding: 5px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
        .runsheet td { border-bottom: 1px solid #ccc; padding: 8px 6px; vertical-align: top; }
        .runsheet .sig { width: 120px; }
        /* What's still owed on the order. A driver who doesn't know a balance is
           outstanding walks away without it — so it prints on every line, and
           the line says Paid rather than nothing when there's nothing to take. */
        .runsheet .coll { width: 78px; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .runsheet .coll strong { font-size: 14px; }
        .runsheet .paid { color: #666; font-size: 11.5px; }
        .runsheet .num { width: 26px; color: #666; }
        .runsheet .w { width: 86px; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .runsheet .note { color: #444; font-style: italic; }
      `}</style>

      <div className="runsheet-noprint" style={{ marginBottom: 16, display: 'flex', gap: 10 }}>
        <a className="btn" href={`/admin/dispatch?date=${date}`}>← Back to the board</a>
      </div>

      {columns.length === 0 && <p>Nothing scheduled for {prettyDate(date)}.</p>}

      {columns.map((col) => (
        <div key={col.key} className="runsheet-driver">
          <h1>{col.title}</h1>
          <p className="sub">
            {prettyDate(date)} · {col.stops.length} stop{col.stops.length === 1 ? '' : 's'}
            {col.sub ? ` · ${col.sub}` : ''}
            {toCollect(col.stops) > 0 && (
              <> · <strong>${toCollect(col.stops).toFixed(2)} to collect</strong></>
            )}
          </p>
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th className="w">Window</th>
                <th>Customer &amp; address</th>
                <th>What</th>
                <th className="coll">Collect</th>
                <th className="sig">Signature / time</th>
              </tr>
            </thead>
            <tbody>
              {col.stops.map((j, i) => (
                <tr key={j.id}>
                  <td className="num">{i + 1}</td>
                  <td className="w">{win(j)}</td>
                  <td>
                    <strong>{j.customerName || '(no name)'}</strong>
                    {j.phone ? ` · ${j.phone}` : ''}<br />
                    {j.pickupAddress
                      ? <><b>FROM</b> {[j.pickupAddress, j.pickupCity].filter(Boolean).join(', ')}<br />
                          <b>TO</b> {[j.address, j.city, j.postal].filter(Boolean).join(', ')}</>
                      : [j.address, j.city, j.postal].filter(Boolean).join(', ')}
                    {j.notes ? <><br /><span className="note">{j.notes}</span></> : null}
                  </td>
                  <td>
                    {j.type === 'service_call'
                      ? [j.appliance, j.issue].filter(Boolean).join(' — ') || 'Service call'
                      : (j.items?.length ? j.items.map((it) => it.description).join(', ') : '—')}
                    {j.shipmentType && <><br /><strong>{SHIPMENT_LABEL[j.shipmentType]}</strong></>}
                    {j.services?.length > 0 && (
                      <><br />{j.services.map((k) => SERVICE_LABEL[k] || k).join(' · ')}</>
                    )}
                    <br />
                    <span className="note">
                      {j.ticketNumber || j.jobNumber}{j.clientName ? ` · ${j.clientName}` : ''}
                    </span>
                  </td>
                  <td className="coll">
                    {j.balanceDue > 0
                      ? <><strong>${Number(j.balanceDue).toFixed(2)}</strong>
                          {j.invoiceNumber ? <><br /><span className="note">{j.invoiceNumber}</span></> : null}</>
                      : <span className="paid">{j.orderId ? 'Paid' : '—'}</span>}
                  </td>
                  <td className="sig"></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
