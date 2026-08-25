'use client';
import { useState } from 'react';
import JobForm from './JobForm';
import ServiceVisitForm from './ServiceVisitForm';

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

function JobCard({ job, drivers, busy, onAssign, onStatus, onCancel, onServiceDone }) {
  const [open, setOpen] = useState(false);
  const closed = ['done', 'failed', 'cancelled'].includes(job.status);
  return (
    <div className={'disp-card' + (closed ? ' is-closed' : '')}>
      <div className="disp-card-top">
        <span className="disp-win">{windowLabel(job)}</span>
        <span className={'pill ' + (STATUS_TONE[job.status] || 'warn')}>{STATUS_LABEL[job.status]}</span>
      </div>
      <div className="disp-who">{job.customerName || '(no name)'}</div>
      <div className="disp-addr">{[job.address, job.city].filter(Boolean).join(', ')}</div>
      <div className="disp-meta">
        <span className="disp-tag">{TYPE_LABEL[job.type] || job.type}</span>
        {job.shipmentType && <span className="disp-tag">{job.shipmentType}</span>}
        {job.clientName && <span className="disp-tag">{job.clientName}</span>}
        <span className="disp-num">{job.ticketNumber || job.jobNumber}</span>
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
      {job.failReason && <div className="disp-fail">{FAIL_REASONS[job.failReason] || job.failReason}</div>}

      <button type="button" className="disp-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? 'Hide' : 'Actions'}
      </button>

      {open && (
        <div className="disp-actions">
          <label>
            Driver
            <select value={job.driverId || ''} disabled={busy}
              onChange={(e) => onAssign(job.id, { driverId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          {job.phone && <a className="btn" href={`tel:${job.phone}`}>Call</a>}
          <a className="btn" target="_blank" rel="noopener noreferrer"
             href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([job.address, job.city, job.postal].filter(Boolean).join(', '))}`}>
            Map
          </a>
          {!closed && (
            <>
              <button type="button" className="btn" disabled={busy}
                onClick={() => (job.type === 'service_call' ? onServiceDone(job) : onStatus(job.id, 'done'))}>
                {job.type === 'service_call' ? 'Close out visit' : 'Mark done'}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => onStatus(job.id, 'failed')}>Couldn&apos;t complete</button>
              <button type="button" className="btn danger" disabled={busy} onClick={() => onCancel(job.id)}>Cancel</button>
            </>
          )}
          {job.notes && <p className="disp-notes">{job.notes}</p>}
        </div>
      )}
    </div>
  );
}

export default function DispatchBoard({ initial, canManageClients, openTickets }) {
  const [board, setBoard] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState(null);   // the service visit being closed out

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

  const onAssign = (jobId, patch) => send('PATCH', { action: 'assign', jobId, jobDate: board.date, ...patch });

  async function onServiceComplete(payload) {
    const ok = await send('PATCH', { action: 'service_complete', jobId: closing.id, ...payload });
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

  const byDriver = (id) => board.jobs.filter((j) => j.driverId === id)
    .sort((a, b) => (a.seq ?? 99) - (b.seq ?? 99) || String(a.windowStart).localeCompare(String(b.windowStart)));
  const unassignedToday = board.jobs.filter((j) => !j.driverId);
  const openCount = board.jobs.filter((j) => !['done', 'failed', 'cancelled'].includes(j.status)).length;

  return (
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
          <a className="btn" href="/admin/dispatch/tickets">
            Service calls{typeof openTickets === 'number' ? ` (${openTickets})` : ''}
          </a>
          <button type="button" className="btn" disabled={busy}
            title="Pull in Bargain Bay delivery orders that aren't on the board yet"
            onClick={() => send('POST', { action: 'import_bb' })}>Pull Bargain Bay orders</button>
          <a className="btn" href={`/admin/dispatch/print?date=${board.date}`} target="_blank" rel="noopener noreferrer">Print run sheet</a>
          <button type="button" className="btn accent" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : '+ Add job'}
          </button>
        </div>
      </div>

      {err && <div className="error-box">{err}</div>}

      {closing && (
        <div className="panel">
          <ServiceVisitForm job={closing} busy={busy}
            onSubmit={onServiceComplete} onCancel={() => setClosing(null)} />
        </div>
      )}

      {adding && (
        <div className="panel">
          <JobForm date={board.date} clients={board.clients} drivers={board.drivers}
            canManageClients={canManageClients}
            onDone={() => { setAdding(false); refresh(); }} />
        </div>
      )}

      <div className="disp-cols">
        <section className="disp-col">
          <h3 className="disp-col-head">
            To assign
            <span className="disp-count">{unassignedToday.length + board.unscheduled.length}</span>
          </h3>
          {unassignedToday.length === 0 && board.unscheduled.length === 0 && (
            <p className="hint">Nothing waiting. Everything on {prettyDate(board.date)} has a driver.</p>
          )}
          {unassignedToday.map((j) => (
            <JobCard key={j.id} job={j} drivers={board.drivers} busy={busy}
              onAssign={onAssign} onStatus={onStatus} onCancel={onCancel} onServiceDone={setClosing} />
          ))}
          {board.unscheduled.length > 0 && (
            <>
              <h4 className="disp-sub">No date yet</h4>
              {board.unscheduled.map((j) => (
                <JobCard key={j.id} job={j} drivers={board.drivers} busy={busy}
                  onAssign={onAssign} onStatus={onStatus} onCancel={onCancel} onServiceDone={setClosing} />
              ))}
            </>
          )}
        </section>

        {board.drivers.length === 0 && (
          <section className="disp-col">
            <h3 className="disp-col-head">No drivers yet</h3>
            <p className="hint">Add a driver under Operations, then they&apos;ll get a column here.</p>
          </section>
        )}

        {board.drivers.map((d) => {
          const stops = byDriver(d.id);
          const left = stops.filter((j) => !['done', 'failed', 'cancelled'].includes(j.status)).length;
          return (
            <section key={d.id} className="disp-col">
              <h3 className="disp-col-head">
                {d.name}
                <span className="disp-count">{stops.length ? `${left}/${stops.length}` : '0'}</span>
              </h3>
              {stops.length === 0 && <p className="hint">No stops on this day.</p>}
              {stops.map((j) => (
                <JobCard key={j.id} job={j} drivers={board.drivers} busy={busy}
                  onAssign={onAssign} onStatus={onStatus} onCancel={onCancel} onServiceDone={setClosing} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
