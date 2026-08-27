import { redirect } from 'next/navigation';
import { getSession, isStaff } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { TZ } from '../../../../lib/constants';
import { cashAtTheDoor } from '../../../../lib/cash-at-the-door';
import { dispatchBoard, torontoToday } from '../../../../lib/jobs';
import PrintButton from '../../../../components/PrintButton';

export const dynamic = 'force-dynamic';

// The browser names a saved PDF after document.title, so the title IS the
// filename: "Run sheet 2026-08-26.pdf" beats "Run sheet.pdf" in a folder of
// thirty of them.
export async function generateMetadata({ searchParams }) {
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(sp?.date || '')) ? String(sp.date) : torontoToday();
  return { title: `Run sheet ${date}`, robots: { index: false } };
}

// The paper run sheet — the direct replacement for the one built by hand each
// morning. A phone battery dies where a sheet of paper doesn't.
//
// **One page per RUN, not per driver.** Two drivers sent together are one van
// doing one route, and this used to print that route twice — once under each
// name, identical, seven stops each — because it grouped by driver and a driver's
// list included the stops they were only riding on. Two sheets for one van is
// two sheets to keep in step, and the crew reading them has no way to tell they
// are the same run. The page belongs to whoever OWNS the stops (the primary
// driver holds the running order), and the header carries both names.
const prettyDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
const win = (j) => (j.windowStart && j.windowEnd ? `${j.windowStart}–${j.windowEnd}` : 'Any time');
// A number somebody has to dial off paper, in a van. 4374888549 is not that.
const phone = (v) => {
  const d = String(v || '').replace(/\D+/g, '');
  const ten = d.length > 10 ? d.slice(-10) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : (v || '');
};
const hhmm = (iso) => (iso
  ? new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
  : null);
// Cash and e-transfers the driver is expected to come back with, for the day.
const toCollect = (stops) => stops.reduce(
  (sum, j) => sum + (Number(j.balanceDue) || 0) + (cashAtTheDoor(j)?.amount || 0), 0
);
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
    ...board.drivers.map((d) => {
      // A run is the stops this driver OWNS. The ones they are riding on belong
      // to somebody else's run and print there — printing them here as well is
      // what produced two identical sheets for one van.
      const stops = board.jobs
        .filter((j) => j.driverId === d.id && live(j))
        .sort((a, b) => (a.seq ?? 99) - (b.seq ?? 99) || String(a.windowStart).localeCompare(String(b.windowStart)));
      // Who else is out on this run. When it is the same person all day — the
      // ordinary two-man crew — their name goes in the HEADER and comes off
      // every single row, where it was repeated seven times and read as noise.
      const mates = [...new Set(stops.map((j) => j.driver2Name).filter(Boolean))];
      const wholeRun = mates.length === 1 && stops.every((j) => j.driver2Name);
      return {
        key: `d${d.id}`,
        title: wholeRun ? `${d.name} + ${mates[0]}` : d.name,
        sub: phone(d.phone),
        crew: wholeRun ? 2 : 1,
        // A whole column of "—" is a column of nothing. It only earns its width
        // on a run that actually has money to bring back.
        collects: stops.some((j) => Number(j.balanceDue) > 0 || cashAtTheDoor(j)),
        stops
      };
    }),
    {
      key: 'unassigned',
      title: 'Not yet assigned',
      sub: '',
      crew: 1,
      collects: board.jobs.some((j) => !j.driverId && live(j)
        && (Number(j.balanceDue) > 0 || cashAtTheDoor(j))),
      stops: board.jobs.filter((j) => !j.driverId && live(j))
    }
  ].filter((c) => c.stops.length > 0);

  return (
    <div className="runsheet">
      <style>{`
        @media print {
          @page { margin: 14mm; }
          .runsheet-noprint { display: none !important; }
          /* The portal wrapper is screen furniture — its max-width and padding
             would print as a narrow column with a wasted inch each side. */
          .wrap { max-width: none !important; padding: 0 !important; margin: 0 !important; }
          .runsheet { padding: 0; max-width: none; }
          /* Keep a stop from being split across two pages — half a delivery on
             each sheet is how the second half gets missed. */
          .runsheet tbody tr { break-inside: avoid; }
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
        .runsheet .sig { width: 132px; }
        /* Without widths these two split whatever is left, and WHAT — the column
           the crew reads to load the van — lost every time to an address block
           that is three lines whatever you do to it. */
        .runsheet .cust { width: 40%; }
        .runsheet .what { width: 27%; }
        .runsheet .tbox {
          display: flex; align-items: baseline; gap: 5px;
          border-bottom: 1px solid #999; padding: 1px 0 3px; margin-bottom: 6px; min-height: 15px;
        }
        .runsheet .tbox span { font-size: 9.5px; color: #666; text-transform: uppercase; letter-spacing: .05em; }
        .runsheet .tbox b { font-variant-numeric: tabular-nums; font-size: 12px; }
        /* What's still owed on the order. A driver who doesn't know a balance is
           outstanding walks away without it — so it prints on every line, and
           the line says Paid rather than nothing when there's nothing to take. */
        .runsheet .coll { width: 78px; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .runsheet .coll strong { font-size: 14px; }
        .runsheet .paid { color: #666; font-size: 11.5px; }
        .runsheet .num { width: 26px; color: #666; }
        .runsheet .w { width: 86px; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .runsheet .note { color: #444; font-style: italic; }
        /* A trade-in has to survive being photocopied and read in a van, so it
           is boxed rather than merely bolded. */
        /* Louder than the trade-in box: this one is cash, and the driver is
           the person who does not get it back if it is missed. */
        .runsheet .cash {
          margin-top: 4px; padding: 3px 6px; border: 2px solid #000; background: #000; color: #fff;
          font-weight: bold; font-size: 12px; display: inline-block; white-space: nowrap;
        }

        .runsheet .cash-src { font-size: 10px; font-style: italic; color: #555; margin-top: 2px; }
        .runsheet .tradein {
          margin-top: 3px; padding: 2px 5px; border: 1.5px solid #000;
          font-weight: bold; font-size: 11.5px; display: inline-block;
        }
      `}</style>

      <div className="runsheet-noprint" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <a className="btn" href={`/admin/dispatch?date=${date}`}>← Back to the board</a>
        <PrintButton />
        <span className="hint" style={{ margin: 0 }}>
          Choose <b>Save as PDF</b> as the destination to keep a copy.
        </span>
      </div>

      {columns.length === 0 && <p>Nothing scheduled for {prettyDate(date)}.</p>}

      {columns.map((col) => (
        <div key={col.key} className="runsheet-driver">
          <h1>{col.title}</h1>
          <p className="sub">
            {prettyDate(date)} · {col.stops.length} stop{col.stops.length === 1 ? '' : 's'}
            {col.sub ? ` · ${col.sub}` : ''}
            {col.crew === 2 && ' · one van, one run — this is the sheet for both of you'}
            {toCollect(col.stops) > 0 && (
              <> · <strong>${toCollect(col.stops).toFixed(2)} to collect</strong></>
            )}
          </p>
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th className="w">Window</th>
                <th className="cust">Customer &amp; address</th>
                <th className="what">What</th>
                {col.collects && <th className="coll">Collect</th>}
                <th className="sig">In / out &amp; signature</th>
              </tr>
            </thead>
            <tbody>
              {col.stops.map((j, i) => (
                <tr key={j.id}>
                  <td className="num">{i + 1}</td>
                  <td className="w">{win(j)}</td>
                  <td className="cust">
                    <strong>{j.customerName || '(no name)'}</strong>
                    {/* Only when it is NOT already in the header. On a two-man
                        day this was printed on every row and read as noise. */}
                    {j.driver2Name && col.crew !== 2
                      ? <> · <em>with {j.driver2Name}</em></> : null}
                    {j.phone ? ` · ${phone(j.phone)}` : ''}<br />
                    {j.pickupAddress
                      ? <><b>FROM</b> {[j.pickupAddress, j.pickupCity].filter(Boolean).join(', ')}
                          {(j.pickupCompany || j.pickupName || j.pickupPhone) && (
                            <> · {[j.pickupCompany, j.pickupName, phone(j.pickupPhone)].filter(Boolean).join(' · ')}</>
                          )}<br />
                          <b>TO</b> {[j.address, j.city, j.postal].filter(Boolean).join(', ')}</>
                      : [j.address, j.city, j.postal].filter(Boolean).join(', ')}
                    {j.notes ? <><br /><span className="note">{j.notes}</span></> : null}
                  </td>
                  <td className="what">
                    {j.type === 'service_call'
                      ? [j.appliance, j.issue].filter(Boolean).join(' — ') || 'Service call'
                      : (j.items?.length ? j.items.map((it) => it.description).join(', ') : '—')}
                    {j.shipmentType && <><br /><strong>{SHIPMENT_LABEL[j.shipmentType]}</strong></>}
                    {/* Printed in the WHAT column, not the notes: the crew reads
                        this column to load the van, and the trade-in is the one
                        thing on the stop that has to come back on it. */}
                    {j.tradeIns?.length
                      ? j.tradeIns.map((t, i) => (
                          <div key={i} className="tradein">
                            ⬅ BRING BACK: {t.description}
                            {t.allowance > 0 ? ` ($${t.allowance.toFixed(2)})` : ''}
                          </div>
                        ))
                      : (j.services?.includes('trade_in')
                        ? <div className="tradein">⬅ BRING BACK: see notes</div>
                        : null)}
                    {/* Money the customer hands over at the door, boxed like
                        the trade-in and for the same reason: it is the other
                        thing on this stop that costs real cash to miss, and it
                        was printing as one clause of an italic note. A figure
                        somebody TYPED is stated flat; one lifted out of the
                        client's own prose says so and quotes the sentence, so
                        the driver can see where it came from before asking a
                        customer for fifty dollars. */}
                    {(() => {
                      const cash = cashAtTheDoor(j);
                      if (!cash) return null;
                      return (
                        <>
                          {/* The box holds the AMOUNT and nothing else, so it
                              is one unbreakable line at a glance. Everything
                              qualifying it goes underneath in quiet grey —
                              quoting the client's sentence inside the box made
                              the loud thing three lines of dense white italic,
                              and that sentence already prints in full in the
                              column beside this one. */}
                          <div className="cash">💵 COLLECT ${cash.amount.toFixed(2)} CASH</div>
                          <div className="cash-src">
                            {cash.typed
                              ? (cash.note || 'agreed with the office')
                              : 'read off the note — check it before you ask'}
                          </div>
                        </>
                      );
                    })()}
                    {j.services?.length > 0 && (
                      <><br />{j.services.map((k) => SERVICE_LABEL[k] || k).join(' · ')}</>
                    )}
                    <br />
                    {/* The driver is asked about "the BB-1179 fridge" on the
                        phone, never about RS-1021 — so both numbers print, and
                        the company the stop is for prints with them. */}
                    <span className="note">
                      {j.ticketNumber || j.jobNumber}
                      {j.orderNumber ? ` · ${j.orderNumber}` : ''}
                      {/* "Own job" printed on every stop that simply had no
                          client company — a label for the absence of a fact. */}
                      {j.clientName ? ` · ${j.clientName}` : (j.source === 'bargain_bay' ? ' · Bargain Bay' : '')}
                    </span>
                  </td>
                  {col.collects && (
                    <td className="coll">
                      {j.balanceDue > 0 && (
                        <><strong>${Number(j.balanceDue).toFixed(2)}</strong>
                          {j.invoiceNumber ? <><br /><span className="note">{j.invoiceNumber}</span></> : null}</>
                      )}
                      {cashAtTheDoor(j) && (
                        <div>
                          <strong>${cashAtTheDoor(j).amount.toFixed(2)}</strong>
                          <br /><span className="note">cash</span>
                        </div>
                      )}
                      {!(j.balanceDue > 0) && !cashAtTheDoor(j) && (
                        <span className="paid">{j.orderId ? 'Paid' : '—'}</span>
                      )}
                    </td>
                  )}
                  {/* The clock, on paper. The office now costs a delivery by the
                      time it took, so the times have to survive a dead phone —
                      written here and typed in later from the sheet. Anything
                      already recorded prints instead of an empty rule. */}
                  <td className="sig">
                    <div className="tbox"><span>In</span><b>{hhmm(j.timeIn) || ''}</b></div>
                    <div className="tbox"><span>Out</span><b>{hhmm(j.timeOut) || ''}</b></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
