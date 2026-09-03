'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import JobForm from './JobForm';
import ServiceVisitForm from './ServiceVisitForm';
import TicketQueue from './TicketQueue';
import DispatchSetup from './DispatchSetup';
import StopImport from './StopImport';
import PayReport from './PayReport';
import ClientBilling from './ClientBilling';
import StopTimes from './StopTimes';
import { cashAtTheDoor } from '../lib/cash-at-the-door';
import ProfitReport from './ProfitReport';
import LiveMap from './LiveMap';

// The day's run sheet, on screen. One unassigned pile plus a column per driver.
// Assignment is by tap, not drag: drag is pleasant on a desktop and miserable on
// a phone, and this gets used on a phone in a warehouse.
const STATUS_TONE = {
  unscheduled: 'warn', scheduled: 'warn', on_the_way: 'ok',
  arrived: 'ok', done: 'ok', failed: 'sold', cancelled: 'sold'
};
const STATUS_LABEL = {
  unscheduled: 'Unscheduled', scheduled: 'Scheduled', on_the_way: 'On the way',
  arrived: 'Arrived', done: 'Done', failed: "Couldn't complete", cancelled: 'Cancelled'
};
const TYPE_LABEL = { delivery: 'Delivery', service_call: 'Service', pickup: 'Pickup' };
const SHIPMENT_LABEL = { white_glove: 'White glove', threshold: 'Threshold' };
const SERVICE_LABEL = {
  delivery_only: 'Delivery only', install: 'Install', haul_away: 'Haul away',
  exchange: 'Exchange', return_pickup: 'Return pickup',
  parts_drop: 'Parts drop-off', warranty: 'Warranty'
};
const FAIL_REASONS = {
  no_answer: 'Nobody home', refused: 'Customer refused', wrong_address: 'Wrong / bad address',
  no_access: "Wouldn't fit / no access", damaged: 'Item damaged',
  rescheduled: 'Customer rescheduled', other: 'Other'
};

const shiftDate = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
};
const prettyDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' });
const windowLabel = (j) => (j.windowStart && j.windowEnd ? `${j.windowStart}–${j.windowEnd}` : 'Any time');

const PAY_METHODS = { cash: 'Cash', etransfer: 'E-transfer', card: 'Card (manual)', cheque: 'Cheque', other: 'Other' };

// ── The clock ────────────────────────────────────────────────────────────────
// Formatted in the BROWSER, which is already on Toronto time — the same reason
// the run sheet's server-rendered times have to name their zone and these don't.
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : null);
const minsBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
const asDuration = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);
// What a <input type="time"> wants: 24-hour, local.
const timeField = (iso) =>
  (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '');

// Re-render while a stop is running so "on site 42m" is actually true. Half a
// minute: the number only moves in minutes, and this board is left open all day
// on a warehouse screen.
function useTicking(active) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => bump((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [active]);
}

// Correcting the clock by hand. A driver who forgets to tap Done is the most
// common thing that happens to these times, and the real ones are sitting in the
// WhatsApp group — so the fix has to be four keystrokes on the card, not a
// close-out that records whatever time the office happened to notice.
function TimesForm({ job, busy, onTimes, onDone }) {
  const [timeIn, setTimeIn] = useState(timeField(job.timeIn));
  const [timeOut, setTimeOut] = useState(timeField(job.timeOut));
  const [note, setNote] = useState('');
  const open = !['done', 'failed', 'cancelled'].includes(job.status);
  const [markDone, setMarkDone] = useState(open);
  return (
    <form
      className="disp-times-form"
      onSubmit={(e) => {
        e.preventDefault();
        onTimes(job.id, { date: job.jobDate, timeIn, timeOut, note, markDone: open && markDone })
          .then((ok) => { if (ok) onDone(); });
      }}
    >
      <label>Got there<input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} /></label>
      <label>Finished<input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} /></label>
      <input className="disp-collect-note" value={note} placeholder="Where the times came from (optional)"
        onChange={(e) => setNote(e.target.value)} />
      {open && (
        <label className="disp-times-close">
          <input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />
          and mark the stop done
        </label>
      )}
      <button type="submit" className="btn accent" disabled={busy}>Save times</button>
    </form>
  );
}

// Both sides of a stop's money, on the stop.
//
// There was nowhere to do this for the jobs that needed it most. A charge could
// only be set on the Billing tab, which lists **finished** jobs belonging to a
// **client company** — so an imported Bargain Bay delivery, which has no client
// and hasn't happened yet, could never appear there and had no reachable charge
// at all. Pay was worse: it was only offered inside the close-out form, so a
// stop that was already done couldn't be priced either.
//
// Both still go through their own guarded functions, one call each — setJobCharge
// refuses to move a charge that is already on an invoice, and both are admin.
function MoneyForm({ job, busy, onCharge, onPay, onDone }) {
  const [charge, setCharge] = useState(job.chargeAmount == null ? '' : String(job.chargeAmount));
  const [pay, setPay] = useState(job.payAmount == null ? '' : String(job.payAmount));
  const [note, setNote] = useState('');
  const was = (v) => (v == null ? '' : String(v));

  async function submit(e) {
    e.preventDefault();
    let ok = true;
    // Only what actually moved is sent: re-posting an unchanged charge on an
    // invoiced job would be refused, and refused for something nobody asked for.
    if (charge !== was(job.chargeAmount)) ok = await onCharge(job.id, charge, note) && ok;
    if (ok && pay !== was(job.payAmount)) ok = await onPay(job.id, pay, note) && ok;
    if (ok) onDone();
  }

  return (
    <form className="disp-times-form" onSubmit={submit}>
      <label>
        Client pays
        {job.invoiceId
          ? <input value={charge} disabled title="Already on an invoice — credit the invoice instead" />
          : <input inputMode="decimal" value={charge} placeholder="150.00"
              onChange={(e) => setCharge(e.target.value)} />}
      </label>
      <label>
        Driver paid
        <input inputMode="decimal" value={pay} placeholder="60.00"
          onChange={(e) => setPay(e.target.value)} />
      </label>
      <input className="disp-collect-note" value={note} placeholder="What for (optional)"
        onChange={(e) => setNote(e.target.value)} />
      <button type="submit" className="btn accent" disabled={busy}>Save</button>
      {job.invoiceId && (
        <span className="hint" style={{ margin: 0, flexBasis: '100%' }}>
          This stop is already on an invoice, so its charge is the customer&apos;s now — credit the
          invoice rather than moving the number.
        </span>
      )}
      {!job.orderId && !job.clientName && (
        <span className="hint" style={{ margin: 0, flexBasis: '100%' }}>
          No client on this stop, so it won&apos;t appear on the Billing tab — but what you type here
          still counts on the Profit tab.
        </span>
      )}
    </form>
  );
}

// What the day cost, recorded on the day. Gas by default because gas is what it
// almost always is. Dated to the board's day rather than to "now", so filling in
// Tuesday's receipt on Thursday puts it on Tuesday where it belongs.
const DAY_COSTS = {
  gas: 'Gas', tolls: 'Tolls / 407', parking: 'Parking',
  maintenance: 'Van / maintenance', rental: 'Truck rental',
  helper: 'Helper (cash)', other: 'Other'
};
function DayCostForm({ date, drivers, busy, onSave }) {
  const [kind, setKind] = useState('gas');
  const [amount, setAmount] = useState('');
  const [driverId, setDriverId] = useState('');
  const [note, setNote] = useState('');
  return (
    <form
      className="disp-setup-form"
      style={{ margin: '0 0 12px' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!(Number(amount) > 0)) return;
        onSave({ date, kind, amount: Number(amount), driverId: driverId || null, note });
      }}
    >
      <span className="hint" style={{ margin: 0, alignSelf: 'center' }}>{prettyDate(date)}</span>
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        {Object.entries(DAY_COSTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input inputMode="decimal" value={amount} placeholder="Amount *" autoFocus
        onChange={(e) => setAmount(e.target.value)} />
      <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
        <option value="">Which van (optional)</option>
        {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <input value={note} placeholder="Note (optional)" onChange={(e) => setNote(e.target.value)} />
      <button className="btn accent" disabled={busy || !(Number(amount) > 0)}>Record</button>
    </form>
  );
}

// Everything that has ever happened to one stop, in the words it was logged in.
// `job_events` has recorded every assignment, status move, payment and
// correction since dispatch was built, and nothing ever showed it — so when a
// driver's name came off a stop there was no screen anybody could go and read.
function JobHistory({ jobId }) {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/admin/dispatch?view=history&jobId=${jobId}`)
      .then((r) => r.json())
      .then((d) => { if (live) setEvents(Array.isArray(d.events) ? d.events : []); })
      .catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
  }, [jobId]);

  if (events === null) return <p className="hint" style={{ margin: '6px 0 0' }}>Loading…</p>;
  if (!events.length) return <p className="hint" style={{ margin: '6px 0 0' }}>Nothing logged against this stop.</p>;
  return (
    <ol className="disp-history">
      {events.map((e, i) => (
        <li key={i}>
          <b>{e.event.replace(/_/g, ' ')}</b>
          {e.detail ? ` — ${e.detail}` : ''}
          <span className="disp-history-when">
            {new Date(e.at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {e.byName ? ` · ${e.byName}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

// Taking the balance at the door. Deliberately on the card and not behind a trip
// to the Invoices page: the money is counted while the driver is still on the
// phone, and anything else means it gets logged tomorrow from a note in a pocket.
function CollectForm({ job, busy, onRecord }) {
  const [amount, setAmount] = useState(Number(job.balanceDue).toFixed(2));
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  return (
    <form
      className="disp-collect-form"
      onSubmit={(e) => { e.preventDefault(); onRecord(job.id, { amount: Number(amount), method, note }); }}
    >
      <label>
        Amount
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>
        How
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <input className="disp-collect-note" value={note} placeholder="Note (optional)"
        onChange={(e) => setNote(e.target.value)} />
      <button type="submit" className="btn accent" disabled={busy || !(Number(amount) > 0)}>
        Record ${Number(amount || 0).toFixed(2)}
      </button>
    </form>
  );
}

// One driver's column. The stop list scrolls inside the column rather than
// stretching the page, so every driver's column starts at the same height and
// you can compare the day across them — and the arrows exist because a warehouse
// touchscreen has no trackpad and a nested scroll area is invisible without them.
function BoardColumn({ title, count, children, bodyKey }) {
  const body = useRef(null);
  const [over, setOver] = useState(false);
  const [at, setAt] = useState({ top: true, bottom: false });

  const measure = useCallback(() => {
    const el = body.current;
    if (!el) return;
    const room = el.scrollHeight - el.clientHeight;
    setOver(room > 4);
    setAt({ top: el.scrollTop <= 2, bottom: el.scrollTop >= room - 2 });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, bodyKey]);

  // Plain assignment, NOT scrollBy({behavior:'smooth'}): a smooth scroll is an
  // animation, and where the browser doesn't run one — reduced-motion settings,
  // some managed/kiosk browsers — the call is a silent no-op and the arrow is a
  // dead button. Moving instantly always works, which is the whole job here.
  const nudge = (dir) => {
    const el = body.current;
    if (!el) return;
    el.scrollTop += dir * 260;
    measure();
  };

  return (
    <section className="disp-col">
      <h3 className="disp-col-head">
        {title}
        <span className="disp-count">{count}</span>
      </h3>
      {over && (
        <button type="button" className="disp-scroll up" disabled={at.top}
          onClick={() => nudge(-1)} aria-label={`Scroll ${title} up`}>▲</button>
      )}
      <div className="disp-col-body" ref={body} onScroll={measure}>{children}</div>
      {over && (
        <button type="button" className="disp-scroll down" disabled={at.bottom}
          onClick={() => nudge(1)} aria-label={`Scroll ${title} down`}>▼</button>
      )}
    </section>
  );
}

// A filename someone can find again six weeks later: the job, the order it came
// from, and which photo — never a blob id.
const podName = (job, what) =>
  encodeURIComponent([job.jobNumber, job.orderNumber, what].filter(Boolean).join('-'));

// Browsers only honour one programmatic download at a time, so they're spaced.
function savePod(job) {
  const items = [
    ...(job.hasSignature ? [{ q: `jobsig=${job.id}`, what: 'signature' }] : []),
    ...(job.photoIds || []).map((pid, i) => ({ q: `jobphoto=${pid}`, what: `photo-${i + 1}` }))
  ];
  items.forEach((it, i) => setTimeout(() => {
    const a = document.createElement('a');
    a.href = `/api/admin/pod?${it.q}&download=1&name=${podName(job, it.what)}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, i * 400));
}

function JobCard({ job, drivers, busy, onAssign, onStatus, onCancel, onServiceDone, onRecord, onReopen, onEdit, onMove, onTimes, onCharge, onPay, seat, helpingFor }) {
  const [open, setOpen] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [timing, setTiming] = useState(false);
  const [history, setHistory] = useState(false);
  const [money, setMoney] = useState(false);
  const closed = ['done', 'failed', 'cancelled'].includes(job.status);
  // Clocked in and not yet out: the stop is live and the card has to say so in
  // a number that keeps moving.
  const live = !!job.timeIn && !job.timeOut;
  useTicking(live);
  const running = live ? minsBetween(job.timeIn, Date.now()) : 0;
  return (
    <div className={'disp-card' + (closed ? ' is-closed' : '')}>
      <div className="disp-card-top">
        {/* The run order, and the two buttons that change it. Numbered because
            "third stop" is how a driver and a dispatcher talk about it on the
            phone; arrows rather than drag because this is used one-handed on a
            warehouse touchscreen. */}
        {seat && (
          <span className="disp-seat">
            <b>{seat.n}</b>
            <button type="button" disabled={busy || seat.first} title="Earlier in the run"
              onClick={() => onMove(job, -1)}>▲</button>
            <button type="button" disabled={busy || seat.last} title="Later in the run"
              onClick={() => onMove(job, 1)}>▼</button>
          </span>
        )}
        <span className="disp-win">{windowLabel(job)}</span>
        <span className={'pill ' + (STATUS_TONE[job.status] || 'warn')}>{STATUS_LABEL[job.status]}</span>
      </div>
      {helpingFor && <div className="disp-helping">Riding with {helpingFor}</div>}
      <div className="disp-who">{job.customerName || '(no name)'}</div>
      <div className="disp-addr">
        {job.pickupAddress
          ? <>
              {[job.pickupAddress, job.pickupCity].filter(Boolean).join(', ')}
              {(job.pickupCompany || job.pickupName || job.pickupPhone) && (
                <span className="disp-pickup-who">
                  {' ('}{[job.pickupCompany, job.pickupName, job.pickupPhone].filter(Boolean).join(' · ')}{')'}
                </span>
              )}
              {' '}<b>→</b> {[job.address, job.city].filter(Boolean).join(', ')}
            </>
          : [job.address, job.city].filter(Boolean).join(', ')}
      </div>
      {job.balanceDue > 0 && (
        // Once the stop is done and the money still isn't recorded, this stops
        // being an instruction to the driver and becomes a nudge to the office.
        <div className="disp-collect">
          <div className="disp-collect-head">
            <span>
              {job.status === 'done' ? 'Still owing' : 'Collect'} ${Number(job.balanceDue).toFixed(2)}
              {job.invoiceNumber ? <span className="disp-collect-ref"> · {job.invoiceNumber}</span> : null}
            </span>
            <button type="button" className="disp-collect-btn" onClick={() => setCollecting((v) => !v)}>
              {collecting ? 'Cancel' : 'Record payment'}
            </button>
          </div>
          {collecting && (
            <CollectForm job={job} busy={busy}
              onRecord={async (id, payload) => { const ok = await onRecord(id, payload); if (ok) setCollecting(false); }} />
          )}
        </div>
      )}
      {(job.tradeIns?.length > 0 || job.services?.includes('trade_in')) && (
        // An appliance we have BOUGHT and have to come back with. It gets the
        // same weight as the money to collect, because a van that leaves without
        // it has left behind something already paid for.
        <div className={'disp-tradein' + (job.tradeInCollected ? ' is-done' : '')}>
          <b>{job.tradeInCollected ? 'TRADE-IN COLLECTED' : 'TRADE-IN TO COLLECT'}</b>
          {job.tradeIns?.length
            ? job.tradeIns.map((t, i) => (
                <div key={i}>{t.description}{t.allowance > 0 ? ` — $${t.allowance.toFixed(2)} allowed` : ''}</div>
              ))
            /* Tagged by hand on a job with no Bargain Bay order behind it — the
               unit is in the notes, so point at them rather than saying nothing. */
            : <div>See the notes for what to pick up.</div>}
          {job.tradeInNote && <div className="disp-tradein-note">{job.tradeInNote}</div>}
        </div>
      )}
      <div className="disp-meta">
        <span className="disp-tag">{TYPE_LABEL[job.type] || job.type}</span>
        {job.shipmentType && (
          <span className={'disp-tag' + (job.shipmentType === 'white_glove' ? ' is-glove' : '')}>
            {SHIPMENT_LABEL[job.shipmentType] || job.shipmentType}
          </span>
        )}
        {job.services?.map((k) => <span key={k} className="disp-tag">{SERVICE_LABEL[k] || k}</span>)}
        {/* Who the work is FOR. A board that mixes Bargain Bay deliveries with
            three other companies' service calls is unreadable if the cards don't
            say which is which. */}
        <span className={'disp-tag is-src' + (job.source === 'bargain_bay' ? ' is-bb' : '')}>
          {job.clientName || (job.source === 'bargain_bay' ? 'Bargain Bay' : 'Own job')}
        </span>
        {job.driver2Name && <span className="disp-tag is-pair">2 crew</span>}
        <span className="disp-num">
          {job.ticketNumber || job.jobNumber}
          {job.orderNumber && <b className="disp-order"> · {job.orderNumber}</b>}
        </span>
      </div>
      {job.type === 'service_call'
        ? (job.appliance || job.issue) && (
            <div className="disp-items">
              {job.appliance}{job.appliance && job.issue ? ' — ' : ''}{job.issue}
            </div>
          )
        : job.items?.length > 0 && (
            <div className="disp-items">{job.items.map((i) => i.description).join(' · ')}</div>
          )}
      {job.partsNeeded && <div className="disp-fail">Waiting on: {job.partsNeeded}</div>}
      {(job.timeIn || job.payAmount != null || job.chargeAmount != null) && (
        <div className="disp-times">
          {job.timeIn && (
            <>
              {hhmm(job.timeIn)}
              {job.timeOut
                ? <>–{hhmm(job.timeOut)} · <b>{asDuration(minsBetween(job.timeIn, job.timeOut))}</b></>
                /* Running. The number that matters at a glance is how long they
                   have been standing there — an hour and a half on a threshold
                   drop is either a problem or a forgotten Done tap, and either
                   way somebody should be ringing the van. */
                : <> · <b className={running > 150 ? 'disp-late' : ''}>on site {asDuration(running)}</b></>}
            </>
          )}
          {/* Finished with no clock on it: nothing can cost this stop until
              somebody types the times in. */}
          {!job.timeIn && closed && job.status === 'done' && <span className="disp-late">no times recorded</span>}
          {job.payAmount != null && <> · pays ${Number(job.payAmount).toFixed(2)}</>}
          {job.chargeAmount != null && <> · bills ${Number(job.chargeAmount).toFixed(2)}</>}
          {job.invoiceId && <> · invoiced</>}
        </div>
      )}
      {/* Cash at the door — not the invoice balance below it, and not a price
          we charge. It reads off the client's own note when nobody typed one. */}
      {cashAtTheDoor(job) && (
        <div className="disp-cash">
          💵 Collect ${cashAtTheDoor(job).amount.toFixed(2)} cash
          {!cashAtTheDoor(job).typed && <span className="disp-cash-src"> — read from the notes, check it</span>}
        </div>
      )}
      {job.failReason && <div className="disp-fail">{FAIL_REASONS[job.failReason] || job.failReason}</div>}

      {/* What the driver captured at the door. Links, not thumbnails: the office
          opens one when a customer disputes something, not on every card. */}
      {(job.hasSignature || job.photoIds?.length > 0) && (
        <div className="disp-pod">
          Proof:{' '}
          {job.hasSignature && (
            <>
              <a href={`/api/admin/pod?jobsig=${job.id}`} target="_blank" rel="noopener noreferrer">signature</a>
              <a className="disp-dl" title="Save the signature"
                 href={`/api/admin/pod?jobsig=${job.id}&download=1&name=${podName(job, 'signature')}`}>⤓</a>
            </>
          )}
          {job.photoIds?.map((pid, i) => (
            <span key={pid}>{(job.hasSignature || i > 0) ? ' · ' : ''}
              <a href={`/api/admin/pod?jobphoto=${pid}`} target="_blank" rel="noopener noreferrer">photo {i + 1}</a>
              {/* ⤓ SAVES it. Proof of delivery has to be able to leave the
                  building — attached to a damage claim, or sent to the client
                  arguing about it — and "right-click, Save image as" is not a
                  thing on the phone the office is holding. */}
              <a className="disp-dl" title={`Save photo ${i + 1}`}
                 href={`/api/admin/pod?jobphoto=${pid}&download=1&name=${podName(job, `photo-${i + 1}`)}`}>⤓</a>
            </span>
          ))}
          {job.photoIds?.length > 1 && (
            <button type="button" className="disp-dl-all" onClick={() => savePod(job)}>save all</button>
          )}
          {/* The signed form itself, on paper — what actually goes to a client
              who is arguing about a dent. */}
          {job.hasPodForm && (
            <> · <a href={`/admin/dispatch/pod/${job.id}`} target="_blank" rel="noopener noreferrer">POD form</a></>
          )}
        </div>
      )}

      <button type="button" className="disp-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? 'Hide' : 'Actions'}
      </button>

      {open && (
        <div className="disp-actions">
          <label>
            Driver
            <select value={job.driverId || ''} disabled={busy || closed}
              onChange={(e) => onAssign(job.id, { driverId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          {/* Two sent together are one van on one run, so this is a second name
              on the stop and not a second copy of it — the running order, the
              money and the proof of delivery all stay single. */}
          {job.driverId && (
            <label>
              With
              <select value={job.driver2Id || ''} disabled={busy || closed}
                onChange={(e) => onAssign(job.id, { driver2Id: e.target.value || null })}>
                <option value="">Nobody</option>
                {drivers.filter((d) => d.id !== job.driverId)
                  .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
          {/* Moving a stop to another day was only possible by cancelling it and
              typing it in again. A customer rescheduling is the single most
              ordinary thing that happens to a delivery. */}
          <label>
            Day
            <input type="date" value={job.jobDate || ''} disabled={busy || closed}
              onChange={(e) => onAssign(job.id, { jobDate: e.target.value || null })} />
          </label>
          {closed && (
            <span className="disp-closed-note">
              {STATUS_LABEL[job.status]} — reopen it to change the driver or the day.
            </span>
          )}
          {job.phone && <a className="btn" href={`tel:${job.phone}`}>Call{job.pickupPhone ? ' drop-off' : ''}</a>}
          {job.pickupPhone && <a className="btn" href={`tel:${job.pickupPhone}`}>Call pickup</a>}
          <a className="btn" target="_blank" rel="noopener noreferrer"
             href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([job.address, job.city, job.postal].filter(Boolean).join(', '))}`}>
            Map
          </a>
          {!closed && (
            <>
              {job.status === 'scheduled' && (
                <button type="button" className="btn" disabled={busy}
                  onClick={() => onStatus(job.id, 'on_the_way')}>Start</button>
              )}
              <button type="button" className="btn" disabled={busy} onClick={() => onServiceDone(job)}>
                {job.type === 'service_call' ? 'Close out visit' : 'Close out'}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => onStatus(job.id, 'failed')}>Couldn&apos;t complete</button>
              <button type="button" className="btn danger" disabled={busy} onClick={() => onCancel(job.id)}>Cancel</button>
            </>
          )}
          {closed && (
            <button type="button" className="btn" disabled={busy} onClick={() => onReopen(job.id)}>
              Reopen
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={() => onEdit(job)}>Edit</button>
          {/* Fixing the clock is not the same job as closing a stop out, and it
              happens long after: the times arrive in the WhatsApp group and get
              typed in that evening, or the next morning. */}
          {onTimes && (
            <button type="button" className="btn" disabled={busy} onClick={() => setTiming((v) => !v)}>
              {timing ? 'Hide times' : (job.timeIn && job.timeOut ? 'Fix times' : 'Set times')}
            </button>
          )}
          {/* The charge, on the stop. It used to be reachable only from the
              Billing tab, which a job with no client company never reaches. */}
          {onCharge && (
            <button type="button" className="btn" disabled={busy} onClick={() => setMoney((v) => !v)}>
              {money ? 'Hide money' : (job.chargeAmount == null ? 'Set charge' : 'Charge / pay')}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setHistory((v) => !v)}>
            {history ? 'Hide history' : 'History'}
          </button>
          {job.notes && <p className="disp-notes">{job.notes}</p>}
          {timing && onTimes && (
            <TimesForm job={job} busy={busy} onTimes={onTimes} onDone={() => setTiming(false)} />
          )}
          {money && onCharge && (
            <MoneyForm job={job} busy={busy} onCharge={onCharge} onPay={onPay} onDone={() => setMoney(false)} />
          )}
          {history && <JobHistory jobId={job.id} />}
        </div>
      )}
    </div>
  );
}

export default function DispatchBoard({ initial, canManageClients, openTickets, initialView = 'board' }) {
  const [board, setBoard] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);      // the job being corrected
  const [closing, setClosing] = useState(null);   // the service visit being closed out
  // Everything dispatch does happens on this page — no tab-hopping to add a
  // client or chase a service call mid-shift.
  const [view, setView] = useState(['board', 'tickets', 'setup', 'import'].includes(initialView) ? initialView : 'board');
  const [tickets, setTickets] = useState(openTickets);
  const [pull, setPull] = useState(null);        // what the last Bargain Bay pull did
  const [addNum, setAddNum] = useState('');      // order number typed into "add by number"
  const [gassing, setGassing] = useState(false); // the day-cost box, open on the bar

  async function refresh(date = board.date) {
    setErr('');
    try {
      const res = await fetch(`/api/admin/dispatch?date=${encodeURIComponent(date)}`);
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not load the board.'); return; }
      setBoard(d);
    } catch { setErr('Network error — the board may be out of date.'); }
  }

  async function send(method, body) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'That didn’t work.'); return false; }
      await refresh();
      return true;
    } catch {
      setErr('Network error — nothing was changed.'); return false;
    } finally { setBusy(false); }
  }

  // jobDate defaults to the day being looked at, but an explicit one in `patch`
  // wins — that's what makes the Day picker able to move a stop off this board.
  const onAssign = (jobId, patch) => send('PATCH', { action: 'assign', jobId, jobDate: board.date, ...patch });

  const onReopen = (jobId) => send('PATCH', { action: 'reopen', jobId });

  // Moving a stop up or down its driver's run. The whole run is sent back in its
  // new order — seq is a position, and renumbering the one card that moved would
  // leave two stops claiming the same place.
  //
  // The run is the stops that driver OWNS, not everything in their column. A
  // column also shows the stops they are riding on as somebody's second man, and
  // those belong to the other driver's running order: including them here made a
  // reorder hand them over.
  function onMove(job, delta) {
    const run = ownedBy(job.driverId);
    const from = run.findIndex((j) => j.id === job.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= run.length) return;
    const ids = run.map((j) => j.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    return send('PATCH', { action: 'resequence', driverId: job.driverId, date: board.date, jobIds: ids });
  }

  // The times, corrected from the office.
  const onTimes = (jobId, patch) => send('PATCH', { action: 'times', jobId, ...patch });

  // Both halves of a stop's money, each through its own guarded action. '' means
  // clear it, which is why the amount is passed through rather than Number()'d
  // here — setJobCharge and setJobPay both read '' as "no figure".
  const onCharge = (jobId, amount, note) => send('PATCH', { action: 'charge', jobId, amount, note });
  const onPay = (jobId, amount, note) => send('PATCH', { action: 'pay', jobId, amount, note });

  // The pull used to refresh in silence, so an order it declined to take looked
  // exactly like an order it had taken. It now says what it did and, for
  // anything it left behind, what to do about it.
  async function pullBargainBay() {
    setBusy(true); setErr(''); setPull(null);
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_bb' })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not pull the orders.'); return; }
      setPull(d);
      await refresh();
    } catch {
      setErr('Network error — nothing was pulled.');
    } finally { setBusy(false); }
  }

  // Recording the balance the driver came back with. It lands on the ORDER'S
  // INVOICE — the same ledger the Invoices page writes to — so there is one
  // record of the money, not a dispatch copy of it.
  async function onRecord(jobId, payload) {
    const ok = await send('PATCH', { action: 'record_payment', jobId, ...payload });
    if (ok) setPull(null);
    return ok;
  }

  // The escape hatch: put this one order on the board regardless of what the
  // pull thought of it. A pickup order carries no delivery address, so ask for
  // one rather than refusing — it goes on the job, not back onto the order.
  async function addOrderAnyway(orderNumber, needsAddress) {
    const num = String(orderNumber || '').trim();
    if (!num) return;
    let address;
    if (needsAddress) {
      address = window.prompt(`${num} has no delivery address on it. Where is it going?`);
      if (!address?.trim()) return;
    }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_order', orderNumber: num, address })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not add that order.'); return; }
      setPull((p) => (p ? { ...p, skipped: p.skipped.filter((sk) => sk.order !== num) } : p));
      setAddNum('');
      await refresh();
    } catch {
      setErr('Network error — nothing was added.');
    } finally { setBusy(false); }
  }

  // Putting a stop back. RS-1023 is a job, BB-1078 is an order, and whoever is
  // holding one number should not have to know which of the two it is — so the
  // one box takes both. This is the only way back for a cancelled stop that has
  // no order behind it: cancelled stops are off the board, so their card, and
  // the Reopen button on it, is not there to click.
  async function reopenByNumber(num) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reopen_number', jobNumber: num })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not put that stop back.'); return; }
      setAddNum('');
      // It comes back on the day it was booked for, which is often not the day
      // on screen — so say so, and go to that day. A board that looked exactly
      // the same afterwards would read as nothing having happened.
      const on = d.job?.jobDate;
      setPull({
        note: `${d.job.jobNumber} is back on the board${on ? ` for ${prettyDate(on)}` : ', waiting for a day'}.`
      });
      await refresh(on || board.date);
    } catch {
      setErr('Network error — nothing was changed.');
    } finally { setBusy(false); }
  }

  // Typing a number is the way in for an order the pull never looked at — it
  // only scans the recent weeks, and a special order sold in June still gets
  // delivered in August.
  async function addByNumber(e) {
    e.preventDefault();
    const num = addNum.trim();
    if (!num) return;
    // A bare number stays an order number, which is what this box has always
    // meant. Only an explicit RS is a stop.
    if (/^rs/i.test(num)) return reopenByNumber(num);
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_order', orderNumber: num })
      });
      const d = await res.json();
      // The one failure worth handling here rather than reporting: no address on
      // the order. Ask for it and go again.
      if (!res.ok && /no address/i.test(d.error || '')) { setBusy(false); return addOrderAnyway(num, true); }
      if (!res.ok) { setErr(d.error || 'Could not add that order.'); return; }
      setAddNum('');
      setPull({ imported: 1, created: d.created, alreadyOnBoard: 0, skipped: [] });
      await refresh();
    } catch {
      setErr('Network error — nothing was added.');
    } finally { setBusy(false); }
  }

  async function onServiceComplete({ pay, payNote, ...payload }) {
    const ok = await send('PATCH', { action: 'complete', jobId: closing.id, ...payload });
    // Pay is a separate, admin-only call — a failure there must not undo the
    // close-out, which is the part the crew is waiting on.
    if (ok && pay !== undefined) {
      await fetch('/api/admin/dispatch', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay', jobId: closing.id, amount: pay, note: payNote })
      }).catch(() => {});
      await refresh();
    }
    if (ok) setClosing(null);
  }

  function onStatus(jobId, status) {
    if (status !== 'failed') return send('PATCH', { action: 'status', jobId, status });
    const keys = Object.keys(FAIL_REASONS);
    const answer = window.prompt(
      `Why couldn't it be completed?\n${keys.map((k, i) => `${i + 1}. ${FAIL_REASONS[k]}`).join('\n')}\n\nEnter a number:`
    );
    const pick = keys[Number(answer) - 1];
    if (!pick) return;
    const note = window.prompt('Anything to add? (optional)') || '';
    return send('PATCH', { action: 'status', jobId, status: 'failed', failReason: pick, note });
  }

  function onCancel(jobId) {
    const reason = window.prompt('Cancel this job? Add a short reason:');
    if (reason === null) return;
    return send('PATCH', { action: 'cancel', jobId, reason });
  }

  // Paging the columns sideways. Columns are a fixed width, so one page IS one
  // column — the board never stops half way across a driver's day.
  const strip = useRef(null);
  const [stripOver, setStripOver] = useState(false);
  const [stripAt, setStripAt] = useState({ start: true, end: false });

  const measureStrip = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const room = el.scrollWidth - el.clientWidth;
    setStripOver(room > 4);
    setStripAt({ start: el.scrollLeft <= 2, end: el.scrollLeft >= room - 2 });
  }, []);

  useEffect(() => {
    measureStrip();
    window.addEventListener('resize', measureStrip);
    return () => window.removeEventListener('resize', measureStrip);
  }, [measureStrip, board.drivers.length, board.jobs.length]);

  const pageColumns = (dir) => {
    const el = strip.current;
    if (!el) return;
    const col = el.querySelector('.disp-col');
    const step = (col?.getBoundingClientRect().width || 300) + 14;   // + the gap
    el.scrollLeft += dir * step;                                     // see nudge()
    measureStrip();
  };

  const inOrder = (list) => [...list]
    .sort((a, b) => (a.seq ?? 99) - (b.seq ?? 99) || String(a.windowStart).localeCompare(String(b.windowStart)));
  // Both people's columns show the stop. A dispatcher looking at Ravi's day has
  // to see the run he is actually on, even when the card "belongs" to Nicholas.
  const byDriver = (id) => inOrder(board.jobs.filter((j) => j.driverId === id || j.driver2Id === id));
  // ...but only the stops a driver OWNS are their run. Everything that numbers,
  // reorders or counts a route has to ask this one, not the column.
  const ownedBy = (id) => inOrder(board.jobs.filter((j) => j.driverId === id));
  const unassignedToday = board.jobs.filter((j) => !j.driverId);
  const openCount = board.jobs.filter((j) => !['done', 'failed', 'cancelled'].includes(j.status)).length;

  const Tab = ({ id, children }) => (
    <button type="button" className={'disp-tab' + (view === id ? ' is-on' : '')}
      aria-current={view === id} onClick={() => setView(id)}>{children}</button>
  );

  return (
    <div>
      <div className="disp-tabs">
        <Tab id="board">Board</Tab>
        <Tab id="tickets">Service calls{tickets ? ` (${tickets})` : ''}</Tab>
        <Tab id="import">Import</Tab>
        <Tab id="live">Live</Tab>
        <Tab id="times">Times</Tab>
        <Tab id="billing">Billing</Tab>
        <Tab id="pay">Pay</Tab>
        {canManageClients && <Tab id="profit">Profit</Tab>}
        <Tab id="setup">Clients &amp; drivers</Tab>
      </div>

      {view === 'tickets' && <TicketQueue onChanged={() => refresh()} />}

      {view === 'import' && (
        <StopImport clients={board.clients} date={board.date} onDone={() => refresh()} />
      )}

      {view === 'billing' && <ClientBilling canBill={canManageClients} />}

      {view === 'pay' && <PayReport canSetPay={canManageClients} />}

      {/* The clock, as a history — and the place a forgotten Done tap gets
          corrected in bulk rather than one card at a time. */}
      {view === 'live' && <LiveMap />}

      {view === 'times' && <StopTimes drivers={board.drivers} />}

      {view === 'profit' && <ProfitReport drivers={board.drivers} date={board.date} />}

      {view === 'setup' && (
        <DispatchSetup clients={board.clients} drivers={board.drivers}
          canManageDrivers={canManageClients} onChanged={() => refresh()} />
      )}

      {view !== 'board' ? null : (
      <div>
      <div className="disp-bar">
        <div className="disp-nav">
          <button type="button" className="btn" onClick={() => refresh(shiftDate(board.date, -1))}>←</button>
          <input type="date" value={board.date} onChange={(e) => e.target.value && refresh(e.target.value)} />
          <button type="button" className="btn" onClick={() => refresh(shiftDate(board.date, 1))}>→</button>
          <span className="disp-daylabel">{prettyDate(board.date)}</span>
        </div>
        <div className="disp-bar-actions">
          <span className="hint" style={{ margin: 0 }}>{openCount} still to do</span>

          <button type="button" className="btn" disabled={busy}
            title="Pull in Bargain Bay delivery orders that aren't on the board yet"
            onClick={pullBargainBay}>Pull Bargain Bay orders</button>
          <form className="disp-addnum" onSubmit={addByNumber}>
            <input value={addNum} onChange={(e) => setAddNum(e.target.value)}
              placeholder="BB-1078 or RS-1023" aria-label="Add an order, or put a stop back, by number"
              title="BB-1078 puts one Bargain Bay order on the board, including orders older than the pull looks back. RS-1023 puts a stop back that was cancelled or finished — it returns on the day it was booked for." />
            <button type="submit" className="btn" disabled={busy || !addNum.trim()}>Add</button>
          </form>
          <a className="btn" href={`/admin/dispatch/print?date=${board.date}`} target="_blank" rel="noopener noreferrer">Print run sheet</a>
          {/* Gas, on the day, from the screen the office is already looking at.
              It can be entered any time from the Profit tab as well — a receipt
              comes out of the glovebox on Friday as often as it goes in at the
              pump — but a cost nobody can record where they are standing is a
              cost that gets remembered as "about a hundred". */}
          {canManageClients && (
            <button type="button" className="btn" disabled={busy}
              title={`Record gas or another cost against ${board.date}`}
              onClick={() => setGassing((v) => !v)}>{gassing ? 'Close' : '⛽ Gas'}</button>
          )}
          <button type="button" className="btn accent" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : '+ Add job'}
          </button>
        </div>
      </div>

      {err && <div className="error-box">{err}</div>}

      {gassing && (
        <DayCostForm date={board.date} drivers={board.drivers} busy={busy}
          onSave={async (body) => {
            const ok = await send('POST', { action: 'expense', ...body });
            if (ok) setGassing(false);
          }} />
      )}

      {pull && (
        <div className="disp-pull">
          <button type="button" className="disp-pull-x" onClick={() => setPull(null)} aria-label="Dismiss">×</button>
          <b>
            {pull.note
              || (pull.imported
                ? `Added ${pull.imported} order${pull.imported === 1 ? '' : 's'} to the board: ${pull.created.map((c) => `${c.order} → ${c.job}`).join(', ')}.`
                : 'Nothing new to add.')}
          </b>
          {pull.alreadyOnBoard > 0 && (
            <div className="hint" style={{ margin: '4px 0 0' }}>
              {pull.alreadyOnBoard} already on the board.
            </div>
          )}
          {pull.skipped?.length > 0 && (
            <>
              <div className="hint" style={{ margin: '6px 0 2px' }}>Not pulled in:</div>
              <ul className="disp-pull-list">
                {pull.skipped.map((sk) => (
                  <li key={sk.order}>
                    <b>{sk.order}</b> — {sk.reason}
                    {sk.canForce && (
                      <button type="button" className="disp-pull-add" disabled={busy}
                        onClick={() => addOrderAnyway(sk.order, sk.needsAddress)}>Add anyway</button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {closing && (
        <div className="panel">
          <ServiceVisitForm job={closing} busy={busy} canSetPay={canManageClients}
            onSubmit={onServiceComplete} onCancel={() => setClosing(null)} />
        </div>
      )}

      {adding && (
        <div className="panel">
          <JobForm date={board.date} clients={board.clients} drivers={board.drivers}
            canManageClients={canManageClients}
            onClientAdded={(c) => setBoard((b) => ({ ...b, clients: [...b.clients, c].sort((x, y) => x.name.localeCompare(y.name)) }))}
            onDone={() => { setAdding(false); refresh(); }} />
        </div>
      )}

      {/* Correcting a stop that exists — same form, prefilled. A wrong number or
          a customer who moved shouldn't mean cancel-and-retype. */}
      {editing && (
        <div className="panel">
          <JobForm job={editing} date={editing.jobDate || board.date}
            clients={board.clients} drivers={board.drivers} canManageClients={canManageClients}
            onClientAdded={(c) => setBoard((b) => ({ ...b, clients: [...b.clients, c].sort((x, y) => x.name.localeCompare(y.name)) }))}
            onDone={() => { setEditing(null); refresh(); }} />
        </div>
      )}

      <div className="disp-strip">
        {stripOver && (
          <button type="button" className="disp-page left" disabled={stripAt.start}
            onClick={() => pageColumns(-1)} aria-label="Previous column">‹</button>
        )}
        <div className="disp-cols" ref={strip} onScroll={measureStrip}>
        <BoardColumn title="To assign" bodyKey={`${unassignedToday.length}-${board.unscheduled.length}`}
          count={unassignedToday.length + board.unscheduled.length}>
          {unassignedToday.length === 0 && board.unscheduled.length === 0 && (
            <p className="hint">Nothing waiting. Everything on {prettyDate(board.date)} has a driver.</p>
          )}
          {unassignedToday.map((j) => (
            <JobCard key={j.id} job={j} drivers={board.drivers} busy={busy}
              onAssign={onAssign} onStatus={onStatus} onCancel={onCancel} onServiceDone={setClosing}
              onRecord={onRecord} onReopen={onReopen} onEdit={setEditing} onTimes={onTimes}
              onCharge={canManageClients ? onCharge : null} onPay={onPay} />
          ))}
          {board.unscheduled.length > 0 && (
            <>
              <h4 className="disp-sub">No date yet</h4>
              {board.unscheduled.map((j) => (
                <JobCard key={j.id} job={j} drivers={board.drivers} busy={busy}
                  onAssign={onAssign} onStatus={onStatus} onCancel={onCancel} onServiceDone={setClosing}
                  onRecord={onRecord} onReopen={onReopen} onEdit={setEditing} onTimes={onTimes}
              onCharge={canManageClients ? onCharge : null} onPay={onPay} />
              ))}
            </>
          )}
        </BoardColumn>

        {board.drivers.length === 0 && (
          <section className="disp-col">
            <h3 className="disp-col-head">No drivers yet</h3>
            <p className="hint">Add a driver under Operations, then they&apos;ll get a column here.</p>
          </section>
        )}

        {board.drivers.map((d) => {
          const stops = byDriver(d.id);
          const own = ownedBy(d.id);
          const riding = stops.length - own.length;
          const left = stops.filter((j) => !['done', 'failed', 'cancelled'].includes(j.status)).length;
          return (
            <BoardColumn key={d.id} title={d.name} bodyKey={String(stops.length)}
              count={stops.length ? `${left}/${stops.length}` : '0'}>
              {stops.length === 0 && <p className="hint">No stops on this day.</p>}
              {/* A column that quietly mixes "your run" with "you're the second
                  man on someone else's" reads as a driver having fewer stops
                  than they do, or more. Say which is which. */}
              {riding > 0 && (
                <p className="hint" style={{ marginTop: 0 }}>
                  {own.length} own {own.length === 1 ? 'stop' : 'stops'} · riding on {riding} of someone else&apos;s
                </p>
              )}
              {stops.map((j) => {
                // The number on the card is the position in the run it belongs
                // to, so ▲▼ move it inside that run and nothing else.
                const k = own.findIndex((o) => o.id === j.id);
                return (
                  <JobCard key={j.id} job={j} drivers={board.drivers} busy={busy}
                    onAssign={onAssign} onStatus={onStatus} onCancel={onCancel} onServiceDone={setClosing}
                    onRecord={onRecord} onReopen={onReopen} onEdit={setEditing} onMove={onMove} onTimes={onTimes}
                    onCharge={canManageClients ? onCharge : null} onPay={onPay}
                    helpingFor={j.driver2Id === d.id ? j.driverName : null}
                    seat={k >= 0 ? { n: k + 1, first: k === 0, last: k === own.length - 1 } : null} />
                );
              })}
            </BoardColumn>
          );
        })}
        </div>
        {stripOver && (
          <button type="button" className="disp-page right" disabled={stripAt.end}
            onClick={() => pageColumns(1)} aria-label="Next column">›</button>
        )}
      </div>
      </div>
      )}
    </div>
  );
}
