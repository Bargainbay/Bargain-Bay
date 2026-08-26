'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import JobForm from './JobForm';
import ServiceVisitForm from './ServiceVisitForm';
import TicketQueue from './TicketQueue';
import DispatchSetup from './DispatchSetup';
import PayReport from './PayReport';
import ClientBilling from './ClientBilling';

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

function JobCard({ job, drivers, busy, onAssign, onStatus, onCancel, onServiceDone, onRecord, onReopen, onEdit, onMove, seat }) {
  const [open, setOpen] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const closed = ['done', 'failed', 'cancelled'].includes(job.status);
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
      <div className="disp-who">{job.customerName || '(no name)'}</div>
      <div className="disp-addr">
        {job.pickupAddress
          ? <>{[job.pickupAddress, job.pickupCity].filter(Boolean).join(', ')} <b>→</b> {[job.address, job.city].filter(Boolean).join(', ')}</>
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
            <>on site {new Date(job.timeIn).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}
              {job.timeOut && `–${new Date(job.timeOut).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}`}</>
          )}
          {job.payAmount != null && <> · pays ${Number(job.payAmount).toFixed(2)}</>}
          {job.chargeAmount != null && <> · bills ${Number(job.chargeAmount).toFixed(2)}</>}
          {job.invoiceId && <> · invoiced</>}
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
          {job.phone && <a className="btn" href={`tel:${job.phone}`}>Call</a>}
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
          {job.notes && <p className="disp-notes">{job.notes}</p>}
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
  const [view, setView] = useState(['board', 'tickets', 'setup'].includes(initialView) ? initialView : 'board');
  const [tickets, setTickets] = useState(openTickets);
  const [pull, setPull] = useState(null);        // what the last Bargain Bay pull did
  const [addNum, setAddNum] = useState('');      // order number typed into "add by number"

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

  // Moving a stop up or down its driver's run. The whole column is sent back in
  // its new order — seq is a position, and renumbering the one card that moved
  // would leave two stops claiming the same place.
  function onMove(job, delta) {
    const run = byDriver(job.driverId);
    const from = run.findIndex((j) => j.id === job.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= run.length) return;
    const ids = run.map((j) => j.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    return send('PATCH', { action: 'resequence', driverId: job.driverId, date: board.date, jobIds: ids });
  }

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

  // Typing a number is the way in for an order the pull never looked at — it
  // only scans the recent weeks, and a special order sold in June still gets
  // delivered in August.
  async function addByNumber(e) {
    e.preventDefault();
    const num = addNum.trim();
    if (!num) return;
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

  const byDriver = (id) => board.jobs.filter((j) => j.driverId === id)
    .sort((a, b) => (a.seq ?? 99) - (b.seq ?? 99) || String(a.windowStart).localeCompare(String(b.windowStart)));
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
        <Tab id="billing">Billing</Tab>
        <Tab id="pay">Pay</Tab>
        <Tab id="setup">Clients &amp; drivers</Tab>
      </div>

      {view === 'tickets' && <TicketQueue onChanged={() => refresh()} />}

      {view === 'billing' && <ClientBilling canBill={canManageClients} />}

      {view === 'pay' && <PayReport canSetPay={canManageClients} />}

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
              placeholder="BB-1078" aria-label="Add a Bargain Bay order by number"
              title="Put one order on the board by number — works for orders older than the pull looks back" />
            <button type="submit" className="btn" disabled={busy || !addNum.trim()}>Add order</button>
          </form>
          <a className="btn" href={`/admin/dispatch/print?date=${board.date}`} target="_blank" rel="noopener noreferrer">Print run sheet</a>
          <button type="button" className="btn accent" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : '+ Add job'}
          </button>
        </div>
      </div>

      {err && <div className="error-box">{err}</div>}

      {pull && (
        <div className="disp-pull">
          <button type="button" className="disp-pull-x" onClick={() => setPull(null)} aria-label="Dismiss">×</button>
          <b>
            {pull.imported
              ? `Added ${pull.imported} order${pull.imported === 1 ? '' : 's'} to the board: ${pull.created.map((c) => `${c.order} → ${c.job}`).join(', ')}.`
              : 'Nothing new to add.'}
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
              onRecord={onRecord} onReopen={onReopen} onEdit={setEditing} />
          ))}
          {board.unscheduled.length > 0 && (
            <>
              <h4 className="disp-sub">No date yet</h4>
              {board.unscheduled.map((j) => (
                <JobCard key={j.id} job={j} drivers={board.drivers} busy={busy}
                  onAssign={onAssign} onStatus={onStatus} onCancel={onCancel} onServiceDone={setClosing}
                  onRecord={onRecord} onReopen={onReopen} onEdit={setEditing} />
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

        {board.cancelled?.length > 0 && (
          // Cancelled stops used to disappear from the board completely, which
          // is indistinguishable from being deleted — and a cancelled BB job
          // still blocks that order from being pulled in again. They stay,
          // greyed, with the button that undoes it.
          <BoardColumn title="Cancelled" count={board.cancelled.length}
            bodyKey={String(board.cancelled.length)}>
            {board.cancelled.map((j) => (
              <JobCard key={j.id} job={j} drivers={board.drivers} busy={busy}
                onAssign={onAssign} onStatus={onStatus} onCancel={onCancel} onServiceDone={setClosing}
                onRecord={onRecord} onReopen={onReopen} onEdit={setEditing} />
            ))}
          </BoardColumn>
        )}

        {board.drivers.map((d) => {
          const stops = byDriver(d.id);
          const left = stops.filter((j) => !['done', 'failed', 'cancelled'].includes(j.status)).length;
          return (
            <BoardColumn key={d.id} title={d.name} bodyKey={String(stops.length)}
              count={stops.length ? `${left}/${stops.length}` : '0'}>
              {stops.length === 0 && <p className="hint">No stops on this day.</p>}
              {stops.map((j, i) => (
                <JobCard key={j.id} job={j} drivers={board.drivers} busy={busy}
                  onAssign={onAssign} onStatus={onStatus} onCancel={onCancel} onServiceDone={setClosing}
                  onRecord={onRecord} onReopen={onReopen} onEdit={setEditing} onMove={onMove}
                  seat={{ n: i + 1, first: i === 0, last: i === stops.length - 1 }} />
              ))}
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
